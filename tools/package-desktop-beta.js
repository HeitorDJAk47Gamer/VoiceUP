'use strict';

// Local-only beta bundle. This script never publishes, tags or changes updater catalogs.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(version)) {
  throw new Error('A versão desktop precisa usar X.Y.Z-beta.N.');
}

const clientBuild = path.resolve(root, process.argv[2] || 'release-beta');
const serverBuild = path.resolve(root, process.argv[3] || 'release-beta-server');
const output = path.resolve(root, process.argv[4] || `test-v${version}`);
const expectedOutput = path.resolve(root, `test-v${version}`);
if (output !== expectedOutput) throw new Error(`Destino inesperado: ${output}`);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function normalizeRelativePath(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (
    !normalized
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').includes('..')
    || normalized === 'SHA256.txt'
  ) {
    throw new Error(`Caminho inseguro no pacote: ${value}`);
  }
  return normalized;
}

const hashes = new Map();
const existingManifest = path.join(output, 'SHA256.txt');
if (fs.existsSync(output)) {
  if (!fs.existsSync(existingManifest)) {
    throw new Error(`A pasta da beta já existe sem SHA256.txt: ${output}`);
  }

  for (const line of fs.readFileSync(existingManifest, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64}) {2}(.+)$/i);
    if (!match) throw new Error(`Linha inválida em SHA256.txt: ${line}`);
    const relative = normalizeRelativePath(match[2]);
    const file = path.resolve(output, ...relative.split('/'));
    if (!file.startsWith(`${output}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new Error(`Artefato registrado ausente ou inseguro: ${relative}`);
    }
    const expectedHash = match[1].toLowerCase();
    const actualHash = sha256(file);
    if (actualHash !== expectedHash) {
      throw new Error(`SHA-256 divergente no artefato existente: ${relative}`);
    }
    hashes.set(relative, actualHash);
  }
}
fs.mkdirSync(output, { recursive: true });

function record(file) {
  const relative = normalizeRelativePath(path.relative(output, file));
  hashes.set(relative, sha256(file));
}
function copyFile(source, relativeTarget, required = true) {
  if (!fs.existsSync(source)) {
    if (required) throw new Error(`Artefato ausente: ${source}`);
    return false;
  }
  const relative = normalizeRelativePath(relativeTarget);
  const target = path.join(output, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isFile() || sha256(source) !== sha256(target)) {
      throw new Error(`Colisão com conteúdo diferente: ${relative}`);
    }
    record(target);
    return true;
  }
  fs.copyFileSync(source, target);
  record(target);
  return true;
}
function write(relativeTarget, content, acceptedPreviousContents = []) {
  const relative = normalizeRelativePath(relativeTarget);
  const target = path.join(output, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) {
    if (!fs.statSync(target).isFile()) {
      throw new Error(`Colisão com conteúdo diferente: ${relative}`);
    }
    const existingContent = fs.readFileSync(target, 'utf8');
    if (existingContent === content) return;
    if (!acceptedPreviousContents.includes(existingContent)) {
      throw new Error(`Colisão com conteúdo diferente: ${relative}`);
    }
  }
  fs.writeFileSync(target, content, 'utf8');
}

function copyDirectoryAdditive(source, relativeTarget) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Diretório de artefatos ausente: ${source}`);
  }
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourceEntry = path.join(source, entry.name);
    const targetEntry = path.posix.join(normalizeRelativePath(relativeTarget), entry.name);
    if (entry.isDirectory()) copyDirectoryAdditive(sourceEntry, targetEntry);
    else if (entry.isFile()) copyFile(sourceEntry, targetEntry);
    else throw new Error(`Tipo de arquivo não suportado no pacote: ${sourceEntry}`);
  }
}

