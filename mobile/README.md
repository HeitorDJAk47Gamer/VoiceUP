# VoiceUP Mobile (React + Capacitor)

Cliente Android do VoiceUP, mantido separadamente do aplicativo Windows. O
mobile entra nos mesmos ServerHosts e servidores Cloud sem modificar os
instaladores desktop já publicados.

## Compatibilidade

A edição **1.2.0** mantém o protocolo compatível com **VoiceUP 1.1.2** e
adapta os recursos de servidor e cliente para o celular.

### Servidores e perfil

- perfil local com avatar, cor e status Online, Ausente ou Não perturbe;
- servidores salvos, salas privadas e remoção de servidores da lista;
- canais de voz e texto definidos pelo ServerHost, inclusive canais bloqueados,
  somente leitura e com modo lento;
- presença, ping, estado de microfone/áudio e identificação de bots;
- identidade criptográfica local e substituição segura de sessões duplicadas;
- participantes em ordem alfabética sob cada canal de voz, com duração da call,
  microfone desligado e indicadores de câmera/live;
- reconexão automática, retorno ao canal ativo e migração entre hosts de um
  cluster compatível;
- mensagens claras ao receber expulsão ou banimento.

### Chat

- histórico e separação por canal;
- respostas, edição e exclusão das próprias mensagens;
- reações e mensagens fixadas;
- menções com destaque e aviso de mensagens não lidas;
- texto em negrito, itálico, código, links seguros, imagens, GIFs diretos e
  prévia de vídeos do YouTube;
- consentimento antes de carregar mídia externa, com liberação automática
  opcional nos Ajustes;
- indicador de digitação entre participantes conectados à mesma call;
- vibração opcional para novas mensagens.

### Chamadas e mídia

- áudio WebRTC em malha P2P, câmera e múltiplas transmissões simultâneas;
- microfone e áudio recebido independentes;
- volume global de vozes e transmissões, além de volume/silenciamento por
  participante;
- áudio de compartilhamento de tela separado da voz quando o Android oferece a
  faixa de áudio;
- cancelamento de eco, redução de ruído e ganho automático configuráveis;
- câmera frontal/traseira, qualidade 480p/720p e troca durante a call;
- tela cheia para câmeras e transmissões;
- grade para múltiplas câmeras/lives, indicador “Ao vivo” e contagem de quem
  assiste à transmissão iniciada no celular;
- ajuste WebRTC que prioriza quadros por segundo nas transmissões, desativável
  para favorecer detalhes da imagem;
- navegação entre Canais, Call, Chat, Membros e Ajustes sem desmontar o áudio.

## Limitações do Android

O compartilhamento de tela usa `getDisplayMedia` e depende da versão do Android
e do WebView do aparelho. Alguns dispositivos disponibilizam vídeo sem o áudio
do sistema. Hospedar um ServerHost, capturar o áudio de processos do Windows,
UPnP/NAT-PMP e instalar plugins continuam sendo funções do desktop/servidor.

O aplicativo pede autorização de microfone e câmera quando cada recurso é usado.
ServerHosts locais em `http://` são permitidos para testes na mesma rede; em um
servidor público, use `https://`.

## APK de teste

Depois de gerar a beta 4, o APK distribuível fica em:

`../test-1.1.3-mobile-beta.5/VoiceUP-1.1.3-mobile-beta.5.apk`

O pacote de teste usa a assinatura de desenvolvimento do Android. Ele pode ser
instalado sobre as betas 2 e 3 e preserva perfil, servidores e preferências
locais.

## Desenvolver e validar

```powershell
cd mobile
npm install
npm test
npm run build
```

Para preparar o projeto Android:

```powershell
npm run sync
npx cap open android
```

Use Android 15 / API 35 e as Build Tools correspondentes. O script detecta um
Java compatível com o Gradle (17 a 23) e um compilador Java 21 ou mais recente.
Também é possível indicar os caminhos com `VOICEUP_GRADLE_JAVA_HOME` e
`VOICEUP_JAVA_COMPILER_HOME`. O projeto aceita Android 6.0 (API 23) ou superior.

```powershell
npm run apk:debug
```

O Gradle cria o APK intermediário em
`android/app/build/outputs/apk/debug/app-debug.apk`.
