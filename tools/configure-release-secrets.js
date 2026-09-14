'use strict';
const {spawnSync}=require('node:child_process');
const {json}=require('./github-api');
(async()=>{
 const base='/repos/HeitorDJAk47Gamer/VoiceUP/actions/secrets';
 const key=await json(base+'/public-key');
 const values={VOICEUP_RELEASE_PRIVATE_KEY:process.env.VOICEUP_RELEASE_PRIVATE_KEY,VOICEUP_ANDROID_KEYSTORE:process.env.VOICEUP_ANDROID_KEYSTORE_BASE64,VOICEUP_ANDROID_STORE_PASSWORD:'android',VOICEUP_ANDROID_KEY_PASSWORD:'android',VOICEUP_ANDROID_KEY_ALIAS:'androiddebugkey'};
 for(const [name,value]of Object.entries(values)){
  if(!value)throw new Error(`Segredo local ausente: ${name}`);
  const encrypted=spawnSync('python',['-c','import sys,json,base64; from nacl.public import PublicKey,SealedBox; d=json.load(sys.stdin); print(base64.b64encode(SealedBox(PublicKey(base64.b64decode(d["key"]))).encrypt(d["value"].encode())).decode())'],{input:JSON.stringify({key:key.key,value}),encoding:'utf8',windowsHide:true});
  if(encrypted.status!==0)throw new Error('Criptografia dos segredos falhou.');
  await json(base+'/'+name,'PUT',{key_id:key.key_id,encrypted_value:encrypted.stdout.trim()});
  console.log(`Configurado no GitHub: ${name} (conteúdo não exibido).`);
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