for (const [build, target, executable, installerProduct] of [
  [clientBuild, 'Client', 'VoiceUP.exe', 'VoiceUP'],
  [serverBuild, 'ServerHost', 'VoiceUPServer.exe', 'VoiceUPServer']
]) {
  const unpacked = path.join(build, 'win-unpacked');
  if (!fs.existsSync(unpacked)) throw new Error(`Pacote portátil ausente: ${unpacked}`);
  copyDirectoryAdditive(unpacked, target);
  record(path.join(output, target, executable));
  record(path.join(output, target, 'resources', 'app.asar'));
  const installer = `${installerProduct} Setup ${version}.exe`;
  copyFile(path.join(build, installer), path.join('Instaladores', installer));
  copyFile(path.join(build, `${installer}.blockmap`), path.join('Instaladores', `${installer}.blockmap`));
}

const cloudName = `VoiceUP-Server-Cloud-${version}.zip`;
const cloudIncluded = copyFile(path.join(root, 'deploy', cloudName), path.join('Cloud', cloudName), false);

for (const suffix of ['A', 'B', 'C']) {
  write(`Abrir Cliente ${suffix}.cmd`, `@echo off\r\nstart "VoiceUP Cliente ${suffix}" "%~dp0Client\\VoiceUP.exe" --user-data-dir="%~dp0dados\\cliente-${suffix.toLowerCase()}"\r\n`);
}
write('Abrir ServerHost.cmd', '@echo off\r\nstart "VoiceUP ServerHost" "%~dp0ServerHost\\VoiceUPServer.exe" --voiceup-port=3000 --voiceup-data-dir="%~dp0dados\\serverhost"\r\n');

const baseReadmeContent = `# VoiceUP ${version} — beta local para Windows${cloudIncluded ? ' e Cloud' : ''}\n\nEsta pasta foi gerada para testes e não foi publicada no site, GitHub ou atualizador.\n\n## Destaques desta beta\n\n- Sons distintos ao conectar ou desconectar do servidor, entrar ou sair da call, abrir ou fechar uma live e ganhar ou perder espectadores.\n- Cargos coloridos com posição e sete permissões configuráveis no ServerHost.\n- Pessoas autorizadas podem clicar em outro membro e acessar Mover, Cargos e Punições no próprio Client, sem intervenção de quem opera o ServerHost.\n- Ctrl + clique seleciona pessoas específicas; o grupo pode ser movido junto por arraste ou pela barra de destino.\n- A hierarquia é validada no servidor: toda pessoa, inclusive Administrador, só pode editar cargos e membros estritamente abaixo do próprio nível.\n- Administradores equivalentes não podem remover cargos, mover nem punir um ao outro; o operador local do ServerHost permanece como recuperação.\n- As permissões ficam vinculadas à identidade criptográfica persistente, não somente ao nick.\n- Clientes antigos continuam podendo entrar, mas não recebem permissões administrativas.\n- Entradas, saídas e ações administrativas ficam em uma auditoria local no disco, sem mensagens, senhas ou chaves privadas.\n- Atualização do Windows preparada para instalação silenciosa, com progresso temático que pode ser minimizado durante download e verificação.\n- Perfil, identidade, servidores salvos, salas, cargos, plugins e preferências permanecem no diretório persistente da instalação.${cloudIncluded ? '\n- O pacote Cloud foi incluído somente como artefato local; nenhum catálogo público foi alterado.' : ''}\n\n## Teste recomendado\n\n1. Abra \`Abrir ServerHost.cmd\` e depois \`Abrir Cliente A.cmd\` e \`Abrir Cliente B.cmd\`.\n2. Entre com os Clients em \`http://127.0.0.1:3000\` e na mesma sala.\n3. No ServerHost, abra \`Cargos e acesso\`, atribua Administrador ao Cliente A e confirme que o botão \`Gerenciar\` aparece nele.\n4. No Cliente A, clique em outro membro e confira Mover de call, Adicionar ou remover cargos e Aplicar punição.\n5. Segure Ctrl, clique em duas pessoas e mova o grupo por arraste e pela barra de destino.\n6. Crie um cargo intermediário e confirme que ele não consegue selecionar, mover ou moderar Administrador.\n7. Atribua Administrador também ao Cliente B e confirme que A e B não conseguem abrir ações, mover, punir ou remover os cargos um do outro.\n8. Reinicie Client e ServerHost e confirme que perfil, salas, cargos e preferências continuam salvos.\n9. Confira os sons de servidor, call e live com os dois clientes.\n\nO fluxo silencioso de atualização só pode ser exercitado por completo quando existir uma versão oficial superior, assinada e publicada. Esta beta valida localmente a seleção, a assinatura, o progresso e o lançamento silencioso sem alterar o catálogo público.\n\nOs instaladores estão em \`Instaladores\`. Cliente e ServerHost possuem identidades diferentes, portanto um não deve substituir o outro. Os binários locais não têm assinatura Authenticode e o Windows pode exibir “editor desconhecido”.\n`;

