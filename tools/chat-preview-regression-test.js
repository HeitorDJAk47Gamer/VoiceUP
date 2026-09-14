'use strict';
const { app, BrowserWindow, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'voiceup-preview-test-')));
app.disableHardwareAcceleration();
const timer = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  // Exercise the actual metadata fetcher against deterministic provider responses.
  const main = fs.readFileSync(path.join(__dirname, '../electron-main.js'), 'utf8');
  const source = main.slice(main.indexOf('const decodeHtml ='), main.indexOf('const configureYouTubeHeaders ='));
  let html = '<title>Seu navegador não é compatível. Faça upgrade para um mais recente.</title>';
  let headers;
  const context = vm.createContext({ URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    LINK_PREVIEW_LIMIT: 512000, publicPreviewUrl: async value => new URL(value),
    session: { defaultSession: { getUserAgent: () => 'Mozilla/5.0 Chrome/149.0.0.0' } },
    electronNet: { fetch: async (_url, options) => { headers = options.headers; return new Response(html, { headers: { 'content-type': 'text/html' } }); } }
  });
  vm.runInContext(source, context);
  assert.equal(await vm.runInContext("fetchLinkPreview('https://music.youtube.com/channel/test')", context), null);
  assert.match(headers['User-Agent'], /Chrome\//);
  html = '<meta property="og:title" content="Canal de música"><meta property="og:description" content="Faixas e vídeos">';
  assert.equal((await vm.runInContext("fetchLinkPreview('https://music.youtube.com/channel/test')", context)).title, 'Canal de música');
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
  await win.loadFile(path.join(__dirname, '../public/index.html'));
  const result = await win.webContents.executeJavaScript(`(() => {
    activeTextChannel = 'geral'; activeForumThreadId = ''; externalMediaAutoLoad = true;
    activeTextChannelSettings = () => ({ kind: 'text' });
    const first = { id: 'preview-one', text: 'https://youtu.be/8Fw00xXb4xE', name: 'Teste', createdAt: Date.now(), mine: false };
    channelMessages.set('geral', [first]); renderChannelMessages();
    const article = document.querySelector('[data-message-id="preview-one"]');
    const frame = article.querySelector('iframe'); if (!frame) throw Error('Missing video iframe');
    const observer = new MutationObserver(() => {}); observer.observe($('messages'), {childList: true, subtree: true});
    channelMessages.get('geral').push({ ...first, id: 'preview-two' }); renderChannelMessages();
    if (document.querySelector('[data-message-id="preview-one"]') !== article || article.querySelector('iframe') !== frame) throw Error('Existing player replaced');
    if (observer.takeRecords().some(record => [...record.removedNodes].some(node => node === article || node === frame || node.contains?.(frame)))) throw Error('Existing player detached');
    const second = document.querySelector('[data-message-id="preview-two"]');
    first.text = 'Texto editado'; first.editedAt = Date.now(); renderChannelMessages();
    if (document.querySelector('[data-message-id="preview-two"]') !== second) throw Error('Editing another message reset player');
    channelMessages.get('geral').shift(); renderChannelMessages();
    if (document.querySelector('[data-message-id="preview-one"]')) throw Error('Deleted message retained');
    if (document.querySelector('[data-message-id="preview-two"]') !== second) throw Error('Deleting another message reset player');
    observer.disconnect(); return true;
  })()`);
  assert.equal(result, true);
  console.log('PASS metadata compatibility fallback, browser user-agent, player preservation on append/edit/delete');
  clearTimeout(timer); win.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
