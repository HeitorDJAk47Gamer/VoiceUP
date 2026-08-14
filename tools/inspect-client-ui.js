const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2] || 9334);
const request = http.get(`http://127.0.0.1:${port}/json`, (response) => {
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
          document.querySelector('#messages').innerHTML = '';
          addMessage('Imagem https://images.unsplash.com/photo-1472214103451-9374bd1c798e.jpg', 'Teste', false, '#56e2cf');
          addMessage('Vídeo https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Teste', false, '#56e2cf');
          addMessage('Site https://www.google.com/', 'Teste', false, '#56e2cf');
          addMessage('Texto **forte**, *itálico*, ~~riscado~~ e \`código\`.', 'Teste', false, '#56e2cf');
          document.querySelector('#emoji-button').click();
          const emoji = document.querySelector('#emoji-picker [data-emoji]');
          emoji.click();
          document.querySelector('#emoji-picker [data-picker-tab="gif"]').click();
          document.querySelector('#emoji-search-input').value = 'comemorar';
          document.querySelector('#emoji-search-input').dispatchEvent(new Event('input', { bubbles: true }));
          const gifResults = document.querySelectorAll('#emoji-picker-results [data-gif]').length;
          document.querySelector('#local-video').classList.add('visible');
          await new Promise((resolve) => setTimeout(resolve, 80));
          const previewBox = document.querySelector('#local-video').getBoundingClientRect();
          document.querySelector('#local-video').dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: previewBox.right - 1, clientY: previewBox.top + previewBox.height / 2 }));
          screenStream = { getVideoTracks: () => [{ readyState: 'live' }], getTracks: () => [] };
          document.querySelector('#screen-button').click();
          const previewApi = await window.voiceupDesktop.linkPreview('https://www.google.com/');
          await new Promise((resolve) => setTimeout(resolve, 1800));
          window.voiceupSetPresenceStatus('dnd');
          currentMode = 'hosted';
          serverMembers.set('inspect-bob', { id: 'inspect-bob', name: 'Bob', color: '#ff8b72', avatar: '', status: 'idle', voiceChannel: '' });
          document.querySelector('#message-input').value = '@bo';
          document.querySelector('#message-input').setSelectionRange(3, 3);
          document.querySelector('#message-input').dispatchEvent(new Event('input', { bubbles: true }));
          addMessage('@Bob teste', 'Alice', false, '#6676ea', { mentioned: true });
          const imageMessage = [...document.querySelectorAll('.message')].find((message) => message.textContent.includes('Imagem'));
          return JSON.stringify({
            version: window.voiceupVersion,
            resolutions: [...document.querySelector('#quality-select').options].map((option) => option.value),
            frameRates: [...document.querySelector('#fps-select').options].map((option) => option.value),
            imageEmbed: Boolean(document.querySelector('.message-image-embed img')),
            imageLinkVisible: Boolean(imageMessage?.querySelector('.message-link')),
            youtubeEmbed: Boolean(document.querySelector('.message-video-embed iframe')),
            youtubeSrc: document.querySelector('.message-video-embed iframe')?.src || '',
            linkCard: Boolean(document.querySelector('.message-link-card')),
            linkCardTitle: document.querySelector('.message-link-card b')?.textContent || '',
            previewApi: previewApi?.title || null,
            linkColor: getComputedStyle(document.querySelector('.message-link')).color,
            emojiPicker: !document.querySelector('#emoji-picker').classList.contains('hidden'),
            emojiInserted: document.querySelector('#message-input').value,
            gifResults,
            markdownStrong: Boolean(document.querySelector('.message-body strong')),
            markdownItalic: Boolean(document.querySelector('.message-body em')),
            markdownCode: Boolean(document.querySelector('.message-body code')),
            previewButtonsRemoved: !document.querySelector('#preview-size-controls'),
            previewEdgeCursor: document.querySelector('#local-video').style.cursor,
            sourceQualityOption: Boolean(document.querySelector('#capture-source-quality-toggle')),
            presenceDnd: document.querySelector('#presence-status-button')?.classList.contains('status-dnd') || false,
            mentionSuggestions: document.querySelectorAll('#mention-suggestions .mention-option').length,
            mentionHighlighted: Boolean(document.querySelector('.message.mentioned-me')),
            releaseEyebrow: document.querySelector('#release-notes-eyebrow')?.textContent || '',
            releaseTitle: document.querySelector('#release-notes-title')?.textContent || '',
            releaseIncludesServerHost: document.querySelector('#release-notes-list')?.textContent.includes('ServerHost') || false,
            liveDialog: document.querySelector('#voiceup-dialog-title').textContent,
            liveActions: [...document.querySelectorAll('#voiceup-dialog-actions button')].map((button) => button.textContent)
          });
        })()`,
        awaitPromise: true,
        returnByValue: true
      }), 900);
      setTimeout(() => { console.log(JSON.stringify({ exceptions })); socket.close(); }, 10000);
    });
    socket.on('message', (message) => {
      const value = JSON.parse(message);
      if (value.result?.result?.value) console.log(value.result.result.value);
      if (value.method === 'Runtime.exceptionThrown') { exceptions += 1; console.error(value.params.exceptionDetails.exception?.description || value.params.exceptionDetails.text); }
    });
  });
});

request.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
