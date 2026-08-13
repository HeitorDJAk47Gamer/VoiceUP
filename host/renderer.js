(() => {
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? '').replace(/[&<>'"]/g, (letter) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[letter]));
  const history = [];
  const reportError = (value) => { $('host-control-message').textContent = String(value || 'Falha ao comunicar com o processo do Server Host.'); };
  const formatTime = (seconds) => { const minutes = Math.floor(Number(seconds || 0) / 60); const rest = Number(seconds || 0) % 60; return minutes ? `${minutes}m ${rest}s` : `${rest}s`; };

  function drawChart() {
    const canvas = $('chart'); const context = canvas?.getContext('2d'); if (!context) return;
    const width = canvas.clientWidth; const height = canvas.clientHeight; if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1; canvas.width = width * ratio; canvas.height = height * ratio; context.scale(ratio, ratio); context.clearRect(0, 0, width, height);
    const key = $('metric-select').value; const values = history.map((item) => Number(item[key] || 0)); const max = Math.max(1, ...values);
    context.strokeStyle = '#31405b'; for (let index = 1; index < 4; index += 1) { const y = height * index / 4; context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
    if (values.length < 2) return;
    context.strokeStyle = '#56e2cf'; context.lineWidth = 2; context.beginPath(); values.forEach((value, index) => { const x = index * width / (values.length - 1); const y = height - 12 - (value / max) * (height - 24); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.stroke();
  }

  function renderMembers(stats) {
    const members = Array.isArray(stats.members) ? stats.members : [];
    $('member-count').textContent = `${members.length} conectado${members.length === 1 ? '' : 's'}`;
    $('member-list').innerHTML = members.length ? members.map((member) => `<div class="member"><i class="color-dot" style="background:${escape(member.color || '#56e2cf')}"></i><span class="member-info"><b>${escape(member.name || 'Visitante')}</b><br><small>${escape(member.room || 'sem sala')} · ${escape(member.voiceChannel || 'sem canal')} · ${Number(member.connectedSeconds || 0)}s</small></span>${member.isBot ? '<small>Bot</small>' : `<button class="button danger" data-moderate="kick" data-member="${escape(member.id)}">Expulsar</button><button class="button ban" data-moderate="ban" data-member="${escape(member.id)}">Banir</button>`}</div>`).join('') : '<span>Nenhum participante conectado.</span>';
    const bans = Array.isArray(stats.bans) ? stats.bans : [];
    $('ban-list').innerHTML = bans.length ? bans.map((ban) => `<div class="member"><span class="member-info"><b>${escape(ban.name || 'Visitante')}</b><br><small>${escape(ban.bannedAt || '')}</small></span><button class="button unban" data-unban="${escape(ban.clientId)}">Remover ban</button></div>`).join('') : '<span>Nenhum banimento.</span>';
    document.querySelectorAll('[data-moderate]').forEach((button) => { button.onclick = async () => { const action = button.dataset.moderate; if (!window.confirm(`${action === 'ban' ? 'Banir' : 'Expulsar'} este participante?`)) return; button.disabled = true; const result = await window.voiceupServer.moderate(action, button.dataset.member); reportError(result.message); button.disabled = false; refresh(); }; });
    document.querySelectorAll('[data-unban]').forEach((button) => { button.onclick = async () => { button.disabled = true; const result = await window.voiceupServer.unban(button.dataset.unban); reportError(result.message); button.disabled = false; refresh(); }; });
  }

  function renderPlugins(stats) {
    const plugins = Array.isArray(stats.plugins) ? stats.plugins : [];
    $('plugin-list').innerHTML = plugins.length ? plugins.map((plugin) => `<div><b style="color:#56e2cf">${escape(plugin.name)}</b> <span style="color:#99a6bc">${escape(plugin.version)}</span><br><span>${escape(plugin.description || plugin.id)}</span></div>`).join('') : '<span>Nenhum plugin carregado. Use Recarregar plugins após copiar arquivos .js.</span>';
    const errors = Array.isArray(stats.pluginErrors) ? stats.pluginErrors : [];
    $('plugin-errors').textContent = errors.length ? `Erros de plugin: ${errors.join(' | ')}` : '';
  }

  function render(stats) {
    ['participants', 'rooms', 'signals'].forEach((key) => { $(key).textContent = Number(stats[key] || 0); });
    $('ping').textContent = stats.averagePing == null ? '—' : `${stats.averagePing} ms`; $('cpu').textContent = `${stats.cpuPercent || 0}%`; $('memory').textContent = `${stats.memoryMb || 0} MB`; $('heap').textContent = `${stats.heapMb || 0} MB`; $('uptime').textContent = formatTime(stats.uptimeSeconds);
    $('host-state').innerHTML = `<span class="dot" style="background:${stats.online ? '#56e2cf' : '#ff8b72'}"></span>${stats.online ? 'Online · porta 3000' : 'Desligado'}`;
    $('logs').innerHTML = (stats.logs || []).map((log) => `<div class="log"><time>${escape(log.time)}</time><b>${escape(log.level).toUpperCase()}</b><span>${escape(log.message)}</span></div>`).join('') || '<span>Nenhum evento ainda.</span>';
    renderMembers(stats); renderPlugins(stats); history.push(stats); if (history.length > 60) history.shift(); drawChart();
  }

  async function refresh() {
    try { render(await window.voiceupServer.stats()); }
    catch (error) { reportError(`Falha ao atualizar o painel: ${error.message || 'ponte indisponível'}`); }
  }

  async function boot() {
    if (!window.voiceupServer) { reportError('Falha interna: a ponte do Server Host não foi carregada. Reinstale esta versão.'); return; }
    try {
      const info = await window.voiceupServer.info();
      $('urls').innerHTML = (info.urls?.length ? info.urls : ['http://localhost:3000']).map((url) => `<div class="url">${escape(url)}</div>`).join(''); $('connection-code').textContent = info.connectionCode || '';
      $('plugin-folder').textContent = `Plugins: ${info.pluginFolder || 'indisponível'}${info.portablePluginFolder ? ` · portátil: ${info.portablePluginFolder}` : ''}`; $('music-folder').textContent = `Músicas: ${info.musicFolder || 'indisponível'}`;
      const settings = await window.voiceupServer.settings(); $('host-close-behavior').value = settings.closeBehavior || 'tray';
    } catch (error) { reportError(`Falha ao carregar informações do Server Host: ${error.message || 'erro desconhecido'}`); }
    document.querySelectorAll('[data-server-control]').forEach((button) => { button.onclick = async () => { button.disabled = true; try { const result = await window.voiceupServer.control(button.dataset.serverControl); reportError(result.message); } catch (error) { reportError(error.message); } button.disabled = false; refresh(); }; });
    $('reload-plugins').onclick = async () => { if (!window.confirm('Recarregar plugins reinicia o servidor e desconecta as pessoas da sala. Continuar?')) return; $('reload-plugins').disabled = true; try { const result = await window.voiceupServer.control('reload-plugins'); reportError(result.message); } catch (error) { reportError(error.message); } $('reload-plugins').disabled = false; refresh(); };
    $('host-close-behavior').onchange = async () => { try { await window.voiceupServer.saveSettings({ closeBehavior: $('host-close-behavior').value }); reportError('Preferência de fechamento salva.'); } catch (error) { reportError(error.message); } };
    let pendingUpdate = null; $('check-update').onclick = async () => { const button = $('check-update'); const status = $('update-status'); if (pendingUpdate) { if (!window.confirm(`Baixar VoiceUP Server ${pendingUpdate.version}?`)) return; button.disabled = true; const result = await window.voiceupServer.downloadUpdate(); status.textContent = result.ok ? 'Instalador aberto.' : result.message; if (!result.ok) button.disabled = false; return; } button.disabled = true; status.textContent = 'Consultando GitHub...'; const result = await window.voiceupServer.checkForUpdates(); button.disabled = false; if (!result.ok) { status.textContent = result.message; return; } if (!result.available) { status.textContent = `Você já está na versão atual (${result.installedVersion}).`; return; } pendingUpdate = result; status.textContent = `A versão ${result.version} está pronta.`; button.textContent = `Baixar ${result.version}`; };
    $('metric-select').onchange = drawChart; if (window.ResizeObserver) new ResizeObserver(drawChart).observe($('chart')); await refresh(); window.setInterval(refresh, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
