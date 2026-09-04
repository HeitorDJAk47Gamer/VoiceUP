const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const betaUi = fs.readFileSync(path.join(root, 'public', 'beta-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'beta.css'), 'utf8');

const position = (needle) => {
  const value = html.indexOf(needle);
  assert.notEqual(value, -1, `Elemento ausente: ${needle}`);
  return value;
};

const profile = position('id="welcome-avatar-preview"');
const name = position('id="name-input"');
const host = position('id="host-connect"');
const hostUrl = position('id="host-url"');
const room = position('id="host-room"');
const p2p = position('id="p2p-connect"');
const invite = position('id="offer-input"');

assert.ok(profile < host, 'O perfil precisa ficar antes da conexão com servidor.');
assert.ok(name < host, 'O nick precisa ficar antes da conexão com servidor.');
assert.ok(host < hostUrl && hostUrl < room, 'URL e código precisam permanecer dentro do bloco do servidor.');
assert.ok(room < p2p && p2p < invite, 'O convite P2P precisa ficar após os dados do servidor.');
assert.match(app, /if \(!document\.querySelector\('#host-connect'\)\)/, 'A tela inicial não pode criar um segundo bloco de servidor.');
assert.match(app, /document\.querySelector\('#p2p-connect'\) \|\| document\.querySelector\('#host-connect'\)/, 'A sala direta deve ficar após o fluxo P2P.');
assert.match(betaUi, /host-connect-hint/, 'A lista de servidores salvos deve usar o rodapé correto do bloco de servidor.');
assert.match(app, /voiceup-welcome-open/, 'A tela inicial precisa aplicar seu layout antes das camadas beta opcionais.');
assert.match(app, /preview\.style\.backgroundImage/, 'A foto escolhida precisa aparecer imediatamente no círculo de perfil.');
assert.equal(app.indexOf("$('host-room').value = storedProfile.roomId || '';\nrefreshWelcomeProfile();"), -1, 'A prévia do perfil não pode rodar antes dos auxiliares de avatar.');
assert.ok(app.lastIndexOf('refreshWelcomeProfile();') > app.indexOf('const safeAvatar'), 'A prévia inicial precisa ser executada apenas após os auxiliares de avatar.');
assert.ok(app.lastIndexOf('refreshWelcomeProfile();') > app.indexOf("$('join-host').addEventListener"), 'Os cliques da tela inicial precisam ser registrados antes de atualizar a prévia.');
assert.match(betaUi, /voiceup-saved-server-actions-layout/, 'Os atalhos de servidores salvos precisam ter o ajuste de layout compacto.');
assert.match(betaUi, /grid-template-columns:minmax\(0,1fr\) auto!important/, 'Novo e Salvar atual precisam ficar lado a lado em telas largas.');
assert.match(css, /\.welcome:not\(\.hidden\)>\.intro\{display:none!important\}/, 'A introdução antiga não pode voltar ao canto da tela.');
assert.match(css, /\.welcome:not\(\.hidden\)\{display:flex/, 'A tela inicial deve ocupar e centralizar a janela.');
assert.doesNotMatch(css, /max-height:calc\(100dvh - 48px\)/, 'A tela inicial deve usar a rolagem da página, não prender o card em uma altura fixa.');

console.log('Tela inicial validada: perfil, servidor, P2P, centralização, rolagem e prévia da foto estão corretos.');
