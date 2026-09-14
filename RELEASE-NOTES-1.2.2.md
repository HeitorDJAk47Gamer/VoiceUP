# VoiceUP 1.2.2

Mudanças desde 1.2.1:

- Desktop e SelfWeb: administração por cargos e permissões, fóruns, canais dinâmicos, acessibilidade, melhorias de chat e chamadas conforme os recursos da plataforma.
- ServerHost: backup portátil, restauração, auditoria e administração pelo Client autorizado.
- Chat: arquivos autorizados pelo host, prévias de código com KB restantes, mensagens de voz, múltiplos anexos e players preservados ao receber novas mensagens.
- Windows: ditado nativo pelo Win + H, atualização silenciosa com recuperação e preservação do perfil.
- Linux: a base atual do desktop; captura de tela depende do ambiente gráfico, e áudio isolado de aplicativos não está disponível.
- Android: promoção da edição mobile desenvolvida, identidade protegida, presença por plataforma e canais de distribuição separados. Não inclui todas as funções administrativas e de chat novas do desktop.
- Cloud: promoção do servidor de sinalização desenvolvido, preservando o protocolo anterior. Recursos exclusivos de administração e anexos do ServerHost não são prometidos no Cloud.

## Atualização

1.0.25, 1.1.2, 1.2.0 e 1.2.1 reconhecem os nomes oficiais dos instaladores. As versões 1.1.0 e 1.1.1 usam uma URL antiga com espaços e podem exigir uma instalação manual de transição. Instale o Client sobre o Client ou o ServerHost sobre o ServerHost; os dados persistentes ficam separados dos arquivos do programa.

Manifestos Ed25519 e hashes SHA-256 acompanham os pacotes. O pacote Microsoft Store usa 1.2.2.0 e precisa ser enviado pelo responsável ao Partner Center; a release no GitHub não equivale à publicação nas lojas. O AAB Play usa a identidade de upload já configurada, com atualização pela loja.

Os testes automatizados de código, protocolo e empacotamento não substituem validação física em todas as distribuições Linux e aparelhos Android.
