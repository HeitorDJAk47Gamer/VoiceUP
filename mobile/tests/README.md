# Teste de navegação dos canais

Na pasta `mobile`, execute `npm run build` e depois
`node tests/serve-channels.cjs`.

Antes do teste visual, execute também `npm test`. Os testes unitários cobrem
menções, autoria persistente, identidade criptográfica, formatação segura,
embeds, organização dos canais, duração da call, ping e limites de volume.

O aplicativo de teste fica em `http://127.0.0.1:5181/`. Use o host
`http://127.0.0.1:3181` e uma destas salas:

- `mobile-test`: três canais de voz e três de texto;
- `mobile-long`: 24 canais de voz e 24 de texto, sem o canal padrão `geral`.

Confira em 390×844, 320×568 e 844×390:

1. Entrar no servidor abre a aba Canais, sem entrar automaticamente em voz.
2. Voz e texto aparecem; a lista rola sem deslocar o rodapé ou aumentar a página.
3. Selecionar uma voz abre a call. Voltar a Canais permite mudar de voz; tocar
   na voz já ativa reabre a call.
4. Selecionar um texto abre a conversa correta. Mensagens não aparecem em outros
   canais, e voltar ao canal mostra o histórico da sessão.
5. Chat e Membros não encerram a call. A contagem e a lista alfabética do canal
   acompanham a presença, o mute, a câmera e a live.
6. O último canal de uma lista grande continua acessível em retrato e paisagem.
7. A sala sem `geral` seleciona seu primeiro canal de texto válido.
8. Chat permite responder, reagir, fixar, editar e apagar mensagens próprias.
9. Ajustes mostra volumes, processamento de áudio, câmera, vibração, privacidade
   de mídias externas, fluidez da live, versão e ping.
10. A barra inferior mantém as cinco abas acessíveis em 320×568 e 844×390.

O servidor e os dados são locais e temporários. O fixture substitui o microfone
por uma faixa silenciosa gerada, sem pedir permissões ou captar áudio real.
Portanto ele valida navegação/sinalização, não a qualidade de áudio nem as
permissões em um Android real. Esse código de teste não entra no APK.

Finalize com Ctrl+C depois do teste.
