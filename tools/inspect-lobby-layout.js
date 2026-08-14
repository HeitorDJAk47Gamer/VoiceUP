const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9342);
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
    if (!target) throw new Error('Janela do VoiceUP não encontrada.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.on('open', () => {
      socket.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
        expression: `(async () => {
          document.querySelector('#welcome').classList.add('hidden');
          document.querySelector('#app').classList.remove('hidden');
          currentMode = 'hosted'; activeVoiceChannel = '';
          setCallMode('hosted'); syncHostedLobbyLayout();
          document.querySelector('#messages').innerHTML = '';
          addMessage('Mensagem curta', 'Teste', true, '#56e2cf', { id: 'layout-test', createdAt: Date.now() });
          await new Promise((resolve) => setTimeout(resolve, 260));
          const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const slot = rect('#server-lobby-chat-slot');
          const panel = rect('#server-lobby #chat-panel');
          const form = rect('#server-lobby #message-form');
          const message = rect('#server-lobby #messages>.message');
          const messageBody = rect('#server-lobby #messages>.message .message-body');
          const edit = rect('#server-lobby #messages>.message .message-edit');
          return JSON.stringify({
            version: window.voiceupVersion,
            lobby: document.body.classList.contains('server-lobby-mode'),
            slotPanelGap: Math.round(Math.abs(slot.right - panel.right)),
            panelFormGap: Math.round(Math.abs(panel.right - form.right)),
            messageWidth: Math.round(message.width),
            bodyWidth: Math.round(messageBody.width),
            editGap: Math.round(edit.left - messageBody.right),
            formRightPadding: getComputedStyle(document.querySelector('#message-form')).paddingRight
          });
        })()`,
        awaitPromise: true,
        returnByValue: true
        }
      }));
    });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.result?.exceptionDetails) { console.error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text); process.exitCode = 1; }
      else console.log(message.result?.result?.value || '{}');
      socket.close();
    });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
