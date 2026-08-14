const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9333);
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    let exceptions = 0;
    const call = (method, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params }));
    socket.on('open', () => {
      call('Runtime.enable');
      setTimeout(() => call('Runtime.evaluate', {
        expression: `JSON.stringify({
          title: document.title,
          page: document.querySelector('.view.active')?.dataset.page,
          participants: document.querySelector('#participants')?.textContent,
          server: document.querySelector('#sidebar-state')?.textContent,
          theme: document.body.dataset.theme,
          styleSheets: document.styleSheets.length,
          releaseButton: document.querySelector('#server-release-notes')?.textContent,
          releaseDialogTitle: document.querySelector('#app-dialog-title')?.textContent,
          releaseIncludesVisual: document.querySelector('#app-dialog-detail')?.textContent.includes('VISUAL') || false,
          releaseIncludesPlugins: document.querySelector('#app-dialog-detail')?.textContent.includes('PLUGINS') || false,
          releaseWide: document.querySelector('#app-dialog')?.classList.contains('wide') || false
        })`,
        returnByValue: true
      }), 700);
      setTimeout(() => { console.log(JSON.stringify({ exceptions })); socket.close(); }, 1500);
    });
    socket.on('message', (message) => {
      const value = JSON.parse(message);
      if (value.result?.result?.value) console.log(value.result.result.value);
      if (value.method === 'Runtime.exceptionThrown') { exceptions += 1; console.error(value.params.exceptionDetails.text); }
    });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
