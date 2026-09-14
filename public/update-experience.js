(() => {
  'use strict';
  if (!window.voiceupDesktop?.onUpdateProgress) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="client-update-progress" class="client-update-progress hidden" role="dialog" aria-modal="true" aria-labelledby="client-update-title">
      <section class="client-update-card">
        <button id="client-update-minimize" type="button" title="Minimizar" aria-label="Minimizar atualização">−</button>
        <span class="client-update-icon" aria-hidden="true">↓</span>
        <div><p class="eyebrow">ATUALIZAÇÃO SEGURA</p><h2 id="client-update-title">Preparando o VoiceUP</h2><p id="client-update-message">Aguarde um instante…</p></div>
        <div class="client-update-track"><i id="client-update-bar"></i></div>
        <small id="client-update-detail">Você pode minimizar esta janela e continuar usando o VoiceUP.</small>
        <button id="client-update-retry" class="hidden" type="button">Tentar novamente</button>
      </section>
    </div>
    <button id="client-update-chip" class="client-update-chip hidden" type="button"><span></span><b>Atualizando VoiceUP</b><em id="client-update-chip-value">0%</em></button>`);
  const $ = (id) => document.getElementById(id);
  let canMinimize = true;
  let lastPercent = 0;
  const minimize = () => {
    if (!canMinimize) return;
    $('client-update-progress').classList.add('hidden');
    $('client-update-chip').classList.remove('hidden');
  };
  const show = (progress = {}) => {
    const phase = String(progress.phase || 'checking');
    const title = { checking: 'Preparando a atualização', downloading: 'Baixando a nova versão', verifying: 'Verificando o pacote', installing: 'Instalando a atualização', error: 'Não foi possível atualizar' }[phase] || 'Atualizando VoiceUP';
    const raw = Number(progress.percent);
    const determinate = progress.percent !== null && progress.percent !== undefined && Number.isFinite(raw);
    if (determinate) lastPercent = Math.max(0, Math.min(100, raw));
    canMinimize = progress.minimizable !== false;
    $('client-update-title').textContent = title;
    $('client-update-retry').classList.toggle('hidden', phase !== 'error');
    $('client-update-message').textContent = progress.message || 'Aguarde um instante…';
    $('client-update-bar').style.width = determinate ? `${lastPercent}%` : '34%';
    $('client-update-bar').classList.toggle('indeterminate', !determinate);
    $('client-update-detail').textContent = phase === 'installing' ? 'O VoiceUP fechará apenas quando o instalador silencioso estiver pronto. Seus dados serão preservados.' : phase === 'error' ? 'Minimize esta janela e tente novamente em Configurações.' : 'Você pode minimizar esta janela e continuar usando o VoiceUP.';
    $('client-update-minimize').classList.toggle('hidden', !canMinimize);
    $('client-update-chip-value').textContent = determinate ? `${Math.round(lastPercent)}%` : '…';
    $('client-update-chip').classList.toggle('error', phase === 'error');
    $('client-update-progress').classList.remove('hidden');
    $('client-update-chip').classList.add('hidden');
  };
  window.voiceupDesktop.onUpdateProgress(show);
  $('client-update-retry').onclick = async () => {
    $('client-update-retry').disabled = true;
    try { await window.voiceupDesktop.downloadUpdate(); }
    catch { show({ phase: 'error', message: 'Não foi possível iniciar a atualização. Tente novamente.' }); }
    finally { $('client-update-retry').disabled = false; }
  };
  window.voiceupDesktop.updateRecovery?.().then((result) => {
    if (result?.pending) { show({ phase: 'error', message: result.message }); minimize(); }
  }).catch(() => {});
  $('client-update-minimize').onclick = minimize;
  $('client-update-chip').onclick = () => { $('client-update-chip').classList.add('hidden'); $('client-update-progress').classList.remove('hidden'); };
  $('client-update-progress').onclick = (event) => { if (event.target === $('client-update-progress')) minimize(); };
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('client-update-progress').classList.contains('hidden')) minimize(); });
})();
