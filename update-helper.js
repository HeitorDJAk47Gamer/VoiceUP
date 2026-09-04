const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('node:crypto');
const releaseIntegrity = require('./public/release-integrity');

const OWNER = 'HeitorDJAk47Gamer';
const REPOSITORY = 'VoiceUP';
const RELEASE_LATEST = `https://github.com/${OWNER}/${REPOSITORY}/releases/latest`;
const RELEASE_API_LATEST = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;
const MAX_INSTALLER_BYTES = 350 * 1024 * 1024;

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

function latestReleaseMetadata() {
  return new Promise((resolve, reject) => {
    const request = https.get(RELEASE_API_LATEST, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'application/vnd.github+json' } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (body.length < 1024 * 1024) body += chunk;
      });
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error(`GitHub respondeu ${response.statusCode}.`));
        try {
          const release = JSON.parse(body);
          const version = String(release.tag_name || '').replace(/^v/i, '');
          if (!/^\d+(?:\.\d+)*(?:-[0-9a-z.-]+)?$/i.test(version)) throw new Error('Versao invalida na Release.');
          if (release.draft || release.prerelease) throw new Error('A Release não pertence ao canal estável.');
          return resolve({ version, assets: Array.isArray(release.assets) ? release.assets : [] });
        } catch (error) {
          return reject(error);
        }
      });
    }).on('error', reject);
    request.setTimeout(10000, () => request.destroy(new Error('A consulta de atualizacao demorou demais. Tente novamente depois.')));
  });
}

function comparableAssetName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function preferredLinuxExtension(executablePath = process.execPath, appImagePath = process.env.APPIMAGE) {
  if (appImagePath || /\.appimage$/i.test(String(executablePath || ''))) return 'AppImage';
  return /^\/opt\//.test(String(executablePath || '')) ? 'deb' : 'AppImage';
}

function updateAssetName(assetPrefix, version, options = {}) {
  const platform = String(options.platform || process.platform);
  const baseName = String(assetPrefix || '').trim();
  if (platform === 'linux') {
    const productName = String(options.linuxProductName || baseName.replace(/\s+Setup$/i, '') || 'VoiceUP').replace(/[^a-z0-9._-]/gi, '');
    const architecture = ['x64', 'arm64'].includes(String(options.arch || process.arch)) ? String(options.arch || process.arch) : 'x64';
    const extension = options.linuxExtension === 'deb' ? 'deb' : 'AppImage';
    return `${productName}-${version}-linux-${architecture}.${extension}`;
  }
  // GitHub Releases normalizes spaces in uploaded asset names to dots.
  // Use the public name that is actually stored by GitHub so both the
  // Client and ServerHost updater can download the current installer.
  return `${baseName} ${version}.exe`.replace(/\s+/g, '.');
}

function assetFor(assetPrefix, version, releaseAssets = [], options = {}) {
  const assetName = updateAssetName(assetPrefix, version, options);
  const expected = comparableAssetName(assetName);
  const published = releaseAssets.find((asset) => comparableAssetName(asset && asset.name) === expected);
  if (published && published.browser_download_url) {
    return {
      assetName: String(published.name || assetName),
      url: String(published.browser_download_url),
      digest: String(published.digest || ''),
      size: Number(published.size || 0),
      published: true,
      platform: String(options.platform || process.platform)
    };
  }
  return {
    assetName,
    url: `https://github.com/${OWNER}/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(assetName)}`,
    digest: '',
    size: 0,
    published: false,
    platform: String(options.platform || process.platform)
  };
}

function updateAvailability(version, installedVersion, asset, platform = process.platform) {
  const newer = isNewer(version, installedVersion);
  const verifiedAsset = Boolean(asset?.published)
    && /^sha256:[a-f0-9]{64}$/i.test(String(asset?.digest || ''));
  const packageUnavailable = newer && !verifiedAsset;
  const platformName = platform === 'linux' ? 'Linux' : platform === 'win32' ? 'Windows' : 'este sistema';
  return {
    available: newer && verifiedAsset,
    packageUnavailable,
    message: packageUnavailable
      ? `A versão ${version} foi publicada, mas ainda não há um pacote ${platformName} verificado para esta instalação.`
      : ''
  };
}

