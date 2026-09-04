# Guia para criar plugins privados do VoiceUP com ajuda de IA

Este documento é autocontido. Envie-o inteiro para a IA que criará o plugin.
O resultado esperado é **um único arquivo JavaScript CommonJS (`.js`)** para a
pasta `plugins` do VoiceUP ServerHost ou do projeto Cloud.

Os plugins criados com este guia são experimentais e privados. Os únicos
plugins publicados oficialmente pelo projeto continuam sendo Dados RPG,
Music Bot e XP de Chat.

Antes de solicitar código, use o
[teste rápido de compreensão](./TESTE_RAPIDO_IA.md). Ele leva poucos minutos e
mostra se a IA entendeu a arquitetura ou está inventando APIs.

## Prompt pronto para enviar à IA

Copie o texto abaixo, substitua a parte entre colchetes e anexe este documento:

```text
Crie um plugin privado para o VoiceUP Server usando exclusivamente a API
descrita no documento GUIA_PARA_IA.md anexado.

O plugin deve fazer o seguinte:
[DESCREVA A IDEIA, OS COMANDOS E AS CONFIGURAÇÕES]

Requisitos obrigatórios:
- Entregue um único arquivo .js em CommonJS usando module.exports.
- Não altere o VoiceUP, o plugin-runtime ou os três plugins oficiais.
- Não invente eventos, campos ou métodos que não estejam documentados.
- Evite dependências externas; prefira JavaScript e módulos nativos do Node.js.
- Valide toda entrada recebida do chat.
- Não use eval, Function, execução de comandos ou caminhos montados pelo usuário.
- Guarde somente JSON pequeno em api.storage.
- Implemente onDisable se criar timers, filas ou recursos temporários.
- Se algum requisito não for possível com a API atual, explique a limitação em
  vez de simular que funciona.
- Inclua no final uma lista curta de como instalar e testar o plugin.

Antes de responder, confira o arquivo contra o checklist do documento.
```

## O que é um plugin do VoiceUP

Um plugin é um módulo JavaScript executado **no processo do servidor**. Ele não
é um plugin do Discord, do navegador, do Electron ou do Codex. Os participantes
não instalam nada.

O servidor entrega cada mensagem de texto válida a todos os plugins
habilitados. Um plugin pode:

- reconhecer comandos ou padrões no texto;
- responder como um bot no canal;
- expor configurações no painel do ServerHost;
- armazenar pequenos dados JSON persistentes;
- consultar mídias reconhecidas pelo ServerHost;
- acionar a integração interna de bot de áudio;
- escrever informações nos logs do servidor.

Um plugin **não possui uma interface arbitrária no Client** e não deve acessar
diretamente os sockets, conexões WebRTC ou elementos da tela do VoiceUP.

## Como o arquivo é carregado

- Formato: CommonJS, usando `module.exports = { ... }`.
- Local: diretamente na pasta `plugins`, sem subpastas.
- Extensão: `.js`.
- Recarga: ao iniciar o servidor ou usar **Plugins > Recarregar plugins**.
- Ordem: diretórios na ordem configurada e arquivos em ordem alfabética. Não
  crie plugins que dependam dessa ordem.
- IDs duplicados: somente o primeiro é carregado; os demais são ignorados.
- Erros: ficam nos logs e não devem derrubar os outros plugins.
- Segurança: não existe sandbox. O arquivo possui as permissões do processo do
  servidor. Portanto, somente plugins confiáveis devem ser instalados.

## Contrato mínimo

```js
module.exports = {
  id: 'meu-plugin',
  name: 'Meu plugin',
  version: '0.1.0',
  description: 'Explica em uma frase o que o plugin faz.',

  onTextMessage({ text, room, textChannel, user, api }) {
    if (String(text).trim().toLowerCase() !== '!teste') return;
    api.systemMessage(room, textChannel, `Olá, ${user.name}!`);
  }
};
```

Somente `id` e `onTextMessage` são tecnicamente obrigatórios, mas `name`,
`version` e `description` devem sempre ser informados.

