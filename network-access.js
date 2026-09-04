const os = require('node:os');
const net = require('node:net');
const fs = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const VIRTUAL_INTERFACE = /radmin|virtualbox|vmware|hyper-v|vethernet|docker|veth|virbr|br-|tailscale|hamachi|zerotier|loopback|teredo|tunnel|tun\d|tap\d|wg\d/i;

function localNetworkUrls(port) {
  const addresses = [];
  for (const [interfaceName, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (!entry || entry.internal || entry.family !== 'IPv4') continue;
      const scope = addressScope(entry.address);
      const virtual = VIRTUAL_INTERFACE.test(interfaceName);
      const scopeRank = scope === 'private' ? 0 : scope === 'carrier-nat' ? 1 : 2;
      addresses.push({ url: `http://${entry.address}:${port}`, rank: scopeRank + (virtual ? 10 : 0), interfaceName });
    }
  }
  return [...new Map(addresses.sort((left, right) => left.rank - right.rank || left.interfaceName.localeCompare(right.interfaceName)).map((entry) => [entry.url, entry])).values()].map((entry) => entry.url);
}

function addressScope(address) {
  const value = String(address || '').trim().toLowerCase().split('%')[0];
  if (net.isIP(value) !== 4) return 'unknown';
  const [a, b] = value.split('.').map(Number);
  if (a === 100 && b >= 64 && b <= 127) return 'carrier-nat';
  if (a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  return 'public';
}

async function windowsDefaultIpv4Route() {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync('route.exe', ['print', '-4'], { windowsHide: true, timeout: 3500, encoding: 'utf8' });
    const interfaces = os.networkInterfaces();
    const namesByAddress = new Map();
    for (const [name, entries] of Object.entries(interfaces)) for (const entry of entries || []) if (entry.family === 'IPv4') namesByAddress.set(entry.address, name);
    const routes = [];
    for (const line of String(stdout || '').split(/\r?\n/)) {
      const match = /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+(?:\.\d+){3})\s+(\d+(?:\.\d+){3})\s+(\d+)\s*$/.exec(line);
      if (!match) continue;
      const interfaceName = namesByAddress.get(match[2]) || '';
      routes.push({ gateway: match[1], internalHost: match[2], metric: Number(match[3]) || 99999, virtual: VIRTUAL_INTERFACE.test(interfaceName) });
    }
    routes.sort((left, right) => Number(left.virtual) - Number(right.virtual) || left.metric - right.metric);
    return routes[0] || null;
  } catch { return null; }
}

function parseLinuxRouteTable(routeTable, interfaces = os.networkInterfaces()) {
  try {
    const routes = String(routeTable || '').split(/\r?\n/).slice(1).flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 8 || columns[1] !== '00000000' || columns[7] !== '00000000') return [];
      const flags = Number.parseInt(columns[3], 16);
      if (!Number.isFinite(flags) || (flags & 0x2) === 0 || !/^[a-f0-9]{8}$/i.test(columns[2])) return [];
      const gateway = columns[2].match(/../g).reverse().map((part) => Number.parseInt(part, 16)).join('.');
      const internalHost = (interfaces[columns[0]] || []).find((entry) => entry.family === 'IPv4' && !entry.internal)?.address || '';
      if (!internalHost || net.isIP(gateway) !== 4) return [];
      return [{ gateway, internalHost, metric: Number(columns[6]) || 99999, virtual: VIRTUAL_INTERFACE.test(columns[0]) }];
    });
    routes.sort((left, right) => Number(left.virtual) - Number(right.virtual) || left.metric - right.metric);
    return routes[0] || null;
  } catch { return null; }
}

function linuxDefaultIpv4Route() {
  if (process.platform !== 'linux') return null;
  try { return parseLinuxRouteTable(fs.readFileSync('/proc/net/route', 'utf8')); }
  catch { return null; }
}

async function defaultIpv4Route() {
  if (process.platform === 'win32') return windowsDefaultIpv4Route();
  if (process.platform === 'linux') return linuxDefaultIpv4Route();
  return null;
}