write('TESTE-GERENCIAMENTO-PELO-CLIENT.md', `# Teste do gerenciamento pelo Client — ${version}\n\n1. Conceda a um membro uma ou mais permissões: \`Mover pessoas entre calls\`, \`Gerenciar cargos\` ou \`Expulsar, castigar e banir\`.\n2. Confirme que aparece o botão \`Membros\`, separado de \`Configurar\`.\n3. Abra \`Membros\`: a lista fica à esquerda e as ações da pessoa escolhida ficam à direita.\n4. Clique também em alguém pela lista do canal; o menu rápido deve mostrar somente as ações liberadas e levar à mesma tela com a pessoa já selecionada.\n5. Em Cargos, marque ou desmarque uma opção: a alteração deve ser enviada imediatamente, mostrar o estado de salvamento e não exigir botão Salvar. Repita em Pessoas e cargos no ServerHost.\n6. Teste Mover de call e Moderação. Uma pessoa com apenas permissão de moderação não pode abrir Configurações do servidor.\n7. Pessoas de posição igual ou superior continuam visíveis no diretório, mas não exibem ações; isso também vale entre dois Administradores equivalentes.\n8. Confirme que um Administrador não consegue editar um cargo na própria posição nem criar um cargo no mesmo nível ou acima.\n9. Bots e o próprio usuário não podem ser alvos. Um Client antigo sem identidade protegida pode ser movido ou punido, mas não pode receber cargos persistentes.\n10. Revogue as permissões e confirme que o botão Membros, o menu e qualquer tela aberta desaparecem imediatamente.\n\nO ServerHost precisa permanecer ligado porque hospeda a sala, mas o operador não precisa intervir: o membro autorizado realiza a ação no Client, e o servidor valida permissão e hierarquia e grava a auditoria automaticamente. Se o servidor recusar uma marcação de cargo, a interface deve restaurar o estado anterior.\n`);

write('TESTE-ADMINISTRACAO-SEPARADA.md', `# Teste das áreas administrativas — ${version}\n\n## Configurar servidor\n\n- Deve abrir uma área com navegação própria: Visão geral, Canais, Cargos e Auditoria.\n- Cada pessoa vê somente as categorias permitidas ao seu cargo.\n- Cargos serve para criar a hierarquia, as cores e as permissões; não mistura a atribuição de cargos aos membros.\n\n## Membros\n\n- Deve abrir uma tela separada, com busca e lista de pessoas à esquerda.\n- Ao selecionar alguém, a direita mostra somente Mover de call, Cargos e/ou Moderação que aquele operador pode executar.\n- Um moderador sem permissão estrutural vê Membros, mas não Configurar.\n- Um auditor sem permissão sobre pessoas vê Configurar > Auditoria, mas não Membros.\n- Se a permissão for removida enquanto a tela estiver aberta, ela deve fechar imediatamente.\n\nA organização segue o padrão familiar de comunidade: estrutura do servidor e trabalho diário com pessoas não ocupam o mesmo formulário. A identidade visual e as validações continuam sendo do VoiceUP.\n`);

