const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

async function runGameStreamTest() {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  let sourceFrames = 0;
  const paint = () => {
    const frame = sourceFrames++;
    context.fillStyle = `hsl(${frame * 7 % 360} 72% 30%)`;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 18; index += 1) {
      const x = (frame * (13 + index) + index * 91) % (canvas.width + 180) - 90;
      const y = (index * 47 + frame * (3 + index % 4)) % canvas.height;
      context.fillStyle = `hsl(${(frame * 11 + index * 29) % 360} 90% 62%)`;
      context.fillRect(x, y, 84, 42);
    }
    context.fillStyle = '#fff';
    context.font = '700 44px sans-serif';
    context.fillText(`GAME ${frame}`, 38, 68);
  };
  paint();
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'motion';
  const timer = setInterval(() => { paint(); track.requestFrame(); }, Math.round(1000 / 60));

  const outbound = new RTCPeerConnection();
  const inbound = new RTCPeerConnection();
  const sender = outbound.addTransceiver(track, { direction: 'sendonly', streams: [stream] }).sender;
  let receiver = null;
  let video = null;
  inbound.ontrack = (event) => {
    receiver = event.receiver;
    video = document.createElement('video');
    video.autoplay = true; video.muted = true; video.playsInline = true;
    video.srcObject = event.streams[0] || new MediaStream([event.track]);
    document.body.append(video);
    void video.play().catch(() => {});
  };
  outbound.onicecandidate = ({ candidate }) => { if (candidate) void inbound.addIceCandidate(candidate); };
  inbound.onicecandidate = ({ candidate }) => { if (candidate) void outbound.addIceCandidate(candidate); };

  const readFrames = async (target, direction) => {
    const reports = await target.getStats();
    let frames = 0; let fps = 0; let limitation = '';
    reports.forEach((report) => {
      if (report.type !== `${direction}-rtp` || report.isRemote) return;
      if (report.kind && report.kind !== 'video') return;
      if (report.mediaType && report.mediaType !== 'video') return;
      frames = Math.max(frames, Number(direction === 'outbound' ? report.framesEncoded : report.framesDecoded) || 0);
      fps = Math.max(fps, Number(report.framesPerSecond) || 0);
      limitation ||= String(report.qualityLimitationReason || '');
    });
    return { frames, fps, limitation };
  };

  try {
    await outbound.setLocalDescription(await outbound.createOffer());
    await inbound.setRemoteDescription(outbound.localDescription);
    await inbound.setLocalDescription(await inbound.createAnswer());
    await outbound.setRemoteDescription(inbound.localDescription);
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline && (outbound.connectionState !== 'connected' || inbound.connectionState !== 'connected' || !receiver)) await wait(40);
    if (outbound.connectionState !== 'connected' || inbound.connectionState !== 'connected' || !receiver) throw new Error(`Pares não conectaram: ${outbound.connectionState}/${inbound.connectionState}`);

    const parameters = sender.getParameters();
    parameters.encodings ||= [{}];
    parameters.encodings[0].maxBitrate = 6080000;
    parameters.encodings[0].maxFramerate = 60;
    parameters.degradationPreference = 'maintain-framerate';
    await sender.setParameters(parameters);
    const applied = sender.getParameters();
    if (applied.degradationPreference !== 'maintain-framerate') throw new Error(`Preferência não aplicada: ${applied.degradationPreference || 'ausente'}`);

    await wait(1400);
    const startedAt = performance.now();
    const sourceBefore = sourceFrames;
    const sentBefore = await readFrames(sender, 'outbound');
    const receivedBefore = await readFrames(receiver, 'inbound');
    await wait(4000);
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    const sentAfter = await readFrames(sender, 'outbound');
    const receivedAfter = await readFrames(receiver, 'inbound');
    const sourceFps = (sourceFrames - sourceBefore) / elapsedSeconds;
    const encodedFps = (sentAfter.frames - sentBefore.frames) / elapsedSeconds;
    const decodedFps = (receivedAfter.frames - receivedBefore.frames) / elapsedSeconds;
    const result = {
      ok: sourceFps >= 50 && encodedFps >= 42 && decodedFps >= 40,
      sourceFps: Number(sourceFps.toFixed(1)),
      encodedFps: Number(encodedFps.toFixed(1)),
      decodedFps: Number(decodedFps.toFixed(1)),
      reportedSenderFps: sentAfter.fps,
      reportedReceiverFps: receivedAfter.fps,
      limitation: sentAfter.limitation || 'none',
      dimensions: video ? `${video.videoWidth}x${video.videoHeight}` : ''
    };
    if (!result.ok) throw new Error(`FPS instável: ${JSON.stringify(result)}`);
    return result;
  } finally {
    clearInterval(timer);
    track.stop();
    outbound.close(); inbound.close();
  }
}

const edgeCandidates = [
  path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe')
];
const edge = edgeCandidates.find((candidate) => candidate && fs.existsSync(candidate));
if (!edge) throw new Error('Microsoft Edge não encontrado para o teste WebRTC.');

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const waitForTarget = async (port, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* Edge is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error('O Edge não abriu a sessão de teste a tempo.');
};
const connectCdp = (url) => new Promise((resolve, reject) => {
  const socket = new WebSocket(url);
  let sequence = 0;
  const pending = new Map();
  const timeout = setTimeout(() => { socket.close(); reject(new Error('O alvo de teste WebRTC encerrou antes de abrir.')); }, 5000);
  socket.addEventListener('error', (event) => { clearTimeout(timeout); reject(event.error || new Error('Falha ao conectar ao alvo de teste WebRTC.')); }, { once: true });
  socket.addEventListener('close', () => {
    if (socket.readyState !== WebSocket.OPEN) { clearTimeout(timeout); reject(new Error('O alvo de teste WebRTC foi fechado durante a inicialização.')); }
  }, { once: true });
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  socket.addEventListener('open', () => {
    clearTimeout(timeout);
    resolve({
      socket,
      send(method, params = {}) {
        const id = ++sequence;
        return new Promise((resolveMessage, rejectMessage) => {
          pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
          socket.send(JSON.stringify({ id, method, params }));
        });
      }
    });
  }, { once: true });
});

(async () => {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-game-stream-'));
  const child = spawn(edge, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore', windowsHide: true });
  let cdp = null;
  try {
    const target = await waitForTarget(port);
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    const evaluated = await cdp.send('Runtime.evaluate', {
      expression: `(${runGameStreamTest.toString()})()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || evaluated.exceptionDetails.text);
    process.stdout.write(`${JSON.stringify(evaluated.result.value)}\n`);
  } finally {
    try { await cdp?.send('Browser.close'); } catch { child.kill(); }
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(); else { child.once('exit', resolve); setTimeout(resolve, 2000); } });
    const resolvedProfile = path.resolve(profile);
    if (resolvedProfile.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolvedProfile, { recursive: true, force: true });
  }
})().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
