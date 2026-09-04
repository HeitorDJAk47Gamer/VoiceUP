window.voiceupVersion = new URLSearchParams(location.search).get('version') || '1.2.0';
window.voiceupDiagnostics = [];
window.voiceupAddDiagnostic = (kind, value, source = '') => {
  const clean = String(value || 'Erro sem detalhes')
    .replace(/https?:\/\/[^\s)]+/gi, '[endereço removido]')
    .replace(/[A-Za-z]:\\[^\s)]+/g, '[caminho removido]')
    .slice(0, 360);
  const file = String(source || '').split(/[\\/]/).pop().slice(0, 80);
  window.voiceupDiagnostics.push(`${new Date().toISOString()} · ${String(kind || 'erro').slice(0, 24)} · ${clean}${file ? ` · ${file}` : ''}`);
  if (window.voiceupDiagnostics.length > 25) window.voiceupDiagnostics.splice(0, window.voiceupDiagnostics.length - 25);
};
window.addEventListener('error', (event) => window.voiceupAddDiagnostic('erro da interface', event.message, event.filename));
window.addEventListener('unhandledrejection', (event) => window.voiceupAddDiagnostic('falha assíncrona', event.reason?.message || event.reason));
document.querySelectorAll('.brand-mark').forEach((mark) => {
  mark.style.backgroundImage = "url('../assets/voiceup-logo.png')";
  mark.style.backgroundSize = 'cover'; mark.style.backgroundPosition = 'center'; mark.style.color = 'transparent';
});
if (!document.querySelector('#host-connect')) document.querySelector('.receive-invite')?.insertAdjacentHTML('afterend', '<div id="host-connect" style="border-top:1px solid #35405a;margin-top:23px;padding-top:19px;display:grid;gap:10px"><label style="display:grid;gap:7px;font-size:12px;font-weight:600;color:#c4cbdb">Servidor host<input id="host-url" placeholder="https://voiceup.shardweb.app" autocomplete="url"/></label><label style="display:grid;gap:7px;font-size:12px;font-weight:600;color:#c4cbdb">Codigo da sala<input id="host-room" maxlength="48" placeholder="ex.: amigos" autocomplete="off"/></label><button id="join-host" type="button" style="background:#6676ea;color:#fff">Entrar na sala</button><small style="color:#8995ab;line-height:1.4">Os canais aparecem depois de entrar. Clique em um canal de voz para participar, como no Discord.</small></div>');
if (!document.querySelector('#host-room-password')) document.querySelector('#host-room')?.closest('label')?.insertAdjacentHTML('afterend', '<label class="host-password-field">Senha da sala <input id="host-room-password" type="password" maxlength="128" placeholder="Somente se a sala for privada" autocomplete="current-password"><small>A senha não fica salva neste computador nem entra no convite.</small></label>');
if (!document.querySelector('#direct-room-create')) (document.querySelector('#p2p-connect') || document.querySelector('#host-connect'))?.insertAdjacentHTML('afterend', '<section id="direct-room-create"><header><span><b>Sala direta por link/IP</b><small>O próprio VoiceUP coordena esta sala, sem ServerHost separado.</small></span></header><div class="direct-room-fields"><label>Nome da sala<input id="direct-room-name" maxlength="42" placeholder="Sala direta"></label><label>Senha opcional<input id="direct-room-password" type="password" maxlength="128" placeholder="Sala pública"></label></div><label class="direct-public-access"><input id="direct-public-access" type="checkbox"><span><b>Permitir acesso pela internet</b><small>Desativado por padrão. Se você ativar, o VoiceUP pedirá confirmação antes de usar UPnP ou NAT-PMP.</small></span></label><div class="direct-room-actions"><button id="start-direct-room" type="button">Criar sala e gerar convite</button><button id="stop-direct-room" type="button" class="hidden">Encerrar</button></div><div id="direct-room-result" class="hidden"><textarea id="direct-room-code" readonly rows="3"></textarea><button id="copy-direct-room" type="button">Copiar convite</button><small id="direct-room-diagnostic"></small></div></section>');
if (!document.querySelector('#room-channels')) document.querySelector('.room-name').insertAdjacentHTML('afterend', '<div id="room-channels" class="room-channels hidden"></div>');
if (!document.querySelector('#profile-photo')) document.querySelector('#join-form')?.insertAdjacentHTML('beforeend', '<label style="display:grid;gap:7px;font-size:12px;font-weight:600;color:#c4cbdb">Foto de perfil<input id="profile-photo" type="file" accept="image/png,image/jpeg,image/webp" style="padding:9px"/><small style="color:#8995ab;font-weight:400">Salva neste computador e aparece para participantes da chamada.</small></label>');
if (!document.querySelector('#settings-button')) (document.querySelector('.sidebar-actions') || document.querySelector('.self-card')).insertAdjacentHTML('afterbegin', '<button id="settings-button" class="icon-button" title="Configurações" aria-label="Configurações"></button>');
document.body.insertAdjacentHTML('beforeend', '<div id="settings-modal" class="hidden" style="position:fixed;inset:0;background:rgba(4,8,17,.72);z-index:30;display:grid;place-items:center;padding:20px"><section style="width:min(520px,94vw);max-height:88vh;overflow:auto;background:#182136;border:1px solid #43516c;border-radius:18px;padding:24px;color:#e8edf8"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px"><h2 style="margin:0;font:700 24px Outfit,sans-serif">Configuracoes</h2><button id="settings-close" style="background:transparent;color:#d8e2f2;font-size:22px">×</button></div><div style="border:1px solid #39445c;border-radius:10px;padding:12px;margin-bottom:14px"><strong>Versao instalada</strong><div id="installed-version" style="color:#aeb9cc;margin-top:4px">VoiceUP Cliente</div><button id="check-update" style="margin-top:10px;padding:8px 10px;border-radius:8px;background:#6676ea;color:white">Procurar atualizacoes</button><small id="update-status" style="display:block;color:#aeb9cc;margin-top:8px">GitHub ainda nao configurado.</small></div><label style="display:grid;gap:6px;margin:12px 0">Tema<select id="theme-select"><option value="aurora">Aurora escuro</option><option value="midnight">Meia-noite escuro</option><option value="snow">Neve claro</option><option value="lilac">Lilás claro</option></select></label><label style="display:grid;gap:6px;margin:12px 0">Supressao de ruido<select id="noise-select"><option value="standard">Padrao</option><option value="strong">Reducao forte</option><option value="off">Desativada</option></select><small style="color:#aeb9cc">Aplicada na proxima entrada da chamada; depende do suporte do microfone/navegador.</small></label><div style="border-top:1px solid #39445c;margin-top:17px;padding-top:14px"><strong>Canais da sala</strong><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px"><label style="display:grid;gap:6px">Voz<input id="settings-voice-channel" maxlength="24"/></label><label style="display:grid;gap:6px">Texto<input id="settings-text-channel" maxlength="24"/></label></div></div><button id="settings-save" style="margin-top:20px;width:100%;padding:11px;border-radius:9px;background:#56e2cf;color:#102026;font-weight:700">Salvar configuracoes</button></section></div>');
document.querySelector('#settings-save').insertAdjacentHTML('beforebegin', '<div id="device-settings" style="border-top:1px solid #39445c;margin-top:17px;padding-top:14px"><strong>Dispositivos</strong><div style="display:grid;gap:10px;margin-top:10px"><label style="display:grid;gap:6px">Entrada de áudio<select id="audio-input-select"><option value="">Padrão do sistema</option></select></label><label style="display:grid;gap:6px">Saída de áudio<select id="audio-output-select"><option value="">Padrão do sistema</option></select><small style="color:#aeb9cc;font-weight:400">Afeta o áudio dos outros participantes.</small></label><label style="display:grid;gap:6px">Câmera<select id="camera-input-select"><option value="">Padrão do sistema</option></select></label><label style="display:grid;gap:6px">Tela ou janela<select id="screen-source-select"><option value="">Escolher ao iniciar transmissão</option></select></label><label style="display:flex;align-items:center;gap:8px;font-weight:600"><input id="screen-audio-toggle" type="checkbox"/> Compartilhar áudio do sistema</label><button id="refresh-devices" type="button" style="justify-self:start;padding:7px 10px;border-radius:8px;background:#29354b;color:#dfe8f6">Atualizar dispositivos e telas</button><small id="device-note" style="color:#aeb9cc;font-weight:400">No aplicativo para computador, escolha monitor ou janela antes de iniciar a live.</small></div></div>');
document.head.insertAdjacentHTML('beforeend', '<style>body.theme-midnight{--night:#080b14;--night2:#111522;--line:#273148;--cyan:#6d83ff;--coral:#f3789e}body.theme-snow{--ink:#182237;--muted:#59677f;--night:#eef3fb;--night2:#f7f9fe;--line:#ccd7e7;--cyan:#147b77;--coral:#d45468}body.theme-lilac{--ink:#271f3b;--muted:#665d7b;--night:#f4effc;--night2:#fbf9ff;--line:#d9cdec;--cyan:#277d7b;--coral:#c35f82}body.theme-snow .sidebar,body.theme-lilac .sidebar{background:#e3ebf7}body.theme-snow .chat,body.theme-lilac .chat{background:#edf2fa}body.theme-snow .content,body.theme-lilac .content{background:radial-gradient(circle at 55% 34%,#e8f0fb 0,#f7f9fe 60%,#eef3fb 100%)}#settings-modal label{font-size:13px;font-weight:600}#settings-modal input,#settings-modal select{background:#101625;color:#e8edf8;border:1px solid #46536d;border-radius:8px;padding:9px;font:inherit}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.room-channels{margin:15px 0 2px}.room-channels h3{font-size:10px;letter-spacing:1.3px;color:#69758c;margin:16px 7px 7px}.room-channel{width:100%;text-align:left;padding:8px 9px;border-radius:7px;background:transparent;color:#aeb9cc;font-size:13px}.room-channel:hover,.room-channel.active{background:#253149;color:#f2f6ff}.room-channel.active{color:var(--cyan);font-weight:700}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>body.theme-midnight{--night:#090b18;--night2:#12172b;--line:#303a61;--cyan:#8c8cff;--coral:#f17bb7}body.theme-ember{--night:#1a1110;--night2:#291916;--line:#57372c;--cyan:#ffc15a;--coral:#ff7564}body.theme-forest{--night:#0b1916;--night2:#102821;--line:#285044;--cyan:#68e1ad;--coral:#d6be74}body.theme-snow{--ink:#1d2b40;--muted:#627086;--night:#eff5fb;--night2:#fbfdff;--line:#c9d8e8;--cyan:#168c98;--coral:#e26b7f}body.theme-lilac{--ink:#2b2240;--muted:#716681;--night:#f5f0ff;--night2:#fdfaff;--line:#ded0ef;--cyan:#7656bc;--coral:#d86a98}body.theme-midnight .sidebar{background:#0d1020}.theme-midnight .content{background:radial-gradient(circle at 55% 30%,#262453 0,#12172b 43%,#090b18 100%)}body.theme-midnight .chat{background:#0c1020}.theme-midnight .room-name,.theme-midnight .room-channel:hover,.theme-midnight .room-channel.active{background:#1b2140}.theme-ember .sidebar{background:#1b100e}.theme-ember .content{background:radial-gradient(circle at 55% 30%,#513027 0,#291916 43%,#160d0c 100%)}body.theme-ember .chat{background:#180e0d}.theme-ember .room-name,.theme-ember .room-channel:hover,.theme-ember .room-channel.active{background:#362019}.theme-forest .sidebar{background:#0a1713}.theme-forest .content{background:radial-gradient(circle at 55% 30%,#174638 0,#102821 43%,#08130f 100%)}body.theme-forest .chat{background:#091611}.theme-forest .room-name,.theme-forest .room-channel:hover,.theme-forest .room-channel.active{background:#17362d}.theme-snow .sidebar{background:#e2edf8}.theme-snow .chat{background:#e8f1f9}.theme-snow .content{background:radial-gradient(circle at 55% 30%,#d4eff3 0,#f9fcff 55%,#e8f0f8 100%)}.theme-snow .room-name,.theme-snow .room-channel:hover,.theme-snow .room-channel.active{background:#d5e5f3}.theme-lilac .sidebar{background:#ece4f8}.theme-lilac .chat{background:#f1ebf9}.theme-lilac .content{background:radial-gradient(circle at 55% 30%,#ead9f7 0,#fdfaff 56%,#eee7f8 100%)}.theme-lilac .room-name,.theme-lilac .room-channel:hover,.theme-lilac .room-channel.active{background:#e1d4f0}.theme-snow .room-channel,.theme-lilac .room-channel{color:var(--muted)}.theme-snow .room-channel.active,.theme-lilac .room-channel.active{color:var(--cyan)}.theme-snow #settings-modal section,.theme-lilac #settings-modal section{background:#fff;color:var(--ink)}.theme-snow #settings-modal input,.theme-snow #settings-modal select,.theme-lilac #settings-modal input,.theme-lilac #settings-modal select{background:#fff;color:var(--ink);border-color:var(--line)}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>.room-channel{display:flex;align-items:center;justify-content:space-between;gap:7px}.channel-avatars{display:flex;align-items:center;justify-content:flex-end}.channel-avatar{width:20px;height:20px;border-radius:50%;border:2px solid #182136;margin-left:-5px;display:grid;place-items:center;color:#fff;font-size:7px;font-weight:800}.channel-avatars i{font-style:normal;font-size:10px;color:#c6d0e1;margin-left:4px}.unread-dot{width:8px;height:8px;border-radius:50%;background:#ff8b72;box-shadow:0 0 8px rgba(255,139,114,.75);flex:none}.round-control svg,.participant-mute svg,.hosted-mute svg{width:19px;height:19px;display:block;margin:auto;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>#video-gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;width:100%;height:100%;padding:7px}.video-tile{position:relative;min-width:0;min-height:0;overflow:hidden;border:1px solid #34415b;border-radius:12px;background:#070b13}.video-tile:only-child{grid-column:1/-1}.video-tile video{width:100%;height:100%;object-fit:contain;background:#070b13}.video-tile-label{position:absolute;left:8px;bottom:7px;border-radius:6px;padding:4px 7px;background:rgba(7,11,19,.8);font-size:11px;color:#eaf2ff}.video-tile.hidden{display:none}.video-frame:has(.video-tile:nth-child(3)){aspect-ratio:16/10}.video-frame .video-label{display:none}body.video-theater .sidebar,body.video-theater .content>header,body.video-theater .chat,body.video-theater .media-settings,body.video-theater .controls{display:none!important}body.video-theater .app,body.video-theater .content,body.video-theater .stage{display:block;height:100vh;min-height:100vh;padding:0;background:#05070d}body.video-theater #video-frame{position:fixed;inset:0;z-index:90;width:100vw;height:100vh;max-width:none;aspect-ratio:auto;margin:0;border:0;border-radius:0}body.video-theater #fullscreen-button{z-index:3;background:#273650}@media(max-width:760px){#video-gallery{grid-template-columns:1fr}.video-frame:has(.video-tile:nth-child(3)){aspect-ratio:16/11}}</style>');

