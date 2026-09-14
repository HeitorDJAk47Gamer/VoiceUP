# VoiceUP Mobile (React + Capacitor)

Cliente Android do VoiceUP, mantido separadamente do aplicativo Windows. O
mobile entra nos mesmos ServerHosts e servidores Cloud sem modificar os
instaladores desktop já publicados.

## Compatibilidade

A edição **1.2.2-mobile-beta.1** mantém o protocolo compatível com **VoiceUP 1.1.2+** e
adapta os recursos de servidor e cliente para o celular.

Nesta versão, o ícone e a tela de abertura do Android usam a identidade do
VoiceUP. Os controles da call e as ferramentas das mensagens usam ícones
compactos, enquanto a saída do servidor ganhou um botão maior em vermelho.

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
- compartilhamento nativo da tela inteira, sem seletor de janelas, com escolha
  entre vídeo com ou sem áudio do sistema;
- áudio de compartilhamento separado da voz no Android 10 ou superior, quando
  o conteúdo aberto permite sua captura;
- cancelamento de eco, redução de ruído e ganho automático configuráveis;
- câmera frontal/traseira, qualidade 480p/720p e troca durante a call;
- tela cheia para câmeras e transmissões;
- grade para múltiplas câmeras/lives, indicador “Ao vivo” e contagem de quem
  assiste à transmissão iniciada no celular;
- ajuste WebRTC que prioriza quadros por segundo nas transmissões, desativável
  para favorecer detalhes da imagem;
- navegação entre Canais, Call, Chat, Membros e Ajustes sem desmontar o áudio.

## Limitações do Android

O compartilhamento usa a autorização `MediaProjection` do próprio Android e
mantém uma notificação visível enquanto estiver ativo. O áudio do sistema exige
Android 10 ou superior e pode ser bloqueado pelo aplicativo que estiver
reproduzindo o conteúdo; nesse caso, a imagem continua sem áudio. A ponte desta
beta precisa de validação em aparelho físico, principalmente ao trocar de app,
girar a tela e compartilhar por períodos longos. Hospedar um ServerHost,
capturar áudio de processos do Windows, UPnP/NAT-PMP e instalar plugins
continuam sendo funções do desktop/servidor.

O aplicativo pede autorização de microfone e câmera quando cada recurso é usado.
ServerHosts locais em `http://` são permitidos para testes na mesma rede; em um
servidor público, use `https://`.

## Distribuição Android

O artefato desta beta deve ser identificado como:

`VoiceUP-1.2.2-mobile-beta.1.apk` (teste local) ou
`VoiceUP-1.2.2-android.apk` (catálogo estável futuro)

O APK consulta manualmente o catálogo assinado em **Ajustes > Atualizações do
APK** e abre somente o download oficial. O Android mantém as confirmações de
instalação; o aplicativo não instala atualizações silenciosamente.

Por padrão, o Gradle compila o canal `apk`. A edição da Play Store deve
ser criada com `-PvoiceupDistributionChannel=play`; nela, o botão de download
externo é removido da interface e bloqueado também pela ponte nativa:

```powershell
cd mobile
npm run aab:play
```

O primeiro build Play precisa de uma chave de upload. O VoiceUP mantém essa
chave fora do repositório e protege a senha com a conta atual do Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/setup-play-signing.ps1
npm run aab:play
```

Guarde a pasta `%USERPROFILE%\.voiceup\android-signing` em local privado. A
credencial automática é protegida pela conta atual do Windows; se essa chave for
perdida, solicite a redefinição da chave de upload no Play Console. Ela é
separada da chave de assinatura que fica protegida pelo Play App Signing. Nunca
adicione a chave ou suas credenciais ao Git.

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

Os ícones e splashes já ficam versionados. Se a arte principal mudar, regenere-os
com Python e Pillow antes do `sync`:

```powershell
python tools/generate-android-brand-assets.py
```

Use Android 16 / API 36 e as Build Tools correspondentes. O script detecta um
Java compatível com o Gradle (17 a 23) e um compilador Java 21 ou mais recente.
Também é possível indicar os caminhos com `VOICEUP_GRADLE_JAVA_HOME` e
`VOICEUP_JAVA_COMPILER_HOME`. O projeto aceita Android 6.0 (API 23) ou superior.

```powershell
npm run apk:debug
```

O Gradle cria o APK intermediário em
`android/app/build/outputs/apk/debug/app-debug.apk`.
