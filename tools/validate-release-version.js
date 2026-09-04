'use strict';
const assert=require('node:assert/strict');
const version=require('../package.json').version;
assert.match(version,/^\d+\.\d+\.\d+$/);
for(const file of ['../mobile/package.json','../selfweb/package.json','../deploy/shardcloud/package.json'])assert.equal(require(file).version,version,file);
if(process.env.GITHUB_REF_TYPE==='tag')assert.equal(process.env.GITHUB_REF_NAME,`v${version}`);
assert.equal(require('../public/release-history').version,version);
console.log(`Versão estável ${version} consistente em todas as edições.`);
