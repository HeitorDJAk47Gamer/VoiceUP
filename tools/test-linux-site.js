const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const integrity = require('../public/release-integrity');
const version = require('../package.json').version;

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
    assert.match(html, /Execução em hardware Linux ainda não validada/);
    assert.doesNotMatch(html, /Beta experimental|mobile-beta\./);
    const envelopeResponse = await request('/api/release-integrity');
    assert.equal(envelopeResponse.status, 200);
    const catalog = integrity.verifySync(await envelopeResponse.json(), version);
    const releaseResponse = await request('/api/linux-release');
    assert.equal(releaseResponse.headers.get('cache-control'), 'no-store');
    const release = await releaseResponse.json();
    assert.equal(release.available, true);
    assert.equal(release.arch, 'x64');
    assert.equal(release.version, version);
    assert.equal(release.format, 'AppImage');
    const manifestResponse = await request(release.checksumsUrl);
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.text();
    for (const [target, url] of [['client', release.clientUrl], ['server', release.serverUrl]]) {
      const entry = integrity.select(catalog, target === 'client' ? 'client' : 'serverhost', 'linux', 'x64');
      const response = await request(url, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.match(entry.name, /linux-x64\.AppImage$/);
      assert.equal(response.headers.get('location'), entry.url);
      assert.equal(response.headers.get('x-checksum-sha256'), entry.sha256);
      assert.ok(manifest.includes(`${entry.sha256}  ${entry.name}`));
      console.log(`${target}: destino oficial e hash do catálogo assinado validados.`);
    }
    for (const [target, product, platform] of [['android', 'client', 'android'], ['selfweb', 'selfweb', 'web']]) {
      const entry = integrity.select(catalog, product, platform, 'universal');
      const response = await request(`/downloads/${target}`);
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(bytes.length, entry.size);
      assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
      assert.equal(response.headers.get('x-voiceup-version'), version);
      assert.ok(response.headers.get('content-disposition').includes(entry.name));
    }
    const windowsRelease = await (await request('/api/release')).json();
    assert.equal(windowsRelease.clientUrl, integrity.select(catalog, 'client', 'windows', 'x64').url);
    assert.equal(windowsRelease.serverUrl, integrity.select(catalog, 'serverhost', 'windows', 'x64').url);
    const guide = await request('/downloads/linux/guide');
    assert.match(guide.headers.get('content-type'), /text\/plain/);
    assert.match(await guide.text(), /chmod \+x VoiceUP-/);
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
