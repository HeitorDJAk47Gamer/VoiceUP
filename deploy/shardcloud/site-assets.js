'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const pages = new Map([
  ['/', 'site.html'],
  ['/status', 'status.html'],
  ['/plugins', 'plugins.html'],
  ['/privacidade', 'privacy.html'],
  ['/termos', 'terms.html']
]);

function createSiteRouter(directory) {
  const router = express.Router();
  const assets = new Map();
  for (const [name, type] of [['site.css', 'text/css'], ['site.js', 'application/javascript']]) {
    const content = fs.readFileSync(path.join(directory, name));
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const extension = path.extname(name);
    const url = `/site-assets/site.${hash}${extension}`;
    assets.set(name, { url });
    router.get(url, (_request, response) => {
      response.set('Cache-Control', 'public, max-age=31536000, immutable').type(type).send(content);
    });
    // Old bookmarks/pages keep working, but must not retain an outdated stylesheet.
    router.get(`/${name}`, (_request, response) => {
      response.set('Cache-Control', 'no-store').type(type).send(content);
    });
  }

  for (const [route, file] of pages) {
    // Derive asset URLs from the bytes, not the app version: site-only fixes also
    // invalidate cached CSS/JS without changing installers or signed downloads.
    const html = fs.readFileSync(path.join(directory, file), 'utf8')
      .replace(/((?:href|src)=["'])\/(site\.(?:css|js))(["'])/g,
        (_match, before, name, after) => `${before}${assets.get(name).url}${after}`);
    router.get(route, (_request, response) => {
      response.set('Cache-Control', 'no-store').type('html').send(html);
    });
  }
  router.use('/site-assets', (_request, response) => response.set('Cache-Control', 'no-store').sendStatus(404));
  return router;
}

module.exports = { createSiteRouter };
