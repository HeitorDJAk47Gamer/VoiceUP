const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '.verify-audio-lanes-userdata'));

async function runAudioLaneTest() {
  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const tone = (frequency) => {
    const context = new AudioContext({ sampleRate: 48000 });
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.frequency.value = frequency;
    gain.gain.value = 0.12;
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    return { context, oscillator, track: destination.stream.getAudioTracks()[0] };
  };
  const inboundBytes = async (receiver) => {
    let total = 0;
    (await receiver.getStats()).forEach((report) => {
      if (report.type === 'inbound-rtp' && (report.kind === 'audio' || report.mediaType === 'audio')) total += Number(report.bytesReceived || 0);
    });
    return total;
  };
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  const resources = [tone(330), tone(880), tone(440), tone(990)];
  const aVoice = a.addTransceiver(resources[0].track, { direction: 'sendrecv' });
  const aLive = a.addTransceiver(resources[1].track, { direction: 'sendrecv' });
  const pendingA = []; const pendingB = [];
  a.onicecandidate = ({ candidate }) => candidate && (b.remoteDescription ? b.addIceCandidate(candidate) : pendingB.push(candidate));
  b.onicecandidate = ({ candidate }) => candidate && (a.remoteDescription ? a.addIceCandidate(candidate) : pendingA.push(candidate));
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  const [bVoice, bLive] = b.getTransceivers().filter((item) => item.receiver.track.kind === 'audio');
  bVoice.direction = 'sendrecv'; bLive.direction = 'sendrecv';
  await Promise.all([bVoice.sender.replaceTrack(resources[2].track), bLive.sender.replaceTrack(resources[3].track)]);
  await Promise.all(pendingB.splice(0).map((candidate) => b.addIceCandidate(candidate)));
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  await Promise.all(pendingA.splice(0).map((candidate) => a.addIceCandidate(candidate)));
  const timeoutAt = Date.now() + 8000;
  while (Date.now() < timeoutAt && (a.connectionState !== 'connected' || b.connectionState !== 'connected')) await wait(50);
  if (a.connectionState !== 'connected' || b.connectionState !== 'connected') throw new Error(`Pares não conectaram: ${a.connectionState}/${b.connectionState}`);
  await wait(900);
  const before = { voice: await inboundBytes(bVoice.receiver), live: await inboundBytes(bLive.receiver) };
  await wait(900);
  const flowing = { voice: await inboundBytes(bVoice.receiver), live: await inboundBytes(bLive.receiver) };
  const voiceFlow = flowing.voice - before.voice;
  const liveFlow = flowing.live - before.live;
  if (voiceFlow < 400 || liveFlow < 400) throw new Error(`Faixas não fluíram separadamente: voz=${voiceFlow}, live=${liveFlow}`);
  await aVoice.sender.replaceTrack(null);
  const mutedAt = { voice: await inboundBytes(bVoice.receiver), live: await inboundBytes(bLive.receiver) };
  await wait(1200);
  const afterMute = { voice: await inboundBytes(bVoice.receiver), live: await inboundBytes(bLive.receiver) };
  const voiceAfterMute = afterMute.voice - mutedAt.voice;
  const liveAfterMute = afterMute.live - mutedAt.live;
  if (liveAfterMute < 400) throw new Error(`Mutar voz interrompeu a live: ${liveAfterMute} bytes`);
  if (voiceAfterMute >= liveAfterMute * 0.5) throw new Error(`A faixa de voz continuou ativa após replaceTrack(null): voz=${voiceAfterMute}, live=${liveAfterMute}`);
  resources.forEach(({ oscillator, track, context }) => { oscillator.stop(); track.stop(); context.close(); });
  a.close(); b.close();
  return { ok: true, initialBytes: { voice: voiceFlow, live: liveFlow }, afterVoiceMute: { voice: voiceAfterMute, live: liveAfterMute } };
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { offscreen: true, contextIsolation: true, backgroundThrottling: false } });
  await window.loadURL('data:text/html,<html><body></body></html>');
  try {
    const result = await window.webContents.executeJavaScript(`(${runAudioLaneTest.toString()})()`);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    app.exit(0);
  } catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    app.exit(1);
  }
});
