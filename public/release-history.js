/* Release notes describe the stable-to-stable delta, not the last beta. */
((scope) => {
  'use strict';
  const history = {
    from: '1.1.2', version: '1.2.0',
    locales: {
      'pt-BR': {
        title: 'Novidades do VoiceUP 1.2.0', subtitle: 'O que mudou da v1.1.2 para a v1.2.0.',
        notes: [
          'Plataformas — novas edições para Linux, Android e SelfWeb, o cliente leve em um arquivo HTML. Os recursos disponíveis dependem da plataforma e do navegador.',
          'Presença — ícones de Windows, Linux, Android e Web nas cores Online, Ausente e Não perturbe. Clientes antigos continuam com o indicador de status compatível.',
          'Início do Client — perfil com foto clicável, conexão com servidor em destaque, convites P2P abaixo e formulário centralizado com rolagem.',
          'Canais de voz — membros em ordem alfabética abaixo de cada canal, ícones de microfone/fone mutados ao lado do nick, indicador Ao vivo e câmera.',
          'Duração da call — contador na cor do tema enquanto o canal estiver ocupado; reinicia quando o último participante sai.',
          'Transmissões no Desktop — grade para assistir a várias lives e câmeras juntas, zoom e tela cheia individual por bloco.',
          'Avisos sonoros — entrada e saída da call, sons próprios para espectadores da live e contagem de quem está assistindo na prévia do transmissor.',
          'Áudio no Desktop — sensibilidade automática e ajustes de supressão/eco; RNNoise opcional, processado localmente, com correção do microfone silencioso e retorno ao filtro padrão se o modo não iniciar.',
          'Jogos no Windows — ajustes para priorizar FPS da live, manter a captura em segundo plano e um modo de compatibilidade para o cursor local em jogos de tela cheia.',
          'Interface — ajustes de organização e salvamento das configurações, rolagem, contraste e correções dos indicadores de mute que se acumulavam.',
          'Reconexão — tratamento de sessões antigas para reduzir participantes duplicados ou silenciosos após oscilações de rede, no ServerHost e no Cloud.',
          'ServerHost — edição Linux, identificação de plataforma dos participantes, aceleração de hardware configurável e instalação separada do Client no Windows.',
          'ServerHost e Cloud — validações adicionais de identidade, bots, eventos e acesso a salas; limites contra abuso e proteção de diagnósticos.',
          'Privacidade — mídia externa sob consentimento, confirmação antes de abrir portas via UPnP/NAT-PMP e aprovação de plugins externos pelo hash do arquivo.',
          'Segurança — identidade com chave local, dependências atualizadas e restrições adicionais de navegação, scripts e permissões no aplicativo.',
          'Distribuição — verificação criptográfica dos pacotes e SHA-256 no atualizador; o certificado comercial do Windows não é obrigatório. Isso não elimina os avisos do SmartScreen.',
          'Site — downloads organizados por plataforma, SelfWeb, requisitos mínimos/recomendados e orientações para hospedar um ServerHost.'
        ]
      },
      'en-US': {
        title: 'What is new in VoiceUP 1.2.0', subtitle: 'Changes from v1.1.2 to v1.2.0.',
        notes: [
          'Platforms — new Linux, Android and SelfWeb editions, including a lightweight single-HTML client. Available features depend on the platform and browser.',
          'Presence — Windows, Linux, Android and Web icons colored for Online, Idle and Do Not Disturb. Older clients retain a compatible status indicator.',
          'Client home — clickable profile photo, server connection first, P2P invitations below and a centered, scrollable form.',
          'Voice channels — alphabetical member lists below each channel, microphone/speaker mute icons beside nicknames, live indicator and camera icon.',
          'Call duration — a theme-colored timer while the channel is occupied; it resets after the last participant leaves.',
          'Desktop streaming — a grid for multiple streams and cameras, zoom and individual fullscreen for each tile.',
          'Sounds — call join/leave alerts, distinct stream-viewer alerts and a viewer count in the broadcaster preview.',
          'Desktop audio — automatic sensitivity and suppression/echo adjustments; optional local RNNoise, a silent-microphone fix and fallback if RNNoise cannot start.',
          'Windows games — stream-FPS prioritization, background capture and a compatibility mode for the local cursor in fullscreen games.',
          'Interface — settings organization and autosave, scrolling, contrast and fixes for accumulating mute indicators.',
          'Reconnection — stale-session handling to reduce duplicate or silent participants after network interruptions, on ServerHost and Cloud.',
          'ServerHost — Linux edition, participant platform indicators, configurable hardware acceleration and Windows installation separate from the Client.',
          'ServerHost and Cloud — additional identity, bot, event and room-access validation, abuse limits and protected diagnostics.',
          'Privacy — consent for external media, confirmation before UPnP/NAT-PMP port mapping and hash-based approval of external plugins.',
          'Security — local-key identity, updated dependencies and additional navigation, script and permission restrictions.',
          'Distribution — cryptographic package and SHA-256 verification in the updater; a commercial Windows certificate is not required. SmartScreen warnings may remain.',
          'Website — platform-specific downloads, SelfWeb, minimum/recommended requirements and ServerHost hosting guidance.'
        ]
      },
      'es-ES': {
        title: 'Novedades de VoiceUP 1.2.0', subtitle: 'Cambios de la v1.1.2 a la v1.2.0.',
        notes: [
          'Plataformas — nuevas ediciones Linux, Android y SelfWeb, un cliente ligero en un archivo HTML. Las funciones dependen de la plataforma y del navegador.',
          'Presencia — iconos de Windows, Linux, Android y Web con los colores En línea, Ausente y No molestar; indicador compatible para clientes antiguos.',
          'Inicio — foto de perfil pulsable, conexión al servidor primero, invitaciones P2P debajo y formulario centrado con desplazamiento.',
          'Canales de voz — miembros en orden alfabético debajo del canal, iconos de micrófono/altavoz silenciados junto al nombre, indicador de directo y cámara.',
          'Duración — contador con el color del tema mientras el canal esté ocupado; se reinicia al salir la última persona.',
          'Directos en Desktop — cuadrícula para varias transmisiones y cámaras, zoom y pantalla completa individual.',
          'Sonidos — entrada/salida de llamadas, avisos distintos de espectadores y contador en la vista previa del transmisor.',
          'Audio en Desktop — sensibilidad automática, ajustes de supresión/eco y RNNoise local opcional; corrección del micrófono silencioso y filtro de respaldo.',
          'Juegos en Windows — prioridad de FPS, captura en segundo plano y modo compatible con el cursor local en pantalla completa.',
          'Interfaz — organización y guardado de ajustes, desplazamiento, contraste y corrección de iconos de silencio acumulados.',
          'Reconexión — manejo de sesiones antiguas para reducir participantes duplicados o silenciosos tras interrupciones de red, en ServerHost y Cloud.',
          'ServerHost — edición Linux, plataforma de participantes, aceleración de hardware configurable e instalación Windows separada del Client.',
          'ServerHost y Cloud — validaciones adicionales de identidad, bots, eventos y acceso a salas; límites contra abusos y protección de diagnósticos.',
          'Privacidad — consentimiento para medios externos, confirmación de UPnP/NAT-PMP y aprobación de plugins externos por hash.',
          'Seguridad — identidad con clave local, dependencias actualizadas y restricciones de navegación, scripts y permisos.',
          'Distribución — verificación criptográfica de paquetes y SHA-256 en el actualizador, sin certificado comercial Windows obligatorio. Pueden continuar los avisos de SmartScreen.',
          'Sitio — descargas por plataforma, SelfWeb, requisitos mínimos/recomendados y orientación para alojar ServerHost.'
        ]
      },
      'fr-FR': {
        title: 'Nouveautés de VoiceUP 1.2.0', subtitle: 'Changements de la v1.1.2 à la v1.2.0.',
        notes: [
          'Plateformes — nouvelles éditions Linux, Android et SelfWeb, un client léger dans un fichier HTML. Les fonctions dépendent de la plateforme et du navigateur.',
          'Présence — icônes Windows, Linux, Android et Web aux couleurs En ligne, Absent et Ne pas déranger ; indicateur compatible pour les anciens clients.',
          'Accueil — photo de profil cliquable, connexion au serveur en premier, invitations P2P dessous et formulaire centré avec défilement.',
          'Salons vocaux — membres par ordre alphabétique sous le salon, icônes micro/haut-parleur coupés près du pseudo, indicateur de direct et caméra.',
          'Durée — compteur aux couleurs du thème tant que le salon est occupé ; remis à zéro au départ du dernier participant.',
          'Desktop — grille pour plusieurs directs et caméras, zoom et plein écran individuel.',
          'Sons — arrivée/départ des appels, alertes distinctes pour les spectateurs et compteur dans l’aperçu du diffuseur.',
          'Audio Desktop — sensibilité automatique, réglages de suppression/écho et RNNoise local facultatif ; correction du micro silencieux et filtre de secours.',
          'Jeux Windows — priorité aux FPS, capture en arrière-plan et mode de compatibilité du curseur local en plein écran.',
          'Interface — organisation et enregistrement des réglages, défilement, contraste et correction des icônes muet accumulées.',
          'Reconnexion — gestion des anciennes sessions pour réduire les participants en double ou silencieux après une coupure réseau, sur ServerHost et Cloud.',
          'ServerHost — édition Linux, plateforme des participants, accélération matérielle configurable et installation Windows séparée du Client.',
          'ServerHost et Cloud — contrôles supplémentaires d’identité, bots, événements et accès aux salons ; limites anti-abus et protection des diagnostics.',
          'Confidentialité — consentement aux médias externes, confirmation UPnP/NAT-PMP et approbation des plugins externes par empreinte.',
          'Sécurité — identité avec clé locale, dépendances actualisées et restrictions supplémentaires de navigation, scripts et permissions.',
          'Distribution — vérification cryptographique des paquets et SHA-256 dans la mise à jour, sans certificat Windows commercial obligatoire. Les avertissements SmartScreen peuvent persister.',
          'Site — téléchargements par plateforme, SelfWeb, prérequis minimaux/recommandés et guide pour héberger ServerHost.'
        ]
      }
    }
  };
  for (const value of Object.values(history.locales)) { Object.freeze(value.notes); Object.freeze(value); }
  Object.freeze(history.locales); Object.freeze(history);
  if (typeof module === 'object' && module.exports) module.exports = history;
  // Vite may wrap this shared file as CommonJS. Still expose the browser API
  // when bundled for Android, without adding globals to Node test processes.
  if (typeof module !== 'object' || !module.exports || typeof window !== 'undefined') scope.voiceupReleaseHistory = history;
})(globalThis);
