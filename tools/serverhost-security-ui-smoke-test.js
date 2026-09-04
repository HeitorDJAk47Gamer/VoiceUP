const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9476);
const deadline = Date.now() + 15000;

const listTargets = () => new Promise((resolve, reject) => {
  const request = http.get(`http://127.0.0.1:${port}/json`, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
  });
  request.on('error', reject);
  request.setTimeout(1500, () => request.destroy(new Error('Timeout consultando o ServerHost.')));
});

async function waitForTarget() {
  while (Date.now() < deadline) {
    try {
      const target = (await listTargets()).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
      if (target) return target;
    } catch { /* ServerHost ainda iniciando */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Janela do ServerHost não apareceu no depurador.');
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
    await new Promise((resolve) => setTimeout(resolve, 500));
    const info = await window.voiceupServer.info();
    const initial = await window.voiceupServer.settings();
    const hardwareToggle = document.querySelector('#host-hardware-acceleration');
    hardwareToggle.checked = false;
    hardwareToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const disabledHardwareSettings = await window.voiceupServer.settings();
    const hardwareRestartVisible = !document.querySelector('#host-hardware-restart')?.classList.contains('hidden');
    hardwareToggle.checked = true;
    hardwareToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const restoredHardwareSettings = await window.voiceupServer.settings();
    const withoutConfirmation = await window.voiceupServer.saveSettings({ publicAccess: { automatic: true } });
    const stats = await window.voiceupServer.stats();
    return {
      info,
      initialPublicAccess: initial.publicAccess,
      withoutConfirmation: withoutConfirmation.publicAccess,
      publicToggle: document.querySelector('#public-access-automatic')?.checked,
      hardware: { initial: { hardwareAcceleration: initial.hardwareAcceleration, restartRequired: initial.restartRequired }, disabledHardwareSettings: { hardwareAcceleration: disabledHardwareSettings.hardwareAcceleration, restartRequired: disabledHardwareSettings.restartRequired }, hardwareRestartVisible, restoredHardwareSettings: { hardwareAcceleration: restoredHardwareSettings.hardwareAcceleration, restartRequired: restoredHardwareSettings.restartRequired } },
      plugins: stats.plugins?.map((plugin) => ({ id: plugin.id, requiresApproval: plugin.requiresApproval })),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || ''
    };
  })()`;
  const response = await call('Runtime.evaluate', { expression: source, awaitPromise: true, returnByValue: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  const result = response.result.value;
  assert.equal(result.info.version, require('../package.json').version);
  assert.equal(result.info.online, true);
  assert.equal(result.initialPublicAccess.automatic, false, 'UPnP iniciou habilitado.');
  assert.equal(result.withoutConfirmation.automatic, false, 'O IPC habilitou UPnP sem confirmação explícita.');
  assert.equal(result.publicToggle, false, 'O controle visual de UPnP iniciou habilitado.');
  assert.equal(result.hardware.initial.hardwareAcceleration, true, 'A aceleração do ServerHost precisa iniciar ligada.');
  assert.equal(result.hardware.disabledHardwareSettings.hardwareAcceleration, false, 'O controle do ServerHost não salvou a opção desligada.');
  assert.equal(result.hardware.disabledHardwareSettings.restartRequired, true, 'O ServerHost não indicou o reinício necessário.');
  assert.equal(result.hardware.hardwareRestartVisible, true, 'O aviso de reinício do ServerHost não apareceu.');
  assert.equal(result.hardware.restoredHardwareSettings.hardwareAcceleration, true, 'O teste não restaurou a aceleração do ServerHost.');
  assert.equal(result.hardware.restoredHardwareSettings.restartRequired, false, 'O ServerHost manteve reinício pendente depois de restaurar a opção ativa.');
  assert.deepEqual(result.plugins.map((plugin) => plugin.id).sort(), ['dados', 'musica', 'xp-chat']);
  assert.ok(result.plugins.every((plugin) => plugin.requiresApproval === false), 'Plugin oficial foi marcado como externo.');
  assert.match(result.csp, /script-src 'self'/);
  assert.equal(exceptions, 0, 'O ServerHost gerou exceções durante o teste.');
  console.log(JSON.stringify({ ok: true, ...result, exceptions }));
  socket.close();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
