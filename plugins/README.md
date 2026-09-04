# Plugins do VoiceUP Server

Plugins são módulos JavaScript executados **no ServerHost ou no Cloud**, nunca
no computador de cada participante. Os plugins oficiais incluídos na versão são
reconhecidos pelo hash. Qualquer arquivo externo colocado na pasta aparece como
bloqueado e não é executado até uma aprovação explícita.

> Depois de aprovado, um plugin executa código com acesso aos dados e recursos
> do processo do servidor. A aprovação por hash impede execução silenciosa e
> detecta mudanças no arquivo, mas não é uma sandbox. Instale somente arquivos
> de autores em quem você confia.

## Instalação

1. Baixe o arquivo `.js` do plugin.
2. Abra o painel do VoiceUP ServerHost e entre na página **Plugins**.
3. Clique em **Abrir pasta de plugins**.
4. Coloque o `.js` nessa pasta, sem criar outra subpasta.
5. Clique em **Recarregar plugins** ou reinicie o servidor. O arquivo ainda não
   será executado.
6. Confira o nome, a origem e o SHA-256 exibido no painel. Ao tentar ativar,
   leia o aviso e confirme somente se reconhece o arquivo.
7. Depois da aprovação e da recarga, use o Toggle Switch para
   habilitar/desabilitar e abra **Editar opções** para configurar.

Se um único byte do arquivo mudar, o SHA-256 também muda e o ServerHost exige
uma nova aprovação.

No Cloud não há confirmação visual local. Calcule o SHA-256 do plugin revisado e
inclua o hash completo em VOICEUP_TRUSTED_PLUGIN_HASHES antes de reiniciar. Sem
essa lista, plugins externos permanecem bloqueados. As opções, aprovações e
dados persistentes usam o arquivo definido por PLUGIN_STATE_FILE; confirme que
a hospedagem oferece disco persistente antes de depender desses dados.

## Plugins oficiais incluídos

- **Dados RPG (`dados.js`)** — reconhece equações como `d20`, `2d6 + d20`,
  `2d6+3` e `4d8 - 1`. O host define limites de dados, faces e modificadores.
- **Music Bot (`musica.js`)** — reproduz arquivos da pasta `music` no
  ServerHost. Comandos: `!m list`, `!m play <nome>`, `!m queue`, `!m skip` e
  `!m stop`. O antigo `!music` continua compatível. Suporta três calls simultâneas.
- **XP de Chat (`xp-chat.js`)** — concede XP persistente, responde a `!xp` e
  exibe o Top 5 com `!rank`, `!ranking`, `!top` ou `!xp ranking`. O host
  escolhe o XP mínimo e máximo por mensagem; a pontuação é associada ao ID
  persistente do programa, e não ao apelido do usuário.

## Criando seu plugin

Leia [PLUGIN_API.md](./PLUGIN_API.md) para o contrato completo. Comece copiando
`examples/meu-plugin.example.js`, altere o `id` e salve a cópia diretamente na
pasta `plugins` com extensão `.js`.

Se outra IA for escrever o plugin, envie a ela o
[Guia para criar plugins privados com IA](./GUIA_PARA_IA.md). Ele é
autocontido, inclui um prompt pronto, documenta as limitações reais do runtime
e traz um checklist de revisão e teste.

Antes de aceitar o código, aplique o
[teste rápido de compreensão](./TESTE_RAPIDO_IA.md). O gabarito ajuda a detectar
em poucos minutos se a IA confundiu plugins do VoiceUP com APIs inexistentes.

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
