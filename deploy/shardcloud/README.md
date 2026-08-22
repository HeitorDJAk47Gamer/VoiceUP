# VoiceUP Server Cloud

Este pacote hospeda apenas a sinalizacao das chamadas. Audio, video, tela e chat seguem diretamente entre os clientes apos a conexao P2P.

O pacote e independente da plataforma: qualquer hospedagem Node.js que aceite WebSocket/Socket.IO e exponha a porta definida em `PORT` pode executa-lo.

## Como publicar

1. Compacte o conteudo desta pasta em um `.zip` - nao inclua `node_modules`.
2. No painel ShardCloud, envie o arquivo `.zip` como uma aplicacao Node.js.
3. Apos o deploy, a ShardCloud mostrara o subdominio HTTPS do app.
4. Use no cliente o endereco mostrado, como `https://SEU_SUBDOMINIO.shardweb.app`.
5. Todos entram usando esse endereco e o mesmo codigo de sala.

O pacote ja inclui `SUBDOMAIN=voiceup`. Se precisar trocar, altere somente esse valor no arquivo `.shardcloud` (use letras e numeros).

## Mensagens persistentes e limpeza

O chat e os relatorios de bugs ficam no banco SQLite `data/voiceup.db`. O servidor consulta o banco sob demanda e nao mantem o historico inteiro em RAM.

Ao iniciar pela primeira vez, o pacote importa automaticamente os antigos `data/chat-history.json` e `data/bug-reports.json`, caso existam. Esses arquivos JSON sao preservados como copia de seguranca e nao sao mais alterados.

Em uma hospedagem com volume persistente, aponte `VOICEUP_DATA_DIR` para esse volume. Sem um volume persistente, os arquivos podem ser reiniciados quando a plataforma refizer o container.

Este pacote requer Node.js 22.13 ou superior. A configuracao Node.js 24 da ShardCloud e compativel.

Variaveis opcionais:

- `VOICEUP_CHAT_RETENTION_DAYS=30`: apaga automaticamente mensagens mais antigas. Use `0` para nao apagar por idade.
- `VOICEUP_CHAT_MAX_PER_ROOM=300`: quantidade maxima mantida por sala.
- `VOICEUP_MAX_HUMANS_PER_CALL=12`: limite de pessoas em cada call.
- `VOICEUP_MAX_MEMBERS_PER_CALL=15`: limite total, incluindo bots.

## Salas privadas

Use `VOICEUP_ROOM_PASSWORDS` como um objeto JSON. A senha recomendada e um hash scrypt, nunca o texto visivel. Exemplo:

`{"amigos":"scrypt$SALT$HASH"}`

Gere o valor localmente com Node.js, trocando `MINHA_SENHA`:

`node -e "const c=require('crypto'),s=c.randomBytes(16),p='MINHA_SENHA';console.log('scrypt$'+s.toString('hex')+'$'+c.scryptSync(p,s,32).toString('hex'))"`

O formato antigo com senha direta continua aceito apenas para compatibilidade, mas nao e recomendado.

## Recursos

512 MB sao configurados no arquivo `.shardcloud`; 1 GB e mais que suficiente para esta funcao. A ShardCloud instala as dependencias definidas em `package.json`.

Use `/status` para a pagina publica de disponibilidade, `/health` para o diagnostico tecnico completo e `/api/status` para os numeros publicos agregados. Politica de Privacidade e Termos de Uso ficam em `/privacidade` e `/termos`.

O catalogo de plugins fica em `/plugins`. Os downloads oficiais ficam em
`/downloads/plugins/dados`, `/downloads/plugins/musica` e
`/downloads/plugins/xp-chat`.

## Limite importante

O servidor Cloud elimina Radmin para entrar na sala, mas a midia ainda e P2P. Redes muito restritas podem precisar de um servidor TURN no futuro.

## Music Bot

O plugin Music Bot com audio dentro da chamada funciona no VoiceUP Server Host para Windows; o Cloud precisaria de um processo de bot adicional.
