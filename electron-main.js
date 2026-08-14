const { app, BrowserWindow, shell, desktopCapturer, ipcMain, Tray, Menu, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('node:dns').promises;
const nodeNet = require('node:net');
const { registerUpdateHandlers } = require('./update-helper');

let mainWindow;
let tray;
let isQuitting = false;
let closePromptOpen = false;
let youtubeHeadersConfigured = false;
let selectedCapture = { id: '', includeAudio: false };
let windowSettings = { closeBehavior: 'tray' };
const APP_WEB_IDENTITY = 'https://voiceup.shardweb.app/';
const LINK_PREVIEW_LIMIT = 640 * 1024;
const BACKGROUND_CAPTURE_TITLES = new Set([
  'program manager',
  'task view',
  'windows input experience',
  'microsoft text input application',
  'desktopwindowxamlsource',
  'search',
  'start'
]);
const settingsPath = () => path.join(app.getPath('userData'), 'window-settings.json');
const isPrivateAddress = (address) => {
  const value = String(address || '').toLowerCase().split('%')[0];
  if (nodeNet.isIP(value) === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (nodeNet.isIP(value) === 6) {
    if (value.startsWith('::ffff:')) return isPrivateAddress(value.slice(7));
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') ||
      /^fe[89ab]/.test(value) || value.startsWith('2001:db8:');
  }
  return true;
};
const publicPreviewUrl = async (raw) => {
  const url = new URL(String(raw || ''));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('URL não permitida.');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta não permitida.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('Host local não permitido.');
  const addresses = nodeNet.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Endereço privado não permitido.');
  return url;
};
const decodeHtml = (value) => String(value || '').replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code))).replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16))).replace(/&(?:amp|quot|apos|lt|gt|nbsp);/gi, (entity) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' }[entity.toLowerCase()] || entity));
const cleanPreviewText = (value, limit) => decodeHtml(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit);
const tagAttributes = (tag) => {
  const attributes = {};
  for (const match of String(tag).matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  return attributes;
};
const readLimitedText = async (response) => {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, LINK_PREVIEW_LIMIT);
  const decoder = new TextDecoder(); let total = 0; let result = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength; if (total > LINK_PREVIEW_LIMIT) { await reader.cancel(); break; }
    result += decoder.decode(value, { stream: true });
  }
  return result + decoder.decode();
};
const fetchLinkPreview = async (raw) => {
  let current = await publicPreviewUrl(raw);
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    let response;
    for (let redirect = 0; redirect < 4; redirect += 1) {
      response = await electronNet.fetch(current.href, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml;q=0.9', 'User-Agent': `VoiceUP/${app.getVersion()}` } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); if (!location) return null;
      current = await publicPreviewUrl(new URL(location, current).href);
    }
    if (!response?.ok || !String(response.headers.get('content-type') || '').toLowerCase().includes('text/html')) return null;
    if (Number(response.headers.get('content-length') || 0) > LINK_PREVIEW_LIMIT * 2) return null;
    const html = await readLimitedText(response); const metadata = {};
    for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
      const attributes = tagAttributes(tag); const key = String(attributes.property || attributes.name || '').toLowerCase();
      if (key && attributes.content && metadata[key] === undefined) metadata[key] = attributes.content;
    }
    const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
    const title = cleanPreviewText(metadata['og:title'] || metadata['twitter:title'] || titleTag, 140);
    const description = cleanPreviewText(metadata['og:description'] || metadata['twitter:description'] || metadata.description, 240);
    const siteName = cleanPreviewText(metadata['og:site_name'] || current.hostname.replace(/^www\./, ''), 70);
    const rawImage = metadata['og:image:secure_url'] || metadata['og:image'] || metadata['twitter:image'] || '';
    let image = '';
    if (rawImage) { try { const candidate = new URL(decodeHtml(rawImage), current); if (['http:', 'https:'].includes(candidate.protocol)) image = candidate.href; } catch { /* optional image */ } }
    return title || description || image ? { url: current.href, title, description, siteName, image } : null;
  } finally { clearTimeout(timeout); }
};
const configureYouTubeHeaders = (targetSession) => {
  if (youtubeHeadersConfigured) return; youtubeHeadersConfigured = true;
  targetSession.webRequest.onBeforeSendHeaders({ urls: ['https://www.youtube.com/*', 'https://www.youtube-nocookie.com/*'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders, Referer: details.requestHeaders.Referer || APP_WEB_IDENTITY };
    callback({ requestHeaders });
  });
};
const shareableDesktopSources = async (thumbnailSize = { width: 420, height: 236 }) => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], fetchWindowIcons: true, thumbnailSize });
  return sources.filter((source) => {
    if (source.id.startsWith('screen:')) return true;
    const title = String(source.name || '').trim().toLowerCase();
    // desktopCapturer also reports invisible helper windows. A window without a
    // title or a preview cannot be sensibly selected by a person.
    return Boolean(title) && !BACKGROUND_CAPTURE_TITLES.has(title);
  });
};
function loadSettings() { try { windowSettings = { ...windowSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* first start */ } }
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(windowSettings, null, 2), 'utf8'); } catch { /* optional preference */ } }
function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow().catch((error) => console.error('Não foi possível recriar a janela do VoiceUP:', error));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function createTray() {
  if (tray) return;
  tray = new Tray(path.join(__dirname, 'assets', 'voiceup-icon.ico'));
  tray.setToolTip('VoiceUP');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir VoiceUP', click: revealWindow }, { type: 'separator' }, { label: 'Encerrar programa', click: () => { isQuitting = true; app.quit(); } }]));
  tray.on('double-click', revealWindow);
}
async function createWindow() {
  loadSettings(); createTray();
  mainWindow = new BrowserWindow({ width: 1180, height: 760, minWidth: 780, minHeight: 600, title: 'VoiceUp', icon: path.join(__dirname, 'assets', 'voiceup-icon.ico'), backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'client-preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (windowSettings.closeBehavior === 'quit') { event.preventDefault(); isQuitting = true; app.quit(); return; }
    event.preventDefault();
    if (windowSettings.closeBehavior === 'ask') {
      if (!closePromptOpen) {
        closePromptOpen = true;
        mainWindow.webContents.send('window:confirm-close', { app: 'client' });
      }
      return;
    }
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; closePromptOpen = false; });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => callback(permission === 'media' || permission === 'display-capture'));
  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission) => permission === 'media' || permission === 'display-capture');
  configureYouTubeHeaders(mainWindow.webContents.session);
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await shareableDesktopSources();
      const source = sources.find((item) => item.id === selectedCapture.id) || sources[0];
      callback(source ? { video: source, ...(selectedCapture.includeAudio ? { audio: 'loopback' } : {}) } : {});
    } catch { callback({}); }
  });
  await mainWindow.loadFile(path.join(__dirname, 'public', 'index.html'), { query: { version: app.getVersion() } });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
