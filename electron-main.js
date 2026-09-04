const { app, BrowserWindow, shell, desktopCapturer, ipcMain, Tray, Menu, globalShortcut, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const dns = require('node:dns').promises;
const nodeNet = require('node:net');
const { registerUpdateHandlers } = require('./update-helper');
const { startSignalingServer, normalizeRoomLayout, hashRoomPassword } = require('./signaling-server');
const { localNetworkUrls, openPublicPort } = require('./network-access');

let mainWindow;
let tray;
let isQuitting = false;
let closePromptOpen = false;
let youtubeHeadersConfigured = false;
let selectedCapture = { id: '', kind: '', includeAudio: false };
let processAudioCapture = null;
let directRoomServer = null;
let directPortMapping = null;
const defaultCloseBehavior = () => process.platform === 'linux' ? 'ask' : 'tray';
let windowSettings = { closeBehavior: defaultCloseBehavior(), hardwareAcceleration: true, fullscreenGameCaptureCompatibility: true };
let hardwareAccelerationAtStartup = true;
let fullscreenGameCaptureCompatibilityAtStartup = false;
const registeredShortcuts = new Map();
const APP_WEB_IDENTITY = 'https://voiceup.shardweb.app/';
const CLIENT_ENTRY = path.join(__dirname, 'public', 'index.html');
const APP_ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'voiceup-icon.ico' : 'voiceup-logo-2d.png');
const RNNOISE_ASSET_LIMIT = 512 * 1024;
const RNNOISE_ASSETS = Object.freeze({
  wasm: path.join(__dirname, 'public', 'vendor', 'rnnoise', 'rnnoise.wasm'),
  simd: path.join(__dirname, 'public', 'vendor', 'rnnoise', 'rnnoise_simd.wasm')
});
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
const isTrustedClientUrl = (value) => {
  try {
    const target = new URL(String(value || ''));
    return target.protocol === 'file:' && path.resolve(fileURLToPath(target)) === path.resolve(CLIENT_ENTRY);
  } catch { return false; }
};
const isTrustedClientContents = (webContents) => Boolean(
  mainWindow && !mainWindow.isDestroyed() && webContents === mainWindow.webContents && isTrustedClientUrl(webContents.getURL())
);
const isTrustedClientEvent = (event) => Boolean(
  isTrustedClientContents(event?.sender) && isTrustedClientUrl(event?.senderFrame?.url || event.sender.getURL())
);
const secureHandle = (channel, handler) => ipcMain.handle(channel, (event, ...args) => {
  if (!isTrustedClientEvent(event)) throw new Error('Solicitação bloqueada pelo VoiceUP.');
  return handler(event, ...args);
});
const safeExternalUrl = (value) => {
  try {
    const target = new URL(String(value || ''));
    return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password ? target.href : '';
  } catch { return ''; }
};
const availableTcpPort = () => new Promise((resolve, reject) => {
  const probe = nodeNet.createServer();
  probe.unref();
  probe.once('error', reject);
  probe.listen(0, '0.0.0.0', () => {
    const port = Number(probe.address()?.port || 0);
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});
const serializablePublicAccess = (value = {}) => {
  const { close: _close, ...snapshot } = value || {};
  return snapshot;
};
const stopDirectRoom = async () => {
  const mapping = directPortMapping; directPortMapping = null;
  const current = directRoomServer; directRoomServer = null;
  try { await mapping?.close?.(); } catch { /* mapping can already be gone */ }
  if (!current) return { ok: true, message: 'A sala direta já está desligada.' };
  try { current.closeFederation?.(); } catch { /* optional */ }
  await new Promise((resolve) => {
    try { current.io.close(() => resolve()); } catch { resolve(); }
  });
  return { ok: true, message: 'Sala direta encerrada.' };
};
const directRoomStatus = () => directRoomServer ? {
  ok: true,
  active: true,
  port: directRoomServer.port,
  roomId: directRoomServer.roomId,
  localUrl: directRoomServer.localUrl,
  networkUrls: directRoomServer.networkUrls,
  access: directRoomServer.access,
  shareCode: directRoomServer.shareCode
} : { ok: true, active: false };
const startDirectRoom = async (input = {}) => {
  await stopDirectRoom();
  const port = await availableTcpPort();
  const roomId = String(input.roomId || `direta-${crypto.randomBytes(4).toString('hex')}`)
    .trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 48) || `direta-${crypto.randomBytes(4).toString('hex')}`;
  const roomName = String(input.name || 'Sala direta').trim().slice(0, 42) || 'Sala direta';
  const password = String(input.password || '').slice(0, 128);
  const dataDirectory = path.join(app.getPath('userData'), 'direct-room-data');
  fs.mkdirSync(dataDirectory, { recursive: true });
  const layout = normalizeRoomLayout({
    id: roomId,
    name: roomName,
    passwordHash: password ? hashRoomPassword(password) : '',
    voiceChannelSettings: [{ name: 'Geral', userLimit: 12 }],
    textChannelSettings: [{ name: 'geral' }]
  });
  const signaling = await startSignalingServer(port, {
    roomLayouts: [layout],
    historyFile: path.join(dataDirectory, 'chat-history.json'),
    reportsFile: path.join(dataDirectory, 'bug-reports.json'),
    identityFile: path.join(dataDirectory, 'client-identities.json'),
    version: app.getVersion(),
    chatRetentionDays: 30,
    chatMaxPerRoom: 300
  });
  const localUrl = `http://127.0.0.1:${port}`;
  const networkUrls = localNetworkUrls(port);
  directRoomServer = { ...signaling, roomId, localUrl, networkUrls, access: { status: 'checking', mapped: false }, shareCode: '' };

  let access = { status: 'disabled', mapped: false, message: 'Acesso automático não solicitado.' };
  if (input.publicAccess === true) access = await openPublicPort(port, { description: `VoiceUP sala ${roomId}`, timeoutMs: 7500 });
  directPortMapping = access.mapped ? access : null;
  const publicAccess = serializablePublicAccess(access);
  const shareHost = publicAccess.scope === 'public' && publicAccess.publicUrl ? publicAccess.publicUrl : (networkUrls[0] || localUrl);
  const shareCode = `VU2:${Buffer.from(JSON.stringify({ host: shareHost, roomId, private: Boolean(password), name: roomName }), 'utf8').toString('base64')}`;
  Object.assign(directRoomServer, { access: publicAccess, shareCode });
  return {
    ok: true, active: true, port, roomId, roomName, private: Boolean(password),
    localUrl, networkUrls, access: publicAccess, shareCode,
    message: publicAccess.scope === 'public'
      ? 'Sala direta criada e liberada automaticamente no roteador.'
      : 'Sala direta criada. O link funciona nesta rede; confira o diagnóstico para acesso pela internet.'
  };
};
const processAudioHelperPath = () => app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'voiceup-process-audio.exe')
  : path.join(__dirname, 'native', 'voiceup-process-audio.exe');
