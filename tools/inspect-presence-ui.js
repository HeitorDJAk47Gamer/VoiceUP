const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9334);
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
    if (!target) throw new Error('Janela do VoiceUP não encontrada.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    socket.on('open', () => socket.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: {
        expression: `(async () => {
          window.voiceupSetPresenceStatus('dnd');
          currentMode = 'hosted';
          serverMembers.clear();
          serverMembers.set('presence-bob', { id: 'presence-bob', name: 'Bob', color: '#ff8b72', avatar: '', status: 'idle', voiceChannel: '' });
          renderBetaMembers();
          const input = document.querySelector('#message-input');
          input.value = '@bo'; input.setSelectionRange(3, 3); input.dispatchEvent(new Event('input', { bubbles: true }));
          addMessage('@Bob teste', 'Alice', false, '#6676ea', { mentioned: true });
          await new Promise((resolve) => setTimeout(resolve, 80));
          return JSON.stringify({
            statusButton: document.querySelector('#presence-status-button')?.classList.contains('status-dnd'),
            idleMember: document.querySelector('[data-member-id="presence-bob"] .status-idle') !== null,
            suggestions: document.querySelectorAll('#mention-suggestions .mention-option').length,
            highlighted: document.querySelector('.message.mentioned-me') !== null
          });
        })()`,
        awaitPromise: true,
        returnByValue: true
      }
    })));
    socket.on('message', (raw) => {
      const message = JSON.parse(raw);
      if (message.id !== 1) return;
      if (message.result?.exceptionDetails) { console.error(message.result.exceptionDetails.exception?.description || message.result.exceptionDetails.text); process.exitCode = 1; }
      else console.log(message.result?.result?.value || '{}');
      socket.close();
    });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
