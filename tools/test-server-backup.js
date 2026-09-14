'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  BACKUP_SCHEMA,
  BACKUP_FORMAT_VERSION,
  createServerBackup,
  inspectServerBackup,
  restoreServerBackup
} = require('../server-backup');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-server-backup-'));
const source = path.join(scratch, 'source');
const restored = path.join(scratch, 'restored');
const backupFile = path.join(scratch, 'server.voiceup-backup');
const writeJson = (root, name, value) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2), 'utf8');
};
const checksum = (value) => crypto.createHash('sha256').update(value).digest('hex');

try {
  fs.mkdirSync(source, { recursive: true });
  writeJson(source, 'server-settings.json', {
    theme: 'forest',
    rooms: [{ id: 'amigos', name: 'Amigos', voiceChannels: ['Geral'], textChannels: ['geral'] }],
    accessControl: { roles: [{ id: 'admin', name: 'Administrador', permissions: ['manageServer'] }], assignments: [{ clientId: 'user-a', roleIds: ['admin'] }] },
    cluster: { secret: 'segredo-do-servidor', nodeId: 'host-original' }
  });
  writeJson(source, 'chat-history.json', { version: 1, rooms: { amigos: [{ messageId: 'msg-1', text: 'mensagem preservada', textChannel: 'geral' }] } });
  writeJson(source, 'bans.json', [{ clientId: 'banido' }]);
  writeJson(source, 'chat-punishments.json', [{ clientId: 'castigado' }]);
  writeJson(source, 'bug-reports.json', { version: 1, reports: [{ id: 'erro-1' }] });
  writeJson(source, 'plugin-settings.json', { version: 2, plugins: { dados: { enabled: true, settings: { maxDice: 12 }, data: { rolls: 9 } } }, approvals: { unsafehash: { approved: true } } });
  writeJson(source, 'security-audit.json', [{ id: 'audit-1', action: 'room.created' }]);
  writeJson(source, 'client-identities.json', { version: 1, identities: { 'user-a': { publicKey: { kty: 'EC' } } } });
  fs.mkdirSync(path.join(source, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(source, 'plugins', 'custom.js'), 'module.exports = { id: "custom" };', 'utf8');
  fs.mkdirSync(path.join(source, 'music'), { recursive: true });
  fs.writeFileSync(path.join(source, 'music', 'entrada.mp3'), Buffer.from([0x49, 0x44, 0x33, 0x04]));

  const created = createServerBackup({ sourceDirectory: source, destinationFile: backupFile, appVersion: '1.2.2-beta.27', includePlugins: true, includeMusic: true });
  assert.ok(fs.existsSync(backupFile));
  assert.equal(created.sourceVersion, '1.2.2-beta.27');
  assert.equal(created.pluginFileCount, 1);
  assert.equal(created.musicFileCount, 1);
  assert.match(created.archiveSha256, /^[a-f0-9]{64}$/);

  const inspected = inspectServerBackup(backupFile);
  assert.equal(inspected.schema, BACKUP_SCHEMA);
  assert.equal(inspected.formatVersion, BACKUP_FORMAT_VERSION);
  assert.equal(inspected.fileCount, 10);
  assert.deepEqual(inspected.includes, { core: true, plugins: true, music: true, attachments: true });

  writeJson(restored, 'server-settings.json', { theme: 'stale' });
  writeJson(restored, 'chat-history.json', { version: 1, rooms: { velha: [{ text: 'apagar' }] } });
  fs.mkdirSync(path.join(restored, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(restored, 'plugins', 'stale.js'), 'throw new Error("stale")', 'utf8');
  fs.mkdirSync(path.join(restored, 'music'), { recursive: true });
  fs.writeFileSync(path.join(restored, 'music', 'stale.mp3'), 'stale', 'utf8');

  const result = restoreServerBackup({ sourceFile: backupFile, destinationDirectory: restored });
  assert.equal(result.ok, true);
  assert.equal(result.approvalsReset, true, 'Plugins externos restaurados devem exigir uma nova aprovação no outro computador.');
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored, 'server-settings.json'), 'utf8')).rooms[0].id, 'amigos');
  assert.equal(JSON.parse(fs.readFileSync(path.join(restored, 'chat-history.json'), 'utf8')).rooms.amigos[0].text, 'mensagem preservada');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored, 'plugin-settings.json'), 'utf8')).approvals, {});
  assert.ok(fs.existsSync(path.join(restored, 'plugins', 'custom.js')));
  assert.ok(!fs.existsSync(path.join(restored, 'plugins', 'stale.js')));
  assert.ok(fs.existsSync(path.join(restored, 'music', 'entrada.mp3')));
  assert.ok(!fs.existsSync(path.join(restored, 'music', 'stale.mp3')));

  const maliciousPayload = {
    manifest: { schema: BACKUP_SCHEMA, formatVersion: BACKUP_FORMAT_VERSION, backupId: 'bad', createdAt: new Date().toISOString(), sourceVersion: '1.2.2', totalBytes: 2, includes: { core: true, plugins: false, music: false } },
    files: [
      { path: 'server-settings.json', size: 2, sha256: checksum(Buffer.from('{}')), data: Buffer.from('{}').toString('base64') },
      { path: '../outside.json', size: 2, sha256: checksum(Buffer.from('{}')), data: Buffer.from('{}').toString('base64') }
    ]
  };
  const malicious = path.join(scratch, 'malicious.voiceup-backup');
  fs.writeFileSync(malicious, zlib.gzipSync(Buffer.from(JSON.stringify(maliciousPayload))), 'binary');
  assert.throws(() => inspectServerBackup(malicious), /Caminho bloqueado/);
  assert.ok(!fs.existsSync(path.join(scratch, 'outside.json')));

  const corrupt = path.join(scratch, 'corrupt.voiceup-backup');
  const corruptedBytes = fs.readFileSync(backupFile);
  corruptedBytes[Math.floor(corruptedBytes.length / 2)] ^= 0xff;
  fs.writeFileSync(corrupt, corruptedBytes);
  assert.throws(() => inspectServerBackup(corrupt), /inválido|corrompido|integridade/i);

  console.log(JSON.stringify({ ok: true, portable: true, rooms: true, channels: true, messages: true, roles: true, moderation: true, plugins: true, music: true, integrity: true, traversalBlocked: true }));
} finally {
  const resolved = path.resolve(scratch);
  if (path.dirname(resolved) === path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-server-backup-')) fs.rmSync(resolved, { recursive: true, force: true });
}
