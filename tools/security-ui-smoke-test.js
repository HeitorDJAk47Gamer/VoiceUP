const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9468);
const deadline = Date.now() + 12000;

const targets = () => new Promise((resolve, reject) => {
  const request = http.get(`http://127.0.0.1:${port}/json`, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
  });
  request.on('error', reject);
  request.setTimeout(1500, () => request.destroy(new Error('Timeout consultando o Electron.')));
});

async function waitForTarget() {
  while (Date.now() < deadline) {
    try {
      const target = (await targets()).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
      if (target) return target;
    } catch { /* aplicativo ainda iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Janela do VoiceUP não apareceu no depurador.');
}

(async () => {
  const target = await waitForTarget();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  let exceptions = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.method === 'Runtime.exceptionThrown') exceptions += 1;
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message));
    else operation.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await call('Runtime.enable');
  const source = `(async () => {
    document.querySelector('#release-notes-modal')?.classList.add('hidden');
    await window.voiceupSocketClientReady;
    const hardwareToggle = document.querySelector('#hardware-acceleration-toggle');
    const initialHardwareSettings = await window.voiceupDesktop.windowSettings();
    hardwareToggle.checked = false;
    hardwareToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    const disabledHardwareSettings = await window.voiceupDesktop.windowSettings();
    const hardwareRestartVisible = !document.querySelector('#hardware-acceleration-restart')?.classList.contains('hidden');
    hardwareToggle.checked = true;
    hardwareToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    const restoredHardwareSettings = await window.voiceupDesktop.windowSettings();
    const captureCompatibilityToggle = document.querySelector('#fullscreen-game-capture-toggle');
    const initialCaptureCompatibilitySettings = await window.voiceupDesktop.windowSettings();
    captureCompatibilityToggle.checked = false;
    captureCompatibilityToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    const disabledCaptureCompatibilitySettings = await window.voiceupDesktop.windowSettings();
    const captureCompatibilityRestartVisible = !document.querySelector('#hardware-acceleration-restart')?.classList.contains('hidden');
    captureCompatibilityToggle.checked = true;
    captureCompatibilityToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 650));
    const restoredCaptureCompatibilitySettings = await window.voiceupDesktop.windowSettings();
    document.querySelector('#messages').innerHTML = '';
    addMessage('Imagem https://example.com/imagem.png', 'Teste', false, '#56e2cf');
    addMessage('Vídeo https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Teste', false, '#56e2cf');
    addMessage('Site https://example.com/', 'Teste', false, '#56e2cf');
    await new Promise((resolve) => setTimeout(resolve, 120));
    const beforeConsent = {
      buttons: document.querySelectorAll('.message-external-load').length,
      images: document.querySelectorAll('.message-image-embed img').length,
      videos: document.querySelectorAll('.message-video-embed iframe').length,
      cards: document.querySelectorAll('.message-link-card').length
    };
    document.querySelector('[data-external-media-kind="image"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const privatePreview = await window.voiceupDesktop.linkPreview('http://127.0.0.1:9/privado.png');
    return {
      version: window.voiceupVersion,
      socketClient: typeof window.io,
      externalMediaDefault: document.querySelector('#external-media-toggle')?.checked,
      directPublicDefault: document.querySelector('#direct-public-access')?.checked,
      hardware: { initialHardwareSettings, disabledHardwareSettings, hardwareRestartVisible, restoredHardwareSettings },
      captureCompatibility: { initialCaptureCompatibilitySettings, disabledCaptureCompatibilitySettings, captureCompatibilityRestartVisible, restoredCaptureCompatibilitySettings },
      beforeConsent,
      imageAfterConsent: Boolean(document.querySelector('.message-image-embed img')),
      privatePreview,
      diagnostics: window.voiceupDiagnostics,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''
    };
  })()`;
  const response = await call('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  const result = response.result.value;
  assert.equal(result.version, require('../package.json').version);
  assert.equal(result.socketClient, 'function', 'Socket.IO local não carregou no pacote.');
  assert.equal(result.externalMediaDefault, false, 'Mídia externa não iniciou desativada.');
  assert.equal(result.directPublicDefault, false, 'Acesso público direto não iniciou desativado.');
  assert.equal(result.hardware.initialHardwareSettings.hardwareAcceleration, true, 'A aceleração do Client precisa iniciar ligada.');
  assert.equal(result.hardware.disabledHardwareSettings.hardwareAcceleration, false, 'O controle do Client não salvou a opção desligada.');
  assert.equal(result.hardware.disabledHardwareSettings.restartRequired, true, 'O Client não indicou o reinício necessário.');
  assert.equal(result.hardware.hardwareRestartVisible, true, 'O aviso de reinício do Client não apareceu.');
  assert.equal(result.hardware.restoredHardwareSettings.hardwareAcceleration, true, 'O teste não restaurou a aceleração do Client.');
  assert.equal(result.hardware.restoredHardwareSettings.restartRequired, false, 'O Client manteve reinício pendente depois de restaurar a opção ativa.');
  assert.equal(result.captureCompatibility.initialCaptureCompatibilitySettings.fullscreenGameCaptureCompatibility, true, 'A compatibilidade de tela cheia precisa iniciar ligada.');
  assert.equal(result.captureCompatibility.initialCaptureCompatibilitySettings.fullscreenGameCaptureCompatibilityActive, true, 'O capturador alternativo não foi aplicado nesta abertura.');
  assert.equal(result.captureCompatibility.initialCaptureCompatibilitySettings.fullscreenGameCaptureCompatibilitySupported, true, 'O Windows precisa expor a compatibilidade de tela cheia.');
  assert.equal(result.captureCompatibility.disabledCaptureCompatibilitySettings.fullscreenGameCaptureCompatibility, false, 'O controle não salvou a compatibilidade desligada.');
  assert.equal(result.captureCompatibility.disabledCaptureCompatibilitySettings.restartRequired, true, 'A troca do capturador não indicou reinício necessário.');
  assert.equal(result.captureCompatibility.captureCompatibilityRestartVisible, true, 'O aviso de reinício não apareceu ao trocar o capturador.');
  assert.equal(result.captureCompatibility.restoredCaptureCompatibilitySettings.fullscreenGameCaptureCompatibility, true, 'O teste não restaurou a compatibilidade de tela cheia.');
  assert.equal(result.captureCompatibility.restoredCaptureCompatibilitySettings.restartRequired, false, 'O reinício pendente permaneceu depois de restaurar o capturador ativo.');
  assert.deepEqual(result.beforeConsent, { buttons: 3, images: 0, videos: 0, cards: 0 });
  assert.equal(result.imageAfterConsent, true, 'O consentimento individual não carregou a imagem.');
  assert.equal(result.privatePreview, null, 'A prévia tentou acessar um endereço privado.');
  assert.match(result.csp, /script-src 'self'/);
  assert.equal(exceptions, 0, 'A interface gerou exceções durante o teste.');
  console.log(JSON.stringify({ ok: true, ...result, exceptions }));
  socket.close();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
