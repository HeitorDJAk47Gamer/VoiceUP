# VoiceUP 1.2.1

O que mudou da v1.2.0 para a v1.2.1.

- Áudio das transmissões no Windows — captura separada por janela ou da tela inteira, com o próprio VoiceUP excluído quando possível; microfone e som compartilhado continuam em faixas independentes.
- Estabilidade de mídia — correções para áudio ausente nas lives, FPS mais constante em jogos, cursor local em tela cheia e troca simultânea entre câmera e compartilhamento.
- Layout da call — participantes em blocos quadrados e responsivos; durante uma live, a faixa de participantes fica abaixo e pode ser recolhida, mantendo zoom e tela cheia por transmissão.
- Presença — ícones compactos de plataforma e estado, indicadores de mute, câmera e Ao vivo reposicionados para não cobrir a foto ou criar bordas excessivas.
- Temas — 14 gradientes escuros e 5 claros, separados das cores sólidas em categorias próprias no seletor.
- Inicialização no Windows — nova opção para abrir o Client junto com o sistema, desativada por padrão e disponível somente no aplicativo instalado.
- Moderação no ServerHost e Cloud — cooldown configurável de mensagens, castigo de chat e limite editável de 500 a 10.000 caracteres para respostas de plugins.
- Persistência — políticas de chat e castigos são gravados no banco SQLite; os dados continuam após reiniciar o ServerHost ou Cloud.
- Métricas do ServerHost — ping em milissegundos aparece diretamente ao lado das barras de qualidade da rede, sem depender do mouse.
- Android — identidade visual do VoiceUP, canais de voz e texto, controles compactos da call e ferramentas de mensagens reorganizadas para toque.
- Compatibilidade e distribuição — protocolo preservado com a 1.2.0 e publicação atômica com manifesto Ed25519, SHA-256 e os nomes históricos dos instaladores para evitar Release incompleta ou erro 404.

## Atualização de versões anteriores

- `1.0.25`, `1.1.2` e `1.2.0`: o atualizador encontra os instaladores oficiais `VoiceUP.Setup.1.2.1.exe` e `VoiceUPServer.Setup.1.2.1.exe`.
- `1.1.0` e `1.1.1`: essas versões antigas gravaram no próprio aplicativo uma URL com espaços que o GitHub responde com 404. Elas precisam de uma única instalação manual de transição; depois da `1.2.1`, as próximas atualizações voltam a funcionar pelo aplicativo.
- Android `1.2.0`: o APK `1.2.1` mantém a mesma chave de assinatura e pode ser instalado por cima sem apagar o perfil.

As funções de captura de áudio por processo e inicialização com o sistema são exclusivas do Windows. Linux, Android e SelfWeb mantêm as limitações informadas para cada plataforma. A assinatura Ed25519 e o SHA-256 protegem a integridade interna dos downloads, mas não substituem um certificado comercial Authenticode; o Windows ainda pode exibir um aviso do SmartScreen.
