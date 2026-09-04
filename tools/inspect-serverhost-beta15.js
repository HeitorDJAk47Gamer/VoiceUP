const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9333);
const output = path.join(__dirname, 'serverhost-beta15-rooms.png');
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page');
    if (!target) throw new Error('Janela do ServerHost não encontrada');
    const socket = new WebSocket(target.webSocketDebuggerUrl); let id = 0; const callbacks = new Map(); let exceptions = 0;
    const call = (method, params = {}) => new Promise((resolve) => { const callId = ++id; callbacks.set(callId, resolve); socket.send(JSON.stringify({ id: callId, method, params })); });
    socket.on('open', async () => {
      await call('Runtime.enable'); await call('Page.enable');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const roomCheck = await call('Runtime.evaluate', { expression: `(() => {
        document.querySelector('[data-view="rooms"]').click();
        return JSON.stringify({
          page: document.querySelector('.view.active')?.dataset.page,
          template: Boolean(document.querySelector('#room-template')),
          discordImport: Boolean(document.querySelector('#import-discord-template')),
          voiceCards: document.querySelectorAll('#voice-channel-editor .channel-editor-card').length,
          textCards: document.querySelectorAll('#text-channel-editor .channel-editor-card').length,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
        });
      })()`, returnByValue: true });
      const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.writeFileSync(output, Buffer.from(screenshot.result.data, 'base64'));
      const diagnosticCheck = await call('Runtime.evaluate', { expression: `(() => {
        document.querySelector('[data-view="activity"]').click();
        const activity = {
          page: document.querySelector('.view.active')?.dataset.page,
          bandwidth: Boolean(document.querySelector('#bandwidth-in')),
          p2pMap: Boolean(document.querySelector('#p2p-map')),
          webrtc: Boolean(document.querySelector('#webrtc-table'))
        };
        document.querySelector('[data-view="settings"]').click();
        return JSON.stringify({ ...activity, clusterNodes: Boolean(document.querySelector('#cluster-nodes')), failover: Boolean(document.querySelector('#cluster-failover')), smartDistribution: Boolean(document.querySelector('#cluster-smart-distribution')) });
      })()`, returnByValue: true });
      console.log(roomCheck.result.result.value); console.log(diagnosticCheck.result.result.value); console.log(JSON.stringify({ screenshot: output, exceptions })); socket.close();
    });
    socket.on('message', (raw) => { const value = JSON.parse(raw); if (value.id && callbacks.has(value.id)) { callbacks.get(value.id)(value); callbacks.delete(value.id); } if (value.method === 'Runtime.exceptionThrown') { exceptions += 1; console.error(value.params.exceptionDetails.text); } });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
