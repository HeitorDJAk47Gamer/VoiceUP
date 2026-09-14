'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const CHUNK = 48 * 1024;
const ID = /^[a-f0-9]{32}$/;
// Keep this aligned with server-backup.js. The host chooses the usable limit;
// these are only the technical bounds that preserve portable backups.
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL = 384 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 10000;
const filename = value => String(value || 'arquivo').replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g, '_').slice(0, 120) || 'arquivo';
function createAttachmentService({ directory, policy, authorize, publish }) {
  const uploads = new Map();
  let reserved = 0;
  const release = (socket, removePartial = true) => {
    const job = uploads.get(socket);
    if (!job) return;
    reserved -= job.size; clearTimeout(job.timer); uploads.delete(socket);
    try { fs.closeSync(job.handle); } catch { /* already closed */ }
    if (removePartial) fs.rmSync(job.partial, { force: true });
  };
  const limits = () => ({ enabled: policy().enabled === true && Boolean(directory), maxBytes: Math.max(1, Math.min(256, Math.round(Number(policy().maxMB) || 5))) * 1024 * 1024 });
  const storageUsed = () => {
    if (!fs.existsSync(directory)) return 0;
    const files = fs.readdirSync(directory).filter(name => /^[a-f0-9]{32}\.(?:bin|json)$/.test(name));
    if (files.length >= MAX_ATTACHMENT_COUNT * 2) throw Error('O host atingiu o limite técnico de 10.000 anexos armazenados.');
    return files.reduce((sum, name) => sum + fs.statSync(path.join(directory, name)).size, 0);
  };
  const read = id => {
    if (!directory) throw Error('Anexos indisponíveis neste servidor.');
    if (!ID.test(String(id || ''))) throw Error('Anexo inválido.');
    const meta = JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8'));
    if (meta.id !== id || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > MAX_FILE_BYTES) throw Error('Anexo inválido.');
    return meta;
  };
  const bind = socket => {
    let windowStart = Date.now(), requests = 0;
    const handle = (name, fn) => socket.on(name, (packet = {}, reply) => {
      if (typeof reply !== 'function') return;
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); requests = 0; }
      if (++requests > 160) return reply({ ok: false, message: 'Muitas solicitações de arquivo. Aguarde um instante.' });
      try { reply({ ok: true, ...fn(packet || {}) }); }
      catch (error) { reply({ ok: false, message: error.message || 'Não foi possível transferir o arquivo.' }); }
    });
    handle('attachment-policy', () => ({ policy: socket.data.serverRoom ? limits() : { enabled: false, maxBytes: 0 } }));
    handle('attachment-begin', packet => {
      const rule = limits();
      if (!rule.enabled) throw Error('O servidor não permite anexos.');
      if (!Number.isSafeInteger(packet.size) || packet.size < 1 || packet.size > rule.maxBytes || packet.size > MAX_FILE_BYTES) throw Error(`O limite definido pelo servidor é ${rule.maxBytes / 1024 / 1024} MB por arquivo.`);
      if (!authorize(socket, packet.channel, true, packet.thread)) throw Error('Você não pode enviar arquivos neste canal.');
      if (uploads.has(socket)) throw Error('Termine ou cancele o envio anterior.');
      if (reserved + packet.size > MAX_TOTAL || reserved + storageUsed() + packet.size > MAX_TOTAL) throw Error('Armazenamento de anexos ocupado. Peça ao host para liberar espaço.');
      const id = crypto.randomBytes(16).toString('hex');
      fs.mkdirSync(directory, { recursive: true });
      const partial = path.join(directory, `.upload-${id}.part`);
      const job = { id, room: socket.data.room, channel: packet.channel, thread: String(packet.thread || '').slice(0, 80), title: String(packet.title || '').slice(0, 100), name: filename(packet.name), size: packet.size, bytes: 0, partial, handle: fs.openSync(partial, 'wx'), hash: crypto.createHash('sha256'), timer: setTimeout(() => release(socket), 120000) };
      job.timer.unref?.(); reserved += job.size; uploads.set(socket, job);
      return { id, chunkBytes: CHUNK };
    });
    handle('attachment-chunk', packet => {
      const job = uploads.get(socket);
      if (!job || packet.id !== job.id || socket.data.room !== job.room) throw Error('Envio expirado. Selecione o arquivo novamente.');
      if (!limits().enabled || !authorize(socket, job.channel, true, job.thread)) { release(socket); throw Error('Permissão de envio revogada.'); }
      if (typeof packet.data !== 'string' || packet.data.length > CHUNK * 4 / 3 || !/^[A-Za-z0-9+/]*={0,2}$/.test(packet.data) || packet.data.length % 4) throw Error('Bloco inválido.');
      const bytes = Buffer.from(packet.data, 'base64');
      if (!bytes.length || bytes.length > CHUNK || packet.offset !== job.bytes || job.bytes + bytes.length > job.size) throw Error('Tamanho ou ordem dos blocos inválida.');
      fs.writeSync(job.handle, bytes, 0, bytes.length, job.bytes); job.hash.update(bytes); job.bytes += bytes.length;
      return { received: job.bytes };
    });
    handle('attachment-cancel', () => { release(socket); return {}; });
    handle('attachment-finish', packet => {
      const job = uploads.get(socket);
      if (!job || job.id !== packet.id || job.bytes !== job.size || socket.data.room !== job.room) throw Error('Arquivo incompleto ou envio expirado.');
      if (!limits().enabled || job.size > limits().maxBytes || !authorize(socket, job.channel, true, job.thread)) { release(socket); throw Error('O servidor alterou a permissão ou o limite de anexos.'); }
      const meta = { id: job.id, name: job.name, size: job.size, room: job.room, channel: job.channel, thread: job.thread, createdAt: Date.now(), sha256: job.hash.digest('hex') };
      const binary = path.join(directory, `${job.id}.bin`), manifest = path.join(directory, `${job.id}.json`);
      try {
        fs.closeSync(job.handle); job.handle = null; fs.renameSync(job.partial, binary); fs.writeFileSync(manifest, JSON.stringify(meta), { flag: 'wx' });
        if (!publish(socket, { text: `[[voiceup-file:${job.id}]]`, textChannel: job.channel, forumThreadId: job.thread, forumTitle: job.title })) throw Error('Mensagem recusada: verifique cooldown e permissões.');
      } catch (error) { fs.rmSync(binary, { force: true }); fs.rmSync(manifest, { force: true }); throw error; }
      finally { release(socket); }
      return { attachment: meta };
    });
    handle('attachment-read', packet => {
      const meta = read(packet.id);
      if (meta.room !== socket.data.room || !authorize(socket, meta.channel, false, meta.thread)) throw Error('Você não tem acesso a este anexo.');
      const { id, name, size, sha256, createdAt } = meta;
      if (packet.offset === undefined) return { attachment: { id, name, size, sha256, createdAt }, chunkBytes: CHUNK };
      if (!Number.isSafeInteger(packet.offset) || packet.offset < 0 || packet.offset >= size) throw Error('Posição inválida.');
      const buffer = Buffer.alloc(Math.min(CHUNK, size - packet.offset));
      const descriptor = fs.openSync(path.join(directory, `${id}.bin`), 'r');
      try { const count = fs.readSync(descriptor, buffer, 0, buffer.length, packet.offset); if (count !== buffer.length) throw Error('Anexo incompleto no servidor.'); }
      finally { fs.closeSync(descriptor); }
      return { data: buffer.toString('base64'), next: packet.offset + buffer.length };
    });
    socket.on('disconnect', () => release(socket));
  };
  return { bind, limits };
}
module.exports = { createAttachmentService, filename, CHUNK, MAX_FILE_BYTES, MAX_TOTAL };
