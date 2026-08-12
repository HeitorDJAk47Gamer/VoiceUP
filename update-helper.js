const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'HeitorDJAk47Gamer';
const REPOSITORY = 'VoiceUP';
const RELEASE_API = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;

function versionParts(value) {
  return String(value || '').replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function isNewer(candidate, installed) {
  const next = versionParts(candidate);
  const current = versionParts(installed);
  const length = Math.max(next.length, current.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (next[index] || 0) - (current[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'application/vnd.github+json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode === 404) return reject(new Error('Ainda nao existe uma atualizacao publicada no GitHub. Tente novamente depois.'));
        if (response.statusCode !== 200) return reject(new Error(`GitHub respondeu ${response.statusCode}.`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('Resposta de atualizacao invalida.')); }
      });
    }).on('error', reject);
  });
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'application/octet-stream' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        return resolve(download(response.headers.location, destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Nao foi possivel baixar a atualizacao (${response.statusCode}).`));
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', (error) => { file.close(); fs.unlink(destination, () => reject(error)); });
    }).on('error', reject);
  });
}

function registerUpdateHandlers(ipcMain, assetPrefix) {
  async function check() {
    const release = await requestJson(RELEASE_API);
    const version = String(release.tag_name || '').replace(/^v/i, '');
    const asset = (release.assets || []).find((item) => item.name.replace(/[._-]+/g, ' ').startsWith(assetPrefix) && item.name.toLowerCase().endsWith('.exe'));
    if (!version || !asset) throw new Error('A release publicada nao possui o instalador esperado.');
    return {
      installedVersion: app.getVersion(),
      version,
      available: isNewer(version, app.getVersion()),
      notes: release.body || '',
      assetName: asset.name
    };
  }

  ipcMain.handle('update:check', async () => {
    try { return { ok: true, ...(await check()) }; }
    catch (error) { return { ok: false, message: error.message || 'Falha ao consultar o GitHub.' }; }
  });

  ipcMain.handle('update:download', async () => {
    try {
      const release = await requestJson(RELEASE_API);
      const asset = (release.assets || []).find((item) => item.name.replace(/[._-]+/g, ' ').startsWith(assetPrefix) && item.name.toLowerCase().endsWith('.exe'));
      if (!asset) throw new Error('Instalador nao encontrado na release.');
      const destination = path.join(app.getPath('temp'), asset.name);
      await download(asset.browser_download_url, destination);
      const result = await shell.openPath(destination);
      if (result) throw new Error(result);
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message || 'Falha ao baixar a atualizacao.' }; }
  });
}

module.exports = { registerUpdateHandlers };
