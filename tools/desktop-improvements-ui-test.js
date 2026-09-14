'use strict';
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-desktop-ui-'));
app.setPath('userData', scratch); app.disableHardwareAcceleration();
const timeout = setTimeout(() => { console.error('UI timeout'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1300, height: 900, webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const errors = [];
  win.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_, callback) => callback({ cancel: true }));
  win.webContents.debugger.attach('1.3');
  win.webContents.debugger.on('message', (_, method, params) => { if (method === 'Runtime.exceptionThrown') errors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text); });
  const runtimeReady = win.webContents.debugger.sendCommand('Runtime.enable');
  console.log('Loading renderer');
  await win.loadFile(path.join(__dirname, '../public/index.html'));
  await runtimeReady;
  console.log('Renderer loaded', errors);
  const result = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    document.querySelector('#settings-modal').classList.remove('hidden');
    document.querySelector('[data-settings-tab="accessibility"]').click();
    const text = document.querySelector('[data-accessibility="text"]'); text.click();
    const contrast = document.querySelector('[data-accessibility="contrast"]'); contrast.click();
    const source = { getSettings: () => ({ height: 1080, width: 1920, frameRate: 60 }), readyState: 'live', kind: 'video' };
    screenStream = { getVideoTracks: () => [source] };
    $('quality-select').value = '1080'; $('fps-select').value = '60'; preserveScreenSourceQuality = false;
    const makeSender = () => ({ track: source, result: null, getParameters() { return { encodings: [{}] }; }, async setParameters(value) { this.result = value; } });
    const first = { screenSender: makeSender(), channel: { readyState: 'open', send() {} } };
    const second = { screenSender: makeSender(), channel: { readyState: 'open', send() {} } };
    await voiceupViewerControls.receiveQuality(first, JSON.stringify({type:'viewer-quality',value:'360',request:1}));
    await tuneVideoSender(second.screenSender, 'screen');
    const before = JSON.stringify(first.screenSender.result);
    await voiceupViewerControls.receiveQuality(first, JSON.stringify({type:'viewer-quality',value:'bad',request:2}));
    return {
      first: first.screenSender.result.encodings[0], second: second.screenSender.result.encodings[0],
      unchanged: before === JSON.stringify(first.screenSender.result),
      sameTrack: first.screenSender.track === second.screenSender.track,
      enlarged: document.body.classList.contains('accessible-text'), contrast: document.body.classList.contains('accessible-contrast'),
      saved: JSON.parse(localStorage.getItem('voiceup-accessibility-v1')).text,
      selected: document.querySelector('[data-settings-tab="accessibility"]').getAttribute('aria-selected'),
      shortcuts: document.querySelectorAll('[data-global-shortcut]').length
    };
  })()`);
  console.log('Assertions', result);
  assert.equal(result.first.scaleResolutionDownBy, 3);
  assert.equal(result.second.scaleResolutionDownBy, 1);
  assert.equal(result.first.maxFramerate, 30);
  assert.equal(result.second.maxFramerate, 60);
  assert.ok(result.unchanged && result.sameTrack && result.enlarged && result.saved && result.contrast);
  assert.equal(result.selected, 'true'); assert.equal(result.shortcuts, 6);
  const rtc = await win.webContents.executeJavaScript(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d'); let frame = 0;
    const draw = setInterval(() => { ctx.fillStyle = '#17384a'; ctx.fillRect(0, 0, 1280, 720); ctx.fillStyle = '#4edcba'; ctx.fillRect((frame++ * 20) % 1200, 100, 80, 80); }, 33);
    const stream = canvas.captureStream(30), track = stream.getVideoTracks()[0];
    screenStream = stream; $('quality-select').value = '720'; $('fps-select').value = '30';
    const pairs = [];
    try {
      for (const choice of ['360', 'auto']) {
        const tx = new RTCPeerConnection({iceServers:[]}), rx = new RTCPeerConnection({iceServers:[]});
        const pair = { tx, rx, candidates: [], reverse: [] }; pairs.push(pair);
        tx.onicecandidate = ({candidate}) => { if (candidate) { if (rx.remoteDescription) rx.addIceCandidate(candidate).catch(() => {}); else pair.candidates.push(candidate); } };
        rx.onicecandidate = ({candidate}) => { if (candidate) { if (tx.remoteDescription) tx.addIceCandidate(candidate).catch(() => {}); else pair.reverse.push(candidate); } };
        rx.ontrack = ({streams}) => { const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.srcObject = streams[0]; document.body.append(video); pair.video = video; video.play().catch(() => {}); };
        const sender = tx.addTrack(track, stream);
        pair.sender = sender;
        await tx.setLocalDescription(await tx.createOffer()); await rx.setRemoteDescription(tx.localDescription);
        for (const candidate of pair.candidates) await rx.addIceCandidate(candidate);
        await rx.setLocalDescription(await rx.createAnswer()); await tx.setRemoteDescription(rx.localDescription);
        for (const candidate of pair.reverse) await tx.addIceCandidate(candidate);
        voiceupViewerQuality.senders.set(sender, choice); await tuneVideoSender(sender, 'screen');
      }
      await new Promise(resolve => setTimeout(resolve, 6500));
      const received = [];
      for (const pair of pairs) { let report; (await pair.rx.getStats()).forEach(r => { if (r.type === 'inbound-rtp' && r.kind === 'video') report = { height: r.frameHeight, frames: r.framesDecoded, scale: pair.sender.getParameters().encodings[0].scaleResolutionDownBy }; }); received.push(report); }
      return { received, sourceHeight: track.getSettings().height };
    } finally { clearInterval(draw); pairs.forEach(({tx,rx,video}) => {tx.close();rx.close();video?.remove();}); track.stop(); screenStream = null; }
  })()`);
  assert.ok(rtc.received[0]?.frames > 0 && rtc.received[1]?.frames > 0, JSON.stringify(rtc));
  // These are ceilings, not forced resolutions: CPU/network adaptation is
  // intentionally enabled and may reduce either receiver further.
  assert.ok(rtc.received[0].height <= 360 && rtc.received[1].height <= 720, JSON.stringify(rtc));
  assert.equal(rtc.received[0].scale, 2); assert.equal(rtc.received[1].scale, 1);
  assert.equal(rtc.sourceHeight, 720);
  console.log('PASS actual WebRTC receiver sizes', rtc);
  assert.deepEqual(errors, []);
  console.log('PASS renderer: two viewers, sender ceiling, accessibility settings, persisted preferences, tabs and shortcuts');
  clearTimeout(timeout); win.destroy(); app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
