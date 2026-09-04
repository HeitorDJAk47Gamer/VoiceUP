const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '.verify-media-userdata'));

async function runMediaTransportTest() {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const makeCanvasTrack = (width, height, fps, seed) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    let frame = 0;
    const paint = () => {
      const hue = (seed + frame * 11) % 360;
      context.fillStyle = `hsl(${hue} 82% 38%)`;
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#fff';
      context.font = `${Math.max(18, Math.round(height / 8))}px sans-serif`;
      context.fillText(String(frame++), 18, Math.max(34, Math.round(height / 3)));
    };
    paint();
    const timer = setInterval(paint, Math.max(20, Math.round(1000 / fps)));
    const stream = canvas.captureStream(fps);
    return { canvas, stream, track: stream.getVideoTracks()[0], timer };
  };
  const readReceiver = async (receiver) => {
    const reports = await receiver.getStats();
    let latest = { framesDecoded: 0, bytesReceived: 0, frameWidth: 0, frameHeight: 0 };
    reports.forEach((report) => {
      // receiver.getStats() is already scoped to this receiver. Chromium has
      // shipped reports both with and without kind/mediaType, so filtering by
      // those optional fields can hide a perfectly valid inbound video flow.
      if (report.type !== 'inbound-rtp') return;
      latest = {
        framesDecoded: Number(report.framesDecoded || 0),
        bytesReceived: Number(report.bytesReceived || 0),
        frameWidth: Number(report.frameWidth || 0),
        frameHeight: Number(report.frameHeight || 0)
      };
    });
    return latest;
  };
  const inspectPeer = async (pc) => {
    const stats = await pc.getStats();
    const media = [];
    stats.forEach((report) => {
      if (!['inbound-rtp', 'outbound-rtp', 'media-source', 'codec'].includes(report.type)) return;
      media.push({
        type: report.type,
        kind: report.kind || report.mediaType || '',
        bytesReceived: Number(report.bytesReceived || 0),
        bytesSent: Number(report.bytesSent || 0),
        framesDecoded: Number(report.framesDecoded || 0),
        framesEncoded: Number(report.framesEncoded || 0),
        frames: Number(report.frames || 0)
      });
    });
    return {
      state: pc.connectionState,
      transceivers: pc.getTransceivers().map((item) => ({ mid: item.mid, direction: item.direction, currentDirection: item.currentDirection, sender: item.sender.track?.readyState, receiver: item.receiver.track?.readyState, receiverMuted: item.receiver.track?.muted })),
      media
    };
  };
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  const receivedVideos = { a: [], b: [] };
  const consumeTrack = (owner) => ({ track }) => {
    if (track.kind !== 'video') return;
    const video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = new MediaStream([track]);
    document.body.append(video);
    receivedVideos[owner].push(video);
    void video.play().catch(() => {});
  };
  a.ontrack = consumeTrack('a');
  b.ontrack = consumeTrack('b');
  const resources = [];
  const placeholder = (seed) => {
    const item = makeCanvasTrack(640, 360, 1, seed);
    resources.push(item); return item.track;
  };
  const aCamera = a.addTransceiver(placeholder(10), { direction: 'sendrecv' });
  const aScreen = a.addTransceiver(placeholder(20), { direction: 'sendrecv' });
  let bCamera; let bScreen;
  const pendingForA = []; const pendingForB = [];
  a.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    if (b.remoteDescription) void b.addIceCandidate(candidate); else pendingForB.push(candidate);
  };
  b.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    if (a.remoteDescription) void a.addIceCandidate(candidate); else pendingForA.push(candidate);
  };
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  [bCamera, bScreen] = b.getTransceivers().filter((item) => item.receiver.track.kind === 'video');
  bCamera.direction = 'sendrecv'; bScreen.direction = 'sendrecv';
  await Promise.all([bCamera.sender.replaceTrack(placeholder(30)), bScreen.sender.replaceTrack(placeholder(40))]);
  await Promise.all(pendingForB.splice(0).map((candidate) => b.addIceCandidate(candidate)));
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  await Promise.all(pendingForA.splice(0).map((candidate) => a.addIceCandidate(candidate)));
  const connectedAt = Date.now() + 8000;
  while (Date.now() < connectedAt && ![a.connectionState, b.connectionState].every((state) => state === 'connected')) await wait(50);
  if (a.connectionState !== 'connected' || b.connectionState !== 'connected') throw new Error(`Pares não conectaram: ${a.connectionState}/${b.connectionState}`);
  await wait(1200);
  const before = {
    aCamera: await readReceiver(aCamera.receiver), aScreen: await readReceiver(aScreen.receiver),
    bCamera: await readReceiver(bCamera.receiver), bScreen: await readReceiver(bScreen.receiver)
  };
  const real = {
    aCamera: makeCanvasTrack(320, 180, 15, 80), aScreen: makeCanvasTrack(800, 450, 15, 120),
    bCamera: makeCanvasTrack(320, 180, 15, 180), bScreen: makeCanvasTrack(800, 450, 15, 240)
  };
  resources.push(...Object.values(real));
  await Promise.all([
    aCamera.sender.replaceTrack(real.aCamera.track), aScreen.sender.replaceTrack(real.aScreen.track),
    bCamera.sender.replaceTrack(real.bCamera.track), bScreen.sender.replaceTrack(real.bScreen.track)
  ]);
  const presentation = {
    aCamera: { video: receivedVideos.a[0], firstRealMs: null, revertedToPlaceholder: false },
    aScreen: { video: receivedVideos.a[1], firstRealMs: null, revertedToPlaceholder: false },
    bCamera: { video: receivedVideos.b[0], firstRealMs: null, revertedToPlaceholder: false },
    bScreen: { video: receivedVideos.b[1], firstRealMs: null, revertedToPlaceholder: false }
  };
  const pixelCanvas = document.createElement('canvas'); pixelCanvas.width = 1; pixelCanvas.height = 1;
  const pixelContext = pixelCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const hasRealFrame = (video) => {
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return null;
    try {
      pixelContext.drawImage(video, Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2), 1, 1, 0, 0, 1, 1);
      const [red, green, blue] = pixelContext.getImageData(0, 0, 1, 1).data;
      return Math.max(red, green, blue) > 35;
    } catch { return null; }
  };
  const transitionStartedAt = performance.now();
  while (performance.now() - transitionStartedAt < 1500) {
    for (const state of Object.values(presentation)) {
      const realFrame = hasRealFrame(state.video);
      if (realFrame === true && state.firstRealMs === null) state.firstRealMs = Math.round(performance.now() - transitionStartedAt);
      if (realFrame === false && state.firstRealMs !== null) state.revertedToPlaceholder = true;
    }
    await wait(25);
  }
  await wait(2200);
  const after = {
    aCamera: await readReceiver(aCamera.receiver), aScreen: await readReceiver(aScreen.receiver),
    bCamera: await readReceiver(bCamera.receiver), bScreen: await readReceiver(bScreen.receiver)
  };
  const deltas = Object.fromEntries(Object.keys(after).map((key) => [key, after[key].framesDecoded - before[key].framesDecoded]));
  const failures = Object.entries(deltas).filter(([, frames]) => frames < 8).map(([key, frames]) => `${key}: ${frames} quadros`);
  // A hidden software-encoded Electron window may downscale aggressively.
  // The screen slot must remain nonzero and distinct from the camera slot.
  const screenSizesOk = after.aScreen.frameWidth > after.aCamera.frameWidth && after.bScreen.frameWidth > after.bCamera.frameWidth;
  const cameraSizesOk = after.aCamera.frameWidth >= 300 && after.bCamera.frameWidth >= 300;
  const transitionFailures = Object.entries(presentation)
    .filter(([, state]) => state.firstRealMs === null || state.revertedToPlaceholder)
    .map(([key, state]) => `${key}: primeiro=${state.firstRealMs}, retorno=${state.revertedToPlaceholder}`);
  if (failures.length || !screenSizesOk || !cameraSizesOk || transitionFailures.length) {
    const diagnostics = { a: await inspectPeer(a), b: await inspectPeer(b) };
    resources.forEach((item) => { clearInterval(item.timer); item.track.stop(); });
    a.close(); b.close();
    throw new Error(`Fluxo incompleto: ${[...failures, ...transitionFailures].join(', ')}; tamanhos=${JSON.stringify(after)}; diagnostico=${JSON.stringify(diagnostics)}`);
  }
  resources.forEach((item) => { clearInterval(item.timer); item.track.stop(); });
  a.close(); b.close();
  return { ok: true, deltas, firstRealMs: Object.fromEntries(Object.entries(presentation).map(([key, state]) => [key, state.firstRealMs])), after };
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  try {
    const result = await window.webContents.executeJavaScript(`(${runMediaTransportTest.toString()})()`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
