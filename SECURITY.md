# Política de Segurança do VoiceUP

## Versões com suporte

Recebem correções de segurança:

| Canal | Suporte |
| --- | --- |
| Release estável mais recente | Sim |
| Beta mais recente | Sim, para validação antes da versão estável |
| Versões anteriores | Não; atualize antes de relatar um problema já corrigido |

Uma versão antiga pode ser bloqueada de um recurso quando continuar aceitando-a
colocaria usuários ou servidores em risco.

## Como relatar uma vulnerabilidade

Use **Security > Report a vulnerability** no repositório do VoiceUP para enviar
um relato privado pelo GitHub. Se essa opção não estiver disponível, abra uma
issue sem detalhes técnicos ou dados pessoais e peça um canal privado ao
mantenedor.

Não publique exploit, token, senha, endereço IP, banco de dados, relatório de
usuário ou outra informação sensível em issues, discussões ou chats públicos.

Inclua, quando possível:

- componente afetado: Client, ServerHost, Cloud, atualizador ou plugin;
- versão e sistema operacional;
- impacto e condições necessárias;
- passos mínimos para reprodução;
- evidências sem dados de terceiros;
- sugestão de correção, se houver.

## Processo de resposta

Os objetivos abaixo orientam o projeto, mas não constituem um SLA:

- confirmar o recebimento em até 7 dias;
- avaliar severidade, impacto e versões afetadas;
- manter o pesquisador informado a cada mudança relevante;
- preparar correção e aviso coordenados antes da divulgação pública;
- atribuir crédito quando solicitado e seguro.

Problemas críticos podem exigir desativação temporária de um recurso, revogação
de uma release ou atualização obrigatória.

## Pesquisa de boa-fé

O projeto considera pesquisa de boa-fé aquela que usa somente contas, máquinas
e dados autorizados; evita indisponibilidade, engenharia social, spam,
persistência e acesso a conteúdo de terceiros; coleta apenas o mínimo necessário
para demonstrar o problema; e dá tempo razoável para correção antes da
divulgação.

Esta política não autoriza violar leis, contratos, privacidade ou infraestrutura
de terceiros.

## Integridade das versões

Releases públicas usam um manifesto Ed25519 com chave pública fixada no
aplicativo e hashes SHA-256 dos pacotes de todas as plataformas. O atualizador
Desktop bloqueia pacotes sem assinatura interna válida ou com hash divergente.
Authenticode comercial é opcional: sem ele, o Windows ainda pode mostrar
publicador desconhecido, SmartScreen ou bloquear conforme a política do sistema.
O APK conserva a chave Android existente; instalar outra identidade é recusado
pelo Android. SelfWeb não executa um instalador nem atualiza seu HTML sozinho.

Plugins externos são código do administrador do ServerHost. Eles ficam
bloqueados até aprovação explícita do hash do arquivo e devem ser tratados como
código com acesso aos dados e recursos do processo do servidor.

## Dependências da publicação

`node tools/audit-dependencies.js` confere todas as versões dos lockfiles de
Desktop, Mobile e Cloud na API pública OSV, incluindo dependências de build.
Avisos moderados, altos, críticos ou sem gravidade definida bloqueiam o processo;
falhas de consulta também não são tratadas como aprovação. A consulta usa apenas
nomes e versões de pacotes, sem enviar código, chaves ou dados de usuários.

O workflow usa essa verificação no lugar do endpoint npm audit, indisponível na
preparação da 1.2.0. Detalhes da API: https://google.github.io/osv.dev/post-v1-querybatch/