write('TESTE-ARRASTAR-MEMBROS.md', `# Teste de mover membros e seleção múltipla — ${version}\n\n1. Entre no mesmo servidor com pelo menos três Clients e coloque os participantes em calls.\n2. Dê ao Cliente A um cargo com a permissão \`Mover pessoas entre calls\`.\n3. No Cliente A, segure Ctrl e clique em pessoas específicas na lista do canal ou na aba Membros.\n4. Cada pessoa escolhida deve ganhar a marca do tema e a barra inferior deve informar a quantidade selecionada.\n5. Arraste uma das pessoas selecionadas para outra call: todas as selecionadas devem ser movidas.\n6. Selecione o grupo novamente, escolha um destino na barra e clique em \`Mover\`.\n7. Use o X ou Esc para limpar a seleção e teste também o destino \`Fora da call\`.\n8. Remova a permissão do Cliente A: seleção, cursor de arraste e destino \`Fora da call\` devem desaparecer.\n9. Dê a uma das pessoas um cargo igual ou superior e confirme que ela não pode ser adicionada ao grupo.\n10. Confira a auditoria do ServerHost: cada movimentação deve informar autor, pessoa e destino.\n\nA interface nunca ignora as proteções em uma ação de grupo: cada pessoa usa \`admin:move-member\`, e o ServerHost valida permissão, hierarquia, canal e lotação antes de aplicar. Falhas permanecem selecionadas para nova tentativa.\n`);

write('TESTE-LAYOUT-CHAMADA.md', `# Teste do layout da chamada — ${version}\n\n- Sem live ou câmera: os participantes devem aparecer em cartões quadrados e diminuir de forma responsiva conforme mais pessoas entram.\n- Com live ou câmera aberta: os participantes devem ir para uma faixa horizontal na parte inferior.\n- A seta da faixa deve ocultar e mostrar os participantes sem encerrar a mídia.\n- A quantidade exibida na faixa deve acompanhar os participantes conectados.\n- Em tela cheia, a faixa deve continuar acessível.\n`);
write('TESTE-TEMAS-GRADIENTES.md', `# Teste dos temas gradientes — ${version}\n\nAbra Configurações > Aparência > Temas. A seleção agora separa Cores sólidas e Gradientes. Há 19 gradientes:\n\n## Escuros\n\n- Nebulosa\n- Ártico noturno\n- Eclipse\n- Matrix\n- Rosa noir\n- Inferno\n- Abismo\n- Galáxia\n- Cobre\n- Tóxico\n- Boreal\n- Safira profunda\n- Ameixa noturna\n- Tempestade\n\n## Claros\n\n- Alvorada\n- Geleira\n- Céu lavanda\n- Brisa menta\n- Solar\n\nConfira as duas subcategorias, a prévia, o contraste de textos e a persistência do tema após fechar e abrir o Client.\n`);
write('TESTE-INICIALIZACAO-WINDOWS.md', `# Teste da inicialização com o Windows — ${version}\n\n1. Instale e abra o VoiceUP Client.\n2. Em Configurações > Geral, confirme que “Iniciar com o Windows” começa desligado.\n3. Ative a opção e feche/reabra as Configurações; ela deve continuar ligada.\n4. Confira em Windows > Configurações > Aplicativos > Inicialização que VoiceUP está habilitado.\n5. Desative no VoiceUP e confirme que o Windows também mostra a entrada desabilitada.\n\nA opção existe apenas no Client Windows instalado. Execuções locais de desenvolvimento, Linux e navegador não criam uma entrada de inicialização.\n`);
write('TESTE-SELOS-DE-PLATAFORMA.md', `# Teste dos selos de plataforma — ${version}\n\n- No perfil do canto inferior esquerdo, o ícone deve ficar pequeno e contido no botão de status.\n- Na aba Membros do painel direito, o selo deve ocupar menos da metade da largura do avatar e deixar a foto visível.\n- Na lista de canais, o selo deve acompanhar o avatar menor sem cobrir o rosto.\n- No painel Pessoas do ServerHost, o selo deve permanecer proporcional ao avatar.\n- Nos cartões da chamada e na faixa das lives, o selo deve ficar no canto inferior direito do avatar, nunca no centro.\n- Todos os selos devem ter apenas 1 px de respiro ao redor do desenho da plataforma.\n- Confira Windows, Linux, Android e SelfWeb nos estados verde, laranja e vermelho.\n`);

