import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePresenceMember, platformPresence } from '../src/presence-utils.js';

test('presence snapshots preserve platform learned over P2P from older hosts', () => {
  assert.deepEqual(mergePresenceMember({id:'a',platform:'linux',status:'idle'},{id:'a',voiceChannel:'Geral'}), {id:'a',platform:'linux',status:'idle',voiceChannel:'Geral'});
  assert.equal(mergePresenceMember({platform:'android'},{platform:'',status:'dnd'}).platform,'android');
  assert.equal(mergePresenceMember({},{}).platform,'');
  assert.equal(mergePresenceMember({},{}).status,'online');
  assert.equal(mergePresenceMember({platform:'selfweb'},{platform:'__proto__'}).platform,'selfweb');
});
test('mobile uses the same Windows/Linux/Android/Web SVGs and status mapping', () => {
  for (const kind of ['windows','linux','android','selfweb']) assert.ok(platformPresence.svg(kind).includes('<svg'));
  assert.match(platformPresence.badge('android','dnd'), /Android · Não perturbe/);
});
