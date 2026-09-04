export const REACTION_CHOICES = ['👍', '❤️', '😂', '🎉', '😮', '😢'];

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const INLINE_PATTERN = /(https?:\/\/[^\s<>"']+|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/gi;

export function clampVolume(value, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : fallback;
}

export function formatCallDuration(startedAt, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((Number(now) - Number(startedAt)) / 1000));
  if (!Number.isFinite(seconds) || !Number(startedAt)) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function pingQuality(value) {
  const ping = Number(value);
  if (!Number.isFinite(ping) || ping < 0) return 'unknown';
  if (ping <= 80) return 'good';
  if (ping <= 180) return 'medium';
  return 'poor';
}

export function membersForVoiceChannel(members = [], channel = '') {
  return members
    .filter((member) => String(member?.voiceChannel || '') === String(channel || ''))
    .sort((left, right) => String(left?.name || '').localeCompare(String(right?.name || ''), 'pt-BR', { sensitivity: 'base' }));
}

export function getOrCreateClientId(storage = globalThis.localStorage) {
  const key = 'voiceup-mobile-client-id-v1';
  try {
    const existing = String(storage?.getItem(key) || '').trim();
    if (/^[a-zA-Z0-9_-]{8,80}$/.test(existing)) return existing;
    const random = globalThis.crypto?.randomUUID?.()
      || `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    storage?.setItem(key, random);
    return random;
  } catch {
    return `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
  }
}

export function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function mentionIdsForText(text, members = []) {
  const source = String(text || '').toLocaleLowerCase('pt-BR');
  return [...new Set(members
    .filter((member) => member?.id && member?.name)
    .filter((member) => {
      const name = String(member.name).trim().toLocaleLowerCase('pt-BR');
      if (!name) return false;
      const marker = `@${name}`;
      let start = source.indexOf(marker);
      while (start >= 0) {
        const end = start + marker.length;
        const before = start === 0 ? '' : source[start - 1];
        const after = end >= source.length ? '' : source[end];
        if ((!before || /\s|[([{,.;:!?]/.test(before)) && (!after || /\s|[\])},.;:!?]/.test(after))) return true;
        start = source.indexOf(marker, start + marker.length);
      }
      return false;
    })
    .map((member) => String(member.id)))];
}

export function isOwnMessage(message, socketId, clientId) {
  return Boolean(message && (
    (socketId && String(message.from || '') === String(socketId))
    || (clientId && String(message.authorClientId || '') === String(clientId))
  ));
}

export function isMessageMention(message, socketId, clientId) {
  const socketMentions = Array.isArray(message?.mentions) ? message.mentions.map(String) : [];
  const stableMentions = Array.isArray(message?.mentionClientIds) ? message.mentionClientIds.map(String) : [];
  return Boolean((socketId && socketMentions.includes(String(socketId))) || (clientId && stableMentions.includes(String(clientId))));
}

export function tokenizeInline(text) {
  const source = String(text || '');
  const tokens = [];
  let cursor = 0;
  for (const match of source.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ type: 'text', value: source.slice(cursor, index) });
    const raw = match[0];
    if (/^https?:\/\//i.test(raw)) {
      const trailing = raw.match(/[),.!?;:]+$/)?.[0] || '';
      const candidate = trailing ? raw.slice(0, -trailing.length) : raw;
      const url = safeHttpUrl(candidate);
      tokens.push(url ? { type: 'link', value: candidate, url } : { type: 'text', value: raw });
      if (trailing) tokens.push({ type: 'text', value: trailing });
    } else if (raw.startsWith('`')) tokens.push({ type: 'code', value: raw.slice(1, -1) });
    else if (raw.startsWith('**') || raw.startsWith('__')) tokens.push({ type: 'strong', value: raw.slice(2, -2) });
    else tokens.push({ type: 'em', value: raw.slice(1, -1) });
    cursor = index + raw.length;
  }
  if (cursor < source.length) tokens.push({ type: 'text', value: source.slice(cursor) });
  return tokens.length ? tokens : [{ type: 'text', value: source }];
}

export function embedForText(text) {
  const match = String(text || '').match(URL_PATTERN);
  const href = safeHttpUrl(match?.[0]);
  if (!href) return null;
  const url = new URL(href);
  if (/\.(?:gif|png|jpe?g|webp|avif|bmp)(?=(?:[/?#]|$))/i.test(`${url.pathname}${url.search}`)) {
    return { type: 'image', href };
  }
  const youtubeId = url.hostname === 'youtu.be'
    ? url.pathname.slice(1).split('/')[0]
    : /(^|\.)youtube\.com$/i.test(url.hostname) ? url.searchParams.get('v') : '';
  if (/^[a-zA-Z0-9_-]{6,20}$/.test(youtubeId || '')) {
    return { type: 'youtube', href, image: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` };
  }
  return null;
}

export function replySnapshot(message) {
  if (!message) return null;
  return {
    messageId: String(message.messageId || '').slice(0, 120),
    name: String(message.name || 'Participante').slice(0, 24),
    text: String(message.text || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  };
}
