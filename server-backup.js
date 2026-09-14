'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BACKUP_SCHEMA = 'voiceup-server-backup';
const BACKUP_FORMAT_VERSION = 1;
const BACKUP_EXTENSION = '.voiceup-backup';
const MAX_FILES = 10000;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 520 * 1024 * 1024;
const CORE_FILES = Object.freeze([
  'server-settings.json',
  'chat-history.json',
  'bans.json',
  'chat-punishments.json',
  'bug-reports.json',
  'plugin-settings.json',
  'security-audit.json',
  'client-identities.json'
]);
const MANAGED_ROOTS = Object.freeze([...CORE_FILES, 'plugins', 'music', 'attachments']);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const clone = (value) => JSON.parse(JSON.stringify(value));
const safeVersion = (value) => String(value || '').replace(/[^a-z0-9.+_-]/gi, '').slice(0, 48) || 'desconhecida';
const safeInside = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};
const safeSegment = (segment) => Boolean(segment)
  && !/[<>:"|?*\x00-\x1f]/.test(segment)
  && !/[. ]$/.test(segment)
  && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment);

function normalizeArchivePath(value) {
  const raw = String(value || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-z]:/i.test(raw)) return '';
  const parts = raw.split('/');
  if (parts.some((segment) => !safeSegment(segment) || segment === '.' || segment === '..')) return '';
  return parts.join('/');
}

function allowedArchivePath(value) {
  const relative = normalizeArchivePath(value);
  if (!relative) return false;
  if (CORE_FILES.includes(relative)) return true;
  if (/^attachments\/[a-f0-9]{32}\.(?:bin|json)$/.test(relative)) return true;
  if (/^plugins\/(?:[^/]+\/)*[^/]+\.js$/i.test(relative)) return true;
  return /^music\/(?:[^/]+\/)*(?:[^/]+\.(?:mp3|ogg|wav|m4a|aac)|README\.md)$/i.test(relative);
}

function collectDirectoryFiles(sourceDirectory, rootName, matcher, output, depth = 0) {
  const root = path.join(sourceDirectory, rootName);
  if (!fs.existsSync(root) || depth > 8) return;
  const walk = (current, currentDepth) => {
    if (currentDepth > 8) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) { walk(absolute, currentDepth + 1); continue; }
      if (!stat.isFile()) continue;
      const relative = path.relative(sourceDirectory, absolute).split(path.sep).join('/');
      if (matcher(relative)) output.push({ relative, absolute, size: stat.size });
    }
  };
  walk(root, depth);
}

