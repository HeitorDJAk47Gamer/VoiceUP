(() => {
  'use strict';

  const installedVersion = String(window.voiceupVersion || '1.1.2');
  const version = installedVersion;
  const seenKey = 'voiceup-release-notes-seen-v1';
  const locale = () => ['pt-BR', 'en-US', 'es-ES', 'fr-FR'].includes(document.documentElement.lang) ? document.documentElement.lang : 'pt-BR';
  const copy = {
    'pt-BR': {
      eyebrow: 'VERSÃO {version}', title: 'Novidades da v1.1.2', subtitle: 'Esta lista reúne somente as mudanças feitas desde a v1.1.1.', close: 'Entendi', reopen: 'Novidades da {version}', auto: 'Salvamento automático',
      notes: [
        'Transmissões — várias lives e câmeras podem permanecer ativas ao mesmo tempo; cada pessoa escolhe qual transmissão assistir.',
        'Mídia — controles locais de volume, saída da live, tela cheia corrigida, troca de fonte e prévia redimensionável.',
        'Áudio — voz da call e áudio da transmissão foram separados; a live nunca inclui o microfone e continua audível mesmo com a call mutada.',
        'Câmera — seleção e prévia nas configurações, com recuperação mais clara quando outro aplicativo estiver usando o dispositivo.',
        'Conexão — reconexão mais transparente, P2P direto por convite e diagnóstico de acesso público por UPnP/NAT-PMP.',
        'Chat — respostas, reações, fixação, exclusão própria, formatação, GIFs, embeds, menções destacadas e indicador de digitação.',
        'Presença — status Online, Ausente e Não perturbe, ping em barras e compatibilidade visual com Clients antigos.',
        'ServerHost — editor de salas/canais, limites de call, salas privadas, moderação temporária e cluster primário/secundário com failover.',
        'Cloud — histórico e relatórios agora podem usar SQLite em disco, com migração automática do JSON anterior e limpeza configurável.',
        'Estabilidade — correções de áudio entre versões, de transmissões simultâneas, barras de rolagem, temas e controles de tela cheia.'
      ]
    },
    'en-US': {
      eyebrow: 'VERSION {version}', title: 'What is new in v1.1.2', subtitle: 'This list contains only changes made since v1.1.1.', close: 'Got it', reopen: 'What is new in {version}', auto: 'Autosave on',
      notes: [
        'Streaming — multiple screen shares and cameras can stay active together; each person chooses which stream to watch.',
        'Media — local volume, leave-stream controls, corrected fullscreen, source switching and a resizable preview.',
        'Audio — call voice and stream audio are separate; streams never include the microphone and remain audible while the call is muted.',
        'Camera — settings selection and preview, with clearer recovery when another app is using the device.',
        'Connection — more transparent reconnect, direct P2P invites and public-access diagnostics through UPnP/NAT-PMP.',
        'Chat — replies, reactions, pins, author deletion, formatting, GIFs, embeds, highlighted mentions and typing indicators.',
        'Presence — Online, Idle and Do Not Disturb, signal-style ping and visual compatibility with older Clients.',
        'ServerHost — room/channel editor, call limits, private rooms, temporary moderation and primary/secondary failover.',
        'Cloud — chat history and reports can now use disk-backed SQLite with automatic legacy JSON migration and configurable cleanup.',
        'Stability — fixes for cross-version audio, simultaneous streams, scrollbars, themes and fullscreen controls.'
      ]
    },
    'es-ES': {
      eyebrow: 'VERSIÓN {version}', title: 'Novedades de la v1.1.2', subtitle: 'Esta lista contiene solo los cambios realizados desde la v1.1.1.', close: 'Entendido', reopen: 'Novedades de {version}', auto: 'Guardado automático',
      notes: [
        'Transmisiones — varias pantallas y cámaras pueden permanecer activas; cada persona elige qué transmisión ver.',
        'Multimedia — volumen local, salida de transmisión, pantalla completa corregida, cambio de fuente y vista previa redimensionable.',
        'Audio — voz y transmisión están separadas; la live no incluye el micrófono y sigue audible con la llamada silenciada.',
        'Cámara — selección y vista previa en ajustes, con recuperación más clara si otra aplicación usa el dispositivo.',
        'Conexión — reconexión más transparente, invitaciones P2P directas y diagnóstico público por UPnP/NAT-PMP.',
        'Chat — respuestas, reacciones, fijados, borrado propio, formato, GIF, embeds, menciones e indicador de escritura.',
        'Presencia — En línea, Ausente y No molestar, ping por barras y compatibilidad con Clients antiguos.',
        'ServerHost — editor de salas/canales, límites, salas privadas, moderación temporal y failover primario/secundario.',
        'Cloud — historial y reportes pueden usar SQLite en disco con migración automática del JSON anterior.',
        'Estabilidad — correcciones para audio entre versiones, transmisiones simultáneas, barras, temas y pantalla completa.'
      ]
    },
    'fr-FR': {
      eyebrow: 'VERSION {version}', title: 'Nouveautés de la v1.1.2', subtitle: 'Cette liste contient uniquement les changements effectués depuis la v1.1.1.', close: 'Compris', reopen: 'Nouveautés de {version}', auto: 'Enregistrement auto',
      notes: [
        'Partages — plusieurs écrans et caméras peuvent rester actifs; chacun choisit le direct à regarder.',
        'Média — volume local, sortie du direct, plein écran corrigé, changement de source et aperçu redimensionnable.',
        'Audio — voix et direct sont séparés; le direct n’inclut jamais le micro et reste audible quand l’appel est coupé.',
        'Caméra — sélection et aperçu dans les réglages, avec une récupération plus claire si une autre app utilise la caméra.',
        'Connexion — reconnexion plus transparente, invitations P2P directes et diagnostic UPnP/NAT-PMP.',
        'Chat — réponses, réactions, épingles, suppression par auteur, formatage, GIF, embeds, mentions et saisie.',
        'Présence — En ligne, Absent et Ne pas déranger, ping en barres et compatibilité avec les anciens Clients.',
        'ServerHost — éditeur de salons/canaux, limites, salons privés, modération temporaire et failover primaire/secondaire.',
        'Cloud — historique et rapports peuvent utiliser SQLite sur disque avec migration automatique des anciens JSON.',
        'Stabilité — corrections audio entre versions, partages simultanés, barres, thèmes et plein écran.'
      ]
    }
  };

  document.body.insertAdjacentHTML('beforeend', `<div id="release-notes-modal" class="release-notes-modal hidden" role="dialog" aria-modal="true" aria-labelledby="release-notes-title">
    <article class="release-notes-card">
      <button id="release-notes-x" class="release-notes-x" type="button" aria-label="Fechar">×</button>
      <div class="release-notes-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 1.8 5.1L19 9l-5.2 1.9L12 16l-1.8-5.1L5 9l5.2-1.9zM19 15l.9 2.4 2.1.8-2.1.8L19 22l-.9-3-2.1-.8 2.1-.8zM5 14l.7 2 1.8.7-1.8.7L5 20l-.7-2.6-1.8-.7 1.8-.7z"/></svg></div>
      <div class="release-notes-copy"><p id="release-notes-eyebrow" class="eyebrow"></p><h2 id="release-notes-title"></h2><p id="release-notes-subtitle"></p></div>
      <ul id="release-notes-list"></ul>
      <button id="release-notes-close" type="button"></button>
    </article>
  </div>`);
  document.head.insertAdjacentHTML('beforeend', `<style>
    .release-notes-modal{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--night) 74%,transparent);backdrop-filter:blur(9px);animation:release-fade .16s ease}.release-notes-card{position:relative;width:min(620px,calc(100vw - 30px));max-height:min(88dvh,820px);overflow:auto;display:grid;grid-template-columns:58px minmax(0,1fr);gap:15px;padding:24px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--surface) 87%,var(--focus) 13%));color:var(--ink);box-shadow:0 28px 80px rgba(0,0,0,.38);animation:release-rise .22s ease}.release-notes-mark{width:58px;height:58px;display:grid;place-items:center;border-radius:17px;color:var(--focus);background:color-mix(in srgb,var(--focus) 13%,var(--surface));border:1px solid color-mix(in srgb,var(--focus) 42%,var(--line));box-shadow:0 0 24px color-mix(in srgb,var(--focus) 20%,transparent)}.release-notes-mark svg{width:30px;height:30px;fill:currentColor}.release-notes-copy{align-self:center}.release-notes-copy h2{margin:3px 38px 5px 0;font:700 24px Outfit,'Segoe UI',sans-serif}.release-notes-copy>p:last-child{margin:0;color:var(--muted);font-size:12px}.release-notes-card ul{grid-column:1/-1;display:grid;align-content:start;gap:9px;margin:2px 0 4px;padding:14px 16px 14px 38px;border:1px solid var(--line);border-radius:13px;background:color-mix(in srgb,var(--night) 54%,transparent)}.release-notes-card li{padding-left:3px;color:var(--ink);font-size:12px;line-height:1.45}.release-notes-card li::marker{color:var(--focus)}#release-notes-close{grid-column:1/-1;justify-self:end;min-width:118px;padding:10px 15px;border:0;border-radius:10px;background:var(--focus);color:var(--focus-contrast,var(--beta-button-ink));font-weight:800}.release-notes-x{position:absolute;right:15px;top:14px;width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--muted);font-size:21px}.release-notes-x:hover{color:var(--ink);background:var(--surface-2)}.settings-autosave{display:inline-flex;align-items:center;gap:6px;color:var(--focus);font-size:10px;font-weight:800;white-space:nowrap}.settings-autosave::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--focus);box-shadow:0 0 8px var(--focus)}#settings-save{display:none!important}.release-notes-reopen{margin-top:10px!important;margin-left:7px!important;padding:8px 10px!important;border:1px solid var(--line)!important;border-radius:8px!important;background:var(--surface-2)!important;color:var(--ink)!important}@keyframes release-fade{from{opacity:0}to{opacity:1}}@keyframes release-rise{from{opacity:0;transform:translateY(9px) scale(.98)}to{opacity:1}}@media(max-width:520px){.release-notes-card{grid-template-columns:45px minmax(0,1fr);padding:18px}.release-notes-mark{width:45px;height:45px;border-radius:14px}.release-notes-copy h2{font-size:20px}.settings-autosave{font-size:9px}}
  </style>`);

  const modal = document.querySelector('#release-notes-modal');
  const settingsModal = document.querySelector('#settings-modal');
  const settingsClose = document.querySelector('#settings-close');
  const capturePicker = document.querySelector('#capture-picker');
  const captureCancel = document.querySelector('#capture-cancel');
  let autosaveTimer = 0;

  const render = () => {
    const text = copy[locale()] || copy['pt-BR'];
    document.querySelector('#release-notes-eyebrow').textContent = text.eyebrow.replace('{version}', version);
    document.querySelector('#release-notes-title').textContent = text.title;
    document.querySelector('#release-notes-subtitle').textContent = text.subtitle.replace('{version}', version);
    document.querySelector('#release-notes-list').innerHTML = text.notes.map((note) => `<li>${note}</li>`).join('');
    document.querySelector('#release-notes-close').textContent = text.close;
    document.querySelector('#release-notes-x').setAttribute('aria-label', text.close);
    const reopen = document.querySelector('#release-notes-reopen'); if (reopen) reopen.textContent = text.reopen.replace('{version}', version);
    const autosave = document.querySelector('#settings-autosave'); if (autosave) autosave.textContent = text.auto;
  };
  const show = ({ remember = true } = {}) => { modal.dataset.remember = String(remember); render(); modal.classList.remove('hidden'); requestAnimationFrame(() => document.querySelector('#release-notes-close')?.focus()); };
  const close = () => {
    if (modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    if (modal.dataset.remember !== 'false') localStorage.setItem(seenKey, version);
  };
  window.voiceupShowReleaseNotes = () => show({ remember: false });
  document.querySelector('#release-notes-close').addEventListener('click', close);
  document.querySelector('#release-notes-x').addEventListener('click', close);
  modal.addEventListener('click', (event) => { if (event.target === modal) close(); });

  const stickyActions = document.querySelector('#settings-sticky-actions');
  if (stickyActions && !document.querySelector('#settings-autosave')) {
    const status = document.createElement('span'); status.id = 'settings-autosave'; status.className = 'settings-autosave';
    stickyActions.insertBefore(status, settingsClose);
  }
  const versionCard = document.querySelector('#installed-version')?.parentElement;
  if (versionCard && !document.querySelector('#release-notes-reopen')) {
    const button = document.createElement('button'); button.id = 'release-notes-reopen'; button.className = 'release-notes-reopen'; button.type = 'button'; button.addEventListener('click', () => show({ remember: false }));
    document.querySelector('#check-update')?.insertAdjacentElement('afterend', button);
  }

  const saveNow = () => { clearTimeout(autosaveTimer); void (window.voiceupAutoSaveSettings?.() || window.voiceupCommitSettings?.({ close: false, notify: false })); };
  const scheduleSave = () => { clearTimeout(autosaveTimer); autosaveTimer = window.setTimeout(saveNow, 260); };
  settingsModal?.addEventListener('input', scheduleSave);
  settingsModal?.addEventListener('change', scheduleSave);
  settingsModal?.addEventListener('click', (event) => { if (event.target.closest('[data-theme-sample]')) scheduleSave(); });
  settingsModal?.addEventListener('click', (event) => { if (event.target.closest('[data-language]')) scheduleSave(); });
  settingsClose?.addEventListener('click', saveNow, true);
  settingsModal?.addEventListener('click', (event) => { if (event.target === settingsModal) settingsClose?.click(); });
  capturePicker?.addEventListener('click', (event) => { if (event.target === capturePicker) captureCancel?.click(); });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!document.querySelector('#voiceup-dialog')?.classList.contains('hidden')) return;
    if (!modal.classList.contains('hidden')) { close(); event.preventDefault(); return; }
    if (settingsModal && !settingsModal.classList.contains('hidden')) { settingsClose?.click(); event.preventDefault(); return; }
    if (capturePicker && !capturePicker.classList.contains('hidden')) { captureCancel?.click(); event.preventDefault(); }
  }, true);
  window.addEventListener('voiceup:languagechange', render);
  render();
  if (localStorage.getItem(seenKey) !== version) window.setTimeout(() => show({ remember: true }), 650);
})();
