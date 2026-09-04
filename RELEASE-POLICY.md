# Política de versões e releases do VoiceUP

## Numeração

Versões públicas usam versionamento sem sufixo, como 1.1.3. Correções
compatíveis aumentam o último número; mudanças maiores aumentam o número do
meio.

Betas antecipam a próxima versão pública e usam -beta.N, por exemplo:

- 1.1.3-beta.1
- 1.1.3-beta.2
- 1.1.3

O número da beta sempre cresce para a mesma versão-alvo. Uma beta já gerada não
é renomeada, porque a versão está gravada dentro dos executáveis.

Na Microsoft Store, que aceita apenas quatro números, o último componente
separa os canais. Assim, `1.1.3-beta.9` vira `1.1.3.9` no manifesto AppX e a
estável `1.1.3` usa o número interno reservado `1.1.3.65535`. A beta seguinte
de outra versão, como `1.1.4-beta.1`, volta a usar `1.1.4.1` e continua maior.
O nome e a versão exibidos dentro do VoiceUP permanecem os valores SemVer.

## Canais e retenção local

São mantidas até três releases públicas e, separadamente, até três betas mais
recentes. Uma beta é experimental e pode receber correções antes de se tornar
estável; uma release pública é o canal recomendado aos usuários.

## Requisitos para uma beta

Antes de entregar uma beta para teste:

- Client, ServerHost e Cloud usam a mesma versão de protocolo;
- dependências e arquivos JavaScript passam por auditoria e validação;
- testes de atualização, sessões, salas, identidade, permissões e plugins
  passam;
- instaladores Client e ServerHost são gerados com identidades separadas;
- uma execução básica confirma abertura, entrada em sala, texto e mídia;
- notas registram mudanças conhecidas e limitações.

Betas locais podem ser não assinadas e devem ser identificadas como teste. Se
forem distribuídas publicamente, aplicam-se também todos os requisitos de
release pública.

## Requisitos para uma release pública

Uma tag pública só pode ser criada quando:

- não há vulnerabilidade crítica conhecida sem tratamento;
- o upgrade a partir da última estável preserva preferências e identidades de
  instalação;
- Client atual funciona com Cloud e ServerHost atuais;
- o novo Client mantém o fallback documentado para servidores anteriores;
- a compatibilidade com Cliente anterior foi testada ou a atualização mínima
  foi declarada nas notas;
- UPnP permanece desativado até consentimento explícito;
- plugins externos permanecem bloqueados até aprovação de seu hash;
- os pacotes de todas as plataformas constam em um manifesto Ed25519 assinado
  pela chave pública fixada no aplicativo, com nome, versão, tamanho e SHA-256;
- o instalador Windows mantém nome e identidade compatíveis com os anteriores;
- hashes SHA-256, manifesto assinado e pacote Cloud sem dados privados são
  publicados junto dos instaladores; Authenticode comercial é opcional.

## Compatibilidade e segurança

O appId, nome do produto e diretórios de dados do Client e do ServerHost não
devem mudar em uma atualização normal. Assim, instalar uma nova versão por cima
da anterior substitui o runtime Electron e preserva as preferências existentes.

O novo Client usa fallback temporário para conversar com servidores antigos.
Servidores novos aceitam identidades legadas ainda não protegidas; depois que
uma identidade é vinculada à sua chave criptográfica, um Cliente antigo ou uma
cópia com o mesmo ID não pode assumir essa identidade. Essa restrição de
segurança prevalece sobre compatibilidade de downgrade.

Mudanças incompatíveis exigem versão maior, migração explícita e aviso nas notas
da release.

## Rollback

Se uma regressão grave aparecer, interrompa a distribuição, marque a release
como não recomendada e publique uma correção com número novo. Não substitua
silenciosamente um arquivo já publicado sob a mesma versão ou hash.

O rollback nunca deve restaurar uma falha de segurança conhecida. Dados
persistentes precisam ter backup ou migração reversível antes de qualquer
alteração de formato.