write('TESTE-CANAIS-PELO-CLIENT.md', `# Teste de canais pelo Client — ${version}\n\n1. No ServerHost, atribua ao Cliente A um cargo com \`Criar e editar canais\`.\n2. Sem voltar ao painel do host, abra \`Configurar\` no Cliente A e escolha \`Canais\`. A área deve listar voz e texto e mostrar \`+ Voz\` e \`+ Texto\`.\n3. Crie uma call definindo categoria, posição, quantidade de membros, bitrate, região e bloqueio.\n4. Crie um chat definindo categoria, posição, tópico, cooldown e somente leitura.\n5. Em Quem pode ver, não marque nada e confirme com o Cliente B que o canal aparece para todos.\n6. Edite o canal, marque apenas um cargo e confirme que um perfil sem esse cargo deixa de ver o canal.\n7. Tente entrar ou enviar uma mensagem com o perfil sem acesso: o ServerHost deve recusar mesmo se o evento for forçado.\n8. Atribua o cargo permitido ao Cliente B pela tela \`Membros\` e confirme que o canal aparece sem reiniciar o programa.\n9. Remova novamente o cargo enquanto o Cliente B estiver na call restrita; ele deve voltar para Fora da call.\n10. Reinicie o ServerHost e confirme que todos os campos e os cargos permitidos foram preservados.\n\nO nome de um canal existente fica bloqueado no editor desta beta para não quebrar histórico ou chamadas em andamento. Os demais campos podem ser alterados por quem possui a permissão.\n`);

write('TESTE-BACKUP-SERVERHOST.md', `# Teste de backup e migração do ServerHost — ${version}\n\n1. No ServerHost, crie uma sala com canais próprios, um cargo, algumas mensagens e, se quiser, um banimento ou castigo.\n2. Abra Configurações > Backup e migração. Plugins personalizados são incluídos por padrão; músicas são opcionais porque podem deixar o arquivo grande.\n3. Clique em \`Criar backup\`, escolha uma pasta fora do VoiceUP e guarde o arquivo \`.voiceup-backup\`.\n4. Altere ou apague algum dado apenas para o teste.\n5. Clique em \`Restaurar backup\`, selecione o arquivo e confira o resumo antes de confirmar.\n6. O ServerHost deve criar primeiro uma cópia do estado atual na pasta \`Backups\`, restaurar o arquivo escolhido e reiniciar automaticamente.\n7. Depois de reabrir, confirme salas, canais, mensagens, cargos, permissões, moderação e opções de plugins.\n8. Para simular outro computador, instale o ServerHost em outro PC e carregue o mesmo arquivo. Nenhum caminho absoluto do PC antigo é necessário.\n9. Plugins externos são restaurados desativados e precisam de nova aprovação por segurança; plugins oficiais continuam reconhecidos.\n\nO backup contém mensagens, identificadores, hashes de senhas de salas e a chave do cluster. Trate o arquivo como privado. Se os dois computadores forem usados ao mesmo tempo, revise as opções de cluster e endereço público depois da migração.\n`);

