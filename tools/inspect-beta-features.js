const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9346);
http.get(`http://127.0.0.1:${port}/json`, (response) => {
  let body = '';
  response.on('data', (chunk) => { body += chunk; });
  response.on('end', () => {
    const target = JSON.parse(body).find((entry) => entry.type === 'page' && /VoiceUP/i.test(entry.title));
    if (!target) throw new Error('Janela do VoiceUP não encontrada.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    let exceptions = 0;
    const call = (method, params = {}) => socket.send(JSON.stringify({ id: ++id, method, params }));
    socket.on('open', () => {
      call('Runtime.enable');
      setTimeout(() => call('Runtime.evaluate', {
        expression: `(async () => {
          document.querySelector('#welcome').classList.add('hidden');
          document.querySelector('#app').classList.remove('hidden');
          currentMode = 'manual';
          const sent = [];
          peer = { channel: { readyState: 'open', send: (value) => sent.push(JSON.parse(value)) } };
          channelMessages.set(activeTextChannel, [{ id: 'feature-mine', text: 'Mensagem editável', name: myName || 'Teste', mine: true, color: myColor, createdAt: Date.now(), reactions: {}, pinned: false }]);
          renderChannelMessages();
          await new Promise((resolve) => setTimeout(resolve, 80));
          const playedNotifications = [];
          const originalPlayNotification = playNotification;
          playNotification = (kind) => playedNotifications.push(kind);
          await receiveData(JSON.stringify({ type: 'chat', messageId: 'feature-mention', text: '@Teste veja isto', name: 'Outro', color: '#4fd6c7', createdAt: Date.now(), mentions: [clientId] }));
          playNotification = originalPlayNotification;
          const mentionHighlighted = document.querySelector('[data-message-id="feature-mention"]')?.classList.contains('mentioned-me');
          const mentionChannelBadge = Boolean(document.querySelector('[data-text-channel="' + CSS.escape(activeTextChannel) + '"] .mention-channel-badge'));
          const message = document.querySelector('[data-message-id="feature-mine"]');
          const toolbarTitles = [...message.querySelectorAll('.message-action-toolbar button')].map((button) => button.title);
          message.querySelector('[data-message-action="reply"]').click();
          const replyOpen = !document.querySelector('#reply-composer').classList.contains('hidden');
          message.querySelector('[data-message-action="react"]').click();
          document.querySelector('.quick-reaction-popover button').click();
          document.querySelector('[data-message-id="feature-mine"] [data-message-action="delete"]').click();
          await new Promise((resolve) => setTimeout(resolve, 30));
          document.querySelector('[data-dialog-value="delete"]').click();
          await new Promise((resolve) => setTimeout(resolve, 30));
          document.querySelector('#settings-button').click();
          document.querySelector('[data-settings-tab="shortcuts"]').click();
          const shortcutTab = document.querySelector('[data-settings-panel="shortcuts"]').classList.contains('active');
          document.querySelector('#settings-close').click();
          const first = document.querySelector('#video-gallery .video-tile');
          first.classList.remove('hidden');
          const second = ensureVideoTile('feature-two', 'Outra transmissão'); second.classList.remove('hidden');
          document.querySelector('#media-layout-select').value = 'focus';
          document.querySelector('#media-layout-select').dispatchEvent(new Event('change', { bubbles: true }));
          second.click();
          const focused = document.querySelector('#video-gallery .layout-focused')?.dataset.videoPeer;
          document.querySelector('#right-panel-collapse').click();
          const panelCollapsed = document.body.classList.contains('right-panel-collapsed');
          document.querySelector('#right-panel-reopen').click();
          return JSON.stringify({
            toolbarTitles,
            editDeleteAdjacent: toolbarTitles.indexOf('Apagar mensagem') === toolbarTitles.indexOf('Editar mensagem') + 1,
            replyOpen,
            reactionSent: sent.some((item) => item.type === 'chat-reaction'),
            deleteSent: sent.some((item) => item.type === 'chat-delete'),
            deletedLocally: !document.querySelector('[data-message-id="feature-mine"]'),
            shortcutTab,
            shortcutFields: document.querySelectorAll('[data-global-shortcut]').length,
            reconnectBanner: Boolean(document.querySelector('#reconnect-banner')),
            serverRail: Boolean(document.querySelector('#server-rail')),
            contextBadge: Boolean(document.querySelector('#central-context-badge')),
            mediaLayout: document.querySelector('#video-gallery').dataset.mediaLayout,
            focused,
            panelCollapsed,
            panelReopened: !document.body.classList.contains('right-panel-collapsed'),
            mentionHighlighted,
            mentionChannelBadge,
            mentionSound: playedNotifications.includes('mention')
          });
        })()`,
        awaitPromise: true,
        returnByValue: true
      }), 600);
      setTimeout(() => { console.log(JSON.stringify({ exceptions })); socket.close(); }, 4500);
    });
    socket.on('message', (raw) => {
      const value = JSON.parse(raw);
      if (value.result?.result?.value) console.log(value.result.result.value);
      if (value.result?.exceptionDetails) { exceptions += 1; console.error(value.result.exceptionDetails.exception?.description || value.result.exceptionDetails.text); }
      if (value.method === 'Runtime.exceptionThrown') { exceptions += 1; console.error(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text); }
    });
  });
}).on('error', (error) => { console.error(error.message); process.exitCode = 1; });