## Campos exportados

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `id` | Sim | Único, 2–40 caracteres: letras, números e hífen. Não altere depois de começar a guardar dados. |
| `name` | Recomendado | Nome do painel, limitado pelo runtime a 48 caracteres. |
| `version` | Recomendado | Versão do plugin, limitada a 24 caracteres. |
| `description` | Recomendado | Resumo limitado a 140 caracteres. |
| `icon` | Não | Data URL PNG, WebP ou SVG de até 60.000 caracteres. URL HTTP não é aceita. |
| `settings` | Não | Até 24 configurações exibidas no painel. |
| `onTextMessage` | Sim | Executado para cada mensagem válida enquanto o plugin estiver habilitado. |
| `onEnable` | Não | Chamado quando o Toggle Switch passa de desabilitado para habilitado. |
| `onDisable` | Não | Chamado quando o Toggle Switch passa de habilitado para desabilitado. |
| `getAdminState` | Não | Retorna JSON de estado administrativo. Não cria uma interface personalizada automaticamente. |
| `onAdminAction` | Não | Trata uma ação administrativa que já tenha integração no painel. |

O runtime adiciona automaticamente uma configuração `botAvatar` do tipo
`image` quando o plugin não declara uma.

## Contexto de mensagem

```js
async onTextMessage({
  text,          // string: conteúdo aceito pelo servidor
  room,          // string: código da sala/servidor
  textChannel,   // string: canal de texto da mensagem
  voiceChannel,  // string: call atual do autor, ou vazio/lobby
  user,          // objeto descrito abaixo
  serverIsCloud, // boolean: true no Cloud e false no ServerHost
  plugin,        // { id, name, icon }
  api            // API isolada deste plugin
}) {}
```

### Identidade do usuário

```js
user = {
  id,       // ID temporário da conexão/socket
  clientId, // ID persistente do aplicativo; pode estar vazio em Clients antigos
  name,     // apelido atual
  color     // cor atribuída ao participante
};
```

Use `clientId` para progresso persistente. Como Clients antigos podem não
enviá-lo, sempre defina um fallback explícito. Nunca use apenas o nome como
identificador permanente, pois o usuário pode alterá-lo.

Exemplo:

```js
function userKey(user) {
  const persistent = String(user.clientId || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  if (persistent) return persistent;
  const temporary = String(user.id || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 70);
  return `legacy-${temporary || 'visitante'}`;
}
```

## API disponível

### `api.systemMessage(room, textChannel, text, options?)`

Envia uma mensagem de bot para o canal. Clientes antigos a recebem como uma
mensagem normal.

```js
api.systemMessage(room, textChannel, 'Operação concluída.', {
  name: 'Meu Bot',
  color: '#56e2cf',
  avatar: ICON
});
```

Opções:

- `name`: nome do bot, até 24 caracteres;
- `color`: cor CSS usada pela identidade da mensagem;
- `avatar`: Data URL aceita pelo runtime;
- `avatarSetting`: Data URL com prioridade sobre a foto configurada no painel.

O texto é limitado a 500 caracteres e o nome do canal a 24. A precedência do
avatar é: `avatarSetting`, `botAvatar` salvo, `avatar` e `icon` do plugin.

### `api.settings`

É uma cópia das configurações salvas pelo host para esta execução do evento.
Não a altere diretamente. Quando o host salva novas opções, os próximos eventos
recebem os novos valores.

```js
const limit = Number(api.settings.limit) || 10;
if (api.settings.replyEnabled) {
  // ...
}
```

### `api.storage`

Armazenamento JSON persistente e isolado pelo `id` do plugin.

```js
const state = api.storage.get('state', { count: 0 });
state.count += 1;
api.storage.set('state', state);
api.storage.delete('old-key');
```

Regras:

- chaves são texto com até 60 caracteres;
- valores precisam ser serializáveis com JSON;
- cada `set` persiste o arquivo de estado imediatamente;
- não armazene áudio, imagens grandes, senhas ou tokens;
- chamadas simultâneas de leitura e escrita não são transações de banco;
- mudanças no `id` criam outro espaço de armazenamento.

### `api.media`

```js
const files = api.media.list();
const internalUrl = api.media.url(files[0]);
```

- `list()` retorna nomes de mídias permitidas pelo host;
- `url(name)` retorna uma URL interna quando a mídia existe e é permitida;
- no Cloud a lista pode estar vazia e a reprodução em call pode não existir.

### `api.botCommand(room, payload)`

