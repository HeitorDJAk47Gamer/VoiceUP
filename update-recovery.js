'use strict';
const fs = require('node:fs');
const path = require('node:path');

// This journal is a hint only. Executables must still pass signed-manifest
// verification immediately before every launch, including recovered packages.
function createRecovery(directory) {
  const journal = path.join(directory, 'pending.json');
  const read = () => { try { const value = JSON.parse(fs.readFileSync(journal, 'utf8')); return typeof value?.version === 'string' ? value : null; } catch { return null; } };
  const save = (value) => {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, 'pending.tmp');
    fs.writeFileSync(temporary, JSON.stringify(value));
    fs.renameSync(temporary, journal);
  };
  const candidate = (asset) => {
    const digest = String(asset.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1];
    const extension = String(asset.assetName || '').match(/\.(exe|AppImage|deb)$/i)?.[0];
    if (!digest || !extension) throw new Error('Identificador inválido do pacote de recuperação.');
    return path.join(directory, digest.toLowerCase() + extension);
  };
  return { read, save, candidate };
}
module.exports = { createRecovery };
