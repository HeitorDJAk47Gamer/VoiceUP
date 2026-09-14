/* Stable notes remain shared; matching desktop betas use a separate catalog. */
((scope) => {
  'use strict';
  const betaHistory = {
    from: '1.2.1', version: '1.2.2-beta.27',
    locales: {
      'pt-BR': {
        title: 'VoiceUP 1.2.2 beta 27', subtitle: 'Vigésima sétima beta local depois da v1.2.1. Nada foi publicado.',
        notes: [
          'Prévia de arquivos de código — JS, Python e outros arquivos de texto recebem destaque de sintaxe, expansão, tamanho e quantidade restante. O conteúdo completo pode ser carregado em trechos, respeitando o limite de anexos do host.',
          'Prévias de links — novas mensagens preservam os players já carregados; a busca de metadados usa a identificação do navegador e ignora páginas de incompatibilidade e bloqueio.',
          'Controles da live compactos — removidas as legendas pequenas para reduzir o painel, mantendo seletor de qualidade, volume e ícones.',
          'Ditado por Voz do Windows — o botão “Falar para escrever” abre o ditado nativo com Win + H, usando o reconhecimento pt-BR instalado no sistema e escrevendo somente no rascunho.',
          'Anexos automáticos — arquivos do ServerHost são carregados ao chegar; imagens e áudios compatíveis aparecem no chat, e os demais ficam prontos para baixar sem exigir “Ver arquivo”.',
          'Vários anexos — o seletor aceita múltiplos arquivos, valida cada um pelo limite definido pelo host e os envia separadamente, sem bloquear o chat.',
          'Ditado no Client — o botão “Falar para escrever” apenas preenche a caixa de mensagem; revise e confirme Enviar para publicar. Depende do mecanismo de reconhecimento de fala disponível no sistema.',
          'Limite de anexos definido pelo host — o teto antigo de 20 MB foi removido. O ServerHost aceita o valor configurado, até 256 MB por capacidade técnica compatível com backup, e grava o envio diretamente em disco.',
          'Anexos no chat — o host define o limite de arquivos e áudios, até 256 MB por capacidade técnica. A transferência valida tamanho, acesso, cooldown e integridade; os arquivos entram no backup do ServerHost.',
          'Mensagens de voz — grave no Client, ouça a prévia e escolha enviar ou descartar, respeitando o limite configurado pelo servidor. O ditado preenche o campo e nunca envia sozinho.',
          'Identidade do servidor — o topo da lateral mostra o nome público da sala/servidor e o ícone configurado pelo host.',
          'Recuperação de atualização — detecta uma tentativa interrompida, oferece tentar novamente e revalida assinatura e hash antes de reaproveitar um instalador, sem apagar dados. Não faz downgrade automático.',
          'Acessibilidade — aba dedicada para texto ampliado, contraste e redução de animações, com foco visível, navegação por teclado e contenção de foco nos diálogos.',
          'Qualidade por espectador — cada pessoa pode solicitar até 360p, 480p, 720p ou 1080p/30, sem alterar os demais e respeitando o máximo do transmissor; versões antigas exibem aviso de falta de confirmação.',
          'Atalhos personalizáveis — gravação da combinação pelo teclado e aviso por ação quando uma tecla é inválida, repetida ou indisponível no sistema.',
          'Reconexão transparente — mantém mídia P2P durante quedas curtas da sinalização, retoma visualizações por identidade e oferece cancelamento, com recuperação ICE limitada nas calls hospedadas.',
          'Status Em atividade — novo indicador azul para mostrar ocupação sem silenciar mensagens, menções, calls ou notificações.',
          'Tela cheia imersiva — a live ocupa toda a tela, sem bordas, painéis ou participantes sobrepostos; os controles desaparecem com o mouse parado e o layout volta ao sair.',
          'Estabilidade das lives — equilíbrio entre nitidez e movimento, limites de envio também na qualidade original e ajuste gradual de FPS por conexão após pressão persistente de rede ou codificação.',
          'Atribuição de cargos mais limpa — o autosave continua imediato, mas a legenda permanente foi removida; o estado aparece somente enquanto salva ou quando ocorre uma falha.',
          'Cargos com autosave — marcar ou desmarcar um cargo na pessoa envia a alteração imediatamente, tanto no Client quanto no ServerHost, sem botão Salvar e com retorno visual durante a gravação.',
          'Canais dinâmicos pessoais — a call temporária recebe somente o nome de quem entrou, permanece disponível enquanto houver qualquer participante nela e desaparece automaticamente quando a última pessoa sai.',
          'Fórum responsivo — no painel lateral, tópicos, título, mensagem e publicação ficam em uma coluna sem cortes; na área central, a lista e o compositor aproveitam o espaço em duas colunas.',
          'Botões coerentes com o tema — controles sem estilo específico deixam de usar o branco padrão do navegador, com cores, foco e contraste definidos pelo tema escolhido.',
          'Canais por tipo — Palco, Fórum e Canal dinâmico entram no editor do Client e do ServerHost; o Fórum organiza conversas por tópicos e tags.',
          'Calls temporárias — ao entrar em um canal dinâmico, o ServerHost cria uma call própria com o limite escolhido, move a pessoa e remove a call quando ela fica vazia.',
          'Lista por cargo — cargos podem optar por separar seus membros na lista do canal, preservando a ordem alfabética dentro de cada grupo.',
          'Prévia TXT sem corte — textos, URLs e palavras muito longas passam a quebrar visualmente dentro do cartão, mantendo as quebras originais e sem rolagem horizontal.',
          'Código no chat — blocos entre três crases aceitam a linguagem na primeira linha, ganham destaque visual seguro e um botão para copiar, sem executar o conteúdo.',
          'Texto longo como arquivo — mensagens humanas acima de 500 caracteres viram automaticamente um mensagem.txt com prévia recolhível, tamanho, cópia e download; ServerHost e Cloud validam e preservam o anexo.',
          'Hierarquia rígida — mesmo administradores só podem editar cargos e pessoas abaixo do próprio nível; administradores equivalentes não podem remover cargos, mover ou punir um ao outro.',
          'Administração reorganizada — Configurar servidor agora separa Visão geral, Canais, Cargos e Auditoria; Membros ganhou uma tela própria para movimentação, atribuição de cargos e punições por pessoa.',
          'Seleção múltipla de membros — quem possui permissão pode usar Ctrl + clique para escolher pessoas específicas e movê-las juntas por arraste ou pela nova barra de destino; cada pessoa continua validada separadamente pelo ServerHost.',
          'Backup portátil do ServerHost — um único arquivo verificado salva configurações, salas, canais, mensagens, cargos, permissões, moderação, relatórios, auditoria e dados de plugins para levar o servidor a outro PC.',
          'Restauração segura — o ServerHost verifica integridade e caminhos, cria automaticamente uma cópia do estado atual, restaura os dados e reinicia; plugins externos voltam a exigir aprovação.',
          'Canais completos pelo Client — membros com “Criar e editar canais” agora têm botões + Voz e + Texto, lista dos canais atuais e editor próprio sem depender do operador do ServerHost.',
          'Configuração por tipo — voz oferece posição, categoria, quantidade de membros, bitrate, região e bloqueio; texto oferece posição, categoria, tópico, cooldown e somente leitura.',
          'Visibilidade por cargo — o canal pode ficar aberto a todos ou limitado a cargos escolhidos; a lista, a entrada, o histórico e as mensagens são filtrados e validados no servidor.',
          'Gerenciamento pelo Client — um membro autorizado pode clicar em outra pessoa e acessar diretamente Mover de call, Cargos e Punições, sem intervenção de quem está operando o ServerHost.',
          'Mover por arraste — quem tiver permissão pode arrastar uma pessoa da lista para outra call ou para “Fora da call”; cargo, hierarquia, destino e limite continuam validados pelo ServerHost e registrados na auditoria.',
          'Cargos coloridos — o ServerHost pode criar e editar cargos, escolher a posição e combinar sete permissões administrativas.',
          'Administração dentro do Client — pessoas autorizadas podem ajustar políticas de chat, criar canais, mover participantes, moderar e atribuir cargos sem abrir o painel do host.',
          'Segurança — permissões são ligadas à identidade criptográfica persistente do perfil; Client antigo continua entrando, mas não recebe poderes administrativos.',
          'Auditoria em disco — entradas, saídas e ações sensíveis ficam registradas localmente com autor, data e resultado, sem guardar mensagens, senhas ou chaves.',
          'Sons separados — conexão ao servidor, entrada e saída da call, abertura e fechamento de live e mudanças de espectadores agora usam sinais diferentes.',
          'Atualizador silencioso no Windows — progresso visível e temático, janela minimizável e instalação sem exibir o assistente tradicional.',
          'Preservação de dados — perfil, temas, dispositivos, servidores salvos, salas, cargos, plugins e preferências permanecem fora dos arquivos substituídos pela atualização.'
        ]
      },
      'en-US': {
        title: 'VoiceUP 1.2.2 beta 27', subtitle: 'Twenty-seventh local beta after v1.2.1. Nothing has been published.',
        notes: [
          'Source file previews — JS, Python and other text files include syntax highlighting, expansion, file size and remaining bytes. Load the complete content in portions within the host attachment limit.',
          'Link previews — incoming messages preserve loaded players; metadata requests use the browser identity and ignore compatibility and challenge pages.',
          'Windows Voice Typing — the Speak to write button opens native voice typing with Win + H, uses the pt-BR recognition installed in Windows and writes only into the draft.',
          'Automatic attachments — ServerHost files load when received; compatible images and audio appear in chat, while other files are ready to download without a separate Open action.',
          'Multiple attachments — the picker accepts several files, validates each against the host-defined limit and sends them separately without blocking chat.',
          'Client dictation — the Speak to write button only fills the message box; review and confirm Send to publish. It depends on speech recognition available on the system.',
          'Host-defined attachment limit — the former 20 MB cap was removed. ServerHost accepts its configured value up to the 256 MB backup-compatible technical capacity and streams uploads directly to disk.',
          'Chat attachments — hosts set their own file and voice-message limit, up to the 256 MB technical capacity, with access checks, integrity verification and inclusion in server backups.',
          'Voice messages — record, preview, send or discard audio in the Client. Dictation fills the field and never sends by itself.',
          'Server identity — the sidebar heading displays the public room/server name and configured icon.',
          'Update recovery — retry interrupted updates and reverify cached installers before use, preserving user data; no automatic downgrade.',
          'Accessibility — dedicated text, contrast and reduced-motion controls, visible keyboard focus and modal focus containment.',
          'Per-viewer quality — request lower video caps independently, always bounded by the broadcaster, with feedback for unsupported peers.',
          'Custom shortcuts — capture key combinations and report invalid, duplicate or unavailable shortcuts for each action.',
          'Transparent reconnect — preserve P2P media during short signalling interruptions, restore viewed streams by identity and allow cancellation with bounded ICE retries.',
          'Active status — a new blue indicator that shows you are busy while retaining messages, mentions, calls and notifications.',
          'Immersive fullscreen — streams fill the viewport without borders, panels or participant overlays; controls hide when idle and the previous layout is restored on exit.',
          'Stream stability — balanced detail and motion, bounded sending in original-source mode, and gradual per-connection FPS adaptation after sustained network or encoder pressure.',
          'Cleaner role assignment — autosave remains immediate, but its permanent label is gone; status is shown only while saving or when an error occurs.',
          'Role assignment autosave — checking or unchecking a person role applies the change immediately in both Client and ServerHost, without a Save button and with visible progress feedback.',
          'Personal Dynamic channels — the temporary call uses only the name of the person who entered, remains available while any participant is inside and disappears automatically after the last person leaves.',
          'Responsive forums — topics, title, message and publishing stack without clipping in the side panel, while the central view uses separate topic and composer columns.',
          'Theme-consistent buttons — controls without a dedicated style no longer fall back to the browser white skin and instead inherit the selected theme colors, focus and contrast.',
          'Channel types — Stage, Forum and Dynamic channels are available in the Client and ServerHost editor; Forums organize discussions into topics and tags.',
          'Temporary calls — joining a Dynamic channel creates a dedicated capacity-limited call, moves the person into it and removes it after the last person leaves.',
          'Role grouping — roles can opt into separate member groups while preserving alphabetical order within each group.',
          'TXT preview without clipping — long text, URLs and unbroken words now wrap inside the card while preserving intentional newlines and avoiding horizontal scrolling.',
          'Code in chat — blocks between triple backticks accept a language on the first line, receive safe syntax highlighting and include a copy button without executing their contents.',
          'Long text as a file — human messages over 500 characters automatically become mensagem.txt with a collapsible preview, size, copy and download controls; ServerHost and Cloud validate and preserve the attachment.',
          'Strict hierarchy — even administrators can only edit roles and people below their own level; equivalent administrators cannot remove each other’s roles, move or moderate one another.',
          'Reorganized administration — Server Settings now separates Overview, Channels, Roles and Audit; Members has its own page for moving people, assigning roles and applying moderation per person.',
          'Multi-member selection — authorized people can Ctrl-click specific members and move them together by drag-and-drop or with the new destination bar; ServerHost still validates every person separately.',
          'Portable ServerHost backup — one verified file saves settings, rooms, channels, messages, roles, permissions, moderation, reports, audit and plugin data for moving the server to another PC.',
          'Safe restore — ServerHost verifies integrity and paths, automatically backs up the current state, restores the data and restarts; external plugins require approval again.',
          'Full Client-side channels — members with Manage Channels now get + Voice and + Text buttons, the current channel list and a dedicated editor without ServerHost operator intervention.',
          'Type-aware settings — voice supports position, category, member limit, bitrate, region and locking; text supports position, category, topic, slow mode and read-only mode.',
          'Role visibility — channels can be public or limited to selected roles; listings, joins, history and messages are filtered and validated by the server.',
          'Client-side member management — an authorized member can click another person and directly access Move, Roles and Punishments without ServerHost operator intervention.',
          'Drag to move — authorized people can drag a member to another voice channel or Outside the call; permission, hierarchy, destination and capacity remain server-validated and audited.',
          'Color roles with editable hierarchy and seven server-side permissions.',
          'Authorized people can adjust chat policies, create channels, move members, moderate and assign roles from the Client.',
          'Permissions are tied to the persistent cryptographic profile identity; legacy clients remain compatible without admin rights.',
          'Disk-backed security audit for sessions and administrative actions, excluding messages, passwords and keys.',
          'Distinct sounds for server, call and live-view transitions.',
          'Theme-aware, minimizable update progress with silent NSIS installation on Windows.',
          'Profiles, saved servers, rooms, roles, plugins and preferences remain outside replaced application files.'
        ]
      },
      'es-ES': {
        title: 'VoiceUP 1.2.2 beta 27', subtitle: 'Vigésima séptima beta local después de v1.2.1. No se publicó nada.',
        notes: [
          'Vista previa de código — JS, Python y otros archivos de texto incluyen sintaxis resaltada, expansión, tamaño y bytes restantes. El contenido completo se carga por partes según el límite del host.',
          'Vistas previas — los mensajes nuevos conservan los reproductores cargados; las solicitudes usan la identidad del navegador e ignoran páginas de incompatibilidad y bloqueo.',
          'Dictado por Voz de Windows — el botón Hablar para escribir abre el dictado nativo con Win + H, usa el reconocimiento pt-BR instalado y solo escribe en el borrador.',
          'Adjuntos automáticos — los archivos del ServerHost se cargan al llegar; imágenes y audios compatibles aparecen en el chat y los demás quedan listos para descargar sin una acción de Abrir.',
          'Varios adjuntos — el selector acepta varios archivos, valida cada uno contra el límite definido por el host y los envía por separado sin bloquear el chat.',
          'Dictado en Client — el botón Hablar para escribir solo completa el cuadro de mensaje; revise y confirme Enviar para publicar. Depende del reconocimiento de voz disponible en el sistema.',
          'Límite de archivos definido por el host — se eliminó el anterior límite de 20 MB. ServerHost acepta el valor configurado hasta la capacidad técnica de 256 MB compatible con la copia de seguridad y guarda la carga directamente en disco.',
          'Archivos adjuntos — el host define el límite de archivos y audios, hasta la capacidad técnica de 256 MB, con controles de acceso, integridad y copia de seguridad.',
          'Mensajes de voz — graba, escucha y envía o descarta el audio en el Client. El dictado completa el campo y nunca envía solo.',
          'Identidad del servidor — la cabecera lateral muestra el nombre público y el icono configurado por el host.',
          'Recuperación de actualizaciones — reintenta una actualización interrumpida y verifica de nuevo el instalador sin borrar datos ni regresar automáticamente a otra versión.',
          'Accesibilidad — controles de texto ampliado, contraste y animaciones reducidas, foco visible y navegación por teclado en diálogos.',
          'Calidad por espectador — cada persona solicita un límite propio sin cambiar la captura ni superar el máximo del transmisor.',
          'Atajos personalizables — captura de combinaciones e indicaciones de teclas inválidas, repetidas o no disponibles.',
          'Reconexión transparente — conserva el medio P2P durante caídas breves, restaura las transmisiones por identidad y permite cancelar los reintentos.',
          'Estado Activo — nuevo indicador azul para mostrar ocupación sin silenciar mensajes, menciones, llamadas ni notificaciones.',
          'Pantalla completa inmersiva — transmisión sin bordes, paneles ni participantes superpuestos; los controles se ocultan al quedar inactivos y el diseño vuelve al salir.',
          'Estabilidad de transmisiones — equilibrio entre nitidez y movimiento, envío limitado incluso con calidad original y ajuste gradual de FPS por conexión ante presión sostenida de red o codificación.',
          'Asignación de roles más limpia — el autosave sigue siendo inmediato, pero se quitó la etiqueta permanente; el estado solo aparece mientras guarda o si ocurre un error.',
          'Autosave de roles — marcar o desmarcar un rol de una persona aplica el cambio inmediatamente tanto en Client como en ServerHost, sin botón Guardar y con progreso visible.',
          'Canales dinámicos personales — la llamada temporal usa solamente el nombre de quien entró, permanece mientras haya cualquier participante dentro y desaparece automáticamente cuando sale la última persona.',
          'Foros adaptables — los temas, el título, el mensaje y la publicación se apilan sin cortes en el panel lateral; la vista central separa temas y creación en dos columnas.',
          'Botones coherentes con el tema — los controles sin estilo propio dejan de usar el blanco nativo del navegador y heredan los colores, foco y contraste del tema elegido.',
          'Tipos de canales — Palco, Foro y canal dinámico llegan al editor del Client y ServerHost; el Foro organiza conversaciones por temas y etiquetas.',
          'Llamadas temporales — entrar en un canal dinámico crea una llamada propia con el límite elegido y la elimina cuando queda vacía.',
          'Agrupación por rol — los roles pueden mostrar sus miembros en grupos separados conservando el orden alfabético.',
          'Vista previa TXT sin cortes — textos, URL y palabras muy largas ahora se ajustan dentro de la tarjeta, conservando los saltos de línea y sin desplazamiento horizontal.',
          'Código en el chat — los bloques entre tres acentos graves aceptan el lenguaje en la primera línea, reciben resaltado seguro y ofrecen un botón para copiar sin ejecutar su contenido.',
          'Texto largo como archivo — los mensajes humanos de más de 500 caracteres se convierten automáticamente en mensagem.txt con vista previa plegable, tamaño, copia y descarga; ServerHost y Cloud validan y conservan el adjunto.',
          'Jerarquía estricta — incluso los administradores solo pueden editar roles y personas por debajo de su nivel; administradores equivalentes no pueden quitarse roles, moverse ni sancionarse entre sí.',
          'Administración reorganizada — Configurar servidor ahora separa Vista general, Canales, Roles y Auditoría; Miembros tiene una pantalla propia para mover personas, asignar roles y aplicar sanciones.',
          'Selección múltiple — las personas autorizadas pueden usar Ctrl + clic para elegir miembros concretos y moverlos juntos arrastrando o con la nueva barra de destino; ServerHost valida cada persona por separado.',
          'Backup portátil de ServerHost — un único archivo verificado guarda ajustes, salas, canales, mensajes, roles, permisos, moderación, informes, auditoría y datos de plugins para mover el servidor a otro PC.',
          'Restauración segura — ServerHost verifica integridad y rutas, crea una copia automática del estado actual, restaura los datos y reinicia; los plugins externos vuelven a requerir aprobación.',
          'Canales completos desde el Client — los miembros con permiso para gestionar canales reciben botones + Voz y + Texto, la lista actual y un editor sin intervención del operador del ServerHost.',
          'Configuración según el tipo — voz incluye posición, categoría, límite, bitrate, región y bloqueo; texto incluye posición, categoría, tema, cooldown y solo lectura.',
          'Visibilidad por rol — cada canal puede ser público o limitarse a roles elegidos; listado, entrada, historial y mensajes se filtran y validan en el servidor.',
          'Gestión desde el Client — un miembro autorizado puede pulsar sobre otra persona y acceder directamente a Mover, Roles y Sanciones sin intervención del operador del ServerHost.',
          'Mover arrastrando — las personas autorizadas pueden arrastrar un miembro a otro canal de voz o fuera de la llamada; permiso, jerarquía, destino y capacidad siguen validados y auditados por el servidor.',
          'Roles con color, jerarquía editable y siete permisos validados por el servidor.',
          'Las personas autorizadas pueden ajustar políticas del chat, crear canales, mover usuarios, moderar y asignar roles desde el Client.',
          'Los permisos se vinculan a la identidad criptográfica persistente; los clientes antiguos siguen conectando sin permisos administrativos.',
          'Auditoría de seguridad guardada en disco sin mensajes, contraseñas ni claves.',
          'Sonidos distintos para servidor, llamada y entrada o salida de directos.',
          'Progreso de actualización temático y minimizable con instalación silenciosa en Windows.',
          'El perfil, los servidores guardados, las salas, los roles, los plugins y las preferencias se conservan.'
        ]
      },
      'fr-FR': {
        title: 'VoiceUP 1.2.2 bêta 11', subtitle: 'Onzième bêta locale après la v1.2.1. Rien n’a été publié.',
        notes: [
          'Types de salons — Scène, Forum et salon dynamique sont disponibles dans l’éditeur Client et ServerHost; le Forum organise les échanges par sujets et étiquettes.',
          'Appels temporaires — entrer dans un salon dynamique crée un appel limité, y déplace la personne et le supprime lorsqu’il est vide.',
          'Groupes de rôles — les rôles peuvent séparer leurs membres tout en conservant l’ordre alphabétique.',
          'Aperçu TXT sans coupure — les textes, URL et mots très longs reviennent maintenant à la ligne dans la carte, tout en conservant les sauts de ligne et sans défilement horizontal.',
          'Code dans le chat — les blocs entre trois accents graves acceptent le langage sur la première ligne, bénéficient d’une coloration sûre et d’un bouton de copie sans jamais exécuter leur contenu.',
          'Texte long sous forme de fichier — les messages humains de plus de 500 caractères deviennent automatiquement un mensagem.txt avec aperçu repliable, taille, copie et téléchargement ; ServerHost et Cloud valident et conservent la pièce jointe.',
          'Hiérarchie stricte — même les administrateurs ne peuvent modifier que les rôles et personnes placés sous leur propre niveau ; des administrateurs équivalents ne peuvent ni retirer leurs rôles, ni se déplacer, ni se sanctionner.',
          'Administration réorganisée — Configurer le serveur sépare désormais Vue d’ensemble, Salons, Rôles et Audit ; Membres possède sa propre page pour déplacer, attribuer des rôles et sanctionner une personne.',
          'Sélection multiple — les personnes autorisées peuvent utiliser Ctrl + clic pour choisir des membres précis et les déplacer ensemble par glisser-déposer ou avec la nouvelle barre de destination ; chaque personne reste validée séparément par le ServerHost.',
          'Sauvegarde portable du ServerHost — un fichier vérifié conserve réglages, salles, salons, messages, rôles, permissions, modération, rapports, audit et données des plugins pour déplacer le serveur vers un autre PC.',
          'Restauration sûre — le ServerHost vérifie l’intégrité et les chemins, sauvegarde automatiquement l’état actuel, restaure les données puis redémarre ; les plugins externes doivent être approuvés à nouveau.',
          'Salons complets depuis le Client — les membres autorisés disposent des boutons + Vocal et + Texte, de la liste actuelle et d’un éditeur sans intervention de l’opérateur du ServerHost.',
          'Réglages adaptés au type — vocal : position, catégorie, limite, débit, région et verrouillage ; texte : position, catégorie, sujet, délai et lecture seule.',
          'Visibilité par rôle — chaque salon peut être public ou limité à certains rôles ; liste, accès, historique et messages sont filtrés et validés par le serveur.',
          'Gestion depuis le Client — un membre autorisé peut cliquer sur une personne et accéder directement au déplacement, aux rôles et aux sanctions sans intervention de l’opérateur du ServerHost.',
          'Déplacement par glisser-déposer — les personnes autorisées peuvent déplacer un membre vers un autre salon vocal ou hors appel ; permission, hiérarchie, destination et capacité restent validées et auditées par le serveur.',
          'Rôles colorés avec hiérarchie et sept permissions validées par le serveur.',
          'Les personnes autorisées peuvent régler les politiques du chat, créer des salons, déplacer des membres, modérer et attribuer des rôles dans le Client.',
          'Les permissions sont liées à l’identité cryptographique persistante ; les anciens Clients restent compatibles sans droits administratifs.',
          'Journal de sécurité enregistré sur disque sans messages, mots de passe ni clés.',
          'Sons distincts pour le serveur, l’appel et l’ouverture ou la fermeture d’un direct.',
          'Progression de mise à jour thématique et réductible avec installation silencieuse sous Windows.',
          'Profil, serveurs enregistrés, salons, rôles, plugins et préférences sont conservés.'
        ]
      }
    }
  };
  const stableHistory = {
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
  const currentStableHistory = {
    from: '1.2.1', version: '1.2.2',
    locales: {
      'pt-BR': { title: 'Novidades do VoiceUP 1.2.2', subtitle: 'Mudanças da v1.2.1 para a v1.2.2.', notes: [
        'Desktop e SelfWeb — administração por cargos, hierarquia de permissões, canais de palco, fórum e calls dinâmicas, com recursos sujeitos à plataforma e ao servidor conectado.',
        'ServerHost — backup portátil com restauração, auditoria e configurações persistentes; membros autorizados podem gerenciar canais e pessoas pelo Client.',
        'Chat — anexos permitidos pelo host, prévias de imagens e arquivos de código, expansão com KB restantes, mensagens de voz e blocos entre três crases.',
        'Prévias de links — novas mensagens preservam os players já carregados e avisos de incompatibilidade deixam de virar descrições dos cartões.',
        'Desktop — recuperação de atualizações interrompidas, progresso temático, instalação silenciosa, acessibilidade e atalhos personalizáveis.',
        'Chamadas — tela cheia imersiva, ajuste por espectador limitado pelo transmissor, reconexão e melhorias de estabilidade das lives.',
        'Windows — ditado pelo recurso nativo Win + H, preenchendo o rascunho para revisão antes do envio.',
        'Android — atualização da edição mobile trabalhada, com identidade protegida, ícones de plataforma e distribuição APK e Play separadas. Os recursos novos do desktop não estão todos disponíveis no mobile.',
        'Compatibilidade — protocolo anterior preservado e atualizações verificadas com Ed25519 e SHA-256. Versões 1.1.0 e 1.1.1 podem exigir transição manual por uma URL antiga incorreta.'
      ] },
      'en-US': { title: 'What is new in VoiceUP 1.2.2', subtitle: 'Changes from v1.2.1 to v1.2.2.', notes: [
        'Desktop and SelfWeb — role administration, permission hierarchy, stage, forum and dynamic channels, depending on the platform and connected server.',
        'ServerHost — portable backup and restore, persistent settings and audit, and authorized Client-side channel and member management.',
        'Chat — host-controlled attachments, code previews with remaining bytes, voice messages and fenced code; existing link players survive new messages.',
        'Desktop — update recovery, silent installation, accessibility, shortcuts, immersive fullscreen and improved stream stability.',
        'Android — release of the developed mobile edition with protected identity and separate APK and Play channels; desktop feature parity is not implied.',
        'Compatibility — existing protocol and signed update manifests preserved; 1.1.0 and 1.1.1 may require a manual transition because of an old URL bug.'
      ] },
      'es-ES': { title: 'Novedades de VoiceUP 1.2.2', subtitle: 'Cambios de la v1.2.1 a la v1.2.2.', notes: [
        'Desktop y SelfWeb — administración por roles, jerarquía de permisos, foros y canales dinámicos según la plataforma y el servidor conectado.',
        'ServerHost — copias portátiles con restauración, auditoría y administración de canales y miembros desde clientes autorizados.',
        'Chat — adjuntos autorizados por el host, vista previa de código con bytes restantes y reproductores que se conservan al llegar mensajes nuevos.',
        'Desktop — recuperación de actualizaciones, instalación silenciosa, accesibilidad, atajos y mejoras de pantalla completa y transmisiones.',
        'Android — publicación de la edición móvil desarrollada; no incluye todas las funciones nuevas del escritorio y mantiene separados los canales APK y Play.',
        'Compatibilidad — protocolo anterior y manifiestos firmados preservados; 1.1.0 y 1.1.1 pueden necesitar una transición manual por una URL antigua incorrecta.'
      ] }
    }
  };
  for (const catalog of [stableHistory, betaHistory, currentStableHistory]) {
    for (const value of Object.values(catalog.locales)) { Object.freeze(value.notes); Object.freeze(value); }
    Object.freeze(catalog.locales); Object.freeze(catalog);
  }
  if (typeof module === 'object' && module.exports) module.exports = currentStableHistory;
  // Stable consumers keep the official catalog. Desktop betas opt into the
  // separate beta catalog only when the running binary has the same version.
  if (typeof module !== 'object' || !module.exports || typeof window !== 'undefined') {
    scope.voiceupReleaseHistory = currentStableHistory;
    scope.voiceupBetaReleaseHistory = betaHistory;
  }
})(globalThis);
