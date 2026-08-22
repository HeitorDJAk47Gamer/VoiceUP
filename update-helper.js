const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');

const OWNER = 'HeitorDJAk47Gamer';
const REPOSITORY = 'VoiceUP';
const RELEASE_LATEST = `https://github.com/${OWNER}/${REPOSITORY}/releases/latest`;

function parseVersion(value) {
  const clean = String(value || '').trim().replace(/^v/i, '').split('+')[0];
  const separator = clean.indexOf('-');
  const core = separator >= 0 ? clean.slice(0, separator) : clean;
  const prerelease = separator >= 0 ? clean.slice(separator + 1).split('.').filter(Boolean) : [];
  return {
    core: core.split('.').map((part) => Number.parseInt(part, 10) || 0),
    prerelease
  };
}

function comparePrerelease(next, current) {
  if (!next.length && !current.length) return 0;
  if (!next.length) return 1;
  if (!current.length) return -1;
  const length = Math.max(next.length, current.length);
  for (let index = 0; index < length; index += 1) {
    if (next[index] === undefined) return -1;
    if (current[index] === undefined) return 1;
    const nextNumeric = /^\d+$/.test(next[index]);
    const currentNumeric = /^\d+$/.test(current[index]);
    if (nextNumeric && currentNumeric) {
      const difference = Number(next[index]) - Number(current[index]);
      if (difference !== 0) return difference > 0 ? 1 : -1;
    } else if (nextNumeric !== currentNumeric) return nextNumeric ? -1 : 1;
    else {
      const difference = next[index].localeCompare(current[index], 'en', { sensitivity: 'base' });
      if (difference !== 0) return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

function isNewer(candidate, installed) {
  const next = parseVersion(candidate);
  const current = parseVersion(installed);
  const length = Math.max(next.core.length, current.core.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (next.core[index] || 0) - (current.core[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  return comparePrerelease(next.prerelease, current.prerelease) > 0;
}

function latestReleaseVersion() {
  return new Promise((resolve, reject) => {
    const request = https.get(RELEASE_LATEST, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'text/html' } }, (response) => {
      const target = String(response.headers.location || '');
      response.resume();
      const match = target.match(/\/releases\/tag\/v?([^/?#]+)/i);
      const version = match ? decodeURIComponent(match[1]) : '';
      if (response.statusCode >= 300 && response.statusCode < 400 && /^\d+(?:\.\d+)*(?:-[0-9a-z.-]+)?$/i.test(version)) return resolve(version);
      if (response.statusCode === 404) return reject(new Error('Ainda nao existe uma atualizacao publicada no GitHub. Tente novamente depois.'));
      return reject(new Error('Nao foi possivel descobrir a ultima Release publica. Tente novamente em instantes.'));
    }).on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('A consulta de atualizacao demorou demais. Tente novamente depois.')));
  });
}

function assetFor(assetPrefix, version) {
  const baseName = String(assetPrefix || '').trim();
  // GitHub Releases normalizes spaces in uploaded asset names to dots.
  // Use the public name that is actually stored by GitHub so both the
  // Client and ServerHost updater can download the current installer.
  const assetName = `${baseName} ${version}.exe`.replace(/\s+/g, '.');
  return { assetName, url: `https://github.com/${OWNER}/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(assetName)}` };
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
  let checkInFlight = null;
  function check() {
    if (checkInFlight) return checkInFlight;
    checkInFlight = (async () => {
      const version = await latestReleaseVersion();
      const asset = assetFor(assetPrefix, version);
      return {
        installedVersion: app.getVersion(),
        version,
        available: isNewer(version, app.getVersion()),
        assetName: asset.assetName,
        downloadUrl: asset.url
      };
    })().finally(() => { checkInFlight = null; });
    return checkInFlight;
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

module.exports = { registerUpdateHandlers, isNewer };
