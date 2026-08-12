# Plugins do VoiceUP Server (beta)

Cada arquivo `.js` desta pasta e carregado ao iniciar o Server Host. No aplicativo instalado, a pasta editavel fica em `%APPDATA%\\VoiceUP\\plugins`; os exemplos sao copiados para ela no primeiro uso.

No ShardCloud, envie a pasta `plugins` junto com `index.js` no ZIP. Reinicie ou republique o servidor apos alterar um plugin.

> Seguranca: plugins executam JavaScript no computador ou Cloud que hospeda o servidor. Instale somente arquivos confiaveis.

## API beta

Um plugin exporta `id`, `name`, `version`, `description` e `onTextMessage(contexto)`. O contexto inclui `text`, `room`, `textChannel`, `user`, `serverIsCloud`, `plugin` e `api`.

Use `api.systemMessage(room, textChannel, texto, opcoes)` para publicar uma mensagem do bot. Nao ha acesso direto ao socket dos participantes.

## Exemplos inclusos

- `dados.js`: responda com `d20`, `2d6+3` ou `4d8 - 1`.
- `musica.js`: coloque arquivos MP3/OGG/WAV/M4A/AAC na pasta `music` do Server Host. Use `!music list`, `!music play <nome>`, `!music queue`, `!music skip` e `!music stop`. O Music Bot entra no canal de voz e envia o audio pela chamada WebRTC; os clientes nao baixam o arquivo.
- `xp-chat.js`: ganha XP ao conversar e mostra o status com `!xp`. Dados em memoria, reiniciam junto do servidor.
