'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const chat = require('../public/chat-rich-content');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('mensagens de até 500 caracteres continuam no protocolo antigo', () => {
  const content = 'a'.repeat(500);
  assert.deepEqual(chat.createOutgoingMessage(content), { text: content, textFile: null });
});

test('mensagem acima de 500 caracteres vira um TXT íntegro', () => {
  const content = `Título\n${Array(45).fill('linha de teste').join(' ')}`;
  const outgoing = chat.createOutgoingMessage(content);
  assert.equal(outgoing.text, 'Arquivo de texto: mensagem.txt');
  assert.equal(outgoing.textFile.name, 'mensagem.txt');
  assert.equal(outgoing.textFile.content, content);
  assert.equal(outgoing.textFile.type, 'text/plain');
  assert.equal(outgoing.textFile.size, Buffer.byteLength(content, 'utf8'));
});

test('limites por caractere e por byte protegem Client e servidor', () => {
  assert.throws(() => chat.createOutgoingMessage('a'.repeat(chat.TEXT_FILE_MAX_CHARACTERS + 1)), /30\.000|64 KB/);
  assert.throws(() => chat.createOutgoingMessage('😀'.repeat(17000)), /30\.000|64 KB/);
  assert.equal(chat.normalizeTextFile({ name: 'grande.txt', content: '😀'.repeat(17000) }), null);
});

test('nome recebido é reduzido a TXT sem aceitar caminhos', () => {
  const normalized = chat.normalizeTextFile({ name: '../../segredo.exe', content: 'conteúdo' });
  assert.equal(normalized.name, 'segredo.exe.txt');
  assert.equal(normalized.size, Buffer.byteLength('conteúdo'));
});

test('três crases reconhecem a linguagem e preservam texto ao redor', () => {
  const source = 'Antes\n```py\nprint("hello")\n```\nDepois';
  assert.deepEqual(chat.parseFencedCode(source), [
    { type: 'text', value: 'Antes\n' },
    { type: 'code', value: 'print("hello")', language: 'python' },
    { type: 'text', value: '\nDepois' }
  ]);
});

test('código e anexos são escapados e nunca inserem HTML executável', () => {
  const code = chat.renderCodeBlock({ language: 'js', value: 'const value = "</code><script>alert(1)</script>";' });
  assert.match(code, /JavaScript/);
  assert.match(code, /code-token keyword/);
  assert.doesNotMatch(code, /<script>/);
  assert.match(code, /&lt;\/code&gt;&lt;script&gt;/);
  const file = chat.renderTextFileAttachment({ name: 'x.txt', content: '</code><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(file, /<img/);
  assert.match(file, /&lt;\/code&gt;&lt;img/);
  assert.match(file, /data-text-file-download/);
  assert.match(file, /data-text-file-toggle/);
});

test('a página carrega o módulo antes do app e usa compositor multilinha', () => {
  const html = read('public/index.html');
  assert.ok(html.indexOf('src="chat-rich-content.js"') < html.indexOf('src="app.js"'));
  assert.match(html, /<textarea id="message-input"[^>]+maxlength="30000"/);
  assert.match(html, /href="chat-rich-content\.css"/);
  const app = read('public/app.js');
  assert.match(app, /parseFencedCode/);
  assert.match(app, /new Blob\(\[content\], \{ type: 'text\/plain;charset=utf-8' \}\)/);
  assert.match(app, /event\.key === 'Enter' && !event\.shiftKey/);
});

test('ServerHost e Cloud validam e preservam o campo opcional', () => {
  for (const file of ['signaling-server.js', 'deploy/shardcloud/index.js']) {
    const source = read(file);
    assert.match(source, /TEXT_FILE_MAX_BYTES = 64 \* 1024/);
    assert.match(source, /Arquivo de texto inválido ou maior que 64 KB/);
    assert.match(source, /textFile: normalizedTextFile/);
  }
});
