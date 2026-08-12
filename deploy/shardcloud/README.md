# VoiceUP Server Cloud - ShardCloud

Este pacote hospeda apenas a sinalizacao das chamadas. Audio, video, tela e chat seguem diretamente entre os clientes apos a conexao P2P.

## Como publicar

1. Compacte o conteudo desta pasta em um `.zip` - nao inclua `node_modules`.
2. No painel ShardCloud, envie o arquivo `.zip` como uma aplicacao Node.js.
3. Apos o deploy, a ShardCloud mostrara o subdominio HTTPS do app.
4. Use no cliente o endereco mostrado, como `https://SEU_SUBDOMINIO.shardweb.app`.
5. Todos entram usando esse endereco e o mesmo codigo de sala.

Se quiser escolher seu proprio subdominio antes do upload, acrescente ao arquivo `.shardcloud` uma linha como `SUBDOMAIN=voiceupgoatgank` (somente letras e numeros).

## Recursos

512 MB sao configurados no arquivo `.shardcloud`; 1 GB e mais que suficiente para esta funcao. A ShardCloud instala as dependencias definidas em `package.json`.

## Limite importante

O servidor Cloud elimina Radmin para entrar na sala, mas a midia ainda e P2P. Redes muito restritas podem precisar de um servidor TURN no futuro.

## Music Bot

O plugin Music Bot com audio dentro da chamada funciona no VoiceUP Server Host para Windows; o Cloud precisaria de um processo de bot adicional.
