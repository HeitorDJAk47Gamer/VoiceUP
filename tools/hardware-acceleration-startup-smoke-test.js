const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

const port = Number(process.argv[2]);
const mode = process.argv[3] === 'server' ? 'server' : 'client';
const prepare = process.argv[4] === 'prepare';
const restore = process.argv[4] === 'restore';
const deadline = Date.now() + 15000;

const listTargets = () => new Promise((resolve, reject) => {
  const request = http.get(`http://127.0.0.1:${port}/json`, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  });
  request.on('error', reject);
  request.setTimeout(1500, () => request.destroy(new Error('Timeout consultando o aplicativo.')));
});

async function target() {
  while (Date.now() < deadline) {
    try {
      const page = (await listTargets()).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
      if (page) return page;
    } catch { /* aplicativo iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('A janela do VoiceUP não apareceu no depurador.');
}

(async () => {
  const page = await target();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map(); let nextId = 0; let exceptions = 0;
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw);
    if (message.method === 'Runtime.exceptionThrown') exceptions += 1;
    if (!message.id || !pending.has(message.id)) return;
    const operation = pending.get(message.id); pending.delete(message.id);
    if (message.error) operation.reject(new Error(message.error.message)); else operation.resolve(message.result);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await call('Runtime.enable');
  const expression = mode === 'server'
    ? prepare || restore
      ? `(async () => ({ settings: await window.voiceupServer.saveSettings({ hardwareAcceleration: ${restore ? 'true' : 'false'} }) }))()`
      : `(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); return { settings: await window.voiceupServer.settings(), checked: document.querySelector('#host-hardware-acceleration')?.checked }; })()`
    : prepare || restore
      ? `(async () => { const current = await window.voiceupDesktop.windowSettings(); return { settings: await window.voiceupDesktop.saveWindowSettings({ closeBehavior: current.closeBehavior, hardwareAcceleration: ${restore ? 'true' : 'false'} }) }; })()`
      : `(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); return { settings: await window.voiceupDesktop.windowSettings(), checked: document.querySelector('#hardware-acceleration-toggle')?.checked, visible: !document.querySelector('#hardware-acceleration-setting')?.classList.contains('hidden') }; })()`;
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  const result = response.result.value;
  if (restore) {
    assert.equal(result.settings.hardwareAcceleration, true, `${mode} não restaurou a aceleração.`);
    console.log(JSON.stringify({ ok: true, mode, restored: true, ...result, exceptions }));
    socket.close();
    return;
  }
  assert.equal(result.settings.hardwareAcceleration, false, `${mode} não carregou a preferência desativada.`);
  if (prepare) {
    assert.equal(result.settings.restartRequired, true, `${mode} não marcou o reinício depois de salvar a opção.`);
    console.log(JSON.stringify({ ok: true, mode, prepared: true, ...result, exceptions }));
    socket.close();
    return;
  }
  assert.equal(result.settings.hardwareAccelerationActive, false, `${mode} não aplicou a preferência antes de iniciar.`);
  assert.equal(result.settings.restartRequired, false, `${mode} pediu novo reinício após já iniciar sem aceleração.`);
  assert.equal(result.checked, false, `${mode} não refletiu a preferência na interface.`);
  if (mode === 'client') assert.equal(result.visible, true, 'A opção ficou oculta no Client Windows.');
  assert.equal(exceptions, 0, `${mode} gerou exceções ao iniciar sem aceleração.`);
  console.log(JSON.stringify({ ok: true, mode, ...result, exceptions }));
  socket.close();
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
