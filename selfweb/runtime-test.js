/* Functional runtime tests only: no UI screenshots, DOM inspection or clicks.
 * Hidden, sandboxed Chromium, with fake microphone/camera and no native bridge.
 * Calls the actual Client protocol functions and examines media/connection state.
 */
'use strict';
const {app,BrowserWindow,session}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const temp=process.env.VOICEUP_SELFWEB_TEST_DATA || fs.mkdtempSync(path.join(os.tmpdir(),'voiceup-selfweb-test-'));
app.setPath('userData',path.join(temp,'chromium'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
app.on('window-all-closed',()=>{});
const windows=[];
const errors=[];
const blocked=[];
const legacyRoot=process.env.VOICEUP_LEGACY_CLIENT_ROOT;
const legacyFontRequests=[];
let signaling;
let cloud;
const delay=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));
const run=(win,code)=>win.webContents.executeJavaScript(code);
const act=(win,code)=>run(win,`(async()=>{${code};return true;})()`);
async function until(win,expression,label,timeout=20000) {
  const start=Date.now();
  while(Date.now()-start<timeout) {if(await run(win,expression))return;await delay(150);}
  throw new Error(`Tempo esgotado: ${label}`);
}
async function makeClient(name,url,desktop=false) {
  const ses=session.fromPartition(`selfweb-test-${name}`);
  ses.setPermissionRequestHandler((_wc,permission,callback)=>callback(['media','fullscreen'].includes(permission)));
  ses.setPermissionCheckHandler((_wc,permission)=>['media','fullscreen'].includes(permission));
  ses.webRequest.onBeforeRequest((details,callback)=>{
    if(desktop && legacyRoot && /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(details.url)) {legacyFontRequests.push(details.url);callback({cancel:true});return;}
    if(/^https?:|^wss?:/.test(details.url) && !details.url.startsWith(url) && !details.url.startsWith(url.replace('http:','ws:'))) {blocked.push(details.url);callback({cancel:true});return;}
    callback({});
  });
  const win=new BrowserWindow({show:false,webPreferences:{session:ses,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false}});
  windows.push(win);
  win.webContents.setAudioMuted(true);
  win.webContents.on('console-message',(event)=>{if(event.level==='error' && !/Electron Security Warning|Autofill|DevTools/.test(event.message) && !(desktop && legacyRoot && /fonts\.(googleapis|gstatic)\.com/.test(event.sourceId || ''))) errors.push(`${name}: ${event.message}`);});
  const file=desktop?path.join(legacyRoot || root,'public/index.html'):path.join(__dirname,'dist/VoiceUP-SelfWeb.html');
  await win.loadFile(file);
  await delay(200);
  assert.deepEqual(await run(win,'window.voiceupDiagnostics'),[],`${name} inicialização`);
  const store=desktop?'localStorage':'window.voiceupSelfWebStorage.local';
  await run(win,`${store}.setItem('voiceup-profile-v1',${JSON.stringify(JSON.stringify({name,hostUrl:url,roomId:'selfweb-tests',noiseMode:'off',notifications:false}))});`);
  await win.loadFile(file);
  // No external STUN traffic in this local-only test.
  await run(win,`void(window.RTCPeerConnection=class extends RTCPeerConnection {constructor(config){super({...config,iceServers:[],iceCandidatePoolSize:0});}});`);
  assert.equal(await run(win,'Boolean(window.voiceupDesktop)'),false);
  assert.equal(await run(win,'Boolean(localStream || cameraStream || screenStream || hostedSocket)'),false,'Abrir não deve capturar ou conectar.');
  return win;
}
async function startLocalCloud() {
  const filename=path.join(root,'deploy/shardcloud/index.js');
  let source=fs.readFileSync(filename,'utf8');
  const boundary=source.lastIndexOf("server.listen(port, '0.0.0.0'");
  assert.ok(boundary>0,'Cloud startup marker changed');
  assert.ok(source.includes("directories: [path.join(__dirname, 'plugins')]"));
  source=source.slice(0,boundary).replace("directories: [path.join(__dirname, 'plugins')]",'directories: []');
  source+='\nmodule.exports={server,io,closeStores:()=>{chatStore.close();reportStore.close();}};';
  const overrides={VOICEUP_DATA_DIR:path.join(temp,'cloud'),PLUGIN_STATE_FILE:path.join(temp,'cloud','plugins.json'),VOICEUP_ROOM_PASSWORDS:'{}',VOICEUP_TRUSTED_PLUGIN_HASHES:'',VOICEUP_SERVER_ICON_URL:''};
  const old={};
  for(const [key,value] of Object.entries(overrides)){old[key]=process.env[key];process.env[key]=value;}
  try {
    const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
    mod._compile(source,filename);
    cloud=mod.exports;
    await new Promise((resolve,reject)=>{cloud.server.once('error',reject);cloud.server.listen(0,'127.0.0.1',resolve);});
    return `http://127.0.0.1:${cloud.server.address().port}`;
  } finally {for(const key of Object.keys(overrides)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
}
(async()=>{
  let result;
  try {
    await app.whenReady();
    // Compile the existing server with a test-only loopback bind. Production
    // source is unchanged; no listener is exposed to the user's LAN.
    const filename=path.join(root,'signaling-server.js');
    const source=fs.readFileSync(filename,'utf8');
    assert.ok(source.includes("server.listen(port, '0.0.0.0'"));
    const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(root);
    mod._compile(source.replace("server.listen(port, '0.0.0.0'","server.listen(port, '127.0.0.1'"),filename);
    signaling=await mod.exports.startSignalingServer(0,{identityFile:path.join(temp,'identities.json'),historyFile:path.join(temp,'chat.json'),reportsFile:path.join(temp,'reports.json'),musicDirectory:path.join(temp,'music'),pluginDirectories:[],roomLayouts:[{id:'selfweb-tests',name:'Teste local SelfWeb',voiceChannels:['Geral','Jogando'],textChannels:['geral','conversa']}]});
    const url=`http://127.0.0.1:${signaling.server.address().port}`;
    const a=await makeClient('Web A',url);
    const b=await makeClient('Web B',url);
    const c=await makeClient('Desktop source',url,true);
    // Exercise native platform metadata through the same minimal preload value.
    await act(c,"window.voiceupDesktop={platform:'win32',checkForUpdates:async()=>({ok:true,available:false})}");
    const peers=[a,b,c];
    assert.deepEqual(blocked,[],'Abrir arquivo não deve fazer pedidos externos.');
    for(const client of peers) await run(client,'(async()=>{await joinHostedRoom();return true;})()');
    for(const client of peers) await until(client,'serverMembers.size===3 && hostedSocket.connected','presença entre 3 clientes');
    for(const client of peers) {
      assert.equal(await run(client,"ROOM_CHANNELS.voice.includes('Jogando') && ROOM_CHANNELS.text.includes('conversa')"),true,'layout recebido');
      await run(client,"switchVoiceChannel('Geral')");
    }
    for(const client of peers) await until(client,"[...hostedPeers.values()].filter(p=>p.pc?.connectionState==='connected' && p.channel?.readyState==='open').length===2",'áudio/P2P 3 clientes');
    if(!legacyRoot) {
    for(const client of peers) await until(client,"[...serverMembers.values()].some(m=>m.name==='Desktop source' && m.platform==='windows')",'plataforma Windows propagada');
    await act(c,"setPresenceStatus('dnd')");
    for(const client of peers) await until(client,"[...serverMembers.values()].some(m=>m.name==='Desktop source' && m.platform==='windows' && m.status==='dnd')",'plataforma conserva status DND');
    await act(a,"{const member=[...serverMembers.values()].find(m=>m.name==='Desktop source');rememberHostedMember({id:member.id,status:'dnd'});if(serverMembers.get(member.id).platform!=='windows')throw new Error('Legacy snapshot lost platform');}");
    await act(c,"window.voiceupDesktop.platform='linux';setPresenceStatus('idle')");
    for(const client of peers) await until(client,"[...serverMembers.values()].some(m=>m.name==='Desktop source' && m.platform==='linux' && m.status==='idle')",'plataforma Linux propagada');
    } else assert.equal(await run(c,'window.voiceupVersion'),'1.1.2','Código real da última versão pública');
    const audioReceived=`(async()=>{let count=0;for(const p of hostedPeers.values()){const stats=await p.pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.bytesReceived>0))count++;}return count===2;})()`;
    for(const client of peers) await until(client,audioReceived,'pacotes de voz nos três clientes');
    await run(a,"void hostedSocket.emit('text-message',{text:'Olá do SelfWeb',textChannel:'geral'})");
    for(const client of [b,c]) await until(client,"(channelMessages.get('geral')||[]).some(m=>m.text==='Olá do SelfWeb')",'chat interoperável');
    for(const client of peers) await run(client,'startCamera()');
    const decoded=`(async()=>{let count=0;for(const p of hostedPeers.values()){const stats=await p.pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.framesDecoded>0))count++;}return count===2;})()`;
    for(const client of peers) await until(client,decoded,'câmeras recebidas nos três clientes');
    // Fake display capture uses a distinct fake camera video track plus a
    // generated sine wave. It never captures a real screen or microphone.
    for(const client of [a,b]) await act(client,`
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const video=await navigator.mediaDevices.getUserMedia({video:{width:320,height:180},audio:false});
        const ctx=new AudioContext(); const oscillator=ctx.createOscillator();
        const dest=ctx.createMediaStreamDestination(); oscillator.connect(dest);oscillator.start();await ctx.resume();
        window.selfwebTestScreenAudio=ctx;
        return new MediaStream([...video.getVideoTracks(),...dest.stream.getAudioTracks()]);
      };
      shareSystemAudio=true;await shareScreen();
    `);
    for(const client of peers) await act(client,"for(const p of hostedPeers.values()) { if(typeof setParticipantScreenView==='function')setParticipantScreenView(p,true);else requestParticipantMediaView(p,'screen'); }");
    const screenDecoded=`(async()=>{let count=0;for(const p of hostedPeers.values()){const track=p.videoStreams?.screen?.getVideoTracks()[0];if(!track)continue;const stats=await p.pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.trackIdentifier===track.id&&s.framesDecoded>2))count++;}return count;})()`;
    for(const client of [a,b]) await until(client,`${screenDecoded}.then(count=>count>=1)`,'live enquanto transmite e usa câmera');
    await until(c,`${screenDecoded}.then(count=>count===2)`,'duas lives recebidas pelo protocolo Desktop');
    // Simulated browser cancellation keeps the previous live alive.
    const trackBefore=await run(a,'screenStream.getVideoTracks()[0].id');
    await act(a,"navigator.mediaDevices.getDisplayMedia=async()=>{throw new DOMException('Cancelado','NotAllowedError');};await shareScreen()");
    assert.equal(await run(a,'screenStream.getVideoTracks()[0].id'),trackBefore);
    assert.equal(await run(a,"sharedAudioTrack?.id!==outgoingAudioTrack()?.id && sharedAudioTrack?.readyState==='live' && outgoingAudioTrack()?.readyState==='live'"),true,'microfone separado da live');
    const voiceTrack=await run(a,'outgoingAudioTrack().id');
    await act(a,'await stopScreenShare()');
    assert.equal(await run(a,'outgoingAudioTrack().id'),voiceTrack,'encerrar live não substitui a voz');
    assert.equal(await run(a,"outgoingAudioTrack().readyState==='live' && cameraStream.getVideoTracks()[0].readyState==='live'"),true);
    // Stopping a camera must not remove the microphone lane or close the call.
    await run(b,'stopCamera()');
    assert.equal(await run(b,"outgoingAudioTrack()?.readyState==='live' && [...hostedPeers.values()].every(p=>p.pc?.connectionState==='connected')"),true);
    for(const client of peers) assert.deepEqual(await run(client,'window.voiceupDiagnostics'),[], 'sem erros de interface/protocolo');
    for(const client of peers) client.destroy();
    const directA=await makeClient('Direto A',url);
    const directB=await makeClient('Direto B',url);
    await act(directA,'await makeOffer()');
    const offer=await run(directA,"({description:peer.pc.localDescription.toJSON(),candidates:peer.manualCandidates,name:myName,color:myColor,avatar:myAvatar})");
    // Exercise the same manual signaling core with the actual offer/answer,
    // without a signaling socket or touching UI input elements.
    const answer=await run(directB,`(async()=>{const data=${JSON.stringify(offer)};await enterApp('manual');const pc=makePeer('answerer');peer.name=data.name;peer.color=data.color;peer.avatar=data.avatar;await pc.setRemoteDescription(data.description);await window.voiceupBindManualAnswerMedia();await addManualCandidates(data.candidates);await pc.setLocalDescription(await pc.createAnswer());await waitForIce(pc);return {description:pc.localDescription.toJSON(),candidates:peer.manualCandidates};})()`);
    await act(directA,`await peer.pc.setRemoteDescription(${JSON.stringify(answer.description)});await addManualCandidates(${JSON.stringify(answer.candidates)})`);
    for(const client of [directA,directB]) await until(client,"peer?.pc.connectionState==='connected' && peer.channel?.readyState==='open'",'P2P manual sem servidor');
    for(const client of [directA,directB]) await until(client,"peer.platform==='selfweb'",'plataforma em convite manual');
    await act(directA,"setPresenceStatus('dnd')");
    await until(directB,"peer.status==='dnd' && peer.platform==='selfweb'",'status sem servidor');
    await act(directA,"peer.channel.send(JSON.stringify({type:'chat',text:'P2P SelfWeb',name:myName,color:myColor,textChannel:'geral',messageId:'selfweb-direct-test',createdAt:Date.now()}))");
    await until(directB,"(channelMessages.get('geral')||[]).some(m=>m.text==='P2P SelfWeb')",'texto em P2P manual');
    for(const client of [directA,directB]) assert.deepEqual(await run(client,'window.voiceupDiagnostics'),[]);
    directA.destroy();directB.destroy();
    const cloudUrl=await startLocalCloud();
    const cloudA=await makeClient('Cloud Web A',cloudUrl);
    const cloudB=await makeClient('Cloud Web B',cloudUrl,Boolean(legacyRoot));
    for(const client of [cloudA,cloudB]) await act(client,'await joinHostedRoom()');
    for(const client of [cloudA,cloudB]) await until(client,'serverMembers.size===2 && hostedSocket.connected','Cloud local');
    for(const client of [cloudA,cloudB]) await act(client,"await switchVoiceChannel('Geral')");
    for(const client of [cloudA,cloudB]) await until(client,"[...hostedPeers.values()].some(p=>p.pc?.connectionState==='connected' && p.channel?.readyState==='open')",'call via Cloud local');
    await act(cloudA,"hostedSocket.emit('text-message',{text:'Cloud SelfWeb local',textChannel:'geral'})");
    await until(cloudB,"(channelMessages.get('geral')||[]).some(m=>m.text==='Cloud SelfWeb local')",'chat via Cloud local');
    for(const client of [cloudA,cloudB]) assert.deepEqual(await run(client,'window.voiceupDiagnostics'),[]);
    const cloudAudio=`(async()=>{for(const p of hostedPeers.values()){const stats=await p.pc.getStats();if([...stats.values()].some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.bytesReceived>0))return true;}return false;})()`;
    for(const client of [cloudA,cloudB]) await until(client,cloudAudio,'áudio bidirecional via Cloud');
    await act(c.isDestroyed() ? cloudB : c,"hostedSocket.emit('text-message',{text:'Resposta do cliente de compatibilidade',textChannel:'geral'})");
    await until(cloudA,"(channelMessages.get('geral')||[]).some(m=>m.text==='Resposta do cliente de compatibilidade')",'resposta do cliente anterior');
    assert.deepEqual(errors,[],'erros do navegador');
    result={ok:true,artifactSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'dist/VoiceUP-SelfWeb.html'))).digest('hex'),browser:'Chromium sandbox sem preload',fileProtocol:true,clients:3,desktopProtocolInterop:true,platformPresence:true,legacyPlatformFallback:true,manualPlatformPresence:true,serverHostLocal:true,cloudLocal:true,channels:true,chat:true,voicePacketsReceived:true,camera:true,simultaneousScreenAndCamera:true,twoRemoteLives:true,separateVoiceAndScreenAudio:true,cancelKeepsPreviousScreen:true,stopScreenKeepsMicAndCamera:true,manualP2P:true,manualChat:true,startupExternalRequests:blocked.length,consoleErrors:errors};
    console.log(JSON.stringify(result,null,2));
    result.legacyVersion=legacyRoot?'1.1.2':null;
    result.legacySourcePath=legacyRoot || null;
    result.legacyFontRequestsBlocked=legacyFontRequests.length;
    fs.writeFileSync(path.join(__dirname,legacyRoot?'dist/legacy-compat-test-results.json':'dist/runtime-test-results.json'),JSON.stringify(result,null,2)+'\n');
  } catch(error) {console.error(error.stack||error);console.error(JSON.stringify({errors,blocked},null,2));process.exitCode=1;}
  finally {
    for(const win of windows)if(!win.isDestroyed())win.destroy();
    if(cloud){cloud.closeStores();await new Promise((resolve)=>cloud.io.close(resolve));}
    if(signaling){signaling.closeFederation();await new Promise((resolve)=>signaling.io.close(resolve));}
    app.exit(process.exitCode||0);
  }
})();
