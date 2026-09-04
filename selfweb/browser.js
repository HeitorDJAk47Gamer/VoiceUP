/* Browser-only adaptations. Shared Desktop sources are never edited by build. */
(() => {
  'use strict';
  const caps = window.voiceupSelfWebCapabilities;
  const version = window.voiceupSelfWebBuild.version;
  const byId = (id) => document.getElementById(id);
  const local = window.voiceupSelfWebStorage.local;
  const nativeOnly = ['direct-room-create','hardware-acceleration-setting','check-update'];
  nativeOnly.forEach((id) => { if (byId(id)) byId(id).hidden=true; });
  for (const id of ['client-close-behavior','screen-source-select']) byId(id)?.closest('label')?.setAttribute('hidden','');
  document.querySelector('[data-global-shortcut]')?.closest('.shortcut-settings-card')?.setAttribute('hidden','');
  byId('noise-select')?.querySelector('option[value="rnnoise"]')?.remove();
  if (noiseMode === 'rnnoise') noiseMode = 'standard';
  const updateCopy = () => {
    document.title='VoiceUP SelfWeb';
    if (byId('installed-version')) byId('installed-version').textContent=`VoiceUP SelfWeb ${version}`;
    if (byId('update-status')) byId('update-status').textContent='Edição em arquivo local. Para atualizar, baixe um novo SelfWeb; nenhum instalador é executado.';
  };
  document.querySelector('.join-card')?.insertAdjacentHTML('afterbegin', `<div class="selfweb-heading"><span class="selfweb-edition">SelfWeb <small>${version}</small></span><button id="selfweb-settings" type="button">Configurações</button></div><p class="selfweb-description">Seu VoiceUP no navegador. Entre em um servidor ou use um convite P2P.</p><p id="selfweb-capability-note" class="selfweb-notice" role="status" hidden></p>`);
  const limitations = `<details class="selfweb-help"><summary>Sobre esta edição e privacidade</summary><div><p>Chat, canais, chamadas, câmera e lives usam o protocolo do VoiceUP. O navegador pede autorização ao usar microfone, câmera e tela.</p><p>O arquivo funciona localmente. Você só se conecta ao servidor escolhido ao entrar. Conexões P2P usam servidores STUN públicos para descobrir rotas; sem uma rota direta, a chamada pode não conectar. Este arquivo não fornece um serviço TURN.</p><p>Perfil, identidade e preferências são guardados apenas neste navegador, separados do Client. Limpar os dados do navegador ou mudar o arquivo de lugar pode apagar esse perfil. As mensagens enviadas a um servidor seguem as regras de armazenamento daquele host.</p><p>Mídia externa só é carregada após seu consentimento, salvo se você ativar o carregamento automático. Relatórios são enviados ao servidor informado somente ao clicar em enviar.</p><p>Sem atalhos globais, bandeja do sistema, hospedagem local de salas, UPnP ou captura nativa por processo. A redução de ruído usa os recursos do navegador. Push-to-talk funciona com esta aba em foco.</p><p>Ao compartilhar áudio, prefira uma aba do navegador. A captura de tela inteira pode incluir sons da call: esta edição não consegue excluir o VoiceUP do áudio do sistema. Seu microfone continua em uma faixa separada.</p><p>Chrome ou Edge atualizados no computador são o alvo inicial. Outros navegadores e celulares podem limitar captura de tela, saída de áudio e funcionamento em segundo plano. Fechar a aba encerra a conexão.</p></div></details>`;
  document.querySelector('.join-card')?.insertAdjacentHTML('beforeend',limitations);
  document.querySelector('[data-settings-panel="general"]')?.insertAdjacentHTML('beforeend',limitations);
  const releaseDetails = document.createElement('details'); releaseDetails.className = 'selfweb-help';
  const releaseSummary = document.createElement('summary'); releaseSummary.textContent = 'Novidades da 1.2.0';
  const releaseBody = document.createElement('div');
  const releaseSubtitle = document.createElement('p'); releaseSubtitle.textContent = window.voiceupReleaseHistory.locales['pt-BR'].subtitle;
  const releaseList = document.createElement('ul');
  for (const note of window.voiceupReleaseHistory.locales['pt-BR'].notes) { const item = document.createElement('li'); item.textContent = note; releaseList.append(item); }
  releaseBody.append(releaseSubtitle, releaseList); releaseDetails.append(releaseSummary, releaseBody);
  byId('installed-version')?.parentElement?.append(releaseDetails);
  byId('selfweb-settings')?.addEventListener('click',()=>byId('settings-button')?.click());
  byId('copy-button')?.addEventListener('click',async(event)=>{
    event.preventDefault();event.stopImmediatePropagation();
    const input=byId('pair-code');
    try {await navigator.clipboard.writeText(input.value);toast('Código copiado. Envie para a outra pessoa.');}
    catch {
      input.focus();input.select();
      let copied=false;try{copied=document.execCommand('copy');}catch{/* Clipboard may be blocked for a local file. */}
      toast(copied?'Código copiado. Envie para a outra pessoa.':'Código selecionado. Use Ctrl+C (ou Copiar) para enviá-lo.');
    }
  },true);
  byId('settings-button')?.addEventListener('click',()=> { updateCopy(); setTimeout(updateCopy,0); });
  window.addEventListener('voiceup:languagechange',updateCopy);
  const notices=[];
  if (!caps.rtc || !caps.identity) notices.push('Este navegador não oferece os recursos de conexão necessários. Abra o arquivo no Chrome ou Edge atualizado.');
  if (!caps.microphone) notices.push('Microfone e câmera indisponíveis neste contexto. Abra o arquivo diretamente em um navegador de computador atualizado, não na prévia de um mensageiro.');
  if (!local.persistent) notices.push('O navegador bloqueou o armazenamento. O perfil funciona só nesta sessão; seus dados não serão salvos.');
  if (notices.length) { const note=byId('selfweb-capability-note'); note.textContent=notices.join(' '); note.hidden=false; }
  if (!caps.rtc || !caps.identity) ['join-host','accept-offer','complete-pair'].forEach((id)=> { if(byId(id)) byId(id).disabled=true; });
  if (!caps.screen) { byId('screen-button').disabled=true; byId('screen-button').title='Compartilhar tela não é suportado neste navegador.'; }
  if (!caps.microphone) for(const id of ['cam-button','mic-button']) { byId(id).disabled=true; byId(id).title='Dispositivos de mídia indisponíveis neste navegador.'; }
  if (!caps.outputDevice) { byId('audio-output-select').disabled=true; byId('audio-output-select').title='Use a saída de áudio definida no sistema.'; }
  const audioOption=byId('screen-audio-toggle')?.closest('label');
  if (audioOption) {
    const text=[...audioOption.childNodes].find((node)=>node.nodeType===Node.TEXT_NODE && node.textContent.trim());
    if(text) text.textContent=' Pedir áudio da aba/tela ao navegador';
    audioOption.insertAdjacentHTML('afterend','<p class="selfweb-notice">O áudio disponível depende do navegador. Uma aba costuma isolar melhor o som; a tela inteira pode capturar também vozes da call. O microfone não é misturado à live.</p>');
  }
  // Keep the user's existing stream when the browser picker is cancelled.
  // Request capture immediately from the click, before any awaited cleanup,
  // so getDisplayMedia retains its required transient user activation.
  shareScreen = async function shareScreenSelfWeb() {
    if (!caps.screen) return toast('Compartilhar tela não é suportado neste navegador.');
    if (currentMode==='hosted' && !activeVoiceChannel) return toast('Entre em um canal de voz antes de transmitir.');
    let fresh;
    try {
      fresh = await navigator.mediaDevices.getDisplayMedia({video:true,audio:shareSystemAudio,preferCurrentTab:false,selfBrowserSurface:'exclude',systemAudio:'include'});
      if (currentMode==='hosted' && !activeVoiceChannel) { fresh.getTracks().forEach((track)=>track.stop()); return; }
      const previous=screenStream;
      await stopSharedSystemAudio();
      screenStream=fresh;
      selectedScreenSource='';
      previous?.getTracks().forEach((track)=>{track.onended=null;track.stop();});
      const track=fresh.getVideoTracks()[0];
      track.onended=()=>void stopScreenShare();
      applyVideoContentHint(track,'screen');
      if (!preserveScreenSourceQuality) { try { await track.applyConstraints(quality()); } catch { /* Source/browser decides its supported capture size. */ } }
      refreshLocalVideoPreview();
      await publishVideo(track,'screen');
      if(shareSystemAudio) await startSharedSystemAudio();
      refreshVideoButtons();
      saveProfile();
    } catch(error) {
      if(fresh) { fresh.getTracks().forEach((track)=>track.stop()); if(screenStream===fresh) { screenStream=null; refreshLocalVideoPreview(); refreshVideoButtons(); } }
      if(error.name!=='NotAllowedError') toast(error.message || 'Não foi possível compartilhar a tela.');
    }
  };
  // Fullscreen must include the sibling exit toolbar, not only the video frame.
  // The normal media layer still owns focus/layout and the Escape behavior.
  const frame=byId('video-frame');
  if(frame && document.documentElement.requestFullscreen) frame.requestFullscreen=(options)=>document.documentElement.requestFullscreen(options);
  const audioContexts=()=>[voiceContext,betaMicGainContext,sharedAudioContext,notificationContext,manualAudioGainContext,manualScreenAudioGainContext,...[...hostedPeers.values()].flatMap((p)=>[p.audioGainContext,p.screenAudioGainContext])].filter(Boolean);
  const resumeAudio=()=>audioContexts().forEach((context)=>{if(context.state==='suspended') void context.resume().catch(()=>{});});
  document.addEventListener('pointerdown',resumeAudio,{passive:true});
  document.addEventListener('keydown',resumeAudio);
  window.addEventListener('pagehide',()=>{
    hostedSocket?.disconnect(); peer?.pc?.close(); hostedPeers.forEach((p)=>p.pc?.close());
    [localStream,cameraStream,screenStream].forEach((stream)=>stream?.getTracks().forEach((track)=>track.stop()));
    sharedAudioTrack?.stop();
  });
  window.addEventListener('pageshow',(event)=>{if(event.persisted) location.reload();});
  window.addEventListener('beforeunload',(event)=>{
    if(!(currentMode==='hosted' && hostedSocket?.connected && activeVoiceChannel) && peer?.pc?.connectionState!=='connected') return;
    event.preventDefault(); event.returnValue='';
  });
  updateCopy();
  document.addEventListener('DOMContentLoaded',updateCopy,{once:true});
})();
