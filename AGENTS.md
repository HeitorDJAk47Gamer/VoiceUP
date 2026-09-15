# Regras de continuidade do VoiceUP

Estas regras devem ser mantidas por qualquer modelo ou tarefa que trabalhe neste projeto.

## Betas e pastas de teste

- Cada beta empacotada deve ter uma pasta `test-v<versão>`, por exemplo `test-v1.2.2-beta.11`.
- A pasta da beta reúne os artefatos disponíveis de todas as plataformas. Adicione novos artefatos sem apagar Linux, Windows, Android, SelfWeb, Cloud ou documentação já existentes.
- Nunca sobrescreva silenciosamente um arquivo diferente. Verifique o `SHA256.txt`, bloqueie colisões e mantenha os hashes anteriores ao acrescentar outra plataforma.
- Mantenha localmente no máximo as três betas mais recentes que realmente possuam artefato de cada plataforma. Uma mesma pasta pode contar para mais de uma plataforma.
- Preserve betas antigas fora dessa retenção até que o usuário peça uma limpeza; durante a limpeza, não remova uma beta ainda necessária para completar as três de alguma plataforma.
- Avance o número da beta uma vez por novo conjunto de alterações funcionais, salvo instrução diferente do usuário.

## Releases públicas e espaço local

- Mantenha em `releases/` somente as três releases públicas mais recentes confirmadas por tags remotas.
- Preserve apenas os artefatos distribuíveis, hashes, manifestos e notas. Diretórios `win-unpacked`, caches e saídas intermediárias podem ser regenerados e não pertencem ao arquivo permanente.
- Depois que uma beta estiver validada em `test-v<versão>`, as pastas temporárias `release-beta*`, `release-linux*` e equivalentes podem ser removidas.
- Use `tools/cleanup-local-artifacts.ps1` primeiro sem parâmetros para auditar; use `-Apply` somente com autorização explícita para limpar.

## Empacotamento desktop

1. Atualize a versão de beta de forma consistente no pacote, histórico de versões e testes.
2. Gere o Client com `npm.cmd run dist:beta`.
3. Gere o ServerHost com `npm.cmd run dist:beta:server`.
4. Execute `node tools/package-desktop-beta.js` para criar ou completar a pasta `test-v<versão>`.
5. Execute `npm.cmd run test:beta-installer` e os testes relacionados às alterações.

Client e ServerHost devem manter nomes, executáveis, identificadores e diretórios persistentes distintos para que um não substitua o outro.

## Segurança e publicação

- Empacotar localmente não significa publicar. Não envie release, tag, catálogo do atualizador, site, Cloud ou loja sem autorização explícita.
- Diferencie claramente no relatório: código alterado, build gerado, pacote de teste criado e publicação realizada.
- Não afirme que Android, Linux, SelfWeb ou Cloud foram incluídos sem confirmar o artefato correspondente na pasta da beta.
- Preserve configurações, perfil, identidade e dados persistentes durante atualizações.

## Publicação do Cloud no GitHub privado

- Por orientação do usuário, cada atualização publicada deve incluir o envio do Cloud correspondente para `HeitorDJAk47Gamer/VoiceUP-Server-Cloud` (repositório privado, branch `main`). Betas apenas locais continuam sem publicação.
- Use o conteúdo do pacote Cloud validado e seu catálogo assinado. Nunca envie `.env`, chaves privadas, bancos, logs ou dados operacionais.
- Confira diferenças e preserve arquivos extras do repositório; não use force-push. Verifique o commit remoto após enviar.
- Diferencie envio ao GitHub privado de implantação na hospedagem: confirme a versão nas rotas públicas antes de afirmar que o Cloud em execução foi atualizado.
