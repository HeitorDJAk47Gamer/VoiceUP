'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const version=require('../package.json').version;
const [target,output='release-assets']=process.argv.slice(2);
fs.mkdirSync(output,{recursive:true});
function copy(source,name){if(!fs.existsSync(source))throw new Error(`Artefato ausente: ${source}`);fs.copyFileSync(source,path.join(output,name));}
if(target==='windows'){
 copy(`release/VoiceUP Setup ${version}.exe`,`VoiceUP.Setup.${version}.exe`);
 copy(`release-server/VoiceUPServer Setup ${version}.exe`,`VoiceUPServer.Setup.${version}.exe`);
 copy(`.store-build/VoiceUP ${version}.appx`,`VoiceUP.${version}.appx`);
 copy('selfweb/dist/VoiceUP-SelfWeb.html','VoiceUP-SelfWeb.html');
}else if(target==='linux'){
 for(const [dir,product] of [['release-linux','VoiceUP'],['release-linux-server','VoiceUPServer']])for(const ext of ['AppImage','deb'])copy(`${dir}/${product}-${version}-linux-x64.${ext}`,`${product}-${version}-linux-x64.${ext}`);
}else if(target==='android')copy('mobile/android/app/build/outputs/apk/release/app-release.apk',`VoiceUP-${version}-android.apk`);
else if(target==='checksums'){
 const manifest=JSON.parse(fs.readFileSync(path.join(output,`VoiceUP-Release-${version}.json`)));
 const payload=require('../public/release-integrity').verifySync(manifest,version);
 fs.writeFileSync(path.join(output,`VoiceUP-SHA256SUMS-${version}.txt`),payload.artifacts.map(file=>`${file.sha256}  ${file.name}`).join('\n')+'\n');
}else throw new Error('Escolha windows, linux, android ou checksums.');
console.log(`Artefatos ${target} preparados: ${output}`);