write('TESTE-CHAT-CODIGO-E-TXT.md', `# Teste do chat com código e TXT — ${version}\n\n## Bloco de código\n\n1. Entre com dois Clients na mesma sala e abra o mesmo canal de texto.\n2. Digite três crases seguidas, \`py\` na mesma linha, pule uma linha, escreva \`import os\` e \`print('hello, world!')\`, então feche com mais três crases.\n3. Confira a identificação Python, as cores de sintaxe e o botão Copiar.\n4. Coloque uma URL e também \`<script>alert(1)</script>\` dentro do bloco: ambos devem continuar texto, sem prévia externa e sem execução.\n5. Use Shift + Enter para quebrar linha; Enter sozinho deve enviar.\n\n## TXT automático\n\n1. Envie uma mensagem com até 500 caracteres: ela deve continuar como mensagem normal.\n2. Envie uma com 501 ou mais: deve aparecer um cartão \`mensagem.txt\`, sem abrir janela para escolher arquivo.\n3. Confira a prévia recolhida, o tamanho, a seta de expandir, Copiar e Baixar; compare o arquivo baixado com o texto original.\n4. Reconecte um terceiro Client e confirme que o TXT reaparece pelo histórico do ServerHost. Repita com o Cloud local se desejar.\n5. Tente ultrapassar 30.000 caracteres ou 64 KB: o Client ou o servidor deve recusar com aviso.\n\nClients antigos continuam conectando e veem o resumo “Arquivo de texto: mensagem.txt”, mas somente esta beta ou uma versão posterior consegue abrir o conteúdo do anexo. O código é sempre renderizado como texto escapado e nunca é executado.\n`);

write('TESTE-CANAIS-AVANCADOS.md', `# Teste dos canais avançados — ${version}\n\n## Lista de membros por cargo\n\n1. Crie dois cargos e ative \`Exibir membros separadamente\` em somente um deles.\n2. Atribua o cargo a algumas pessoas e confirme que a lista lateral cria a seção colorida do cargo.\n3. Remova ou troque o cargo e confirme que a lista se reorganiza e salva automaticamente.\n\n## Canal de Palco\n\n1. Crie um canal de Palco e defina quem pode falar ou gerenciar.\n2. Entre com apresentador e ouvinte; o ouvinte deve entrar na plateia e só falar após promoção autorizada.\n\n## Fórum\n\n1. Crie um Fórum com tópico, tags e permissões.\n2. Abra uma publicação, responda e confirme a organização interna por tópicos sem misturar com o chat comum.\n\n## Canal dinâmico\n\n1. Crie um canal dinâmico e escolha o limite das calls temporárias.\n2. Entre com um perfil chamado Ana: o servidor deve criar a call temporária \`Ana\` e mover o perfil para ela.\n3. Entre nessa call com outra pessoa, retire Ana e confirme que a call continua existindo enquanto a segunda pessoa estiver nela.\n4. Retire a última pessoa e confirme que a call \`Ana\` desaparece automaticamente.\n5. Use dois perfis com o mesmo nome e confirme que a segunda call recebe um sufixo numérico sem substituir a primeira.\n\nReinicie o ServerHost ao final e confirme que cargos, canais, fóruns e opções reaparecem. As calls temporárias não devem reaparecer após reiniciar; criação, alteração e remoção dos canais configurados devem ser salvas automaticamente e registradas na auditoria.\n`);

write('TESTE-FORUM-RESPONSIVO.md', `# Teste do fórum responsivo — ${version}\n\n1. Fora de uma call, abra um canal de Fórum na área central. A lista de tópicos deve ocupar a coluna esquerda e Novo tópico a coluna direita, usando a largura disponível.\n2. Entre em uma call e abra o mesmo Fórum pela aba Chat. Tópicos, título, mensagem e Publicar tópico devem ficar em uma única coluna.\n3. Confirme que nenhum texto fica cortado, nenhum campo sai do painel e o botão Publicar tópico ocupa toda a largura útil.\n4. Redimensione a janela até o layout compacto e repita os dois modos.\n5. Troque entre um tema escuro e um claro: botões, campos, foco e contraste devem acompanhar o tema sem superfícies brancas nativas.\n`);

