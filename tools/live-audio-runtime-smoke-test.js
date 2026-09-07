const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const role = process.env.VOICEUP_AUDIO_TEST_ROLE || '';
const sessionDirectory = process.env.VOICEUP_AUDIO_TEST_SESSION || '';
const sourceMode = process.env.VOICEUP_AUDIO_TEST_SOURCE || 'worklet';
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function readJsonWhenReady(filePath, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      try {
        if (fs.existsSync(filePath)) return resolve(JSON.parse(fs.readFileSync(filePath, 'utf8')));
      } catch { /* wait until the atomic rename completes */ }
      if (Date.now() - started >= timeout) return reject(new Error(`Tempo esgotado aguardando ${path.basename(filePath)}.`));
      setTimeout(poll, 50);
    };
    poll();
  });
}

function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value));
  fs.renameSync(temporary, filePath);
}

function waitForIceExpression(peerName) {
  return `new Promise((resolve) => {
    const pc = ${peerName};
    if (pc.iceGatheringState === 'complete') return resolve();
    const timeout = setTimeout(resolve, 5000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { clearTimeout(timeout); resolve(); }
    });
  })`;
}

async function runElectronChild() {
  const { app, BrowserWindow } = require('electron');
  if (!sessionDirectory || !['sender', 'receiver'].includes(role)) throw new Error('Função de teste Electron inválida.');

  // O teste valida áudio/WebRTC e não depende da GPU. Desativá-la evita uma
  // falha intermitente do subprocesso gráfico em ambientes Windows headless.
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  if (sourceMode === 'fake-mic') {
    app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    app.commandLine.appendSwitch('use-file-for-fake-audio-capture', path.join(sessionDirectory, 'fake-audio.wav'));
  }
  app.setPath('userData', path.join(sessionDirectory, `${role}-profile`));

  await app.whenReady();
  const window = new BrowserWindow({
    width: 640,
    height: 480,
    x: -10000,
    y: -10000,
    show: true,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(workspace, 'public', 'index.html'));

  if (role === 'sender') {
    const offer = await window.webContents.executeJavaScript(`(async () => {
      const state = globalThis.__voiceupAudioSmoke = {};
      state.pc = new RTCPeerConnection({ iceServers: [] });
      state.canvas = document.createElement('canvas');
      state.canvas.width = 16;
      state.canvas.height = 16;
      state.videoStream = state.canvas.captureStream(5);
      state.pc.addTrack(state.videoStream.getVideoTracks()[0], state.videoStream);
      state.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      state.analyser = state.context.createAnalyser();
      state.analyser.fftSize = 2048;
      const keepAlive = state.context.createGain();
      keepAlive.gain.value = 0;
      if (${JSON.stringify(sourceMode)} === 'fake-mic') {
        state.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
          video: false
        });
        state.track = state.stream.getAudioTracks()[0];
        state.source = state.context.createMediaStreamSource(state.stream);
        state.source.connect(state.analyser);
        state.source.connect(keepAlive).connect(state.context.destination);
      } else if (${JSON.stringify(sourceMode)} === 'oscillator') {
        state.destination = state.context.createMediaStreamDestination();
        state.node = state.context.createOscillator();
        const volume = state.context.createGain();
        volume.gain.value = 0.18;
        state.node.frequency.value = 880;
        state.node.connect(volume);
        volume.connect(state.destination);
        volume.connect(state.analyser);
        volume.connect(keepAlive).connect(state.context.destination);
        state.node.start();
        state.stream = state.destination.stream;
        state.track = state.stream.getAudioTracks()[0];
      } else {
        state.destination = state.context.createMediaStreamDestination();
        await state.context.audioWorklet.addModule('process-audio-worklet.js');
        state.node = new AudioWorkletNode(state.context, 'voiceup-process-pcm', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: 'explicit'
        });
        state.node.connect(state.destination);
        state.node.connect(state.analyser);
        state.node.connect(keepAlive).connect(state.context.destination);
        state.stream = state.destination.stream;
        state.track = state.stream.getAudioTracks()[0];
      }
      state.track.contentHint = 'music';
      state.sender = state.pc.addTransceiver(state.track, {
        direction: 'sendrecv',
        streams: [state.stream]
      }).sender;
      const offer = await state.pc.createOffer();
      await state.pc.setLocalDescription(offer);
      await ${waitForIceExpression('state.pc')};
      await state.context.resume();
      return state.pc.localDescription.toJSON();
    })()`, true);
    writeJsonAtomic(path.join(sessionDirectory, 'offer.json'), offer);
    const answer = await readJsonWhenReady(path.join(sessionDirectory, 'answer.json'));
    await window.webContents.executeJavaScript(`(async () => {
      const state = globalThis.__voiceupAudioSmoke;
      await state.pc.setRemoteDescription(${JSON.stringify(answer)});
      const connected = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Emissor não conectou ao receptor.')), 12000);
        const check = () => {
          if (['connected', 'completed'].includes(state.pc.connectionState)) { clearTimeout(timeout); resolve(); }
        };
        state.pc.addEventListener('connectionstatechange', check);
        check();
      });
      await connected;
      if (${JSON.stringify(sourceMode)} === 'worklet') {
        let frameCursor = 0;
        const frames = 960;
        state.pump = setInterval(() => {
          const pcm = new Int16Array(frames * 2);
          for (let frame = 0; frame < frames; frame += 1) {
            const time = frameCursor / 48000;
            const envelope = 0.2 + 0.8 * Math.max(0, Math.sin(2 * Math.PI * 3.1 * time));
            const voiced = Math.sin(2 * Math.PI * (175 + 32 * Math.sin(time * 1.7)) * time)
              + 0.45 * Math.sin(2 * Math.PI * 350 * time)
              + 0.2 * Math.sin(2 * Math.PI * 700 * time);
            const sample = Math.round(voiced * envelope * 32767 * 0.09);
            frameCursor += 1;
            pcm[frame * 2] = sample;
            pcm[frame * 2 + 1] = sample;
          }
          state.node.port.postMessage(pcm.buffer, [pcm.buffer]);
        }, 20);
      }
    })()`, true);
    await readJsonWhenReady(path.join(sessionDirectory, 'receiver-result.json'));
    const result = await window.webContents.executeJavaScript(`(async () => {
      const state = globalThis.__voiceupAudioSmoke;
      const samples = new Float32Array(state.analyser.fftSize);
      let maximumLocalRms = 0;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        state.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        maximumLocalRms = Math.max(maximumLocalRms, rms);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const reports = [...(await state.sender.getStats()).values()];
      const outbound = reports.find((report) => report.type === 'outbound-rtp' && report.kind === 'audio');
      const mediaSource = reports.find((report) => report.type === 'media-source' && report.kind === 'audio');
      const codec = reports.find((report) => report.id === outbound?.codecId);
      if (state.pump) clearInterval(state.pump);
      return {
        maximumLocalRms,
        bytesSent: Number(outbound?.bytesSent || 0),
        packetsSent: Number(outbound?.packetsSent || 0),
        outboundAudioLevel: Number(outbound?.audioLevel || 0),
        outboundEnergy: Number(outbound?.totalAudioEnergy || 0),
        sourceAudioLevel: Number(mediaSource?.audioLevel || 0),
        sourceEnergy: Number(mediaSource?.totalAudioEnergy || 0),
        codec: codec?.mimeType || '',
        direction: state.pc.getTransceivers().find((item) => item.sender === state.sender)?.currentDirection || ''
      };
    })()`, true);
    writeJsonAtomic(path.join(sessionDirectory, 'sender-result.json'), result);
  } else {
    const offer = await readJsonWhenReady(path.join(sessionDirectory, 'offer.json'));
    const answer = await window.webContents.executeJavaScript(`(async () => {
      const state = globalThis.__voiceupAudioSmoke = {};
      state.pc = new RTCPeerConnection({ iceServers: [] });
      state.trackPromise = new Promise((resolve) => {
        state.pc.addEventListener('track', (event) => {
          if (event.track.kind === 'audio') resolve(event.track);
        });
      });
      await state.pc.setRemoteDescription(${JSON.stringify(offer)});
      const answer = await state.pc.createAnswer();
      await state.pc.setLocalDescription(answer);
      await ${waitForIceExpression('state.pc')};
      return state.pc.localDescription.toJSON();
    })()`, true);
    writeJsonAtomic(path.join(sessionDirectory, 'answer.json'), answer);
    const result = await window.webContents.executeJavaScript(`(async () => {
      const state = globalThis.__voiceupAudioSmoke;
      const track = await Promise.race([
        state.trackPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Receptor não recebeu a trilha de áudio.')), 12000))
      ]);
      if (track.muted) await Promise.race([
        new Promise((resolve) => track.addEventListener('unmute', resolve, { once: true })),
        new Promise((resolve) => setTimeout(resolve, 5000))
      ]);
      const receiverStream = new MediaStream([track]);
      state.usedProductionReceiver = typeof setupManualScreenAudioGain === 'function';
      if (state.usedProductionReceiver) {
        setupManualScreenAudioGain(receiverStream);
        state.audioElement = manualScreenAudio;
      } else {
        state.audioElement = new Audio();
        state.audioElement.srcObject = receiverStream;
        state.audioElement.autoplay = true;
        state.audioElement.muted = true;
        await state.audioElement.play();
      }
      state.context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      state.source = state.context.createMediaStreamSource(receiverStream);
      state.analyser = state.context.createAnalyser();
      state.analyser.fftSize = 2048;
      const keepAlive = state.context.createGain();
      keepAlive.gain.value = 0.00001;
      state.source.connect(state.analyser);
      state.source.connect(keepAlive).connect(state.context.destination);
      await state.context.resume();
      const samples = new Float32Array(state.analyser.fftSize);
      let maximumRemoteRms = 0;
      const started = performance.now();
      while (performance.now() - started < 3500) {
        state.analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        maximumRemoteRms = Math.max(maximumRemoteRms, rms);
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      const receiver = state.pc.getReceivers().find((item) => item.track === track);
      const reports = receiver ? [...(await receiver.getStats()).values()] : [];
      const inboundReports = reports.filter((report) => report.type === 'inbound-rtp' && report.kind === 'audio');
      const inbound = inboundReports.sort((left, right) => Number(right.bytesReceived || 0) - Number(left.bytesReceived || 0))[0];
      const codec = reports.find((report) => report.id === inbound?.codecId);
      return {
        maximumRemoteRms,
        muted: track.muted,
        readyState: track.readyState,
        bytesReceived: Number(inbound?.bytesReceived || 0),
        packetsReceived: Number(inbound?.packetsReceived || 0),
        totalAudioEnergy: Number(inbound?.totalAudioEnergy || 0),
        audioLevel: Number(inbound?.audioLevel || 0),
        audioContextState: state.context.state,
        mediaElementPaused: state.audioElement.paused,
        usedProductionReceiver: state.usedProductionReceiver,
        codec: codec?.mimeType || '',
        direction: state.pc.getTransceivers().find((item) => item.receiver === receiver)?.currentDirection || ''
      };
    })()`, true);
    writeJsonAtomic(path.join(sessionDirectory, 'receiver-result.json'), result);
  }

  await wait(300);
  await app.quit();
}

function collectOutput(child) {
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  return () => output;
}

function createFakeAudioWave(filePath) {
  const sampleRate = 44100;
  const seconds = 12;
  const data = Buffer.alloc(sampleRate * seconds * 2);
  for (let frame = 0; frame < sampleRate * seconds; frame += 1) {
    const time = frame / sampleRate;
    const envelope = 0.2 + 0.8 * Math.max(0, Math.sin(2 * Math.PI * 3.1 * time));
    const voiced = Math.sin(2 * Math.PI * (175 + 32 * Math.sin(time * 1.7)) * time)
      + 0.45 * Math.sin(2 * Math.PI * 350 * time)
      + 0.2 * Math.sin(2 * Math.PI * 700 * time);
    const sample = Math.max(-32768, Math.min(32767, Math.round(voiced * envelope * 32767 * 0.09)));
    data.writeInt16LE(sample, frame * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

async function runCoordinator() {
  const electronPath = process.env.VOICEUP_ELECTRON_PATH || require('electron');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-live-audio-'));
  const children = [];
  try {
    if (sourceMode === 'fake-mic') createFakeAudioWave(path.join(directory, 'fake-audio.wav'));
    for (const childRole of ['receiver', 'sender']) {
      const child = spawn(electronPath, [__filename], {
        env: { ...process.env, VOICEUP_AUDIO_TEST_ROLE: childRole, VOICEUP_AUDIO_TEST_SESSION: directory, VOICEUP_AUDIO_TEST_SOURCE: sourceMode },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      children.push({ child, role: childRole, output: collectOutput(child) });
    }
    const [sender, receiver] = await Promise.all([
      readJsonWhenReady(path.join(directory, 'sender-result.json'), 30000),
      readJsonWhenReady(path.join(directory, 'receiver-result.json'), 30000)
    ]);
    if (sender.maximumLocalRms < 0.01) throw new Error(`O worklet local produziu silêncio: ${JSON.stringify(sender)}`);
    if (sender.bytesSent < 1000 || receiver.bytesReceived < 1000) throw new Error(`A trilha não atravessou o WebRTC: ${JSON.stringify({ sender, receiver })}`);
    if (!receiver.usedProductionReceiver) throw new Error('A página real não expôs o receptor de áudio da live para o teste.');
    if (receiver.maximumRemoteRms < 0.005) throw new Error(`O espectador recebeu pacotes, mas sem áudio audível: ${JSON.stringify({ sender, receiver })}`);
    process.stdout.write(`${JSON.stringify({ ok: true, sourceMode, sender, receiver })}\n`);
  } catch (error) {
    const diagnostics = children.map((item) => ({ role: item.role, exitCode: item.child.exitCode, output: item.output().slice(-3000) }));
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics, null, 2)}`);
  } finally {
    children.forEach(({ child }) => { if (child.exitCode === null) child.kill(); });
    await wait(250);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

(role ? runElectronChild() : runCoordinator()).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
  try { require('electron').app?.quit?.(); } catch { /* running under Node */ }
});
