'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { request, json } = require('./github-api');
async function main() {
  const id = process.argv[2];
  if (!/^\d+$/.test(id)) throw new Error('Informe o ID do build aprovado.');
  const base = '/repos/HeitorDJAk47Gamer/VoiceUP';
  const run = await json(`${base}/actions/runs/${id}`);
  if (run.conclusion !== 'success') throw new Error('O build ainda não concluiu com sucesso.');
  const artifacts = await json(`${base}/actions/runs/${id}/artifacts`);
  const artifact = artifacts.artifacts.find(item => item.name === 'linux-x64' && !item.expired);
  if (!artifact || !/^sha256:[a-f0-9]{64}$/i.test(artifact.digest)) throw new Error('Artefato Linux sem hash oficial.');
  const response = await request(`${base}/actions/artifacts/${artifact.id}/zip`, { signal: AbortSignal.timeout(600000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (`sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}` !== artifact.digest) throw new Error('Hash do artefato Linux divergente.');
  const folder = path.join(__dirname, '../.release-tools');
  fs.mkdirSync(folder, { recursive: true });
  const destination = path.join(folder, `linux-build-${id}.zip`);
  fs.writeFileSync(destination, bytes);
  console.log(JSON.stringify({ file: destination, build: id, source: run.head_sha, bytes: bytes.length, digest: artifact.digest }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
