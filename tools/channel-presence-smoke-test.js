const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { io } = require('socket.io-client');
const { startSignalingServer } = require('../signaling-server');

const workspace = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-channel-presence-'));
const sockets = [];
let host, cloud;
const waitFor = (socket, event, predicate = () => true) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off(event, onEvent); reject(new Error(`Timeout: ${event}`)); }, 5000);
  function onEvent(packet) { if (predicate(packet)) { clearTimeout(timer); socket.off(event, onEvent); resolve(packet); } }
  socket.on(event, onEvent);
});
async function join(url, name, channel = '__lobby__', room = 'roster-test', platform = undefined) {
  const socket = io(url, { transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  await waitFor(socket, 'connect');
  const joined = waitFor(socket, 'room-joined');
  socket.emit('join-room', { name, clientId: `roster-${name}`, roomId: room, voiceChannel: channel, platform });
  await joined;
  return socket;
}
async function presence(socket, predicate) {
  const result = waitFor(socket, 'room-presence', predicate);
  socket.emit('request-room-presence');
  return result;
}
async function move(socket, channel) {
  const moved = waitFor(socket, 'room-joined');
  socket.emit('switch-voice-channel', { voiceChannel: channel });
  await moved;
}
const startedAt = (packet, channel) => packet.voiceActivity.find((entry) => entry.voiceChannel === channel)?.startedAt;
async function exercise(url, label) {
  const observer = await join(url, `${label}-observer`, '__lobby__', 'roster-test', 'selfweb');
  assert.deepEqual((await presence(observer)).voiceActivity, [], 'Lobby is not a call.');
  const first = await join(url, `${label}-first`, 'Geral', 'roster-test', 'windows');
  const initial = await presence(observer, (packet) => Boolean(startedAt(packet, 'Geral')));
  const firstStart = startedAt(initial, 'Geral');
  assert.ok(firstStart > 0 && firstStart <= initial.serverTime);
  const second = await join(url, `${label}-second`, 'Geral', 'roster-test', 'android');
  const secondPacket = await presence(second);
  assert.equal(Object.hasOwn(secondPacket.members.find((member) => member.id === first.id), 'voiceupMediaState'), false, 'Unknown legacy media must not be reported as definitively off.');
  assert.equal(startedAt(secondPacket, 'Geral'), firstStart, 'Late joiners see the original call start.');
  const third = await join(url, `${label}-third`, 'Geral', 'roster-test', 'linux');
  const platforms = await presence(observer);
  for (const [socket, platform] of [[observer,'selfweb'],[first,'windows'],[second,'android'],[third,'linux']]) {
    assert.equal(platforms.members.find((member) => member.id === socket.id)?.platform, platform);
  }
  for (const status of ['dnd','idle','online']) {
    const update = waitFor(observer, 'room-presence', (value) => value.members.find((member) => member.id === first.id)?.status === status);
    first.emit('presence-update', {status});
    assert.equal((await update).members.find((member) => member.id === first.id).platform, 'windows', 'Status-only packets preserve the platform.');
  }
  const invalid = waitFor(observer, 'room-presence', (value) => value.members.find((member) => member.id === first.id)?.status === 'idle');
  first.emit('presence-update', {status:'idle',platform:'<svg onload=alert(1)>',target:second.id});
  const sanitized = await invalid;
  assert.equal(sanitized.members.find((member) => member.id === first.id).platform,'windows');
  assert.equal(sanitized.members.find((member) => member.id === second.id).platform,'android');
  await move(first, 'Jogando');
  let packet = await presence(observer, (value) => Boolean(startedAt(value, 'Jogando')));
  assert.equal(startedAt(packet, 'Geral'), firstStart, 'The creator leaving must not reset the call.');
  assert.ok(startedAt(packet, 'Jogando') >= firstStart);
  assert.equal(packet.members.filter((member) => member.voiceChannel === 'Geral').length, 2);
  const muted = waitFor(observer, 'room-presence', (value) => value.members.some((member) => member.id === first.id && member.voiceupAudioState?.micMuted && member.voiceupAudioState?.outputMuted));
  first.emit('audio-state-update', { micMuted: true, outputMuted: true, target: second.id });
  packet = await muted;
  assert.deepEqual(packet.members.find((member) => member.id === first.id).voiceupAudioState, { micMuted: true, outputMuted: true });
  assert.deepEqual(packet.members.find((member) => member.id === second.id).voiceupAudioState, { micMuted: false, outputMuted: false }, 'Audio state must only affect its sender.');
  assert.equal(startedAt(packet, 'Geral'), firstStart, 'Mute changes do not reset the timer.');
  const unmuted = waitFor(observer, 'room-presence', (value) => value.members.some((member) => member.id === first.id && !member.voiceupAudioState?.micMuted && !member.voiceupAudioState?.outputMuted));
  first.emit('audio-state-update', { micMuted: false, outputMuted: false });
  await unmuted;
  for (const state of [{ screen: true, camera: true }, { screen: false, camera: true }, { screen: true, camera: false }, { screen: false, camera: false }]) {
    const changed = waitFor(observer, 'room-presence', (value) => {
      const media = value.members.find((member) => member.id === first.id)?.voiceupMediaState;
      return media?.screen === state.screen && media?.camera === state.camera;
    });
    first.emit('media-state-update', { ...state, target: second.id });
    packet = await changed;
    assert.deepEqual(packet.members.find((member) => member.id === first.id).voiceupMediaState, state);
    assert.equal(Object.hasOwn(packet.members.find((member) => member.id === second.id), 'voiceupMediaState'), false, 'Media state only affects its sender, including across channels.');
    assert.equal(startedAt(packet, 'Geral'), firstStart, 'Media updates must not reset the call timer.');
  }
  await move(second, '__lobby__');
  packet = await presence(observer, (value) => value.members.find((member) => member.id === second.id)?.voiceChannel === '');
  assert.equal(startedAt(packet, 'Geral'), firstStart, 'The last remaining participant keeps the timer.');
  const emptied = waitFor(observer, 'room-presence', (value) => !startedAt(value, 'Geral'));
  third.disconnect();
  await emptied;
  await move(second, 'Geral');
  packet = await presence(observer, (value) => Boolean(startedAt(value, 'Geral')));
  const restarted = startedAt(packet, 'Geral');
  assert.ok(restarted > firstStart, 'Returning to an empty channel starts a new call.');
  const replacement = await join(url, `${label}-second`, 'Geral', 'roster-test', 'android');
  packet = await presence(replacement);
  assert.equal(packet.members.filter((member) => member.clientId === `roster-${label}-second`).length, 1, 'Reconnects must not create ghost members.');
  assert.equal(startedAt(packet, 'Geral'), restarted, 'Replacing a stale session does not empty the channel.');
  const outsider = await join(url, `${label}-outsider`, '__lobby__', 'other-room');
  const outsiderPresence = await presence(outsider);
  assert.deepEqual(outsiderPresence.voiceActivity, [], 'Timers cannot leak across rooms.');
  assert.equal(outsiderPresence.members[0].platform, '', 'Legacy clients remain compatible without a guessed OS.');
  if (label === 'cloud') {
    const download = await fetch(`${url}/downloads/selfweb`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition'), /attachment;.*VoiceUP-SelfWeb.html/);
    const crypto = require('node:crypto');
    const downloaded = Buffer.from(await download.arrayBuffer());
    const bundled = fs.readFileSync(path.join(workspace,'selfweb/dist/VoiceUP-SelfWeb.html'));
    assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'),crypto.createHash('sha256').update(bundled).digest('hex'));
  }
  console.log(`PASS ${label}: 4 clients, channels, timer, mute, simultaneous live/camera presence, platform/status propagation, legacy fallback, reconnect and SelfWeb download.`);
  for (const socket of sockets) socket.disconnect();
}
async function stopCloud() {
  if (!cloud || cloud.exitCode !== null) return;
  await new Promise((resolve) => { cloud.once('exit', resolve); cloud.kill(); });
}
(async () => {
  try {
    host = await startSignalingServer(0, {
      historyFile: path.join(scratch, 'host-chat.json'), reportsFile: path.join(scratch, 'host-reports.json'), bansFile: path.join(scratch, 'host-bans.json')
    });
    await exercise(`http://127.0.0.1:${host.server.address().port}`, 'host');
    const cloudPort = 38000 + Math.floor(Math.random() * 1500);
    cloud = spawn(process.execPath, [path.join(workspace, 'deploy/shardcloud/index.js')], {
      cwd: workspace, windowsHide: true, env: { ...process.env, PORT: String(cloudPort), VOICEUP_DATA_DIR: path.join(scratch, 'cloud'), VOICEUP_ADMIN_TOKEN: 'local-test-only-token' }, stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Cloud startup timeout')), 8000);
      const read = (data) => { if (/ativo na porta/i.test(String(data))) { clearTimeout(timeout); resolve(); } };
      cloud.stdout.on('data', read);
      cloud.stderr.on('data', read);
      cloud.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Cloud exit ${code}`)); });
    });
    await exercise(`http://127.0.0.1:${cloudPort}`, 'cloud');
  } finally {
    for (const socket of sockets) socket.disconnect();
    if (host) await new Promise((resolve) => host.io.close(resolve));
    await stopCloud();
    // Only this test's mkdtemp directory may be removed.
    const resolved = path.resolve(scratch);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-channel-presence-')) fs.rmSync(resolved, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
