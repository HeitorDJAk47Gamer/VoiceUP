/* Opt-in hosted attachments. All bytes travel over the authenticated socket. */
(() => {
  'use strict';
  const form = document.getElementById('message-form');
  if (!form) return;
  const chooser = document.createElement('input'); chooser.type = 'file'; chooser.multiple = true; chooser.hidden = true;
  const attach = document.createElement('button'); attach.type = 'button'; attach.className = 'attachment-action hidden'; attach.dataset.attachmentAction = 'files'; attach.textContent = '+'; attach.title = 'Anexar arquivos'; attach.setAttribute('aria-label', attach.title);
  const recordButton = document.createElement('button'); recordButton.type = 'button'; recordButton.className = 'attachment-action hidden'; recordButton.dataset.attachmentAction = 'voice'; recordButton.textContent = '●'; recordButton.title = 'Gravar mensagem de voz'; recordButton.setAttribute('aria-label', recordButton.title);
  const transcribeButton = document.createElement('button'); transcribeButton.type = 'button'; transcribeButton.className = 'attachment-action'; transcribeButton.dataset.attachmentAction = 'dictation'; transcribeButton.textContent = 'T'; transcribeButton.title = 'Falar para escrever'; transcribeButton.setAttribute('aria-label', transcribeButton.title);
  const progress = document.createElement('div'); progress.className = 'attachment-progress hidden'; progress.setAttribute('role', 'status');
  form.prepend(attach, recordButton, transcribeButton, chooser); form.append(progress);
  let policy = { enabled: false, maxBytes: 0 }, busy = false, recorder = null, captured = null, recordingPending = false, recognition = null;
  const rpc = (socket, name, packet = {}) => new Promise((resolve, reject) => {
    if (!socket?.connected || socket !== hostedSocket) return reject(Error('Conecte-se ao servidor para transferir arquivos.'));
    socket.timeout(15000).emit(name, packet, (error, result) => error ? reject(Error('O servidor não respondeu. Atualize o ServerHost ou tente novamente.')) : result?.ok ? resolve(result) : reject(Error(result?.message || 'Operação recusada pelo servidor.')));
  });
  const format = size => size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
  const updatePolicy = async () => {
    const socket = hostedSocket;
    try { const result = await rpc(socket, 'attachment-policy'); if (socket !== hostedSocket) return; policy = result.policy; }
    catch { if (socket === hostedSocket) policy = { enabled: false, maxBytes: 0 }; }
    attach.classList.toggle('hidden', !policy.enabled); recordButton.classList.toggle('hidden', !policy.enabled);
    attach.title = `Anexar arquivos · limite do servidor: ${format(policy.maxBytes)} por arquivo`;
  };
  function showProgress(text) { progress.classList.remove('hidden'); progress.textContent = text; }
  function finishProgress() { progress.replaceChildren(); progress.classList.add('hidden'); }
  async function upload(file) {
    if (!file || busy) return false;
    const socket = hostedSocket, channel = activeTextChannel;
    const thread = typeof activeForumThreadId === 'string' ? activeForumThreadId : '';
    busy = true; attach.disabled = recordButton.disabled = transcribeButton.disabled = true;
    let started = false;
    try {
      await updatePolicy();
      if (!policy.enabled) throw Error('O servidor não permite anexos.');
      if (!file.size || file.size > policy.maxBytes) throw Error(`Este arquivo tem ${format(file.size)}. O limite definido pelo host é ${format(policy.maxBytes)} por arquivo.`);
      const begin = await rpc(socket, 'attachment-begin', { name: file.name, size: file.size, channel, thread }); started = true;
      const chunkBytes = Math.min(48 * 1024, Number(begin.chunkBytes) || 48 * 1024);
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const bytes = new Uint8Array(await file.slice(offset, offset + chunkBytes).arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        await rpc(socket, 'attachment-chunk', { id: begin.id, offset, data: btoa(binary) });
        await new Promise(resolve => setTimeout(resolve, 12));
        showProgress(`Enviando ${file.name}: ${Math.round(Math.min(file.size, offset + bytes.length) / file.size * 100)}%`);
      }
      await rpc(socket, 'attachment-finish', { id: begin.id });
      captured = null; toast(`Enviado: ${file.name}`); finishProgress(); return true;
    } catch (error) { if (started) await rpc(socket, 'attachment-cancel').catch(() => {}); toast(error.message); finishProgress(); }
    finally { busy = false; attach.disabled = recordButton.disabled = transcribeButton.disabled = false; chooser.value = ''; }
  }
  attach.onclick = () => { if (!busy && !recorder) chooser.click(); };
  chooser.onchange = () => void uploadFiles([...chooser.files]);
  async function uploadFiles(files) {
    const selected = files.filter(file => file?.size);
    if (!selected.length || busy) return;
    await updatePolicy();
    if (!policy.enabled) return toast('O servidor não permite anexos.');
    const accepted = selected.filter(file => file.size <= policy.maxBytes);
    const rejected = selected.length - accepted.length;
    if (rejected) toast(`${rejected} arquivo(s) excedem o limite de ${format(policy.maxBytes)} por arquivo.`);
    let sent = 0;
    for (const file of accepted) {
      showProgress(`Preparando ${sent + 1}/${accepted.length}: ${file.name}`);
      if (await upload(file)) sent++;
    }
    if (sent > 1) toast(`${sent} arquivos enviados separadamente.`);
  }
  function stopRecording(cancel = false) {
    if (!recorder) return;
    recorder.cancelled = cancel;
    if (recorder.state !== 'inactive') recorder.stop();
    recorder.stream.getTracks().forEach(track => track.stop());
  }
  recordButton.onclick = async () => {
    if (recorder) { stopRecording(); return; }
    if (busy || recordingPending) return;
    recordingPending = true;
    const socket = hostedSocket;
    try {
      await updatePolicy(); if (!policy.enabled) throw Error('O servidor não permite áudios anexados.');
      if (!window.MediaRecorder) throw Error('Gravação de áudio indisponível neste aplicativo.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (socket !== hostedSocket || !socket?.connected) { stream.getTracks().forEach(track => track.stop()); return; }
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
      recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined);
      const current = recorder, chunks = []; let size = 0, seconds = 0;
      const ticker = setInterval(() => { seconds++; showProgress(`Gravando: ${seconds}s · clique no botão de gravação para parar`); if (seconds >= 600) stopRecording(); }, 1000);
      current.ondataavailable = ({ data }) => { if (data.size) { chunks.push(data); size += data.size; if (size >= policy.maxBytes - 65536 && current.state !== 'inactive') stopRecording(); } };
      current.onstop = () => {
        clearInterval(ticker); stream.getTracks().forEach(track => track.stop()); recorder = null; recordButton.textContent = '●'; recordButton.setAttribute('aria-label', 'Gravar mensagem de voz');
        if (current.cancelled || !size || socket !== hostedSocket) { finishProgress(); return; }
        const type = current.mimeType, extension = type.includes('ogg') ? 'ogg' : 'webm';
        captured = new File(chunks, `voz-${Date.now()}.${extension}`, { type });
        progress.replaceChildren(); progress.classList.remove('hidden');
        const audio = document.createElement('audio'); audio.controls = true;
        const url = URL.createObjectURL(captured); audio.src = url;
        const send = document.createElement('button'); send.type = 'button'; send.textContent = 'Enviar áudio'; send.onclick = () => { URL.revokeObjectURL(url); void upload(captured); };
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Descartar'; cancel.onclick = () => { audio.pause(); URL.revokeObjectURL(url); captured = null; finishProgress(); };
        progress.append(audio, send, cancel);
      };
      current.onerror = () => { stopRecording(true); toast('Não foi possível concluir a gravação.'); };
      current.start(500); recordButton.textContent = '■'; recordButton.setAttribute('aria-label', 'Parar gravação de voz'); showProgress('Gravando…');
    } catch (error) { toast(error.message || 'Permita o microfone para gravar.'); }
    finally { recordingPending = false; }
  };
  async function startWindowsDictation() {
    const desktop = window.voiceupDesktop, input = document.getElementById('message-input');
    if (!desktop?.startWindowsVoiceTyping || !input) return false;
    input.focus();
    const result = await desktop.startWindowsVoiceTyping();
    if (!result?.ok) { toast(result?.message || 'O Ditado por Voz do Windows não está disponível.'); return true; }
    showProgress('Ditado por Voz do Windows aberto. Fale e revise o texto antes de enviar.');
    setTimeout(finishProgress, 3500);
    return true;
  }
  transcribeButton.onclick = () => {
    if (recognition) { recognition.stop(); return; }
    if (window.voiceupDesktop?.platform === 'win32') { void startWindowsDictation(); return; }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return toast('Ditado por voz não está disponível neste mecanismo.');
    const input = document.getElementById('message-input'); if (!input) return;
    const base = input.value.trimEnd(); let recognized = '';
    recognition = new Recognition(); recognition.lang = document.documentElement.lang || 'pt-BR'; recognition.continuous = true; recognition.interimResults = true;
    const write = value => { input.value = [base, value.trim()].filter(Boolean).join(base && value.trim() ? ' ' : ''); input.dispatchEvent(new Event('input', { bubbles: true })); };
    recognition.onstart = () => { transcribeButton.textContent = '■'; transcribeButton.title = 'Parar ditado'; showProgress('Ouvindo… o texto ainda não foi enviado.'); };
    recognition.onresult = event => {
      let finalText = '', interim = '';
      for (let index = 0; index < event.results.length; index++) { const text = event.results[index][0]?.transcript || ''; if (event.results[index].isFinal) finalText += text; else interim += text; }
      recognized = finalText; write(`${finalText}${interim}`);
    };
    recognition.onerror = event => { if (event.error !== 'aborted') toast(`Ditado interrompido: ${event.error || 'erro desconhecido'}.`); };
    recognition.onend = () => { recognition = null; transcribeButton.textContent = 'T'; transcribeButton.title = 'Falar para escrever'; write(recognized); finishProgress(); if (recognized.trim()) toast('Texto inserido. Revise e clique em Enviar quando quiser.'); };
    try { recognition.start(); } catch { recognition = null; toast('Não foi possível iniciar o ditado agora.'); }
  };
  const beforeJoin = joinHostedRoom;
  joinHostedRoom = async function (...args) {
    policy = { enabled: false, maxBytes: 0 }; attach.classList.add('hidden'); recordButton.classList.add('hidden'); stopRecording(true);
    const result = await beforeJoin(...args), socket = hostedSocket;
    if (socket) {
      socket.on('room-joined', updatePolicy);
      socket.on('disconnect', () => { if (socket === hostedSocket) { stopRecording(true); attach.classList.add('hidden'); recordButton.classList.add('hidden'); } });
      if (socket.connected) void updatePolicy();
    }
    return result;
  };
  setInterval(() => { if (hostedSocket?.connected) void updatePolicy(); }, 15000);
  window.addEventListener('beforeunload', () => stopRecording(true));

  const render = renderMessageContent;
  renderMessageContent = function (value, ...args) {
    const id = /^\[\[voiceup-file:([a-f0-9]{32})\]\]$/.exec(String(value || ''))?.[1];
    return id ? `<section class="chat-file" data-chat-file="${id}"><span>📎 Carregando anexo…</span><button type="button" data-file-load>Carregando…</button></section>` : render(value, ...args);
  };
  function showSourcePreview(card, meta, bytes, download) {
    const rich = globalThis.voiceupChatRichContent;
    const language = rich?.sourceFileLanguage(meta.name);
    if (!language) return;
    let first;
    try { first = rich.sourceFileChunk(bytes, 0, true); } catch { return; }
    const preview = document.createElement('section'); preview.className = 'source-file-preview';
    const pre = document.createElement('pre'), code = document.createElement('code'); pre.append(code);
    const remaining = document.createElement('div'); remaining.className = 'source-file-remaining';
    const footer = document.createElement('footer');
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = '⌄'; toggle.setAttribute('aria-label', 'Expandir arquivo'); toggle.setAttribute('aria-expanded', 'false');
    const info = document.createElement('span'); info.className = 'source-file-info';
    const name = document.createElement('strong'); name.textContent = meta.name;
    const size = document.createElement('small'); size.textContent = `${rich.formatBytes(meta.size)} · ${rich.languageLabel(language)}`; info.append(name, size);
    const more = document.createElement('button'); more.type = 'button'; more.className = 'source-file-more'; more.textContent = 'Carregar mais';
    let offset = first.next, expanded = false;
    const update = () => {
      remaining.textContent = offset < bytes.length ? `… (${rich.formatBytes(bytes.length - offset)} restantes)` : '';
      remaining.hidden = offset >= bytes.length;
      more.hidden = !expanded || offset >= bytes.length;
    };
    code.innerHTML = rich.highlightCode(first.text, language);
    more.onclick = () => {
      try {
        const chunk = rich.sourceFileChunk(bytes, offset);
        const part = document.createElement('span'); part.innerHTML = rich.highlightCode(chunk.text, language); code.append(part);
        offset = chunk.next; update();
      } catch { more.hidden = true; remaining.textContent = 'Não foi possível visualizar este trecho. O arquivo completo está disponível para baixar.'; }
    };
    toggle.onclick = () => {
      expanded = !expanded; preview.classList.toggle('expanded', expanded);
      toggle.textContent = expanded ? '⌃' : '⌄'; toggle.setAttribute('aria-expanded', String(expanded)); toggle.setAttribute('aria-label', expanded ? 'Recolher arquivo' : 'Expandir arquivo');
      if (expanded && offset === first.next) more.click();
      if (!expanded) { code.innerHTML = rich.highlightCode(first.text, language); offset = first.next; pre.scrollTop = 0; }
      update();
    };
    footer.append(toggle, info, download); preview.append(pre, remaining, more, footer); update();
    card.replaceChildren(preview); card.classList.add('has-source-preview');
  }
  async function loadAttachment(card) {
    if (!card || card.dataset.fileLoading === 'true' || card.dataset.fileReady === 'true') return;
    const button = card.querySelector('[data-file-load]'), socket = hostedSocket;
    if (!button || !socket?.connected) return;
    card.dataset.fileLoading = 'true';
    button.disabled = true;
    try {
      const { attachment: meta, chunkBytes } = await rpc(socket, 'attachment-read', { id: card.dataset.chatFile });
      if (!Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > 256 * 1024 * 1024) throw Error('Tamanho de arquivo inválido.');
      card.querySelector('span').textContent = `${meta.name} · ${format(meta.size)}`;
      const chunks = []; let offset = 0;
      while (offset < meta.size) {
        const result = await rpc(socket, 'attachment-read', { id: meta.id, offset });
        const data = Uint8Array.from(atob(result.data), char => char.charCodeAt(0));
        if (data.length < 1 || data.length > 48 * 1024 || result.next !== offset + data.length || result.next > meta.size) throw Error('Bloco de arquivo inválido.');
        chunks.push(data); offset = result.next; button.textContent = `${Math.round(offset / meta.size * 100)}%`;
        await new Promise(resolve => setTimeout(resolve, 12));
      }
      const blob = new Blob(chunks), bytes = await blob.arrayBuffer();
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      if (digest !== meta.sha256) throw Error('A integridade do arquivo não pôde ser confirmada.');
      const header = new Uint8Array(bytes).slice(0, 12);
      const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71;
      const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255;
      const webm = header[0] === 26 && header[1] === 69 && header[2] === 223 && header[3] === 163 && /\.webm$/i.test(meta.name);
      const ogg = header[0] === 79 && header[1] === 103 && header[2] === 103 && header[3] === 83 && /\.ogg$/i.test(meta.name);
      const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webm ? 'audio/webm' : ogg ? 'audio/ogg' : 'application/octet-stream';
      const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
      const link = document.createElement('a'); link.href = url; link.download = meta.name; link.textContent = 'Baixar arquivo'; card.append(link); button.remove(); card.dataset.fileReady = 'true';
      if (png || jpeg) { const image = document.createElement('img'); image.src = url; image.alt = meta.name; image.loading = 'lazy'; card.append(image); }
      if (webm || ogg) { const audio = document.createElement('audio'); audio.src = url; audio.controls = true; audio.preload = 'metadata'; card.append(audio); }
      if (!png && !jpeg && !webm && !ogg) showSourcePreview(card, meta, new Uint8Array(bytes), link);
      const observer = new MutationObserver(() => { if (!card.isConnected) { URL.revokeObjectURL(url); observer.disconnect(); } }); observer.observe(document.body, { childList: true, subtree: true });
    } catch (error) { toast(error.message); card.dataset.fileError = 'true'; button.disabled = false; button.textContent = 'Tentar novamente'; }
    finally { delete card.dataset.fileLoading; }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-file-load]'); if (button) { delete button.closest('[data-chat-file]').dataset.fileError; void loadAttachment(button.closest('[data-chat-file]')); }
  });
  const autoLoadAttachments = () => document.querySelectorAll('[data-chat-file]:not([data-file-ready]):not([data-file-loading]):not([data-file-error])').forEach(card => void loadAttachment(card));
  new MutationObserver(autoLoadAttachments).observe(document.getElementById('messages'), { childList: true, subtree: true });
  setInterval(autoLoadAttachments, 500);

  // Replace only the connected-server brand, never the welcome screen.
  const profile = rememberHostedServerProfile;
  rememberHostedServerProfile = function (info = {}) {
    profile(info);
    const brand = document.querySelector('#app .brand'); if (!brand) return;
    const icon = safeHostedServerIcon(info.icon), title = String(activeHostedRoomName || document.getElementById('host-room')?.value || 'Servidor').slice(0, 80);
    brand.replaceChildren();
    if (icon) { const image = document.createElement('img'); image.src = icon; image.alt = ''; brand.append(image); }
    else { const fallback = document.createElement('span'); fallback.className = 'server-brand-fallback'; fallback.textContent = title.slice(0, 1).toUpperCase(); brand.append(fallback); }
    const name = document.createElement('span'); name.textContent = title; name.title = title; brand.append(name);
  };
})();
