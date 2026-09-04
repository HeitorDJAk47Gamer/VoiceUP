# VoiceUP Plugin API — contrato beta v1

A API permite reagir a mensagens, responder como bot, guardar dados e expor
opções no painel do host. O formato é CommonJS (`module.exports`) e funciona no
Node.js usado pelo ServerHost e pelo VoiceUP Cloud.

Para solicitar um plugin a outra IA, use o documento autocontido
[GUIA_PARA_IA.md](./GUIA_PARA_IA.md). Esta página permanece como referência
resumida para consulta durante o desenvolvimento.

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

Também não coloque API keys, senhas ou tokens em `settings`. As configurações
são persistidas em texto comum e podem ser incluídas em respostas
administrativas. Plugins que integrem serviços externos devem ler o segredo de
uma variável de ambiente do processo e nunca escrevê-lo em URLs, mensagens ou
logs.

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

- Um arquivo externo é identificado pelo SHA-256 e fica bloqueado antes do
  `require()`. No ServerHost, o administrador precisa confirmar esse hash no
  painel; no Cloud, precisa incluí-lo em
  `VOICEUP_TRUSTED_PLUGIN_HASHES`. Qualquer alteração exige nova aprovação.
- Um erro em um plugin é isolado e aparece nos logs, sem derrubar os outros.
- IDs duplicados são ignorados.
- O runtime limita textos, schemas e imagens do painel.
- Não use `eval`, não execute comandos recebidos do chat e não monte caminhos
  de arquivos com conteúdo enviado por participantes.
- Um plugin aprovado é código de servidor e pode usar módulos nativos do
  Node.js, acessar arquivos e iniciar conexões de rede com as permissões do
  processo. A aprovação por hash não é uma sandbox; o administrador deve
  revisar a origem e o arquivo completo.
- A API ainda é beta. Mantenha `version` no plugin e teste em uma pasta de teste
  antes de colocar no servidor principal.