document.querySelector('#device-settings').insertAdjacentHTML('beforebegin', '<div id="client-preferences" style="border-top:1px solid #39445c;margin-top:17px;padding-top:14px"><strong>Preferências</strong><div style="display:grid;gap:10px;margin-top:10px"><label style="display:grid;gap:6px">Idioma<select id="language-select"><option value="pt-BR">Português (Brasil)</option><option value="en-US">English</option><option value="es-ES">Español</option><option value="fr-FR">Français</option></select></label><label style="display:flex;align-items:center;gap:8px;font-weight:600"><input id="carry-media-toggle" type="checkbox"/> Manter câmera/live ao trocar de canal de voz</label><label style="display:grid;gap:6px">Ao fechar o aplicativo<select id="client-close-behavior"><option value="tray">Manter aberto na bandeja do sistema</option><option value="ask">Perguntar o que fazer</option><option value="quit">Encerrar o aplicativo</option></select></label><small style="color:#aeb9cc;font-weight:400">Idioma e preferências afetam apenas este computador.</small></div></div>');
document.querySelector('#carry-media-toggle')?.closest('label')?.insertAdjacentHTML('afterend', '<label style="display:flex;align-items:flex-start;gap:8px;font-weight:600"><input id="external-media-toggle" type="checkbox"/><span>Carregar mídia externa automaticamente<small style="display:block;color:#aeb9cc;font-weight:400;margin-top:3px">Desativado por padrão. Imagens, prévias e vídeos externos podem informar seu IP ao provedor.</small></span></label>');
document.querySelector('#external-media-toggle')?.closest('label')?.insertAdjacentHTML('afterend', '<div id="hardware-acceleration-setting"><label><input id="hardware-acceleration-toggle" type="checkbox" checked/><span><b id="hardware-acceleration-title">Usar aceleração de hardware</b><small id="hardware-acceleration-note">Melhora vídeos e animações. Desative apenas se houver tela preta, cintilação ou travamentos de GPU. A alteração exige reiniciar.</small></span></label><label id="fullscreen-game-capture-setting"><input id="fullscreen-game-capture-toggle" type="checkbox" checked/><span><b id="fullscreen-game-capture-title">Compatibilidade com jogos em tela cheia</b><small id="fullscreen-game-capture-note">Usa o capturador alternativo do Windows para manter o cursor local visível. O cursor continua aparecendo normalmente na live. A alteração exige reiniciar.</small></span></label><div id="hardware-acceleration-restart" class="hidden" role="status"><small id="hardware-acceleration-restart-message">As alterações gráficas e de captura serão aplicadas após reiniciar o VoiceUP.</small><button id="hardware-acceleration-restart-button" type="button">Reiniciar agora</button></div></div>');
document.body.insertAdjacentHTML('beforeend', '<div id="capture-picker" class="hidden" style="position:fixed;inset:0;z-index:50;background:rgba(4,8,17,.76);padding:22px;overflow:auto"><section style="width:min(940px,96vw);margin:4vh auto;background:#182136;border:1px solid #43516c;border-radius:18px;padding:22px;color:#e8edf8"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><h2 style="margin:0;font:700 23px Outfit,sans-serif">Compartilhar tela</h2><p style="color:#aeb9cc;margin:5px 0 0;font-size:13px">Escolha uma tela inteira ou janela antes de iniciar a live.</p></div><button id="capture-cancel" style="background:transparent;color:#e8edf8;font-size:24px">×</button></div><div id="capture-source-list" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:18px 0"></div><label style="display:flex;gap:8px;align-items:center;color:#cbd6e8;font-size:13px"><input id="capture-audio-toggle" type="checkbox"/> Compartilhar áudio do sistema quando disponível</label><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button id="capture-start" style="padding:10px 14px;border-radius:9px;background:#56e2cf;color:#102026;font-weight:700">Iniciar transmissão</button></div></section></div>');
document.querySelector('#capture-audio-toggle').closest('label').outerHTML = '<div class="capture-options"><label><input id="capture-audio-toggle" type="checkbox"/><span><b id="capture-audio-title">Áudio da fonte selecionada</b><small id="capture-audio-description">O microfone permanece separado da transmissão.</small></span></label><label><input id="capture-source-quality-toggle" type="checkbox"/><span><b>Usar qualidade original da fonte</b><small>Ignora a resolução e o FPS escolhidos no painel da chamada.</small></span></label></div>';
document.head.insertAdjacentHTML('beforeend', '<style>.capture-source{min-height:168px!important;padding:0!important;grid-template-rows:116px auto!important;overflow:hidden}.capture-source-preview{display:block;width:100%;height:116px;object-fit:cover;background:#070b13}.capture-source-copy{padding:9px 11px;display:grid;gap:4px;text-align:left}.capture-source-copy span,.capture-source-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style>');
document.head.insertAdjacentHTML('beforeend', '<style>#video-gallery.gallery-1{grid-template-columns:1fr}#video-gallery.gallery-1 .video-tile{grid-column:1/-1}#video-gallery.gallery-3,#video-gallery.gallery-4{grid-template-columns:repeat(2,minmax(0,1fr))}#video-gallery.gallery-5,#video-gallery.gallery-6{grid-template-columns:repeat(3,minmax(0,1fr))}.video-frame:has(#video-gallery.gallery-3),.video-frame:has(#video-gallery.gallery-4),.video-frame:has(#video-gallery.gallery-5),.video-frame:has(#video-gallery.gallery-6){aspect-ratio:16/10}.capture-source{min-height:78px;text-align:left;border:1px solid #42516c;border-radius:11px;background:#101625;color:#dae5f8;padding:11px;display:grid;gap:5px}.capture-source.selected{border-color:#56e2cf;box-shadow:0 0 0 2px rgba(86,226,207,.18);color:#56e2cf}.capture-source small{color:#9caac0}.theme-ocean{--night:#081824;--night2:#0d2635;--line:#24475d;--cyan:#63d5ed;--coral:#f29770}.theme-ocean .sidebar{background:#091a27}.theme-ocean .chat{background:#081721}.theme-ocean .content{background:radial-gradient(circle at 55% 30%,#17516d 0,#0d2635 43%,#081824 100%)}.theme-grape{--night:#171025;--night2:#24183a;--line:#513a70;--cyan:#c2a0ff;--coral:#f184bd}.theme-grape .sidebar{background:#191025}.theme-grape .chat{background:#160e22}.theme-grape .content{background:radial-gradient(circle at 55% 30%,#4a2d68 0,#24183a 43%,#171025 100%)}.theme-sage{--ink:#26352f;--muted:#65766e;--night:#eff6ef;--night2:#fbfdf9;--line:#c8d8cc;--cyan:#287c62;--coral:#d87563}.theme-sage .sidebar{background:#e2eee4}.theme-sage .chat{background:#e9f2eb}.theme-sage .content{background:radial-gradient(circle at 55% 30%,#d6ecd9 0,#fbfdf9 56%,#eaf3eb 100%)}.theme-peach{--ink:#442d32;--muted:#806970;--night:#fff2ee;--night2:#fffaf8;--line:#ecd1ca;--cyan:#ad5a71;--coral:#d97953}.theme-peach .sidebar{background:#f6e4dd}.theme-peach .chat{background:#faece7}.theme-peach .content{background:radial-gradient(circle at 55% 30%,#f9ded2 0,#fffaf8 56%,#faede8 100%)}.theme-mist{--ink:#273448;--muted:#667589;--night:#eef2f7;--night2:#fafcff;--line:#cad5e3;--cyan:#4976a8;--coral:#bd7187}.theme-mist .sidebar{background:#e0e8f1}.theme-mist .chat{background:#e8edf4}.theme-mist .content{background:radial-gradient(circle at 55% 30%,#dce7f3 0,#fafcff 56%,#edf2f8 100%)}.theme-sage .room-name,.theme-sage .room-channel:hover,.theme-sage .room-channel.active,.theme-peach .room-name,.theme-peach .room-channel:hover,.theme-peach .room-channel.active,.theme-mist .room-name,.theme-mist .room-channel:hover,.theme-mist .room-channel.active{background:rgba(119,151,139,.16)}.theme-sage #settings-modal section,.theme-peach #settings-modal section,.theme-mist #settings-modal section{background:#fff;color:var(--ink)}.theme-sage #settings-modal input,.theme-sage #settings-modal select,.theme-peach #settings-modal input,.theme-peach #settings-modal select,.theme-mist #settings-modal input,.theme-mist #settings-modal select{background:#fff;color:var(--ink);border-color:var(--line)}</style>');
const AVATAR_COLORS = ['#56e2cf', '#ff8b72', '#6676ea', '#a879ff', '#e8b65a', '#47a7f5', '#ec6fa8'];
const DEFAULT_HOST_URL = 'https://voiceup.shardweb.app';
const DEFAULT_ROOM_CHANNELS = Object.freeze({ voice: ['Geral', 'Jogando', 'Ausente'], text: ['geral', 'conversa', 'avisos'] });
const ROOM_CHANNELS = { voice: [...DEFAULT_ROOM_CHANNELS.voice], text: [...DEFAULT_ROOM_CHANNELS.text] };
const ROOM_CHANNEL_LAYOUT = { voice: [], text: [], categories: [], limits: { humansPerCall: 12, membersPerCall: 15 }, private: false };
const HOSTED_LOBBY_CHANNEL = '__lobby__';
const storedProfile = (() => { try { return JSON.parse(localStorage.getItem('voiceup-profile-v1') || '{}'); } catch { return {}; } })();
let myColor = AVATAR_COLORS.includes(storedProfile.color) ? storedProfile.color : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
let localStream, cameraStream, screenStream, peer, myName = storedProfile.name || '', myAvatar = storedProfile.avatar || '', micEnabled = true, remoteAudio = null, remoteMuted = false, hostedSocket = null, hostedJoinAttempt = 0, currentMode = 'manual', voiceContext = null, voiceAnalyser = null, voiceData = null, voiceLoopRunning = false, voiceDetectionSession = 0, localSpeaking = false, latencyTimer = null, notificationsEnabled = storedProfile.notifications !== false, notificationContext = null, activeRemoteId = null, theme = storedProfile.theme || 'aurora', noiseMode = storedProfile.noiseMode || 'standard', audioInputId = storedProfile.audioInputId || '', audioOutputId = storedProfile.audioOutputId || '', cameraInputId = storedProfile.cameraInputId || '', selectedScreenSource = storedProfile.screenSource || '', shareSystemAudio = Boolean(storedProfile.shareSystemAudio), preserveScreenSourceQuality = storedProfile.preserveScreenSourceQuality === true, sharedAudioContext = null, sharedAudioTrack = null, cameraCapturePromise = null, activeVoiceChannel = ROOM_CHANNELS.voice.includes(storedProfile.voiceChannel) ? storedProfile.voiceChannel : 'Geral', activeTextChannel = ROOM_CHANNELS.text.includes(storedProfile.textChannel) ? storedProfile.textChannel : 'geral';
let micThresholdDb = Math.max(-70, Math.min(-10, Number(storedProfile.micThresholdDb ?? -45)));
let micMonitorEnabled = storedProfile.micMonitorEnabled === true;
let clientId = storedProfile.clientId || (globalThis.crypto?.randomUUID?.() || `vu${Date.now()}${Math.random().toString(36).slice(2)}`);
const IDENTITY_KEY_STORAGE = 'voiceup-identity-key-v1';
let identityKeyPromise = null;
const bytesToBase64Url = (value) => {
  let binary = ''; const bytes = new Uint8Array(value);
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
async function clientIdentityKey() {
  if (identityKeyPromise) return identityKeyPromise;
  identityKeyPromise = (async () => {
    try {
      const stored = JSON.parse(localStorage.getItem(IDENTITY_KEY_STORAGE) || '{}');
      if (stored.privateKey?.kty === 'EC' && stored.publicKey?.kty === 'EC') {
        const privateKey = await crypto.subtle.importKey('jwk', stored.privateKey, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
        return { privateKey, publicKey: stored.publicKey };
      }
    } catch { /* cria uma identidade protegida nova */ }
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
    localStorage.setItem(IDENTITY_KEY_STORAGE, JSON.stringify({ version: 1, privateKey, publicKey }));
    return { privateKey: pair.privateKey, publicKey };
  })();
  return identityKeyPromise;
}
async function signIdentityChallenge(challenge, socketId, roomId) {
  const identity = await clientIdentityKey();
  const payload = new TextEncoder().encode(`voiceup-identity-v1\n${challenge}\n${socketId}\n${roomId}\n${clientId}`);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, payload);
  return { identityChallenge: challenge, identityPublicKey: identity.publicKey, identityProof: bytesToBase64Url(signature) };
}
let carryMediaOnChannelChange = storedProfile.carryMediaOnChannelChange !== false;
let externalMediaAutoLoad = storedProfile.externalMediaAutoLoad === true;
let language = ['pt-BR', 'en-US', 'es-ES', 'fr-FR'].includes(storedProfile.language) ? storedProfile.language : 'pt-BR';
let clientCloseBehavior = ['tray', 'ask', 'quit'].includes(storedProfile.clientCloseBehavior) ? storedProfile.clientCloseBehavior : 'tray';
let hardwareAccelerationEnabled = true;
let hardwareAccelerationAtStartup = true;
let fullscreenGameCaptureCompatibilityEnabled = true;
let fullscreenGameCaptureCompatibilityAtStartup = false;
let fullscreenGameCaptureCompatibilitySupported = false;
let presenceStatus = ['online', 'idle', 'dnd'].includes(storedProfile.presenceStatus) ? storedProfile.presenceStatus : 'online';
let effectivePresenceStatus = presenceStatus;
let presenceAutoIdle = false;
let lastPresenceActivityAt = Date.now();
let activeHostedRoomName = '';
const hostedPeers = new Map();
const serverMembers = new Map();
const voiceChannelActivityClock = globalThis.voiceupChannelRoster.createActivityClock();
const channelMessages = new Map(ROOM_CHANNELS.text.map((channel) => [channel, []]));
function applyHostedRoomLayout(layout = {}, { reset = false } = {}) {
  const clean = (values, fallback) => {
    const source = Array.isArray(values) ? values : fallback;
    const items = [...new Set(source.map((value) => String(value || '').trim().slice(0, 24)).filter(Boolean))].slice(0, 24);
    return items.length ? items : [...fallback];
  };
  const voice = clean(reset ? DEFAULT_ROOM_CHANNELS.voice : layout.voiceChannels, DEFAULT_ROOM_CHANNELS.voice);
  const text = clean(reset ? DEFAULT_ROOM_CHANNELS.text : layout.textChannels, DEFAULT_ROOM_CHANNELS.text);
  const previousVoice = activeVoiceChannel;
  activeHostedRoomName = reset ? '' : String(layout.name || '').trim().slice(0, 48);
  ROOM_CHANNELS.voice.splice(0, ROOM_CHANNELS.voice.length, ...voice);
  ROOM_CHANNELS.text.splice(0, ROOM_CHANNELS.text.length, ...text);
  ROOM_CHANNEL_LAYOUT.voice = reset ? [] : (Array.isArray(layout.voiceChannelSettings) ? layout.voiceChannelSettings : []).map((channel) => ({ name: String(channel.name || ''), category: String(channel.category || ''), userLimit: Number(channel.userLimit || 0), humans: Number(channel.humans || 0), total: Number(channel.total || 0) }));
  ROOM_CHANNEL_LAYOUT.text = reset ? [] : (Array.isArray(layout.textChannelSettings) ? layout.textChannelSettings : []).map((channel) => ({ name: String(channel.name || ''), category: String(channel.category || '') }));
  ROOM_CHANNEL_LAYOUT.categories = reset ? [] : (Array.isArray(layout.categories) ? layout.categories.map(String) : []);
  ROOM_CHANNEL_LAYOUT.limits = reset ? { humansPerCall: 12, membersPerCall: 15 } : { humansPerCall: Number(layout.limits?.humansPerCall || 12), membersPerCall: Number(layout.limits?.membersPerCall || 15) };
  ROOM_CHANNEL_LAYOUT.private = !reset && Boolean(layout.private);
  for (const channel of text) if (!channelMessages.has(channel)) channelMessages.set(channel, []);
  for (const channel of [...channelMessages.keys()]) if (!text.includes(channel)) channelMessages.delete(channel);
  for (const channel of [...unreadChannels]) if (!text.includes(channel)) unreadChannels.delete(channel);
  for (const channel of [...mentionChannels]) if (!text.includes(channel)) mentionChannels.delete(channel);
  if (!text.includes(activeTextChannel)) activeTextChannel = text[0];
  if (activeVoiceChannel && !voice.includes(activeVoiceChannel)) activeVoiceChannel = '';
  if (previousVoice && !activeVoiceChannel && hostedSocket?.connected && !reset) hostedSocket.emit('switch-voice-channel', { voiceChannel: HOSTED_LOBBY_CHANNEL });
  if ($('room-channels')) renderRoomChannels();
  if (currentMode === 'hosted' && document.querySelector('.content header h2')) document.querySelector('.content header h2').textContent = activeHostedRoomName || (globalThis.voiceupI18n?.t('call.groupTitle') || 'Sala P2P em grupo');
  if (!$('app')?.classList.contains('hidden')) renderChannelMessages();
  saveProfile();
}
const unreadChannels = new Set();
const mentionChannels = new Set();
const $ = (id) => document.getElementById(id);
// Keep the entry page self-contained.  The visual beta layer is loaded later,
// so the welcome screen must not depend on it to be centered or scrollable.
function syncWelcomeLayout() {
  const open = !$('welcome')?.classList.contains('hidden');
  document.body.classList.toggle('voiceup-welcome-open', open);
}
syncWelcomeLayout();
new MutationObserver(syncWelcomeLayout).observe($('welcome'), { attributes: true, attributeFilter: ['class'] });
$('theme-select').innerHTML = '<option value="aurora">Aurora · turquesa e coral</option><option value="midnight">Meia-noite · índigo e rosa</option><option value="ember">Brasa · laranja e dourado</option><option value="forest">Floresta · verde e âmbar</option><option value="ocean">Oceano · azul profundo</option><option value="grape">Uva · roxo e rosa</option><option value="snow">Neve · azul claro</option><option value="lilac">Lilás · violeta suave</option><option value="sage">Sálvia · verde claro</option><option value="peach">Pêssego · coral claro</option><option value="mist">Névoa · cinza azulado</option>';
$('theme-select').innerHTML = '<option value="aurora">Aurora · turquesa e coral</option><option value="midnight">Meia-noite · índigo e rosa</option><option value="ember">Brasa · laranja e dourado</option><option value="forest">Floresta · verde e âmbar</option><option value="snow">Neve · azul claro</option><option value="lilac">Lilás · violeta suave</option>';
$('video-frame').insertAdjacentHTML('beforeend', '<button id="fullscreen-button" type="button" title="Abrir live em tela cheia" style="position:absolute;right:9px;top:9px;width:34px;height:34px;border-radius:8px;background:rgba(12,18,31,.78);color:#e8edf8;font-size:18px;z-index:3">⛶</button>');
const videoGallery = document.createElement('div'); videoGallery.id = 'video-gallery'; const manualVideoTile = document.createElement('article'); manualVideoTile.className = 'video-tile hidden'; manualVideoTile.dataset.videoPeer = 'manual'; const manualVideo = $('remote-video'); manualVideo.remove(); manualVideoTile.append(manualVideo); manualVideoTile.insertAdjacentHTML('beforeend', '<span class="video-tile-label">Live recebida</span>'); videoGallery.append(manualVideoTile); $('video-frame').prepend(videoGallery);
$('name-input').value = myName;
$('host-url').value = storedProfile.hostUrl || DEFAULT_HOST_URL;
$('host-room').value = storedProfile.roomId || '';
$('settings-voice-channel')?.closest('div[style*="border-top"]')?.remove();
if (['360', '480', '720', '1080', '1440', '2160'].includes(storedProfile.quality)) $('quality-select').value = storedProfile.quality;
if (['15', '30', '60'].includes(String(storedProfile.frameRate))) $('fps-select').value = String(storedProfile.frameRate);
$('theme-select').innerHTML = '<option value="aurora">Aurora - turquesa e coral</option><option value="midnight">Meia-noite - indigo e rosa</option><option value="ember">Brasa - laranja e dourado</option><option value="forest">Floresta - verde e ambar</option><option value="ocean">Oceano - azul profundo</option><option value="grape">Uva - roxo e rosa</option><option value="cyber">Cyber - azul e neon</option><option value="crimson">Carmesim - vinho e rubi</option><option value="obsidian">Obsidiana - grafite e jade</option><option value="cobalt">Cobalto - azul e laranja</option><option value="amethyst">Ametista - violeta e ciano</option><option value="volcano">Vulcão - carvão e lava</option><option value="snow">Neve colorida - azul sereno</option><option value="lilac">Lilas fosco - violeta suave</option><option value="sage">Salvia fosca - verde natural</option><option value="peach">Pessego fosco - coral quente</option><option value="mist">Nevoa fosca - cinza azulado</option><option value="lagoon">Lagoa fosca - turquesa suave</option><option value="sunset">Entardecer - rosa e dourado</option>';
$('noise-select').innerHTML = '<option value="standard">Padrão do navegador</option><option value="rnnoise">RNNoise · ML local</option><option value="strong">Redução forte</option><option value="enhanced">Adaptativa aprimorada</option><option value="studio">Estúdio — eco e ruído máximo</option><option value="off">Desativada</option>';
const noiseModeNote = $('noise-select').closest('label')?.querySelector('small');
if (noiseModeNote) { noiseModeNote.id = 'noise-mode-note'; noiseModeNote.textContent = 'RNNoise roda localmente dentro do VoiceUP. Os demais modos usam os filtros disponíveis no sistema.'; }
$('language-select').value = language;
$('carry-media-toggle').checked = carryMediaOnChannelChange;
$('external-media-toggle').checked = externalMediaAutoLoad;
$('client-close-behavior').value = clientCloseBehavior;

const initials = (name) => String(name || '?').split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
let voiceupDialogResolve = null;
function closeVoiceupDialog(value = 'cancel') { const modal = $('voiceup-dialog'); if (!modal || modal.classList.contains('hidden')) return; modal.classList.add('hidden'); const resolve = voiceupDialogResolve; voiceupDialogResolve = null; resolve?.(value); }
function showVoiceupDialog({ title = 'Confirmar ação', message = '', detail = '', tone = 'normal', icon = '?', actions = [] } = {}) {
  return new Promise((resolve) => {
    if (voiceupDialogResolve) closeVoiceupDialog('cancel');
    voiceupDialogResolve = resolve; const modal = $('voiceup-dialog'); const choices = actions.length ? actions : [{ value: 'ok', label: 'Confirmar', style: 'primary' }, { value: 'cancel', label: 'Cancelar' }];
    modal.classList.toggle('danger', tone === 'danger'); modal.querySelector('.voiceup-dialog-icon').textContent = icon; $('voiceup-dialog-title').textContent = title; $('voiceup-dialog-message').textContent = message; $('voiceup-dialog-detail').textContent = detail; $('voiceup-dialog-detail').classList.toggle('hidden', !detail);
    $('voiceup-dialog-actions').innerHTML = choices.map((action) => `<button type="button" class="voiceup-dialog-action ${escapeHtml(action.style || 'secondary')}" data-dialog-value="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`).join('');
    $('voiceup-dialog-actions').querySelectorAll('[data-dialog-value]').forEach((button) => button.addEventListener('click', () => closeVoiceupDialog(button.dataset.dialogValue)));
    modal.classList.remove('hidden'); requestAnimationFrame(() => $('voiceup-dialog-actions').querySelector('[data-dialog-value]')?.focus());
  });
}
const pack = (data) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))));
const unpack = (text) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0))));
const safeColor = (color) => AVATAR_COLORS.includes(color) ? color : '#6676ea';
const safeAvatar = (photo) => typeof photo === 'string' && photo.startsWith('data:image/') && photo.length <= 150000 ? photo : '';
const avatar = (name, color, photo = '') => { const image = safeAvatar(photo); return `<div class="avatar" style="background:${safeColor(color)}${image ? `;background-image:url('${image}');background-size:cover;background-position:center` : ''}">${image ? '' : escapeHtml(initials(name))}</div>`; };
const audioIcon = (muted = false) => muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM19 9l-6 6M13 9l6 6"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg>';
const micIcon = (muted = false) => muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-5.2-2M5 5l14 14M6 10v1a6 6 0 0 0 9.8 4.6M12 17v4M8 21h8"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v3M8 21h8"/></svg>';
const cameraIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="m16 10 5-3v10l-5-3z"/></svg>';
const screenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4M8 10h8M15 7l3 3-3 3"/></svg>';
const bellIcon = (muted = false) => muted ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-9.6-4.8M5 5l14 14M6.4 8.4C6 14.8 3 15.5 3 18h13M10 21h4"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>';
const voiceChannelIcon = '<svg class="inline-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 9.5a4 4 0 0 1 0 5M18 7a7.5 7.5 0 0 1 0 10"/></svg>';
const captureScreenIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4"/></svg>';
const captureWindowIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18M7 7h.01M10 7h.01"/></svg>';
function refreshMicButton() { const button = $('mic-button'); button.innerHTML = micIcon(!micEnabled); button.title = micEnabled ? 'Silenciar microfone' : 'Ativar microfone'; button.setAttribute('aria-label', button.title); }
function refreshVideoButtons() { const camera = $('cam-button'); const screen = $('screen-button'); camera.innerHTML = cameraIcon; screen.innerHTML = screenIcon; camera.title = cameraStream ? 'Desligar camera' : 'Ligar camera'; screen.title = screenStream ? 'Trocar ou encerrar transmissao de tela' : 'Iniciar transmissao de tela'; camera.setAttribute('aria-label', camera.title); screen.setAttribute('aria-label', screen.title); }
function setSelectOptions(select, items, current, defaultText) { if (!select) return; select.innerHTML = `<option value="">${defaultText}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`; select.value = items.some((item) => item.id === current) ? current : ''; }
async function refreshScreenSources() { const select = $('screen-source-select'); if (!window.voiceupDesktop?.desktopSources) { setSelectOptions(select, [], '', 'Escolher no sistema ao iniciar'); $('device-note').textContent = 'O sistema mostrará o seletor de tela quando a live iniciar.'; return; } try { const sources = await window.voiceupDesktop.desktopSources(); setSelectOptions(select, sources, selectedScreenSource, 'Escolher automaticamente'); $('device-note').textContent = 'Mostra telas inteiras e somente janelas abertas com prévia.'; } catch { $('device-note').textContent = 'Não foi possível listar as telas agora.'; } }
async function refreshDeviceControls() { try { const devices = await navigator.mediaDevices.enumerateDevices(); setSelectOptions($('audio-input-select'), devices.filter((device) => device.kind === 'audioinput').map((device, index) => ({ id: device.deviceId, name: device.label || `Microfone ${index + 1}` })), audioInputId, 'Padrão do sistema'); setSelectOptions($('audio-output-select'), devices.filter((device) => device.kind === 'audiooutput').map((device, index) => ({ id: device.deviceId, name: device.label || `Saída de áudio ${index + 1}` })), audioOutputId, 'Padrão do sistema'); setSelectOptions($('camera-input-select'), devices.filter((device) => device.kind === 'videoinput').map((device, index) => ({ id: device.deviceId, name: device.label || `Câmera ${index + 1}` })), cameraInputId, 'Padrão do sistema'); } catch { $('device-note').textContent = 'Libere microfone e câmera para listar todos os dispositivos.'; } $('screen-audio-toggle').checked = shareSystemAudio; await refreshScreenSources(); }

