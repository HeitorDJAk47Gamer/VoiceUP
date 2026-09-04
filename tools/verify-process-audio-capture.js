const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  app.exit(1);
};

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false }
  });
  await window.loadURL('data:text/html,<meta charset="utf-8"><title>VoiceUP process audio test</title>');
  await window.webContents.executeJavaScript(`(() => {
    const context = new AudioContext({ sampleRate: 48000 });
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.18;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    window.__voiceupTone = { context, oscillator };
    return context.state;
  })()`);

  const helper = process.env.VOICEUP_PROCESS_AUDIO_HELPER
    ? path.resolve(process.env.VOICEUP_PROCESS_AUDIO_HELPER)
    : path.join(__dirname, '..', 'native', 'voiceup-process-audio.exe');
  const nativeHandle = window.getNativeWindowHandle();
  const windowHandle = nativeHandle.length >= 8
    ? nativeHandle.readBigUInt64LE(0).toString()
    : String(nativeHandle.readUInt32LE(0));
  const capturePcm = async (argumentsList) => {
    const capture = spawn(helper, argumentsList, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let ready = false;
    let stderr = '';
    const chunks = [];
    let byteCount = 0;
    capture.stderr.setEncoding('utf8');
    capture.stderr.on('data', (text) => {
      stderr += text;
      if (stderr.includes('VOICEUP_READY')) ready = true;
    });
    capture.stdout.on('data', (chunk) => {
      if (!ready || byteCount >= 48000 * 2 * 2 * 2) return;
      chunks.push(Buffer.from(chunk));
      byteCount += chunk.length;
    });
    await new Promise((resolve) => setTimeout(resolve, 2300));
    capture.kill();
    return { ready, stderr, pcm: Buffer.concat(chunks) };
  };
  const analyze = (pcm, frequency = 880) => {
    let squareSum = 0;
    let samples = 0;
    let previous = 0;
    let beforePrevious = 0;
    const coefficient = 2 * Math.cos(2 * Math.PI * frequency / 48000);
    for (let offset = 0; offset + 3 < pcm.length; offset += 4) {
      const value = pcm.readInt16LE(offset) / 32768;
      squareSum += value * value;
      samples += 1;
      const next = value + coefficient * previous - beforePrevious;
      beforePrevious = previous;
      previous = next;
    }
    const rms = samples ? Math.sqrt(squareSum / samples) : 0;
    const tone = samples ? Math.sqrt(previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious) / samples : 0;
    return { rms, tone };
  };

  const included = await capturePcm(['capture-window', windowHandle]);
  const includedAnalysis = analyze(included.pcm);
  if (!included.ready || included.pcm.length < 4096 || includedAnalysis.rms < 0.002 || includedAnalysis.tone < 0.002) {
    window.destroy();
    fail(`Process audio capture failed: ${JSON.stringify({ ready: included.ready, bytes: included.pcm.length, ...includedAnalysis, stderr: included.stderr })}`);
    return;
  }

  const excluded = await capturePcm(['capture-exclude-pid', String(process.pid)]);
  const excludedAnalysis = analyze(excluded.pcm);
  if (!excluded.ready || excluded.pcm.length < 4096 || excludedAnalysis.tone >= includedAnalysis.tone * 0.2) {
    window.destroy();
    fail(`VoiceUP exclusion failed: ${JSON.stringify({ included: includedAnalysis, excluded: excludedAnalysis, stderr: excluded.stderr })}`);
    return;
  }
  const suppressionDb = 20 * Math.log10(Math.max(excludedAnalysis.tone, 1e-9) / includedAnalysis.tone);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    selectedApp: { bytes: included.pcm.length, rms: Number(includedAnalysis.rms.toFixed(4)), tone: Number(includedAnalysis.tone.toFixed(5)) },
    systemWithoutVoiceUP: { bytes: excluded.pcm.length, rms: Number(excludedAnalysis.rms.toFixed(4)), tone: Number(excludedAnalysis.tone.toFixed(5)), suppressionDb: Number(suppressionDb.toFixed(1)) }
  })}\n`);
  window.destroy();
  app.quit();
}).catch((error) => fail(error?.stack || error));
