'use strict';
const {spawnSync} = require('node:child_process');
function headers() {
  let token=process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if(!token) {
    const result=spawnSync('git',['credential','fill'],{input:'protocol=https\nhost=github.com\npath=HeitorDJAk47Gamer/VoiceUP.git\n\n',encoding:'utf8',windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}});
    token=(result.stdout||'').split('\n').find(line=>line.startsWith('password='))?.slice(9).trim();
  }
  if(!token)throw new Error('Login GitHub indisponível. Nenhuma credencial foi impressa.');
  return {Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','User-Agent':'VoiceUP-Release','X-GitHub-Api-Version':'2022-11-28'};
}
let cached;
async function request(endpoint, options={}) {
  cached ||= headers();
  const url=new URL(endpoint.startsWith('https:')?endpoint:`https://api.github.com${endpoint}`);
  if(!['api.github.com','uploads.github.com'].includes(url.hostname))throw new Error('Destino GitHub não permitido.');
  const response=await fetch(url,{...options,headers:{...cached,...options.headers},signal:options.signal||AbortSignal.timeout(180000)});
  if(!response.ok && !options.allowFailure)throw new Error(`GitHub HTTP ${response.status} em ${url.pathname}`);
  return response;
}
async function json(endpoint, method='GET', body) {
  const response=await request(endpoint,{method,...(body===undefined?{}:{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}})});
  return response.status===204?null:response.json();
}
module.exports={request,json};