const finalReadmeContent = baseReadmeContent
  .replace('## Destaques desta beta', '## Destaques desta beta\n\n- Marcar ou desmarcar um cargo salva imediatamente no Client e no ServerHost, sem botão ou legenda permanente; o andamento aparece somente durante a gravação ou em caso de erro.\n- Canais dinâmicos criam uma call temporária com o nome de quem entrou e só a removem depois que a última pessoa sair.\n- Fóruns responsivos usam uma coluna no painel lateral e duas colunas na área central, sem campos ou botões espremidos.\n- Botões sem estilo dedicado agora herdam as superfícies, o contraste e o foco do tema em vez do branco padrão do navegador.')
  .replace('Sons distintos ao conectar ou desconectar do servidor, entrar ou sair da call, abrir ou fechar uma live e ganhar ou perder espectadores.', 'Sons distintos ao conectar ou desconectar do servidor, entrar ou sair da call, abrir ou fechar uma live e ganhar ou perder espectadores.\n- Blocos entre três crases mostram a linguagem e recebem destaque de sintaxe seguro, com botão para copiar o código.\n- Mensagens humanas acima de 500 caracteres viram automaticamente um `mensagem.txt` com prévia, expansão, cópia e download.')
  .replace('Pessoas autorizadas podem clicar em outro membro e acessar Mover, Cargos e Punições no próprio Client, sem intervenção de quem opera o ServerHost.', 'Administração separada: Configurar reúne Visão geral, Canais, Cargos e Auditoria; Membros abre um diretório próprio para ações sobre cada pessoa.')
  .replace('que o botão `Gerenciar` aparece', 'que os botões `Membros` e `Configurar` aparecem')
  .replace('No Cliente A, clique em outro membro e confira Mover de call, Adicionar ou remover cargos e Aplicar punição.', 'No Cliente A, abra Membros ou clique em outra pessoa; confira Mover de call, Cargos e Moderação na tela exclusiva.');
write('LEIA-ME-TESTE.md', finalReadmeContent, [baseReadmeContent]);

write('TESTE-ESTABILIDADE-LIVES.md', `# Estabilidade das lives — ${version}\n\nA transmissão equilibra nitidez e movimento. A qualidade original mantém a resolução da fonte, com envio limitado a 60 FPS e teto de bitrate proporcional à resolução. Cada conexão reduz o limite de FPS após três amostras consecutivas de pressão de rede ou codificação; a recuperação exige pelo menos 30 segundos saudáveis e 45 segundos desde a última mudança. O WebRTC continua adaptando a qualidade em tempo real.\n\n## Conferência em calls reais\n\n1. Compare uma live em 720p/60 e outra em 1080p/30 com um, dois e três espectadores.\n2. Abra duas lives simultâneas e confira nitidez, movimento e áudio.\n3. Durante uma limitação prolongada de upload, observe a adaptação; após normalizar a rede, aguarde a recuperação gradual.\n4. Pare e reinicie a transmissão, troque de qualidade e de canal; confirme que o limite adaptado da transmissão anterior não fica preso na nova.\n5. Confira também uma fonte estática: falta de movimento não deve ser tratada como sobrecarga.\n\nA validação local cobre a política de adaptação, envio/recepção WebRTC a 720p/60 e a interface de duas lives. Ela não reproduz todas as GPUs, redes e jogos dos usuários. Cada espectador P2P acrescenta tráfego de upload.\n`);

write('TESTE-TELA-CHEIA.md', `# Tela cheia — ${version}\n\nAbra uma live em tela cheia. A imagem deve ocupar a tela sem moldura, laterais do aplicativo, prévia local ou faixa de participantes. Os controles aparecem ao mover o mouse e somem após 2,2 segundos sem interação; teclado e foco mantêm os botões acessíveis. Escape e Sair da tela cheia restauram o layout da call. Confira também duas lives e o encerramento da transmissão enquanto ela está em tela cheia.\n\nA proporção original do vídeo é preservada, portanto fontes com proporção diferente da tela podem ter faixas pretas sem recorte ou distorção.\n`);

