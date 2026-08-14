const ICON = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#68e1ad"/><path d="M18 14h28v11c0 11-6 20-14 24-8-4-14-13-14-24z" fill="#163a2d" stroke="#eafff5" stroke-width="3"/><path d="M23 23l7 7-7 10h7l3-6 4 6h7l-8-10 7-7h-7l-3 4-3-4z" fill="#eafff5"/></svg>').toString('base64')}`;
const roomKey = (room) => `room:${String(room || '').slice(0, 48)}`;
const totalForLevel = (level, base) => Math.max(1, level) * base;

function profilesFor(api, room) {
  const all = api.storage.get('rankings', {});
  const key = roomKey(room);
  if (!all[key] || typeof all[key] !== 'object') all[key] = {};
  return { all, key, profiles: all[key] };
}
function saveProfiles(api, all) { api.storage.set('rankings', all); }
function normalize(profile = {}, name = 'Visitante') {
  return { name: String(profile.name || name).slice(0, 24), xp: Math.max(0, Math.round(Number(profile.xp) || 0)), level: Math.max(1, Math.round(Number(profile.level) || 1)), totalXp: Math.max(0, Math.round(Number(profile.totalXp ?? profile.xp) || 0)), lastMessageAt: Math.max(0, Number(profile.lastMessageAt) || 0) };
}
function topFive(profiles) { return Object.entries(profiles).map(([id, value]) => ({ id, ...normalize(value) })).sort((a, b) => b.totalXp - a.totalXp || b.level - a.level || a.name.localeCompare(b.name, 'pt-BR')).slice(0, 5); }

module.exports = {
  id: 'xp-chat',
  name: 'XP de chat',
  version: 'beta.2',
  icon: ICON,
  description: 'Contabiliza XP persistente, mostra !xp e o ranking !rank com o Top 5.',
  settings: [
    { key: 'baseGain', label: 'XP base por mensagem', description: 'Pontos mínimos recebidos por uma mensagem válida.', type: 'number', default: 5, min: 0, max: 1000 },
    { key: 'lengthBonus', label: 'Bônus por 40 caracteres', description: 'XP adicional para mensagens maiores.', type: 'number', default: 1, min: 0, max: 100 },
    { key: 'maxGain', label: 'Máximo de XP por mensagem', description: 'Teto do ganho depois dos bônus.', type: 'number', default: 20, min: 1, max: 5000 },
    { key: 'cooldownSeconds', label: 'Intervalo entre ganhos', description: 'Tempo mínimo entre duas mensagens que concedem XP.', type: 'number', default: 30, min: 0, max: 3600 },
    { key: 'levelBase', label: 'XP base para subir de nível', description: 'O custo é este valor multiplicado pelo nível atual.', type: 'number', default: 100, min: 10, max: 100000 }
  ],

  onTextMessage({ text, room, textChannel, user, api, plugin }) {
    const { all, key, profiles } = profilesFor(api, room);
    const identity = String(user.clientId || user.id || user.name).slice(0, 80);
    const profile = normalize(profiles[identity], user.name);
    profile.name = String(user.name || profile.name).slice(0, 24);
    const command = String(text).trim().toLowerCase();
    const say = (message) => api.systemMessage(room, textChannel, message, { name: 'XP de Chat', color: '#68e1ad', avatar: ICON, pluginId: plugin.id });
    if (command === '!xp') {
      profiles[identity] = profile; all[key] = profiles; saveProfiles(api, all);
      const rank = Object.values(profiles).map(normalize).filter((item) => item.totalXp > profile.totalXp).length + 1;
      return say(`⭐ ${profile.name}: nível ${profile.level} — ${profile.xp}/${totalForLevel(profile.level, api.settings.levelBase)} XP · total ${profile.totalXp} · posição #${rank}.`);
    }
    if (['!rank', '!ranking', '!top'].includes(command)) {
      profiles[identity] = profile; all[key] = profiles; saveProfiles(api, all);
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const top = topFive(profiles);
      return say(top.length ? `Ranking Top 5: ${top.map((item, index) => `${medals[index]} ${item.name} — ${item.totalXp} XP (Nv. ${item.level})`).join(' | ')}` : 'O ranking ainda está vazio.');
    }
    const clean = String(text).trim();
    if (command.startsWith('!') || clean.length < 3 || Date.now() - profile.lastMessageAt < api.settings.cooldownSeconds * 1000) return;
    const gained = Math.min(api.settings.maxGain, api.settings.baseGain + Math.floor(clean.length / 40) * api.settings.lengthBonus);
    if (gained <= 0) return;
    profile.xp += gained; profile.totalXp += gained; profile.lastMessageAt = Date.now();
    let leveledUp = false;
    while (profile.xp >= totalForLevel(profile.level, api.settings.levelBase)) { profile.xp -= totalForLevel(profile.level, api.settings.levelBase); profile.level += 1; leveledUp = true; }
    profiles[identity] = profile; all[key] = profiles; saveProfiles(api, all);
    if (leveledUp) say(`⭐ ${profile.name} chegou ao nível ${profile.level}!`);
  },

  getAdminState({ api }) {
    const rankings = api.storage.get('rankings', {});
    const users = [];
    for (const [room, profiles] of Object.entries(rankings)) for (const [id, value] of Object.entries(profiles || {})) users.push({ room: room.replace(/^room:/, ''), id, ...normalize(value) });
    users.sort((a, b) => b.totalXp - a.totalXp);
    return { type: 'xp-ranking', users: users.slice(0, 100) };
  },

  onAdminAction({ action, payload, api }) {
    if (action !== 'set-xp') return { ok: false, message: 'Ação desconhecida.' };
    const rankings = api.storage.get('rankings', {}); const key = roomKey(payload.room); const profiles = rankings[key] || {};
    if (!profiles[payload.id]) return { ok: false, message: 'Participante não encontrado no ranking.' };
    const profile = normalize(profiles[payload.id]); const nextTotal = Math.max(0, Math.round(Number(payload.totalXp) || 0));
    profile.totalXp = nextTotal; profile.level = 1; profile.xp = nextTotal;
    while (profile.xp >= totalForLevel(profile.level, api.settings.levelBase)) { profile.xp -= totalForLevel(profile.level, api.settings.levelBase); profile.level += 1; }
    profiles[payload.id] = profile; rankings[key] = profiles; api.storage.set('rankings', rankings);
    return { ok: true, message: `Pontuação de ${profile.name} alterada para ${nextTotal} XP.` };
  }
};