function toast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 3500); }
function refreshNotificationButton() { const button = $('notification-button'); button.innerHTML = bellIcon(!notificationsEnabled); button.title = notificationsEnabled ? 'Silenciar notificacoes sonoras' : 'Ativar notificacoes sonoras'; button.setAttribute('aria-label', button.title); button.classList.toggle('muted', !notificationsEnabled); }
function playNotification(kind) {
  if (!notificationsEnabled || presenceStatus === 'dnd') return;
  try {
    notificationContext ||= new AudioContext();
    notificationContext.resume().catch(() => {});
    const patterns = {
      // This is the chime played when a WebRTC call finishes connecting.
      connect: [[523, 0], [784, .1]],
      disconnect: [[440, 0], [330, .11]],
      // Broadcasters hear these when someone starts or stops watching their live.
      'live-viewer-in': [[659, 0], [988, .08], [1319, .16]],
      'live-viewer-out': [[784, 0], [587, .09], [392, .18]],
      message: [[660, 0]],
      mention: [[880, 0], [1175, .085], [988, .17]]
    };
    for (const [frequency, offset] of patterns[kind] || []) {
      const oscillator = notificationContext.createOscillator();
      const gain = notificationContext.createGain();
      oscillator.type = ['mention', 'live-viewer-in'].includes(kind) ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      const peak = ['mention', 'live-viewer-in'].includes(kind) ? .072 : .055;
      gain.gain.setValueAtTime(.0001, notificationContext.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(peak, notificationContext.currentTime + offset + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, notificationContext.currentTime + offset + .095);
      oscillator.connect(gain).connect(notificationContext.destination);
      oscillator.start(notificationContext.currentTime + offset);
      oscillator.stop(notificationContext.currentTime + offset + .11);
    }
  } catch { /* optional sound */ }
}
function setStatus(label, connected = false) { const s = $('call-status'); s.classList.toggle('connected', connected); s.lastChild.textContent = ` ${label}`; }
function messageId() { return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function messageDate(value) { const date = new Date(Number(value) || Date.now()); return { short: date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), full: date.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'medium' }) }; }
function messageAvatar(name, color, photo = '') { const image = safeAvatar(photo); return `<span class="message-avatar" style="background:${safeColor(color)}${image ? `;background-image:url('${image}');background-size:cover;background-position:center` : ''}" aria-hidden="true">${image ? '' : initials(name)}</span>`; }
function messageUrlParts(raw) {
  let candidate = String(raw || ''); let suffix = '';
  while (/[),.!?;:]$/.test(candidate)) { suffix = candidate.slice(-1) + suffix; candidate = candidate.slice(0, -1); }
  try { const url = new URL(candidate); return ['http:', 'https:'].includes(url.protocol) ? { url, suffix } : null; } catch { return null; }
}
// Image CDNs frequently add routes after the original filename.  Examples:
// "/picture.png/revision/latest" and "/asset.webp/scale-to-width-down/...".
// The extension therefore cannot be required to be the final part of the URL.
function isImageLink(url) {
  return /\.(?:png|jpe?g|gif|webp|avif|bmp)(?=(?:[/?#]|$))/i.test(String(url?.pathname || ''));
}
function externalMediaConsentMarkup(href, kind, label) {
  const copies = {
    'en-US': { image: 'Load external image', video: 'Load external video', preview: 'Load external preview', note: 'The provider may receive your IP address.' },
    'es-ES': { image: 'Cargar imagen externa', video: 'Cargar vídeo externo', preview: 'Cargar vista previa externa', note: 'El proveedor puede recibir tu dirección IP.' },
    'fr-FR': { image: 'Charger l’image externe', video: 'Charger la vidéo externe', preview: 'Charger l’aperçu externe', note: 'Le fournisseur peut recevoir votre adresse IP.' }
  };
  const copy = copies[language] || { image: 'Carregar imagem externa', video: 'Carregar vídeo externo', preview: 'Carregar prévia externa', note: 'O provedor poderá receber seu endereço IP.' };
  return `<button type="button" class="message-external-load" data-external-media-kind="${escapeHtml(kind)}" data-external-media-url="${escapeHtml(href)}"><b>${escapeHtml(copy[kind] || label)}</b><small>${escapeHtml(copy.note)}</small></button>`;
}
function imageEmbedMarkup(href, alt = 'Imagem compartilhada por link', allowLoad = externalMediaAutoLoad) {
  if (!allowLoad) return externalMediaConsentMarkup(href, 'image', 'Carregar imagem externa');
  return `<a class="message-image-embed" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir imagem"><img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer"/></a>`;
}
function videoEmbedMarkup(href, allowLoad = externalMediaAutoLoad) {
  if (!allowLoad) return externalMediaConsentMarkup(href, 'video', 'Carregar vídeo externo');
  return `<div class="message-video-embed"><iframe src="${escapeHtml(href)}" title="Vídeo do YouTube" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
}
function previewSlotMarkup(href, host) {
  const consent = externalMediaAutoLoad ? '' : ' consent';
  const button = externalMediaAutoLoad ? '' : externalMediaConsentMarkup(href, 'preview', 'Carregar prévia externa');
  return `<span class="message-preview-slot${consent}" data-preview-url="${escapeHtml(href)}" data-preview-host="${escapeHtml(host)}">${button}</span>`;
}
function removeImageSourceLink(root, url) {
  for (const link of root?.querySelectorAll?.('[data-message-link-url]') || []) {
    try { if (new URL(link.href).href === url) link.remove(); } catch { /* malformed link is ignored */ }
  }
}
function youtubeEmbedUrl(url) {
  const host = url.hostname.replace(/^www\./, '').toLowerCase(); let id = '';
  if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (host === 'youtube.com' || host === 'm.youtube.com') id = url.pathname.startsWith('/shorts/') ? url.pathname.split('/')[2] : url.searchParams.get('v') || '';
  if (!/^[a-zA-Z0-9_-]{6,15}$/.test(id)) return '';
  const identity = 'https://voiceup.shardweb.app/';
  return `https://www.youtube-nocookie.com/embed/${id}?origin=${encodeURIComponent(identity.slice(0, -1))}&widget_referrer=${encodeURIComponent(identity)}`;
}
const linkPreviewCache = new Map();
async function linkPreview(url) {
  if (!window.voiceupDesktop?.linkPreview) return null;
  if (!linkPreviewCache.has(url)) linkPreviewCache.set(url, Promise.resolve(window.voiceupDesktop.linkPreview(url)).catch(() => null));
  return linkPreviewCache.get(url);
}
async function hydrateMessageEmbeds(root) {
  const slots = [...(root?.querySelectorAll?.('[data-preview-url]') || [])];
  await Promise.all(slots.map(async (slot) => {
    if (!externalMediaAutoLoad && slot.dataset.externalAllowed !== 'true') return;
    const url = slot.dataset.previewUrl; const preview = await linkPreview(url);
    if (!slot.isConnected || slot.dataset.previewUrl !== url) return;
    // Some hosts deliberately do not expose an extension in their public URL.
    // The desktop preview service confirms those by their Content-Type.
    if (preview?.type === 'image' && preview.image) {
      removeImageSourceLink(root, preview.url || url);
      slot.outerHTML = imageEmbedMarkup(preview.image, 'Imagem compartilhada por link', true);
      return;
    }
    if (!preview || (!preview.title && !preview.description && !preview.image)) { slot.remove(); return; }
    const href = escapeHtml(preview.url || url); const title = escapeHtml(preview.title || preview.siteName || new URL(url).hostname); const site = escapeHtml(preview.siteName || new URL(url).hostname.replace(/^www\./, ''));
    const description = preview.description ? `<small>${escapeHtml(preview.description)}</small>` : '';
    const image = preview.image ? `<img src="${escapeHtml(preview.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"/>` : '<span class="message-link-mark">↗</span>';
    slot.outerHTML = `<a class="message-link-card${preview.image ? ' has-image' : ''}" href="${href}" target="_blank" rel="noopener noreferrer">${image}<span><em>${site}</em><b>${title}</b>${description}</span></a>`;
  }));
}
document.addEventListener('click', (event) => {
  const button = event.target.closest?.('.message-external-load');
  if (!button) return;
  event.preventDefault();
  const kind = button.dataset.externalMediaKind;
  const url = button.dataset.externalMediaUrl;
  if (!/^https?:\/\//i.test(String(url || ''))) return;
  if (kind === 'preview') {
    const slot = button.closest('[data-preview-url]');
    if (!slot) return;
    slot.dataset.externalAllowed = 'true';
    slot.classList.remove('consent');
    button.remove();
    void hydrateMessageEmbeds(slot.parentElement);
  } else if (kind === 'video') {
    button.outerHTML = videoEmbedMarkup(url, true);
  } else if (kind === 'image') {
    button.outerHTML = imageEmbedMarkup(url, 'Imagem compartilhada por link', true);
  }
});
function renderFormattedText(value) {
  const tokens = [];
  const protect = (html) => `\uE000${tokens.push(html) - 1}\uE001`;
  let html = escapeHtml(String(value || ''));
  html = html.replace(/```([\s\S]*?)```/g, (_match, code) => protect(`<pre class="message-code-block"><code>${code}</code></pre>`));
  html = html.replace(/`([^`\n]+)`/g, (_match, code) => protect(`<code class="message-inline-code">${code}</code>`));
  html = html.replace(/\*\*\*([^*\n][\s\S]*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/___([^_\n][\s\S]*?)___/g, '<u><em>$1</em></u>');
  html = html.replace(/\*\*([^*\n][\s\S]*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_\n][\s\S]*?)__/g, '<u>$1</u>');
  html = html.replace(/~~([^~\n][\s\S]*?)~~/g, '<del>$1</del>');
  html = html.replace(/(^|[^*])\*([^*\n][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_])_([^_\n][^_\n]*?)_(?!_)/g, '$1<em>$2</em>');
  return html.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)] || '');
}
function renderMessageContent(value) {
  const text = String(value || '').slice(0, 500); const matcher = /https?:\/\/[^\s<>]+/gi; let cursor = 0; let html = ''; let match;
  while ((match = matcher.exec(text))) {
    html += renderFormattedText(text.slice(cursor, match.index)); const parsed = messageUrlParts(match[0]);
    if (!parsed) { html += escapeHtml(match[0]); cursor = matcher.lastIndex; continue; }
    const href = parsed.url.href; const label = escapeHtml(match[0].slice(0, match[0].length - parsed.suffix.length)); const host = parsed.url.hostname.replace(/^www\./, '');
    const image = isImageLink(parsed.url); const youtube = youtubeEmbedUrl(parsed.url);
    if (image) html += `${imageEmbedMarkup(href)}${escapeHtml(parsed.suffix)}`;
    else {
      html += `<a class="message-link" data-message-link-url="${escapeHtml(href)}" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>${escapeHtml(parsed.suffix)}`;
      if (youtube) html += videoEmbedMarkup(youtube);
      else html += previewSlotMarkup(href, host);
    }
    cursor = matcher.lastIndex;
  }
  return html + renderFormattedText(text.slice(cursor));
}
function updateMessageText(element, value) { const node = element?.querySelector?.('.message-text') || element; if (!node) return; const text = String(value || '').slice(0, 500); node.dataset.rawText = text; node.innerHTML = renderMessageContent(text); void hydrateMessageEmbeds(node); }
function addMessage(text, author, mine = false, color = mine ? myColor : peer?.color, details = {}) {
  const m = document.createElement('article');
  const id = String(details.id || ''); const createdAt = Number(details.createdAt) || Date.now(); const editedAt = Number(details.editedAt) || 0;
  const date = messageDate(createdAt); const photo = details.avatar || (mine ? myAvatar : peer?.avatar || '');
  m.className = `message${mine ? ' mine' : ''}${details.mentioned ? ' mentioned-me' : ''}`; if (id) m.dataset.messageId = id;
  m.innerHTML = `${messageAvatar(author, color, photo)}<div class="message-body"><div class="message-meta"><span class="author" style="color:${safeColor(color)}">${escapeHtml(author)}</span><time datetime="${new Date(createdAt).toISOString()}" title="${escapeHtml(date.full)}">${escapeHtml(date.short)}</time><span class="message-edited${editedAt ? '' : ' hidden'}">editada</span>${details.mentioned ? '<span class="message-mention-label" title="Você foi mencionado nesta mensagem">@ menção</span>' : ''}</div><div class="message-text">${renderMessageContent(text)}</div></div>${mine && id ? `<button type="button" class="message-edit" title="Editar mensagem" aria-label="Editar mensagem"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 16-.8 4.8L8 20l11-11-4-4zM13.5 6.5l4 4"/></svg></button>` : ''}`;
  m.querySelector('.message-text').dataset.rawText = String(text || '').slice(0, 500);
  m.querySelector('.message-edit')?.addEventListener('click', () => startMessageEdit(m));
  $('messages').append(m); void hydrateMessageEmbeds(m); $('messages').scrollTop = $('messages').scrollHeight;
}
function saveProfile() { localStorage.setItem('voiceup-profile-v1', JSON.stringify({ name: $('name-input')?.value.trim() || myName, avatar: myAvatar, color: myColor, clientId, hostUrl: $('host-url')?.value.trim() || DEFAULT_HOST_URL, roomId: $('host-room')?.value.trim() || '', voiceChannel: activeVoiceChannel, textChannel: activeTextChannel, quality: $('quality-select')?.value || '720', frameRate: $('fps-select')?.value || '30', notifications: notificationsEnabled, theme, noiseMode, micThresholdDb, micMonitorEnabled, audioInputId, audioOutputId, cameraInputId, screenSource: selectedScreenSource, shareSystemAudio, preserveScreenSourceQuality, carryMediaOnChannelChange, externalMediaAutoLoad, language, clientCloseBehavior, presenceStatus, lastMode: currentMode })); }
function normalizedPresenceStatus(value) { return ['online', 'idle', 'dnd'].includes(String(value || '').toLowerCase()) ? String(value).toLowerCase() : 'online'; }
function syncPresenceStatus() {
  effectivePresenceStatus = presenceAutoIdle && presenceStatus === 'online' ? 'idle' : presenceStatus;
  if (hostedSocket?.id) rememberHostedMember({ id: hostedSocket.id, name: myName, color: myColor, avatar: myAvatar, voiceChannel: activeVoiceChannel, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() });
  if (hostedSocket?.connected) hostedSocket.emit('presence-update', { status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() });
  if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'presence-state', status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() }));
  for (const participant of hostedPeers.values()) {
    if (participant.channel?.readyState === 'open') {
      try { participant.channel.send(JSON.stringify({ type: 'presence-state', status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() })); }
      catch { /* A peer can disconnect while presence is being published. */ }
    }
  }
  window.dispatchEvent(new CustomEvent('voiceup-presence-changed', { detail: { status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local(), manualStatus: presenceStatus, automatic: presenceAutoIdle } }));
  if (!$('app')?.classList.contains('hidden')) renderRoomChannels();
}
function setPresenceStatus(value) { presenceStatus = normalizedPresenceStatus(value); presenceAutoIdle = false; lastPresenceActivityAt = Date.now(); saveProfile(); syncPresenceStatus(); }
function evaluatePresenceIdle() {
  const shouldIdle = presenceStatus === 'online' && !micEnabled && Date.now() - lastPresenceActivityAt >= 10 * 60 * 1000;
  if (shouldIdle === presenceAutoIdle) return;
  presenceAutoIdle = shouldIdle; syncPresenceStatus();
}
function notePresenceActivity() {
  lastPresenceActivityAt = Date.now();
  if (presenceStatus === 'online' && presenceAutoIdle) { presenceAutoIdle = false; syncPresenceStatus(); }
}
function mentionIdsForText(text) {
  const source = String(text || '').toLocaleLowerCase(); const found = [];
  if (currentMode === 'hosted') for (const member of serverMembers.values()) { if (member.id && member.id !== hostedSocket?.id && source.includes(`@${String(member.name || '').toLocaleLowerCase()}`)) found.push(String(member.id)); }
  else if (peer?.clientId && peer?.name && source.includes(`@${String(peer.name).toLocaleLowerCase()}`)) found.push(String(peer.clientId));
  return [...new Set(found)].slice(0, 16);
}
function isMentionedForCurrentUser(mentions, mentionClientIds = []) {
  const socketTargets = new Set((Array.isArray(mentions) ? mentions : []).map(String));
  const stableTargets = new Set((Array.isArray(mentionClientIds) ? mentionClientIds : []).map(String));
  return Boolean(
    (hostedSocket?.id && socketTargets.has(String(hostedSocket.id)))
    || socketTargets.has(String(clientId))
    || stableTargets.has(String(clientId))
  );
}
function isTextChannelVisible(channel) {
  if (channel !== activeTextChannel) return false;
  if (document.body.classList.contains('server-lobby-mode')) return true;
  return Boolean(document.querySelector('#chat-panel')?.classList.contains('active'));
}
function refreshChatUnreadIndicator() {
  const indicator = $('chat-unread'); if (!indicator) return;
  const hasMention = mentionChannels.size > 0;
  const hasUnread = unreadChannels.size > 0;
  indicator.classList.toggle('mention-unread', hasMention);
  indicator.classList.toggle('hidden', !hasUnread);
  indicator.title = hasMention ? 'Você foi mencionado' : (hasUnread ? 'Nova mensagem' : '');
}
function registerIncomingChannelActivity(channel, mentioned = false) {
  if (isTextChannelVisible(channel)) return;
  unreadChannels.add(channel);
  if (mentioned) mentionChannels.add(channel);
  refreshChatUnreadIndicator();
}
function channelAvatar(member) { const photo = safeAvatar(member.avatar); const initialsText = initials(member.name); return `<span class="channel-avatar" title="${escapeHtml(member.name)}" style="background:${safeColor(member.color)}${photo ? `;background-image:url('${photo}');background-size:cover;background-position:center` : ''}">${photo ? '' : initialsText}</span>`; }
function rememberHostedMember(member, voiceChannel = activeVoiceChannel) {
  if (!member?.id) return;
  const previous = serverMembers.get(member.id) || {};
  const isSelf = Boolean(hostedSocket?.id) && member.id === hostedSocket.id;
  const stableClientId = String(member.clientId || previous.clientId || '').trim().slice(0, 96);
  // Socket.IO assigns a new socket id after a reconnect.  Treat the local
  // profile id as the durable identity so an old socket can never be rendered
  // as a second copy of the same person while the server removes it.
  if (stableClientId && stableClientId === clientId && !isSelf) {
    discardHostedPeer(member.id);
    serverMembers.delete(member.id);
    return;
  }
  if (stableClientId) {
    for (const [knownId, knownMember] of serverMembers.entries()) {
      if (knownId === member.id || String(knownMember?.clientId || '') !== stableClientId) continue;
      const knownIsSelf = Boolean(hostedSocket?.id) && knownId === hostedSocket.id;
      if (knownIsSelf && !isSelf) return;
      serverMembers.delete(knownId);
      discardHostedPeer(knownId);
    }
  }
  const hasStatus = Object.prototype.hasOwnProperty.call(member, 'status');
  const hasVoiceChannel = Object.prototype.hasOwnProperty.call(member, 'voiceChannel');
  const incomingChannel = hasVoiceChannel ? member.voiceChannel : previous.voiceChannel;
  const knownChannel = incomingChannel === ''
    ? ''
    : ROOM_CHANNELS.voice.includes(incomingChannel)
      ? incomingChannel
      : (previous.voiceChannel ?? voiceChannel);
  // Partial presence events from older clients do not include a status. Keep
  // the last known value instead of momentarily resetting the member online.
  // For the local account, the Client is authoritative so a delayed server
  // snapshot can never overwrite DND/idle with a stale value.
  const knownStatus = isSelf
    ? effectivePresenceStatus
    : hasStatus
      ? normalizedPresenceStatus(member.status)
      : normalizedPresenceStatus(previous.status);
  serverMembers.set(member.id, {
    ...previous,
    ...member,
    ...(isSelf ? { name: myName, color: myColor, avatar: myAvatar } : {}),
    clientId: stableClientId,
    status: knownStatus,
    platform: isSelf ? globalThis.voiceupPlatform.local() : globalThis.voiceupPlatform.merge(member.platform, previous.platform || hostedPeers.get(member.id)?.platform),
    voiceChannel: isSelf ? activeVoiceChannel : knownChannel
  });
}
function rememberCurrentMember() { if (!hostedSocket?.id) return; rememberHostedMember({ id: hostedSocket.id, name: myName, color: myColor, avatar: myAvatar, clientId, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local(), voiceChannel: activeVoiceChannel }); }
function renderChannelMessages() { const messages = channelMessages.get(activeTextChannel) || []; const channelName = globalThis.voiceupI18n?.channel(activeTextChannel, 'text') || activeTextChannel; const emptyText = globalThis.voiceupI18n?.t('chat.empty', { channel: channelName }) || `Nenhuma mensagem em #${channelName} ainda.`; $('messages').innerHTML = messages.length ? '' : `<div class="system-message">${escapeHtml(emptyText)}</div>`; messages.forEach((message) => addMessage(message.text, message.name, message.mine, message.color, message)); }
function selectTextChannel(channel) {
  if (!ROOM_CHANNELS.text.includes(channel)) return;
  activeTextChannel = channel;
  unreadChannels.delete(channel);
  mentionChannels.delete(channel);
  renderRoomChannels();
  renderChannelMessages();
  refreshChatUnreadIndicator();
  saveProfile();
}
function receiveHostedText({ from, authorClientId, text, textChannel, name, color, avatar: photo, messageId: id, createdAt, editedAt, mentions, mentionClientIds }) {
  const channel = ROOM_CHANNELS.text.includes(textChannel) ? textChannel : 'geral';
  const mine = from === hostedSocket?.id || Boolean(authorClientId && authorClientId === clientId);
  const mentionIds = Array.isArray(mentions) ? mentions.map(String) : [];
  const stableMentionIds = Array.isArray(mentionClientIds) ? mentionClientIds.map(String) : [];
  const mentioned = !mine && isMentionedForCurrentUser(mentionIds, stableMentionIds);
  const message = { id: String(id || ''), text, name, color, avatar: photo || serverMembers.get(from)?.avatar || '', createdAt: Number(createdAt) || Date.now(), editedAt: Number(editedAt) || 0, mentions: mentionIds, mentionClientIds: stableMentionIds, mentioned, mine, authorClientId: authorClientId || '' };
  if (!channelMessages.has(channel)) channelMessages.set(channel, []);
  channelMessages.get(channel).push(message);
  registerIncomingChannelActivity(channel, mentioned);
  if (channel === activeTextChannel) addMessage(message.text, message.name, message.mine, message.color, message);
  if (!mine) playNotification(mentioned ? 'mention' : 'message');
  renderRoomChannels();
}
function applyMessageEdit({ messageId: id, text, textChannel, editedAt, mentions, mentionClientIds }) {
  const channel = ROOM_CHANNELS.text.includes(textChannel) ? textChannel : activeTextChannel;
  const message = (channelMessages.get(channel) || []).find((item) => item.id === id); if (!message) return;
  const wasMentioned = Boolean(message.mentioned);
  message.text = String(text || '').slice(0, 500); message.editedAt = Number(editedAt) || Date.now();
  if (Array.isArray(mentions) || Array.isArray(mentionClientIds)) {
    message.mentions = Array.isArray(mentions) ? mentions.map(String) : [];
    message.mentionClientIds = Array.isArray(mentionClientIds) ? mentionClientIds.map(String) : [];
    message.mentioned = !message.mine && isMentionedForCurrentUser(message.mentions, message.mentionClientIds);
  }
  if (!wasMentioned && message.mentioned) {
    registerIncomingChannelActivity(channel, true);
    playNotification('mention');
  }
  if (wasMentioned && !message.mentioned && !(channelMessages.get(channel) || []).some((item) => item.mentioned)) mentionChannels.delete(channel);
  if (channel === activeTextChannel) renderChannelMessages();
  renderRoomChannels();
}
function startMessageEdit(element) {
  const id = element?.dataset.messageId; if (!id || element.classList.contains('editing')) return;
  const textNode = element.querySelector('.message-text'); const original = textNode?.dataset.rawText ?? textNode?.textContent ?? ''; if (!textNode) return;
  element.classList.add('editing');
  const editor = document.createElement('form'); editor.className = 'message-editor'; editor.innerHTML = `<input maxlength="500" value="${escapeHtml(original)}" aria-label="Editar mensagem"/><div class="message-editor-actions"><button class="message-editor-save" type="submit" title="Salvar edição" aria-label="Salvar edição"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-7h8v7"/></svg></button><button class="message-editor-cancel" type="button" data-cancel title="Cancelar edição" aria-label="Cancelar edição"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  textNode.replaceWith(editor); const input = editor.querySelector('input'); input.focus(); input.select();
  const cancel = () => { editor.replaceWith(textNode); element.classList.remove('editing'); };
  editor.querySelector('[data-cancel]').addEventListener('click', cancel);
  editor.addEventListener('submit', (event) => { event.preventDefault(); const next = input.value.trim(); if (!next) return toast('A mensagem não pode ficar vazia.'); if (next === original) return cancel(); const editedAt = Date.now(); const mentions = mentionIdsForText(next); if (currentMode === 'hosted') { if (!hostedSocket?.connected) return toast('Servidor indisponível para editar a mensagem.'); hostedSocket.emit('edit-message', { messageId: id, text: next, textChannel: activeTextChannel, mentions }); } else { if (peer?.channel?.readyState !== 'open') return toast('A conexão ainda não está pronta.'); peer.channel.send(JSON.stringify({ type: 'chat-edit', messageId: id, text: next, textChannel: activeTextChannel, editedAt, mentions })); applyMessageEdit({ messageId: id, text: next, textChannel: activeTextChannel, editedAt, mentions }); editor.replaceWith(textNode); element.classList.remove('editing'); } });
}
function syncVoiceChannelActivity(members, packet) {
  voiceChannelActivityClock.setScope(currentMode === 'hosted' ? hostedSocket : (peer?.pc || null));
  voiceChannelActivityClock.sync(members, packet);
}
function refreshVoiceChannelClocks() {
  document.querySelectorAll('#room-channels [data-call-duration]').forEach((element) => {
    const activity = voiceChannelActivityClock.get(element.dataset.callDuration);
    if (!activity) return;
    const label = globalThis.voiceupChannelRoster.formatDuration(activity.elapsed);
    if (element.textContent !== label) element.textContent = label;
    const title = activity.authoritative ? `Call ativa sem ficar vazia: ${label}` : `Call acompanhada neste aplicativo: ${label}`;
    element.title = title;
    element.setAttribute('aria-label', title);
  });
}
setInterval(refreshVoiceChannelClocks, 1000);
function renderVoiceChannelMember(member) {
  return `<li><button type="button" class="channel-member" data-member-id="${escapeHtml(member.id)}" title="${escapeHtml(member.name)}"><span class="channel-member-avatar">${avatar(member.name, member.color, member.avatar)}${globalThis.voiceupPlatform.badge(member.platform, member.status)}</span><span class="channel-member-identity"><span class="channel-member-name">${escapeHtml(member.name)}</span><span class="channel-member-indicators"><span class="channel-member-media-slot"></span><span class="channel-member-mute-slot"></span></span></span></button></li>`;
}
function renderRoomChannels() {
  const panel = $('room-channels');
  // A ligação direta também possui canais reais no cliente. Eles não criam
  // outra conexão WebRTC, mas sincronizam a conversa de voz e separam o texto.
  const members = currentMode === 'manual'
    ? [
      { id: 'self', name: myName, color: myColor, avatar: myAvatar, voiceChannel: activeVoiceChannel, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() },
      ...(peer?.name ? [{ id: 'manual-peer', name: peer.name, color: peer.color, avatar: peer.avatar, voiceChannel: peer.voiceChannel ?? activeVoiceChannel, status: peer.status, platform: peer.platform }] : [])
    ]
    : [...serverMembers.values()];
  syncVoiceChannelActivity(members);
  const i18n = globalThis.voiceupI18n;
  const voiceTitle = i18n?.t('channels.voice') || 'CANAIS DE VOZ'; const textTitle = i18n?.t('channels.text') || 'CANAIS DE TEXTO';
  const unreadTitle = i18n?.t('chat.newMessage') || 'Nova mensagem'; const mentionTitle = i18n?.t('chat.mentioned') || 'Você foi mencionado neste canal';
  let lastVoiceCategory = ''; let lastTextCategory = '';
  const markup = `<h3>${voiceTitle}</h3>${ROOM_CHANNELS.voice.map((channel) => {
    const people = globalThis.voiceupChannelRoster.sortMembers(members.filter((member) => member.voiceChannel === channel)); const visibleName = i18n?.channel(channel, 'voice') || channel;
    const settings = ROOM_CHANNEL_LAYOUT.voice.find((item) => item.name === channel) || {};
    const category = settings.category || ''; const heading = category && category !== lastVoiceCategory ? `<h4 class="room-category">${escapeHtml(category)}</h4>` : ''; lastVoiceCategory = category;
    const humanCount = people.filter((member) => !member.isBot).length;
    const limit = Math.max(1, Number(settings.userLimit || settings.humans || ROOM_CHANNEL_LAYOUT.limits.humansPerCall || 12));
    const duration = people.length ? `<time class="channel-call-duration" data-call-duration="${escapeHtml(channel)}"></time>` : '';
    const roster = people.length ? `<ul class="voice-channel-members" aria-label="Membros de ${escapeHtml(visibleName)}">${people.map(renderVoiceChannelMember).join('')}</ul>` : '';
    return `${heading}<section class="voice-channel-group"><button type="button" class="room-channel voice-channel${channel === activeVoiceChannel ? ' active' : ''}" data-voice-channel="${escapeHtml(channel)}" title="${humanCount} de ${limit} pessoas"><span class="channel-label">${voiceChannelIcon}<span>${escapeHtml(visibleName)}</span></span><span class="voice-channel-info">${duration}<em class="channel-call-limit">${humanCount}/${limit}</em></span></button>${roster}</section>`;
  }).join('')}<h3>${textTitle}</h3>${ROOM_CHANNELS.text.map((channel) => {
    const visibleName = i18n?.channel(channel, 'text') || channel; const mentioned = mentionChannels.has(channel); const unread = unreadChannels.has(channel);
    const marker = mentioned ? `<b class="mention-channel-badge" title="${escapeHtml(mentionTitle)}" aria-label="${escapeHtml(mentionTitle)}">@</b>` : (unread ? `<b class="unread-dot" title="${escapeHtml(unreadTitle)}"></b>` : '');
    const category = ROOM_CHANNEL_LAYOUT.text.find((item) => item.name === channel)?.category || ''; const heading = category && category !== lastTextCategory ? `<h4 class="room-category">${escapeHtml(category)}</h4>` : ''; lastTextCategory = category;
    return `${heading}<button class="room-channel${channel === activeTextChannel ? ' active' : ''}${mentioned ? ' has-mention' : ''}" data-text-channel="${escapeHtml(channel)}"><span># ${escapeHtml(visibleName)}</span>${marker}</button>`;
  }).join('')}`;
  const activeChannelName = i18n?.channel(activeTextChannel, 'text') || activeTextChannel; $('message-input').placeholder = i18n?.t('chat.placeholder', { channel: activeChannelName }) || `Mensagem em #${activeChannelName}`;
  if (panel.voiceupRosterMarkup !== markup) {
    panel.voiceupRosterMarkup = markup;
    panel.innerHTML = markup;
    panel.querySelectorAll('[data-voice-channel]').forEach((button) => button.addEventListener('click', () => switchVoiceChannel(button.dataset.voiceChannel)));
    panel.querySelectorAll('[data-text-channel]').forEach((button) => button.addEventListener('click', () => selectTextChannel(button.dataset.textChannel)));
  }
  refreshVoiceChannelClocks();
  refreshChatUnreadIndicator();
}
function paintAvatar(target, name, color, photo = '') { if (!target) return; const image = safeAvatar(photo); target.textContent = image ? '' : initials(name); target.style.background = safeColor(color); target.style.backgroundImage = image ? `url('${image}')` : ''; target.style.backgroundSize = image ? 'cover' : ''; target.style.backgroundPosition = image ? 'center' : ''; }
function refreshWelcomeProfile() { paintAvatar($('welcome-avatar-preview'), $('name-input')?.value.trim() || myName || 'Você', myColor, myAvatar); }
function selfParticipant() { return `<span class="member-presence-avatar">${avatar(myName, myColor, myAvatar)}${globalThis.voiceupPlatform.badge(globalThis.voiceupPlatform.local(), effectivePresenceStatus)}</span><div><strong>${escapeHtml(myName)}</strong><small>Voce <span id="self-ping" style="margin-left:4px;color:#8995ab">• Ping —</span></small></div>`; }
function updatePingBadge(value) { const badge = $('self-ping'); if (!badge) return; const ping = Number(value); if (!Number.isFinite(ping) || ping < 0) { badge.textContent = '• Ping —'; badge.style.color = '#8995ab'; return; } badge.textContent = `• Ping ${Math.round(ping)} ms`; badge.style.color = ping <= 80 ? '#56e2cf' : ping <= 180 ? '#e8b65a' : '#ff8b72'; }
function applyMyColor(color) { if (!AVATAR_COLORS.includes(color) || color === myColor) return; myColor = color; saveProfile(); if (currentMode === 'hosted') renderHostedParticipants(); else { const own = $('self-participant'); if (own) own.innerHTML = selfParticipant(); } paintAvatar($('self-avatar'), myName, myColor, myAvatar); if (!peer?.name && !activeRemoteId) paintAvatar($('stage-avatar'), myName, myColor, myAvatar); }
function readProfilePhoto(file) {
  if (!file) return;
  if (!String(file.type || '').startsWith('image/')) return toast('Escolha um arquivo de imagem válido.');
  if (file.size > 15 * 1024 * 1024) return toast('Escolha uma imagem de até 15 MB.');

  const reader = new FileReader();
  reader.onerror = () => toast('Não foi possível ler esta imagem. Tente outro arquivo.');
  reader.onload = () => {
    const rawImage = String(reader.result || '');
    const preview = $('welcome-avatar-preview');
    // Show the chosen image immediately; compression happens afterwards for
    // sending and saving a small avatar to other participants.
    if (preview && rawImage.startsWith('data:image/')) {
      preview.textContent = '';
      preview.style.background = safeColor(myColor);
      preview.style.backgroundImage = `url('${rawImage}')`;
      preview.style.backgroundSize = 'cover';
      preview.style.backgroundPosition = 'center';
    }

    const source = new Image();
    source.onerror = () => {
      refreshWelcomeProfile();
      toast('Não foi possível abrir esta imagem. Tente PNG, JPG, WEBP ou GIF.');
    };
    source.onload = () => {
      const canvas = document.createElement('canvas');
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const width = source.naturalWidth || source.width;
      const height = source.naturalHeight || source.height;
      const scale = Math.max(size / width, size / height);
      const context = canvas.getContext('2d');
      context?.drawImage(source, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
      myAvatar = canvas.toDataURL('image/jpeg', .72);
      refreshWelcomeProfile();
      saveProfile();
      if (!$('app').classList.contains('hidden')) {
        paintAvatar($('self-avatar'), myName, myColor, myAvatar);
        if (currentMode === 'hosted') renderHostedParticipants();
      }
      toast('Foto de perfil salva. Ela será enviada ao entrar na chamada.');
    };
    source.src = rawImage;
  };
  reader.readAsDataURL(file);
}
function applyTheme(nextTheme) { theme = ['aurora', 'midnight', 'ember', 'forest', 'ocean', 'grape', 'cyber', 'crimson', 'obsidian', 'cobalt', 'amethyst', 'volcano', 'snow', 'lilac', 'sage', 'peach', 'mist', 'lagoon', 'sunset'].includes(nextTheme) ? nextTheme : 'aurora'; document.body.classList.remove('theme-midnight', 'theme-ember', 'theme-forest', 'theme-ocean', 'theme-grape', 'theme-cyber', 'theme-crimson', 'theme-obsidian', 'theme-cobalt', 'theme-amethyst', 'theme-volcano', 'theme-snow', 'theme-lilac', 'theme-sage', 'theme-peach', 'theme-mist', 'theme-lagoon', 'theme-sunset'); if (theme !== 'aurora') document.body.classList.add(`theme-${theme}`); }
const UI_TEXT = {
  'pt-BR': { settings: 'Configurações', leave: 'Sair da chamada', mode: 'MODO ATUAL', message: 'Escreva uma mensagem', join: 'Entrar na sala', copy: 'Copiar código', pair: 'Conectar agora', share: 'Iniciar transmissão de tela', camera: 'Ligar câmera' },
  'en-US': { settings: 'Settings', leave: 'Leave call', mode: 'CURRENT MODE', message: 'Write a message', join: 'Join room', copy: 'Copy code', pair: 'Connect now', share: 'Start screen share', camera: 'Turn on camera' },
  'es-ES': { settings: 'Configuración', leave: 'Salir de la llamada', mode: 'MODO ACTUAL', message: 'Escribe un mensaje', join: 'Entrar a la sala', copy: 'Copiar código', pair: 'Conectar ahora', share: 'Iniciar transmisión', camera: 'Encender cámara' },
  'fr-FR': { settings: 'Paramètres', leave: "Quitter l'appel", mode: 'MODE ACTUEL', message: 'Écrire un message', join: 'Rejoindre le salon', copy: 'Copier le code', pair: 'Se connecter', share: 'Partager l’écran', camera: 'Activer la caméra' }
};
function applyLanguage(nextLanguage) { language = UI_TEXT[nextLanguage] ? nextLanguage : 'pt-BR'; const text = UI_TEXT[language]; document.documentElement.lang = language; document.title = 'VoiceUP'; $('settings-button').title = text.settings; $('settings-button').setAttribute('aria-label', text.settings); const leave = $('leave-button'); if (leave) { leave.title = text.leave; leave.setAttribute('aria-label', text.leave); } $('join-host').textContent = text.join; $('copy-button').textContent = text.copy; $('complete-pair').textContent = text.pair; document.querySelector('.room-label').textContent = text.mode; if (!currentMode || currentMode === 'manual') $('message-input').placeholder = text.message; $('capture-start').textContent = language === 'en-US' ? 'Start sharing' : language === 'es-ES' ? 'Iniciar transmisión' : language === 'fr-FR' ? 'Commencer le partage' : 'Iniciar transmissão'; refreshVideoButtons(); }

function showPeer(name, state = 'Pareando...', connected = false, color = peer?.color) { if (!name) return; let row = $('peer-other'); if (!row) { row = document.createElement('div'); row.id = 'peer-other'; row.className = 'participant'; $('participants').append(row); } row.innerHTML = `<span class="member-presence-avatar">${avatar(name, color, peer?.avatar)}${globalThis.voiceupPlatform.badge(peer?.platform, peer?.status)}</span><div style="min-width:0;flex:1"><strong>${escapeHtml(name)}</strong><small>${state}</small></div><button id="peer-mute-button" class="participant-mute${remoteMuted ? ' muted' : ''}" type="button" title="Silenciar somente para voce" aria-label="Silenciar somente para voce" style="width:32px;height:32px;border-radius:8px;background:#29354b;color:#dbe5f4">${audioIcon(remoteMuted)}</button>`; $('peer-mute-button').addEventListener('click', togglePeerMute); $('count').textContent = '2'; paintAvatar($('stage-avatar'), name, color, peer?.avatar); if (connected) { $('stage-name').textContent = `${name} esta na conversa`; $('stage-message').textContent = 'Conexao direta estabelecida. Fale a vontade.'; } else { $('stage-name').textContent = `Conectando com ${name}`; $('stage-message').textContent = 'Aguardando a conexao P2P terminar...'; } }
function togglePeerMute() { remoteMuted = !remoteMuted; if (remoteAudio) remoteAudio.muted = remoteMuted; showPeer(peer?.name, remoteMuted ? 'Conectado · audio silenciado' : 'Conectado', true, peer?.color); }

function hostedRow(p) { return `<div class="participant${p.speaking ? ' speaking' : ''}" data-hosted-peer="${escapeHtml(p.id)}"><span class="member-presence-avatar">${avatar(p.name, p.color, p.avatar)}${globalThis.voiceupPlatform.badge(p.platform || serverMembers.get(p.id)?.platform, serverMembers.get(p.id)?.status || p.status)}</span><div style="min-width:0;flex:1"><strong>${escapeHtml(p.name)}</strong><small>${p.connected ? 'Conectado · P2P' : 'Conectando...'}</small></div><button class="hosted-mute" data-peer-id="${escapeHtml(p.id)}" type="button" title="Silenciar somente para voce" aria-label="Silenciar somente para voce" style="width:32px;height:32px;border-radius:8px;background:${p.muted ? '#533e52' : '#29354b'};color:${p.muted ? '#ffb0bd' : '#dbe5f4'}">${audioIcon(p.muted)}</button></div>`; }
function renderHostedParticipants() { $('participants').innerHTML = `<div id="self-participant" class="participant">${selfParticipant()}</div>${[...hostedPeers.values()].map(hostedRow).join('')}`; $('count').textContent = String(hostedPeers.size + 1); document.querySelectorAll('.hosted-mute').forEach((button) => button.addEventListener('click', () => toggleHostedMute(button.dataset.peerId))); }
function toggleHostedMute(id) { const p = hostedPeers.get(id); if (!p) return; p.muted = !p.muted; if (p.audio) p.audio.muted = p.muted; renderHostedParticipants(); toast(p.muted ? `Audio de ${p.name} silenciado.` : `Audio de ${p.name} reativado.`); }
function showHostedStage(p, connected = false) { if (!p) return; activeRemoteId ||= p.id; if (activeRemoteId !== p.id) return; paintAvatar($('stage-avatar'), p.name, p.color, p.avatar); $('stage-name').textContent = connected ? `${p.name} esta na conversa` : `Conectando com ${p.name}`; $('stage-message').textContent = connected ? `${hostedPeers.size} participante(s) conectado(s) por P2P.` : 'Aguardando a conexao P2P terminar...'; }

function audioConstraints() { const noiseEnabled = noiseMode !== 'off'; const rnnoise = noiseMode === 'rnnoise'; const enhanced = noiseMode === 'enhanced'; const strong = noiseMode === 'strong' || enhanced || rnnoise; return { deviceId: audioInputId ? { exact: audioInputId } : undefined, channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, sampleSize: { ideal: 16 }, echoCancellation: noiseEnabled, noiseSuppression: noiseEnabled && !rnnoise, autoGainControl: strong, voiceIsolation: enhanced, googEchoCancellation: noiseEnabled, googAutoGainControl: strong, googNoiseSuppression: strong && !rnnoise, googHighpassFilter: strong, googTypingNoiseDetection: enhanced }; }
function stopVoiceDetection() { voiceDetectionSession += 1; voiceLoopRunning = false; voiceContext?.close().catch(() => {}); voiceContext = null; voiceAnalyser = null; }
function startVoiceDetection() {
  if (!localStream || voiceLoopRunning) return;
  try {
    const session = ++voiceDetectionSession;
    voiceContext = new AudioContext();
    voiceContext.resume().catch(() => {});
    voiceAnalyser = voiceContext.createAnalyser();
    voiceAnalyser.fftSize = 512;
    voiceAnalyser.smoothingTimeConstant = .35;
    voiceData = new Uint8Array(voiceAnalyser.fftSize);
    voiceContext.createMediaStreamSource(localStream).connect(voiceAnalyser);
    voiceLoopRunning = true;
    let noiseFloorDb = -70;
    let calibrationSamples = 0;
    let aboveThresholdSince = 0;
    let lastVoiceAt = 0;
    let lastSignalAt = 0;
    const sample = (now = performance.now()) => {
      if (session !== voiceDetectionSession || !voiceAnalyser) return;
      voiceAnalyser.getByteTimeDomainData(voiceData);
      let squareSum = 0;
      for (const value of voiceData) { const normalized = (value - 128) / 128; squareSum += normalized * normalized; }
      const rms = Math.sqrt(squareSum / voiceData.length);
      const levelDb = 20 * Math.log10(Math.max(rms, 0.00001));
      // Hardware mute can still leave a constant electrical floor in the
      // Windows stream. Calibrate first and require a clear rise over both the
      // user's limit and the learned floor before showing the speaking aura.
      if (calibrationSamples < 30) {
        noiseFloorDb = calibrationSamples ? noiseFloorDb * .82 + levelDb * .18 : levelDb;
        calibrationSamples += 1;
      }
      const dynamicThresholdDb = Math.max(micThresholdDb, noiseFloorDb + 8);
      const aboveThreshold = micEnabled && calibrationSamples >= 30 && levelDb >= dynamicThresholdDb;
      if (!aboveThreshold) {
        aboveThresholdSince = 0;
        const learnRate = levelDb < noiseFloorDb + 5 ? .025 : .004;
        noiseFloorDb = noiseFloorDb * (1 - learnRate) + levelDb * learnRate;
      } else {
        aboveThresholdSince ||= now;
        if (now - aboveThresholdSince >= 85) lastVoiceAt = now;
      }
      const speaking = micEnabled && now - lastVoiceAt < 260;
      if (speaking !== localSpeaking || now - lastSignalAt > 1800) {
        localSpeaking = speaking;
        lastSignalAt = now;
        $('self-participant')?.classList.toggle('speaking', speaking);
        document.querySelector('[data-call-member="self"]')?.classList.toggle('speaking', speaking);
        sendSignal('voice-state', speaking);
      }
      requestAnimationFrame(sample);
    };
    sample();
  } catch { /* indicator optional */ }
}
async function requestAudio() { try { const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false }); stream.getAudioTracks().forEach((track) => { track.enabled = micEnabled && (currentMode !== 'hosted' || Boolean(activeVoiceChannel)); }); localStream?.getAudioTracks().forEach((track) => track.stop()); localStream = stream; $('connection-state').textContent = noiseMode === 'rnnoise' ? 'Microfone · preparando RNNoise' : noiseMode === 'studio' ? 'Microfone · estúdio (eco e ruído)' : noiseMode === 'enhanced' ? 'Microfone · supressão adaptativa' : noiseMode === 'strong' ? 'Microfone · redução forte' : noiseMode !== 'off' ? 'Microfone ativo' : 'Microfone sem supressão'; stopVoiceDetection(); startVoiceDetection(); } catch { $('connection-state').textContent = 'Sem acesso ao microfone'; toast('Libere o microfone para falar.'); } }
function setCallMode(mode) { currentMode = mode; const hosted = mode === 'hosted'; const i18n = globalThis.voiceupI18n; document.querySelector('.room-name span:last-child').textContent = hosted ? (i18n?.t('mode.hosted') || 'Sala P2P via servidor host') : (i18n?.t('mode.manual') || 'Conexão direta manual'); document.querySelector('.content header h2').textContent = hosted ? (i18n?.t('call.groupTitle') || 'Sala P2P em grupo') : (i18n?.t('call.manualTitle') || 'P2P sem servidor host'); $('room-channels').classList.remove('hidden'); renderRoomChannels(); }
function waitForIce(pc) { return new Promise((resolve) => { if (pc.iceGatheringState === 'complete') return resolve(true); let done = false; let settleTimer; const finish = (complete) => { if (done) return; done = true; clearTimeout(timeout); clearTimeout(settleTimer); pc.removeEventListener('icegatheringstatechange', check); pc.removeEventListener('icecandidate', candidateArrived); resolve(complete); }; const check = () => { if (pc.iceGatheringState === 'complete') finish(true); }; const candidateArrived = ({ candidate }) => { if (!candidate) return; clearTimeout(settleTimer); settleTimer = setTimeout(() => finish(false), 900); }; const timeout = setTimeout(() => finish(false), 5000); pc.addEventListener('icegatheringstatechange', check); pc.addEventListener('icecandidate', candidateArrived); }); }
function readyHostedPeers() { return [...hostedPeers.values()].filter((p) => p.channel?.readyState === 'open'); }
function sendSignal(type, description) {
  if (currentMode === 'hosted') {
    readyHostedPeers().forEach((p) => p.channel.send(JSON.stringify({ type, description })));
    // Voice state is tiny metadata, not audio. Mirror it through the existing
    // signalling route so the speaking indicator survives a delayed/closed
    // RTCDataChannel while all media remains P2P.
    if (type === 'voice-state' && hostedSocket?.connected) {
      for (const p of hostedPeers.values()) {
        if (!p.left) hostedSocket.emit('signal', { target: p.id, data: { voiceState: Boolean(description) } });
      }
    }
  } else if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type, description }));
}
function hasActiveCall() { return currentMode === 'hosted' ? readyHostedPeers().length > 0 : peer?.channel?.readyState === 'open'; }
function startPingMeasure() { clearInterval(latencyTimer); const sample = async () => { if (currentMode === 'hosted' && hostedSocket?.connected) hostedSocket.emit('latency-ping', { sentAt: Date.now() }); else if (peer?.pc?.connectionState === 'connected') { const stats = await peer.pc.getStats(); stats.forEach((report) => { if (report.type === 'candidate-pair' && report.state === 'succeeded' && Number.isFinite(report.currentRoundTripTime)) updatePingBadge(report.currentRoundTripTime * 1000); }); } }; sample(); latencyTimer = setInterval(sample, 2000); }

