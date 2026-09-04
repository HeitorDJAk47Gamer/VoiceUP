const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const workspace = path.resolve(__dirname, '..');
const port = 36000 + Math.floor(Math.random() * 2000);
const waitFor = (socket, event, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Timeout em ${event}`)), timeout);
  socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
});
const waitForCloud = (process, timeout = 7000) => new Promise((resolve, reject) => {
  let output = '';
  const timer = setTimeout(() => reject(new Error(`Cloud não iniciou a tempo. ${output}`)), timeout);
  const read = (chunk) => {
    output += String(chunk || '');
    if (/ativo na porta/i.test(output)) { clearTimeout(timer); resolve(); }
  };
  process.stdout.on('data', read); process.stderr.on('data', read);
  process.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Cloud encerrou antes do teste (${code}). ${output}`)); });
});
const stop = (process) => new Promise((resolve) => {
  if (!process || process.exitCode !== null) return resolve();
  const timer = setTimeout(resolve, 3500);
  process.once('exit', () => { clearTimeout(timer); resolve(); });
  process.kill('SIGINT');
});

(async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-cloud-dedup-'));
  const adminToken = 'voiceup-cloud-smoke-admin-token';
  let cloud; let first; let replacement; let otherProfile; let reservedProfile;
  try {
    cloud = spawn(process.execPath, [path.join('deploy', 'shardcloud', 'index.js')], {
      cwd: workspace,
      env: { ...process.env, PORT: String(port), VOICEUP_DATA_DIR: scratch, VOICEUP_ADMIN_TOKEN: adminToken, VOICEUP_CHAT_RETENTION_DAYS: '0' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await waitForCloud(cloud);
    const url = `http://127.0.0.1:${port}`;
    const healthResponse = await fetch(`${url}/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.headers.get('x-content-type-options'), 'nosniff');
    for (const sensitive of ['storage', 'plugins', 'pluginErrors', 'pluginLogs', 'musicFiles', 'counters']) assert.equal(Object.hasOwn(health, sensitive), false, `/health do Cloud expôs ${sensitive}`);
    const engineHandshake = `${url}/socket.io/?EIO=4&transport=polling&t=${Date.now()}`;
    const allowedOrigin = await fetch(engineHandshake, { headers: { Origin: 'http://localhost:3000' } });
    const blockedOrigin = await fetch(engineHandshake, { headers: { Origin: 'https://evil.example' } });
    assert.equal(allowedOrigin.status, 200, 'O Cloud bloqueou uma origem local autorizada.');
    assert.ok(blockedOrigin.status >= 400, 'O Cloud aceitou uma origem de navegador não autorizada.');
    assert.equal((await fetch(`${url}/admin/health`)).status, 401);
    assert.equal((await fetch(`${url}/admin/health`, { headers: { Authorization: 'Bearer incorreto' } })).status, 401);
    const privateHealthResponse = await fetch(`${url}/admin/health`, { headers: { Authorization: `Bearer ${adminToken}` } });
    assert.equal(privateHealthResponse.status, 200);
    const privateHealth = await privateHealthResponse.json();
    assert.equal(privateHealth.storage.chat.retentionDays, 0, 'O valor 0 precisa desativar a limpeza por idade.');
    assert.ok(Array.isArray(privateHealth.plugins), 'O health privado precisa manter o diagnóstico de plugins para o operador.');
    first = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(first, 'connect');
    const firstJoin = waitFor(first, 'room-joined');
    first.emit('join-room', { roomId: 'cloud-dedup', voiceChannel: 'Geral', name: 'Sessão anterior', clientId: 'same-profile' });
    await firstJoin;

    replacement = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(replacement, 'connect');
    const replaced = waitFor(first, 'session-replaced');
    const disconnected = waitFor(first, 'disconnect');
    const replacementJoin = waitFor(replacement, 'room-joined');
    replacement.emit('join-room', { roomId: 'cloud-dedup', voiceChannel: 'Geral', name: 'Sessão atual', clientId: 'same-profile' });
    await replacementJoin; await replaced;
    if (await disconnected !== 'io server disconnect') throw new Error('O Cloud não encerrou a sessão antiga.');

    const presence = waitFor(replacement, 'room-presence');
    replacement.emit('request-room-presence');
    const members = (await presence).members || [];
    if (members.length !== 1 || members[0]?.id !== replacement.id || members[0]?.clientId !== 'same-profile') {
      throw new Error(`Presença duplicada no Cloud: ${JSON.stringify(members)}`);
    }

    otherProfile = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(otherProfile, 'connect');
    const otherJoin = waitFor(otherProfile, 'room-joined');
    otherProfile.emit('join-room', { roomId: 'cloud-dedup', voiceChannel: 'Geral', name: 'Outra conta', clientId: 'separate-profile' });
    await otherJoin;
    const twoProfiles = waitFor(replacement, 'room-presence');
    replacement.emit('request-room-presence');
    const membersWithOtherProfile = (await twoProfiles).members || [];
    const identities = new Set(membersWithOtherProfile.map((member) => member.clientId));
    if (membersWithOtherProfile.length !== 2 || !identities.has('same-profile') || !identities.has('separate-profile')) {
      throw new Error(`Contas distintas não coexistiram no Cloud: ${JSON.stringify(membersWithOtherProfile)}`);
    }
    reservedProfile = io(url, { transports: ['websocket'], reconnection: false });
    await waitFor(reservedProfile, 'connect');
    const reservedJoin = waitFor(reservedProfile, 'room-joined');
    reservedProfile.emit('join-room', { roomId: 'cloud-reserved', voiceChannel: '__lobby__', name: 'Identidade reservada', clientId: '__proto__' });
    await reservedJoin;
    const reservedPresence = waitFor(reservedProfile, 'room-presence');
    reservedProfile.emit('request-room-presence');
    assert.equal((await reservedPresence).members[0]?.clientId, '', 'O Cloud aceitou um nome interno do JavaScript como identidade.');

    console.log(JSON.stringify({ ok: true, cloud: true, publicHealth: true, privateHealth: true, originRestricted: true, retentionZero: true, singleSession: true, memberCount: members.length, separateProfiles: membersWithOtherProfile.length, reservedIdentityBlocked: true }));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  } finally {
    first?.disconnect(); replacement?.disconnect(); otherProfile?.disconnect(); reservedProfile?.disconnect();
    await stop(cloud);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})();
