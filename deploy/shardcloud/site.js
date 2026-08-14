(() => {
  const releaseFallback = 'https://github.com/HeitorDJAk47Gamer/VoiceUP/releases/latest';
  const formatUptime = (seconds) => {
    const value = Math.max(0, Number(seconds || 0));
    const days = Math.floor(value / 86400);
    const hours = Math.floor(value % 86400 / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  };
  const updateStatus = async () => {
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      if (!response.ok) throw new Error('offline');
      const data = await response.json();
      document.querySelectorAll('[data-status-field]').forEach((element) => {
        const field = element.dataset.statusField;
        element.textContent = field === 'uptimeSeconds' ? formatUptime(data[field]) : String(data[field] ?? '—');
      });
      document.querySelectorAll('[data-status-state]').forEach((element) => { element.textContent = 'Todos os sistemas operacionais'; });
      document.querySelectorAll('.live-dot[data-dynamic],#cloud-dot').forEach((element) => element.classList.remove('offline'));
      const cloudState = document.getElementById('cloud-state');
      if (cloudState) cloudState.textContent = 'Cloud operacional';
      document.body.dataset.cloudStatus = 'online';
    } catch {
      document.querySelectorAll('.live-dot[data-dynamic],#cloud-dot').forEach((element) => element.classList.add('offline'));
      document.querySelectorAll('[data-status-state]').forEach((element) => { element.textContent = 'Cloud temporariamente indisponível'; });
      const cloudState = document.getElementById('cloud-state');
      if (cloudState) cloudState.textContent = 'Cloud indisponível';
      document.body.dataset.cloudStatus = 'offline';
    }
  };
  const updateRelease = async () => {
    try {
      const response = await fetch('/api/release');
      if (!response.ok) throw new Error('release');
      const release = await response.json();
      const version = release.version || 'mais recente';
      document.querySelectorAll('[data-latest-version]').forEach((element) => { element.textContent = version; });
      document.querySelectorAll('[data-download="client"]').forEach((link) => { link.href = release.clientUrl || release.pageUrl || releaseFallback; });
      document.querySelectorAll('[data-download="server"]').forEach((link) => { link.href = release.serverUrl || release.pageUrl || releaseFallback; });
    } catch {
      document.querySelectorAll('[data-latest-version]').forEach((element) => { if (element.textContent.includes('consultando')) element.textContent = 'mais recente'; });
    }
  };
  document.getElementById('copy-cloud')?.addEventListener('click', async (event) => {
    try { await navigator.clipboard.writeText('https://voiceup.shardweb.app'); event.currentTarget.textContent = 'Endereço copiado'; }
    catch { event.currentTarget.textContent = 'Copie: voiceup.shardweb.app'; }
  });
  updateStatus();
  updateRelease();
  window.setInterval(updateStatus, 10000);
})();
