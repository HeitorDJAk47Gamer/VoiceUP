const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  if (!match) throw new Error('Versão do VoiceUP inválida.');
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4] ? match[4].split('.') : []
  };
}

function compareIdentifier(left, right) {
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
  if (leftNumber !== null && rightNumber !== null) return Math.sign(leftNumber - rightNumber);
  if (leftNumber !== null) return -1;
  if (rightNumber !== null) return 1;
  return left === right ? 0 : left.localeCompare(right, 'en');
}

export function compareVoiceUpVersions(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) return Math.sign(left.core[index] - right.core[index]);
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    const result = compareIdentifier(left.prerelease[index], right.prerelease[index]);
    if (result) return result;
  }
  return 0;
}

export function androidUpdateFromPayload(payload, currentVersion) {
  const artifact = payload?.artifacts?.find((file) => file?.product === 'client' && file?.platform === 'android' && file?.arch === 'universal');
  if (!artifact) throw new Error('O catálogo oficial não contém um APK Android.');
  const available = compareVoiceUpVersions(payload.version, currentVersion) > 0;
  return {
    available,
    version: payload.version,
    fileName: artifact.name,
    sha256: artifact.sha256,
    size: artifact.size
  };
}
