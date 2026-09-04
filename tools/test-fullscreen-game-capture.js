const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(workspace, relativePath), 'utf8');
const main = read('electron-main.js');
const renderer = read(path.join('public', 'app.js'));
const i18n = read(path.join('public', 'i18n.js'));
const releaseNotes = read(path.join('public', 'release-history.js'));

const featureAt = main.indexOf("disableChromiumFeature('AllowWgcScreenCapturer')");
const readyAt = main.indexOf('app.whenReady()');
assert.ok(featureAt >= 0, 'O Client precisa ativar o capturador alternativo para telas no Windows.');
assert.ok(readyAt > featureAt, 'A escolha do backend de captura precisa ocorrer antes de o Electron ficar pronto.');
assert.match(main, /fullscreenGameCaptureCompatibility:\s*true/, 'A compatibilidade deve iniciar ligada para corrigir instalações existentes.');
assert.match(main, /process\.platform === 'win32'/, 'A troca do backend deve ficar limitada ao Windows.');
assert.match(main, /getSwitchValue\('disable-features'\)[\s\S]*current\.includes\(feature\)/, 'A opção precisa preservar outros recursos Chromium já desativados.');
assert.doesNotMatch(main, /AllowWgcWindowCapturer/, 'A captura de janela não deve perder o backend WGC sem necessidade.');
assert.match(main, /typeof next\.fullscreenGameCaptureCompatibility === 'boolean'/, 'Somente um booleano deve ser persistido pelo IPC.');
assert.match(main, /fullscreenGameCaptureCompatibilitySupported:\s*process\.platform === 'win32'/, 'A interface precisa saber quando a opção é compatível.');
assert.match(main, /restartRequired:[\s\S]*fullscreenGameCaptureCompatibilityAtStartup/, 'A mudança precisa solicitar reinício controlado.');

assert.match(renderer, /id="fullscreen-game-capture-toggle"/, 'A compatibilidade precisa ser controlável nas configurações.');
assert.match(renderer, /fullscreenGameCaptureCompatibility:\s*fullscreenGameCaptureCompatibilityEnabled/, 'A interface precisa salvar a escolha no processo principal.');
assert.match(renderer, /fullscreenGameCaptureCompatibilityActive/, 'A interface precisa comparar a escolha com o backend usado nesta abertura.');
assert.doesNotMatch(renderer, /cursor\s*:\s*['"]never['"]/, 'O cursor não pode ser removido da transmissão.');
assert.doesNotMatch(renderer, /capture-cursor-toggle|shareScreenCursor|screenCursorMode/, 'Não deve existir um controle que esconda o cursor da live.');

for (const locale of ['pt-BR', 'en-US', 'es-ES', 'fr-FR']) {
  assert.ok(i18n.includes(`'${locale}':`), `Idioma ausente: ${locale}`);
}
assert.equal((i18n.match(/'settings\.fullscreenGameCapture':/g) || []).length, 4, 'A opção precisa estar traduzida nos quatro idiomas.');
assert.match(releaseNotes, /cursor/i, 'As novidades precisam explicar a correção do cursor local.');

console.log('Captura de jogos em tela cheia validada: cursor mantido na live, fallback Windows configurável e reinício seguro.');