function mappedResult(base, mapping, method, close) {
  const scope = addressScope(mapping.externalHost);
  return {
    ...base, method,
    status: scope === 'public' ? 'mapped' : 'mapped-private-wan', mapped: true,
    externalHost: mapping.externalHost, externalPort: mapping.externalPort,
    publicUrl: `http://${mapping.externalHost}:${mapping.externalPort}`, scope,
    message: scope === 'public'
      ? `Acesso público automático ativo por ${method === 'nat-pmp' ? 'NAT-PMP' : 'UPnP'}.`
      : 'A porta foi aberta no roteador, mas a operadora parece usar CGNAT ou duplo NAT.',
    close
  };
}

async function openPublicPort(port, options = {}) {
  const requestedPort = Math.round(Number(port) || 0);
  const internalPort = Math.max(1, Math.min(65535, requestedPort));
  const result = {
    status: 'checking', mapped: false, method: 'upnp', internalPort,
    externalHost: '', externalPort: 0, publicUrl: '', scope: 'unknown',
    message: 'Procurando um roteador compatível com acesso automático.',
    close: async () => {}
  };
  if (requestedPort < 1 || requestedPort > 65535) return { ...result, status: 'error', message: 'Porta inválida.' };

  try {
    const { upnpNat, pmpNat } = await import('@achingbrain/nat-port-mapper');
    const attemptTimeout = Math.max(2200, Math.floor((Number(options.timeoutMs) || 8000) / 2));
    const client = upnpNat({
      ttl: 60 * 60 * 1000,
      description: String(options.description || 'VoiceUP').slice(0, 60),
      autoRefresh: true,
      refreshTimeout: 8000
    });
    try {
      const discoverySignal = AbortSignal.timeout(attemptTimeout);
      for await (const gateway of client.findGateways({ signal: discoverySignal })) {
        try {
          const mappingSignal = AbortSignal.timeout(attemptTimeout);
          for await (const mapping of gateway.mapAll(internalPort, {
            externalPort: internalPort,
            protocol: 'tcp',
            description: String(options.description || 'VoiceUP').slice(0, 60),
            signal: mappingSignal
          })) {
            return mappedResult(result, mapping, 'upnp', async () => { try { await gateway.stop(); } catch { /* already closed */ } });
          }
        } catch {
          try { await gateway.stop(); } catch { /* discovery can continue */ }
        }
      }
    } catch { /* tenta NAT-PMP quando a descoberta UPnP expira */ }
    const route = await defaultIpv4Route();
    if (route) {
      const gateway = pmpNat(route.gateway, { ttl: 60 * 60 * 1000, description: String(options.description || 'VoiceUP').slice(0, 60), autoRefresh: true });
      try {
        const mapping = await gateway.map(internalPort, route.internalHost, { externalPort: internalPort, protocol: 'tcp', description: String(options.description || 'VoiceUP').slice(0, 60), signal: AbortSignal.timeout(attemptTimeout) });
        return mappedResult(result, mapping, 'nat-pmp', async () => { try { await gateway.stop(); } catch { /* already closed */ } });
      } catch { try { await gateway.stop(); } catch { /* mapping failed */ } }
    }
    return { ...result, status: 'unavailable', method: 'upnp+nat-pmp', message: 'O roteador não ofereceu mapeamento automático por UPnP ou NAT-PMP.' };
  } catch (error) {
    const timeout = /abort|timeout/i.test(String(error?.name || error?.message || ''));
    return {
      ...result,
      status: timeout ? 'unavailable' : 'error',
      message: timeout ? 'O roteador não respondeu ao acesso automático.' : `Acesso automático indisponível: ${String(error?.message || 'erro desconhecido').slice(0, 160)}`
    };
  }
}

module.exports = { localNetworkUrls, openPublicPort, addressScope, linuxDefaultIpv4Route, parseLinuxRouteTable };
