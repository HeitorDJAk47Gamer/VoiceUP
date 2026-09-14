/* Pure channel-list helpers; no media tracks or peer connections are changed. */
((root) => {
  'use strict';
  const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
  const sortMembers = (members) => [...members].sort((left, right) =>
    collator.compare(String(left.name || ''), String(right.name || ''))
    || String(left.id || '').localeCompare(String(right.id || '')));
  const separatedRoleForMember = (member, rolesById) => {
    const roleIds = Array.isArray(member?.roleIds) ? member.roleIds : (member?.roles || []).map((role) => role?.id);
    return roleIds.map((id) => rolesById.get(String(id))).filter((role) => role?.displaySeparately === true)
      .sort((left, right) => Number(right.position || 0) - Number(left.position || 0) || collator.compare(left.name, right.name))[0] || null;
  };
  const groupMembersByRole = (members, roles = []) => {
    const rolesById = new Map((Array.isArray(roles) ? roles : []).map((role) => [String(role?.id || ''), role]).filter(([id]) => id));
    const groups = new Map(); const ungrouped = [];
    for (const member of sortMembers(members || [])) {
      const role = separatedRoleForMember(member, rolesById);
      if (!role) { ungrouped.push(member); continue; }
      if (!groups.has(role.id)) groups.set(role.id, { role, members: [] });
      groups.get(role.id).members.push(member);
    }
    return [...groups.values()].sort((left, right) => Number(right.role.position || 0) - Number(left.role.position || 0) || collator.compare(left.role.name, right.role.name))
      .concat(ungrouped.length ? [{ role: null, members: ungrouped }] : []);
  };
  const formatDuration = (milliseconds) => {
    const seconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    return `${hours ? `${hours}:` : ''}${String(hours ? minutes : Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const createActivityClock = () => {
    const starts = new Map();
    let scope;
    return {
      setScope(next) {
        if (scope !== next) { starts.clear(); scope = next; }
      },
      sync(members, packet = {}, now = Date.now()) {
        const occupied = new Set(members.map((member) => member.voiceChannel).filter((channel) => channel && channel !== '__lobby__'));
        const authoritative = new Map((Array.isArray(packet.voiceActivity) ? packet.voiceActivity : []).map((entry) => [entry.voiceChannel, entry.startedAt]));
        for (const channel of starts.keys()) if (!occupied.has(channel)) starts.delete(channel);
        for (const channel of occupied) {
          const remoteStart = Number(authoritative.get(channel));
          const serverTime = Number(packet.serverTime);
          if (Number.isFinite(remoteStart) && remoteStart > 0 && Number.isFinite(serverTime) && serverTime >= remoteStart) {
            // Convert the host's clock to a local elapsed duration, even if the
            // two computers have different wall-clock settings.
            starts.set(channel, { at: now - (serverTime - remoteStart), authoritative: true });
          } else if (!starts.has(channel)) {
            // Older hosts do not send timestamps. Keep the observed duration
            // without requiring anyone to upgrade or reconnect.
            starts.set(channel, { at: now, authoritative: false });
          }
        }
      },
      get(channel, now = Date.now()) {
        const start = starts.get(channel);
        return start ? { elapsed: Math.max(0, now - start.at), authoritative: start.authoritative } : null;
      }
    };
  };
  const api = { sortMembers, separatedRoleForMember, groupMembersByRole, formatDuration, createActivityClock };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.voiceupChannelRoster = api;
})(globalThis);
