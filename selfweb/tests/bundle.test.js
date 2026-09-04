'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(__dirname,'../dist/VoiceUP-SelfWeb.html'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../dist/manifest.json'),'utf8'));
const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex');
test('HTML único, sem scripts, CSS, fontes ou ícones externos para iniciar',()=>{
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html,/<link\b[^>]*\brel="stylesheet"/i);
  assert.doesNotMatch(html,/socket-loader\.js|sourceMappingURL=/);
  assert.doesNotMatch(html,/<(?:script|link)\b[^>]*(?:src|href)="(?:https?:|\.\.\/)/i);
  assert.match(html,/<title>VoiceUP SelfWeb<\/title>/);
  assert.ok(Buffer.byteLength(html)<2*1024*1024,'A edição excedeu 2 MB sem justificativa.');
});
test('CSP autoriza somente os scripts empacotados por hash, sem eval',()=>{
  const csp=html.match(/Content-Security-Policy" content="([^"]+)/)[1];
  const scriptPolicy=csp.match(/script-src ([^;]+)/)[1];
  assert.doesNotMatch(scriptPolicy,/unsafe-inline|unsafe-eval|https:|http:|\*/);
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length>=10);
  for(const [index,match] of scripts.entries()) {
    new vm.Script(match[1],{filename:`bundle-${index}.js`});
    const hash=crypto.createHash('sha256').update(match[1]).digest('base64');
    assert.ok(scriptPolicy.includes(`'sha256-${hash}'`));
  }
  assert.match(csp,/object-src 'none'/);
  assert.match(csp,/base-uri 'none'/);
  assert.match(csp,/form-action 'none'/);
});
test('manifesto confere e as fontes compartilhadas não foram alteradas pelo empacotamento',()=>{
  assert.equal(manifest.sha256,hash(html));
  assert.equal(manifest.bytes,Buffer.byteLength(html));
  assert.equal(manifest.sourceVersion,require('../../package.json').version);
  for(const [file,expected] of Object.entries(manifest.inputs)) assert.equal(hash(fs.readFileSync(path.join(root,file))),expected,file);
});
test('código gerado mantém o protocolo e não depende de preload nativo',()=>{
  assert.match(html,/voiceup-identity-v1/);
  assert.match(html,/identity-proof-v1/);
  assert.match(html,/manual-voice-channel/);
  assert.match(html,/screen-audio-on/);
  assert.match(html,/signal-offer/);
  assert.doesNotMatch(html,/contextBridge|require\(['"]electron['"]\)/);
  assert.doesNotMatch(html,/\blocalStorage\.(?:getItem|setItem|removeItem)/);
  assert.doesNotMatch(html,/\bsessionStorage\.(?:getItem|setItem|removeItem)/);
});
