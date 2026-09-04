'use strict';
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const os=require('node:os');
const electron=require('../node_modules/electron');
const env={...process.env};
delete env.ELECTRON_RUN_AS_NODE;
const testDirectory=fs.mkdtempSync(path.join(os.tmpdir(),'voiceup-selfweb-test-'));
env.VOICEUP_SELFWEB_TEST_DATA=testDirectory;
const child=spawn(electron,[path.join(__dirname,'runtime-test.js')],{env,stdio:'inherit',windowsHide:true});
child.on('error',(error)=>{console.error(error);process.exitCode=1;});
child.on('exit',(code)=>{
  process.exitCode=code??1;
  const resolved=path.resolve(testDirectory);
  if(path.dirname(resolved)===path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('voiceup-selfweb-test-')) {
    try {fs.rmSync(resolved,{recursive:true,force:true,maxRetries:4,retryDelay:200});}
    catch {console.warn('Dados simulados do teste mantidos na pasta temporária; não afetam o perfil do usuário.');}
  }
});
