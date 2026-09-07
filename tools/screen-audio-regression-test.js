const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('electron-main.js');
const preload = read('client-preload.js');
const app = read('public/app.js');
const beta = read('public/beta-ui.js');
const html = read('public/index.html');
const worklet = read('public/process-audio-worklet.js');
const native = read('native/process-audio-capture.cpp');

assert.match(main, /selectedCapture\.kind === 'window'[\s\S]+\['capture-window', handle\]/, 'Janela deve capturar apenas a árvore do aplicativo selecionado.');
assert.match(main, /selectedCapture\.kind === 'screen'[\s\S]+\['capture-exclude-pid', String\(process\.pid\)\]/, 'Tela inteira deve excluir a árvore de processos do VoiceUP.');
assert.match(main, /callback\(source \? \{ video: source \} : \{\}\)/, 'O áudio protegido não pode voltar pela captura de vídeo do Chromium.');
assert.match(preload, /onProcessAudioData/, 'O PCM nativo deve atravessar o preload isolado.');
assert.match(native, /PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE/, 'O helper deve suportar áudio isolado por aplicativo.');
assert.match(native, /PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE/, 'O helper deve suportar tela inteira sem o VoiceUP.');

assert.match(html, /script-src 'self' 'wasm-unsafe-eval'/, 'A política deve continuar sem liberar scripts blob.');
assert.match(beta, /audioWorklet\.addModule\('process-audio-worklet\.js'\)/, 'O worklet precisa ser carregado de um arquivo local autorizado pela CSP.');
assert.doesNotMatch(beta, /createObjectURL\(new Blob\(\[nativeShareAudioProcessor\]/, 'O worklet não pode voltar a usar um script blob bloqueado pela CSP.');
assert.match(worklet, /registerProcessor\('voiceup-process-pcm'/, 'O módulo local precisa registrar o processador PCM.');

assert.match(beta, /function betaScreenAudioTransportTrack\(\)/, 'A segunda trilha de áudio precisa ter transporte estável.');
assert.match(beta, /sender\.replaceTrack\(silentTrack\)/, 'Ao encerrar a live, o m-line deve permanecer negociado com silêncio.');
assert.match(beta, /msg\.type === 'screen-audio-on'[\s\S]+scheduleIncomingScreenAudio/, 'O receptor deve reativar o áudio da live.');
assert.match(beta, /msg\.type === 'screen-audio-off'[\s\S]+deactivateIncomingScreenAudio/, 'O receptor deve desligar somente o áudio da live.');
assert.match(beta, /manualScreenAudio\.muted = true;[\s\S]+manualScreenAudio\.play\(\)/, 'O decodificador da live manual deve permanecer ativo e inaudível fora do mixer.');
assert.match(beta, /participant\.screenAudio\.muted = true;[\s\S]+participant\.screenAudio\.play\(\)/, 'O decodificador das lives hospedadas deve permanecer ativo e inaudível fora do mixer.');
assert.doesNotMatch(beta, /manualScreenAudioGainContext\.resume\(\)[^\n]+manualScreenAudio\.pause\(\)/, 'O decodificador da live não pode ser pausado após criar o mixer.');
assert.match(beta, /state\.screen = next;[\s\S]{0,260}applyLiveAudioLevels\(\);/, 'Abrir ou fechar uma live deve recalcular imediatamente o volume independente.');
assert.match(beta, /function screenAudioSenders\(\)/, 'A trilha da live deve usar senders próprios.');
assert.match(beta, /outgoingAudioTrackBetaGain\(\)[\s\S]+sharedAudioTrack \? null/, 'A trilha do microfone não pode reutilizar o áudio da live.');
assert.match(app, /if \(shareSystemAudio\) await startSharedSystemAudio\(\)/, 'A captura de áudio deve iniciar junto com a transmissão quando selecionada.');

console.log(JSON.stringify({
  ok: true,
  windowAudioIsolated: true,
  fullScreenExcludesVoiceUP: true,
  cspSafeWorklet: true,
  stableLiveAudioTransport: true,
  independentVoiceAndLiveTracks: true
}));
