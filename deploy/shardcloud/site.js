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
  const updateLinuxRelease = async () => {
    const status = document.querySelector('[data-linux-status]');
    try {
      const response = await fetch('/api/linux-release', { cache: 'no-store' });
      if (!response.ok) throw new Error('linux-release');
      const release = await response.json();
      if (!release.available) throw new Error('linux-unavailable');
      for (const [kind, url] of [['linux', release.clientUrl], ['linux-server', release.serverUrl], ['linux-checksums', release.checksumsUrl]]) {
        if (typeof url !== 'string' || !url.startsWith('/downloads/linux/')) throw new Error('linux-url');
        document.querySelectorAll(`[data-download="${kind}"]`).forEach((link) => { link.href = url; link.removeAttribute('aria-disabled'); });
      }
      if (status) status.textContent = 'Pacotes AppImage disponíveis. DEB também disponível na Release.';
    } catch {
      document.querySelectorAll('[data-download^="linux"]').forEach((link) => { link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true'); });
      if (status) status.textContent = 'Os pacotes Linux ainda não estão disponíveis nesta hospedagem. Tente novamente mais tarde.';
    }
  };
  const updateMobileRelease = async () => {
    try {
      const response = await fetch('/api/mobile-release');
      if (!response.ok) throw new Error('mobile-release');
      const release = await response.json();
      document.querySelectorAll('[data-mobile-version]').forEach((element) => { element.textContent = release.version || 'mais recente'; });
      document.querySelectorAll('[data-download="android"]').forEach((link) => { link.href = release.downloadUrl || '/downloads/android'; });
    } catch {
      document.querySelectorAll('[data-download="android"]').forEach((link) => { link.href = '/downloads/android'; });
    }
  };
  document.getElementById('copy-cloud')?.addEventListener('click', async (event) => {
    try { await navigator.clipboard.writeText('https://voiceup.shardweb.app'); event.currentTarget.textContent = 'Endereço copiado'; }
    catch { event.currentTarget.textContent = 'Copie: voiceup.shardweb.app'; }
  });
  const requirements = document.querySelector('.requirements');
  const requirementTabs = [...document.querySelectorAll('[data-requirement-tab]')];
  const requirementPanels = [...document.querySelectorAll('[data-requirement-panel]')];
  const activateRequirementTab = (platform, focus = false) => {
    requirementTabs.forEach((tab) => {
      const active = tab.dataset.requirementTab === platform;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    requirementPanels.forEach((panel) => { panel.hidden = panel.dataset.requirementPanel !== platform; });
    if (requirements) requirements.dataset.platform = platform;
  };
  requirementTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateRequirementTab(tab.dataset.requirementTab));
    tab.addEventListener('keydown', (event) => {
      let next = index;
      if (event.key === 'ArrowRight') next = (index + 1) % requirementTabs.length;
      else if (event.key === 'ArrowLeft') next = (index - 1 + requirementTabs.length) % requirementTabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = requirementTabs.length - 1;
      else return;
      event.preventDefault();
      activateRequirementTab(requirementTabs[next].dataset.requirementTab, true);
    });
  });
  updateStatus();
  updateRelease();
  updateMobileRelease();
  updateLinuxRelease();
  window.setInterval(updateStatus, 10000);
})();