Integração avançada e específica do bot de áudio do ServerHost. Atualmente o
runtime emite o evento interno `music-bot`. Isso **não é uma API genérica para
criar qualquer evento no Client**.

Use somente quando o plugin for compatível com o controlador de mídia já
existente. O Cloud exige um processo separado de áudio para entrar em calls.

### `api.log(message)`

Adiciona uma linha identificada pelo plugin aos logs do servidor. A mensagem é
limitada a 180 caracteres.

```js
api.log('Cache reconstruído com sucesso.');
```

## Configurações no painel

```js
settings: [
  {
    key: 'replyEnabled',
    label: 'Responder no chat',
    description: 'Ativa as respostas públicas do bot.',
    type: 'boolean',
    default: true
  },
  {
    key: 'limit',
    label: 'Limite por sala',
    type: 'number',
    default: 10,
    min: 1,
    max: 100
  },
  {
    key: 'style',
    label: 'Estilo da resposta',
    type: 'select',
    default: 'short',
    options: [
      { value: 'short', label: 'Curto' },
      { value: 'full', label: 'Completo' }
    ]
  }
]
```

Tipos aceitos:

| Tipo | Comportamento |
| --- | --- |
| `text` | Texto de até 120 caracteres. |
| `number` | Número inteiro limitado por `min` e `max`. |
| `range` | Controle deslizante; aceita `min`, `max` e `step`. |
| `boolean` | Toggle Switch. |
| `select` | Lista com até 20 opções; cada valor tem até 40 caracteres. |
| `image` | Imagem local convertida pelo painel em Data URL válida. |

Chaves precisam começar com letra, ter entre 2 e 40 caracteres e usar letras,
números, `_` ou `-`.

## Ciclo de vida

```js
onEnable({ plugin, api }) {
  api.log(`${plugin.name} habilitado.`);
},

onDisable({ api }) {
  clearInterval(this.timer);
  api.log('Timers encerrados.');
}
```

`onEnable` e `onDisable` respondem à alteração do Toggle Switch. Não dependa de
`onEnable` para inicialização do servidor, pois ele não é chamado apenas porque
um plugin já habilitado foi carregado na inicialização.

Se criar timers, filas, conexões ou arquivos temporários, encerre-os em
`onDisable`. Evite usar `this` quando uma variável fechada no módulo for mais
clara e previsível.

## Administração avançada

`getAdminState` deve retornar apenas JSON pequeno:

```js
getAdminState({ api }) {
  return {
    type: 'meu-estado',
    count: api.storage.get('count', 0)
  };
}
```

O retorno aparece nos dados administrativos, mas o painel atual não gera
automaticamente controles para qualquer `type`. A interface possui integrações
específicas, como o ranking de XP. Para um painel personalizado, o VoiceUP
precisa primeiro implementar essa visualização.

Uma ação integrada pode chamar:

```js
onAdminAction({ action, payload, api }) {
  if (action !== 'reset') {
    return { ok: false, message: 'Ação desconhecida.' };
  }
  api.storage.delete('count');
  return { ok: true, message: 'Contagem zerada.' };
}
```

Não declare que uma ação está acessível no painel sem que exista um botão ou
integração correspondente no ServerHost.

## Exemplo completo: contador por sala

```js
/// <reference path="./voiceup-plugin-api.d.ts" />

/** @type {VoiceUP.PluginDefinition} */
module.exports = {
  id: 'contador-teste',
  name: 'Contador de teste',
  version: '0.1.0',
  description: 'Conta quantas vezes !contar foi usado em cada sala.',
  settings: [
    { key: 'reply', label: 'Texto da resposta', type: 'text', default: 'Contagem' },
    { key: 'enabledReply', label: 'Responder no chat', type: 'boolean', default: true }
  ],

  onTextMessage({ text, room, textChannel, user, api }) {
    if (String(text).trim().toLowerCase() !== '!contar') return;

    const key = `room:${String(room).slice(0, 48)}`;
    const count = api.storage.get(key, 0) + 1;
    api.storage.set(key, count);

    if (api.settings.enabledReply) {
      api.systemMessage(
        room,
        textChannel,
        `${api.settings.reply}: ${count}. Comando usado por ${user.name}.`,
        { name: 'Contador', color: '#56e2cf' }
      );
    }
  },

  onDisable({ api }) {
    api.log('Contador desabilitado pelo host.');
  }
};
```