function trustedDownloadUrl(value) {
  try {
    const target = new URL(String(value || ''));
    const hostname = target.hostname.toLowerCase();
    return target.protocol === 'https:' && !target.username && !target.password && !target.hash && (!target.port || target.port === '443') &&
      ((hostname === 'github.com' && target.pathname.startsWith(`/${OWNER}/${REPOSITORY}/releases/download/`)) ||
      ['objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(hostname));
  } catch { return false; }
}

function signedReleaseEnvelope(version, assets) {
  const name = `VoiceUP-Release-${version}.json`;
  const manifest = assets.find(asset => asset.name === name);
  const expectedUrl = releaseIntegrity.assetUrl(version, name);
  if (!manifest || manifest.browser_download_url !== expectedUrl) return Promise.reject(new Error('A Release ainda não possui um manifesto assinado.'));
  const read = (url, redirects = 0) => new Promise((resolve, reject) => {
    if (!trustedDownloadUrl(url) || redirects > 5) return reject(new Error('Endereço do manifesto recusado.'));
    const request = https.get(url, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'application/octet-stream' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return resolve(read(new URL(response.headers.location, url).href, redirects + 1));
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`Falha ao baixar manifesto (${response.statusCode}).`)); }
      const chunks = []; let length = 0;
      response.on('data', chunk => { length += chunk.length; if (length > releaseIntegrity.maxManifestBytes) response.destroy(new Error('Manifesto muito grande.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => {
        try { const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); releaseIntegrity.verifySync(envelope, version); resolve(envelope); }
        catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.setTimeout(15000, () => request.destroy(new Error('Tempo esgotado ao verificar a Release.')));
  });
  return read(expectedUrl);
}

function download(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (!trustedDownloadUrl(url)) return reject(new Error('O endereço da atualização não pertence ao canal oficial do VoiceUP.'));
    const request = https.get(url, { headers: { 'User-Agent': 'VoiceUP-Desktop-Updater', Accept: 'application/octet-stream' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 5) {
        response.resume();
        return resolve(download(new URL(response.headers.location, url).href, destination, redirects + 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`Nao foi possivel baixar a atualizacao (${response.statusCode}).`));
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > MAX_INSTALLER_BYTES) {
        response.resume();
        return reject(new Error('A atualização excede o tamanho máximo permitido.'));
      }
      let downloadedBytes = 0;
      let settled = false;
      const file = fs.createWriteStream(destination, { flags: 'wx' });
      const fail = (error) => {
        if (settled) return;
        settled = true;
        response.destroy();
        file.destroy();
        fs.unlink(destination, () => reject(error));
      };
      response.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes > MAX_INSTALLER_BYTES) fail(new Error('A atualização excede o tamanho máximo permitido.'));
      });
      response.on('error', fail);
      response.on('aborted', () => fail(new Error('O download foi interrompido.')));
      response.pipe(file);
      file.on('finish', () => file.close((error) => {
        if (settled) return;
        if (error) return fail(error);
        settled = true;
        resolve({ bytes: downloadedBytes });
      }));
      file.on('error', fail);
    }).on('error', (error) => { fs.unlink(destination, () => reject(error)); });
    request.setTimeout(30000, () => request.destroy(new Error('O download da atualização parou de responder.')));
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyDownloadedUpdate(filePath, asset, options = {}) {
  const signed = releaseIntegrity.verifySync(asset.envelope, asset.version);
  const platform = String(options.platform || asset.platform || process.platform);
  const product = options.product || asset.product;
  const entry = releaseIntegrity.select(signed, product, platform === 'win32' ? 'windows' : platform, asset.arch || process.arch, asset.assetName);
  if ((asset.downloadUrl || asset.url) !== entry.url || asset.digest !== `sha256:${entry.sha256}` || asset.size !== entry.size) throw new Error('Os dados do pacote não correspondem ao manifesto assinado.');
  const expectedDigest = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toLowerCase() || '';
  if (!expectedDigest) throw new Error('A Release não informa o SHA-256 do pacote. A atualização foi bloqueada por segurança.');
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size < 1024 * 1024 || stat.size > MAX_INSTALLER_BYTES) throw new Error('O pacote baixado possui tamanho inválido.');
  if (asset.size > 0 && stat.size !== asset.size) throw new Error('O tamanho do pacote não corresponde à Release oficial.');
  const actualDigest = await sha256File(filePath);
  if (actualDigest !== expectedDigest) throw new Error('O SHA-256 do pacote não corresponde à Release oficial.');
  if (platform === 'win32') {
    if (!/\.exe$/i.test(asset.assetName)) throw new Error('O pacote Windows não é um instalador EXE.');
    return { digest: actualDigest, signer: 'VoiceUP Ed25519', keyId: asset.envelope.keyId };
  }
  if (platform === 'linux') {
    if (!/\.(?:AppImage|deb)$/i.test(String(asset.assetName || filePath))) throw new Error('O formato do pacote Linux não é aceito pelo VoiceUP.');
    return { digest: actualDigest, signer: 'VoiceUP Ed25519 + GitHub Release SHA-256', keyId: asset.envelope.keyId };
  }
  throw new Error('A atualização automática não está disponível neste sistema.');
}

