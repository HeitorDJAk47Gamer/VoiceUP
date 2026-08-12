const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'HeitorDJAk47Gamer';
const REPOSITORY = 'VoiceUP';
const RELEASE_LATEST = `https://github.com/${OWNER}/${REPOSITORY}/releases/latest`;

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

function latestReleaseVersion() {
  return new Promise((resolve, reject) => {
    https.get(RELEASE_LATEST, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'text/html' } }, (response) => {
      const target = String(response.headers.location || '');
      response.resume();
      const match = target.match(/\/releases\/tag\/v?([0-9]+(?:\.[0-9]+)*)/i);
      if (response.statusCode >= 300 && response.statusCode < 400 && match) return resolve(match[1]);
      if (response.statusCode === 404) return reject(new Error('Ainda nao existe uma atualizacao publicada no GitHub. Tente novamente depois.'));
      return reject(new Error('Nao foi possivel descobrir a ultima Release publica. Tente novamente em instantes.'));
    }).on('error', reject);
  });
}

function assetFor(assetPrefix, version) {
  const baseName = String(assetPrefix || '').trim().replace(/\s+/g, '.');
  const assetName = `${baseName}.${version}.exe`;
  return { assetName, url: `https://github.com/${OWNER}/${REPOSITORY}/releases/download/v${version}/${assetName}` };
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
    const version = await latestReleaseVersion();
    const asset = assetFor(assetPrefix, version);
    return {
      installedVersion: app.getVersion(),
      version,
      available: isNewer(version, app.getVersion()),
      assetName: asset.assetName,
      downloadUrl: asset.url
    };
  }

  ipcMain.handle('update:check', async () => {
    try { return { ok: true, ...(await check()) }; }
    catch (error) { return { ok: false, message: error.message || 'Falha ao consultar o GitHub.' }; }
  });

  ipcMain.handle('update:download', async () => {
    try {
      const update = await check();
      const destination = path.join(app.getPath('temp'), update.assetName);
      await download(update.downloadUrl, destination);
      const result = await shell.openPath(destination);
      if (result) throw new Error(result);
      return { ok: true };
    } catch (error) { return { ok: false, message: error.message || 'Falha ao baixar a atualizacao.' }; }
  });
}

module.exports = { registerUpdateHandlers };
