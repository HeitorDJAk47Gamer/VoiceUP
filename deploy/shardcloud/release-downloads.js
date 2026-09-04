'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const integrity=require('./release-integrity');
const folder=path.join(__dirname,'downloads');
const manifestPath=path.join(folder,'release-downloads.json');
function catalog(){
  const envelope=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  return {envelope,payload:integrity.verifySync(envelope,require('./package.json').version)};
}
const targets={client:['client','windows','x64'],server:['serverhost','windows','x64'],android:['client','android','universal'],selfweb:['selfweb','web','universal'],linux:['client','linux','x64'], 'linux-server':['serverhost','linux','x64']};
function entryFor(target){const tuple=targets[target];if(!tuple)throw new Error('Plataforma desconhecida.');return integrity.select(catalog().payload,...tuple);}
function download(target,response){
  try {
    const entry=entryFor(target);
    response.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff').set('X-VoiceUP-Version',catalog().payload.version).set('X-Checksum-SHA256',entry.sha256);
    if(target==='android'||target==='selfweb') {
      const file=path.join(folder,entry.name); const bytes=fs.readFileSync(file);
      if(bytes.length!==entry.size||crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw new Error('Arquivo local não corresponde ao manifesto assinado.');
      // Send the exact bytes just verified, avoiding a check/read replacement gap.
      response.attachment(entry.name);return response.send(bytes);
    }
    return response.redirect(302,entry.url);
  }catch{ return response.status(503).json({ok:false,message:'Este pacote ainda não está disponível com integridade verificada. Tente novamente mais tarde.'}); }
}
module.exports={catalog,entryFor,download};
