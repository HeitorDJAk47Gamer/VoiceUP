# Plugins do VoiceUP Server (beta)

Cada arquivo `.js` desta pasta é carregado ao iniciar o Server Host. No aplicativo instalado, a pasta editável fica em `%APPDATA%\\VoiceUP\\plugins`; os três exemplos são copiados para ela no primeiro uso.

No ShardCloud, envie a pasta `plugins` junto com `index.js` no ZIP. Reinicie/republique o servidor após adicionar ou alterar um plugin.

> Segurança: plugins executam código JavaScript no computador ou Cloud que hospeda o servidor. Instale somente arquivos que você confia.

## API beta

Um plugin exporta `id`, `name`, `version`, `description` e `onTextMessage(contexto)`. O contexto inclui `text`, `room`, `textChannel`, `user`, `serverIsCloud`, `plugin` e `api`.

Use `api.systemMessage(room, textChannel, texto, opcoes)` para publicar uma mensagem do bot. Não há acesso direto ao socket dos participantes.

## Exemplos inclusos

- `dados.js`: responda com `d20`, `2d6+3` ou `4d8 - 1`.
- `musica.js`: `!music help`, `!music play <link>`, `!music queue`, `!music skip`. A beta controla a fila; ela ainda não transmite áudio de YouTube/arquivo para a chamada.
- `xp-chat.js`: ganha XP ao conversar e mostra o status com `!xp`. Dados em memória, reiniciam junto do servidor.
