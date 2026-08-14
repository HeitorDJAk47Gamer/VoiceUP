const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9334);
const getJson = (url) => new Promise((resolve, reject) => {
  http.get(url, (response) => {
    let body = '';
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
  }).on('error', reject);
});

(async () => {
  const pages = await getJson(`http://127.0.0.1:${port}/json`);
  const target = pages.find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
  if (!target) throw new Error('Janela do VoiceUP não encontrada.');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let sequence = 0;
  const pending = new Map(); const requests = []; const responses = []; const failures = [];
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params }));
  });
  socket.on('message', (raw) => {
    const message = JSON.parse(raw); const request = pending.get(message.id);
    if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); return; }
    const url = message.params?.request?.url || message.params?.response?.url || '';
    if (!/youtube(?:-nocookie)?\.com/i.test(url)) return;
    if (message.method === 'Network.requestWillBeSent') requests.push({ url, referer: message.params.request.headers.Referer || message.params.request.headers.referer || '' });
    if (message.method === 'Network.responseReceived') responses.push({ url, status: message.params.response.status });
    if (message.method === 'Network.loadingFailed') failures.push({ url, error: message.params.errorText });
  });
  await new Promise((resolve) => socket.once('open', resolve));
  await call('Page.enable'); await call('Network.enable');
  const reload = await call('Runtime.evaluate', { expression: `(() => { const frame = document.querySelector('.message-video-embed iframe'); if (!frame) return ''; const src = frame.src.replace(/([?&])voiceup_test=\\d+/, '$1voiceup_test=' + Date.now()); frame.src = src + (src.includes('voiceup_test=') ? '' : '&voiceup_test=' + Date.now()); return frame.src; })()`, returnByValue: true });
  if (!reload.result?.value) throw new Error('Iframe do YouTube não encontrado.');
  await new Promise((resolve) => setTimeout(resolve, 7000));
  const embedRequest = requests.find((item) => /\/embed\//.test(item.url));
  const embedResponse = responses.find((item) => /\/embed\//.test(item.url));
  const { frameTree } = await call('Page.getFrameTree'); const frames = [];
  const collect = (node) => { frames.push(node.frame); (node.childFrames || []).forEach(collect); }; collect(frameTree);
  const youtubeFrame = frames.find((frame) => /youtube(?:-nocookie)?\.com\/embed\//i.test(frame.url)); let bodySample = '';
  if (youtubeFrame) {
    const { executionContextId } = await call('Page.createIsolatedWorld', { frameId: youtubeFrame.id, worldName: 'voiceup-player-test' });
    const body = await call('Runtime.evaluate', { contextId: executionContextId, expression: 'document.body?.innerText || ""', returnByValue: true });
    bodySample = String(body.result?.value || '').slice(0, 220);
  }
  console.log(JSON.stringify({ src: reload.result.value, referer: embedRequest?.referer || '', status: embedResponse?.status || null, failed: failures[0]?.error || null, youtubeRequests: requests.length, frameUrl: youtubeFrame?.url || frames[1]?.url || '', error153: /Erro\s*153|Error\s*153/i.test(bodySample), bodySample }));
  socket.close();
})().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
