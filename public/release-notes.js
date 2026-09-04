(() => {
  'use strict';

  const installedVersion = String(window.voiceupVersion || '1.2.0');
  const version = installedVersion;
  const seenKey = 'voiceup-release-notes-seen-v1';
  const locale = () => ['pt-BR', 'en-US', 'es-ES', 'fr-FR'].includes(document.documentElement.lang) ? document.documentElement.lang : 'pt-BR';
  const labels = {
    'pt-BR': { eyebrow: 'VERSÃO {version}', close: 'Entendi', reopen: 'Novidades da {version}', auto: 'Salvamento automático' },
    'en-US': { eyebrow: 'VERSION {version}', close: 'Got it', reopen: 'What is new in {version}', auto: 'Autosave on' },
    'es-ES': { eyebrow: 'VERSIÓN {version}', close: 'Entendido', reopen: 'Novedades de {version}', auto: 'Guardado automático' },
    'fr-FR': { eyebrow: 'VERSION {version}', close: 'Compris', reopen: 'Nouveautés de {version}', auto: 'Enregistrement auto' }
  };
  const copy = Object.fromEntries(Object.entries(labels).map(([language, text]) =>
    [language, { ...text, ...window.voiceupReleaseHistory.locales[language] }]));

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
