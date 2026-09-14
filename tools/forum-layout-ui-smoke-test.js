'use strict';

/* Headless browser smoke test for the forum in the narrow side panel and central lobby. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const publicRoot = path.resolve(__dirname, '..', 'public');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-forum-layout-'));
const forumThreadMarkup = '<button type="button" class="forum-thread-card"><b>Tópico com um título maior para testar a quebra</b><small>3 mensagens · agora</small><p>Uma prévia que continua dentro do painel lateral.</p></button>';

const mime = new Map([
  ['.css', 'text/css; charset=utf-8'], ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'], ['.svg', 'image/svg+xml'], ['.woff2', 'font/woff2']
]);

function browserExecutable() {
  const candidates = [
    process.env.VOICEUP_TEST_BROWSER,
    path.join(process.env.ProgramFiles || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Brave, Edge ou Chrome não encontrado para o teste visual do fórum.');
  return found;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function createStaticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    if (relative === 'socket.io/socket.io.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('window.io = () => ({ connected: false, on() { return this; }, once() { return this; }, emit() {}, disconnect() {} });');
      return;
    }
    const file = path.resolve(publicRoot, relative);
    if (file !== publicRoot && !file.startsWith(`${publicRoot}${path.sep}`)) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(file, (error, body) => {
      if (error) {
        response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': mime.get(path.extname(file)) || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    });
  });
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} em ${url}`);
  return response.json();
}

async function waitForPage(debugPort, expectedUrl) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const pages = await json(`http://127.0.0.1:${debugPort}/json/list`);
      const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith(expectedUrl));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('O navegador não abriu a página de teste dentro do prazo.');
}

async function connectCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  const events = [];
  let sequence = 0;
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      events.push(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao conectar ao DevTools.')), 8000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', (error) => { clearTimeout(timeout); reject(error); }, { once: true });
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Tempo esgotado no comando DevTools: ${method}`));
    }, 8000);
    pending.set(id, {
      resolve: (value) => { clearTimeout(timeout); resolve(value); },
      reject: (error) => { clearTimeout(timeout); reject(new Error(`${method}: ${error.message}`)); }
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, send, events };
}

async function main() {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const pagePort = server.address().port;
  const debugPort = await freePort();
  const pageUrl = `http://127.0.0.1:${pagePort}/`;
  const browser = spawn(browserExecutable(), [
    '--headless=new', '--disable-gpu-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE,SkiaGraphite,GraphiteDawn',
    '--disable-background-networking', '--disable-component-update',
    '--disable-default-apps', '--disable-sync', '--metrics-recording-only', '--mute-audio',
    '--no-default-browser-check', '--no-first-run', '--remote-allow-origins=*', '--window-size=1920,1020',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${scratch}`, pageUrl
  ], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let browserError = '';
  browser.stderr.setEncoding('utf8');
  browser.stderr.on('data', (chunk) => { browserError += chunk; });
  let cdp;
  try {
    const page = await waitForPage(debugPort, pageUrl);
    cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !await evaluate('document.readyState === "complete" && Boolean(document.querySelector("#welcome"))')) {
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    assert.equal(await evaluate('Boolean(document.querySelector("#welcome"))'), true, 'A página do VoiceUP não terminou de carregar.');

    await evaluate(`(() => {
      document.querySelector('#welcome').classList.add('hidden');
      document.querySelector('#app').classList.remove('hidden');
      document.querySelector('#release-notes-modal')?.classList.add('hidden');
      document.body.classList.remove('beta-welcome-open', 'server-lobby-mode');
      document.body.dataset.motion = 'reduced';
      document.querySelector('#right-panel').append(document.querySelector('#chat-panel'));
      document.querySelector('#members-panel').classList.remove('active');
      document.querySelector('#chat-panel').classList.add('active');
      document.querySelector('[data-panel="members"]').classList.remove('active');
      document.querySelector('[data-panel="chat"]').classList.add('active');
      document.querySelector('#message-form').classList.add('hidden');
      if (typeof window.renderForumBoard !== 'function') throw new Error('renderForumBoard não foi exposto pelo Client.');
      window.renderForumBoard({ topic: 'Organize conversas em tópicos sem perder espaço.', forumTags: ['Ajuda', 'Discussão longa'] });
      document.querySelector('.forum-thread-list').innerHTML = ${JSON.stringify(forumThreadMarkup)};
    })()`);

    const side = await evaluate(`(() => {
      const messages = document.querySelector('#messages');
      const board = messages.querySelector('.forum-board');
      const composer = board.querySelector('.forum-topic-composer');
      const title = composer.querySelector('input');
      const body = composer.querySelector('textarea');
      const publish = composer.querySelector('.forum-publish');
      const card = board.querySelector('.forum-thread-card');
      const defaultButton = document.createElement('button');
      defaultButton.textContent = 'Padrão';
      document.body.append(defaultButton);
      const defaultStyle = getComputedStyle(defaultButton);
      const result = {
        panelWidth: document.querySelector('#right-panel').getBoundingClientRect().width,
        boardWidth: board.getBoundingClientRect().width,
        messagesWidth: messages.getBoundingClientRect().width,
        composerWidth: composer.getBoundingClientRect().width,
        cardWidth: card.getBoundingClientRect().width,
        boardColumns: getComputedStyle(board).gridTemplateColumns.split(' ').length,
        inRightPanel: Boolean(board.closest('#right-panel')),
        composerDisplay: getComputedStyle(composer).display,
        composerColumns: getComputedStyle(composer).gridTemplateColumns.split(' ').length,
        verticalFields: title.offsetTop < body.offsetTop && body.offsetTop < publish.offsetTop,
        publishFits: publish.scrollWidth <= publish.clientWidth && publish.getBoundingClientRect().right <= composer.getBoundingClientRect().right + 1,
        publishWidth: publish.getBoundingClientRect().width,
        publishBackground: getComputedStyle(publish).backgroundImage,
        defaultBackground: defaultStyle.backgroundColor,
        defaultColor: defaultStyle.color
      };
      defaultButton.remove();
      return result;
    })()`);
    console.log(JSON.stringify({ phase: 'side-panel', measurements: side }));
    assert.ok(side.panelWidth >= 300 && side.panelWidth <= 340, `Unexpected side panel width: ${side.panelWidth}`);
    assert.ok(side.boardWidth >= 270 && side.boardWidth <= side.messagesWidth, 'Forum must use the available side-panel width.');
    assert.equal(side.inRightPanel, true);
    assert.equal(side.boardColumns, 1, 'The side-panel forum must use one content column.');
    assert.equal(side.composerDisplay, 'grid');
    assert.equal(side.composerColumns, 1, 'The side-panel composer must have one column.');
    assert.equal(side.verticalFields, true, 'The title, message and submit button must stack vertically.');
    assert.equal(side.publishFits, true, 'The submit button text must not clip or leave the composer.');
    assert.ok(side.publishWidth >= side.composerWidth - 30, `The submit button must remain comfortably tappable: ${side.publishWidth}/${side.composerWidth}.`);
    assert.match(side.publishBackground, /gradient/i);
    assert.notEqual(side.defaultBackground, 'rgb(239, 239, 239)', 'Unstyled buttons must not use the native white browser skin.');
    assert.notEqual(side.defaultColor, 'rgb(0, 0, 0)', 'Unstyled buttons must inherit the theme text color.');

    await evaluate(`(() => {
      const chatPanel = document.querySelector('#chat-panel');
      document.querySelector('#server-lobby-chat-slot').append(chatPanel);
      chatPanel.classList.add('active');
      document.body.classList.add('server-lobby-mode');
    })()`);
    const central = await evaluate(`(() => {
      const messages = document.querySelector('#messages');
      const board = messages.querySelector('.forum-board');
      const list = board.querySelector('.forum-thread-list').getBoundingClientRect();
      const composer = board.querySelector('.forum-topic-composer').getBoundingClientRect();
      return {
        messagesWidth: messages.getBoundingClientRect().width,
        boardWidth: board.getBoundingClientRect().width,
        columns: getComputedStyle(board).gridTemplateColumns.split(' ').length,
        composerBesideTopics: composer.left > list.left && Math.abs(composer.top - list.top) < 2,
        insideMessages: board.getBoundingClientRect().right <= messages.getBoundingClientRect().right + 1
      };
    })()`);
    console.log(JSON.stringify({ phase: 'central-lobby', measurements: central }));
    assert.ok(central.messagesWidth > 1000, 'The central forum fixture must exercise a wide lobby.');
    assert.ok(central.boardWidth >= 850 && central.boardWidth <= 1040, `Central forum width should use the lobby: ${central.boardWidth}`);
    assert.equal(central.columns, 2, 'The wide central forum must use a topic column and a composer column.');
    assert.equal(central.composerBesideTopics, true);
    assert.equal(central.insideMessages, true);

    const exceptions = cdp.events.filter((entry) => entry.method === 'Runtime.exceptionThrown');
    assert.deepEqual(exceptions, [], 'The forum layout must not raise renderer exceptions.');
    console.log(JSON.stringify({ ok: true, sidePanel: side, centralLobby: central, themedButtons: true }));
    void cdp.send('Browser.close').catch(() => {});
  } catch (error) {
    if (browserError) error.message += `\nBrowser: ${browserError.slice(-2000)}`;
    throw error;
  } finally {
    cdp?.socket.close();
    const exited = browser.exitCode !== null ? Promise.resolve() : new Promise((resolve) => browser.once('exit', resolve));
    if (!browser.killed) browser.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2500))]);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 8, retryDelay: 120 }); }
    catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code)) throw error;
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
