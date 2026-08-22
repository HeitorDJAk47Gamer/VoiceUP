const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const positive = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
};

const safeRoom = (room) => String(room || '').trim().slice(0, 48);
const fileSize = (file) => { try { return fs.statSync(file).size; } catch { return 0; } };
const messageTime = (packet) => {
  const value = Number(packet?.createdAt || packet?.editedAt || Date.now());
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : Date.now();
};

function openDatabase(filePath) {
  const resolved = path.resolve(filePath || path.join(process.cwd(), 'data', 'voiceup.db'));
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      room_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      text_channel TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (room_id, message_id)
    );
    CREATE INDEX IF NOT EXISTS chat_messages_room_created
      ON chat_messages (room_id, created_at, message_id);
    CREATE TABLE IF NOT EXISTS bug_reports (
      id TEXT PRIMARY KEY,
      received_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS bug_reports_received
      ON bug_reports (received_at DESC);
  `);
  return { db, filePath: resolved };
}

function metaValue(db, key) {
  return db.prepare('SELECT value FROM storage_meta WHERE key = ?').get(key)?.value || '';
}

function setMeta(db, key, value = '1') {
  db.prepare('INSERT OR REPLACE INTO storage_meta (key, value) VALUES (?, ?)').run(key, value);
}

function createPersistentChatStore(options = {}) {
  const { db, filePath } = openDatabase(options.filePath);
  const legacyFilePath = path.resolve(options.legacyFilePath || path.join(path.dirname(filePath), 'chat-history.json'));
  let maxPerRoom = positive(options.maxPerRoom, 300);
  let retentionDays = Math.max(0, Number(options.retentionDays) || 0);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO chat_messages (room_id, message_id, created_at, text_channel, payload)
    VALUES (?, ?, ?, ?, ?)
  `);
  const getMessages = db.prepare(`
    SELECT payload FROM chat_messages
    WHERE room_id = ?
    ORDER BY created_at ASC, message_id ASC
    LIMIT ?
  `);
  const findMessage = db.prepare('SELECT payload FROM chat_messages WHERE room_id = ? AND message_id = ?');
  const deleteMessage = db.prepare('DELETE FROM chat_messages WHERE room_id = ? AND message_id = ?');
  const pruneRoom = db.prepare(`
    DELETE FROM chat_messages
    WHERE room_id = ? AND message_id NOT IN (
      SELECT message_id FROM chat_messages
      WHERE room_id = ?
      ORDER BY created_at DESC, message_id DESC
      LIMIT ?
    )
  `);

  const parsePacket = (row) => {
    try { return JSON.parse(row?.payload || ''); } catch { return null; }
  };
  const prune = (room) => pruneRoom.run(room, room, maxPerRoom);
  const remember = (room, packet) => {
    const roomId = safeRoom(room);
    const messageId = String(packet?.messageId || '').trim().slice(0, 120);
    if (!roomId || !messageId) return null;
    const stored = { ...packet, messageId };
    insert.run(roomId, messageId, messageTime(stored), String(stored.textChannel || 'geral').slice(0, 24), JSON.stringify(stored));
    prune(roomId);
    return stored;
  };

  const migrateLegacyHistory = () => {
    const migrationKey = 'legacy-chat-history-v1';
    if (metaValue(db, migrationKey)) return;
    const legacy = readJson(legacyFilePath, { rooms: {} });
    const rooms = legacy && typeof legacy.rooms === 'object' ? legacy.rooms : {};
    db.exec('BEGIN');
    try {
      for (const [room, messages] of Object.entries(rooms)) {
        if (!Array.isArray(messages)) continue;
        for (const packet of messages.slice(-maxPerRoom)) remember(room, packet);
      }
      setMeta(db, migrationKey, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  migrateLegacyHistory();

  const get = (room) => getMessages.all(safeRoom(room), maxPerRoom).map(parsePacket).filter(Boolean);
  const find = (room, id) => parsePacket(findMessage.get(safeRoom(room), String(id || '').slice(0, 120)));
  const forget = (room, id) => {
    const packet = find(room, id);
    if (!packet) return null;
    deleteMessage.run(safeRoom(room), String(id || '').slice(0, 120));
    return packet;
  };
  const cleanup = ({ roomId = '', olderThanDays = retentionDays, clearAll = false } = {}) => {
    const scopedRoom = safeRoom(roomId);
    const cutoff = Number(olderThanDays) > 0 ? Date.now() - Number(olderThanDays) * 86400000 : 0;
    const clauses = [];
    const values = [];
    if (scopedRoom) { clauses.push('room_id = ?'); values.push(scopedRoom); }
    if (!clearAll && cutoff) { clauses.push('created_at < ?'); values.push(cutoff); }
    if (!clearAll && !cutoff) return stats();
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const before = Number(db.prepare(`SELECT COUNT(*) AS count FROM chat_messages${where}`).get(...values)?.count || 0);
    db.prepare(`DELETE FROM chat_messages${where}`).run(...values);
    return { removed: before, rooms: Number(db.prepare('SELECT COUNT(DISTINCT room_id) AS count FROM chat_messages').get()?.count || 0) };
  };
  const configure = (next = {}) => {
    maxPerRoom = positive(next.maxPerRoom, maxPerRoom);
    retentionDays = Math.max(0, Number(next.retentionDays ?? retentionDays) || 0);
    cleanup({ olderThanDays: retentionDays });
    return { maxPerRoom, retentionDays };
  };
  const stats = () => ({
    engine: 'sqlite',
    filePath,
    fileBytes: fileSize(filePath) + fileSize(`${filePath}-wal`),
    messages: Number(db.prepare('SELECT COUNT(*) AS count FROM chat_messages').get()?.count || 0),
    rooms: Number(db.prepare('SELECT COUNT(DISTINCT room_id) AS count FROM chat_messages').get()?.count || 0),
    maxPerRoom,
    retentionDays,
    memoryCache: 'none'
  });
  const interval = setInterval(() => cleanup({ olderThanDays: retentionDays }), 3600000);
  interval.unref?.();
  cleanup({ olderThanDays: retentionDays });

  return {
    get,
    find,
    remember,
    save: remember,
    forget,
    touch: () => {},
    cleanup,
    configure,
    stats,
    flush: () => { try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {} },
    close: () => { clearInterval(interval); try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} }
  };
}

function createBugReportStore(options = {}) {
  const { db, filePath } = openDatabase(options.filePath);
  const legacyFilePath = path.resolve(options.legacyFilePath || path.join(path.dirname(filePath), 'bug-reports.json'));
  const insert = db.prepare('INSERT OR REPLACE INTO bug_reports (id, received_at, payload) VALUES (?, ?, ?)');

  const migrateLegacyReports = () => {
    const migrationKey = 'legacy-bug-reports-v1';
    if (metaValue(db, migrationKey)) return;
    const legacy = readJson(legacyFilePath, { reports: [] });
    const reports = Array.isArray(legacy?.reports) ? legacy.reports.slice(0, 500) : [];
    db.exec('BEGIN');
    try {
      for (const report of reports) {
        if (!report?.id) continue;
        insert.run(String(report.id).slice(0, 120), Number(report.receivedAt || Date.now()), JSON.stringify(report));
      }
      setMeta(db, migrationKey, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  migrateLegacyReports();

  const add = (input = {}) => {
    const description = String(input.description || '').trim().slice(0, 4000);
    if (!description) return null;
    const report = {
      id: `bug-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      receivedAt: Date.now(),
      category: String(input.category || 'erro').slice(0, 32),
      description,
      steps: String(input.steps || '').slice(0, 4000),
      version: String(input.version || '').slice(0, 48),
      platform: String(input.platform || '').slice(0, 80),
      roomId: String(input.roomId || '').slice(0, 48),
      clientId: String(input.clientId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80),
      name: String(input.name || '').slice(0, 40),
      diagnostics: Array.isArray(input.diagnostics) ? input.diagnostics.slice(-40).map((item) => String(item).slice(0, 500)) : []
    };
    insert.run(report.id, report.receivedAt, JSON.stringify(report));
    db.prepare(`DELETE FROM bug_reports WHERE id NOT IN (
      SELECT id FROM bug_reports ORDER BY received_at DESC, id DESC LIMIT 500
    )`).run();
    return report;
  };
  const list = (limit = 50) => db.prepare('SELECT payload FROM bug_reports ORDER BY received_at DESC, id DESC LIMIT ?').all(Math.min(500, positive(limit, 50))).map((row) => {
    try { return JSON.parse(row.payload); } catch { return null; }
  }).filter(Boolean);
  const clear = () => {
    const total = Number(db.prepare('SELECT COUNT(*) AS count FROM bug_reports').get()?.count || 0);
    db.exec('DELETE FROM bug_reports');
    return total;
  };
  const stats = () => ({
    engine: 'sqlite',
    filePath,
    fileBytes: fileSize(filePath) + fileSize(`${filePath}-wal`),
    reports: Number(db.prepare('SELECT COUNT(*) AS count FROM bug_reports').get()?.count || 0),
    memoryCache: 'none'
  });
  return {
    add,
    list,
    clear,
    stats,
    flush: () => { try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {} },
    close: () => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} }
  };
}

module.exports = { createPersistentChatStore, createBugReportStore };
