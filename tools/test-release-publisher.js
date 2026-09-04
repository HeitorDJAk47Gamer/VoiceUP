'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyUploadedArtifacts}=require('./publish-release');
const {assetUrl}=require('../public/release-integrity');
const name='VoiceUP.Setup.1.2.0.exe';
const entry={name,size:2000000,sha256:'a'.repeat(64),url:assetUrl('1.2.0',name)};
const payload={version:'1.2.0',artifacts:[entry]};
const fixture=(draft,url)=>({tag_name:'v1.2.0',draft,assets:[{name,size:entry.size,digest:`sha256:${entry.sha256}`,state:'uploaded',browser_download_url:url}]});
const temporary=`https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/download/untagged-abc123/${name}`;
test('temporary GitHub URLs are accepted only for a fully uploaded draft',()=>{
 assert.doesNotThrow(()=>verifyUploadedArtifacts(fixture(true,temporary),payload));
 assert.throws(()=>verifyUploadedArtifacts(fixture(false,temporary),payload));
 assert.doesNotThrow(()=>verifyUploadedArtifacts(fixture(false,entry.url),payload));
});
test('wrong repository, tag, bytes, filename and unsigned redirect destinations fail closed',()=>{
 for(const url of [temporary.replace('/VoiceUP/','/Other/'),temporary.replace('github.com','evil.example'),temporary+'?url=evil',temporary.replace(name,'Other.exe'),'http:'+temporary.slice(6)])assert.throws(()=>verifyUploadedArtifacts(fixture(true,url),payload));
 const wrongTag=fixture(true,temporary);wrongTag.tag_name='v1.1.2';assert.throws(()=>verifyUploadedArtifacts(wrongTag,payload));
 for(const [key,value] of [['size',1],['digest','sha256:'+'b'.repeat(64)],['state','starter']]){const changed=fixture(true,temporary);changed.assets[0][key]=value;assert.throws(()=>verifyUploadedArtifacts(changed,payload));}
});
