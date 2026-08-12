# VoiceUP Server Cloud — ShardCloud

Este pacote hospeda apenas a sinalização das chamadas. Áudio, vídeo, tela e chat seguem diretamente entre os dois clientes após a conexão P2P.

## Como publicar

1. Compacte o conteúdo desta pasta em um `.zip` — não inclua `node_modules`.
2. No painel ShardCloud, envie o arquivo `.zip` como uma aplicação Node.js.
3. Após o deploy, a ShardCloud mostrará o subdomínio HTTPS do app.
4. Use no cliente o endereço mostrado, como `https://SEU_SUBDOMINIO.shardweb.app`.
5. Todos entram usando esse endereço e o mesmo código de sala.

Se quiser escolher o seu próprio subdomínio antes do upload, acrescente ao arquivo `.shardcloud` uma linha como `SUBDOMAIN=voiceupgoatgank` (somente letras e números).

## Recursos

512 MB são configurados no arquivo `.shardcloud`; 1 GB é mais que suficiente para esta função. A ShardCloud instala as dependências definidas em `package.json`.

## Limite importante

O servidor cloud elimina Radmin para entrar na sala, mas a mídia ainda é P2P. Redes muito restritas podem precisar de um servidor TURN no futuro.