function collectBackupFiles(sourceDirectory, options = {}) {
  const root = path.resolve(String(sourceDirectory || ''));
  if (!root || !fs.existsSync(root)) throw new Error('A pasta de dados do ServerHost não foi encontrada.');
  const files = [];
  for (const relative of CORE_FILES) {
    const absolute = path.join(root, relative);
    try {
      const stat = fs.lstatSync(absolute);
      if (stat.isFile() && !stat.isSymbolicLink()) files.push({ relative, absolute, size: stat.size });
    } catch { /* arquivos opcionais ainda não criados são ignorados */ }
  }
  collectDirectoryFiles(root, 'attachments', relative => /^attachments\/[a-f0-9]{32}\.(?:bin|json)$/.test(relative), files);
  if (options.includePlugins !== false) collectDirectoryFiles(root, 'plugins', (relative) => /^plugins\/(?:[^/]+\/)*[^/]+\.js$/i.test(relative), files);
  if (options.includeMusic === true) collectDirectoryFiles(root, 'music', (relative) => /^music\/(?:[^/]+\/)*(?:[^/]+\.(?:mp3|ogg|wav|m4a|aac)|README\.md)$/i.test(relative), files);
  files.sort((left, right) => left.relative.localeCompare(right.relative, 'en'));
  if (!files.some((entry) => entry.relative === 'server-settings.json')) throw new Error('As configurações principais ainda não foram salvas; abra novamente o ServerHost e tente de novo.');
  if (files.length > MAX_FILES) throw new Error(`O backup ultrapassa o limite seguro de ${MAX_FILES} arquivos.`);
  const totalBytes = files.reduce((sum, entry) => {
    if (entry.size > MAX_FILE_BYTES) throw new Error(`${entry.relative} é grande demais para o backup interno do VoiceUP.`);
    return sum + entry.size;
  }, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('O backup ultrapassa 384 MB. Desmarque as músicas ou reduza os arquivos antes de tentar novamente.');
  return { root, files, totalBytes };
}

function backupSummary(manifest, files) {
  const count = (prefix) => files.filter((entry) => entry.path.startsWith(prefix)).length;
  return {
    schema: manifest.schema,
    formatVersion: manifest.formatVersion,
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    sourceVersion: manifest.sourceVersion,
    totalBytes: Number(manifest.totalBytes) || files.reduce((sum, entry) => sum + Number(entry.size || 0), 0),
    fileCount: files.length,
    coreFileCount: files.filter((entry) => CORE_FILES.includes(entry.path)).length,
    pluginFileCount: count('plugins/'),
    musicFileCount: count('music/'),
    includes: { core: true, plugins: manifest.includes?.plugins === true, music: manifest.includes?.music === true, attachments: manifest.includes?.attachments === true }
  };
}

function encodeServerBackup({ sourceDirectory, appVersion = '', includePlugins = true, includeMusic = false } = {}) {
  const collected = collectBackupFiles(sourceDirectory, { includePlugins, includeMusic });
  const files = collected.files.map((entry) => {
    const content = fs.readFileSync(entry.absolute);
    return { path: entry.relative, size: content.length, sha256: sha256(content), data: content.toString('base64') };
  });
  const manifest = {
    schema: BACKUP_SCHEMA,
    formatVersion: BACKUP_FORMAT_VERSION,
    backupId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    sourceVersion: safeVersion(appVersion),
    totalBytes: collected.totalBytes,
    includes: { core: true, plugins: includePlugins !== false, music: includeMusic === true, attachments: true }
  };
  const serialized = Buffer.from(JSON.stringify({ manifest, files }), 'utf8');
  if (serialized.length > MAX_UNCOMPRESSED_BYTES) throw new Error('Os dados do backup ultrapassam o limite de memória seguro.');
  return { archive: zlib.gzipSync(serialized, { level: 9 }), summary: backupSummary(manifest, files) };
}

function createServerBackup({ sourceDirectory, destinationFile, appVersion = '', includePlugins = true, includeMusic = false } = {}) {
  const destination = path.resolve(String(destinationFile || ''));
  if (!destination) throw new Error('Escolha onde salvar o backup.');
  const { archive, summary } = encodeServerBackup({ sourceDirectory, appVersion, includePlugins, includeMusic });
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('O arquivo compactado ultrapassa o limite seguro de 512 MB.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.part-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporary, archive, { flag: 'wx', mode: 0o600 });
    fs.copyFileSync(temporary, destination);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* nenhuma sobra temporária */ }
  }
  return { ...summary, archiveBytes: archive.length, archiveSha256: sha256(archive), filePath: destination };
}

