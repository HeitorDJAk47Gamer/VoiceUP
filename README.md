# VoiceUp

Aplicativo desktop simples de comunicação por voz e mensagens, usando WebRTC para conexão P2P sem servidor central.

## Executar durante o desenvolvimento

```powershell
npm start
```

## Criar o instalador do Windows

```powershell
npm run dist
```

O instalador `.exe` será criado na pasta `release`.

## Como conectar duas pessoas

1. Uma pessoa seleciona **Criar convite P2P** e envia o código exibido por WhatsApp, e-mail ou outro canal.
2. A outra cola o convite, seleciona **Entrar com convite** e devolve o código de resposta.
3. Quem criou o convite cola a resposta e seleciona **Conectar agora**.

Depois disso, voz e mensagens trafegam diretamente entre os dois aplicativos, sem conta ou servidor de aplicação.

> Sem um serviço externo de descoberta, conexões entre redes domésticas diferentes podem ser bloqueadas pelos roteadores (NAT). Esta versão sem servidor funciona melhor na mesma rede Wi-Fi/LAN ou se ao menos um dos participantes tiver endereço público acessível.
