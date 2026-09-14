'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const history = require('../public/release-history');
const read = path => fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');

test('stable release notes cover 1.2.1 -> 1.2.2 and scope platform differences', () => {
  assert.equal(history.from, '1.2.1'); assert.equal(history.version, '1.2.2');
  for (const [language, copy] of Object.entries(history.locales)) {
    assert.match(copy.title, /1\.2\.2/); assert.match(copy.subtitle, /1\.2\.1.*1\.2\.2/);
    assert.ok(copy.notes.length >= 6, language);
    assert.ok(copy.notes.every(note => note.length >= 45), `${language}: every note must explain the change`);
  }
  const pt = history.locales['pt-BR'].notes.join('\n');
  for (const token of ['ServerHost', 'backup', 'arquivos de código', 'Android', 'Ed25519', 'SHA-256', '1.1.0']) assert.match(pt, new RegExp(token));
  assert.doesNotMatch(history.locales['es-ES'].subtitle, /versão|reúne/);
});

test('browser catalog works without Node and is immutable', () => {
  const context = vm.createContext({}); vm.runInContext(read('public/release-history.js'), context);
  assert.equal(context.voiceupReleaseHistory.version, history.version);
  assert.ok(Object.isFrozen(context.voiceupReleaseHistory.locales['pt-BR'].notes));
  assert.equal(context.voiceupBetaReleaseHistory.from, '1.2.1');
  assert.equal(context.voiceupBetaReleaseHistory.version, '1.2.2-beta.27');
  assert.ok(Object.isFrozen(context.voiceupBetaReleaseHistory.locales['pt-BR'].notes));
});

test('Android CommonJS browser wrapper still exposes the catalog', () => {
  const context = vm.createContext({ module: { exports: {} }, window: {} });
  vm.runInContext(read('public/release-history.js'), context);
  assert.equal(context.voiceupReleaseHistory.version, '1.2.2');
  assert.equal(context.module.exports, context.voiceupReleaseHistory);
  assert.equal(context.voiceupBetaReleaseHistory.version, '1.2.2-beta.27');
});

test('Desktop beta opts into beta notes without replacing the stable catalog', () => {
  const client = read('public/release-notes.js');
  const host = read('host/renderer.js');
  assert.match(client, /voiceupBetaReleaseHistory\?\.version === installedVersion/);
  assert.match(host, /voiceupBetaReleaseHistory\?\.version === version/);
  assert.match(client, /: window\.voiceupReleaseHistory/);
  assert.match(host, /: window\.voiceupReleaseHistory/);
});

test('Desktop, ServerHost and SelfWeb use the shared stable catalog; Android beta keeps scoped notes', () => {
  const index = read('public/index.html');
  assert.ok(index.indexOf('src="release-history.js"') < index.indexOf('src="release-notes.js"'));
  assert.match(read('public/release-notes.js'), /releaseHistory\.locales/);
  assert.match(read('host/index.html'), /src="\.\.\/public\/release-history.js"/);
  assert.match(read('host/renderer.js'), /releaseHistory\.locales/);
  assert.match(read('mobile/src/App.jsx'), /const MOBILE_RELEASE_NOTES = \[/);
  assert.match(read('selfweb/browser.js'), /voiceupReleaseHistory\.locales/);
});