## ServerHost versus Cloud

| Recurso | ServerHost | Cloud |
| --- | --- | --- |
| Mensagens de bot | Sim | Sim |
| Configurações | Sim | Sim, se o painel/arquivo estiver disponível |
| `api.storage` | Arquivo persistente local | Depende de disco persistente da hospedagem |
| Lista de mídia | Sim | Pode estar vazia |
| Bot de áudio em call | Integração disponível | Exige processo de mídia separado |
| Acesso a módulos Node.js | Sim | Depende dos módulos instalados no deploy |
| `serverIsCloud` | `false` | `true` |

Um plugin que não precisa de mídia normalmente pode funcionar nos dois. Quando
houver diferença, use `serverIsCloud` e responda claramente ao usuário.

## Instalação e teste

1. Salve o resultado da IA como `nome-do-plugin.js`.
2. Rode `node --check nome-do-plugin.js` para validar a sintaxe.
3. No ServerHost de teste, abra **Plugins > Abrir pasta de plugins**.
4. Copie o arquivo diretamente para essa pasta.
5. Use **Recarregar plugins** ou reinicie o servidor.
6. Confira o card, a versão, as opções e os logs.
7. Entre com dois Clients de teste e execute os comandos em salas e canais
   diferentes.
8. Desabilite e habilite o Toggle Switch.
9. Reinicie o servidor e confirme se os dados que deveriam persistir voltaram.
10. Teste entradas inválidas, mensagens longas, nomes alterados e Client antigo.

Para o Cloud, copie o arquivo para a pasta `plugins` do projeto e faça um novo
deploy. Confirme que `PLUGIN_STATE_FILE` aponta para armazenamento persistente.

## Segurança obrigatória

- Nunca use `eval`, `new Function` ou execução de comandos do sistema.
- Nunca transforme texto do chat diretamente em caminho de arquivo.
- Nunca aceite URL, token ou senha e os reutilize sem validação.
- Nunca declare API keys, senhas ou tokens em `settings`: as configurações são
  persistidas em texto comum e podem aparecer em respostas administrativas do
  Cloud. Para integrações externas, leia o segredo de uma variável de ambiente
  do processo, como `process.env.MINHA_API_KEY`, e nunca o inclua em URLs,
  mensagens ou logs.
- Defina limites de tamanho, quantidade, intervalo e frequência.
- Não faça requisições externas em toda mensagem sem cache e rate limit.
- Não bloqueie o evento com loops longos ou processamento pesado.
- Trate erros de rede e arquivo sem revelar caminhos ou dados privados no chat.
- Não armazene dados pessoais desnecessários.
- Revise manualmente todo código produzido por IA antes de executar.

## Checklist para a IA e para o revisor

- [ ] Entrega exatamente um arquivo `.js` CommonJS.
- [ ] Possui `id` válido e estável.
- [ ] Possui `onTextMessage` e retorna cedo quando a mensagem não interessa.
- [ ] Usa apenas campos e métodos documentados.
- [ ] Valida e limita todas as entradas.
- [ ] Não depende da ordem dos plugins.
- [ ] Não usa o nome do usuário como identidade persistente.
- [ ] Armazena apenas JSON pequeno.
- [ ] Não guarda segredos em `settings` nem em `api.storage`.
- [ ] Não bloqueia o servidor com processamento demorado.
- [ ] Limpa timers e recursos em `onDisable`.
- [ ] Explica corretamente limitações do Cloud e de bots de áudio.
- [ ] Não promete interface administrativa que o painel não implementa.
- [ ] Passa em `node --check`.
- [ ] Foi testado em um ServerHost separado antes do servidor principal.

## Arquivos de referência no projeto

- `plugins/voiceup-plugin-api.d.ts`: tipos e autocomplete para VS Code;
- `plugins/examples/meu-plugin.example.js`: exemplo mínimo executável;
- `plugins/PLUGIN_API.md`: referência resumida da API;
- `plugin-runtime.js`: implementação oficial e fonte final de verdade;
- `plugins/dados.js`, `plugins/musica.js` e `plugins/xp-chat.js`: exemplos reais.
