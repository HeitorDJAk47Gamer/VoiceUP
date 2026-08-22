const fs = require('fs');
const path = require('path');

const positiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readJson = (filePath, fallback) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const createJsonWriter = (filePath, serialize) => {
  let timer = null;
  let closed = false;
  const flush = () => {
    if (closed && !timer) return;
    if (timer) clearTimeout(timer);
    timer = null;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, serialize(), 'utf8');
    fs.copyFileSync(temporary, filePath);
    fs.unlinkSync(temporary);
  };
  const schedule = () => {
    if (closed || timer) return;
    timer = setTimeout(() => {
      try { flush(); } catch { /* a próxima alteração tenta novamente */ }
    }, 180);
    timer.unref?.();
  };
  const close = () => {
    if (closed) return;
    try { flush(); } catch { /* o encerramento não deve travar o servidor */ }
    closed = true;
  };
  return { schedule, flush, close };
};

function createPersistentChatStore(options = {}) {
  const filePath = path.resolve(String(options.filePath || path.join(process.cwd(), 'data', 'chat-history.json')));
  let maxPerRoom = positiveInteger(options.maxPerRoom, 300);
  let retentionDays = Math.max(0, Number(options.retentionDays) || 0);
  const initial = readJson(filePath, { version: 1, rooms: {} });
  const rooms = new Map();
  for (const [roomId, messages] of Object.entries(initial.rooms || {})) {
    if (!Array.isArray(messages)) continue;
    rooms.set(String(roomId).slice(0, 48), messages.slice(-maxPerRoom));
  }
  const payload = () => JSON.stringify({ version: 1, savedAt: new Date().toISOString(), retentionDays, maxPerRoom, rooms: Object.fromEntries(rooms) }, null, 2);
  const writer = createJsonWriter(filePath, payload);
  const get = (roomId) => {
    const key = String(roomId || '').trim().slice(0, 48);
    if (!rooms.has(key)) rooms.set(key, []);
    return rooms.get(key);
  };
  const find = (roomId, messageId) => get(roomId).find((message) => String(message?.messageId || '') === String(messageId || ''));
  const remember = (roomId, packet) => {
    if (!roomId || !packet?.messageId || !packet?.text) return null;
    const history = get(roomId);
    const existing = find(roomId, packet.messageId);
    if (existing) Object.assign(existing, packet);
    else history.push({ ...packet });
    if (history.length > maxPerRoom) history.splice(0, history.length - maxPerRoom);
    writer.schedule();
    return existing || history[history.length - 1];
  };
  const forget = (roomId, messageId) => {
    const history = get(roomId);
    const index = history.findIndex((message) => String(message?.messageId || '') === String(messageId || ''));
    if (index < 0) return null;
    const [removed] = history.splice(index, 1);
    writer.schedule();
    return removed;
  };
  const cleanup = ({ roomId = '', olderThanDays = retentionDays, clearAll = false } = {}) => {
    const cutoff = clearAll ? Infinity : (Number(olderThanDays) > 0 ? Date.now() - Number(olderThanDays) * 86400000 : 0);
    let removed = 0;
    const targets = roomId ? [[String(roomId), get(roomId)]] : [...rooms.entries()];
    for (const [key, history] of targets) {
      const kept = clearAll ? [] : history.filter((message) => !cutoff || Number(message?.createdAt || 0) >= cutoff);
      removed += history.length - kept.length;
      if (kept.length) rooms.set(key, kept.slice(-maxPerRoom));
      else rooms.delete(key);
    }
    if (removed) writer.schedule();
    return { removed, rooms: rooms.size };
  };
  const configure = (next = {}) => {
    maxPerRoom = positiveInteger(next.maxPerRoom, maxPerRoom);
    retentionDays = Math.max(0, Number(next.retentionDays ?? retentionDays) || 0);
    for (const [key, history] of rooms) if (history.length > maxPerRoom) rooms.set(key, history.slice(-maxPerRoom));
    cleanup({ olderThanDays: retentionDays });
    writer.schedule();
    return { maxPerRoom, retentionDays };
  };
  const stats = () => {
    let fileBytes = 0;
    try { fileBytes = fs.statSync(filePath).size; } catch { /* arquivo ainda não criado */ }
    let messages = 0;
    for (const history of rooms.values()) messages += history.length;
    return { filePath, fileBytes, messages, rooms: rooms.size, maxPerRoom, retentionDays };
  };
  const interval = setInterval(() => cleanup({ olderThanDays: retentionDays }), Math.max(60000, Number(options.cleanupIntervalMs) || 3600000));
  interval.unref?.();
  cleanup({ olderThanDays: retentionDays });
  return { get, find, remember, forget, touch: writer.schedule, cleanup, configure, stats, flush: writer.flush, close: () => { clearInterval(interval); writer.close(); } };
}

function createBugReportStore(options = {}) {
  const filePath = path.resolve(String(options.filePath || path.join(process.cwd(), 'data', 'bug-reports.json')));
  const maximum = positiveInteger(options.maximum, 500);
  const initial = readJson(filePath, { version: 1, reports: [] });
  const reports = Array.isArray(initial.reports) ? initial.reports.slice(0, maximum) : [];
  const writer = createJsonWriter(filePath, () => JSON.stringify({ version: 1, savedAt: new Date().toISOString(), reports }, null, 2));
  const add = (input = {}) => {
    const report = {
      id: `bug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: Date.now(),
      category: String(input.category || 'erro').trim().slice(0, 32),
      description: String(input.description || '').trim().slice(0, 4000),
      steps: String(input.steps || '').trim().slice(0, 4000),
      version: String(input.version || '').trim().slice(0, 48),
      platform: String(input.platform || '').trim().slice(0, 80),
      roomId: String(input.roomId || '').trim().slice(0, 48),
      clientId: String(input.clientId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80),
      name: String(input.name || '').trim().slice(0, 40),
      diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics.slice(-40).map((item) => String(item || '').slice(0, 500)) : []
    };
    if (!report.description) return null;
    reports.unshift(report);
    if (reports.length > maximum) reports.length = maximum;
    writer.schedule();
    return report;
  };
  const clear = () => { const removed = reports.length; reports.splice(0); writer.schedule(); return removed; };
  const list = (limit = 50) => reports.slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
  const stats = () => {
    let fileBytes = 0;
    try { fileBytes = fs.statSync(filePath).size; } catch { /* arquivo ainda não criado */ }
    return { filePath, fileBytes, reports: reports.length };
  };
  return { add, clear, list, stats, flush: writer.flush, close: writer.close };
}

module.exports = { createPersistentChatStore, createBugReportStore };
