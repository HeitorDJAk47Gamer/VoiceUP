# Plugins do VoiceUP Server

Plugins são módulos JavaScript executados **no ServerHost ou no Cloud**, nunca
no computador de cada participante. Cada arquivo `.js` colocado diretamente
nesta pasta é carregado quando o servidor inicia ou quando o host usa
**Plugins > Recarregar plugins**.

> Plugins executam código com as permissões do servidor. Instale somente
> arquivos de autores em quem você confia.

## Instalação

1. Baixe o arquivo `.js` do plugin.
2. Abra o painel do VoiceUP ServerHost e entre na página **Plugins**.
3. Clique em **Abrir pasta de plugins**.
4. Coloque o `.js` nessa pasta, sem criar outra subpasta.
5. Clique em **Recarregar plugins** ou reinicie o servidor.
6. Use o Toggle Switch do card para habilitar/desabilitar e abra **Editar
   opções** para configurar o plugin.

No projeto Cloud, copie o `.js` para a pasta `plugins` enviada à hospedagem e
reinicie/reimplante a aplicação. As opções e dados persistentes usam o arquivo
definido por `PLUGIN_STATE_FILE`; confirme que a hospedagem oferece disco
persistente antes de depender desses dados.

## Plugins oficiais incluídos

- **Dados RPG (`dados.js`)** — reconhece `d20`, `2d6+3` e expressões
  semelhantes. O host define limites de dados e faces.
- **Music Bot (`musica.js`)** — reproduz arquivos da pasta `music` no
  ServerHost. Comandos: `!music list`, `!music play <nome>`, `!music queue`,
  `!music skip` e `!music stop`. Suporta três calls simultâneas.
- **XP de Chat (`xp-chat.js`)** — concede XP persistente, responde a `!xp` e
  exibe o Top 5 com `!rank`, `!ranking` ou `!top`.

## Criando seu plugin

Leia [PLUGIN_API.md](./PLUGIN_API.md) para o contrato completo. Comece copiando
`examples/meu-plugin.example.js`, altere o `id` e salve a cópia diretamente na
pasta `plugins` com extensão `.js`.

O mínimo necessário é:

```js
module.exports = {
  id: 'boas-vindas',
  name: 'Boas-vindas',
  version: '1.0.0',
  description: 'Responde ao comando !oi.',
  onTextMessage({ text, room, textChannel, api }) {
    if (text.trim() === '!oi') {
      api.systemMessage(room, textChannel, 'Olá!');
    }
  }
};
```

Para autocomplete no VS Code, use a referência no topo do plugin:

```js
/// <reference path="./voiceup-plugin-api.d.ts" />
/** @type {VoiceUP.PluginDefinition} */
module.exports = { /* ... */ };
```