function bindChannel(channel) { peer.channel = channel; channel.onmessage = ({ data }) => receiveData(data); channel.onopen = () => { channel.send(JSON.stringify({ type: 'intro', name: myName, color: myColor, avatar: myAvatar, clientId, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local(), voiceChannel: activeVoiceChannel })); markConnected(); renderRoomChannels(); }; channel.onclose = () => { if (peer?.pc.connectionState !== 'closed') setStatus('Canal P2P fechado'); renderRoomChannels(); }; }
function videoTileId(id) { return id === 'manual' ? 'manual' : `peer-${String(id).replace(/[^a-z0-9_-]/gi, '')}`; }
function ensureVideoTile(id, label) { const tileId = videoTileId(id); let tile = videoGallery.querySelector(`[data-video-peer="${tileId}"]`); if (!tile) { tile = document.createElement('article'); tile.className = 'video-tile hidden'; tile.dataset.videoPeer = tileId; tile.innerHTML = '<video autoplay playsinline></video><span class="video-tile-label"></span>'; videoGallery.append(tile); } tile.querySelector('.video-tile-label').textContent = label || 'Live recebida'; return tile; }
function refreshVideoStage() { const visibleTiles = [...videoGallery.querySelectorAll('.video-tile')].filter((tile) => !tile.classList.contains('hidden')); const count = visibleTiles.length; videoGallery.className = `gallery-${Math.min(Math.max(count, 1), 6)}`; $('video-frame').classList.toggle('hidden', count === 0); $('identity-stage').classList.toggle('hidden', count > 0); }
function hideVideoTile(id) {
  const tile = videoGallery.querySelector(`[data-video-peer="${videoTileId(id)}"]`);
  if (!tile) return;
  const video = tile.querySelector('video');
  tile._revealToken = null;
  tile._revealStream = null;
  tile._frameGateToken = null;
  video.onloadedmetadata = null;
  video.oncanplay = null;
  video.srcObject = null;
  tile.classList.add('hidden');
  if (id !== 'manual') tile.remove();
  refreshVideoStage();
}
function displayRemoteVideo(stream, label, id = 'manual') {
  const track = stream?.getVideoTracks?.()[0];
  if (!track || track.readyState === 'ended') return false;
  const tile = ensureVideoTile(id, label);
  const video = tile.querySelector('video');
  const play = () => video.play().catch(() => {});

  // Recovery announcements may repeat while the same live is already opening.
  // Reassigning an identical MediaStream resets Chromium's video element and
  // was responsible for the brief flashes seen at the start of simultaneous
  // broadcasts. Keep the existing playback untouched in that case.
  const sameStream = video.srcObject === stream;
  if (sameStream && (!tile.classList.contains('hidden') || tile._revealStream === stream)) {
    play();
    return true;
  }

  if (tile._endedTrack !== track) {
    tile._endedTrack = track;
    track.addEventListener('ended', () => {
      if (tile._endedTrack === track) hideVideoTile(id);
    }, { once: true });
  }

  video.muted = true;
  video.playsInline = true;
  if (!sameStream) video.srcObject = stream;

  const revealToken = Symbol('remote-video-reveal');
  tile._revealToken = revealToken;
  tile._revealStream = stream;
  const reveal = () => {
    if (tile._revealToken !== revealToken || video.srcObject !== stream || track.readyState === 'ended') return;
    tile._revealToken = null;
    tile._revealStream = null;
    tile._frameGateToken = null;
    tile.classList.remove('hidden');
    refreshVideoStage();
  };
  const waitForStableFrames = () => {
    if (tile._revealToken !== revealToken || tile._frameGateToken === revealToken) return;
    tile._frameGateToken = revealToken;
    if (typeof video.requestVideoFrameCallback === 'function') {
      let decodedFrames = 0;
      const nextFrame = () => video.requestVideoFrameCallback(() => {
        if (tile._revealToken !== revealToken) return;
        decodedFrames += 1;
        if (decodedFrames >= 2) requestAnimationFrame(reveal);
        else nextFrame();
      });
      nextFrame();
    } else {
      const poll = () => {
        if (tile._revealToken !== revealToken) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) reveal();
        else setTimeout(poll, 50);
      };
      poll();
    }
  };

  video.onloadedmetadata = () => { play(); waitForStableFrames(); };
  video.oncanplay = () => { play(); waitForStableFrames(); };
  play();
  waitForStableFrames();
  // Defensive fallback for devices whose driver does not implement frame
  // callbacks correctly. It avoids leaving a valid live hidden indefinitely.
  setTimeout(reveal, 1400);
  return true;
}
function showManualVideo(label = 'Video recebido') { if (!peer) return; peer.videoLabel = label; displayRemoteVideo(peer.videoStream, label, 'manual'); }
function showHostedVideo(p, label = 'Video recebido') { if (!p) return; p.videoLabel = label; activeRemoteId = p.id; displayRemoteVideo(p.videoStream, `${p.name} · ${label}`, p.id); }
function makePeer(role = 'offerer') {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }], iceCandidatePoolSize: 2 });
  peer = { pc, role, channel: null, name: '', color: '', makingOffer: false, manualCandidates: [], videoStream: null, videoLabel: 'Video recebido' };
  // As in hosted rooms, only the offerer creates media m-lines. The answerer
  // attaches its tracks to those negotiated transceivers before createAnswer.
  if (role !== 'answerer') {
    const audioTrack = outgoingAudioTrack();
    if (audioTrack) pc.addTrack(audioTrack, new MediaStream([audioTrack]));
    pc.addTransceiver('video', { direction: 'sendrecv' });
  }
  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0] || new MediaStream([track]);
    if (track.kind === 'audio') {
      remoteAudio?.pause(); remoteAudio = new Audio(); remoteAudio.srcObject = stream; remoteAudio.autoplay = true; remoteAudio.muted = remoteMuted;
      if (audioOutputId && typeof remoteAudio.setSinkId === 'function') remoteAudio.setSinkId(audioOutputId).catch(() => {});
      remoteAudio.play().catch(() => {});
    }
    if (track.kind === 'video') {
      peer.videoStream = stream;
      const reveal = () => showManualVideo(peer.videoLabel);
      track.onunmute = reveal;
      if (track.readyState === 'live' && !track.muted) reveal();
    }
  };
  pc.ondatachannel = ({ channel }) => bindChannel(channel);
  pc.onicecandidate = ({ candidate }) => { if (candidate && !peer.remoteId) peer.manualCandidates.push(candidate.toJSON()); };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connecting') setStatus('Conectando P2P...');
    if (pc.connectionState === 'connected' && peer.channel?.readyState === 'open') markConnected();
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      if (pc.connectionState === 'disconnected') playNotification('disconnect');
      setStatus('Nao foi possivel conectar');
      if (peer?.name) showPeer(peer.name, 'Falha na conexao', false, peer.color);
    }
  };
  pc.onnegotiationneeded = async () => {
    if (!peer?.channel || peer.channel.readyState !== 'open' || peer.makingOffer) return;
    try { peer.makingOffer = true; await pc.setLocalDescription(await pc.createOffer()); sendSignal('signal-offer', pc.localDescription); }
    finally { peer.makingOffer = false; }
  };
  return pc;
}
function markConnected() { if (!peer?.name) return; showPeer(peer.name, 'Conectado · P2P direto', true, peer.color); setStatus('Conexao P2P direta ativa', true); $('pair-panel').classList.add('hidden'); startPingMeasure(); if (!peer.connectSoundPlayed) { peer.connectSoundPlayed = true; playNotification('connect'); } }
async function receiveData(raw) {
  try {
    const msg = JSON.parse(raw);
    if (msg.type === 'chat') {
      const channel = ROOM_CHANNELS.text.includes(msg.textChannel) ? msg.textChannel : 'geral';
      const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : [];
      const mentionClientIds = Array.isArray(msg.mentionClientIds) ? msg.mentionClientIds.map(String) : [];
      const mentioned = isMentionedForCurrentUser(mentions, mentionClientIds);
      const message = { id: String(msg.messageId || ''), text: String(msg.text || ''), name: msg.name || peer?.name || 'Participante', color: msg.color || peer?.color, avatar: msg.avatar || peer?.avatar, createdAt: Number(msg.createdAt) || Date.now(), mentions, mentionClientIds, mentioned, mine: false };
      if (!channelMessages.has(channel)) channelMessages.set(channel, []);
      channelMessages.get(channel).push(message);
      registerIncomingChannelActivity(channel, mentioned);
      if (channel === activeTextChannel) addMessage(message.text, message.name, false, message.color, message);
      playNotification(mentioned ? 'mention' : 'message');
      renderRoomChannels();
      return;
    }
    if (msg.type === 'chat-edit') return applyMessageEdit({ messageId: msg.messageId, text: msg.text, textChannel: msg.textChannel, editedAt: msg.editedAt, mentions: msg.mentions, mentionClientIds: msg.mentionClientIds });
    if (msg.type === 'manual-voice-channel') {
      const next = ROOM_CHANNELS.voice.includes(msg.voiceChannel) ? msg.voiceChannel : 'Geral';
      activeVoiceChannel = next;
      if (peer) peer.voiceChannel = next;
      renderRoomChannels(); saveProfile(); setStatus(`No canal ${next} · P2P direto`, true); $('connection-state').textContent = `Canal de voz · ${next}`;
      return;
    }
    if (msg.type === 'presence-state') { peer.status = normalizedPresenceStatus(msg.status); window.dispatchEvent(new CustomEvent('voiceup-presence-changed')); return; }
    if (msg.type === 'intro') { peer.name = msg.name; peer.color = msg.color || peer.color; peer.avatar = msg.avatar || peer.avatar; peer.clientId = msg.clientId || peer.clientId; peer.status = normalizedPresenceStatus(msg.status); peer.voiceChannel = ROOM_CHANNELS.voice.includes(msg.voiceChannel) ? msg.voiceChannel : activeVoiceChannel; renderRoomChannels(); return markConnected(); }
    if (msg.type === 'video-on') { showManualVideo(msg.description === 'screen' ? 'Tela compartilhada' : 'Video recebido'); return; }
    if (msg.type === 'video-off') { hideVideoTile('manual'); return; }
    if (msg.type === 'voice-state') return $('peer-other')?.classList.toggle('speaking', Boolean(msg.description));
    if (msg.type === 'signal-offer') { await peer.pc.setRemoteDescription(msg.description); await window.voiceupBindManualAnswerMedia?.(); await peer.pc.setLocalDescription(await peer.pc.createAnswer()); return sendSignal('signal-answer', peer.pc.localDescription); }
    if (msg.type === 'signal-answer') await peer.pc.setRemoteDescription(msg.description);
  } catch { toast('Erro ao atualizar a conexao direta.'); }
}
async function addManualCandidates(candidates) { for (const candidate of candidates || []) { try { await peer.pc.addIceCandidate(candidate); } catch { /* candidate may already be in SDP */ } } }

