'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');
const { createSiteRouter } = require('../deploy/shardcloud/site-assets');

const source = path.resolve(__dirname, '../deploy/shardcloud');
const pages = new Map([['/', 'site.html'], ['/status', 'status.html'], ['/plugins', 'plugins.html'], ['/privacidade', 'privacy.html'], ['/termos', 'terms.html']]);
const assets = ['site.css', 'site.js'];
const assetUrl = (name, root) => `/site-assets/site.${crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex')}${path.extname(name)}`;

async function checkSite(base, root) {
  const request = (route, options = {}) => fetch(`${base}${route}`, { ...options, signal: AbortSignal.timeout(10000) });
  for (const [route, name] of pages) {
    const response = await request(route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('cache-control'), /no-store/, route);
    const expected = fs.readFileSync(path.join(root, name), 'utf8').replace(/((?:href|src)=["'])\/(site\.(?:css|js))(["'])/g,
      (_match, before, asset, after) => `${before}${assetUrl(asset, root)}${after}`);
    assert.equal(await response.text(), expected, `${route}: HTML must reference the matching asset bytes`);
  }
  for (const name of assets) {
    const bytes = fs.readFileSync(path.join(root, name));
    for (const route of [assetUrl(name, root), `/${name}`]) {
      const response = await request(route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('cache-control'), route.startsWith('/site-assets/') ? /immutable/ : /no-store/);
      assert.match(response.headers.get('content-type'), name.endsWith('.css') ? /^text\/css\b/ : /^application\/javascript\b/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.equal((await request(route, { method: 'HEAD' })).status, 200);
    }
  }
  for (const route of ['/site-assets/site.unknown.css', '/site-assets/package.json']) {
    const response = await request(route);
    assert.equal(response.status, 404, route);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
}

async function withSite(root, callback) {
  const app = express();
  app.use(createSiteRouter(root));
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

(async () => {
  const remote = process.argv[2];
  if (remote) {
    const target = new URL(remote);
    assert.ok(['http:', 'https:'].includes(target.protocol));
    await checkSite(target.origin, source);
    console.log('PASS: site publicado com HTML, CSS e JS sincronizados; cache e tipos de conteúdo corretos.');
    return;
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voiceup-site-assets-'));
  try {
    const css = fs.readFileSync(path.join(source, 'site.css'), 'utf8');
    assert.match(css, /\.android-logo\{[^}]*width:22px;[^}]*height:22px;/, 'Android icon must retain its small size');
    assert.match(css, /\.selfweb-card\{background:radial-gradient/, 'SelfWeb must have its own subtle background color');
    assert.match(css, /\.requirements-panel\[hidden\]\{display:none\}/, 'Inactive requirement panels must stay hidden');
    assert.ok(fs.readFileSync(path.resolve(__dirname, 'package-cloud.ps1'), 'utf8').includes("'site-assets.js'"), 'Cloud packages must include the site asset router');
    for (const file of [...pages.values(), ...assets]) fs.copyFileSync(path.join(source, file), path.join(scratch, file));
    await withSite(scratch, base => checkSite(base, scratch));
    const previous = assets.map(name => assetUrl(name, scratch));
    // Simulate a site-only publication with the same VoiceUP version.
    for (const name of assets) fs.appendFileSync(path.join(scratch, name), '\n/* site-only update */\n');
    assets.forEach((name, index) => assert.notEqual(assetUrl(name, scratch), previous[index]));
    await withSite(scratch, base => checkSite(base, scratch));
    console.log('PASS: cinco páginas, CSS/JS com hash, URLs legadas, HEAD, 404 e atualização sem alterar a versão do app.');
  } finally {
    assert.equal(path.dirname(scratch), path.resolve(os.tmpdir()));
    assert.ok(path.basename(scratch).startsWith('voiceup-site-assets-'));
    fs.rmSync(scratch, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
