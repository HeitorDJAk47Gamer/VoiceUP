const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const temporaryDirectory = path.join(workspace, '.tmp', 'process-audio-helper');
const wavePath = path.join(temporaryDirectory, 'probe.wav');
const helperPath = path.join(workspace, 'native', 'voiceup-process-audio.exe');
const sampleRate = 48000;
const channels = 2;
const durationSeconds = 5;

function createProbeWave() {
  fs.mkdirSync(temporaryDirectory, { recursive: true });
  const frameCount = sampleRate * durationSeconds;
  const data = Buffer.alloc(frameCount * channels * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.round(Math.sin(2 * Math.PI * 880 * frame / sampleRate) * 32767 * 0.12);
    data.writeInt16LE(sample, frame * 4);
    data.writeInt16LE(sample, frame * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(wavePath, Buffer.concat([header, data]));
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function capture(argumentsList, milliseconds = 2200) {
  const process = spawn(helperPath, argumentsList, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  let stderr = '';
  process.stderr.setEncoding('utf8');
  process.stderr.on('data', (value) => { stderr += value; });
  process.stdout.on('data', (value) => chunks.push(Buffer.from(value)));
  await wait(milliseconds);
  process.kill();
  await new Promise((resolve) => process.once('exit', resolve));
  return { pcm: Buffer.concat(chunks), stderr };
}

function rms(pcm) {
  let sum = 0;
  let count = 0;
  for (let offset = 0; offset + 3 < pcm.length; offset += 4) {
    const sample = pcm.readInt16LE(offset) / 32768;
    sum += sample * sample;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Este teste usa a captura de áudio do Windows.');
  if (!fs.existsSync(helperPath)) throw new Error(`Capturador não encontrado: ${helperPath}`);
  createProbeWave();
  const escapedPath = wavePath.replace(/'/g, "''");
  const player = spawn('powershell.exe', [
    '-NoProfile',
    '-Command',
    `Add-Type -AssemblyName System; $player = New-Object System.Media.SoundPlayer '${escapedPath}'; $player.PlayLooping(); Start-Sleep -Seconds ${durationSeconds}`
  ], { windowsHide: true, stdio: 'ignore' });
  try {
    await wait(550);
    const included = await capture(['capture-pid', String(player.pid)]);
    const level = rms(included.pcm);
    if (!included.stderr.includes('VOICEUP_READY') || included.pcm.length < 4096 || level < 0.002) {
      throw new Error(`O áudio do processo não foi capturado: ${JSON.stringify({ bytes: included.pcm.length, rms: level, stderr: included.stderr })}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, processId: player.pid, bytes: included.pcm.length, rms: Number(level.toFixed(4)) })}\n`);
  } finally {
    player.kill();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
