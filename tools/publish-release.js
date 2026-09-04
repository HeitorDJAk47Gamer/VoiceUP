'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {request,json}=require('./github-api');
const {verifyDirectory}=require('./release-artifacts');
const integrity=require('../public/release-integrity');
const {assetFor}=require('../update-helper');
const repo='/repos/HeitorDJAk47Gamer/VoiceUP';
const required=version=>[
 `VoiceUP.Setup.${version}.exe`,`VoiceUPServer.Setup.${version}.exe`,`VoiceUP.${version}.appx`,
 `VoiceUP-${version}-linux-x64.AppImage`,`VoiceUP-${version}-linux-x64.deb`,
 `VoiceUPServer-${version}-linux-x64.AppImage`,`VoiceUPServer-${version}-linux-x64.deb`,
 `VoiceUP-${version}-android.apk`,'VoiceUP-SelfWeb.html',`VoiceUP-Server-Cloud-${version}.zip`
];
async function main() {
 const [version,folder,...flags]=process.argv.slice(2);
 if(!/^\d+\.\d+\.\d+$/.test(version))throw new Error('Use uma versão estável X.Y.Z.');
 const envelopeName=`VoiceUP-Release-${version}.json`;
 const envelope=JSON.parse(fs.readFileSync(path.join(folder,envelopeName),'utf8'));
 const payload=verifyDirectory(folder,envelope);
 if(payload.version!==version)throw new Error('Versão divergente.');
 for(const name of required(version))if(!payload.artifacts.some(file=>file.name===name))throw new Error(`Release incompleta: ${name}`);
 const lookup=await request(`${repo}/releases/tags/v${version}`,{allowFailure:true});
 let release;
 if(lookup.status===404)release=await json(`${repo}/releases`,'POST',{tag_name:`v${version}`,target_commitish:process.env.GITHUB_SHA||'main',name:`VoiceUP ${version}`,body:fs.readFileSync(path.join(__dirname,`../RELEASE-NOTES-${version}.md`),'utf8'),draft:true,prerelease:false});
 else if(lookup.ok)release=await lookup.json();else throw new Error(`Consulta da release falhou (${lookup.status}).`);
 if(!release.draft){
   const publishedManifest=release.assets.find(asset=>asset.name===envelopeName);
   if(publishedManifest?.browser_download_url!==integrity.assetUrl(version,envelopeName))throw new Error('Release pública sem manifesto oficial. Não sobrescreva.');
   const response=await fetch(publishedManifest.browser_download_url,{signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw new Error('Não foi possível revalidar a release já publicada.');
   const published=integrity.verifySync(await response.json(),version);
   for(const name of required(version)){const entry=published.artifacts.find(file=>file.name===name);const asset=release.assets.find(file=>file.name===name);if(!entry||!asset||asset.digest!==`sha256:${entry.sha256}`||asset.size!==entry.size||asset.browser_download_url!==entry.url)throw new Error(`Release pública incompleta ou alterada: ${name}`);}
   console.log('A versão já está pública e verificada. Nenhum arquivo foi substituído.');return;
 }
 const files=[...payload.artifacts.map(file=>file.name),envelopeName,`VoiceUP-SHA256SUMS-${version}.txt`];
 for(const name of files){
   const bytes=fs.readFileSync(path.join(folder,name));
   const digest='sha256:'+require('node:crypto').createHash('sha256').update(bytes).digest('hex');
   const existing=release.assets.find(asset=>asset.name===name);
   if(existing){if(existing.size!==bytes.length || existing.digest!==digest)throw new Error(`Arquivo diferente já anexado: ${name}`);continue;}
   const asset=await (await request(`${release.upload_url.split('{')[0]}?name=${encodeURIComponent(name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:bytes,signal:AbortSignal.timeout(600000)})).json();
   if(asset.digest!==digest || asset.size!==bytes.length)throw new Error(`Hash publicado incorreto: ${name}`);
   console.log(`Verificado no GitHub: ${name}`);
 }
 release=await json(`${repo}/releases/${release.id}`);
 for(const entry of payload.artifacts){const asset=release.assets.find(asset=>asset.name===entry.name);if(!asset||asset.digest!==`sha256:${entry.sha256}`||asset.browser_download_url!==entry.url||asset.size!==entry.size)throw new Error(`Metadados divergentes: ${entry.name}`);}
 for(const prefix of ['VoiceUP Setup ','VoiceUPServer Setup ']){const asset=assetFor(prefix,version,release.assets,{platform:'win32',arch:'x64'});if(!asset.published||!asset.digest)throw new Error('Compatibilidade do atualizador não validada.');}
 if(flags.includes('--publish')) {await json(`${repo}/releases/${release.id}`,'PATCH',{draft:false,prerelease:false,make_latest:'true'});console.log(`Publicada: https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/tag/v${version}`);}
 else console.log('Todos os arquivos verificados. Release mantida em rascunho.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
