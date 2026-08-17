(() => {
  'use strict';

  const installedVersion = String(window.voiceupVersion || '1.1.1');
  const version = installedVersion;
  const seenKey = 'voiceup-release-notes-seen-v1';
  const locale = () => ['pt-BR', 'en-US', 'es-ES', 'fr-FR'].includes(document.documentElement.lang) ? document.documentElement.lang : 'pt-BR';
  const copy = {
    'pt-BR': {
      eyebrow: 'VERSÃO {version}', title: 'Novidades desta versão', subtitle: 'Esta atualização reúne a nova experiência visual, novos recursos e as correções aprovadas para esta versão.', close: 'Entendi', reopen: 'Novidades da {version}', auto: 'Salvamento automático',
      notes: ['Visual — Interface completamente reorganizada, mais limpa, responsiva, suave e consistente em todos os temas.', 'Visual — Novos temas escuros e claros coloridos, aparência configurável, modais próprios e barras modernas.', 'Client — Canais de voz e texto, lobby fora da call, membros do servidor, perfis compartilhados e vários servidores salvos.', 'Chamadas — Áudio, câmera e múltiplas lives com tela cheia, troca de fonte, até 4K/60 FPS e qualidade original.', 'Transmissão — Prévia livre pela janela: arraste pelo centro para mover e pelas bordas ou cantos para redimensionar.', 'Áudio — Dispositivos, volumes globais e individuais, supressão de ruído, teste do microfone e aura de fala temática.', 'Chat — Estilos clássico e moderno, avatar, data e hora, edição, indicador de digitação e mensagens não lidas.', 'Chat — Links temáticos, imagens externas, YouTube, metadados, emojis e GIFs pesquisáveis e formatação de texto.', 'Preferências — Idiomas, autosave, fechamento pela bandeja e configurações persistentes por usuário.', 'ServerHost — Painel visual totalmente redesenhado com navegação lateral, temas, layout responsivo e modais próprios.', 'ServerHost — Dashboard com CPU, memória, ping, participantes, gráficos, logs e estado do servidor em tempo real.', 'ServerHost — Expulsão, banimento e remoção de ban, reinício, desligamento, bandeja e avisos correspondentes no Client.', 'Plugins — Gestão visual, ativação por chave, configurações, avatares e armazenamento para Dados, Music Bot e XP.', 'Plugins — API beta documentada, tipos para editor, exemplo de desenvolvimento e catálogo público com downloads.', 'Cloud e site — Página oficial, status, downloads, plugins, privacidade, termos e servidor Global pré-configurado.', 'Distribuição — Atualizador, instaladores Client/ServerHost, pacote Microsoft Store e compatibilidade progressiva.']
    },
    'en-US': {
      eyebrow: 'VERSION {version}', title: 'What is new in this version', subtitle: 'This update combines the new visual experience, new features and the fixes approved for this release.', close: 'Got it', reopen: 'What is new in {version}', auto: 'Autosave on',
      notes: ['Visual — A completely reorganized, cleaner, responsive and consistent interface across every theme.', 'Visual — New colorful dark/light themes, appearance controls, custom modals and modern scrollbars.', 'Client — Voice/text channels, out-of-call lobby, server members, shared profiles and multiple saved servers.', 'Calls — Audio, camera and multiple streams with fullscreen, source switching, up to 4K/60 FPS and source quality.', 'Streaming — Move the preview from its center and resize it directly from edges or corners.', 'Audio — Devices, global/per-user volume, noise suppression, microphone test and themed speaking aura.', 'Chat — Classic/modern styles, avatars, timestamps, editing, typing and unread indicators.', 'Chat — Themed links, external images, YouTube, metadata, searchable emojis/GIFs and text formatting.', 'Preferences — Languages, autosave, tray behavior and persistent user settings.', 'ServerHost — Fully redesigned visual dashboard with side navigation, themes, responsive layout and custom modals.', 'ServerHost — Live CPU, memory, ping, participant, chart, log and server-status monitoring.', 'ServerHost — Kick, ban/unban, restart, shutdown, tray support and matching Client notices.', 'Plugins — Visual management, toggles, settings, avatars and storage for Dice, Music Bot and XP.', 'Plugins — Documented beta API, editor types, developer sample and public downloads.', 'Cloud and website — Official page, status, downloads, plugins, privacy, terms and preconfigured Global server.', 'Distribution — Updater, Client/ServerHost installers, Microsoft Store package and progressive compatibility.']
    },
    'es-ES': {
      eyebrow: 'VERSIÓN {version}', title: 'Novedades de esta versión', subtitle: 'Esta actualización reúne la nueva experiencia visual, nuevas funciones y las correcciones aprobadas para esta versión.', close: 'Entendido', reopen: 'Novedades de {version}', auto: 'Guardado automático',
      notes: ['Visual — Interfaz completamente reorganizada, limpia, responsiva y consistente con todos los temas.', 'Visual — Nuevos temas coloridos, apariencia configurable, modales propios y barras modernas.', 'Client — Canales, lobby fuera de llamada, miembros, perfiles y varios servidores guardados.', 'Llamadas — Audio, cámara y transmisiones múltiples, pantalla completa, hasta 4K/60 FPS y calidad original.', 'Transmisión — La vista previa se mueve desde el centro y cambia de tamaño desde bordes o esquinas.', 'Audio — Dispositivos, volúmenes, supresión, prueba de micrófono y aura temática.', 'Chat — Estilos clásico/moderno, avatar, fecha, edición, escritura, no leídos, enlaces, GIFs y formato.', 'Preferencias — Idiomas, guardado automático, bandeja y ajustes persistentes.', 'ServerHost — Panel visual rediseñado con navegación, temas, diseño responsivo y modales propios.', 'ServerHost — CPU, memoria, ping, participantes, gráficos, logs y estado en tiempo real.', 'ServerHost — Expulsión, baneos, reinicio, apagado, bandeja y avisos en el Client.', 'Plugins — Gestión, activación, ajustes, avatares y almacenamiento para Dados, Music Bot y XP.', 'Plugins — API beta documentada, tipos, ejemplo y catálogo público.', 'Cloud y sitio — Página oficial, estado, descargas, plugins, privacidad y términos.', 'Distribución — Actualizador, instaladores, Microsoft Store y compatibilidad progresiva.']
    },
    'fr-FR': {
      eyebrow: 'VERSION {version}', title: 'Nouveautés de cette version', subtitle: 'Cette mise à jour réunit la nouvelle expérience visuelle, les nouvelles fonctions et les correctifs approuvés pour cette version.', close: 'Compris', reopen: 'Nouveautés de {version}', auto: 'Enregistrement auto',
      notes: ['Visuel — Interface entièrement réorganisée, propre, responsive et cohérente avec tous les thèmes.', 'Visuel — Nouveaux thèmes colorés, apparence réglable, fenêtres personnalisées et barres modernes.', 'Client — Canaux, lobby hors appel, membres, profils et plusieurs serveurs enregistrés.', 'Appels — Audio, caméra, plusieurs partages, plein écran, jusqu’en 4K/60 FPS et qualité source.', 'Partage — Déplacement depuis le centre et redimensionnement depuis les bords ou les coins.', 'Audio — Périphériques, volumes, suppression du bruit, test micro et aura thématique.', 'Chat — Styles classique/moderne, avatar, date, édition, saisie, non-lus, liens, GIF et formatage.', 'Préférences — Langues, sauvegarde automatique, tray et réglages persistants.', 'ServerHost — Tableau de bord visuel redessiné avec navigation, thèmes, responsive et fenêtres propres.', 'ServerHost — CPU, mémoire, ping, participants, graphiques, logs et état en temps réel.', 'ServerHost — Expulsion, bannissement, redémarrage, arrêt, tray et alertes Client.', 'Plugins — Gestion, activation, options, avatars et stockage pour Dés, Music Bot et XP.', 'Plugins — API bêta documentée, types, exemple et catalogue public.', 'Cloud et site — Page officielle, statut, téléchargements, plugins, confidentialité et conditions.', 'Distribution — Mise à jour, installateurs, Microsoft Store et compatibilité progressive.']
    }
  };
  copy['pt-BR'].notes.push('Atualizações — Client e ServerHost agora procuram novas versões automaticamente ao abrir, sem interromper o uso quando já estão atualizados.');
  copy['en-US'].notes.push('Updates — Client and ServerHost now check for new versions automatically at startup without interrupting use when already current.');
  copy['es-ES'].notes.push('Actualizaciones — Client y ServerHost ahora buscan nuevas versiones automáticamente al iniciar sin interrumpir el uso cuando ya están actualizados.');
  copy['fr-FR'].notes.push('Mises à jour — Client et ServerHost recherchent maintenant automatiquement une nouvelle version au démarrage, sans interrompre l’utilisation.');
  copy['pt-BR'].notes.push('Presença — Status Online, Ausente e Não perturbe, ausência automática após 10 minutos inativo com microfone mutado e compatibilidade online para Clients antigos.');
  copy['pt-BR'].notes.push('Menções — Digite @ para ver até três membros e destacar a mensagem somente para quem foi marcado; Não perturbe também silencia os sons.');
  copy['en-US'].notes.push('Presence — Online, Idle and Do Not Disturb, automatic idle after 10 inactive minutes while muted, and online fallback for older Clients.');
  copy['en-US'].notes.push('Mentions — Type @ for up to three member suggestions and highlight only for mentioned recipients; DND also silences sounds.');
  copy['es-ES'].notes.push('Presencia — Estados En línea, Ausente y No molestar, ausencia automática tras 10 minutos inactivo y compatibilidad con Clients antiguos.');
  copy['es-ES'].notes.push('Menciones — Escribe @ para ver hasta tres miembros y resaltar el mensaje solo para las personas mencionadas; No molestar silencia los sonidos.');
  copy['fr-FR'].notes.push('Présence — États En ligne, Absent et Ne pas déranger, absence automatique après 10 minutes inactif et compatibilité avec les anciens Clients.');
  copy['fr-FR'].notes.push('Mentions — Tapez @ pour suggérer trois membres maximum et surligner uniquement chez les destinataires mentionnés ; le mode DND coupe les sons.');
  copy['pt-BR'].notes.push('Compatibilidade — O Client atual volta a usar a faixa original do microfone em 100% e a prepara antes da negociação, corrigindo áudio atual → Client antigo.');
  copy['pt-BR'].notes.push('Chat central — A área ocupa toda a lateral disponível e o botão de edição permanece junto ao conteúdo da mensagem.');
  copy['en-US'].notes.push('Compatibility — At 100% the current Client publishes the original microphone track and prepares it before negotiation, fixing current → legacy Client audio.');
  copy['en-US'].notes.push('Central chat — The composer fills the available edge and the edit action stays next to the message content.');
  copy['es-ES'].notes.push('Compatibilidad — Al 100% el Client publica la pista original del micrófono y la prepara antes de negociar, corrigiendo el audio hacia Clients antiguos.');
  copy['es-ES'].notes.push('Chat central — El compositor ocupa todo el lateral y el botón de edición queda junto al contenido.');
  copy['fr-FR'].notes.push('Compatibilité — À 100 %, la bêta publie la piste micro originale avant la négociation, corrigeant l’audio vers les anciens Clients.');
  copy['fr-FR'].notes.push('Chat central — La zone de saisie remplit tout le bord disponible et le bouton de modification reste près du message.');
  copy['pt-BR'].notes.push('Presença — O rodapé da conta foi reorganizado e agora mostra claramente Online, Ausente ou Não perturbe; a lista de membros também combina o status com a call atual.');
  copy['en-US'].notes.push('Presence — The account footer now clearly shows Online, Idle or Do Not Disturb; the member list also combines presence with the current voice channel.');
  copy['es-ES'].notes.push('Presencia — El pie de la cuenta ahora muestra claramente En línea, Ausente o No molestar; la lista de miembros también indica el canal de voz actual.');
  copy['fr-FR'].notes.push('Présence — Le pied du compte affiche clairement En ligne, Absent ou Ne pas déranger ; la liste des membres indique aussi le canal vocal actuel.');
  copy['pt-BR'].notes.push('Menções — As sugestões de @ agora exibem corretamente o avatar, o nick completo e a localização do membro nos chats central e lateral.');
  copy['en-US'].notes.push('Mentions — @ suggestions now correctly show the member avatar, full nickname and location in both central and side chats.');
  copy['es-ES'].notes.push('Menciones — Las sugerencias de @ ahora muestran correctamente el avatar, el apodo completo y la ubicación en ambos chats.');
  copy['fr-FR'].notes.push('Mentions — Les suggestions @ affichent maintenant correctement l’avatar, le pseudo complet et l’emplacement dans les deux chats.');
  copy['pt-BR'].notes.push('Presença — A lista de membros preserva os elementos quando os dados não mudam, eliminando o piscar periódico do status.');
  copy['en-US'].notes.push('Presence — The member list now preserves its elements when data is unchanged, eliminating periodic status flicker.');
  copy['es-ES'].notes.push('Presencia — La lista de miembros conserva sus elementos cuando no hay cambios, eliminando el parpadeo periódico del estado.');
  copy['fr-FR'].notes.push('Présence — La liste des membres conserve ses éléments sans changement de données, supprimant le clignotement périodique du statut.');
  copy['pt-BR'].notes.push('Chat — No estilo moderno, todas as mensagens do lobby agora começam na mesma coluna; o alinhamento em lados opostos permanece exclusivo do estilo clássico.');
  copy['en-US'].notes.push('Chat — In modern style, every lobby message now starts in the same column; opposite-side bubble alignment remains exclusive to classic style.');
  copy['es-ES'].notes.push('Chat — En el estilo moderno, todos los mensajes del lobby comienzan en la misma columna; los lados opuestos quedan solo para el estilo clásico.');
  copy['fr-FR'].notes.push('Chat — En style moderne, tous les messages du lobby commencent dans la même colonne ; les côtés opposés restent réservés au style classique.');
  copy['pt-BR'].notes.push('Mídia — Lives agora pedem confirmação para assistir e oferecem, ao passar o mouse, volume local e saída da transmissão.');
  copy['pt-BR'].notes.push('Mídia — Câmera e tela podem permanecer ativas ao mesmo tempo; cada câmera recebida pode ser ocultada e restaurada somente para você.');
  copy['en-US'].notes.push('Media — Screen shares now require a local watch action and expose local volume and leave-stream controls on hover.');
  copy['en-US'].notes.push('Media — Camera and screen can remain active together; each received camera can be hidden and restored locally.');
  copy['es-ES'].notes.push('Medios — Las transmisiones ahora requieren elegir Ver y muestran volumen local y salida al pasar el cursor.');
  copy['es-ES'].notes.push('Medios — Cámara y pantalla pueden permanecer activas juntas; cada cámara puede ocultarse y restaurarse localmente.');
  copy['fr-FR'].notes.push('Média — Les partages d’écran demandent maintenant une action Regarder et proposent volume local et sortie au survol.');
  copy['fr-FR'].notes.push('Média — Caméra et écran peuvent rester actifs ensemble ; chaque caméra peut être masquée et restaurée localement.');
  copy['pt-BR'].notes.push('ServerHost — As fotos de perfil dos participantes agora aparecem corretamente no painel de administração.');
  copy['pt-BR'].notes.push('Salas — O host pode criar, editar e excluir códigos de sala, canais de voz e canais de texto; Clients novos recebem a estrutura ao vivo.');
  copy['pt-BR'].notes.push('Cluster — Dois ServerHosts podem operar como primário e secundário, sincronizando membros, canais, chat e sinais WebRTC com chave privada.');
  copy['en-US'].notes.push('ServerHost — Participant profile photos now render correctly in the administration dashboard.');
  copy['en-US'].notes.push('Rooms — Hosts can create, edit and remove room codes, voice channels and text channels; current Clients receive live layouts.');
  copy['en-US'].notes.push('Cluster — Two ServerHosts can run as primary and secondary, synchronizing members, channels, chat and WebRTC signaling with a private key.');
  copy['es-ES'].notes.push('ServerHost — Las fotos de perfil de los participantes ahora aparecen correctamente en el panel administrativo.');
  copy['es-ES'].notes.push('Salas — El host puede crear, editar y eliminar códigos, canales de voz y texto; los Clients nuevos reciben la estructura en vivo.');
  copy['es-ES'].notes.push('Clúster — Dos ServerHosts pueden actuar como primario y secundario, sincronizando miembros, canales, chat y señales WebRTC.');
  copy['fr-FR'].notes.push('ServerHost — Les photos de profil des participants s’affichent maintenant correctement dans le panneau d’administration.');
  copy['fr-FR'].notes.push('Salons — L’hôte peut créer, modifier et supprimer les codes, canaux vocaux et textuels ; les Clients récents reçoivent la structure en direct.');
  copy['fr-FR'].notes.push('Cluster — Deux ServerHosts peuvent fonctionner en primaire et secondaire et synchroniser membres, canaux, chat et signalisation WebRTC.');
  copy['pt-BR'].notes.push('Presença — O status local agora é a fonte oficial na lista de membros; respostas parciais ou atrasadas do host não substituem Não perturbe/Ausente por Online ou Áudio.');
  copy['en-US'].notes.push('Presence — Local presence is now authoritative in the member list; partial or delayed host responses no longer replace DND/Idle with Online or Audio.');
  copy['es-ES'].notes.push('Presencia — El estado local ahora es la fuente oficial en la lista; respuestas parciales o atrasadas ya no sustituyen No molestar/Ausente por En línea o Audio.');
  copy['fr-FR'].notes.push('Présence — Le statut local fait maintenant autorité dans la liste ; les réponses partielles ou tardives ne remplacent plus Ne pas déranger/Absent par En ligne ou Audio.');
  copy['pt-BR'].notes.push('Presença — Removida a tradução antiga que reescrevia periodicamente a linha dos membros como “Áudio · canal”; presença e localização da call agora são campos independentes.');
  copy['en-US'].notes.push('Presence — Removed the legacy translation that periodically rewrote member rows as “Audio · channel”; presence and call location are now independent fields.');
  copy['es-ES'].notes.push('Presencia — Eliminada la traducción antigua que reescribía la fila como “Audio · canal”; presencia y ubicación de llamada ahora son campos independientes.');
  copy['fr-FR'].notes.push('Présence — Suppression de l’ancienne traduction qui réécrivait la ligne en « Audio · canal » ; présence et emplacement d’appel sont désormais indépendants.');
  copy['pt-BR'].notes.push('Controles — Push-to-talk, atalhos globais configuráveis e reconexão transparente sem desmontar a sala durante quedas rápidas.');
  copy['pt-BR'].notes.push('Chat — Respostas, reações, mensagens fixadas e exclusão pelo próprio autor; editar e apagar permanecem juntos na mensagem.');
  copy['pt-BR'].notes.push('Interface — Barra de servidores salvos, centro contextual, layouts de transmissão e painel direito recolhível e redimensionável.');
  copy['en-US'].notes.push('Controls — Push-to-talk, configurable global shortcuts and transparent reconnect without tearing down the room during brief drops.');
  copy['en-US'].notes.push('Chat — Replies, reactions, pinned messages and author-only deletion; edit and delete remain together on each message.');
  copy['en-US'].notes.push('Interface — Saved-server rail, contextual center, stream layouts and a collapsible, resizable right panel.');
  copy['es-ES'].notes.push('Controles — Pulsar para hablar, atajos globales configurables y reconexión transparente sin desmontar la sala durante cortes breves.');
  copy['es-ES'].notes.push('Chat — Respuestas, reacciones, mensajes fijados y eliminación solo por el autor; editar y borrar permanecen juntos.');
  copy['es-ES'].notes.push('Interfaz — Barra de servidores, centro contextual, diseños de transmisión y panel derecho plegable y redimensionable.');
  copy['fr-FR'].notes.push('Contrôles — Push-to-talk, raccourcis globaux configurables et reconnexion transparente sans démonter le salon lors d’une brève coupure.');
  copy['fr-FR'].notes.push('Chat — Réponses, réactions, messages épinglés et suppression par l’auteur ; modifier et supprimer restent côte à côte.');
  copy['fr-FR'].notes.push('Interface — Barre de serveurs, centre contextuel, dispositions de partage et panneau droit repliable et redimensionnable.');
  copy['pt-BR'].notes.push('Menções — Uma marcação recebida agora toca um som exclusivo, destaca a mensagem somente para o destinatário e mostra um selo @ no canal até ele ser aberto.');
  copy['en-US'].notes.push('Mentions — A received mention now plays a distinct sound, highlights the message only for its recipient and shows an @ badge on the channel until it is opened.');
  copy['es-ES'].notes.push('Menciones — Una mención recibida ahora reproduce un sonido exclusivo, resalta el mensaje solo para su destinatario y muestra una insignia @ en el canal hasta abrirlo.');
  copy['fr-FR'].notes.push('Mentions — Une mention reçue joue désormais un son distinct, surligne le message uniquement pour son destinataire et affiche un badge @ sur le canal jusqu’à son ouverture.');
  copy['pt-BR'].notes.push('Cluster — O failover agora atualiza as rotas dos Clients conectados, redireciona antes do desligamento do primário e restaura automaticamente o canal de voz pelo secundário.');
  copy['en-US'].notes.push('Cluster — Failover now refreshes routes for connected Clients, redirects them before primary shutdown and automatically restores their voice channel through the secondary host.');
  copy['es-ES'].notes.push('Clúster — El failover ahora actualiza las rutas de los Clients conectados, los redirige antes de apagar el primario y restaura el canal de voz mediante el secundario.');
  copy['fr-FR'].notes.push('Cluster — Le failover actualise maintenant les routes des Clients connectés, les redirige avant l’arrêt du primaire et restaure leur canal vocal via le secondaire.');

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
    .release-notes-modal{position:fixed;inset:0;z-index:120;display:grid;place-items:center;padding:20px;background:color-mix(in srgb,var(--night) 74%,transparent);backdrop-filter:blur(9px);animation:release-fade .16s ease}.release-notes-card{position:relative;width:min(520px,calc(100vw - 30px));display:grid;grid-template-columns:58px minmax(0,1fr);gap:15px;padding:24px;border:1px solid var(--line);border-radius:20px;background:linear-gradient(145deg,var(--panel),color-mix(in srgb,var(--surface) 87%,var(--focus) 13%));color:var(--ink);box-shadow:0 28px 80px rgba(0,0,0,.38);animation:release-rise .22s ease}.release-notes-mark{width:58px;height:58px;display:grid;place-items:center;border-radius:17px;color:var(--focus);background:color-mix(in srgb,var(--focus) 13%,var(--surface));border:1px solid color-mix(in srgb,var(--focus) 42%,var(--line));box-shadow:0 0 24px color-mix(in srgb,var(--focus) 20%,transparent)}.release-notes-mark svg{width:30px;height:30px;fill:currentColor}.release-notes-copy{align-self:center}.release-notes-copy h2{margin:3px 38px 5px 0;font:700 24px Outfit,'Segoe UI',sans-serif}.release-notes-copy>p:last-child{margin:0;color:var(--muted);font-size:12px}.release-notes-card ul{grid-column:1/-1;display:grid;gap:9px;margin:2px 0 4px;padding:14px 16px 14px 38px;border:1px solid var(--line);border-radius:13px;background:color-mix(in srgb,var(--night) 54%,transparent)}.release-notes-card li{padding-left:3px;color:var(--ink);font-size:12px;line-height:1.45}.release-notes-card li::marker{color:var(--focus)}#release-notes-close{grid-column:1/-1;justify-self:end;min-width:118px;padding:10px 15px;border:0;border-radius:10px;background:var(--focus);color:var(--focus-contrast,var(--beta-button-ink));font-weight:800}.release-notes-x{position:absolute;right:15px;top:14px;width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--muted);font-size:21px}.release-notes-x:hover{color:var(--ink);background:var(--surface-2)}.settings-autosave{display:inline-flex;align-items:center;gap:6px;color:var(--focus);font-size:10px;font-weight:800;white-space:nowrap}.settings-autosave::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--focus);box-shadow:0 0 8px var(--focus)}#settings-save{display:none!important}.release-notes-reopen{margin-top:10px!important;margin-left:7px!important;padding:8px 10px!important;border:1px solid var(--line)!important;border-radius:8px!important;background:var(--surface-2)!important;color:var(--ink)!important}@keyframes release-fade{from{opacity:0}to{opacity:1}}@keyframes release-rise{from{opacity:0;transform:translateY(9px) scale(.98)}to{opacity:1;transform:none}}@media(max-width:520px){.release-notes-card{grid-template-columns:45px minmax(0,1fr);padding:18px}.release-notes-mark{width:45px;height:45px;border-radius:14px}.release-notes-copy h2{font-size:20px}.settings-autosave{font-size:9px}}
  </style>`);
  document.head.insertAdjacentHTML('beforeend', '<style>.release-notes-card{width:min(620px,calc(100vw - 30px))!important;max-height:min(88dvh,820px);overflow:auto}.release-notes-card ul{align-content:start}</style>');

  const modal = document.querySelector('#release-notes-modal');
  const settingsModal = document.querySelector('#settings-modal');
  const settingsClose = document.querySelector('#settings-close');
  const settingsSave = document.querySelector('#settings-save');
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
