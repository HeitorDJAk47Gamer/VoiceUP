import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampVolume,
  embedForText,
  formatCallDuration,
  isMessageMention,
  isOwnMessage,
  membersForVoiceChannel,
  mentionIdsForText,
  pingQuality,
  tokenizeInline
} from '../src/chat-utils.js';

test('detecta menções sem confundir nomes parciais', () => {
  const members = [{ id: '1', name: 'Ana' }, { id: '2', name: 'Anabela' }, { id: '3', name: 'João Silva' }];
  assert.deepEqual(mentionIdsForText('Oi @Ana e @João Silva!', members), ['1', '3']);
  assert.deepEqual(mentionIdsForText('email@Ana.com e @Anabela2', members), []);
});

test('reconhece autoria e menção persistentes', () => {
  assert.equal(isOwnMessage({ from: 'socket-1' }, 'socket-1', 'client-1'), true);
  assert.equal(isOwnMessage({ authorClientId: 'client-1' }, 'socket-2', 'client-1'), true);
  assert.equal(isMessageMention({ mentionClientIds: ['client-1'] }, 'socket-2', 'client-1'), true);
});

test('formata links sem aceitar protocolos executáveis', () => {
  const tokens = tokenizeInline('Veja **agora** https://voiceup.example/test.');
  assert.equal(tokens.some((token) => token.type === 'strong' && token.value === 'agora'), true);
  assert.equal(tokens.some((token) => token.type === 'link' && token.url.startsWith('https://')), true);
  assert.equal(tokenizeInline('javascript:alert(1)').some((token) => token.type === 'link'), false);
});

test('gera embeds somente para mídia reconhecida', () => {
  assert.equal(embedForText('https://cdn.example/foto.webp')?.type, 'image');
  assert.equal(embedForText('https://cdn.example/foto.png/revision/latest')?.type, 'image');
  assert.equal(embedForText('https://youtu.be/dQw4w9WgXcQ')?.type, 'youtube');
  assert.equal(embedForText('https://example.com/pagina'), null);
});

test('organiza os membros do canal e resume a qualidade da conexão', () => {
  const members = [
    { name: 'Zeca', voiceChannel: 'Geral' },
    { name: 'ana', voiceChannel: 'Geral' },
    { name: 'Bia', voiceChannel: 'Jogos' }
  ];
  assert.deepEqual(membersForVoiceChannel(members, 'Geral').map((member) => member.name), ['ana', 'Zeca']);
  assert.equal(pingQuality(45), 'good');
  assert.equal(pingQuality(120), 'medium');
  assert.equal(pingQuality(300), 'poor');
});

test('formata a duração contínua da chamada', () => {
  assert.equal(formatCallDuration(1_000, 66_000), '1:05');
  assert.equal(formatCallDuration(1_000, 3_662_000), '1:01:01');
  assert.equal(formatCallDuration(0, 10_000), '');
});

test('limita volumes ao intervalo do elemento de áudio', () => {
  assert.equal(clampVolume(2), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('0.35'), 0.35);
});
