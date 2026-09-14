'use strict';

/* Hidden Electron smoke test: renders code and a long-text attachment without network or media. */
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-chat-rich-ui-'));
const rendererErrors = [];
let window;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (code) => window.webContents.executeJavaScript(code);

app.setPath('userData', scratch);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('mute-audio');
setTimeout(() => { console.error(`Chat rich UI timeout. Renderer errors: ${JSON.stringify(rendererErrors)}`); app.exit(1); }, 45000).unref();

app.whenReady().then(async () => {
  window = new BrowserWindow({
    show: false,
    width: 1500,
    height: 920,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true, partition: 'chat-rich-ui-test' }
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ['https://*/*', 'http://*/*'] }, (_details, callback) => callback({ cancel: true }));
  window.webContents.debugger.attach('1.3');
  window.webContents.debugger.on('message', (_event, method, params) => {
    if (method === 'Runtime.exceptionThrown') rendererErrors.push(params.exceptionDetails.exception?.description || params.exceptionDetails.text);
  });
  const runtimeReady = window.webContents.debugger.sendCommand('Runtime.enable');
  await window.loadFile(path.join(__dirname, '..', 'public', 'index.html'));
  await runtimeReady;

  await evaluate(`(() => {
    document.querySelector('#welcome').classList.add('hidden');
    document.querySelector('#app').classList.remove('hidden');
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    document.body.classList.remove('beta-welcome-open', 'server-lobby-mode');
    document.body.dataset.motion = 'reduced';
    document.documentElement.style.setProperty('--right-panel-width', '520px');
    document.querySelector('[data-panel="chat"]')?.click();
    document.querySelector('#messages').replaceChildren();
    addMessage(['Exemplo seguro:', '\`\`\`py', 'import os', 'print("hello, world!")', '# https://example.com não vira link', '\`\`\`'].join(String.fromCharCode(10)), 'Heitor', false, '#56e2cf', { id: 'code-message', createdAt: Date.now() - 1000 });
    const longUnbrokenToken = 'https://exemplo.local/' + 'sem-quebra-'.repeat(34);
    const longText = [longUnbrokenToken, ...Array.from({ length: 34 }, (_, index) => String(index + 1).padStart(2, '0') + ' · Lorem ipsum dolor sit amet, consectetur adipiscing elit.')].join(String.fromCharCode(10));
    const outgoing = voiceupChatRichContent.createOutgoingMessage(longText);
    addMessage(outgoing.text, 'Heitor', true, '#56e2cf', { id: 'file-message', createdAt: Date.now(), textFile: outgoing.textFile });
    document.querySelector('#messages').scrollTop = 0;
  })()`);
  await pause(350);
  assert.deepEqual(rendererErrors, []);

  const state = await evaluate(`(() => {
    const input = document.querySelector('#message-input');
    const block = document.querySelector('#messages .message-code-block');
    const card = document.querySelector('#messages .message-text-file');
    const preview = card.querySelector('.text-file-preview');
    return {
      composer: { tag: input.tagName, maxLength: input.maxLength, maxHeight: getComputedStyle(input).maxHeight },
      language: block.querySelector('header span').textContent,
      codeText: block.querySelector('pre code').textContent,
      keywords: block.querySelectorAll('.code-token.keyword').length,
      linksInsideCode: block.querySelectorAll('.message-link').length,
      injectedElements: block.querySelectorAll('script,img').length + card.querySelectorAll('script,img').length,
      fileName: card.querySelector('.text-file-meta strong').textContent,
      fileSize: card.querySelector('.text-file-meta small').textContent,
      contentLength: card.querySelector('.text-file-content').textContent.length,
      clipped: preview.scrollHeight > preview.clientHeight,
      previewWhiteSpace: getComputedStyle(card.querySelector('.text-file-preview pre')).whiteSpace,
      previewDoesNotOverflow: preview.scrollWidth <= preview.clientWidth,
      remaining: card.querySelector('.text-file-remaining')?.textContent || '',
      canCopy: Boolean(card.querySelector('[data-text-file-copy]')),
      canDownload: Boolean(card.querySelector('[data-text-file-download]')),
      editable: Boolean(card.closest('.message').querySelector('.message-edit')),
      cardWithinPanel: card.getBoundingClientRect().width <= document.querySelector('#right-panel').getBoundingClientRect().width
    };
  })()`);
  assert.deepEqual(state.composer, { tag: 'TEXTAREA', maxLength: 30000, maxHeight: '132px' });
  assert.equal(state.language, 'Python');
  assert.match(state.codeText, /import os/);
  assert.ok(state.keywords >= 1, 'Python keywords must receive syntax highlighting.');
  assert.equal(state.linksInsideCode, 0, 'URLs inside code must remain plain code.');
  assert.equal(state.injectedElements, 0, 'Plain text must never create executable or remote elements.');
  assert.equal(state.fileName, 'mensagem.txt');
  assert.match(state.fileSize, /KB/);
  assert.ok(state.contentLength > 500);
  assert.equal(state.clipped, true);
  assert.equal(state.previewWhiteSpace, 'pre-wrap');
  assert.equal(state.previewDoesNotOverflow, true, 'Long TXT lines must wrap inside the preview card.');
  assert.match(state.remaining, /restante/);
  assert.equal(state.canCopy, true);
  assert.equal(state.canDownload, true);
  assert.equal(state.editable, false, 'Generated attachments are immutable messages.');
  assert.equal(state.cardWithinPanel, true);

  if (process.env.VOICEUP_CAPTURE_CHAT_UI === '1') {
    fs.writeFileSync(path.join(__dirname, 'chat-rich-content-beta9.png'), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate(`document.querySelector('[data-text-file-toggle]').click()`);
  await pause(100);
  const expanded = await evaluate(`(() => { const card = document.querySelector('.message-text-file'); return { expanded: card.classList.contains('expanded'), aria: card.querySelector('[data-text-file-toggle]').getAttribute('aria-expanded'), remainingVisible: getComputedStyle(card.querySelector('.text-file-remaining')).display }; })()`);
  assert.deepEqual(expanded, { expanded: true, aria: 'true', remainingVisible: 'none' });

  console.log(JSON.stringify({ ok: true, codeLanguage: state.language, syntaxHighlight: true, safeText: true, automaticTextFile: true, preview: true, expand: true, copy: true, download: true, composer: 'multiline' }));
  app.quit();
}).catch((error) => { console.error(error.stack || error.message); app.exit(1); });