const processAudioCapability = () => ({
  available: process.platform === 'win32' && fs.existsSync(processAudioHelperPath()),
  mode: process.platform === 'win32' ? 'process-tree-include-exclude' : 'unavailable',
  reason: process.platform === 'linux' ? 'linux-loopback-not-supported' : '',
  platform: process.platform,
  sampleRate: 48000,
  channels: 2
});
const sendProcessAudioState = (details) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('capture:process-audio-state', details);
};
function stopProcessAudioCapture(reason = 'stopped') {
  const current = processAudioCapture;
  processAudioCapture = null;
  if (!current) return false;
  current.expectedStop = true;
  clearTimeout(current.timeout);
  try { current.child.stdout?.removeAllListeners(); current.child.stderr?.removeAllListeners(); current.child.kill(); } catch { /* already stopped */ }
  sendProcessAudioState({ active: false, reason, sourceId: current.sourceId });
  return true;
}
function startProcessAudioCapture(sourceId) {
  stopProcessAudioCapture('replaced');
  const capability = processAudioCapability();
  if (!capability.available) return Promise.resolve({ ok: false, reason: 'native-helper-unavailable' });
  if (selectedCapture.id !== sourceId || !selectedCapture.includeAudio) {
    return Promise.resolve({ ok: false, reason: 'invalid-capture-source' });
  }
  const handle = String(sourceId || '').match(/^window:([^:]+):/)?.[1] || '';
  const captureMode = selectedCapture.kind === 'window' ? 'selected-app' : selectedCapture.kind === 'screen' ? 'system-without-voiceup' : '';
  const helperArguments = captureMode === 'selected-app'
    ? (handle ? ['capture-window', handle] : null)
    : captureMode === 'system-without-voiceup'
      ? ['capture-exclude-pid', String(process.pid)]
      : null;
  if (!helperArguments) return Promise.resolve({ ok: false, reason: 'invalid-capture-source' });

  return new Promise((resolve) => {
    let settled = false;
    let stderrBuffer = '';
    const child = spawn(processAudioHelperPath(), helperArguments, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const state = { child, sourceId, expectedStop: false, timeout: null, remainder: Buffer.alloc(0) };
    processAudioCapture = state;
    const finishStart = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(state.timeout);
      resolve(result);
    };
    state.timeout = setTimeout(() => {
      if (processAudioCapture === state) stopProcessAudioCapture('startup-timeout');
      finishStart({ ok: false, reason: 'startup-timeout' });
    }, 11000);

    child.stdout.on('data', (chunk) => {
      if (processAudioCapture !== state || !chunk?.length || !mainWindow || mainWindow.isDestroyed()) return;
      const combined = state.remainder.length ? Buffer.concat([state.remainder, chunk]) : chunk;
      const alignedLength = combined.length - (combined.length % 4);
      if (!alignedLength) { state.remainder = Buffer.from(combined); return; }
      state.remainder = alignedLength < combined.length ? Buffer.from(combined.subarray(alignedLength)) : Buffer.alloc(0);
      mainWindow.webContents.send('capture:process-audio-data', combined.subarray(0, alignedLength));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      stderrBuffer += text;
      const lines = stderrBuffer.split(/\r?\n/);
      stderrBuffer = lines.pop() || '';
      for (const line of lines) {
        const ready = line.match(/^VOICEUP_READY\s+(\d+)\s+(\d+)\s+(\d+)/);
        if (ready) {
          const result = { ok: true, sampleRate: Number(ready[1]), channels: Number(ready[2]), processId: Number(ready[3]), sourceId, captureMode };
          sendProcessAudioState({ active: true, ...result });
          finishStart(result);
        }
      }
    });
    child.once('error', (error) => {
      if (processAudioCapture === state) processAudioCapture = null;
      finishStart({ ok: false, reason: 'spawn-failed', message: error.message });
      sendProcessAudioState({ active: false, reason: 'spawn-failed', sourceId });
    });
    child.once('exit', (code) => {
      if (processAudioCapture === state) processAudioCapture = null;
      finishStart({ ok: false, reason: state.expectedStop ? 'stopped' : 'capture-ended', code });
      if (!state.expectedStop) sendProcessAudioState({ active: false, reason: 'capture-ended', code, sourceId });
    });
  });
}
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
      response = await electronNet.fetch(current.href, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,image/avif,image/webp,image/apng,image/*;q=0.8', 'User-Agent': `VoiceUP/${app.getVersion()}` } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location'); if (!location) return null;
      current = await publicPreviewUrl(new URL(location, current).href);
    }
    if (!response?.ok) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    // URLs such as a CDN's /revision/latest have no useful final extension,
    // but their response still identifies itself as an image.  Returning this
    // marker lets the renderer replace the regular link with an image embed.
    if (/^image\/(?:avif|bmp|gif|jpe?g|png|webp)/.test(contentType)) {
      await response.body?.cancel?.().catch(() => {});
      return { url: current.href, image: current.href, type: 'image' };
    }
    if (!contentType.includes('text/html')) return null;
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
    if (rawImage) { try { const candidate = new URL(decodeHtml(rawImage), current); image = (await publicPreviewUrl(candidate.href)).href; } catch { /* optional image */ } }
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
function loadSettings() {
  try { windowSettings = { ...windowSettings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch { /* first start */ }
  windowSettings.closeBehavior = ['tray', 'ask', 'quit'].includes(windowSettings.closeBehavior) ? windowSettings.closeBehavior : defaultCloseBehavior();
  windowSettings.hardwareAcceleration = windowSettings.hardwareAcceleration !== false;
  windowSettings.fullscreenGameCaptureCompatibility = windowSettings.fullscreenGameCaptureCompatibility !== false;
}
function saveSettings() { try { fs.writeFileSync(settingsPath(), JSON.stringify(windowSettings, null, 2), 'utf8'); } catch { /* optional preference */ } }
const publicWindowSettings = () => ({
  platform: process.platform,
  closeBehavior: windowSettings.closeBehavior,
  hardwareAcceleration: windowSettings.hardwareAcceleration !== false,
  hardwareAccelerationActive: hardwareAccelerationAtStartup,
  fullscreenGameCaptureCompatibility: windowSettings.fullscreenGameCaptureCompatibility !== false,
  fullscreenGameCaptureCompatibilityActive: fullscreenGameCaptureCompatibilityAtStartup,
  fullscreenGameCaptureCompatibilitySupported: process.platform === 'win32',
  restartRequired: (windowSettings.hardwareAcceleration !== false) !== hardwareAccelerationAtStartup
    || (process.platform === 'win32'
      && (windowSettings.fullscreenGameCaptureCompatibility !== false) !== fullscreenGameCaptureCompatibilityAtStartup)
});

function disableChromiumFeature(feature) {
  const current = app.commandLine.getSwitchValue('disable-features')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!current.includes(feature)) current.push(feature);
  app.commandLine.appendSwitch('disable-features', current.join(','));
}
const chromiumFeatureDisabled = (feature) => app.commandLine.getSwitchValue('disable-features')
  .split(',')
  .map((entry) => entry.trim())
  .includes(feature);

// Chromium only accepts this change before Electron becomes ready. Reading the
// small local preference synchronously here keeps the normal, accelerated path
// as the default while allowing a user with GPU/driver issues to opt out.
loadSettings();
hardwareAccelerationAtStartup = windowSettings.hardwareAcceleration !== false;
if (!hardwareAccelerationAtStartup) app.disableHardwareAcceleration();
const fullscreenGameCaptureCompatibilityRequested = process.platform === 'win32'
  && windowSettings.fullscreenGameCaptureCompatibility !== false;
// Windows Graphics Capture can take ownership of the hardware cursor plane in
// some exclusive/fullscreen games. The alternate WebRTC screen capturer keeps
// the local game cursor visible while Electron still embeds it in the stream.
// Window capture keeps WGC because the issue is specific to entire-screen mode.
if (fullscreenGameCaptureCompatibilityRequested) disableChromiumFeature('AllowWgcScreenCapturer');
fullscreenGameCaptureCompatibilityAtStartup = process.platform === 'win32'
  && chromiumFeatureDisabled('AllowWgcScreenCapturer');
function revealWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = null;
    createWindow().catch((error) => console.error('Não foi possível recriar a janela do VoiceUP:', error));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show(); mainWindow.focus();
}
function clearGlobalShortcuts() {
  for (const accelerator of registeredShortcuts.values()) {
    try { globalShortcut.unregister(accelerator); } catch { /* already released */ }
  }
  registeredShortcuts.clear();
}
function configureGlobalShortcuts(shortcuts = {}) {
  clearGlobalShortcuts();
  const accepted = {};
  for (const [action, rawAccelerator] of Object.entries(shortcuts || {})) {
    const accelerator = String(rawAccelerator || '').trim();
    if (!accelerator || accelerator.length > 64 || !/^[\w+\- ]+$/i.test(accelerator)) continue;
    try {
      const registered = globalShortcut.register(accelerator, () => {
        if (['settings', 'screen'].includes(action)) revealWindow();
        mainWindow?.webContents?.send('shortcut:action', action);
      });
      if (registered) { registeredShortcuts.set(action, accelerator); accepted[action] = accelerator; }
    } catch { /* invalid or reserved by Windows */ }
  }
  return accepted;
}
function createTray() {
  if (tray) return true;
  try {
    tray = new Tray(APP_ICON);
    tray.setToolTip('VoiceUP');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir VoiceUP', click: revealWindow }, { type: 'separator' }, { label: 'Encerrar programa', click: () => { isQuitting = true; app.quit(); } }]));
    tray.on('double-click', revealWindow);
    return true;
  } catch (error) {
    tray = null;
    console.warn('A bandeja do sistema não está disponível neste ambiente:', error?.message || error);
    return false;
  }
}
async function createWindow() {
  loadSettings();
  if (windowSettings.closeBehavior === 'tray' && !createTray()) windowSettings.closeBehavior = 'ask';
  mainWindow = new BrowserWindow({ width: 1180, height: 760, minWidth: 780, minHeight: 600, title: 'VoiceUp', icon: APP_ICON, backgroundColor: '#101522', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'client-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, backgroundThrottling: false } });
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
  mainWindow.on('closed', () => { stopProcessAudioCapture('window-closed'); mainWindow = null; closePromptOpen = false; });
  const allowedPermissions = new Set(['media', 'display-capture']);
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details = {}) => {
    const requestingUrl = details.requestingUrl || webContents?.getURL?.() || '';
    callback(allowedPermissions.has(permission) && isTrustedClientContents(webContents) && isTrustedClientUrl(requestingUrl));
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details = {}) => {
    const requestingUrl = details.requestingUrl || webContents?.getURL?.() || '';
    const trustedOrigin = !requestingOrigin || requestingOrigin === 'file://' || isTrustedClientUrl(requestingOrigin);
    return allowedPermissions.has(permission) && trustedOrigin && isTrustedClientContents(webContents) && isTrustedClientUrl(requestingUrl);
  });
  configureYouTubeHeaders(mainWindow.webContents.session);
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!isTrustedClientContents(mainWindow?.webContents) || (request.frame && request.frame !== mainWindow.webContents.mainFrame) || !selectedCapture.id) return callback({});
      const sources = await shareableDesktopSources();
      const source = sources.find((item) => item.id === selectedCapture.id);
      // On Windows, audio is published separately through the protected native
      // helper. Electron does not expose its system-loopback stream on Linux, so
      // Linux grants video only instead of risking call duplication or leakage.
      callback(source ? { video: source } : {});
    } catch { callback({}); }
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedClientUrl(targetUrl)) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeExternalUrl(url);
    if (externalUrl) void shell.openExternal(externalUrl);
    return { action: 'deny' };
  });
  await mainWindow.loadFile(CLIENT_ENTRY, { query: { version: app.getVersion() } });
}
registerUpdateHandlers(ipcMain, 'VoiceUP Setup ', isTrustedClientEvent, { linuxProductName: 'VoiceUP' });
secureHandle('audio:rnnoise-asset', (_event, requestedAsset) => {
  const assetPath = RNNOISE_ASSETS[String(requestedAsset || '')];
  if (!assetPath) throw new Error('Componente de áudio inválido.');
  const asset = fs.readFileSync(assetPath);
  if (!asset.length || asset.length > RNNOISE_ASSET_LIMIT) throw new Error('Componente de áudio indisponível.');
  return asset;
});
secureHandle('capture:sources', async () => (await shareableDesktopSources()).map((source) => ({
  id: source.id,
  name: source.name,
  kind: source.id.startsWith('screen:') ? 'screen' : 'window',
  available: !source.thumbnail?.isEmpty?.(),
  thumbnail: source.thumbnail?.isEmpty?.() ? '' : source.thumbnail?.toDataURL?.() || '',
  appIcon: source.appIcon?.isEmpty?.() ? '' : source.appIcon?.toDataURL?.() || ''
})));
secureHandle('capture:select', (_event, selection = {}) => {
  stopProcessAudioCapture('source-changed');
  const id = String(selection.id || '');
  selectedCapture = { id, kind: id.startsWith('screen:') ? 'screen' : id.startsWith('window:') ? 'window' : '', includeAudio: Boolean(selection.includeAudio) };
  return { ok: true, kind: selectedCapture.kind, processAudio: selectedCapture.kind === 'window' ? processAudioCapability() : null };
});
secureHandle('capture:process-audio-capability', () => processAudioCapability());
secureHandle('capture:process-audio-start', (_event, sourceId) => startProcessAudioCapture(String(sourceId || '').slice(0, 180)));
secureHandle('capture:process-audio-stop', () => stopProcessAudioCapture('renderer-stopped'));
secureHandle('link:preview', async (_event, raw) => { try { return await fetchLinkPreview(String(raw || '').slice(0, 2048)); } catch { return null; } });
secureHandle('window:set-video-fullscreen', (_event, enabled) => { mainWindow?.setFullScreen(Boolean(enabled)); return Boolean(enabled); });
secureHandle('window:settings', () => publicWindowSettings());
secureHandle('window:save-settings', (_event, next = {}) => {
  const allowed = ['tray', 'ask', 'quit'];
  windowSettings.closeBehavior = allowed.includes(next.closeBehavior) ? next.closeBehavior : defaultCloseBehavior();
  if (windowSettings.closeBehavior === 'tray' && !createTray()) windowSettings.closeBehavior = 'ask';
  if (typeof next.hardwareAcceleration === 'boolean') windowSettings.hardwareAcceleration = next.hardwareAcceleration;
  if (typeof next.fullscreenGameCaptureCompatibility === 'boolean') {
    windowSettings.fullscreenGameCaptureCompatibility = next.fullscreenGameCaptureCompatibility;
  }
  saveSettings();
  return publicWindowSettings();
});
secureHandle('window:restart', () => {
  setTimeout(() => { app.relaunch(); isQuitting = true; app.quit(); }, 80);
  return true;
});
secureHandle('shortcuts:configure', (_event, shortcuts = {}) => configureGlobalShortcuts(shortcuts));
secureHandle('shortcuts:clear', () => { clearGlobalShortcuts(); return true; });
secureHandle('direct-room:start', (_event, options = {}) => startDirectRoom(options));
secureHandle('direct-room:stop', () => stopDirectRoom());
secureHandle('direct-room:status', () => directRoomStatus());
secureHandle('window:close-choice', (_event, choice) => {
  if (!closePromptOpen) return false;
  closePromptOpen = false;
  if (choice === 'tray' && createTray()) { mainWindow?.hide(); return true; }
  if (choice === 'tray') { windowSettings.closeBehavior = 'ask'; saveSettings(); return false; }
  if (choice === 'quit') { isQuitting = true; app.quit(); return true; }
  return true;
});
app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin' && (isQuitting || windowSettings.closeBehavior === 'quit')) app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else revealWindow(); });
app.on('before-quit', () => { isQuitting = true; stopProcessAudioCapture('app-quit'); clearGlobalShortcuts(); void stopDirectRoom(); });
