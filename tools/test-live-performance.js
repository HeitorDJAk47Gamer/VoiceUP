const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const workspace = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(workspace, 'public', 'app.js'), 'utf8');
const main = fs.readFileSync(path.join(workspace, 'electron-main.js'), 'utf8');

assert.match(main, /backgroundThrottling:\s*false/, 'O Client precisa continuar ativo quando o jogo cobre ou minimiza a janela do VoiceUP.');
assert.match(renderer, /function screenMotionPriority\(\)[\s\S]*selectedFrameRate\(\)\s*>=\s*30/, 'Lives de 30/60 FPS precisam priorizar movimento.');
assert.match(renderer, /function videoContentHint[^\n]*\?\s*'detail'\s*:\s*'motion'/, 'A captura precisa alternar corretamente entre movimento e detalhe.');
assert.match(renderer, /'maintain-framerate'/, 'O WebRTC precisa preservar a taxa de quadros das lives em movimento.');
assert.match(renderer, /screenBase\s*=\s*\{[^}]*720:\s*3800000[^}]*1080:\s*7500000/, 'A live de jogo precisa ter teto de bitrate próprio.');
assert.match(renderer, /track\.applyConstraints\(quality\(\)\)/, 'A fonte capturada precisa receber a resolução e o FPS selecionados após abrir.');
assert.doesNotMatch(renderer, /const track = screenStream\.getVideoTracks\(\)\[0\];\s*track\.contentHint\s*=\s*'detail'/, 'A live não pode forçar detalhe e derrubar o FPS de jogos.');

const functionSource = (name) => {
  const start = renderer.indexOf(`function ${name}`);
  assert.ok(start >= 0, `Função ${name} não encontrada.`);
  const opening = renderer.indexOf('{', start);
  let depth = 0;
  for (let index = opening; index < renderer.length; index += 1) {
    if (renderer[index] === '{') depth += 1;
    if (renderer[index] === '}') depth -= 1;
    if (!depth) return renderer.slice(start, index + 1);
  }
  throw new Error(`Função ${name} incompleta.`);
};
const fields = { 'quality-select': { value: '720' }, 'fps-select': { value: '30' } };
const policy = { preserveScreenSourceQuality: false, $: (id) => fields[id] };
vm.createContext(policy);
vm.runInContext([
  'selectedFrameRate', 'screenMotionPriority', 'videoContentHint',
  'videoDegradationPreference', 'videoBitrate', 'configureVideoSenderParameters'
].map(functionSource).join('\n'), policy);

assert.equal(policy.videoContentHint('screen'), 'motion');
assert.equal(policy.videoDegradationPreference('screen'), 'maintain-framerate');
assert.equal(policy.videoBitrate('screen'), 3800000);
fields['fps-select'].value = '60';
assert.equal(policy.videoBitrate('screen'), 6080000);
fields['fps-select'].value = '15';
assert.equal(policy.videoContentHint('screen'), 'detail');
assert.equal(policy.videoDegradationPreference('screen'), 'maintain-resolution');
fields['fps-select'].value = '60';
policy.preserveScreenSourceQuality = true;
const sourceParameters = policy.configureVideoSenderParameters({ encodings: [{ maxBitrate: 1, maxFramerate: 1 }] }, 'screen');
assert.equal(sourceParameters.encodings[0].maxBitrate, undefined);
assert.equal(sourceParameters.encodings[0].maxFramerate, undefined);
assert.equal(sourceParameters.degradationPreference, 'maintain-framerate');

process.stdout.write('Política de desempenho de live validada.\n');
