# VoiceUP Server Cloud

O Cloud coordena presença, sinalização WebRTC e chat. Voz, vídeo e tela seguem
diretamente entre os clientes quando a rede permite; mensagens de texto passam
pelo servidor e têm histórico SQLite.

O pacote funciona em qualquer hospedagem Node.js com WebSocket/Socket.IO e uma
porta definida por PORT. Requer Node.js 22.13 ou superior; a configuração
Node.js 24 da ShardCloud é compatível.

## Publicação

1. Instale exatamente as dependências travadas:

       npm ci

2. Configure um volume persistente e aponte VOICEUP_DATA_DIR para ele.
3. Copie somente as variáveis necessárias de .env.example para o painel da
   hospedagem; não envie um arquivo .env com segredos.
4. Gere o ZIP público a partir da raiz do repositório:

       powershell -File tools/package-cloud.ps1 -Version X.Y.Z

5. Envie deploy/VoiceUP-Server-Cloud-X.Y.Z.zip para a hospedagem.
6. Use no Cliente o endereço HTTPS fornecido, por exemplo
   https://SEU_SUBDOMINIO.shardweb.app.

O empacotador usa uma lista fechada. Bancos, relatórios, logs, arquivos .env,
node_modules e plugins não oficiais não entram no ZIP por acidente.

## Persistência e retenção

O chat e os relatórios de bugs ficam em data/voiceup.db. Na primeira execução,
os antigos data/chat-history.json e data/bug-reports.json são importados e
preservados como cópia de segurança.

Opções:

- VOICEUP_DATA_DIR: diretório do volume persistente;
- VOICEUP_CHAT_RETENTION_DAYS=30: idade máxima das mensagens; use 0 para não
  apagar por idade;
- VOICEUP_CHAT_MAX_PER_ROOM=300: máximo de mensagens por sala;
- VOICEUP_MAX_HUMANS_PER_CALL=12: participantes humanos por call;
- VOICEUP_MAX_MEMBERS_PER_CALL=15: total incluindo bots;
- VOICEUP_MAX_IDENTITIES=50000: teto de identidades criptográficas persistidas
  para impedir crescimento ilimitado do arquivo de segurança.

Relatórios de bugs são limitados aos 500 mais recentes e permanecem até limpeza
administrativa. Revise a Política de Privacidade antes de alterar a retenção.

## Health público e diagnóstico privado

Público:

- /status: página de disponibilidade;
- /health e /stats: estado e números operacionais agregados;
- /api/status: números públicos consumidos pelo site.
- /downloads/android: baixa o APK atual do VoiceUP Mobile;
- /api/mobile-release: informa versão, compatibilidade, hash e endereço do APK.

Privado:

- /admin/health e /api/admin/health: armazenamento, erros, logs e estado de
  plugins.

Defina VOICEUP_ADMIN_TOKEN com um valor aleatório de pelo menos 24 caracteres.
Sem token configurado, a rota privada responde como inexistente. Consulte-a com
o cabeçalho Authorization: Bearer SEU_TOKEN. Nunca coloque o token na URL, em
logs, prints ou issues.

## Origens permitidas

O app desktop, o site oficial e localhost já são reconhecidos. Para outro site,
adicione as origens HTTPS completas em VOICEUP_ALLOWED_ORIGINS, separadas por
vírgula. Não use curinga em produção.

## Salas privadas

VOICEUP_ROOM_PASSWORDS recebe um objeto JSON. Prefira hash scrypt em vez de
senha visível:

    {"amigos":"scrypt$SALT$HASH"}

Para gerar um valor local, troque MINHA_SENHA:

    node -e "const c=require('crypto'),s=c.randomBytes(16),p='MINHA_SENHA';console.log('scrypt$'+s.toString('hex')+'$'+c.scryptSync(p,s,32).toString('hex'))"

O formato antigo com senha direta ainda é aceito por compatibilidade, mas não é
recomendado.

## Plugins

Os três plugins incluídos no pacote são reconhecidos por seus hashes. Qualquer
outro arquivo JavaScript permanece bloqueado antes da execução.

Para aprovar conscientemente um plugin externo no Cloud:

1. revise o arquivo e sua origem;
2. calcule Get-FileHash -Algorithm SHA256 no Windows;
3. adicione o hash completo a VOICEUP_TRUSTED_PLUGIN_HASHES;
4. reinicie a aplicação.

Se o arquivo mudar, o hash deixa de corresponder e a aprovação precisa ser
refeita. Aprovação por hash não cria isolamento: o plugin aprovado executa com
os recursos do processo Cloud.

O catálogo público está em /plugins. Downloads oficiais:

- /downloads/plugins/dados
- /downloads/plugins/musica
- /downloads/plugins/xp-chat

## Downloads 1.2.0 com integridade verificada

O catálogo `downloads/release-downloads.json` tem assinatura Ed25519 verificada
com a chave pública incluída no código. Ele determina versão, nomes, destinos,
tamanhos e SHA-256 dos downloads; não contém chaves privadas.

- `/downloads/android`: APK 1.2.0, Android 6 ou superior, incluído no pacote Cloud.
- `/downloads/selfweb`: HTML leve incluído no pacote Cloud.
- `/downloads/linux/client` e `/downloads/linux/server`: redirecionam para os
  AppImages x64 oficiais no GitHub. Os respectivos `.deb` estão na mesma Release.
- `/downloads/linux/guide`: instruções e limitações da plataforma.
- `/downloads/linux/checksums`: hashes do catálogo assinado.
- `/api/mobile-release`, `/api/linux-release` e `/api/release`: metadados públicos.

APK e SelfWeb são conferidos antes de enviar seus bytes. Sem catálogo válido,
as rotas não oferecem arquivos sem verificação. Os instaladores Windows e os
pacotes Linux ficam na Release pública; não ocupam espaço duplicado no Cloud.
O Music Bot com áudio na call funciona no ServerHost Windows; o Cloud precisaria
de um processo de mídia adicional.

Para montar uma publicação, primeiro assine localmente o catálogo dos artefatos
(veja `SIGNING.md` na raiz), prepare os downloads e gere o Cloud:

```powershell
node tools/stage-cloud-downloads.js release-assets
powershell -ExecutionPolicy Bypass -File tools/package-cloud.ps1 -Version 1.2.0
```

O resultado `deploy/VoiceUP-Server-Cloud-1.2.0.zip` não inclui `.env`, bancos de
usuários, logs ou `node_modules`. Publique os binários no GitHub antes de atualizar
a hospedagem. Publicar o repositório privado ou gerar o ZIP, por si só, não prova
que a instância ShardCloud foi reiniciada com a nova versão.

## Limite de rede

O Cloud evita a necessidade de Radmin para encontrar a sala, mas a mídia
continua P2P. Redes muito restritas podem exigir um servidor TURN.