function videoSenders() { if (currentMode === 'hosted') return readyHostedPeers().map((p) => p.videoSender).filter(Boolean); return [peer?.pc?.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender].filter(Boolean); }
function audioSenders() { if (currentMode === 'hosted') return readyHostedPeers().map((p) => p.pc?.getSenders().find((sender) => sender.track?.kind === 'audio')).filter(Boolean); return [peer?.pc?.getSenders().find((sender) => sender.track?.kind === 'audio')].filter(Boolean); }
function outgoingAudioTrack() { return sharedAudioTrack || localStream?.getAudioTracks?.()[0] || null; }
function selectedFrameRate() { const value = Number($('fps-select')?.value || 30); return [15, 30, 60].includes(value) ? value : 30; }
function quality() { const h = Number($('quality-select').value) || 720; const fps = selectedFrameRate(); return { width: { ideal: Math.round(h * 16 / 9) }, height: { ideal: h }, frameRate: { ideal: fps, max: fps } }; }
function screenMotionPriority() { return preserveScreenSourceQuality || selectedFrameRate() >= 30; }
function videoContentHint(kind = 'camera') { return kind === 'screen' && !screenMotionPriority() ? 'detail' : 'motion'; }
function videoDegradationPreference(kind = 'camera') { return kind === 'screen' ? (screenMotionPriority() ? 'maintain-framerate' : 'maintain-resolution') : 'balanced'; }
function applyVideoContentHint(track, kind = 'camera') { if (!track) return; try { track.contentHint = videoContentHint(kind); } catch { /* Older capture drivers may not expose contentHint. */ } }
function videoBitrate(kind = 'camera') {
  const height = Number($('quality-select').value) || 720;
  const fps = selectedFrameRate();
  const cameraBase = { 360: 650000, 480: 1100000, 720: 2500000, 1080: 5000000, 1440: 9000000, 2160: 16000000 };
  // Fast-changing desktop content needs a higher ceiling than a camera. This
  // is only a maximum: WebRTC still lowers it automatically when the route or
  // the encoder cannot sustain it.
  const screenBase = { 360: 900000, 480: 1500000, 720: 3800000, 1080: 7500000, 1440: 12000000, 2160: 20000000 };
  const base = (kind === 'screen' ? screenBase : cameraBase)[height] || (kind === 'screen' ? 3800000 : 2500000);
  return Math.round(base * (fps === 60 ? 1.6 : fps === 15 ? .65 : 1));
}
function configureVideoSenderParameters(parameters, kind = 'camera', withDegradationPreference = true) {
  parameters.encodings ||= [{}];
  parameters.encodings[0] ||= {};
  if (kind === 'screen' && preserveScreenSourceQuality) {
    delete parameters.encodings[0].maxBitrate;
    delete parameters.encodings[0].maxFramerate;
  } else {
    parameters.encodings[0].maxBitrate = videoBitrate(kind);
    parameters.encodings[0].maxFramerate = selectedFrameRate();
  }
  if (withDegradationPreference) parameters.degradationPreference = videoDegradationPreference(kind);
  else delete parameters.degradationPreference;
  return parameters;
}
async function tuneVideoSender(sender, kind = 'camera') {
  if (!sender?.getParameters || !sender?.setParameters) return;
  // Chromium 43 supports degradationPreference. Keep a fallback so an older
  // participant/driver can still receive the bitrate and FPS limits.
  for (const withPreference of [true, false]) {
    try {
      const parameters = configureVideoSenderParameters(sender.getParameters(), kind, withPreference);
      await sender.setParameters(parameters);
      return;
    } catch { /* Retry once without the optional degradation preference. */ }
  }
}
async function publishVideo(track, kind) { const senders = videoSenders(); if (!senders.length) throw new Error('Canal de video indisponivel.'); applyVideoContentHint(track, kind); const results = await Promise.allSettled(senders.map(async (sender) => { await sender.replaceTrack(track); await tuneVideoSender(sender, kind); })); if (!results.some((result) => result.status === 'fulfilled')) throw new Error('Nenhum participante estava pronto para receber video.'); sendSignal('video-on', kind); }
async function stopSharedSystemAudio() { if (!sharedAudioTrack) return; sharedAudioTrack.stop(); sharedAudioTrack = null; await Promise.allSettled(audioSenders().map((sender) => sender.replaceTrack(outgoingAudioTrack()))); await sharedAudioContext?.close().catch(() => {}); sharedAudioContext = null; }
async function startSharedSystemAudio() { const systemTrack = screenStream?.getAudioTracks?.()[0]; if (!systemTrack) { if (shareSystemAudio) toast('O sistema nao disponibilizou audio para esta tela ou janela.'); return; } try { sharedAudioContext = new AudioContext(); const destination = sharedAudioContext.createMediaStreamDestination(); const micTrack = localStream?.getAudioTracks?.()[0]; if (micTrack) sharedAudioContext.createMediaStreamSource(new MediaStream([micTrack])).connect(destination); sharedAudioContext.createMediaStreamSource(new MediaStream([systemTrack])).connect(destination); sharedAudioTrack = destination.stream.getAudioTracks()[0]; await Promise.allSettled(audioSenders().map((sender) => sender.replaceTrack(sharedAudioTrack))); } catch { toast('Nao foi possivel misturar o audio do sistema com o microfone.'); }
}
async function replaceMicrophone() { try { const fresh = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(), video: false }); const newTrack = fresh.getAudioTracks()[0]; const oldTracks = localStream?.getAudioTracks?.() || []; if (localStream) oldTracks.forEach((track) => { localStream.removeTrack(track); track.stop(); }); else localStream = new MediaStream(); localStream.addTrack(newTrack); if (sharedAudioTrack) { await stopSharedSystemAudio(); await startSharedSystemAudio(); } else await Promise.allSettled(audioSenders().map((sender) => sender.replaceTrack(newTrack))); stopVoiceDetection(); startVoiceDetection(); $('connection-state').textContent = 'Microfone atualizado'; toast('Entrada de audio atualizada.'); } catch { toast('Nao foi possivel usar este microfone.'); } }
async function applyAudioOutput() { const media = [remoteAudio, ...[...hostedPeers.values()].map((peerItem) => peerItem.audio)].filter(Boolean); if (!media.length) return; await Promise.allSettled(media.filter((item) => typeof item.setSinkId === 'function').map((item) => item.setSinkId(audioOutputId || 'default'))); }
const waitForCameraRelease = (milliseconds = 240) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cameraRetryableErrors = new Set(['AbortError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'TrackStartError']);
function cameraConstraints(deviceId = cameraInputId, relaxed = false) {
  const constraints = relaxed ? {} : quality();
  if (deviceId) constraints.deviceId = { exact: deviceId };
  return constraints;
}
async function acquireCameraStream(deviceId = cameraInputId, allowDefaultFallback = true) {
  const attempts = [];
  const appendAttempt = (candidateDevice, relaxed) => {
    const key = `${candidateDevice || 'default'}:${relaxed ? 'native' : 'quality'}`;
    if (!attempts.some((attempt) => attempt.key === key)) attempts.push({ key, deviceId: candidateDevice, relaxed });
  };
  appendAttempt(deviceId, false);
  appendAttempt(deviceId, true);
  if (allowDefaultFallback && deviceId) { appendAttempt('', false); appendAttempt('', true); }
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(attempt.deviceId, attempt.relaxed), audio: false });
      const track = stream.getVideoTracks()[0];
      if (!track) { stream.getTracks().forEach((item) => item.stop()); throw new Error('Nenhuma faixa de vídeo foi criada pela câmera.'); }
      return { stream, track, usedDefault: Boolean(deviceId && !attempt.deviceId), relaxed: attempt.relaxed };
    } catch (error) {
      lastError = error;
      if (!cameraRetryableErrors.has(String(error?.name || '')) || index === attempts.length - 1) break;
      await waitForCameraRelease(index ? 300 : 220);
    }
  }
  throw lastError || new Error('A câmera não pôde ser iniciada.');
}
async function startCamera() {
  if (cameraCapturePromise) return cameraCapturePromise;
  cameraCapturePromise = (async () => {
    const button = $('cam-button');
    button.disabled = true; button.classList.add('busy');
    try {
      await window.voiceupStopCameraSettingsPreview?.();
      const previousTracks = cameraStream?.getTracks?.() || [];
      previousTracks.forEach((track) => track.stop());
      cameraStream = null;
      if (previousTracks.length) await waitForCameraRelease();
      const capture = await acquireCameraStream(cameraInputId, true);
      cameraStream = capture.stream;
      if (capture.usedDefault) {
        cameraInputId = '';
        if ($('camera-input-select')) $('camera-input-select').value = '';
        saveProfile();
        toast('A câmera salva não estava disponível; usando a câmera padrão.');
      } else if (capture.relaxed) toast('A câmera foi iniciada usando o formato nativo do dispositivo.');
      refreshLocalVideoPreview();
      await publishVideo(capture.track, 'camera');
      $('cam-button').classList.add('on');
      refreshVideoButtons();
    } catch (error) {
      cameraStream?.getTracks().forEach((track) => track.stop());
      cameraStream = null;
      refreshLocalVideoPreview();
      const errorName = String(error?.name || '');
      const selectedCameraName = String($('camera-input-select')?.selectedOptions?.[0]?.textContent || '').trim();
      const busyCameraAdvice = /iriun/i.test(selectedCameraName)
        ? 'A Iriun Webcam está instalada, mas não entregou vídeo. Abra o Iriun no PC e no celular, conecte os dois e tente novamente.'
        : 'A câmera está ocupada ou o driver não a liberou. Feche a câmera ou a prévia em outro Client/aplicativo e tente novamente.';
      const reason = errorName === 'NotAllowedError' || errorName === 'SecurityError'
        ? 'Permita o acesso em Configurações do Windows > Privacidade e segurança > Câmera.'
        : errorName === 'NotReadableError' || errorName === 'TrackStartError' || errorName === 'AbortError'
          ? busyCameraAdvice
          : errorName === 'NotFoundError' || errorName === 'OverconstrainedError'
            ? 'A câmera selecionada não está disponível ou não aceita o formato escolhido.'
            : error?.message || 'Verifique a câmera selecionada.';
      toast(`Não foi possível acessar a câmera. ${reason}`);
      refreshVideoButtons();
    } finally {
      button.disabled = false; button.classList.remove('busy');
    }
  })();
  try { return await cameraCapturePromise; }
  finally { cameraCapturePromise = null; }
}
async function stopVideo() { await Promise.allSettled(videoSenders().map((sender) => sender.replaceTrack(null))); await stopSharedSystemAudio(); cameraStream?.getTracks().forEach((t) => t.stop()); screenStream?.getTracks().forEach((t) => t.stop()); cameraStream = null; screenStream = null; $('local-video').srcObject = null; $('local-video').classList.remove('visible'); $('cam-button').classList.remove('on'); $('screen-button').classList.remove('share-on'); refreshVideoButtons(); sendSignal('video-off'); }
async function chooseScreenCapture() {
  if (!window.voiceupDesktop?.desktopSources) return { id: '', includeAudio: shareSystemAudio, preserveSourceQuality: preserveScreenSourceQuality };
  let sources;
  try { sources = await window.voiceupDesktop.desktopSources(); } catch { return null; }
  if (!sources.length) { toast('Nenhuma tela ou janela visível foi encontrada. Abra o aplicativo que deseja transmitir e tente novamente.'); return null; }
  const processAudioCapability = window.voiceupDesktop?.processAudioCapability
    ? await window.voiceupDesktop.processAudioCapability().catch(() => ({ available: false }))
    : { available: false };
  return new Promise((resolve) => {
    const picker = $('capture-picker'); const list = $('capture-source-list'); $('capture-start').textContent = screenStream ? 'Trocar transmissão' : 'Iniciar transmissão';
    const availableKinds = ['screen', 'window'].filter((kind) => sources.some((source) => source.kind === kind));
    let chosen = sources.find((source) => source.id === selectedScreenSource && source.available !== false)?.id || sources.find((source) => source.available !== false)?.id || '';
    let activeKind = sources.find((source) => source.id === chosen)?.kind || availableKinds[0] || 'screen';
    const sourceCard = (source, kind, icon) => { const available = source.available !== false; const protectedAudio = processAudioCapability.available === true; const summary = kind === 'screen' ? (protectedAudio ? 'Monitor completo · áudio do sistema sem a chamada' : 'Monitor completo · compartilhamento de vídeo') : (protectedAudio ? 'Janela e áudio isolados deste aplicativo' : 'Janela · compartilhamento de vídeo'); const preview = source.thumbnail ? `<img class="capture-source-preview" alt="Prévia de ${escapeHtml(source.name)}" src="${source.thumbnail}"/>` : `<div class="capture-source-preview capture-source-empty">${icon}<span>Sem prévia</span></div>`; return `<button type="button" class="capture-source${source.id === chosen ? ' selected' : ''}${available ? '' : ' unavailable'}" data-source="${escapeHtml(source.id)}"${available ? '' : ' disabled'}>${preview}<span class="capture-source-copy"><b>${icon}<span>${kind === 'screen' ? 'Tela' : 'Janela'}</span></b><span>${escapeHtml(source.name)}</span><small>${available ? summary : 'Janela indisponível para captura'}</small></span></button>`; };
    let includeAudio = shareSystemAudio;
    const captureText = (key, fallback) => globalThis.voiceupI18n?.t(key) || fallback;
    const refreshAudioOption = () => {
      const toggle = $('capture-audio-toggle'); const title = $('capture-audio-title'); const description = $('capture-audio-description');
      if (!toggle || !title || !description) return;
      const unavailable = processAudioCapability.available !== true;
      toggle.disabled = unavailable;
      toggle.checked = unavailable ? false : includeAudio;
      title.textContent = activeKind === 'window'
        ? captureText('capture.windowAudioTitle', 'Áudio somente deste aplicativo')
        : captureText('capture.screenAudioTitle', 'Áudio do sistema sem a chamada');
      description.textContent = unavailable
        ? captureText(activeKind === 'window' ? 'capture.windowAudioUnavailable' : 'capture.screenAudioUnavailable', 'A captura protegida de áudio não está disponível neste sistema; a live continuará sem áudio.')
        : activeKind === 'window'
          ? captureText('capture.windowAudioDescription', 'Captura o processo da janela escolhida e seus auxiliares, sem microfone nem outros programas.')
          : captureText('capture.screenAudioDescription', 'Captura os sons do computador, mas exclui o VoiceUP, as pessoas da call e o microfone.');
    };
    const render = () => {
      const group = sources.filter((source) => source.kind === activeKind);
      list.innerHTML = `<nav class="capture-tabs" role="tablist" aria-label="Tipo de compartilhamento">${availableKinds.map((kind) => { const icon = kind === 'screen' ? captureScreenIcon : captureWindowIcon; const label = kind === 'screen' ? 'Telas' : 'Janelas'; const count = sources.filter((source) => source.kind === kind).length; return `<button type="button" role="tab" aria-selected="${kind === activeKind}" class="capture-tab${kind === activeKind ? ' active' : ''}" data-capture-kind="${kind}">${icon}<span>${label}</span><small>${count}</small></button>`; }).join('')}</nav><section class="capture-session" role="tabpanel"><div class="capture-group-grid">${group.map((source) => sourceCard(source, activeKind, activeKind === 'screen' ? captureScreenIcon : captureWindowIcon)).join('')}</div></section>`;
      list.querySelectorAll('[data-capture-kind]').forEach((button) => button.addEventListener('click', () => {
        activeKind = button.dataset.captureKind;
        const selectedInTab = sources.find((source) => source.kind === activeKind && source.id === chosen && source.available !== false);
        if (!selectedInTab) chosen = sources.find((source) => source.kind === activeKind && source.available !== false)?.id || '';
        render();
      }));
      list.querySelectorAll('[data-source]:not(:disabled)').forEach((button) => button.addEventListener('click', () => { chosen = button.dataset.source; render(); }));
      $('capture-start').disabled = !chosen;
      refreshAudioOption();
    };
    const close = (value) => { picker.classList.add('hidden'); $('capture-cancel').onclick = null; $('capture-start').onclick = null; resolve(value); };
    $('capture-audio-toggle').checked = shareSystemAudio;
    $('capture-audio-toggle').onchange = () => { includeAudio = $('capture-audio-toggle').checked; };
    $('capture-source-quality-toggle').checked = preserveScreenSourceQuality;
    render();
    picker.classList.remove('hidden');
    $('capture-cancel').onclick = () => close(null);
    $('capture-start').onclick = () => close({ id: chosen, kind: activeKind, includeAudio: $('capture-audio-toggle').checked, preserveSourceQuality: $('capture-source-quality-toggle').checked });
  });
}
async function shareScreen() {
  const selection = await chooseScreenCapture();
  if (!selection) return;
  try {
    selectedScreenSource = selection.id;
    shareSystemAudio = selection.includeAudio;
    preserveScreenSourceQuality = selection.preserveSourceQuality === true;
    await stopSharedSystemAudio();
    screenStream?.getTracks().forEach((t) => { t.onended = null; t.stop(); });
    if (window.voiceupDesktop?.selectDesktopSource) await window.voiceupDesktop.selectDesktopSource(selection);
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: preserveScreenSourceQuality ? true : quality(), audio: selection.includeAudio });
    const track = screenStream.getVideoTracks()[0];
    applyVideoContentHint(track, 'screen');
    if (!preserveScreenSourceQuality && track?.applyConstraints) {
      try { await track.applyConstraints(quality()); } catch { /* The selected game/window can expose a lower native limit. */ }
    }
    track.onended = () => stopScreenShare();
    refreshLocalVideoPreview();
    await publishVideo(track, 'screen');
    if (shareSystemAudio) await startSharedSystemAudio();
    $('screen-button').classList.add('share-on');
    refreshVideoButtons();
    saveProfile();
  } catch (error) {
    screenStream?.getTracks().forEach((t) => t.stop());
    screenStream = null;
    refreshLocalVideoPreview();
    refreshVideoButtons();
    if (error.name !== 'NotAllowedError') toast(error.message || 'Nao foi possivel compartilhar a tela.');
  }
}

