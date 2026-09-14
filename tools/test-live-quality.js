const assert = require('node:assert/strict');
const { createState, sample } = require('../public/live-quality');
function fixture() {
  const state = createState();
  let timestamp = 0, framesEncoded = 0, totalEncodeTime = 0, cpu = 0, bandwidth = 0;
  const tick = (reason = 'none', frames = 180) => {
    timestamp += 3000; framesEncoded += frames; totalEncodeTime += frames * .003;
    if (reason === 'cpu') cpu += 3;
    if (reason === 'bandwidth') bandwidth += 3;
    return sample(state, { id: 'video', timestamp, framesEncoded, totalEncodeTime, qualityLimitationReason: reason, qualityLimitationDurations: { cpu, bandwidth } }, 60);
  };
  tick(); return { state, tick };
}
for (const reason of ['cpu', 'bandwidth']) {
  const { state, tick } = fixture();
  assert.equal(tick(reason), null);
  assert.equal(tick(), null); // One spike cannot change the sender.
  assert.equal(tick(reason), null);
  assert.equal(tick(reason), null);
  assert.equal(tick(reason), 45);
  for (let i = 0; i < 14; i++) assert.equal(tick(), null);
  assert.equal(tick(), 52); // Slow recovery, never an immediate jump to 60.
  assert.equal(state.fps, 52);
}
const idle = fixture();
for (let i = 0; i < 30; i++) assert.equal(idle.tick('cpu', 0), null);
const floor = fixture();
for (let i = 0; i < 90; i++) floor.tick('bandwidth');
assert.equal(floor.state.fps, 15);
const reset = fixture();
reset.tick('cpu'); reset.tick('cpu');
assert.equal(sample(reset.state, { id: 'replacement', timestamp: 50000, framesEncoded: 1 }, 60), null);
assert.equal(reset.state.bad, 0);
console.log('Live quality: transient pressure, sustained CPU/network pressure, gradual recovery, idle source, floor and counter reset passed.');
