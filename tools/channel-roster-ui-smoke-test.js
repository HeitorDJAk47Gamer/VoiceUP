/* Run with Electron. All windows are hidden and use an isolated test profile. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-roster-ui-'));
app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
const errors = [];
let stage = 'startup';
const mark = (value) => { stage = value; console.log(`UI test: ${value}`); };
setTimeout(() => { console.error(`UI test timeout at ${stage}. Errors: ${JSON.stringify(errors)}`); app.exit(1); }, 45000).unref();
let window;
const evaluate = (code) => window.webContents.executeJavaScript(code);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  mark('creating hidden window');
  window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, partition: 'roster-ui-test' } });
  window.webContents.setFrameRate(30);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  mark('loading client');
  await window.loadFile(path.join(__dirname, '../public/index.html'));
  await runtimeReady;
  mark('rendering test members');
  await evaluate(`
    document.querySelector('#welcome').classList.add('hidden');
    document.querySelector('#app').classList.remove('hidden');
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    document.body.classList.remove('beta-welcome-open');
    document.body.dataset.motion = 'reduced';
    currentMode = 'hosted'; activeVoiceChannel = 'Geral'; myName = 'Heitor';
    window.rosterTestPackets = [];
    hostedSocket = { id: 'roster-self', connected: true, on() {}, emit(event, payload) { window.rosterTestPackets.push({ event, payload }); } };
    const testNames = ['Zoe', 'Álvaro', 'Ana', 'Heitor', 'Bruno', 'Beatriz', 'Carlos', 'Davi', 'Eduardo', '<img src=x onerror=alert(1)>'];
    serverMembers.clear();
    testNames.forEach((name, index) => serverMembers.set(index === 3 ? hostedSocket.id : 'roster-' + index, {
      id: index === 3 ? hostedSocket.id : 'roster-' + index, name, color: AVATAR_COLORS[index % AVATAR_COLORS.length], status: 'online',
      voiceChannel: index < 8 ? 'Geral' : 'Jogando', voiceupAudioState: { micMuted: index % 2 === 0, outputMuted: index % 3 === 0 }
    }));
    rememberCurrentMember();
    syncVoiceChannelActivity([...serverMembers.values()], { serverTime: 5000000, voiceActivity: [{ voiceChannel: 'Geral', startedAt: 451000 }, { voiceChannel: 'Jogando', startedAt: 4950000 }] });
    setCallMode('hosted'); applyTheme('forest');
  `);
  await pause(900);
  await evaluate(`document.querySelector('#release-notes-close')?.click();`);
  mark('checking member layout');
  assert.deepEqual(errors, [], 'Client startup must finish without renderer errors.');
  let result = await evaluate(`(() => {
    const panel = document.querySelector('#room-channels');
    const group = panel.querySelector('[data-voice-channel="Geral"]').closest('.voice-channel-group');
    const rows = [...group.querySelectorAll('.channel-member')];
    const positions = rows.map((row) => row.getBoundingClientRect());
    const duration = group.querySelector('time');
    return {
      names: rows.map((row) => row.querySelector('.channel-member-name').textContent),
      vertical: positions.every((box, i) => !i || box.top >= positions[i - 1].bottom),
      besideNick: rows.every((row) => !row.querySelector('.voiceup-mute-badges') || row.querySelector('.voiceup-mute-badges').parentElement.matches('.channel-member-mute-slot')),
      maxBadges: Math.max(...rows.map((row) => row.querySelectorAll('.voiceup-mute-badge').length)),
      escaped: !panel.querySelector('.channel-member-name img'),
      limit: group.querySelector('.channel-call-limit').textContent,
      timer: duration.textContent, color: getComputedStyle(duration).color,
      emptyTimer: panel.querySelector('[data-voice-channel="Ausente"]').closest('.voice-channel-group').querySelector('time') !== null
    };
  })()`);
  assert.deepEqual(result.names, ['Álvaro', 'Ana', 'Beatriz', 'Bruno', 'Carlos', 'Davi', 'Heitor', 'Zoe']);
  assert.ok(result.vertical && result.besideNick && result.escaped);
  assert.equal(result.maxBadges, 2);
  assert.equal(result.limit, '8/12');
  assert.match(result.timer, /^1:15:4[9]$|^1:15:5\d$/);
  assert.equal(result.emptyTimer, false);
  const stable = await evaluate(`(() => {
    const row = document.querySelector('#room-channels .channel-member');
    row.focus();
    for (let index = 0; index < 20; index++) renderRoomChannels();
    refreshVoiceChannelClocks();
    return { sameNode: row === document.querySelector('#room-channels .channel-member'), focused: document.activeElement === row, width: row.getBoundingClientRect().width };
  })()`);
  assert.ok(stable.sameNode && stable.focused && stable.width > 0, 'Presence refreshes must preserve visible rows/focus: ' + JSON.stringify(stable));
  mark('checking timer and mute updates');
  const timerBefore = await evaluate(`document.querySelector('#room-channels time').textContent`);
  await pause(2200);
  assert.notEqual(await evaluate(`document.querySelector('#room-channels time').textContent`), timerBefore, 'Clock must advance without rebuilding rows.');
  for (let index = 0; index < 6; index++) {
    await evaluate(`micEnabled = ${index % 2 === 0}; betaOutputMuted = ${index % 3 === 0}; renderRoomChannels();`);
    await pause(460);
    const counts = await evaluate(`(() => { const row = document.querySelector('#room-channels [data-member-id="roster-self"]'); return [row.querySelectorAll('.voiceup-mute-badges').length, row.querySelectorAll('.voiceup-mute-badge').length]; })()`);
    const expected = Number(index % 2 !== 0) + Number(index % 3 === 0);
    assert.deepEqual(counts, [expected ? 1 : 0, expected], 'Mute/unmute must never accumulate icons.');
  }
  const clicks = await evaluate(`(() => {
    const visited = []; switchVoiceChannel = (channel) => visited.push(channel);
    document.querySelector('#room-channels .channel-member').click();
    document.querySelector('#room-channels [data-voice-channel="Jogando"]').click();
    return visited;
  })()`);
  assert.deepEqual(clicks, ['Jogando'], 'Member clicks must not switch voice channels.');
  const liveControls = await evaluate(`(async () => {
    const member = serverMembers.get('roster-0');
    hostedPeers.set(member.id, { ...member, connected: true, left: false, pc: { connectionState: 'connected' }, videoExpectedKinds: { screen: true, camera: true }, mediaViewKinds: { screen: true, camera: false }, volume: 100 });
    renderRoomChannels();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const row = document.querySelector('#room-channels [data-member-id="roster-0"]');
    row.click();
    const result = {
      badges: [...row.querySelectorAll('[data-media-status]')].map((badge) => badge.dataset.mediaStatus),
      liveLabel: row.querySelector('[data-media-status="screen"]')?.textContent.trim(),
      liveDot: row.querySelectorAll('[data-media-status="screen"] .channel-live-dot').length,
      open: !document.querySelector('#participant-audio-popover').classList.contains('hidden'),
      name: document.querySelector('#participant-audio-name').textContent,
      watch: !document.querySelector('#participant-watch-live').classList.contains('hidden')
    };
    document.querySelector('#participant-audio-close').click();
    hostedPeers.delete(member.id); renderRoomChannels();
    return result;
  })()`);
  assert.deepEqual(liveControls, { badges: ['screen', 'camera'], liveLabel: 'Ao vivo', liveDot: 1, open: true, name: 'Zoe', watch: true }, 'The live dot/label and camera must remain while watching or hiding media, retaining live/audio controls.');
  mark('checking simultaneous live and camera indicators');
  for (const state of [{ screen: true, camera: false }, { screen: false, camera: true }, { screen: true, camera: true }, { screen: false, camera: false }, { screen: true, camera: true }]) {
    await evaluate(`serverMembers.get('roster-0').voiceupMediaState = ${JSON.stringify(state)}; serverMembers.get('roster-8').voiceupMediaState = ${JSON.stringify(state)}; renderRoomChannels();`);
    await pause(500);
    const rows = await evaluate(`['roster-0', 'roster-8'].map((id) => [...document.querySelectorAll('#room-channels [data-member-id="' + id + '"] [data-media-status]')].map((badge) => badge.dataset.mediaStatus));`);
    const expected = [state.screen ? 'screen' : '', state.camera ? 'camera' : ''].filter(Boolean);
    assert.deepEqual(rows, [expected, expected], 'Media indicators must update independently in the current and other channels, without duplicates.');
  }
  await evaluate(`
    const fakeVideo = () => { const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16; return canvas.captureStream(1); };
    screenStream = fakeVideo(); cameraStream = fakeVideo(); micEnabled = false; betaOutputMuted = true;
  `);
  await pause(500);
  assert.equal(await evaluate(`document.querySelectorAll('#room-channels [data-member-id="roster-self"] [data-media-status], #room-channels [data-member-id="roster-self"] .voiceup-mute-badge').length`), 4, 'Own camera, live and both mutes must fit on the same row.');
  await evaluate(`screenStream.getTracks().forEach((track) => track.stop());`);
  await pause(500);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#room-channels [data-member-id="roster-self"] [data-media-status]')].map((badge) => badge.dataset.mediaStatus)`), ['camera'], 'An ended local screen track must not leave a stale live indicator.');
  await evaluate(`cameraStream.getTracks().forEach((track) => track.stop()); cameraStream = null; screenStream = null;`);
  await pause(500);
  assert.equal(await evaluate(`document.querySelectorAll('#room-channels [data-member-id="roster-self"] [data-media-status]').length`), 0);
  const sentMedia = await evaluate(`window.rosterTestPackets.filter((packet) => packet.event === 'media-state-update').map((packet) => packet.payload)`);
  assert.ok(sentMedia.some((state) => state.screen && state.camera), 'Own live+camera state must be published to the host.');
  assert.deepEqual(sentMedia.at(-1), { screen: false, camera: false });
  const lightColor = await evaluate(`applyTheme('snow'); getComputedStyle(document.querySelector('#room-channels time')).color;`);
  assert.notEqual(lightColor, result.color, 'Timer must follow the selected theme.');
  mark('checking themes and responsive layout');
  await evaluate(`applyTheme('forest');`);
  await pause(120);
  fs.writeFileSync(path.join(__dirname, 'channel-roster-beta13.png'), (await window.webContents.capturePage()).toPNG());
  for (const [width, height] of [[1920, 1080], [960, 720], [820, 640]]) {
    window.setContentSize(width, height);
    await pause(200);
    result = await evaluate(`(() => {
      const panel = document.querySelector('#room-channels');
      const rows = [...panel.querySelectorAll('.channel-member')];
      panel.scrollTop = 10000;
      return {
        overflow: rows.some((row) => row.scrollWidth > row.clientWidth + 2),
        overflowingRows: rows.filter((row) => row.scrollWidth > row.clientWidth + 2).map((row) => ({ html: row.innerHTML, width: row.clientWidth, scrollWidth: row.scrollWidth })),
        headersOverflow: [...panel.querySelectorAll('.voice-channel')].some((row) => row.scrollWidth > row.clientWidth + 2),
        canScroll: panel.scrollHeight <= panel.clientHeight + 1 || panel.scrollTop > 0
      };
    })()`);
    assert.ok(!result.overflow && !result.headersOverflow && result.canScroll, `${width}x${height} layout: ${JSON.stringify(result)}`);
  }
  await evaluate(`document.body.dataset.interfaceDensity = 'compact';`);
  result = await evaluate(`(() => { const row = document.querySelector('#room-channels .channel-member'); return { height: row.getBoundingClientRect().height, overflow: row.scrollWidth > row.clientWidth + 2 }; })()`);
  assert.ok(result.height > 0 && result.height <= 34 && !result.overflow, 'Compact mode must preserve the member list.');
  assert.deepEqual(errors, [], 'The full Client must load without uncaught renderer errors.');
  console.log('PASS hidden desktop UI: alphabetical rows, mute/live/camera icons, independent statuses, stable refresh, timer, themes, clicks and responsive scrolling.');
}).catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => {
  window?.destroy();
  // Isolated temporary profile only; never touch a real Client profile.
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-roster-ui-')) {
    try { fs.rmSync(resolved, { recursive: true, force: true }); } catch { /* Electron may briefly retain a cache file. */ }
  }
  app.exit(process.exitCode || 0);
});