function decodeServerBackup(sourceFile) {
  const source = path.resolve(String(sourceFile || ''));
  const compressed = fs.readFileSync(source);
  if (!compressed.length || compressed.length > MAX_ARCHIVE_BYTES) throw new Error('O arquivo de backup está vazio ou é grande demais.');
  let payload;
  try {
    const decoded = zlib.gunzipSync(compressed, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    payload = JSON.parse(decoded.toString('utf8'));
  } catch (error) {
    throw new Error(`Backup inválido ou corrompido: ${error?.message || 'não foi possível abrir o arquivo'}`);
  }
  const manifest = payload?.manifest;
  if (!manifest || manifest.schema !== BACKUP_SCHEMA) throw new Error('Este arquivo não é um backup do VoiceUP ServerHost.');
  if (Number(manifest.formatVersion) !== BACKUP_FORMAT_VERSION) throw new Error(`Formato de backup ${manifest.formatVersion || '?'} ainda não suportado por esta versão.`);
  if (!Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) throw new Error('A lista de arquivos do backup é inválida.');
  const seen = new Set();
  let totalBytes = 0;
  const files = payload.files.map((entry) => {
    const relative = normalizeArchivePath(entry?.path);
    if (!allowedArchivePath(relative) || seen.has(relative)) throw new Error(`Caminho bloqueado no backup: ${String(entry?.path || 'vazio')}`);
    seen.add(relative);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new Error(`Tamanho inválido para ${relative}.`);
    if (typeof entry.data !== 'string' || (entry.data && !/^[a-z0-9+/]+={0,2}$/i.test(entry.data))) throw new Error(`Conteúdo inválido para ${relative}.`);
    const content = Buffer.from(entry.data, 'base64');
    if (content.length !== entry.size || sha256(content) !== String(entry.sha256 || '').toLowerCase()) throw new Error(`A verificação de integridade falhou em ${relative}.`);
    if (CORE_FILES.includes(relative)) {
      try { const json = JSON.parse(content.toString('utf8')); if (!json || typeof json !== 'object') throw new Error(); }
      catch { throw new Error(`${relative} não contém JSON válido.`); }
    }
    totalBytes += content.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('O conteúdo do backup ultrapassa o limite seguro de 384 MB.');
    return { path: relative, size: content.length, sha256: entry.sha256, content };
  });
  if (!seen.has('server-settings.json')) throw new Error('O backup não contém as configurações principais do servidor.');
  if (Number(manifest.totalBytes) !== totalBytes) throw new Error('O tamanho total do backup não corresponde ao manifesto.');
  const summary = backupSummary(manifest, files);
  return { source, archiveSha256: sha256(compressed), manifest: clone(manifest), files, summary };
}

function inspectServerBackup(sourceFile) {
  const decoded = decodeServerBackup(sourceFile);
  return { ...decoded.summary, archiveSha256: decoded.archiveSha256, filePath: decoded.source };
}

function contentForRestore(entry) {
  if (entry.path !== 'plugin-settings.json') return { content: entry.content, approvalsReset: false };
  const parsed = JSON.parse(entry.content.toString('utf8'));
  const approvalsReset = parsed.approvals && Object.keys(parsed.approvals).length > 0;
  parsed.approvals = {};
  return { content: Buffer.from(JSON.stringify(parsed, null, 2), 'utf8'), approvalsReset };
}

function restoreServerBackup({ sourceFile, destinationDirectory } = {}) {
  const decoded = decodeServerBackup(sourceFile);
  const root = path.resolve(String(destinationDirectory || ''));
  if (!root) throw new Error('A pasta de dados do ServerHost é inválida.');
  fs.mkdirSync(root, { recursive: true });
  const operationId = crypto.randomUUID();
  const stage = path.join(root, `.voiceup-restore-stage-${operationId}`);
  const previous = path.join(root, `.voiceup-restore-previous-${operationId}`);
  if (!safeInside(root, stage) || !safeInside(root, previous)) throw new Error('A restauração foi bloqueada por segurança.');
  const replaceRoots = [...CORE_FILES];
  if (decoded.summary.includes.attachments) replaceRoots.push('attachments');
  if (decoded.summary.includes.plugins) replaceRoots.push('plugins');
  if (decoded.summary.includes.music) replaceRoots.push('music');
  const movedPrevious = [];
  const movedRestored = [];
  let approvalsReset = false;
  try {
    fs.mkdirSync(stage, { recursive: false });
    for (const entry of decoded.files) {
      const destination = path.resolve(stage, ...entry.path.split('/'));
      if (!safeInside(stage, destination)) throw new Error(`Destino bloqueado: ${entry.path}`);
      const prepared = contentForRestore(entry);
      approvalsReset ||= prepared.approvalsReset;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, prepared.content, { mode: 0o600 });
    }
    fs.mkdirSync(previous, { recursive: false });
    for (const rootName of replaceRoots) {
      const current = path.join(root, rootName);
      if (!fs.existsSync(current)) continue;
      const old = path.join(previous, rootName);
      fs.mkdirSync(path.dirname(old), { recursive: true });
      fs.renameSync(current, old);
      movedPrevious.push(rootName);
    }
    for (const rootName of replaceRoots) {
      const staged = path.join(stage, rootName);
      if (!fs.existsSync(staged)) continue;
      const destination = path.join(root, rootName);
      fs.renameSync(staged, destination);
      movedRestored.push(rootName);
    }
    fs.rmSync(previous, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true });
    return { ...decoded.summary, ok: true, restoredFiles: decoded.files.length, approvalsReset };
  } catch (error) {
    for (const rootName of [...movedRestored].reverse()) {
      const destination = path.join(root, rootName);
      try { fs.rmSync(destination, { recursive: true, force: true }); } catch { /* melhor esforço */ }
    }
    for (const rootName of [...movedPrevious].reverse()) {
      const old = path.join(previous, rootName);
      const destination = path.join(root, rootName);
      try { if (fs.existsSync(old)) fs.renameSync(old, destination); } catch { /* o backup automático permanece disponível */ }
    }
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* melhor esforço */ }
    try { fs.rmSync(previous, { recursive: true, force: true }); } catch { /* melhor esforço */ }
    throw new Error(`Não foi possível restaurar o backup: ${error?.message || 'falha ao substituir os dados'}`);
  }
}

function suggestedBackupName(date = new Date()) {
  const stamp = date.toISOString().replace(/T/, '_').replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
  return `VoiceUP-Server-${stamp}${BACKUP_EXTENSION}`;
}

module.exports = {
  BACKUP_SCHEMA,
  BACKUP_FORMAT_VERSION,
  BACKUP_EXTENSION,
  CORE_FILES,
  MANAGED_ROOTS,
  createServerBackup,
  inspectServerBackup,
  restoreServerBackup,
  suggestedBackupName,
  normalizeArchivePath,
  allowedArchivePath
};
