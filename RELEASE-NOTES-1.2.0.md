# VoiceUP 1.2.0

O que mudou da v1.1.2 para a v1.2.0.

- Plataformas — novas edições para Linux, Android e SelfWeb, o cliente leve em um arquivo HTML. Os recursos disponíveis dependem da plataforma e do navegador.
- Presença — ícones de Windows, Linux, Android e Web nas cores Online, Ausente e Não perturbe. Clientes antigos continuam com o indicador de status compatível.
- Início do Client — perfil com foto clicável, conexão com servidor em destaque, convites P2P abaixo e formulário centralizado com rolagem.
- Canais de voz — membros em ordem alfabética abaixo de cada canal, ícones de microfone/fone mutados ao lado do nick, indicador Ao vivo e câmera.
- Duração da call — contador na cor do tema enquanto o canal estiver ocupado; reinicia quando o último participante sai.
- Transmissões no Desktop — grade para assistir a várias lives e câmeras juntas, zoom e tela cheia individual por bloco.
- Avisos sonoros — entrada e saída da call, sons próprios para espectadores da live e contagem de quem está assistindo na prévia do transmissor.
- Áudio no Desktop — sensibilidade automática e ajustes de supressão/eco; RNNoise opcional, processado localmente, com correção do microfone silencioso e retorno ao filtro padrão se o modo não iniciar.
- Jogos no Windows — ajustes para priorizar FPS da live, manter a captura em segundo plano e um modo de compatibilidade para o cursor local em jogos de tela cheia.
- Interface — ajustes de organização e salvamento das configurações, rolagem, contraste e correções dos indicadores de mute que se acumulavam.
- Reconexão — tratamento de sessões antigas para reduzir participantes duplicados ou silenciosos após oscilações de rede, no ServerHost e no Cloud.
- ServerHost — edição Linux, identificação de plataforma dos participantes, aceleração de hardware configurável e instalação separada do Client no Windows.
- ServerHost e Cloud — validações adicionais de identidade, bots, eventos e acesso a salas; limites contra abuso e proteção de diagnósticos.
- Privacidade — mídia externa sob consentimento, confirmação antes de abrir portas via UPnP/NAT-PMP e aprovação de plugins externos pelo hash do arquivo.
- Segurança — identidade com chave local, dependências atualizadas e restrições adicionais de navegação, scripts e permissões no aplicativo.
- Distribuição — verificação criptográfica dos pacotes e SHA-256 no atualizador; o certificado comercial do Windows não é obrigatório. Isso não elimina os avisos do SmartScreen.
- Site — downloads organizados por plataforma, SelfWeb, requisitos mínimos/recomendados e orientações para hospedar um ServerHost.

As funções exclusivas do Desktop/Windows estão identificadas acima. Linux, Android e SelfWeb têm limitações próprias de captura, permissões e execução em segundo plano; não se promete paridade total entre plataformas.
