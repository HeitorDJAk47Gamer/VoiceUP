const fs = require('fs');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9358);
const output = process.argv[3] || path.join(process.env.TEMP || process.cwd(), 'voiceup-interface-polish.png');

const evaluationSource = `(async () => {
  document.querySelector('#release-notes-modal')?.classList.add('hidden');
  document.querySelector('#welcome').classList.add('hidden');
  document.querySelector('#app').classList.remove('hidden');
  document.querySelector('#settings-button').click();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('[data-settings-tab="appearance"]').click();
  await new Promise((resolve) => setTimeout(resolve, 120));
  const dialog = document.querySelector('#settings-modal > section');
  const navigation = document.querySelector('#settings-tabs');
  const panels = document.querySelector('#settings-tab-panels');
  const dialogRect = dialog.getBoundingClientRect();
  const navigationRect = navigation.getBoundingClientRect();
  const panelsRect = panels.getBoundingClientRect();
  document.querySelector('[data-density-choice="comfortable"]').click();
  await new Promise((resolve) => setTimeout(resolve, 420));
  document.querySelector('[data-density-choice="compact"]').click();
  // Wait past the settings auto-save debounce. The selected section must not
  // jump back to General when persistence runs.
  await new Promise((resolve) => setTimeout(resolve, 850));
  const compactChannelHeight = document.querySelector('.room-channel')?.getBoundingClientRect().height || 0;
  const footer = document.querySelector('.profile-footer-card');
  const savedProfile = JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}');
  return JSON.stringify({
    modalVisible: !document.querySelector('#settings-modal').classList.contains('hidden'),
    sideNavigation: navigationRect.right <= panelsRect.left + 2,
    navigationWidth: Math.round(navigationRect.width),
    panelsWidth: Math.round(panelsRect.width),
    dialogWidth: Math.round(dialogRect.width),
    activeTab: document.querySelector('.settings-tab.active')?.dataset.settingsTab,
    activeTabs: [...document.querySelectorAll('.settings-tab.active')].map((tab) => tab.dataset.settingsTab),
    visiblePanels: [...document.querySelectorAll('.settings-panel')]
      .filter((panel) => !panel.hidden && getComputedStyle(panel).display !== 'none')
      .map((panel) => panel.dataset.settingsPanel),
    shortcutsLabel: document.querySelector('[data-settings-tab="shortcuts"]')?.textContent.trim(),
    density: document.body.dataset.interfaceDensity,
    savedDensity: savedProfile.appearance?.density,
    densitySelected: document.querySelector('[data-density-choice="compact"]')?.classList.contains('selected'),
    compactChannelHeight: Math.round(compactChannelHeight),
    footerCard: Boolean(footer),
    footerActions: footer?.querySelectorAll('.profile-footer-controls > span, .profile-footer-controls > button').length || 0,
    footerLabel: footer?.querySelector('.profile-footer-controls')?.dataset.quickActionsLabel,
    horizontalOverflow: dialog.scrollWidth > dialog.clientWidth
  });
})()`;

const responsiveEvaluationSource = `(() => {
  const dialog = document.querySelector('#settings-modal > section');
  const navigation = document.querySelector('#settings-tabs');
  const panels = document.querySelector('#settings-tab-panels');
  const dialogRect = dialog.getBoundingClientRect();
  const navigationRect = navigation.getBoundingClientRect();
  const panelsRect = panels.getBoundingClientRect();
  return JSON.stringify({
    viewportWidth: innerWidth,
    dialogFitsViewport: dialogRect.width <= innerWidth,
    navigationAboveContent: navigationRect.bottom <= panelsRect.top + 2,
    navigationDirection: getComputedStyle(navigation).flexDirection,
    dialogHorizontalOverflow: dialog.scrollWidth > dialog.clientWidth
  });
})()`;

http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
    if (!target) throw new Error('Janela do VoiceUP não encontrada.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++id;
      pending.set(requestId, { resolve, reject });
      socket.send(JSON.stringify({ id: requestId, method, params }));
    });

    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (!message.id || !pending.has(message.id)) return;
      const job = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message));
      else job.resolve(message.result);
    });

    socket.on('open', async () => {
      try {
        await call('Runtime.enable');
        await call('Page.enable');
        const evaluation = await call('Runtime.evaluate', { expression: evaluationSource, awaitPromise: true, returnByValue: true });
        if (evaluation.exceptionDetails) throw new Error(evaluation.exceptionDetails.text || 'Falha no renderer.');
        await call('Emulation.setDeviceMetricsOverride', { width: 680, height: 800, deviceScaleFactor: 1, mobile: false });
        const responsiveEvaluation = await call('Runtime.evaluate', { expression: responsiveEvaluationSource, returnByValue: true });
        if (responsiveEvaluation.exceptionDetails) throw new Error(responsiveEvaluation.exceptionDetails.text || 'Falha no teste responsivo.');
        await call('Emulation.clearDeviceMetricsOverride');
        await new Promise((resolve) => setTimeout(resolve, 500));
        const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
        console.log(evaluation.result.value);
        console.log(responsiveEvaluation.result.value);
        console.log(output);
        socket.close();
      } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
        socket.close();
      }
    });
  });
}).on('error', (error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
