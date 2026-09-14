'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const betaSource = fs.readFileSync(path.join(root, 'public', 'beta-ui.js'), 'utf8');

const requiredPatterns = ['server-connect', 'server-disconnect', 'call-join', 'call-leave', 'live-viewer-in', 'live-viewer-out', 'live-watch-in', 'live-watch-out'];
for (const sound of requiredPatterns) assert.match(appSource, new RegExp(`['"]${sound}['"]\\s*:`), `Som ausente: ${sound}`);
for (const sound of ['server-connect', 'server-disconnect', 'call-join', 'call-leave']) assert.match(appSource + betaSource, new RegExp(`playNotification\\(['"]${sound}['"]\\)`), `Evento sem som: ${sound}`);
for (const sound of ['live-viewer-in', 'live-viewer-out', 'live-watch-in', 'live-watch-out']) assert.match(betaSource, new RegExp(`['"]${sound}['"]`), `Transição de live sem som: ${sound}`);
assert.doesNotMatch(betaSource, /playNotification\(['"]disconnect['"]\)/, 'A interface nova voltou a usar o som genérico antigo.');
const hostedConnectedLine = appSource.split(/\r?\n/).find((line) => line.includes('function markHostedConnected')) || '';
assert.ok(hostedConnectedLine, 'A conexão P2P hospedada não foi encontrada.');
assert.doesNotMatch(hostedConnectedLine, /playNotification/, 'Cada conexão WebRTC tocaria o som novamente ao entrar em uma call com várias pessoas.');
assert.match(appSource, /socket\.on\(['"]peer-joined['"][\s\S]{0,500}playNotification\(['"]call-join['"]\)/, 'A entrada remota na call não dispara um único som semântico.');
console.log('PASS notification sounds: servidor, call, espectador e live usam eventos separados.');
