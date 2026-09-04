'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const file=path.join(__dirname,'dist','VoiceUP-SelfWeb.html');
const server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
  if(!/^\/(?:VoiceUP-SelfWeb\.html)?(?:\?.*)?$/.test(req.url)) {res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
  if(req.method==='HEAD') res.end(); else fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log(`VoiceUP SelfWeb local: http://127.0.0.1:${server.address().port}/`));