function currentVideoKind() { return screenStream ? 'screen' : cameraStream ? 'camera' : ''; }
async function syncHostedVideoForPeer(p) { const track = (screenStream || cameraStream)?.getVideoTracks?.()[0] || null; if (!p?.videoSender || !track) return; try { await p.videoSender.replaceTrack(track); if (p.channel?.readyState === 'open') p.channel.send(JSON.stringify({ type: 'video-on', description: currentVideoKind() })); } catch { /* the next peer negotiation retries the media track */ } }
function bindHostedChannel(p, channel) { p.channel = channel; channel.onmessage = ({ data }) => receiveHostedData(p, data); channel.onopen = () => { channel.send(JSON.stringify({ type: 'intro', name: myName, color: myColor, avatar: myAvatar, clientId, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local() })); syncHostedVideoForPeer(p); markHostedConnected(p); }; channel.onclose = () => { if (!p.left) { p.connected = false; renderHostedParticipants(); } }; }
function markHostedConnected(p) { p.connected = true; renderHostedParticipants(); showHostedStage(p, true); setStatus(`${readyHostedPeers().length + 1} pessoas conectadas · P2P`, true); $('pair-panel').classList.add('hidden'); startPingMeasure(); if (!p.connectSoundPlayed) { p.connectSoundPlayed = true; playNotification('connect'); } }
function attachHostedTrack(p, track, streams) { const stream = track.kind === 'video' ? new MediaStream([track]) : (streams[0] || new MediaStream([track])); if (track.kind === 'audio') { p.audio?.pause(); p.audio = new Audio(); p.audio.srcObject = stream; p.audio.autoplay = true; p.audio.muted = p.muted; if (audioOutputId && typeof p.audio.setSinkId === 'function') p.audio.setSinkId(audioOutputId).catch(() => {}); p.audio.play().catch(() => {}); } if (track.kind === 'video') { p.videoStream = stream; const reveal = () => showHostedVideo(p, p.videoLabel || 'Video recebido'); track.onunmute = reveal; track.onended = () => hideVideoTile(p.id); reveal(); setTimeout(reveal, 350); } }
function makeHostedConnection(p) { const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }], iceCandidatePoolSize: 2 }); p.pc = pc; const audioTrack = outgoingAudioTrack(); if (audioTrack) pc.addTrack(audioTrack, new MediaStream([audioTrack])); const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' }); p.videoSender = videoTransceiver.sender; const activeVideoTrack = (screenStream || cameraStream)?.getVideoTracks?.()[0]; if (activeVideoTrack) p.videoSender.replaceTrack(activeVideoTrack).catch(() => {}); pc.ontrack = ({ track, streams }) => attachHostedTrack(p, track, streams); pc.ondatachannel = ({ channel }) => bindHostedChannel(p, channel); pc.onicecandidate = ({ candidate }) => { if (candidate) hostedSocket?.emit('signal', { target: p.id, data: { candidate: candidate.toJSON() } }); }; pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected' && p.channel?.readyState === 'open') markHostedConnected(p); if (['failed', 'disconnected', 'closed'].includes(pc.connectionState) && !p.left && pc.connectionState !== 'closed') { p.connected = false; renderHostedParticipants(); } }; return pc; }
async function createHostedPeer(id, name, initiator, color, avatarPhoto = '') { if (hostedPeers.has(id)) return hostedPeers.get(id); const p = { id, name: name || 'Visitante', color: safeColor(color), avatar: safeAvatar(avatarPhoto), channel: null, pc: null, pendingCandidates: [], connected: false, muted: false, speaking: false, left: false, videoStream: null, videoLabel: 'Video recebido' }; hostedPeers.set(id, p); makeHostedConnection(p); renderHostedParticipants(); showHostedStage(p, false); if (initiator) { bindHostedChannel(p, p.pc.createDataChannel('voiceup-chat')); await p.pc.setLocalDescription(await p.pc.createOffer()); hostedSocket.emit('signal', { target: id, data: { description: p.pc.localDescription } }); } return p; }
async function receiveHostedSignal({ from, name, color, avatar, data }) { try { const p = hostedPeers.get(from) || await createHostedPeer(from, name, false, color, avatar); if (Object.prototype.hasOwnProperty.call(data || {}, 'voiceState')) { p.speaking = Boolean(data.voiceState); renderHostedParticipants(); return; } if (data.description) { await p.pc.setRemoteDescription(data.description); if (p.pendingCandidates.length) await Promise.all(p.pendingCandidates.splice(0).map((candidate) => p.pc.addIceCandidate(candidate))); if (data.description.type === 'offer') { await p.pc.setLocalDescription(await p.pc.createAnswer()); hostedSocket.emit('signal', { target: from, data: { description: p.pc.localDescription } }); } } if (data.candidate) { if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate); else p.pendingCandidates.push(data.candidate); } } catch { toast('Erro ao negociar uma conexao da sala.'); } }
async function receiveHostedData(p, raw) { try { const msg = JSON.parse(raw); if (msg.type === 'chat') { const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(String) : []; const mentionClientIds = Array.isArray(msg.mentionClientIds) ? msg.mentionClientIds.map(String) : []; const mentioned = isMentionedForCurrentUser(mentions, mentionClientIds); playNotification(mentioned ? 'mention' : 'message'); return addMessage(msg.text, msg.name || p.name, false, msg.color || p.color, { mentions, mentionClientIds, mentioned }); } if (msg.type === 'presence-state') { p.status = normalizedPresenceStatus(msg.status); rememberHostedMember({ id: p.id, name: p.name, color: p.color, avatar: p.avatar, status: p.status }, serverMembers.get(p.id)?.voiceChannel); window.dispatchEvent(new CustomEvent('voiceup-presence-changed')); return; } if (msg.type === 'intro') { p.name = msg.name || p.name; p.color = safeColor(msg.color || p.color); p.avatar = safeAvatar(msg.avatar || p.avatar); p.clientId = msg.clientId || p.clientId; p.status = normalizedPresenceStatus(msg.status); return markHostedConnected(p); } if (msg.type === 'video-on') { showHostedVideo(p, msg.description === 'screen' ? 'Tela compartilhada' : 'Video recebido'); return; } if (msg.type === 'video-off') { hideVideoTile(p.id); return; } if (msg.type === 'voice-state') { p.speaking = Boolean(msg.description); renderHostedParticipants(); } } catch { toast('Erro ao receber dados de um participante.'); } }

