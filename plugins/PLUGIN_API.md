# VoiceUP Plugin API — contrato beta v1

A API permite reagir a mensagens, responder como bot, guardar dados e expor
opções no painel do host. O formato é CommonJS (`module.exports`) e funciona no
Node.js usado pelo ServerHost e pelo VoiceUP Cloud.

## Estrutura exportada

| Campo | Obrigatório | Descrição |
| --- | --- | --- |
| `id` | Sim | Identificador único: 2–40 letras, números ou hífens. Não altere após publicar. |
| `name` | Sim | Nome exibido no painel e nos logs. |
| `version` | Recomendado | Versão do próprio plugin. |
| `description` | Recomendado | Resumo de até 140 caracteres. |
| `icon` | Opcional | Data URL PNG, WebP ou SVG de até 60 KB. |
| `settings` | Opcional | Campos configuráveis mostrados no painel. |
| `onTextMessage` | Sim | Função chamada para cada mensagem válida. |
| `onEnable` / `onDisable` | Opcional | Ciclo de vida do Toggle Switch. |
| `getAdminState` | Opcional | Dados extras para a interface administrativa. |
| `onAdminAction` | Opcional | Recebe ações disparadas pelo painel. |

## Contexto de `onTextMessage`

```js
async onTextMessage({
  text,          // texto da mensagem
  room,          // código da sala/servidor
  textChannel,   // canal de texto atual
  voiceChannel,  // call atual ou vazio
  user,          // { id, clientId, name, color }; clientId é o ID persistente do programa
  serverIsCloud, // true no projeto Cloud
  plugin,        // { id, name, icon }
  api
}) {}
```

Clientes antigos continuam recebendo respostas como mensagens normais. Evite
bloquear a função por muito tempo; para tarefas assíncronas, use `async/await`
e trate erros.

## `api`

### `api.systemMessage(room, textChannel, text, options?)`

Envia uma resposta visível no chat. `options` pode conter `name`, `color`,
`avatar` ou `avatarSetting`. Texto e identidade passam pelos limites de
segurança do runtime.

### `api.settings`

Cópia somente leitura das opções salvas pelo host. Tipos aceitos no schema:
`text`, `number`, `range`, `boolean`, `select` e `image`.

```js
settings: [
  { key: 'enabledMessage', label: 'Responder no chat', type: 'boolean', default: true },
  { key: 'points', label: 'Pontos', type: 'number', default: 5, min: 0, max: 100 },
  { key: 'mode', label: 'Modo', type: 'select', default: 'short', options: [
    { value: 'short', label: 'Curto' }, { value: 'full', label: 'Completo' }
  ] }
]
```

O runtime sempre adiciona `botAvatar` quando o plugin não declara uma foto.

### `api.storage`

Armazenamento JSON isolado pelo `id` do plugin:

```js
const count = api.storage.get('count', 0);
api.storage.set('count', count + 1);
api.storage.delete('count');
```

Guarde somente dados serializáveis e pequenos. Não armazene senhas, tokens ou
arquivos grandes nesse espaço.

### `api.media`

- `api.media.list()` lista os arquivos de áudio reconhecidos pelo host.
- `api.media.url(name)` fornece a URL interna de um arquivo permitido.

### `api.botCommand(room, payload)`

Integração avançada do ServerHost para bots de voz. Atualmente o evento público
é `music-bot`, usado pelo plugin oficial de música. Hospedagens Cloud precisam
de um processo de mídia compatível para reproduzir áudio em calls.

### `api.log(message)`

Adiciona uma linha identificada pelo plugin aos logs do servidor.

## Ciclo de vida e administração

`onEnable({ plugin, api })` e `onDisable({ plugin, api })` são chamados quando o
host altera o Toggle Switch. Use `onDisable` para parar timers, limpar filas e
desconectar bots.

`getAdminState({ plugin, api })` deve devolver apenas JSON. Se o plugin precisar
de uma ação administrativa, implemente:

```js
onAdminAction({ action, payload, plugin, api }) {
  if (action !== 'reset') return { ok: false, message: 'Ação desconhecida.' };
  api.storage.delete('count');
  return { ok: true, message: 'Contagem zerada.' };
}
```

## Compatibilidade e segurança

- Um erro em um plugin é isolado e aparece nos logs, sem derrubar os outros.
- IDs duplicados são ignorados.
- O runtime limita textos, schemas e imagens do painel.
- Não use `eval`, não execute comandos recebidos do chat e não monte caminhos
  de arquivos com conteúdo enviado por participantes.
- Um plugin é código de servidor e pode usar módulos nativos do Node.js; essa
  liberdade também significa que o autor do host deve revisar o arquivo.
- A API ainda é beta. Mantenha `version` no plugin e teste em uma pasta de teste
  antes de colocar no servidor principal.
