const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const platform = require('../public/platform-presence');
const root = path.resolve(__dirname, '..');

test('legacy P2P introductions cannot reset server-known idle/DND or platform', async () => {
  const vm = require('node:vm');
  const serverMembers = new Map([['remote',{id:'remote',platform:'windows',status:'dnd'}]]);
  const context = vm.createContext({
    voiceupPlatform: platform, serverMembers, peer: null, currentMode: 'hosted',
    receiveData: async () => {}, receiveHostedData: async (peer) => { peer.status = 'online'; },
    rememberHostedMember: (member) => serverMembers.set(member.id,member),
    renderRoomChannels: () => {}, renderCentralCallMembers: () => {},
    window: {addEventListener:()=>{}}, document: {querySelectorAll:()=>[]}
  });
  vm.runInContext(fs.readFileSync(path.join(root,'public/platform-status.js'),'utf8'),context);
  const participant = {id:'remote',name:'Legacy'};
  await context.receiveHostedData(participant,JSON.stringify({type:'intro',name:'Legacy'}));
  assert.equal(participant.status,'dnd');
  assert.equal(participant.platform,'windows');
  assert.equal(serverMembers.get('remote').status,'dnd');
});

test('EXE and Store use Windows; Linux uses native process.platform', () => {
  assert.equal(platform.local({voiceupDesktop:{platform:'win32'}}), 'windows');
  assert.equal(platform.local({voiceupDesktop:{platform:'linux'}}), 'linux');
  assert.equal(platform.local({voiceupDesktop:{platform:'darwin'}}), '');
});
test('SelfWeb never impersonates its underlying operating system', () => {
  assert.equal(platform.local({voiceupSelfWebBuild:{},voiceupDesktop:{platform:'win32'}}), 'selfweb');
  assert.equal(platform.local({navigator:{userAgent:'Android Linux Windows'}}), 'selfweb');
  assert.equal(platform.local({Capacitor:{getPlatform:()=> 'android'}}), 'android');
});
test('all platforms use identical presence colors and accessible labels', () => {
  for (const kind of ['windows','linux','android','selfweb']) {
    for (const status of ['online','idle','dnd']) {
      const badge = platform.badge(kind,status);
      assert.ok(badge.includes(`status-${status}`));
      assert.ok(badge.includes(`data-platform="${kind}"`));
      assert.ok(badge.includes('role="img"'));
      assert.equal((badge.match(/<svg/g)||[]).length, 1);
      assert.ok(!badge.includes('undefined'));
    }
  }
  assert.match(platform.svg('linux'), /<path d="M12/);
});
test('legacy and malicious metadata retain a safe neutral fallback', () => {
  for (const value of [null,undefined,{},[],123,'Windows','__proto__','constructor','<img src=x onerror=alert(1)>']) {
    assert.equal(platform.normalize(value), '');
    assert.match(platform.badge(value,'broken'), /data-platform="unknown"/);
    assert.ok(!platform.badge(value,'broken').includes('onerror'));
  }
  assert.equal(platform.merge(undefined,'android'),'android');
  assert.equal(platform.merge('','linux'),'linux');
  assert.equal(platform.merge('selfweb','windows'),'selfweb');
  assert.match(platform.badge('windows','online','<unsafe>'), /&lt;unsafe&gt;/);
});
test('every edition packages the same icons without external icon downloads', () => {
  const client = fs.readFileSync(path.join(root,'public/index.html'),'utf8');
  assert.ok(client.indexOf('src="platform-presence.js"') < client.indexOf('src="app.js"'));
  assert.ok(client.indexOf('src="platform-status.js"') > client.indexOf('src="beta-ui.js"'));
  const host = fs.readFileSync(path.join(root,'host/index.html'),'utf8');
  assert.ok(host.indexOf('src="../public/platform-presence.js"') < host.indexOf('src="./renderer.js"'));
  const mobile = fs.readFileSync(path.join(root,'mobile/src/App.jsx'),'utf8');
  assert.match(mobile, /platform: CLIENT_PLATFORM/);
  assert.match(mobile, /Capacitor.getPlatform\(\) === 'android'/);
});
