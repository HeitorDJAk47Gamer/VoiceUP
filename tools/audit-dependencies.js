'use strict';
// OSV's public API receives only dependency names/versions, never source or keys.
// API: https://google.github.io/osv.dev/post-v1-querybatch/
const fs = require('node:fs');
const assert = require('node:assert/strict');

function queriesFor(files) {
  const seen = new Set();
  const queries = [];
  for (const file of files) {
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(lock.packages, `Lockfile sem packages: ${file}`);
    for (const [location, entry] of Object.entries(lock.packages)) {
      if (!location || entry.link) continue;
      assert.ok(entry.version, `Dependência sem versão: ${location}`);
      const name = entry.name || location.split('node_modules/').pop();
      const id = `${name}@${entry.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      queries.push({ package: { name, ecosystem: 'npm' }, version: entry.version });
    }
  }
  assert.ok(queries.length, 'Nenhuma dependência foi conferida.');
  return queries;
}
async function osv(route, body) {
  const response = await fetch(`https://api.osv.dev/v1/${route}`, {
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Consulta OSV indisponível (HTTP ${response.status}).`);
  return response.json();
}
async function audit(files) {
  const queries = queriesFor(files);
  const findings = new Map();
  let pending = queries;
  let rounds = 0;
  while (pending.length) {
    if (++rounds > 20) throw new Error('Paginação OSV incompleta.');
    const next = [];
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100);
      const result = await osv('querybatch', { queries: batch });
      assert.equal(result.results?.length, batch.length, 'Resposta OSV incompleta.');
      result.results.forEach((entry, index) => {
        assert.ok(entry && typeof entry === 'object', 'Resposta OSV inválida.');
        for (const advisory of entry.vulns || []) {
          assert.match(advisory.id, /^[A-Za-z0-9_.-]+$/);
          const packages = findings.get(advisory.id) || new Set();
          packages.add(`${batch[index].package.name}@${batch[index].version}`);
          findings.set(advisory.id, packages);
        }
        if (entry.next_page_token) next.push({ ...batch[index], page_token: entry.next_page_token });
      });
    }
    pending = next;
  }
  const blocking = [];
  for (const [id, packages] of findings) {
    const advisory = await osv(`vulns/${encodeURIComponent(id)}`);
    assert.equal(advisory.id, id, 'Aviso OSV divergente.');
    if (advisory.withdrawn) continue;
    const severity = String(advisory.database_specific?.severity || 'UNKNOWN').toUpperCase();
    const finding = { id, severity, packages: [...packages], summary: advisory.summary || '' };
    console.log(JSON.stringify(finding));
    // Unknown severity fails closed; only explicitly LOW findings are nonblocking.
    if (severity !== 'LOW') blocking.push(finding);
  }
  console.log(`OSV: ${queries.length} versões verificadas; ${blocking.length} avisos moderados/altos/críticos ou sem gravidade definida.`);
  if (blocking.length) throw new Error('Publicação bloqueada por avisos de segurança de dependências.');
}
if (require.main === module) {
  const files = process.argv.slice(2);
  audit(files.length ? files : ['package-lock.json', 'mobile/package-lock.json', 'deploy/shardcloud/package-lock.json'])
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { queriesFor, audit };
