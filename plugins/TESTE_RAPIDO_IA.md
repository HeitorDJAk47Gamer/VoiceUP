# Teste rápido: a IA entendeu os plugins do VoiceUP?

Use este teste **antes** de pedir código. Envie para a IA apenas a seção
“Prompt do teste” junto com `GUIA_PARA_IA.md`. Compare a resposta com o
gabarito deste arquivo.

## Prompt do teste

```text
Leia o documento GUIA_PARA_IA.md anexado. Ainda não escreva nenhum plugin.

Quero confirmar se você entendeu o sistema do VoiceUP. Responda de forma curta
e exatamente nestas seções:

1. Onde executa
Explique onde o plugin roda e quem precisa instalá-lo.

2. Contrato mínimo
Informe formato do módulo, campos obrigatórios e como ele é carregado.

3. Evento e identidade
Explique quando onTextMessage é chamado e a diferença entre user.id,
user.clientId e user.name.

4. APIs que existem
Liste apenas os métodos/objetos documentados em api e resuma cada um.

5. Persistência
Explique o que pode ser salvo, onde fica isolado e quais dados não devem ser
guardados.

6. ServerHost x Cloud
Explique a principal diferença para mídia e bot de áudio.

7. Limites da interface
Diga se um plugin consegue criar sozinho uma tela personalizada no Client ou
qualquer painel administrativo novo.

8. Segurança
Liste quatro práticas obrigatórias.

9. Plano de exemplo
Sem escrever código, planeje um plugin privado com comando !sorteio, opção de
limite no painel e contador persistente por sala. Informe trigger,
configurações, chaves de storage, APIs utilizadas e validações.

10. Veredito
Responda “ENTENDI”, “ENTENDI PARCIALMENTE” ou “PRECISO DE MAIS CONTEXTO” e
liste qualquer ponto que ainda esteja incerto.

Não invente métodos. Quando algo não for possível, diga explicitamente.
```

## Gabarito para conferir

Dê um ponto para cada item atendido:

1. **Execução:** diz que o `.js` roda no ServerHost/Cloud, com permissões do
   processo, e que participantes não instalam o plugin.
2. **Contrato:** menciona CommonJS, `module.exports`, `id`, `onTextMessage`,
   arquivo direto na pasta `plugins` e recarga/reinício.
3. **Evento:** entende que todos os plugins habilitados recebem cada mensagem
   válida e devem retornar cedo quando ela não interessa.
4. **Identidade:** usa `clientId` como persistente, `id` como conexão temporária
   e não trata `name` como ID permanente; prevê fallback para Client antigo.
5. **API correta:** limita-se a `systemMessage`, `settings`, `storage`, `media`,
   `botCommand` e `log`.
6. **Persistência:** fala em JSON pequeno isolado pelo ID do plugin e não salva
   senhas, tokens, imagens/áudios grandes ou dados não serializáveis; também
   não coloca segredos em `settings`.
7. **Cloud:** reconhece que mensagens/configurações funcionam, mas bot de áudio
   em call precisa de processo de mídia separado e disco persistente depende da
   hospedagem.
8. **Interface:** não promete criar sozinho telas arbitrárias no Client ou no
   painel; entende que `getAdminState` não gera uma UI genérica.
9. **Segurança:** cita validação e limites, proibição de `eval`/comandos,
   proteção de caminhos, rate limit/cache ou limpeza de recursos.
10. **Plano:** para `!sorteio`, propõe `settings` para o limite,
    `api.storage` com chave por sala, `api.systemMessage` para resposta e
    validações de faixa/entrada, sem inventar APIs.

## Resultado

- **9–10 pontos:** entendeu bem e pode criar um primeiro protótipo.
- **7–8 pontos:** pode criar, mas revise com atenção as áreas erradas.
- **5–6 pontos:** peça para reler o guia e refazer o teste.
- **0–4 pontos:** não use o código gerado sem uma revisão técnica completa.

## Sinais de alerta imediatos

Interrompa a geração se a IA afirmar qualquer uma destas coisas:

- que o plugin deve ser instalado por cada Client;
- que existe `api.socket`, `api.webrtc`, `api.database`, `api.http` ou
  `api.createPanel`;
- que `getAdminState` cria automaticamente qualquer painel personalizado;
- que `botCommand` é um sistema genérico para novos eventos;
- que `user.name` é um identificador permanente;
- que o Music Bot funciona no Cloud sem processo de mídia adicional;
- que plugins são executados em sandbox;
- que é seguro executar comandos recebidos pelo chat.
- que API keys devem ser configuradas em um campo `text` de `settings`.