function registerUpdateHandlers(ipcMain, assetPrefix, isTrustedEvent = () => true, options = {}) {
  let checkInFlight = null;
  function check() {
    if (checkInFlight) return checkInFlight;
    checkInFlight = (async () => {
      let metadata;
      try { metadata = await latestReleaseMetadata(); }
      catch (_error) { metadata = { version: await latestReleaseVersion(), assets: [] }; }
      const { version } = metadata;
      const asset = assetFor(assetPrefix, version, metadata.assets, {
        ...options,
        platform: process.platform,
        arch: process.arch,
        linuxExtension: options.linuxExtension || preferredLinuxExtension()
      });
      const availability = updateAvailability(version, app.getVersion(), asset, process.platform);
      let envelope = null;
      const product = /^VoiceUPServer/.test(assetPrefix) ? 'serverhost' : 'client';
      if (availability.available) {
        envelope = await signedReleaseEnvelope(version, metadata.assets);
        const signed = releaseIntegrity.verifySync(envelope, version);
        const entry = releaseIntegrity.select(signed, product, process.platform === 'win32' ? 'windows' : process.platform, process.arch, asset.assetName);
        if (asset.url !== entry.url || asset.digest.toLowerCase() !== `sha256:${entry.sha256}` || asset.size !== entry.size) throw new Error('O pacote publicado não corresponde à assinatura do VoiceUP.');
      }
      return {
        installedVersion: app.getVersion(),
        version,
        ...availability,
        assetName: asset.assetName,
        downloadUrl: asset.url,
        digest: asset.digest,
        size: asset.size,
        published: asset.published,
        platform: asset.platform,
        envelope, product, arch: process.arch
      };
    })().finally(() => { checkInFlight = null; });
    return checkInFlight;
  }

  ipcMain.handle('update:check', async (event) => {
    if (!isTrustedEvent(event)) return { ok: false, message: 'Solicitação de atualização bloqueada pelo VoiceUP.' };
    try { return { ok: true, ...(await check()) }; }
    catch (error) { return { ok: false, message: error.message || 'Falha ao consultar o GitHub.' }; }
  });

  ipcMain.handle('update:download', async (event) => {
    if (!isTrustedEvent(event)) return { ok: false, message: 'Solicitação de atualização bloqueada pelo VoiceUP.' };
    let updateDirectory = '';
    try {
      const update = await check();
      if (update.packageUnavailable) throw new Error(update.message);
      if (!update.available) throw new Error('Nenhuma atualização verificada está disponível para esta instalação.');
      updateDirectory = fs.mkdtempSync(path.join(app.getPath('temp'), 'voiceup-update-'));
      const destination = path.join(updateDirectory, path.basename(update.assetName));
      await download(update.downloadUrl, destination);
      await verifyDownloadedUpdate(destination, update, { platform: process.platform });
      if (process.platform === 'linux' && /\.AppImage$/i.test(destination)) fs.chmodSync(destination, 0o755);
      const result = await shell.openPath(destination);
      if (result) throw new Error(result);
      return { ok: true };
    } catch (error) {
      if (updateDirectory) fs.rmSync(updateDirectory, { recursive: true, force: true });
      return { ok: false, message: error.message || 'Falha ao baixar a atualizacao.' };
    }
  });
}

module.exports = { registerUpdateHandlers, isNewer, assetFor, updateAssetName, updateAvailability, preferredLinuxExtension, trustedDownloadUrl, verifyDownloadedUpdate };
