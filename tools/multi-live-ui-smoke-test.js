/* Run with Electron. The hidden window uses an isolated profile and no real devices. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-multi-live-ui-'));
app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');

const rendererErrors = [];
let window;
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timeout = setTimeout(() => {
  console.error(`Multi-live UI timeout. Renderer errors: ${JSON.stringify(rendererErrors)}`);
  app.exit(1);
}, 45000);
timeout.unref();

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    width: 1500,
    height: 920,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: true,
      partition: 'multi-live-ui-test'
    }
  });
  window.webContents.setFrameRate(30);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') rendererErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '../public/index.html'));
  await runtimeReady;

  await evaluate(`
    document.querySelector('#welcome').classList.add('hidden');
    document.querySelector('#app').classList.remove('hidden');
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    document.body.classList.remove('beta-welcome-open', 'server-lobby-mode');
    document.body.classList.add('beta-hosted');
    document.body.dataset.motion = 'reduced';
    currentMode = 'hosted'; activeVoiceChannel = 'Geral'; myName = 'Ana'; myAvatar = ''; myColor = '#4fd6c7';
    hostedSocket = { id: 'multi-self', connected: true, on() {}, emit() {} };
    serverMembers.clear(); hostedPeers.clear();
    serverMembers.set('multi-self', { id: 'multi-self', name: 'Ana', color: '#4fd6c7', avatar: '', status: 'online', platform: 'windows', voiceChannel: 'Geral' });
    const peers = [
      { id: 'live-bruno', name: 'Bruno', color: '#f08a75', platform: 'linux' },
      { id: 'live-carla', name: 'Carla', color: '#8f75ef', platform: 'android' }
    ];
    for (const item of peers) {
      const participant = { ...item, avatar: '', connected: true, left: false, speaking: false, pc: { connectionState: 'connected' }, videoExpectedKinds: { camera: false, screen: true }, mediaViewKinds: { camera: true, screen: true }, videoStreams: {}, liveVolume: 100, volume: 100 };
      hostedPeers.set(item.id, participant);
      serverMembers.set(item.id, { ...item, avatar: '', status: 'online', voiceChannel: 'Geral' });
    }
    document.querySelector('#video-frame').classList.add('hidden');
    document.querySelector('#identity-stage').classList.remove('hidden');
    document.querySelector('#pair-panel').classList.add('hidden');
    document.querySelector('.room-name span:last-child').textContent = 'Sala de teste';
    document.querySelector('.content header h2').textContent = 'Sala de teste';
    renderCentralCallMembers();
  `);
  await pause(500);
  const participantGrid = await evaluate(`(() => {
    const list = document.querySelector('#call-members');
    const cards = [...list.querySelectorAll('.call-member')];
    const visual = cards[0]?.querySelector('.call-member-visual');
    const avatar = visual?.querySelector('.avatar')?.getBoundingClientRect();
    const badgeElement = visual?.querySelector('.platform-presence');
    const badge = badgeElement?.getBoundingClientRect();
    return {
      count: cards.length,
      gridSize: list.dataset.gridSize,
      memberCount: list.dataset.memberCount,
      captions: cards.map((card) => card.querySelector('.call-member-caption strong')?.textContent || ''),
      tileSize: Math.round(cards[0]?.getBoundingClientRect().width || 0),
      square: cards.every((card) => { const box = card.getBoundingClientRect(); return Math.abs(box.width - box.height) <= 2 && box.height >= 150; }),
      platformBadge: { wrapperWidth: visual?.getBoundingClientRect().width || 0, avatarWidth: avatar?.width || 0, rightGap: (badge?.right || 0) - (avatar?.right || 0), bottomGap: (badge?.bottom || 0) - (avatar?.bottom || 0), padding: parseFloat(getComputedStyle(badgeElement).paddingLeft) }
    };
  })()`);
  assert.deepEqual(participantGrid.captions, ['Ana (você)', 'Bruno', 'Carla']);
  assert.equal(participantGrid.count, 3);
  assert.equal(participantGrid.gridSize, 'balanced');
  assert.equal(participantGrid.memberCount, '3');
  assert.ok(participantGrid.square, `Participant cards must remain square: ${JSON.stringify(participantGrid)}`);
  assert.ok(Math.abs(participantGrid.platformBadge.wrapperWidth - participantGrid.platformBadge.avatarWidth) <= 1, `Badge anchor must match the avatar: ${JSON.stringify(participantGrid.platformBadge)}`);
  assert.ok(participantGrid.platformBadge.rightGap >= 1 && participantGrid.platformBadge.rightGap <= 3 && participantGrid.platformBadge.bottomGap >= 1 && participantGrid.platformBadge.bottomGap <= 3, `Platform badge must stay on the avatar corner: ${JSON.stringify(participantGrid.platformBadge)}`);
  assert.equal(participantGrid.platformBadge.padding, 1, 'The platform badge must use only 1 px around its icon.');
  await evaluate(`
    for (const item of [
      { id: 'extra-davi', name: 'Davi', color: '#d89052' },
      { id: 'extra-elisa', name: 'Elisa', color: '#62a3e8' },
      { id: 'extra-fabio', name: 'Fábio', color: '#7ebf74' },
      { id: 'extra-gabi', name: 'Gabi', color: '#df718e' },
      { id: 'extra-hugo', name: 'Hugo', color: '#a775dc' },
      { id: 'extra-iris', name: 'Íris', color: '#65b4a4' }
    ]) {
      hostedPeers.set(item.id, { ...item, avatar: '', connected: true, left: false, speaking: false, videoExpectedKinds: {}, mediaViewKinds: { camera: true, screen: false } });
      serverMembers.set(item.id, { ...item, avatar: '', status: 'online', voiceChannel: 'Geral' });
    }
    renderCentralCallMembers();
  `);
  await pause(120);
  const expandedGrid = await evaluate(`(() => {
    const cards = [...document.querySelectorAll('#call-members .call-member')];
    return {
      count: cards.length,
      tileSize: Math.round(cards[0]?.getBoundingClientRect().width || 0),
      square: cards.every((card) => { const box = card.getBoundingClientRect(); return Math.abs(box.width - box.height) <= 2; })
    };
  })()`);
  assert.equal(expandedGrid.count, 9);
  assert.equal(expandedGrid.square, true);
  assert.ok(expandedGrid.tileSize < participantGrid.tileSize, `More participants must reduce square size: ${JSON.stringify({ participantGrid, expandedGrid })}`);
  await evaluate(`
    for (const id of ['extra-davi', 'extra-elisa', 'extra-fabio', 'extra-gabi', 'extra-hugo', 'extra-iris']) { hostedPeers.delete(id); serverMembers.delete(id); }
    renderCentralCallMembers();
  `);
  await pause(120);
  await evaluate(`document.querySelector('#release-notes-close')?.click(); document.querySelector('#release-notes-modal')?.classList.add('hidden');`);
  await pause(100);
  fs.writeFileSync(path.join(__dirname, 'call-grid-beta5.png'), (await window.webContents.capturePage()).toPNG());

  await evaluate(`
    const makeStream = (color) => {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ffffff'; context.font = 'bold 54px sans-serif'; context.fillText('VoiceUP LIVE', 280, 285);
      const stream = canvas.captureStream(12); stream._voiceupTestCanvas = canvas; return stream;
    };
    const first = hostedPeers.get('live-bruno'); const second = hostedPeers.get('live-carla');
    first.videoStreams.screen = makeStream('#28506d'); second.videoStreams.screen = makeStream('#523d78');
    showHostedVideo(first, 'Tela compartilhada', 'screen');
    showHostedVideo(second, 'Tela compartilhada', 'screen');
  `);
  await pause(1900);
  const liveGrid = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('#video-gallery .video-tile:not(.hidden)')];
    const boxes = tiles.map((tile) => tile.getBoundingClientRect());
    return {
      count: tiles.length,
      labels: tiles.map((tile) => tile.querySelector('.video-tile-label')?.textContent || ''),
      fullscreenButtons: tiles.filter((tile) => tile.querySelector('[data-media-tile-fullscreen]')).length,
      sideBySide: boxes.length === 2 && Math.abs(boxes[0].top - boxes[1].top) < 3 && boxes[1].left > boxes[0].right
    };
  })()`);
  assert.equal(liveGrid.count, 2);
  assert.equal(liveGrid.fullscreenButtons, 2);
  assert.ok(liveGrid.labels.every((label) => label.includes('Tela compartilhada')));
  assert.ok(liveGrid.sideBySide, `Two lives must share the stage: ${JSON.stringify(liveGrid)}`);
  const liveParticipantTray = await evaluate(`(() => {
    const tray = document.querySelector('#call-participant-tray');
    const list = document.querySelector('#call-members');
    const cards = [...list.querySelectorAll('.call-member')];
    return {
      visible: !tray.hidden,
      parent: list.parentElement?.id || '',
      count: document.querySelector('#call-participant-tray-count')?.textContent || '',
      expanded: document.querySelector('#call-participant-tray-toggle')?.getAttribute('aria-expanded'),
      square: cards.every((card) => { const box = card.getBoundingClientRect(); return Math.abs(box.width - box.height) <= 2; }),
      badgeCorners: cards.every((card) => { const visual = card.querySelector('.call-member-visual'); const avatar = visual.querySelector('.avatar').getBoundingClientRect(); const badge = visual.querySelector('.platform-presence').getBoundingClientRect(); return badge.right > avatar.right && badge.bottom > avatar.bottom && parseFloat(getComputedStyle(visual.querySelector('.platform-presence')).paddingLeft) === 1; })
    };
  })()`);
  assert.deepEqual(liveParticipantTray, { visible: true, parent: 'call-participant-tray-viewport', count: '3', expanded: 'true', square: true, badgeCorners: true });
  await evaluate(`document.querySelector('#call-participant-tray-toggle').click()`);
  const collapsedTray = await evaluate(`(() => ({
    collapsed: document.querySelector('#call-participant-tray').classList.contains('collapsed'),
    expanded: document.querySelector('#call-participant-tray-toggle').getAttribute('aria-expanded'),
    viewportDisplay: getComputedStyle(document.querySelector('#call-participant-tray-viewport')).display
  }))()`);
  assert.deepEqual(collapsedTray, { collapsed: true, expanded: 'false', viewportDisplay: 'none' });
  await evaluate(`document.querySelector('#call-participant-tray-toggle').click()`);
  await evaluate(`document.querySelector('#release-notes-modal')?.classList.add('hidden');`);
  fs.writeFileSync(path.join(__dirname, 'multi-live-grid-beta15.png'), (await window.webContents.capturePage()).toPNG());

  await evaluate(`document.querySelectorAll('#video-gallery [data-media-tile-fullscreen]')[1].click();`);
  await pause(250);
  const focused = await evaluate(`(() => {
    const tiles = [...document.querySelectorAll('#video-gallery .video-tile:not(.hidden)')];
    return {
      theater: document.body.classList.contains('video-theater'),
      single: document.body.classList.contains('video-theater-single'),
      focused: document.querySelector('#video-gallery .theater-focused')?.dataset.mediaOwner || '',
      displays: tiles.map((tile) => getComputedStyle(tile).display),
      stopLabel: document.querySelector('.theater-stop-share span')?.textContent || '',
      participantTray: !document.querySelector('#call-participant-tray').hidden && getComputedStyle(document.querySelector('#call-participant-tray')).position === 'fixed'
    };
  })()`);
  assert.equal(focused.theater, true);
  assert.equal(focused.single, true);
  assert.equal(focused.focused, 'live-carla');
  assert.deepEqual(focused.displays, ['none', 'flex']);
  assert.equal(focused.stopLabel, 'Sair da live');
  assert.equal(focused.participantTray, true);

  await evaluate(`document.querySelector('.theater-exit').click();`);
  await pause(250);
  const restored = await evaluate(`(() => ({
    theater: document.body.classList.contains('video-theater'),
    single: document.body.classList.contains('video-theater-single'),
    focused: document.querySelectorAll('#video-gallery .theater-focused').length,
    visible: [...document.querySelectorAll('#video-gallery .video-tile:not(.hidden)')].filter((tile) => getComputedStyle(tile).display !== 'none').length
  }))()`);
  assert.deepEqual(restored, { theater: false, single: false, focused: 0, visible: 2 });
  assert.deepEqual(rendererErrors, [], 'The Client must render the multi-live grid without uncaught errors.');
  console.log('PASS multi-live UI: adaptive square participants, collapsible live tray, two simultaneous lives and individual fullscreen.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  clearTimeout(timeout);
  window?.destroy();
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-multi-live-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron can retain a cache file briefly. */ }
  }
  app.exit(process.exitCode || 0);
});