async function enterApp(mode = 'manual') { $('welcome').classList.add('hidden'); $('app').classList.remove('hidden'); setCallMode(mode); $('self-name').textContent = myName; paintAvatar($('self-avatar'), myName, myColor, myAvatar); paintAvatar($('stage-avatar'), myName, myColor, myAvatar); $('stage-name').textContent = 'Voce esta pronto'; $('participants').innerHTML = `<div id="self-participant" class="participant">${selfParticipant()}</div>`; await requestAudio(); }
async function makeOffer() { await enterApp('manual'); const pc = makePeer('offerer'); bindChannel(pc.createDataChannel('voiceup-chat')); setStatus('Coletando rotas P2P...'); await pc.setLocalDescription(await pc.createOffer()); const complete = await waitForIce(pc); $('pair-instruction').textContent = complete ? '1. Copie este convite e envie para a outra pessoa.' : '1. Convite preparado com as rotas disponiveis. Copie e envie para a outra pessoa.'; $('pair-code').value = pack({ type: 'offer', name: myName, color: myColor, avatar: myAvatar, description: pc.localDescription, candidates: peer.manualCandidates }); }
async function acceptOffer() { try { const data = unpack($('offer-input').value); if (data.type !== 'offer') throw new Error(); if (data.color === myColor) applyMyColor(AVATAR_COLORS.find((color) => color !== data.color)); await enterApp('manual'); const pc = makePeer('answerer'); peer.name = data.name; peer.color = data.color; peer.avatar = data.avatar; showPeer(data.name, 'Preparando resposta...', false, data.color); await pc.setRemoteDescription(data.description); await window.voiceupBindManualAnswerMedia?.(); await addManualCandidates(data.candidates); await pc.setLocalDescription(await pc.createAnswer()); await waitForIce(pc); $('pair-instruction').textContent = '1. Copie esta resposta e envie de volta para quem criou o convite.'; $('pair-code').value = pack({ type: 'answer', name: myName, color: myColor, avatar: myAvatar, description: pc.localDescription, candidates: peer.manualCandidates }); $('pair-panel').classList.add('answer-only'); } catch { toast('Convite invalido. Peca um novo codigo.'); } }
function loadSocketClient() {
  if (typeof window.io === 'function') return Promise.resolve(window.io);
  if (window.voiceupSocketClientReady) return window.voiceupSocketClientReady;
  return Promise.reject(new Error('O componente local de conexão não está disponível. Reinstale o VoiceUP pelo canal oficial.'));
}
function decodeHostInvite(value) {
  const input = String(value || '').trim();
  const version = input.startsWith('VU2:') ? 'VU2' : input.startsWith('VU1:') ? 'VU1' : '';
  if (!version) return { host: input };
  try {
    const invite = JSON.parse(atob(input.slice(4)));
    return typeof invite.host === 'string' ? { ...invite, host: invite.host } : { host: input };
  } catch { return { host: input }; }
}
function decodeHostCode(value) { return decodeHostInvite(value).host; }
function discardHostedPeer(id) { const p = hostedPeers.get(id); if (!p) return; p.left = true; p.audio?.pause(); p.pc?.close(); hostedPeers.delete(id); hideVideoTile(id); if (activeRemoteId === id) activeRemoteId = hostedPeers.keys().next().value || null; }
function removeHostedPeer(id, name) { discardHostedPeer(id); renderHostedParticipants(); if (activeRemoteId) showHostedStage(hostedPeers.get(activeRemoteId), true); else { paintAvatar($('stage-avatar'), myName, myColor, myAvatar); $('stage-name').textContent = 'Voce esta pronto'; $('stage-message').textContent = `${name || 'A outra pessoa'} saiu da chamada.`; } setStatus(hostedPeers.size ? `${hostedPeers.size + 1} pessoas na sala` : 'Aguardando participante', hostedPeers.size > 0); playNotification('disconnect'); }
function clearHostedVoice() { hostedPeers.forEach((p) => { p.left = true; p.audio?.pause(); p.pc?.close(); hideVideoTile(p.id); }); hostedPeers.clear(); activeRemoteId = null; renderHostedParticipants(); }
async function switchVoiceChannel(channel) {
  const next = ROOM_CHANNELS.voice.includes(channel) ? channel : 'Geral';
  if (currentMode === 'manual') {
    if (next === activeVoiceChannel) return;
    activeVoiceChannel = next;
    if (peer) peer.voiceChannel = next;
    if (peer?.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'manual-voice-channel', voiceChannel: next }));
    renderRoomChannels();
    saveProfile();
    setStatus(`No canal ${next} · P2P direto`, true);
    $('connection-state').textContent = `Canal de voz · ${next}`;
    toast(`Conversa movida para ${next}.`);
    return;
  }
  if (!hostedSocket?.connected || currentMode !== 'hosted' || next === activeVoiceChannel) return;
  if (!carryMediaOnChannelChange && (screenStream || cameraStream)) await stopVideo();
  clearHostedVoice();
  activeVoiceChannel = next;
  rememberCurrentMember();
  renderRoomChannels();
  saveProfile();
  setStatus(`Entrando no canal de voz ${next}...`);
  $('connection-state').textContent = 'Preparando microfone...';

  // Old clients create their offer with the microphone track already attached.
  // Give the first permission/device request a short head start so the beta can
  // answer with the same stream association instead of publishing a null sender
  // and replacing it only after the legacy negotiation has finished.
  const existingTrack = localStream?.getAudioTracks?.().find((track) => track.readyState === 'live');
  const audioPreparation = existingTrack ? Promise.resolve() : requestAudio();
  if (!existingTrack) await Promise.race([audioPreparation, new Promise((resolve) => setTimeout(resolve, 4000))]);
  const preparedTrack = outgoingAudioTrack();
  if (preparedTrack) preparedTrack.enabled = micEnabled;

  hostedSocket.emit('switch-voice-channel', { voiceChannel: next });
  void audioPreparation.then(() => {
    const track = outgoingAudioTrack();
    if (!track) return;
    track.enabled = micEnabled;
    for (const participant of hostedPeers.values()) participant.audioSender?.replaceTrack(track).catch(() => {});
  }).catch(() => {});
}
async function joinHostedRoom() { const hostUrl = decodeHostCode($('host-url').value.trim()).replace(/\/$/, ''); const roomId = $('host-room').value.trim(); const voiceChannel = $('voice-channel').value.trim() || 'Geral'; if (!myName) return toast('Informe seu nome antes de entrar.'); if (!/^https?:\/\//i.test(hostUrl)) return toast('Use o endereco completo ou o codigo mostrado pelo servidor host.'); if (!roomId) return toast('Informe um codigo de sala.'); try { await enterApp('hosted'); $('pair-panel').classList.add('hidden'); setStatus('Conectando ao servidor host...'); const ioFactory = await loadSocketClient(hostUrl); hostedSocket = ioFactory(hostUrl, { transports: ['websocket', 'polling'], timeout: 10000 }); hostedSocket.on('connect', () => hostedSocket.emit('join-room', { roomId, voiceChannel, name: myName, color: myColor, avatar: myAvatar })); hostedSocket.on('color-assigned', ({ color }) => applyMyColor(color)); hostedSocket.on('room-joined', ({ peers, voiceChannel: joinedChannel }) => { if (joinedChannel) $('voice-channel').value = joinedChannel; const occupied = new Set(peers.map((p) => p.color)); if (occupied.has(myColor)) applyMyColor(AVATAR_COLORS.find((color) => !occupied.has(color)) || myColor); peers.forEach((p) => createHostedPeer(p.id, p.name, true, p.color, p.avatar)); }); hostedSocket.on('peer-joined', ({ id, name, color, avatar }) => createHostedPeer(id, name, false, color, avatar)); hostedSocket.on('text-message', ({ from, text, textChannel, name, color }) => { if ((textChannel || 'geral').toLowerCase() !== ($('text-channel').value.trim() || 'geral').toLowerCase()) return; const mine = from === hostedSocket.id; if (!mine) playNotification('message'); addMessage(text, name, mine, color); }); hostedSocket.on('latency-pong', ({ sentAt }) => { const ping = Date.now() - Number(sentAt); if (Number.isFinite(ping) && ping >= 0 && ping < 10000) updatePingBadge(ping); }); hostedSocket.on('signal', receiveHostedSignal); hostedSocket.on('peer-left', ({ id, name }) => removeHostedPeer(id, name)); hostedSocket.on('app-error', (message) => toast(message)); hostedSocket.on('connect_error', () => { setStatus('Servidor host indisponivel'); toast('Nao foi possivel acessar esse servidor host.'); }); } catch (error) { toast(error.message || 'Nao foi possivel iniciar a conexao hospedada.'); } }

const safeHostedServerIcon = (value) => {
  const icon = String(value || '');
  if (/^data:image\/(?:png|jpeg|webp);base64,/i.test(icon) && icon.length <= 60000) return icon;
  return /^https?:\/\/[^\s<>"']{1,900}$/i.test(icon) ? icon : '';
};
function rememberHostedServerProfile(profile = {}) {
  const url = String($('host-url')?.value || '').trim().replace(/\/$/, '');
  const roomId = String($('host-room')?.value || '').trim();
  if (!url || !roomId) return;
  try {
    const key = 'voiceup-saved-servers-v1';
    const saved = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(saved)) return;
    const icon = safeHostedServerIcon(profile.icon);
    let changed = false;
    const next = saved.map((server) => {
      if (String(server?.url || '').replace(/\/$/, '') !== url || String(server?.roomId || '') !== roomId) return server;
      if (safeHostedServerIcon(server.icon) === icon) return server;
      changed = true;
      return { ...server, icon };
    });
    if (changed) {
      localStorage.setItem(key, JSON.stringify(next.slice(0, 12)));
      window.dispatchEvent(new CustomEvent('voiceup-saved-servers-changed'));
    }
  } catch { /* atalhos continuam funcionando mesmo sem armazenamento local */ }
}

async function joinHostedRoom() {
  const attempt = ++hostedJoinAttempt;
  const invite = decodeHostInvite($('host-url').value.trim());
  const hostUrl = String(invite.host || '').replace(/\/$/, '');
  if (invite.roomId) $('host-room').value = String(invite.roomId).slice(0, 48);
  const roomId = $('host-room').value.trim();
  const roomPassword = $('host-room-password')?.value || '';
  if (hostUrl && hostUrl !== $('host-url').value.trim()) { $('host-url').value = hostUrl; saveProfile(); }
  if (!myName) return toast('Informe seu nome antes de entrar.');
  if (!/^https?:\/\//i.test(hostUrl)) return toast('Use o endereco completo ou o codigo mostrado pelo servidor host.');
  if (!roomId) return toast('Informe um codigo de sala.');
  try {
    // A double click, a saved-server shortcut and a failover can all request a
    // join very close together.  Retire the previous signalling socket before
    // creating the next one, otherwise both sockets announce the same profile.
    const previousSocket = hostedSocket;
    if (previousSocket) {
      previousSocket.removeAllListeners?.();
      previousSocket.disconnect?.();
      if (hostedSocket === previousSocket) hostedSocket = null;
    }
    // Entering a server grants presence and text chat only. Voice/WebRTC starts
    // after the user explicitly clicks one of the visible voice channels.
    activeVoiceChannel = window.voiceupClusterResumeChannel || '';
    window.voiceupClusterResumeChannel = '';
    applyHostedRoomLayout({}, { reset: true });
    await enterApp('hosted');
    if (attempt !== hostedJoinAttempt) return null;
    $('pair-panel').classList.add('hidden');
    setStatus('Conectando ao servidor host...');
    const ioFactory = await loadSocketClient();
    if (attempt !== hostedJoinAttempt) return null;
    const socket = ioFactory(hostUrl, {
      transports: ['websocket', 'polling'], timeout: 10000,
      reconnection: true, reconnectionAttempts: Infinity,
      reconnectionDelay: 500, reconnectionDelayMax: 5000, randomizationFactor: 0.35
    });
    hostedSocket = socket;
    const isCurrentSocket = () => hostedSocket === socket && attempt === hostedJoinAttempt;
    let joinedSocketId = '';
    let legacyJoinTimer = null;
    const joinPayload = (extra = {}, protectedIdentity = false) => ({ roomId, roomPassword, voiceChannel: activeVoiceChannel || HOSTED_LOBBY_CHANNEL, name: myName, color: myColor, avatar: myAvatar, clientId, status: effectivePresenceStatus, platform: globalThis.voiceupPlatform.local(), capabilities: ['cluster-routing', 'webrtc-telemetry', 'advanced-channels', ...(protectedIdentity ? ['identity-proof-v1'] : [])], ...extra });
    const emitProtectedJoin = async (challenge) => {
      const socketId = socket.id;
      if (!isCurrentSocket() || !socket.connected || !challenge || joinedSocketId === socketId) return;
      try {
        const proof = await signIdentityChallenge(challenge, socketId, roomId);
        if (!isCurrentSocket() || !socket.connected || socket.id !== socketId || joinedSocketId === socketId) return;
        clearTimeout(legacyJoinTimer); joinedSocketId = socketId;
        socket.emit('join-room', joinPayload(proof, true));
      } catch {
        if (isCurrentSocket() && socket.connected && joinedSocketId !== socket.id) { joinedSocketId = socket.id; socket.emit('join-room', joinPayload()); }
      }
    };
    socket.on('identity-challenge', ({ challenge } = {}) => { void emitProtectedJoin(String(challenge || '')); });
    socket.on('connect', () => {
      if (!isCurrentSocket()) { socket.disconnect(); return; }
      const recoveredConnection = socket.__voiceupEverConnected === true;
      socket.__voiceupEverConnected = true;
      // A reconexão recebe um novo socket id. Feche somente as conexões WebRTC
      // ligadas aos ids antigos; a câmera, a live, o chat e o canal selecionado
      // continuam ativos e são renegociados assim que o servidor responde.
      if (recoveredConnection) {
        clearHostedVoice();
        serverMembers.clear();
      }
      rememberCurrentMember(); renderRoomChannels();
      // Servidores novos enviam um desafio criptográfico. O intervalo preserva
      // compatibilidade com ServerHosts antigos, que ainda aceitam a identidade
      // legada e não conhecem este evento.
      joinedSocketId = '';
      clearTimeout(legacyJoinTimer);
      legacyJoinTimer = setTimeout(() => {
        if (!isCurrentSocket() || !socket.connected || joinedSocketId === socket.id) return;
        joinedSocketId = socket.id; socket.emit('join-room', joinPayload());
      }, 1200);
      socket.emit('identity-challenge-request');
    });
    socket.on('color-assigned', ({ color }) => { if (isCurrentSocket()) applyMyColor(color); });
    socket.on('room-layout', (layout) => { if (isCurrentSocket()) applyHostedRoomLayout(layout); });
    socket.on('room-presence', (packet) => {
      if (!isCurrentSocket()) return;
      const { members } = packet;
      const present = new Set((members || []).map((member) => String(member?.id || '')).filter(Boolean));
      present.add(String(socket.id || ''));
      for (const id of serverMembers.keys()) if (!present.has(String(id))) serverMembers.delete(id);
      rememberCurrentMember(); (members || []).forEach((member) => rememberHostedMember(member));
      syncVoiceChannelActivity([...serverMembers.values()], packet);
      renderRoomChannels();
    });
    socket.on('server-profile', (profile) => { if (isCurrentSocket()) rememberHostedServerProfile(profile); });
    socket.on('room-joined', ({ peers = [], voiceChannel, serverProfile }) => {
      if (!isCurrentSocket()) return;
      rememberHostedServerProfile(serverProfile);
      activeVoiceChannel = ROOM_CHANNELS.voice.includes(voiceChannel) ? voiceChannel : '';
      rememberCurrentMember();
      (peers || []).forEach((peer) => rememberHostedMember(peer, activeVoiceChannel));
      renderRoomChannels();
      const occupied = new Set(peers.map((p) => p.color));
      if (occupied.has(myColor)) applyMyColor(AVATAR_COLORS.find((color) => !occupied.has(color)) || myColor);
      if (activeVoiceChannel) peers.forEach((p) => createHostedPeer(p.id, p.name, true, p.color, p.avatar));
    });
    socket.on('peer-joined', ({ id, name, color, avatar, status, clientId: peerClientId }) => { if (!isCurrentSocket()) return; rememberHostedMember({ id, name, color, avatar, status, clientId: peerClientId }, activeVoiceChannel); renderRoomChannels(); if (activeVoiceChannel && id !== socket.id) createHostedPeer(id, name, false, color, avatar); });
    socket.on('text-message', (packet) => { if (isCurrentSocket()) receiveHostedText(packet); });
    socket.on('message-edited', (packet) => { if (isCurrentSocket()) applyMessageEdit(packet); });
    socket.on('latency-pong', ({ sentAt }) => { if (!isCurrentSocket()) return; const ping = Date.now() - Number(sentAt); if (Number.isFinite(ping) && ping >= 0 && ping < 10000) updatePingBadge(ping); });
    socket.on('server-ping', ({ sentAt } = {}) => { if (isCurrentSocket()) socket.emit('server-pong', { sentAt }); });
    socket.on('signal', (packet) => { if (isCurrentSocket()) receiveHostedSignal(packet); });
    socket.on('peer-left', ({ id, name }) => { if (isCurrentSocket()) removeHostedPeer(id, name); });
    socket.on('room-password-required', ({ message } = {}) => {
      if (!isCurrentSocket()) return;
      hostedJoinAttempt += 1;
      clearHostedVoice(); serverMembers.clear(); socket.disconnect(); hostedSocket = null;
      $('app').classList.add('hidden'); $('welcome').classList.remove('hidden');
      $('host-room-password')?.focus(); toast(message || 'Informe a senha correta para entrar nesta sala privada.');
    });
    socket.on('identity-proof-required', ({ message } = {}) => { if (isCurrentSocket()) toast(message || 'Não foi possível confirmar a identidade deste perfil.'); });
    socket.on('session-replaced', ({ message } = {}) => {
      if (!isCurrentSocket()) return;
      socket.__voiceupSessionReplaced = true;
      if (socket.io?.opts) socket.io.opts.reconnection = false;
      clearHostedVoice(); serverMembers.clear(); hostedSocket = null;
      setStatus('Sessão aberta em outra janela');
      toast(message || 'Outra janela deste perfil assumiu a conexão.');
      socket.disconnect();
    });
    socket.on('app-error', (message) => { if (isCurrentSocket()) toast(message); });
    socket.on('server-action', ({ action, message }) => {
      if (!isCurrentSocket()) return;
      clearHostedVoice();
      if (typeof window.voiceupShowServerRemoval === 'function') {
        window.voiceupShowServerRemoval({ action, message });
        return;
      }
      setStatus(action === 'banned' ? 'Você foi banido deste servidor' : 'Você foi expulso desta sala');
      toast(message || 'Você foi removido pelo Server Host.');
    });
    socket.on('disconnect', (reason) => {
      if (!isCurrentSocket() || socket.__voiceupSessionReplaced || reason === 'io client disconnect') return;
      clearHostedVoice();
      setStatus('Reconectando ao servidor…');
    });
    socket.on('connect_error', () => { if (isCurrentSocket()) setStatus(socket.__voiceupEverConnected ? 'Reconectando ao servidor…' : 'Servidor host indisponível'); });
    return socket;
  } catch (error) { if (attempt === hostedJoinAttempt) toast(error.message || 'Nao foi possivel iniciar a conexao hospedada.'); return null; }
}

$('join-form').addEventListener('submit', (event) => { event.preventDefault(); myName = $('name-input').value.trim(); saveProfile(); if (myName) makeOffer(); });
$('accept-offer').addEventListener('click', () => { myName = $('name-input').value.trim(); saveProfile(); if (!myName) return toast('Informe seu nome antes de entrar.'); if (!$('offer-input').value.trim()) return toast('Cole o convite recebido primeiro.'); acceptOffer(); });
$('join-host').addEventListener('click', () => { myName = $('name-input').value.trim(); saveProfile(); joinHostedRoom(); });
let directPublicAccessAcknowledged = false;
async function confirmDirectPublicAccess() {
  const choice = await showVoiceupDialog({
    title: 'Expor esta sala à internet?',
    message: 'O VoiceUP tentará abrir uma porta no seu roteador usando UPnP ou NAT-PMP.',
    detail: 'Isso pode tornar a sala acessível fora da sua rede. Use uma senha forte, compartilhe o convite somente com pessoas de confiança e encerre a sala quando terminar.',
    tone: 'danger',
    icon: '!',
    actions: [
      { value: 'confirm', label: 'Entendi e quero ativar', style: 'danger' },
      { value: 'cancel', label: 'Manter somente na rede local', style: 'secondary' }
    ]
  });
  directPublicAccessAcknowledged = choice === 'confirm';
  $('direct-public-access').checked = directPublicAccessAcknowledged;
  return directPublicAccessAcknowledged;
}
$('direct-public-access').addEventListener('change', async (event) => {
  if (!event.target.checked) { directPublicAccessAcknowledged = false; return; }
  await confirmDirectPublicAccess();
});
function showDirectRoomResult(result) {
  if (!result?.active) { $('direct-room-result').classList.add('hidden'); $('stop-direct-room').classList.add('hidden'); return; }
  $('direct-room-code').value = result.shareCode || '';
  $('direct-room-result').classList.remove('hidden'); $('stop-direct-room').classList.remove('hidden');
  const access = result.access || {};
  const internet = access.scope === 'public';
  $('direct-room-diagnostic').textContent = internet
    ? `Internet: liberado automaticamente em ${access.publicUrl}. A voz, câmera e live continuam P2P.`
    : `${access.message || 'Acesso público não confirmado.'} Link disponível nesta rede: ${(result.networkUrls || []).join(', ') || result.localUrl || 'somente neste computador'}.`;
}
$('start-direct-room').addEventListener('click', async () => {
  myName = $('name-input').value.trim();
  if (!myName) return toast('Informe seu nome antes de criar a sala.');
  if (!window.voiceupDesktop?.startDirectRoom) return toast('A sala direta por link está disponível no aplicativo para computador.');
  if ($('direct-public-access').checked && !directPublicAccessAcknowledged && !(await confirmDirectPublicAccess())) return;
  const button = $('start-direct-room'); button.disabled = true; button.textContent = 'Criando e verificando o roteador…';
  try {
    const password = $('direct-room-password').value;
    const result = await window.voiceupDesktop.startDirectRoom({ name: $('direct-room-name').value || `${myName} · sala direta`, password, publicAccess: $('direct-public-access').checked });
    showDirectRoomResult(result);
    if (!result?.ok) return toast(result?.message || 'Não foi possível criar a sala direta.');
    $('host-url').value = result.localUrl;
    $('host-room').value = result.roomId;
    $('host-room-password').value = password;
    saveProfile();
    toast(result.message);
    await joinHostedRoom();
  } catch (error) { toast(error.message || 'Não foi possível criar a sala direta.'); }
  finally { button.disabled = false; button.textContent = 'Criar sala e gerar convite'; }
});
$('stop-direct-room').addEventListener('click', async () => {
  const result = await window.voiceupDesktop?.stopDirectRoom?.();
  showDirectRoomResult({ active: false });
  toast(result?.message || 'Sala direta encerrada.');
});
$('copy-direct-room').addEventListener('click', async () => {
  const code = $('direct-room-code').value;
  if (!code) return;
  try { await navigator.clipboard.writeText(code); toast('Convite direto copiado.'); }
  catch { $('direct-room-code').select(); document.execCommand('copy'); toast('Convite direto copiado.'); }
});
window.voiceupDesktop?.directRoomStatus?.().then(showDirectRoomResult).catch(() => {});
$('profile-photo').addEventListener('change', (event) => readProfilePhoto(event.target.files?.[0]));
$('name-input').addEventListener('change', () => { myName = $('name-input').value.trim(); saveProfile(); });
$('name-input').addEventListener('input', refreshWelcomeProfile);
$('host-url').addEventListener('change', saveProfile); $('host-room').addEventListener('change', saveProfile);
applyTheme(theme); refreshNotificationButton(); refreshMicButton(); refreshVideoButtons(); refreshDeviceControls(); $('notification-button').addEventListener('click', () => { notificationsEnabled = !notificationsEnabled; refreshNotificationButton(); saveProfile(); toast(notificationsEnabled ? 'Notificacoes sonoras ativadas.' : 'Notificacoes sonoras silenciadas.'); });
let pendingUpdate = null;
let automaticUpdatePrompted = '';
function refreshUpdateControls() {
  const button = $('check-update');
  if (pendingUpdate) {
    $('update-status').textContent = `A versao ${pendingUpdate.version} esta pronta para baixar.`;
    button.textContent = `Baixar ${pendingUpdate.version}`;
  } else {
    $('update-status').textContent = 'As atualizacoes sao consultadas automaticamente nas Releases oficiais do GitHub.';
    button.textContent = 'Procurar atualizacoes';
  }
}
async function downloadPendingClientUpdate() {
  if (!pendingUpdate) return;
  const button = $('check-update');
  button.disabled = true;
  $('update-status').textContent = 'Baixando o pacote...';
  const download = await window.voiceupDesktop.downloadUpdate();
  if (download.ok) $('update-status').textContent = 'Pacote aberto. Siga os passos para atualizar.';
  else { $('update-status').textContent = download.message; button.disabled = false; }
}
async function confirmPendingClientUpdate() {
  if (!pendingUpdate) return;
  const accepted = await showVoiceupDialog({ title: 'Atualizacao disponivel', message: `Baixar e abrir o pacote VoiceUP ${pendingUpdate.version}?`, detail: 'O pacote adequado ao seu sistema sera aberto quando o download terminar.', icon: '↓', actions: [{ value: 'confirm', label: 'Baixar', style: 'primary' }, { value: 'cancel', label: 'Agora nao' }] });
  if (accepted === 'confirm') await downloadPendingClientUpdate();
}
function promptAutomaticClientUpdate(result) {
  const waitUntilInterfaceIsFree = () => {
    if (!pendingUpdate || pendingUpdate.version !== result.version || automaticUpdatePrompted === result.version) return;
    const blockingModalOpen = ['release-notes-modal', 'settings-modal', 'capture-picker', 'voiceup-dialog']
      .some((id) => { const element = $(id); return element && !element.classList.contains('hidden'); });
    if (blockingModalOpen) { window.setTimeout(waitUntilInterfaceIsFree, 500); return; }
    automaticUpdatePrompted = result.version;
    void confirmPendingClientUpdate();
  };
  window.setTimeout(waitUntilInterfaceIsFree, 300);
}
async function checkClientUpdates({ automatic = false } = {}) {
  if (!window.voiceupDesktop) {
    if (!automatic) $('update-status').textContent = 'Este recurso funciona no aplicativo instalado para computador.';
    return null;
  }
  const button = $('check-update');
  button.disabled = true;
  if (!automatic) $('update-status').textContent = 'Consultando a ultima release no GitHub...';
  const result = await window.voiceupDesktop.checkForUpdates();
  button.disabled = false;
  if (!result.ok) {
    if (!automatic) $('update-status').textContent = result.message;
    return result;
  }
  if (result.packageUnavailable) {
    if (!automatic) $('update-status').textContent = result.message || 'A atualização publicada ainda não possui um pacote verificado para este sistema.';
    return result;
  }
  if (!result.available) {
    if (!automatic) $('update-status').textContent = `Voce ja esta na versao mais recente (${result.installedVersion}).`;
    return result;
  }
  pendingUpdate = result;
  refreshUpdateControls();
  if (automatic) promptAutomaticClientUpdate(result);
  return result;
}
$('settings-button').addEventListener('click', () => { $('theme-select').value = theme; $('noise-select').value = noiseMode; $('installed-version').textContent = `VoiceUP Cliente ${window.voiceupVersion || '1.0.25'}`; refreshUpdateControls(); refreshDeviceControls(); $('settings-modal').classList.remove('hidden'); });
$('check-update').addEventListener('click', async () => { if (pendingUpdate) await confirmPendingClientUpdate(); else await checkClientUpdates(); });
window.setTimeout(() => void checkClientUpdates({ automatic: true }), 1200);
$('settings-close').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
function updateHardwareAccelerationUi(restartRequired = hardwareAccelerationEnabled !== hardwareAccelerationAtStartup
  || (fullscreenGameCaptureCompatibilitySupported
    && fullscreenGameCaptureCompatibilityEnabled !== fullscreenGameCaptureCompatibilityAtStartup)) {
  const setting = $('hardware-acceleration-setting');
  if (!setting) return;
  const supported = Boolean(window.voiceupDesktop?.windowSettings);
  setting.classList.toggle('hidden', !supported);
  if (!supported) return;
  $('hardware-acceleration-toggle').checked = hardwareAccelerationEnabled;
  $('fullscreen-game-capture-setting')?.classList.toggle('hidden', !fullscreenGameCaptureCompatibilitySupported);
  if ($('fullscreen-game-capture-toggle')) $('fullscreen-game-capture-toggle').checked = fullscreenGameCaptureCompatibilityEnabled;
  $('hardware-acceleration-restart').classList.toggle('hidden', !restartRequired);
}
async function commitSettings({ close = false, notify = false } = {}) {
  const oldInput = audioInputId;
  const oldCameraInput = cameraInputId;
  const oldNoiseMode = noiseMode;
  applyTheme($('theme-select').value);
  noiseMode = $('noise-select').value;
  audioInputId = $('audio-input-select').value;
  audioOutputId = $('audio-output-select').value;
  cameraInputId = $('camera-input-select')?.value || '';
  selectedScreenSource = $('screen-source-select').value;
  shareSystemAudio = $('screen-audio-toggle').checked;
  language = $('language-select').value;
  carryMediaOnChannelChange = $('carry-media-toggle').checked;
  const previouslyLoadedExternalMedia = externalMediaAutoLoad;
  externalMediaAutoLoad = $('external-media-toggle').checked;
  clientCloseBehavior = $('client-close-behavior').value;
  hardwareAccelerationEnabled = $('hardware-acceleration-toggle')?.checked !== false;
  fullscreenGameCaptureCompatibilityEnabled = $('fullscreen-game-capture-toggle')?.checked !== false;
  applyLanguage(language);
  saveProfile();
  await applyAudioOutput();
  if (!$('app').classList.contains('hidden') && (oldInput !== audioInputId || oldNoiseMode !== noiseMode)) await replaceMicrophone();
  if (cameraStream && oldCameraInput !== cameraInputId) await startCamera();
  const savedWindowSettings = await window.voiceupDesktop?.saveWindowSettings?.({ closeBehavior: clientCloseBehavior, hardwareAcceleration: hardwareAccelerationEnabled, fullscreenGameCaptureCompatibility: fullscreenGameCaptureCompatibilityEnabled });
  if (savedWindowSettings) {
    clientCloseBehavior = savedWindowSettings.closeBehavior || clientCloseBehavior;
    $('client-close-behavior').value = clientCloseBehavior;
    hardwareAccelerationEnabled = savedWindowSettings.hardwareAcceleration !== false;
    hardwareAccelerationAtStartup = savedWindowSettings.hardwareAccelerationActive !== false;
    fullscreenGameCaptureCompatibilityEnabled = savedWindowSettings.fullscreenGameCaptureCompatibility !== false;
    fullscreenGameCaptureCompatibilityAtStartup = savedWindowSettings.fullscreenGameCaptureCompatibilityActive === true;
    fullscreenGameCaptureCompatibilitySupported = savedWindowSettings.fullscreenGameCaptureCompatibilitySupported === true;
    updateHardwareAccelerationUi(savedWindowSettings.restartRequired === true);
  }
  if (!previouslyLoadedExternalMedia && externalMediaAutoLoad) {
    document.querySelectorAll('.message-external-load').forEach((button) => button.click());
    window.dispatchEvent(new CustomEvent('voiceup-saved-servers-changed'));
  }
  if (close) $('settings-modal').classList.add('hidden');
  if (notify) toast('Configuracoes salvas neste computador.');
}
window.voiceupCommitSettings = commitSettings;
$('settings-save').addEventListener('click', () => void commitSettings({ close: false, notify: false }));
$('hardware-acceleration-toggle')?.addEventListener('change', () => void commitSettings({ close: false, notify: false }));
$('fullscreen-game-capture-toggle')?.addEventListener('change', () => void commitSettings({ close: false, notify: false }));
$('refresh-devices').addEventListener('click', refreshDeviceControls);
applyLanguage(language);
window.voiceupDesktop?.windowSettings?.().then((settings) => {
  clientCloseBehavior = settings.closeBehavior || clientCloseBehavior;
  hardwareAccelerationEnabled = settings.hardwareAcceleration !== false;
  hardwareAccelerationAtStartup = settings.hardwareAccelerationActive !== false;
  fullscreenGameCaptureCompatibilityEnabled = settings.fullscreenGameCaptureCompatibility !== false;
  fullscreenGameCaptureCompatibilityAtStartup = settings.fullscreenGameCaptureCompatibilityActive === true;
  fullscreenGameCaptureCompatibilitySupported = settings.fullscreenGameCaptureCompatibilitySupported === true;
  $('client-close-behavior').value = clientCloseBehavior;
  updateHardwareAccelerationUi(settings.restartRequired === true);
  saveProfile();
}).catch(() => {});
updateHardwareAccelerationUi(false);
$('hardware-acceleration-restart-button')?.addEventListener('click', async () => {
  const choice = await showVoiceupDialog({ title: 'Reiniciar o VoiceUP?', message: 'As alterações gráficas e de captura serão aplicadas na próxima abertura.', detail: 'Chamadas e transmissões ativas serão encerradas. Suas configurações já estão salvas.', icon: '↻', actions: [{ value: 'confirm', label: 'Reiniciar agora', style: 'primary' }, { value: 'cancel', label: 'Reiniciar depois' }] });
  if (choice === 'confirm') await window.voiceupDesktop?.restartApplication?.();
});
$('voiceup-dialog').addEventListener('click', (event) => { if (event.target === $('voiceup-dialog')) closeVoiceupDialog('cancel'); });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('voiceup-dialog').classList.contains('hidden')) closeVoiceupDialog('cancel'); });
window.voiceupDesktop?.onCloseRequest?.(async () => {
  const choice = await showVoiceupDialog({ title: 'Fechar o VoiceUP?', message: 'Você pode manter o VoiceUP aberto na bandeja do sistema.', detail: 'Assim você pode reabrir o aplicativo rapidamente pelo ícone do aplicativo.', icon: '×', actions: [{ value: 'tray', label: 'Manter aberto', style: 'primary' }, { value: 'quit', label: 'Encerrar', style: 'danger' }, { value: 'cancel', label: 'Cancelar' }] });
  await window.voiceupDesktop.respondClose(choice);
});
$('settings-button').addEventListener('click', () => { $('language-select').value = language; $('carry-media-toggle').checked = carryMediaOnChannelChange; $('external-media-toggle').checked = externalMediaAutoLoad; $('client-close-behavior').value = clientCloseBehavior; updateHardwareAccelerationUi(); $('installed-version').textContent = `VoiceUP Cliente ${window.voiceupVersion || '1.0.25'}`; });
$('copy-button').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('pair-code').value); } catch { $('pair-code').select(); document.execCommand('copy'); } toast('Codigo copiado. Envie para a outra pessoa.'); });
$('complete-pair').addEventListener('click', async () => { try { const data = unpack($('answer-input').value); if (data.type !== 'answer') throw new Error(); peer.name = data.name; peer.color = data.color; peer.avatar = data.avatar; showPeer(data.name, 'Conectando...', false, data.color); await peer.pc.setRemoteDescription(data.description); await addManualCandidates(data.candidates); $('pair-instruction').textContent = 'Conectando diretamente...'; } catch { toast('Resposta invalida. Cole o codigo recebido.'); } });
$('mic-button').addEventListener('click', () => { micEnabled = !micEnabled; localStream?.getAudioTracks().forEach((track) => track.enabled = micEnabled); $('mic-button').classList.toggle('muted', !micEnabled); refreshMicButton(); $('connection-state').textContent = micEnabled ? 'Microfone ativo' : 'Microfone desligado'; evaluatePresenceIdle(); });
$('cam-button').addEventListener('click', () => cameraStream ? stopCamera() : startCamera()); $('screen-button').addEventListener('click', async () => { if (!screenStream) return shareScreen(); const choice = await showVoiceupDialog({ title: 'Transmissão de tela ativa', message: 'Você quer trocar a tela ou encerrar a transmissão?', detail: 'Ao trocar, a live continua ativa para os participantes.', icon: '↻', actions: [{ value: 'switch', label: 'Trocar tela ou janela', style: 'primary' }, { value: 'stop', label: 'Encerrar transmissão', style: 'danger' }, { value: 'cancel', label: 'Cancelar' }] }); if (choice === 'switch') await shareScreen(); else if (choice === 'stop') await stopScreenShare(); });
$('fullscreen-button').addEventListener('click', async () => { const next = !document.body.classList.contains('video-theater'); document.body.classList.toggle('video-theater', next); try { if (window.voiceupDesktop?.setVideoFullscreen) await window.voiceupDesktop.setVideoFullscreen(next); else if (next) await $('video-frame').requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); } catch { toast('Modo tela cheia ativado dentro do aplicativo.'); } $('fullscreen-button').title = next ? 'Sair da tela cheia' : 'Abrir live em tela cheia'; });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && document.body.classList.contains('video-theater')) { document.body.classList.remove('video-theater'); window.voiceupDesktop?.setVideoFullscreen(false); $('fullscreen-button').title = 'Abrir live em tela cheia'; } });
async function refreshActiveMediaQuality() { saveProfile(); if (cameraStream) await startCamera(); if (screenStream) { const track = screenStream.getVideoTracks()[0]; applyVideoContentHint(track, 'screen'); if (!preserveScreenSourceQuality) { try { await track.applyConstraints(quality()); } catch { /* capture source can cap resolution or FPS */ } } await publishVideo(track, 'screen').catch(() => {}); } }
$('quality-select').addEventListener('change', () => void refreshActiveMediaQuality()); $('fps-select').addEventListener('change', () => void refreshActiveMediaQuality());
$('message-form').addEventListener('submit', (event) => { event.preventDefault(); const text = $('message-input').value.trim(); if (!text) return; const id = messageId(); const createdAt = Date.now(); const mentions = mentionIdsForText(text); if (currentMode === 'hosted') { if (!hostedSocket?.connected) return toast('Conecte-se ao servidor antes de enviar mensagens.'); hostedSocket.emit('text-message', { text, textChannel: activeTextChannel, messageId: id, createdAt, mentions }); } else { if (!hasActiveCall()) return toast('A conexao ainda esta sendo estabelecida.'); const message = { id, text, name: myName, color: myColor, avatar: myAvatar, createdAt, mentions, mentionClientIds: [], mine: true }; if (!channelMessages.has(activeTextChannel)) channelMessages.set(activeTextChannel, []); channelMessages.get(activeTextChannel).push(message); peer.channel.send(JSON.stringify({ type: 'chat', text, name: myName, color: myColor, avatar: myAvatar, textChannel: activeTextChannel, messageId: id, createdAt, mentions })); addMessage(text, myName, true, myColor, message); playNotification('message'); } $('message-input').value = ''; });
$('leave-button').addEventListener('click', () => { playNotification('disconnect'); clearInterval(latencyTimer); localStream?.getTracks().forEach((t) => t.stop()); cameraStream?.getTracks().forEach((t) => t.stop()); screenStream?.getTracks().forEach((t) => t.stop()); peer?.pc.close(); hostedPeers.forEach((p) => p.pc?.close()); hostedSocket?.disconnect(); location.reload(); });

for (const eventName of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(eventName, notePresenceActivity, { passive: true });
let lastPresencePointerSample = 0;
window.addEventListener('pointermove', () => { if (Date.now() - lastPresencePointerSample > 3000) { lastPresencePointerSample = Date.now(); notePresenceActivity(); } }, { passive: true });
window.addEventListener('focus', notePresenceActivity);
document.addEventListener('visibilitychange', () => { if (!document.hidden) notePresenceActivity(); });
setInterval(evaluatePresenceIdle, 15000);
window.voiceupSetPresenceStatus = setPresenceStatus;

// A prévia do perfil depende dos auxiliares de avatar declarados acima. Mantê-la
// aqui impede que a tela inicial interrompa o carregamento antes de registrar
// os botões de entrar no servidor e de convite P2P.
refreshWelcomeProfile();
