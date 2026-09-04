const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const site = path.join(workspace, 'deploy', 'shardcloud');
const port = 38000 + Math.floor(Math.random() * 2000);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-linux-site-'));
const preview = process.argv.includes('--preview');
const cloud = spawn(process.execPath, [path.join(site, 'index.js')], {
  cwd: site,
  env: { ...process.env, PORT: String(port), VOICEUP_DATA_DIR: scratch, VOICEUP_ADMIN_TOKEN: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
cloud.stdout.on('data', chunk => { output += chunk; });
cloud.stderr.on('data', chunk => { output += chunk; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = `http://127.0.0.1:${port}`;
const request = (route, options = {}) => fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(30000) });

(async () => {
  try {
    for (let i = 0; i < 80 && !output.includes('ativo na porta'); i++) {
      if (cloud.exitCode !== null) throw new Error(output);
      await delay(100);
    }
    assert.match(output, /ativo na porta/, 'O Cloud não iniciou.');
    const html = await (await request('/')).text();
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    for (const platform of ['windows', 'android', 'linux', 'server']) {
      assert.ok(html.includes(`id="requirements-tab-${platform}"`));
      assert.ok(html.includes(`id="requirements-panel-${platform}"`));
    }
    assert.match(html, /Mínimo · provisório/);
    assert.match(html, /Execução em Linux ainda não validada/);
    const releaseResponse = await request('/api/linux-release');
    assert.equal(releaseResponse.headers.get('cache-control'), 'no-store');
    const release = await releaseResponse.json();
    assert.equal(release.available, true);
    assert.equal(release.arch, 'x64');
    const manifestResponse = await request(release.checksumsUrl);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.text();
    for (const [target, url] of [['client', release.clientUrl], ['server', release.serverUrl]]) {
      const response = await request(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const fileName = response.headers.get('content-disposition').match(/filename="([^"]+)"/)[1];
      assert.match(fileName, /linux-x64\.tar\.gz$/);
      const fileSize = fs.statSync(path.join(site, 'downloads', fileName)).size;
      assert.ok(fileSize > 100000000);
      assert.equal(Number(response.headers.get('content-length')), fileSize);
      const hash = crypto.createHash('sha256');
      for await (const chunk of response.body) hash.update(chunk);
      assert.ok(manifest.includes(`${hash.digest('hex')}  ${fileName}`), `${target}: SHA-256 do download divergente.`);
      const range = await request(url, { headers: { Range: 'bytes=0-1' } });
      assert.equal(range.status, 206);
      assert.deepEqual(Buffer.from(await range.arrayBuffer()), Buffer.from([0x1f, 0x8b]));
      console.log(`${target}: download completo, SHA-256 e retomada validados (${fileSize} bytes).`);
    }
    const guide = await request('/downloads/linux/guide');
    assert.match(guide.headers.get('content-type'), /text\/plain/);
    assert.match(await guide.text(), /chmod \+x voiceup/);
    for (const invalid of ['unknown', 'constructor', '__proto__', 'package.json']) {
      assert.equal((await request(`/downloads/linux/${invalid}`)).status, 404);
    }
    assert.equal((await request('/downloads/android', { method: 'HEAD' })).status, 200);
    assert.equal((await request('/health')).status, 200);
    console.log('Site Linux: abas, requisitos, downloads, guia e rotas existentes validados.');
    if (preview) {
      console.log(`PREVIEW ${base}/#requisitos (PID ${cloud.pid}; encerra em 10 minutos)`);
      await delay(10 * 60 * 1000);
    }
  } finally {
    if (cloud.exitCode === null) {
      const stopped = new Promise(resolve => cloud.once('exit', resolve));
      cloud.kill();
      await stopped;
    }
    const resolvedScratch = path.resolve(scratch);
    assert.equal(path.dirname(resolvedScratch), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedScratch).startsWith('voiceup-linux-site-'));
    fs.rmSync(resolvedScratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