registerUpdateHandlers(ipcMain, 'VoiceUP Setup ');
ipcMain.handle('capture:sources', async () => (await shareableDesktopSources()).map((source) => ({
  id: source.id,
  name: source.name,
  kind: source.id.startsWith('screen:') ? 'screen' : 'window',
  available: !source.thumbnail?.isEmpty?.(),
  thumbnail: source.thumbnail?.isEmpty?.() ? '' : source.thumbnail?.toDataURL?.() || '',
  appIcon: source.appIcon?.isEmpty?.() ? '' : source.appIcon?.toDataURL?.() || ''
})));
ipcMain.handle('capture:select', (_event, selection = {}) => { selectedCapture = { id: String(selection.id || ''), includeAudio: Boolean(selection.includeAudio) }; return true; });
ipcMain.handle('link:preview', async (_event, raw) => { try { return await fetchLinkPreview(raw); } catch { return null; } });
ipcMain.handle('window:set-video-fullscreen', (_event, enabled) => { mainWindow?.setFullScreen(Boolean(enabled)); return Boolean(enabled); });
ipcMain.handle('window:settings', () => windowSettings);
ipcMain.handle('window:save-settings', (_event, next = {}) => { const allowed = ['tray', 'ask', 'quit']; windowSettings.closeBehavior = allowed.includes(next.closeBehavior) ? next.closeBehavior : 'tray'; saveSettings(); return windowSettings; });
ipcMain.handle('window:close-choice', (_event, choice) => {
  if (!closePromptOpen) return false;
  closePromptOpen = false;
  if (choice === 'tray') { mainWindow?.hide(); return true; }
  if (choice === 'quit') { isQuitting = true; app.quit(); return true; }
  return true;
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (isQuitting || windowSettings.closeBehavior === 'quit')) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else revealWindow(); });
app.on('before-quit', () => { isQuitting = true; });
