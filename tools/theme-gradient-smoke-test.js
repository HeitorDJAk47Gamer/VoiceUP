/* Run with Electron. Validates every new gradient theme without real devices. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const darkGradientIds = ['nebula', 'arctic', 'eclipse', 'matrix', 'noir', 'inferno', 'abyss', 'galaxy', 'copper', 'toxic', 'borealis', 'sapphire', 'plum', 'storm'];
const lightGradientIds = ['dawn', 'glacier', 'lavender', 'mint', 'solar'];
const gradientIds = [...darkGradientIds, ...lightGradientIds];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-theme-gradient-'));
const rendererErrors = [];
let window;

app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');

const timeout = setTimeout(() => {
  console.error(`Gradient theme timeout. Renderer errors: ${JSON.stringify(rendererErrors)}`);
  app.exit(1);
}, 45000);
timeout.unref();

function hexToRgb(hex) {
  const normalized = String(hex).trim().replace('#', '');
  assert.match(normalized, /^[0-9a-f]{6}$/i, `Invalid theme color: ${hex}`);
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const channels = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrast(first, second) {
  const [bright, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    width: 1120,
    height: 820,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
      partition: 'theme-gradient-smoke-test'
    }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') rendererErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  await runtimeReady;

  const inventory = await window.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('[data-theme-sample]')];
    return {
      total: cards.length,
      ids: cards.map((card) => card.dataset.themeSample),
      gradients: cards.filter((card) => card.classList.contains('gradient')).map((card) => card.dataset.themeSample),
      gradientLights: cards.filter((card) => card.classList.contains('gradient') && card.classList.contains('light')).map((card) => card.dataset.themeSample),
      solidCategory: [...document.querySelectorAll('[data-theme-category="solid"] [data-theme-sample]')].map((card) => card.dataset.themeSample),
      gradientCategory: [...document.querySelectorAll('[data-theme-category="gradient"] [data-theme-sample]')].map((card) => card.dataset.themeSample),
      categoryHeadings: [...document.querySelectorAll('.theme-samples-category-heading strong')].map((item) => item.textContent.trim()),
      supportLabel: document.querySelector('[data-settings-tab="support"]')?.textContent || ''
    };
  })()`);
  assert.equal(inventory.total, 38, 'The picker must keep 19 solid themes and offer 19 gradient themes.');
  assert.deepEqual(inventory.gradients, gradientIds, 'All and only the new themes must use gradient previews.');
  assert.deepEqual(inventory.gradientLights, lightGradientIds, 'Exactly five new gradient themes must be light.');
  assert.equal(inventory.solidCategory.length, 19, 'Solid colors must have their own subcategory.');
  assert.deepEqual(inventory.gradientCategory, gradientIds, 'Gradients must have their own subcategory.');
  assert.deepEqual(inventory.categoryHeadings, ['Cores sólidas', 'Gradientes'], 'The two visible theme subcategories must be named clearly.');
  assert.deepEqual(gradientIds.filter((id) => inventory.ids.includes(id)), gradientIds, 'Every new gradient theme must be selectable.');
  assert.equal(inventory.supportLabel, 'Suporte', 'The Support tab must remain translated while opening the theme picker.');

  for (const id of gradientIds) {
    const state = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-theme-sample="${id}"]').click();
      const style = getComputedStyle(document.body);
      return {
        active: document.body.classList.contains('theme-${id}'),
        activeThemeClasses: [...document.body.classList].filter((name) => name.startsWith('theme-')),
        selected: document.querySelector('[data-theme-sample="${id}"]').classList.contains('selected'),
        main: getComputedStyle(document.querySelector('.content')).backgroundImage,
        sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundImage,
        panel: getComputedStyle(document.querySelector('#right-panel')).backgroundImage,
        ink: style.getPropertyValue('--ink').trim(),
        base: style.getPropertyValue('--night2').trim()
      };
    })()`);
    assert.equal(state.active, true, `${id} must add its body class.`);
    assert.deepEqual(state.activeThemeClasses, [`theme-${id}`], `${id} must replace the previous theme instead of stacking classes.`);
    assert.equal(state.selected, true, `${id} must become selected in the visible picker.`);
    assert.match(state.main, /gradient/i, `${id} must paint a gradient in the central area.`);
    assert.match(state.sidebar, /gradient/i, `${id} must paint a gradient in the server/channel area.`);
    assert.match(state.panel, /gradient/i, `${id} must paint a gradient in the members/chat area.`);
    assert.ok(contrast(state.ink, state.base) >= 4.5, `${id} text contrast must meet WCAG AA.`);
  }

  const persistedTheme = await window.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-theme-sample="galaxy"]').click();
    saveProfile();
    return JSON.parse(localStorage.getItem('voiceup-profile-v1')).theme;
  })()`);
  assert.equal(persistedTheme, 'galaxy', 'A selected gradient theme must persist in the local profile.');

  await window.webContents.executeJavaScript(`(() => {
    document.querySelector('#settings-modal').classList.remove('hidden');
    document.querySelector('[data-settings-tab="appearance"]').click();
    document.querySelector('[data-theme-sample="borealis"]').click();
    document.querySelector('#theme-gradient-heading').scrollIntoView({ block: 'center' });
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 250));
  fs.writeFileSync(path.join(__dirname, 'themes-gradient-beta6.png'), (await window.webContents.capturePage()).toPNG());

  const scrolling = await window.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('#settings-tab-panels');
    dialog.scrollTop = dialog.scrollHeight;
    const last = document.querySelector('[data-theme-sample="solar"]');
    const dialogBox = dialog.getBoundingClientRect();
    const lastBox = last.getBoundingClientRect();
    return {
      overflow: getComputedStyle(dialog).overflowY,
      canScroll: dialog.scrollHeight > dialog.clientHeight,
      lastVisible: lastBox.bottom <= dialogBox.bottom + 2 && lastBox.top >= dialogBox.top - 2
    };
  })()`);
  assert.equal(scrolling.overflow, 'auto');
  assert.equal(scrolling.canScroll, true, 'The expanded theme catalog must keep Settings scrollable.');
  assert.equal(scrolling.lastVisible, true, 'The last light gradient must be reachable by scrolling.');
  assert.deepEqual(rendererErrors, [], 'The gradient catalog must render without uncaught errors.');
  console.log('PASS themes: 14 dark gradients, 5 light gradients, solid/gradient subcategories, previews, contrast and scrolling.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(timeout);
  window?.destroy();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-theme-gradient-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron can retain cache files briefly. */ }
  }
  app.exit(process.exitCode || 0);
});
