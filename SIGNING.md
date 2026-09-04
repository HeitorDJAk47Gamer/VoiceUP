# Assinatura e integridade do VoiceUP

## Distribuição sem certificado comercial obrigatório

A partir da 1.2.0, os pacotes são descritos em `VoiceUP-Release-X.Y.Z.json`.
Esse manifesto tem assinatura Ed25519; contém a versão, nomes, produtos,
plataformas, tamanhos, URLs oficiais e SHA-256. O atualizador Desktop verifica
a assinatura com a chave pública incorporada e confere os bytes antes de abrir
o instalador Windows ou o pacote Linux. Não há fallback para aceitar arquivo
sem assinatura interna ou com hash divergente.

Isso não é Authenticode e não identifica um publicador validado pela Microsoft.
EXEs podem exibir publicador desconhecido, SmartScreen ou ser bloqueados por
políticas do Windows. Não desative antivírus ou proteções para contornar alertas.
Um certificado comercial poderá ser adicionado no futuro sem remover a
verificação interna. A Microsoft Store continua com seu processo próprio de
validação/assinatura: gerar ou anexar APPX no GitHub não publica na loja.

## Chave privada

`public/release-trust.js` contém somente a chave pública. A privada permanece
fora do repositório, protegida por DPAPI em
`%APPDATA%/VoiceUP/release-signing/release-ed25519.dpapi`.
`tools/sign-release.ps1` a usa localmente sem incluí-la nos downloads ou logs.
Não execute o gerador para cada versão: trocar a chave quebraria a confiança
dos aplicativos já instalados. Preserve uma cópia segura e protegida da chave.

A assinatura interna protege a integridade e a origem dos pacotes; não garante
que o software não tenha bugs nem impede abuso se a chave privada for roubada.
Comprometimento exige resposta coordenada e rotação explicitamente planejada.

## Android, SelfWeb e Cloud

O APK possui também assinatura Android. A 1.2.0 usa a mesma chave das betas
anteriores para permitir upgrade sem apagar o perfil; o certificado conserva
o rótulo histórico Android Debug, mas o pacote release não é depurável.
Não substitua essa chave por uma recém-gerada. Um eventual Google Play exige
procedimento de assinatura e publicação próprio.

SelfWeb não instala código nativo nem atualiza seu HTML automaticamente. Baixe
o arquivo da Release oficial/site e use o manifesto para conferir sua origem.
O site confere assinatura e hash do APK/HTML local antes de enviá-los; Linux e
Windows apontam para os nomes assinados na Release. O ZIP do Cloud também tem
hash no manifesto completo. Seu catálogo interno exclui o próprio ZIP para
evitar hash circular. Nenhuma chave privada ou base de usuários entra no ZIP.

## Publicação

1. Gere e teste todas as edições com a mesma versão estável X.Y.Z.
2. Normalize os instaladores: `VoiceUP.Setup.X.Y.Z.exe` e
   `VoiceUPServer.Setup.X.Y.Z.exe`. Não mude esses nomes de compatibilidade.
3. Assine o catálogo de downloads, prepare o Cloud e assine o manifesto final.
4. Execute `tools/publish-release.js`: o rascunho só se torna público quando
   todos os arquivos obrigatórios e os hashes informados pelo GitHub conferem.
5. Nunca substitua bytes já públicos sob a mesma versão.

A automação do GitHub pode compilar sem chaves. Guardar chaves nos Secrets
requer autorização específica do mantenedor. Enquanto não houver autorização,
assine e publique localmente. Os Secrets opcionais são
`VOICEUP_RELEASE_PRIVATE_KEY`, `VOICEUP_ANDROID_KEYSTORE`,
`VOICEUP_ANDROID_STORE_PASSWORD`, `VOICEUP_ANDROID_KEY_PASSWORD` e
`VOICEUP_ANDROID_KEY_ALIAS`. Nunca os coloque em arquivos versionados.

## Compatibilidade

A 1.1.2 pública encontra os nomes históricos e pode baixar a 1.2.0. Betas que
já exigiam Authenticode e versões antigas com URLs gravadas incorretamente
podem precisar de uma instalação manual de transição; não é possível trocar
o atualizador de um programa já instalado apenas mudando o servidor.
Chamadas/chat têm protocolo separado dessa verificação de pacotes.
