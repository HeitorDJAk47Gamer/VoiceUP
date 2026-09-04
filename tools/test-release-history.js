'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const history = require('../public/release-history');
const read = path => fs.readFileSync(require('node:path').join(__dirname, '..', path), 'utf8');

test('stable release notes cover 1.1.2 -> 1.2.0 in every language', () => {
  assert.equal(history.from, '1.1.2'); assert.equal(history.version, '1.2.0');
  for (const [language, copy] of Object.entries(history.locales)) {
    assert.match(copy.title, /1\.2\.0/); assert.match(copy.subtitle, /1\.1\.2.*1\.2\.0/);
    assert.equal(copy.notes.length, 17, language);
    for (const token of ['Linux', 'Android', 'SelfWeb', 'ServerHost', 'Cloud', 'RNNoise', 'SHA-256']) assert.ok(copy.notes.some(note => note.includes(token)), `${language}: ${token}`);
    assert.ok(!copy.notes.some(note => /SQLite|GIFs|v1\.1\.1|Authenticode/.test(note)), 'Old features must not be relisted as new.');
  }
  assert.doesNotMatch(history.locales['es-ES'].subtitle, /versão|reúne/);
});

test('browser catalog works without Node and is immutable', () => {
  const context = vm.createContext({}); vm.runInContext(read('public/release-history.js'), context);
  assert.equal(context.voiceupReleaseHistory.version, history.version);
  assert.ok(Object.isFrozen(context.voiceupReleaseHistory.locales['pt-BR'].notes));
});

test('Android CommonJS browser wrapper still exposes the catalog', () => {
  const context = vm.createContext({ module: { exports: {} }, window: {} });
  vm.runInContext(read('public/release-history.js'), context);
  assert.equal(context.voiceupReleaseHistory.version, '1.2.0');
  assert.equal(context.module.exports, context.voiceupReleaseHistory);
});

test('Desktop, ServerHost, Android and SelfWeb use the same catalog', () => {
  const index = read('public/index.html');
  assert.ok(index.indexOf('src="release-history.js"') < index.indexOf('src="release-notes.js"'));
  assert.match(read('public/release-notes.js'), /voiceupReleaseHistory\.locales/);
  assert.match(read('host/index.html'), /src="\.\.\/public\/release-history.js"/);
  assert.match(read('host/renderer.js'), /voiceupReleaseHistory\.locales/);
  assert.match(read('mobile/src/App.jsx'), /import '\.\.\/\.\.\/public\/release-history.js'/);
  assert.match(read('selfweb/browser.js'), /voiceupReleaseHistory\.locales/);
});
