/* Release notes describe the stable-to-stable delta, not the last beta. */
((scope) => {
  'use strict';
  const history = {
    from: '1.2.0', version: '1.2.1',
    locales: {
      'pt-BR': {
        title: 'Novidades do VoiceUP 1.2.1', subtitle: 'O que mudou da v1.2.0 para a v1.2.1.',
        notes: [
          'Áudio das transmissões no Windows — captura separada por janela ou da tela inteira, com o próprio VoiceUP excluído quando possível; microfone e som compartilhado continuam em faixas independentes.',
          'Estabilidade de mídia — correções para áudio ausente nas lives, FPS mais constante em jogos, cursor local em tela cheia e troca simultânea entre câmera e compartilhamento.',
          'Layout da call — participantes em blocos quadrados e responsivos; durante uma live, a faixa de participantes fica abaixo e pode ser recolhida, mantendo zoom e tela cheia por transmissão.',
          'Presença — ícones compactos de plataforma e estado, indicadores de mute, câmera e Ao vivo reposicionados para não cobrir a foto ou criar bordas excessivas.',
          'Temas — 14 gradientes escuros e 5 claros, separados das cores sólidas em categorias próprias no seletor.',
          'Inicialização no Windows — nova opção para abrir o Client junto com o sistema, desativada por padrão e disponível somente no aplicativo instalado.',
          'Moderação no ServerHost e Cloud — cooldown configurável de mensagens, castigo de chat e limite editável de 500 a 10.000 caracteres para respostas de plugins.',
          'Persistência — políticas de chat e castigos são gravados no banco SQLite; os dados continuam após reiniciar o ServerHost ou Cloud.',
          'Métricas do ServerHost — ping em milissegundos aparece diretamente ao lado das barras de qualidade da rede, sem depender do mouse.',
          'Android — identidade visual do VoiceUP, canais de voz e texto, controles compactos da call e ferramentas de mensagens reorganizadas para toque.',
          'Compatibilidade e distribuição — protocolo preservado com a 1.2.0 e publicação atômica com manifesto Ed25519, SHA-256 e os nomes históricos dos instaladores para evitar Release incompleta ou erro 404.'
        ]
      },
      'en-US': {
        title: 'What is new in VoiceUP 1.2.1', subtitle: 'Changes from v1.2.0 to v1.2.1.',
        notes: [
          'Windows stream audio — separate capture for a selected window or the whole display, excluding VoiceUP itself when possible; microphone and shared sound remain independent tracks.',
          'Media stability — fixes for missing stream audio, steadier game FPS, the local fullscreen cursor and switching between camera and screen sharing.',
          'Call layout — responsive square participant tiles; while watching a stream, the participant tray stays below and can be collapsed, with per-stream zoom and fullscreen.',
          'Presence — compact platform and status icons, plus mute, camera and Live indicators positioned without covering avatars or creating oversized borders.',
          'Themes — 14 dark and 5 light gradient themes, separated from solid colors in dedicated selector categories.',
          'Windows startup — an option to open the Client with Windows, disabled by default and available only in the installed application.',
          'ServerHost and Cloud moderation — configurable message cooldown, chat timeout punishment and an editable 500 to 10,000 character limit for plugin replies.',
          'Persistence — chat policies and punishments are stored in SQLite and survive ServerHost or Cloud restarts.',
          'ServerHost metrics — ping in milliseconds is displayed next to the network quality bars without requiring hover.',
          'Android — VoiceUP branding, voice and text channels, compact call controls and touch-friendly message tools.',
          'Compatibility and distribution — the 1.2.0 protocol remains supported, with atomic publication, an Ed25519 manifest, SHA-256 and historical installer names to prevent incomplete Releases and 404 errors.'
        ]
      },
      'es-ES': {
        title: 'Novedades de VoiceUP 1.2.1', subtitle: 'Cambios de la v1.2.0 a la v1.2.1.',
        notes: [
          'Audio de transmisiones en Windows — captura separada de una ventana o de la pantalla completa, excluyendo VoiceUP cuando es posible; el micrófono y el sonido compartido siguen en pistas independientes.',
          'Estabilidad multimedia — correcciones para audio ausente, FPS más estables en juegos, cursor local en pantalla completa y cambio entre cámara y pantalla.',
          'Diseño de la llamada — participantes en bloques cuadrados adaptables; durante un directo, la bandeja inferior se puede ocultar y cada transmisión conserva zoom y pantalla completa.',
          'Presencia — iconos compactos de plataforma y estado, con indicadores de silencio, cámara y En directo sin cubrir el avatar ni dejar bordes excesivos.',
          'Temas — 14 gradientes oscuros y 5 claros, separados de los colores sólidos en categorías propias.',
          'Inicio con Windows — nueva opción para abrir el Client con el sistema, desactivada de forma predeterminada y disponible solo en la aplicación instalada.',
          'Moderación de ServerHost y Cloud — cooldown configurable, castigo de chat y límite editable de 500 a 10.000 caracteres para respuestas de plugins.',
          'Persistencia — las políticas y los castigos del chat se guardan en SQLite y sobreviven a reinicios de ServerHost o Cloud.',
          'Métricas de ServerHost — el ping en milisegundos aparece junto a las barras de red sin pasar el ratón.',
          'Android — identidad visual de VoiceUP, canales de voz y texto, controles de llamada compactos y herramientas de mensajes adaptadas al tacto.',
          'Compatibilidad y distribución — se conserva el protocolo 1.2.0 y la publicación atómica usa manifiesto Ed25519, SHA-256 y nombres históricos para evitar Releases incompletas y errores 404.'
        ]
      },
      'fr-FR': {
        title: 'Nouveautés de VoiceUP 1.2.1', subtitle: 'Changements de la v1.2.0 à la v1.2.1.',
        notes: [
          'Audio des diffusions sous Windows — capture séparée d’une fenêtre ou de l’écran entier, en excluant VoiceUP si possible ; le micro et le son partagé restent sur des pistes indépendantes.',
          'Stabilité des médias — corrections de l’audio absent, FPS plus réguliers en jeu, curseur local en plein écran et passage entre caméra et partage d’écran.',
          'Disposition de l’appel — participants en tuiles carrées adaptatives ; pendant un direct, la barre inférieure peut être repliée, avec zoom et plein écran pour chaque diffusion.',
          'Présence — icônes compactes de plateforme et de statut, avec indicateurs muet, caméra et En direct sans masquer l’avatar ni créer de bordures excessives.',
          'Thèmes — 14 dégradés sombres et 5 clairs, séparés des couleurs unies dans des catégories dédiées.',
          'Démarrage Windows — option pour ouvrir le Client avec Windows, désactivée par défaut et disponible uniquement dans l’application installée.',
          'Modération ServerHost et Cloud — délai configurable entre messages, sanction de chat et limite réglable de 500 à 10 000 caractères pour les réponses des plugins.',
          'Persistance — les règles et sanctions du chat sont enregistrées dans SQLite et survivent aux redémarrages du ServerHost ou du Cloud.',
          'Mesures ServerHost — le ping en millisecondes apparaît près des barres réseau sans survol de la souris.',
          'Android — identité visuelle VoiceUP, salons vocaux et textuels, commandes d’appel compactes et outils de message adaptés au tactile.',
          'Compatibilité et distribution — le protocole 1.2.0 reste pris en charge et la publication atomique utilise un manifeste Ed25519, SHA-256 et les noms historiques pour éviter les Releases incomplètes et erreurs 404.'
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
