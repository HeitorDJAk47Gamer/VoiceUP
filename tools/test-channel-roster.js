const assert = require('node:assert/strict');
const { sortMembers, formatDuration, createActivityClock } = require('../public/channel-roster');

const members = [
  { id: 'z', name: 'Zoe', voiceChannel: 'Geral' },
  { id: 'a2', name: 'álvaro', voiceChannel: 'Geral' },
  { id: 'b10', name: 'Bot 10', voiceChannel: 'Jogando' },
  { id: 'a1', name: 'Álvaro', voiceChannel: 'Geral' },
  { id: 'b2', name: 'bot 2', voiceChannel: 'Jogando' }
];
assert.deepEqual(sortMembers(members).map((member) => member.id), ['a1', 'a2', 'b2', 'b10', 'z']);
assert.equal(members[0].id, 'z', 'Sorting must not mutate the shared presence list.');
for (const [milliseconds, expected] of [[-1, '00:00'], [0, '00:00'], [59000, '00:59'], [60000, '01:00'], [3599000, '59:59'], [3600000, '1:00:00'], [4549000, '1:15:49'], [360000000, '100:00:00']]) {
  assert.equal(formatDuration(milliseconds), expected);
}
const clock = createActivityClock();
clock.setScope('host-a');
clock.sync(members, {}, 10000);
assert.equal(clock.get('Geral', 12000).elapsed, 2000);
assert.equal(clock.get('Geral', 12000).authoritative, false);
clock.sync(members.slice(1), {}, 13000);
assert.equal(clock.get('Geral', 14000).elapsed, 4000, 'First member leaving must not reset an occupied call.');
clock.sync(members, { serverTime: 300000, voiceActivity: [{ voiceChannel: 'Geral', startedAt: 100000 }] }, 15000);
assert.equal(clock.get('Geral', 16000).elapsed, 201000, 'Host/client wall-clock offsets must not affect elapsed time.');
assert.equal(clock.get('Geral', 16000).authoritative, true);
assert.equal(clock.get('Jogando', 16000).elapsed, 6000, 'Channels have independent clocks.');
clock.sync(members, {}, 20000);
assert.equal(clock.get('Geral', 20000).elapsed, 205000, 'Rendering or legacy packets must not reset a known clock.');
clock.sync(members.filter((member) => member.voiceChannel !== 'Geral'), {}, 21000);
assert.equal(clock.get('Geral'), null);
clock.sync(members, {}, 25000);
assert.equal(clock.get('Geral', 26000).elapsed, 1000, 'An emptied channel must start a new call.');
clock.sync([{ voiceChannel: '' }, { voiceChannel: '__lobby__' }], {}, 27000);
assert.equal(clock.get(''), null);
assert.equal(clock.get('__lobby__'), null);
clock.sync(members, {}, 28000);
clock.setScope('host-b');
assert.equal(clock.get('Geral'), null, 'Changing servers must not reuse another room\'s duration.');
console.log('PASS channel roster: alphabetical order, duration, independent channels, empty reset, legacy fallback and clock offset.');
