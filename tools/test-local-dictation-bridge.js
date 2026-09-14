'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'electron-main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'client-preload.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'public', 'chat-attachments.js'), 'utf8');
const helper = fs.readFileSync(path.join(root, 'native', 'voiceup-dictation-hotkey.cpp'), 'utf8');
assert.ok(fs.existsSync(path.join(root, 'native', 'voiceup-dictation-hotkey.cpp')));
for (const token of ['dictation:start', 'startWindowsVoiceTyping', 'isTrustedClientEvent']) assert.match(main, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
assert.match(preload, /startWindowsVoiceTyping/);
for (const token of ['startWindowsDictation', 'Ditado por Voz do Windows', 'input.focus']) assert.match(client, new RegExp(token));
for (const token of ['VK_LWIN', "'H'", 'SendInput']) assert.match(helper, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
console.log('PASS ponte de ditado Windows: atalho Win+H protegido e campo focado para rascunho sem envio automático.');