write('TESTE-MELHORIAS-DESKTOP.md', `# Melhorias desktop — ${version}\n\nBeta local: Client e ServerHost Windows. Não publicada.\n\n- Atualizador: ao falhar ou reiniciar antes de concluir, oferece nova tentativa. Instalador já baixado é revalidado com manifesto assinado e hash. Downloads parciais recomeçam; não há rollback/downgrade automático. Perfis e dados não são apagados.\n- Acessibilidade: Configurações > Acessibilidade. Texto, contraste, movimento reduzido, foco de teclado e diálogos.\n- Atalhos: Configurações > Atalhos. Pressione uma combinação com Ctrl/Alt e uma letra, número ou F1–F24; Delete limpa. Conflitos são informados ao sair do campo. Push-to-talk funciona com a janela em foco.\n- Espectador: no controle de cada live, escolha Máximo/automático ou até 360p, 480p, 720p, 1080p a 30 FPS. O transmissor define o teto. Requer transmissor atualizado para confirmar o ajuste. P2P continua consumindo upload por pessoa.\n- Reconexão: interrompa a rede brevemente; confira retorno ao canal sem duplicação e visualizações recuperadas. Cancelar não deve reconectar por conta própria. Troca manual de servidor ou expulsão não deve ser revertida. P2P manual sem servidor não tem sinalização automática para renegociar.\n\nValidação automatizada: políticas e isolamento por envio, renderização, duas lives, tela cheia, integridade, compatibilidade e deduplicação de sessões. Ainda requer uso real com redes, jogos e dispositivos diferentes.\n`);

write('TESTE-ANEXOS-E-VOZ.md', `# Anexos e mensagens de voz — ${version}\n\nNo ServerHost, abra Configurações e ative Permitir arquivos e mensagens de voz nos chats. O host define o limite por arquivo, de 1 até 256 MB por capacidade técnica compatível com o backup portátil (padrão 5 MB). O botão + e o botão de gravação aparecem no Client conectado; servidores antigos ou com a opção desligada não os mostram. Atualizações de permissão aparecem em até 15 segundos, e o servidor sempre revalida cada envio.\n\n1. Selecione uma ou várias imagens, PDFs ou arquivos genéricos. Cada arquivo recebe validação individual pelo limite do host e é publicado como anexo próprio.\n2. Ao receber um anexo, aguarde a abertura automática: PNG/JPEG e áudios compatíveis aparecem no chat após a verificação de integridade; outros documentos ficam prontos para baixar. Arquivos nunca são executados automaticamente.\n3. Grave uma mensagem, pare, ouça a prévia e escolha Enviar áudio ou Descartar. Gravação máxima de 10 minutos, respeitando o limite de tamanho.\n4. Use Falar para escrever, dite uma frase e confirme que ela apenas preenche a caixa; revise e clique em Enviar para publicar. O recurso depende do reconhecimento de fala do sistema.\n5. Confira acesso a canais privados, castigos, somente leitura, cooldown e queda da conexão.\n6. Faça backup e restaure: anexos e mensagens devem continuar disponíveis juntos.\n7. Confira ícone e nome público no topo da lateral.\n\nArquivos grandes são transmitidos em blocos e gravados diretamente no disco do ServerHost, sem ocupar a memória inteira. Há proteções técnicas de 384 MB armazenados e 10.000 anexos para impedir que uma instalação seja esgotada por abuso; não são o limite por arquivo configurado pelo host. Não há limpeza automática dos arquivos ao apagar mensagens nesta beta. A transferência é servida pelo host que recebeu o arquivo; distribuição de anexos entre hosts federados ainda não está implementada. Nada foi publicado.\n`);

const manifest = [...hashes.entries()]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([relative, hash]) => `${hash}  ${relative}`)
  .join('\n');
fs.writeFileSync(path.join(output, 'SHA256.txt'), `${manifest}\n`, 'utf8');
console.log(`Beta local criada: ${output}`);
console.log(`${hashes.size} artefatos essenciais registrados em SHA256.txt.`);
