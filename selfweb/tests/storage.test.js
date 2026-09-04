'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../bootstrap.js'),'utf8');
function initialize(denied=false) {
  const disk=new Map([['voiceup-profile-v1','desktop-profile']]);
  const backing={getItem:(key)=>disk.get(key)??null,setItem:(key,v)=>disk.set(key,v),removeItem:(key)=>disk.delete(key)};
  const window={io:()=>{},crypto:{subtle:{}},isSecureContext:true};
  Object.defineProperty(window,'localStorage',{get(){if(denied)throw new Error('blocked');return backing;}});
  Object.defineProperty(window,'sessionStorage',{get(){if(denied)throw new Error('blocked');return backing;}});
  const context={window,navigator:{mediaDevices:{}},RTCPeerConnection:function(){},HTMLMediaElement:function(){}};
  vm.runInNewContext(script,context);
  return {api:window.voiceupSelfWebStorage,disk,backing};
}
test('perfil do SelfWeb é isolado do perfil Desktop',()=>{
  const {api,disk}=initialize();
  assert.equal(api.local.getItem('voiceup-profile-v1'),null);
  api.local.setItem('voiceup-profile-v1','web-profile');
  assert.equal(disk.get('voiceup-profile-v1'),'desktop-profile');
  assert.equal(disk.get('voiceup-selfweb-v1:voiceup-profile-v1'),'web-profile');
  api.local.removeItem('voiceup-profile-v1');
  assert.equal(api.local.getItem('voiceup-profile-v1'),null);
  assert.equal(disk.get('voiceup-profile-v1'),'desktop-profile');
});
test('armazenamento bloqueado não impede abertura nem preserva falsa promessa de persistência',()=>{
  const {api}=initialize(true);
  assert.equal(api.local.persistent,false);
  api.local.setItem('profile','temporary');
  assert.equal(api.local.getItem('profile'),'temporary');
  api.local.removeItem('profile');
  assert.equal(api.local.getItem('profile'),null);
});
test('falha por quota mantém o valor mais recente durante a sessão',()=>{
  const {api,backing}=initialize();
  api.local.setItem('profile','old');
  backing.setItem=()=>{throw new Error('quota');};
  api.local.setItem('profile','new');
  assert.equal(api.local.getItem('profile'),'new');
  assert.equal(api.local.persistent,false);
});
