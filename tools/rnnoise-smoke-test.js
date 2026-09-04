const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const workspace = path.resolve(__dirname, '..');
const packaged = process.argv.includes('--packaged');
const packagedRoot = path.join(workspace, 'release-beta', 'win-unpacked', 'resources', 'app.asar');
const runtimeRoot = packaged ? packagedRoot : workspace;
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-rnnoise-'));
app.setPath('userData', scratch);
app.disableHardwareAcceleration();
const assets = Object.freeze({
  wasm: path.join(runtimeRoot, 'public', 'vendor', 'rnnoise', 'rnnoise.wasm'),
  simd: path.join(runtimeRoot, 'public', 'vendor', 'rnnoise', 'rnnoise_simd.wasm')
});

ipcMain.handle('audio:rnnoise-asset', (_event, name) => {
  const assetPath = assets[String(name || '')];
  if (!assetPath) throw new Error('Componente de áudio inválido.');
  return fs.readFileSync(assetPath);
});
if (packaged) {
  ipcMain.handle('direct-room:status', () => ({ ok: true, active: false }));
  ipcMain.handle('window:settings', () => ({ closeBehavior: 'tray', hardwareAcceleration: false, hardwareAccelerationActive: false, restartRequired: false }));
  ipcMain.handle('shortcuts:configure', () => ({ ok: true }));
  ipcMain.handle('update:check', () => ({ currentVersion: '1.1.3-beta.19', updateAvailable: false }));
}

const run = async () => {
  console.log('RNNoise: iniciando validação oculta.');
  const messages = [];
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(runtimeRoot, 'client-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
      partition: 'rnnoise-smoke-test',
      backgroundThrottling: false,
      offscreen: true
    }
  });
  window.webContents.on('render-process-gone', (_event, details) => console.error('RNNoise: renderer encerrado.', details));
  window.webContents.on('unresponsive', () => console.error('RNNoise: renderer sem resposta.'));
  window.webContents.on('console-message', (_event, level, message) => {
    messages.push({ level, message: String(message || '') });
  });
  if (packaged) await window.loadFile(path.join(packagedRoot, 'public', 'index.html'), { query: { version: '1.1.3-beta.19' } });
  else await window.loadFile(path.join(workspace, 'tools', 'rnnoise-test.html'));
  console.log('RNNoise: mecanismo carregado.');

  const result = await window.webContents.executeJavaScript(`(async () => {
    try {
    if (!window.voiceupRnnoise?.supported) throw new Error('API RNNoise não foi exposta no Client.');
    let invalidAssetBlocked = false;
    try { await window.voiceupDesktop.rnnoiseAsset('../package.json'); } catch { invalidAssetBlocked = true; }

    const generator = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const oscillator = generator.createOscillator();
    const modulator = generator.createOscillator();
    const modulatorDepth = generator.createGain();
    const sourceGain = generator.createGain();
    const sourceDestination = generator.createMediaStreamDestination();
    oscillator.type = 'sawtooth'; oscillator.frequency.value = 180;
    modulator.type = 'sine'; modulator.frequency.value = 4.5;
    modulatorDepth.gain.value = 0.035;
    sourceGain.gain.value = 0.08;
    modulator.connect(modulatorDepth).connect(sourceGain.gain);
    oscillator.connect(sourceGain).connect(sourceDestination);
    oscillator.start(); modulator.start();
    await generator.resume();

    const inputTrack = sourceDestination.stream.getAudioTracks()[0];
    const session = await window.voiceupRnnoise.create(inputTrack, { gain: 0.75 });
    const consumer = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    const inputAnalyser = consumer.createAnalyser();
    const analyser = consumer.createAnalyser();
    const silence = consumer.createGain(); silence.gain.value = 0;
    consumer.createMediaStreamSource(new MediaStream([inputTrack])).connect(inputAnalyser).connect(silence);
    consumer.createMediaStreamSource(new MediaStream([session.track])).connect(analyser).connect(silence).connect(consumer.destination);
    await consumer.resume();
    await new Promise((resolve) => setTimeout(resolve, 900));
    const rms = (node) => {
      const frame = new Float32Array(node.fftSize);
      node.getFloatTimeDomainData(frame);
      return Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
    };
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    const finite = samples.every(Number.isFinite);
    const inputRms = rms(inputAnalyser);
    const outputRms = rms(analyser);
    session.setGain(1.25);
    const snapshot = {
      supported: window.voiceupRnnoise.supported,
      invalidAssetBlocked,
      inputState: inputTrack.readyState,
      outputState: session.track.readyState,
      sampleRate: session.sampleRate,
      usingSimd: session.usingSimd,
      finite,
      inputRms,
      outputRms
    };
    await session.close();
    snapshot.closedOutputState = session.track.readyState;
    oscillator.stop(); modulator.stop(); inputTrack.stop();
    await generator.close(); await consumer.close();
    return snapshot;
    } catch (error) {
      return { error: { name: String(error?.name || ''), message: String(error?.message || error), stack: String(error?.stack || '') } };
    }
  })()`);
  console.log('RNNoise: processamento concluído.', result);
  if (result.error) throw new Error(`${result.error.name}: ${result.error.message}\n${result.error.stack}`);

  assert.equal(result.supported, true, 'O Client precisa detectar o mecanismo RNNoise local.');
  assert.equal(result.invalidAssetBlocked, true, 'O carregador RNNoise não pode aceitar caminhos arbitrários.');
  assert.equal(result.inputState, 'live', 'A fonte sintética precisa permanecer ativa durante o teste.');
  assert.equal(result.outputState, 'live', 'O RNNoise precisa publicar uma faixa de áudio ativa.');
  assert.equal(result.sampleRate, 48000, 'O RNNoise precisa processar em 48 kHz.');
  assert.equal(result.finite, true, 'O RNNoise não pode produzir amostras inválidas.');
  assert.ok(result.inputRms > 0.001, `A fonte de teste precisa conter áudio (RMS ${result.inputRms}).`);
  assert.ok(result.outputRms > 0.0001, `O RNNoise não pode publicar silêncio total (RMS ${result.outputRms}).`);
  assert.equal(result.closedOutputState, 'ended', 'Fechar o RNNoise precisa liberar sua faixa de saída.');
  const fatal = messages.find((item) => item.level >= 3 && /rnnoise|worklet|wasm/i.test(item.message));
  assert.equal(fatal, undefined, `Falha no AudioWorklet: ${fatal?.message || ''}`);
  window.destroy();
  console.log(`RNNoise validado em 48 kHz ${packaged ? 'dentro do pacote Client' : 'dentro do Electron'} (SIMD: ${result.usingSimd ? 'sim' : 'não'}).`);
};

app.whenReady().then(run).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
