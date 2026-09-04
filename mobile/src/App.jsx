import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Capacitor } from '@capacitor/core';
import { platformPresence, mergePresenceMember } from './presence-utils.js';
import '../../public/platform-presence.css';
import '../../public/release-history.js';
import {
  REACTION_CHOICES,
  clampVolume,
  embedForText,
  formatCallDuration,
  getOrCreateClientId,
  isMessageMention,
  isOwnMessage,
  membersForVoiceChannel,
  mentionIdsForText,
  pingQuality,
  replySnapshot,
  safeHttpUrl,
  tokenizeInline
} from './chat-utils.js';
import { signIdentityChallenge } from './identity-utils.js';

const LOBBY_CHANNEL = '__lobby__';
const DEFAULT_HOST = 'https://voiceup.shardweb.app';
const DEFAULT_ROOM = 'ggk';
const MOBILE_VERSION = '1.2.0';
const CLIENT_ID = getOrCreateClientId();
const CLIENT_PLATFORM = Capacitor.getPlatform() === 'android' ? 'android' : 'selfweb';
const COLORS = ['#55d6c9', '#7d8cff', '#f06aa6', '#ffbd57', '#6ee786', '#a970ff'];
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' }
];

function loadLocal(key, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '');
    return saved && typeof saved === 'object' ? { ...fallback, ...saved } : fallback;
  } catch {
    return fallback;
  }
}

function normalizeHost(value) {
  const host = String(value || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(host)) throw new Error('Use o endereço completo do ServerHost, começando com https://.');
  return host;
}

function initials(name) {
  return String(name || 'V').trim().slice(0, 1).toUpperCase() || 'V';
}

function formatTime(value) {
  try {
    return new Date(Number(value) || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function Avatar({ name, color, avatar, size = 'normal', status, platform }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ '--avatar-color': color || COLORS[0] }}>
      {avatar ? <img src={avatar} alt="" /> : <span>{initials(name)}</span>}
      {status && <span className={`platform-presence status-${platformPresence.status(status)}`} data-platform={platformPresence.normalize(platform) || 'unknown'} role="img" title={platformPresence.label(platform, status)} aria-label={platformPresence.label(platform, status)} dangerouslySetInnerHTML={{ __html: platformPresence.svg(platform) }} />}
    </span>
  );
}

function StreamVideo({ stream, muted = false, className = '' }) {
  const videoRef = useRef(null);
  useEffect(() => {
    const element = videoRef.current;
    if (!element) return undefined;
    element.srcObject = stream || null;
    if (stream) element.play().catch(() => {});
    return () => { if (element) element.srcObject = null; };
  }, [stream]);
  return <video ref={videoRef} className={className} autoPlay playsInline muted={muted} />;
}

function AudioSink({ stream, muted = false, volume = 1 }) {
  const audioRef = useRef(null);
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return undefined;
    element.srcObject = stream || null;
    if (stream) element.play().catch(() => {});
    return () => { if (element) element.srcObject = null; };
  }, [stream]);
  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    element.muted = Boolean(muted);
    element.volume = clampVolume(volume);
  }, [muted, volume]);
  return <audio ref={audioRef} autoPlay playsInline muted={muted} />;
}

function InlineMessage({ text, memberNames = [] }) {
  const names = useMemo(() => [...memberNames]
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length), [memberNames]);
  const renderText = (value, key) => {
    if (!names.length) return value;
    const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const parts = String(value).split(new RegExp(`(@(?:${escaped}))`, 'gi'));
    return parts.map((part, index) => names.some((name) => part.toLocaleLowerCase('pt-BR') === `@${name.toLocaleLowerCase('pt-BR')}`)
      ? <mark className="mention" key={`${key}-${index}`}>{part}</mark>
      : part);
  };
  return <>{tokenizeInline(text).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === 'link') return <a key={key} href={token.url} target="_blank" rel="noreferrer noopener">{token.value}</a>;
    if (token.type === 'code') return <code key={key}>{token.value}</code>;
    if (token.type === 'strong') return <strong key={key}>{renderText(token.value, key)}</strong>;
    if (token.type === 'em') return <em key={key}>{renderText(token.value, key)}</em>;
    return <span key={key}>{renderText(token.value, key)}</span>;
  })}</>;
}

function MessageEmbed({ text, autoLoad = false }) {
  const embed = embedForText(text);
  const [allowed, setAllowed] = useState(autoLoad);
  useEffect(() => { setAllowed(autoLoad); }, [autoLoad, embed?.href]);
  if (!embed) return null;
  if (!allowed) {
    return <button type="button" className="message-external-load" onClick={() => setAllowed(true)}><strong>{embed.type === 'image' ? 'Carregar imagem externa' : 'Carregar prévia externa'}</strong><small>O provedor poderá receber seu endereço IP.</small></button>;
  }
  if (embed.type === 'image') {
    return <a className="message-embed" href={embed.href} target="_blank" rel="noreferrer noopener"><img src={embed.href} alt="Mídia compartilhada" loading="lazy" decoding="async" referrerPolicy="no-referrer" /></a>;
  }
  return <a className="message-embed youtube" href={embed.href} target="_blank" rel="noreferrer noopener"><img src={embed.image} alt="Abrir vídeo no YouTube" loading="lazy" decoding="async" referrerPolicy="no-referrer" /><span>▶ Abrir vídeo</span></a>;
}

function MediaTile({ stream, label, muted = false, mirror = false, local = false, badge = '' }) {
  const openFullscreen = (event) => {
    const tile = event.currentTarget.closest('.media-tile');
    if (tile?.requestFullscreen) tile.requestFullscreen().catch(() => {});
  };
  return <article className={`media-tile ${local ? 'local' : ''}`}>
    <StreamVideo stream={stream} muted={muted} className={`tile-video ${mirror ? 'mirror' : ''}`} />
    <span>{label}</span>
    {badge && <b className="media-tile-badge">{badge}</b>}
    <button className="fullscreen-button" onClick={openFullscreen} title="Ver em tela cheia" aria-label={`Ver ${label} em tela cheia`}>⛶</button>
  </article>;
}

function PingBars({ ping }) {
  const quality = pingQuality(ping);
  if (quality === 'unknown') return null;
  return <span className={`ping-bars ${quality}`} title={`${Math.round(Number(ping))} ms`} aria-label={`Latência ${Math.round(Number(ping))} milissegundos`}><i /><i /><i /></span>;
}

function MediaBadges({ state = {} }) {
  if (!state?.screen && !state?.camera) return null;
  return <span className="member-media-badges">
    {state.screen && <span className="live-status" title="Ao vivo · compartilhando tela"><i />Ao vivo</span>}
    {state.camera && <span className="camera-status" title="Câmera ligada" aria-label="Câmera ligada"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3z" /></svg></span>}
  </span>;
}

function MessageItem({ message, mine, mentioned, memberNames, externalMediaAutoLoad, reactionOpen, onReply, onEdit, onDelete, onReact, onToggleReactions, onTogglePin }) {
  const reactions = Object.entries(message.reactions && typeof message.reactions === 'object' ? message.reactions : {})
    .filter(([, actors]) => Array.isArray(actors) && actors.length);
  return <article className={`message ${mine ? 'mine' : ''} ${mentioned ? 'mentioned' : ''} ${message.pinned ? 'pinned' : ''}`} data-message-id={message.messageId}>
    <Avatar name={message.name} color={message.color} avatar={message.avatar} size="small" />
    <div className="message-content">
      <header><strong style={{ color: message.color || 'inherit' }}>{message.name || 'Participante'}</strong>{message.pluginId && <small>bot</small>}<time>{formatTime(message.createdAt)}</time>{message.editedAt && <small>editada</small>}{message.pinned && <small className="pin-label">fixada</small>}</header>
      {message.reply && <blockquote className="message-reply"><strong>{message.reply.name || 'Participante'}</strong><span>{message.reply.text || 'Mensagem'}</span></blockquote>}
      <p><InlineMessage text={message.text} memberNames={memberNames} /></p>
      <MessageEmbed text={message.text} autoLoad={externalMediaAutoLoad} />
      {reactions.length > 0 && <div className="message-reactions">{reactions.map(([emoji, actors]) => <button type="button" key={emoji} onClick={() => onReact(message.messageId, emoji)}><span>{emoji}</span><b>{actors.length}</b></button>)}</div>}
      <div className="message-actions">
        <button type="button" onClick={() => onReply(message)}>Responder</button>
        <button type="button" onClick={() => onToggleReactions(message.messageId)}>Reagir</button>
        <button type="button" onClick={() => onTogglePin(message)}>{message.pinned ? 'Desafixar' : 'Fixar'}</button>
        {mine && <button type="button" onClick={() => onEdit(message)}>Editar</button>}
        {mine && <button type="button" className="danger-text" onClick={() => onDelete(message)}>Apagar</button>}
      </div>
      {reactionOpen && <div className="reaction-picker" role="group" aria-label="Escolher reação">{REACTION_CHOICES.map((emoji) => <button type="button" key={emoji} onClick={() => onReact(message.messageId, emoji)}>{emoji}</button>)}</div>}
    </div>
  </article>;
}

function SettingsPanel({ preferences, setPreferences, connectionState, latency, activeVoice, cameraOn, onSwitchCamera }) {
  const update = (patch) => setPreferences((current) => ({ ...current, ...patch }));
  return <section className="settings-view">
    <header><p className="eyebrow">PREFERÊNCIAS</p><h1>Ajustes do celular</h1><p>As alterações ficam salvas somente neste aparelho.</p></header>
    <div className="settings-groups">
      <section className="settings-card">
        <h2>Áudio</h2>
        <label className="range-setting"><span>Volume das vozes <b>{Math.round(clampVolume(preferences.voiceVolume) * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={clampVolume(preferences.voiceVolume)} onChange={(event) => update({ voiceVolume: Number(event.target.value) })} /></label>
        <label className="range-setting"><span>Volume das transmissões <b>{Math.round(clampVolume(preferences.streamVolume) * 100)}%</b></span><input type="range" min="0" max="1" step="0.05" value={clampVolume(preferences.streamVolume)} onChange={(event) => update({ streamVolume: Number(event.target.value) })} /></label>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.echoCancellation !== false} onChange={(event) => update({ echoCancellation: event.target.checked })} /><span>Cancelamento de eco</span></label>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.noiseSuppression !== false} onChange={(event) => update({ noiseSuppression: event.target.checked })} /><span>Redução de ruído</span></label>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.autoGainControl !== false} onChange={(event) => update({ autoGainControl: event.target.checked })} /><span>Ajuste automático do microfone</span></label>
        {activeVoice && <small>Saia e entre novamente na call para reaplicar o processamento do microfone.</small>}
      </section>
      <section className="settings-card">
        <h2>Câmera e vídeo</h2>
        <label>Qualidade preferida<select value={String(preferences.videoQuality || '720')} onChange={(event) => update({ videoQuality: event.target.value })}><option value="480">480p · economiza dados</option><option value="720">720p · equilibrado</option></select></label>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.prioritizeLiveFps !== false} onChange={(event) => update({ prioritizeLiveFps: event.target.checked })} /><span>Priorizar fluidez ao transmitir tela</span></label>
        <div className="camera-choice"><span>Câmera selecionada</span><button type="button" onClick={onSwitchCamera}>{preferences.cameraFacing === 'environment' ? 'Traseira' : 'Frontal'} · trocar</button></div>
        {cameraOn && <small>A troca será aplicada imediatamente à transmissão atual.</small>}
      </section>
      <section className="settings-card">
        <h2>Notificações</h2>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.vibrateOnMessage !== false} onChange={(event) => update({ vibrateOnMessage: event.target.checked })} /><span>Vibrar ao receber mensagens</span></label>
      </section>
      <section className="settings-card">
        <h2>Privacidade</h2>
        <label className="toggle-setting"><input type="checkbox" checked={preferences.externalMediaAutoLoad === true} onChange={(event) => update({ externalMediaAutoLoad: event.target.checked })} /><span>Carregar imagens externas automaticamente</span></label>
        <small>Desativado por padrão. Você ainda poderá liberar cada imagem ou prévia no chat.</small>
      </section>
      <section className="settings-card app-about">
        <h2>Sobre</h2>
        <p><span>Versão mobile</span><strong>{MOBILE_VERSION}</strong></p>
        <details className="release-history"><summary>Novidades da 1.2.0</summary><p>{window.voiceupReleaseHistory.locales['pt-BR'].subtitle}</p><ul>{window.voiceupReleaseHistory.locales['pt-BR'].notes.map(note => <li key={note}>{note}</li>)}</ul></details>
        <p><span>Compatibilidade</span><strong>VoiceUP 1.1.2+</strong></p>
        <p><span>Conexão</span><strong>{connectionState === 'connected' ? `Online${latency !== null ? ` · ${latency} ms` : ''}` : connectionState === 'reconnecting' ? 'Reconectando' : 'Offline'}</strong></p>
      </section>
    </div>
  </section>;
}

function App() {
  const [profile, setProfile] = useState(() => loadLocal('voiceup-mobile-profile-v1', {
    name: 'Visitante', color: COLORS[0], avatar: '', status: 'online'
  }));
  const [server, setServer] = useState(() => loadLocal('voiceup-mobile-server-v1', {
    name: 'Global', host: DEFAULT_HOST, roomId: DEFAULT_ROOM, password: ''
  }));
  const [savedServers, setSavedServers] = useState(() => {
    try { return JSON.parse(localStorage.getItem('voiceup-mobile-servers-v1') || '[]') || []; } catch { return []; }
  });
  const [preferences, setPreferences] = useState(() => loadLocal('voiceup-mobile-preferences-v2', {
    outputMuted: false,
    voiceVolume: 1,
    streamVolume: .9,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    cameraFacing: 'user',
    videoQuality: '720',
    prioritizeLiveFps: true,
    externalMediaAutoLoad: false,
    vibrateOnMessage: true
  }));
  const [inServer, setInServer] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionState, setConnectionState] = useState('offline');
  const [latency, setLatency] = useState(null);
  const [notice, setNotice] = useState('');
  const [appError, setAppError] = useState('');
  const [serverProfile, setServerProfile] = useState({});
  const [roomLayout, setRoomLayout] = useState({ voiceChannels: ['Geral', 'Jogando', 'Ausente'], textChannels: ['geral', 'conversa', 'avisos'], voiceChannelSettings: [], textChannelSettings: [] });
  const [reportedMembers, setMembers] = useState([]);
  const [activeVoice, setActiveVoice] = useState('');
  const [activeText, setActiveText] = useState('geral');
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [reactionTarget, setReactionTarget] = useState('');
  const [showPinned, setShowPinned] = useState(false);
  const [unreadChannels, setUnreadChannels] = useState({});
  const [typingPeers, setTypingPeers] = useState({});
  const [tab, setTab] = useState('channels');
  const [remotePeers, setRemotePeers] = useState({});
  const [peerAudio, setPeerAudio] = useState({});
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [localLiveViewers, setLocalLiveViewers] = useState([]);
  const [clock, setClock] = useState(Date.now());

  const socketRef = useRef(null);
  const members = useMemo(() => reportedMembers.map((member) => String(member.id) === String(socketRef.current?.id)
    ? { ...member, platform: CLIENT_PLATFORM, status: profile.status }
    : member), [reportedMembers, profile.status]);
  const peersRef = useRef(new Map());
  const profileRef = useRef(profile);
  const serverRef = useRef(server);
  const preferencesRef = useRef(preferences);
  const inServerRef = useRef(inServer);
  const activeTextRef = useRef(activeText);
  const tabRef = useRef(tab);
  const connectServerRef = useRef(null);
  const audioStreamRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const localAudioTrackRef = useRef(null);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const screenAudioTrackRef = useRef(null);
  const activeVoiceRef = useRef('');
  const noticeTimerRef = useRef(null);
  const latencyTimerRef = useRef(null);
  const typingSendTimerRef = useRef(null);
  const typingPeerTimersRef = useRef(new Map());
  const messagesEndRef = useRef(null);

  useEffect(() => {
    profileRef.current = profile;
    localStorage.setItem('voiceup-mobile-profile-v1', JSON.stringify(profile));
  }, [profile]);

  useEffect(() => {
    serverRef.current = server;
    localStorage.setItem('voiceup-mobile-server-v1', JSON.stringify({ ...server, password: '' }));
  }, [server]);

  useEffect(() => {
    preferencesRef.current = preferences;
    localStorage.setItem('voiceup-mobile-preferences-v2', JSON.stringify(preferences));
  }, [preferences]);

  useEffect(() => { inServerRef.current = inServer; }, [inServer]);
  useEffect(() => { activeTextRef.current = activeText; }, [activeText]);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  useEffect(() => {
    if (!activeVoice) return undefined;
    setClock(Date.now());
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeVoice]);

  useEffect(() => () => {
    socketRef.current?.disconnect();
    peersRef.current.forEach((peer) => peer.pc?.close());
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenAudioTrackRef.current = null;
    clearInterval(latencyTimerRef.current);
    clearTimeout(typingSendTimerRef.current);
    typingPeerTimersRef.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (tab === 'chat') setUnreadChannels((current) => ({ ...current, [activeText]: 0 }));
  }, [activeText, tab]);

  useEffect(() => {
    if (tab === 'chat') messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, activeText, tab]);

  const showNotice = useCallback((message) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(message);
    noticeTimerRef.current = setTimeout(() => setNotice(''), 4200);
  }, []);

  const updatePeerView = useCallback((peer) => {
    setRemotePeers((current) => ({
      ...current,
      [peer.id]: {
        id: peer.id,
        name: peer.name,
        platform: peer.platform,
        status: peer.status,
        color: peer.color,
        avatar: peer.avatar,
        connected: Boolean(peer.connected),
        audioStream: peer.audioStream || null,
        screenAudioStream: peer.screenAudioStream || null,
        cameraStream: peer.cameraStream || null,
        screenStream: peer.screenStream || null,
        cameraActive: Boolean(peer.cameraActive),
        screenActive: Boolean(peer.screenActive),
        audioState: peer.audioState || { micMuted: false, outputMuted: false }
      }
    }));
  }, []);

  const removePeerView = useCallback((id) => {
    setRemotePeers((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const updateLocalLiveViewer = useCallback((id, viewing) => {
    const key = String(id || '');
    if (!key) return;
    setLocalLiveViewers((current) => viewing
      ? (current.includes(key) ? current : [...current, key])
      : current.filter((viewerId) => viewerId !== key));
  }, []);

  const sendLiveViewState = useCallback((peer, viewing) => {
    const next = Boolean(viewing);
    if (!peer || peer.viewingRemoteLive === next) return;
    peer.viewingRemoteLive = next;
    if (peer.channel?.readyState === 'open') {
      try { peer.channel.send(JSON.stringify({ type: 'live-view-state', viewing: next })); } catch { /* connection closing */ }
    }
  }, []);

  const closePeer = useCallback((id) => {
    const peer = peersRef.current.get(id);
    if (!peer) return;
    peer.closed = true;
    sendLiveViewState(peer, false);
    updateLocalLiveViewer(id, false);
    try { peer.channel?.close(); } catch { /* stale channel */ }
    try { peer.pc?.close(); } catch { /* stale peer */ }
    peersRef.current.delete(id);
    clearTimeout(typingPeerTimersRef.current.get(id));
    typingPeerTimersRef.current.delete(id);
    setTypingPeers((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    removePeerView(id);
  }, [removePeerView, sendLiveViewState, updateLocalLiveViewer]);

  const closeAllPeers = useCallback(() => {
    [...peersRef.current.keys()].forEach(closePeer);
  }, [closePeer]);

  const ensureAudio = useCallback(async () => {
    const current = localAudioTrackRef.current;
    if (current?.readyState === 'live') return current;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este dispositivo não disponibilizou o microfone ao aplicativo.');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: preferencesRef.current.echoCancellation !== false,
        noiseSuppression: preferencesRef.current.noiseSuppression !== false,
        autoGainControl: preferencesRef.current.autoGainControl !== false
      },
      video: false
    });
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = stream;
    localAudioTrackRef.current = stream.getAudioTracks()[0] || null;
    if (localAudioTrackRef.current) localAudioTrackRef.current.enabled = !micMuted;
    return localAudioTrackRef.current;
  }, [micMuted]);

  const setPeerTyping = useCallback((peer, packet) => {
    const id = String(peer?.id || '');
    if (!id) return;
    clearTimeout(typingPeerTimersRef.current.get(id));
    if (packet.active === false) {
      setTypingPeers((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }
    setTypingPeers((current) => ({ ...current, [id]: { name: packet.name || peer.name, textChannel: packet.textChannel || 'geral' } }));
    typingPeerTimersRef.current.set(id, setTimeout(() => {
      setTypingPeers((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      typingPeerTimersRef.current.delete(id);
    }, 3200));
  }, []);

  const bindDataChannel = useCallback((peer, channel) => {
    peer.channel = channel;
    channel.onopen = () => {
      peer.connected = true;
      updatePeerView(peer);
      try {
        channel.send(JSON.stringify({
          type: 'intro',
          name: profileRef.current.name,
          color: profileRef.current.color,
          avatar: profileRef.current.avatar,
          clientId: CLIENT_ID,
          status: profileRef.current.status,
          platform: CLIENT_PLATFORM,
          audioState: { micMuted, outputMuted: Boolean(preferencesRef.current.outputMuted) }
        }));
        if (cameraTrackRef.current?.readyState === 'live') channel.send(JSON.stringify({ type: 'video-on', description: 'camera' }));
        if (screenTrackRef.current?.readyState === 'live') channel.send(JSON.stringify({ type: 'video-on', description: 'screen' }));
        if (peer.screenActive || peer.screenStream) sendLiveViewState(peer, tabRef.current === 'call');
      } catch { /* negotiated connection may be closing */ }
    };
    channel.onclose = () => {
      if (!peer.closed) { peer.connected = false; updatePeerView(peer); }
    };
    channel.onmessage = ({ data }) => {
      try {
        const packet = JSON.parse(data);
        if (packet.type === 'intro') {
          peer.name = packet.name || peer.name;
          peer.color = packet.color || peer.color;
          peer.avatar = packet.avatar || peer.avatar;
          peer.connected = true;
          peer.audioState = packet.audioState || peer.audioState;
        }
        if (packet.type === 'intro' || packet.type === 'presence-state') {
          peer.platform = platformPresence.merge(packet.platform, peer.platform);
          if (packet.status !== undefined) peer.status = platformPresence.status(packet.status);
          setMembers((old) => old.map((member) => String(member.id) === String(peer.id) ? mergePresenceMember(member, { platform: peer.platform, status: peer.status }) : member));
        }
        if (packet.type === 'audio-state') peer.audioState = packet.audioState || peer.audioState;
        if (packet.type === 'typing') setPeerTyping(peer, packet);
        if (packet.type === 'live-view-state') updateLocalLiveViewer(peer.id, Boolean(packet.viewing));
        if (packet.type === 'video-on') {
          if (packet.description === 'screen') { peer.screenActive = true; sendLiveViewState(peer, tabRef.current === 'call'); }
          else peer.cameraActive = true;
        }
        if (packet.type === 'video-off') {
          if (packet.description === 'screen') { peer.screenActive = false; sendLiveViewState(peer, false); }
          else peer.cameraActive = false;
        }
        updatePeerView(peer);
      } catch { /* data channel payload from an older client */ }
    };
  }, [micMuted, sendLiveViewState, setPeerTyping, updateLocalLiveViewer, updatePeerView]);

  const addOfferMedia = useCallback((peer) => {
    const pc = peer.pc;
    const audioTrack = localAudioTrackRef.current?.readyState === 'live' ? localAudioTrackRef.current : null;
    const screenAudioTrack = screenAudioTrackRef.current?.readyState === 'live' ? screenAudioTrackRef.current : null;
    const cameraTrack = cameraTrackRef.current?.readyState === 'live' ? cameraTrackRef.current : null;
    const screenTrack = screenTrackRef.current?.readyState === 'live' ? screenTrackRef.current : null;
    const audioTransceiver = audioTrack
      ? pc.addTransceiver(audioTrack, { direction: 'sendrecv', streams: [new MediaStream([audioTrack])] })
      : pc.addTransceiver('audio', { direction: 'sendrecv' });
    const screenAudioTransceiver = screenAudioTrack
      ? pc.addTransceiver(screenAudioTrack, { direction: 'sendrecv', streams: [new MediaStream([screenAudioTrack])] })
      : pc.addTransceiver('audio', { direction: 'sendrecv' });
    const cameraTransceiver = cameraTrack
      ? pc.addTransceiver(cameraTrack, { direction: 'sendrecv', streams: [new MediaStream([cameraTrack])] })
      : pc.addTransceiver('video', { direction: 'sendrecv' });
    const screenTransceiver = screenTrack
      ? pc.addTransceiver(screenTrack, { direction: 'sendrecv', streams: [new MediaStream([screenTrack])] })
      : pc.addTransceiver('video', { direction: 'sendrecv' });
    peer.audioSender = audioTransceiver.sender;
    peer.screenAudioSender = screenAudioTransceiver.sender;
    peer.cameraSender = cameraTransceiver.sender;
    peer.screenSender = screenTransceiver.sender;
    peer.audioTransceiver = audioTransceiver;
    peer.screenAudioTransceiver = screenAudioTransceiver;
    peer.cameraTransceiver = cameraTransceiver;
    peer.screenTransceiver = screenTransceiver;
  }, []);

  const bindAnswerMedia = useCallback(async (peer) => {
    const transceivers = peer.pc.getTransceivers();
    const audio = transceivers.filter((item) => item.receiver?.track?.kind === 'audio');
    const video = transceivers.filter((item) => item.receiver?.track?.kind === 'video');
    [peer.audioTransceiver, peer.screenAudioTransceiver] = [audio[0], audio[1]];
    [peer.cameraTransceiver, peer.screenTransceiver] = [video[0], video[1]];
    peer.audioSender = peer.audioTransceiver?.sender || null;
    peer.screenAudioSender = peer.screenAudioTransceiver?.sender || null;
    peer.cameraSender = peer.cameraTransceiver?.sender || null;
    peer.screenSender = peer.screenTransceiver?.sender || null;
    const replacements = [];
    const audioTrack = localAudioTrackRef.current?.readyState === 'live' ? localAudioTrackRef.current : null;
    const screenAudioTrack = screenAudioTrackRef.current?.readyState === 'live' ? screenAudioTrackRef.current : null;
    const cameraTrack = cameraTrackRef.current?.readyState === 'live' ? cameraTrackRef.current : null;
    const screenTrack = screenTrackRef.current?.readyState === 'live' ? screenTrackRef.current : null;
    if (peer.audioTransceiver) {
      peer.audioTransceiver.direction = 'sendrecv';
      replacements.push(peer.audioSender.replaceTrack(audioTrack));
    }
    if (peer.screenAudioTransceiver) {
      peer.screenAudioTransceiver.direction = 'sendrecv';
      replacements.push(peer.screenAudioSender.replaceTrack(screenAudioTrack));
    }
    if (peer.cameraTransceiver) {
      peer.cameraTransceiver.direction = 'sendrecv';
      replacements.push(peer.cameraSender.replaceTrack(cameraTrack));
    }
    if (peer.screenTransceiver) {
      peer.screenTransceiver.direction = 'sendrecv';
      replacements.push(peer.screenSender.replaceTrack(screenTrack));
    }
    await Promise.allSettled(replacements);
  }, []);

  const createPeer = useCallback(async (remote, initiator) => {
    const id = String(remote?.id || '');
    if (!id || id === socketRef.current?.id) return null;
    const known = peersRef.current.get(id);
    if (known) return known;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
    const peer = {
      id,
      name: remote?.name || 'Visitante',
      color: remote?.color || COLORS[0],
      avatar: remote?.avatar || '',
      pc,
      pendingCandidates: [],
      receivedVideoCount: 0,
      connected: false,
      closed: false,
      cameraActive: false,
      screenActive: false
    };
    peersRef.current.set(id, peer);
    if (initiator) addOfferMedia(peer);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !peer.closed) socketRef.current?.emit('signal', { target: id, data: { candidate: candidate.toJSON() } });
    };
    pc.ondatachannel = ({ channel }) => bindDataChannel(peer, channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        peer.connected = true;
        updatePeerView(peer);
      }
      if (['failed', 'closed'].includes(pc.connectionState) && !peer.closed) closePeer(id);
    };
    pc.ontrack = ({ track, streams, transceiver }) => {
      const stream = streams?.[0] || new MediaStream([track]);
      if (track.kind === 'audio') {
        const audioTransceivers = pc.getTransceivers().filter((item) => item.receiver?.track?.kind === 'audio');
        const index = audioTransceivers.indexOf(transceiver);
        if (index === 1) peer.screenAudioStream = stream;
        else peer.audioStream = stream;
      } else {
        let kind = transceiver === peer.screenTransceiver ? 'screen' : transceiver === peer.cameraTransceiver ? 'camera' : '';
        if (!kind) { kind = peer.receivedVideoCount === 0 ? 'camera' : 'screen'; peer.receivedVideoCount += 1; }
        if (kind === 'screen') { peer.screenStream = stream; peer.screenActive = true; sendLiveViewState(peer, tabRef.current === 'call'); }
        else { peer.cameraStream = stream; peer.cameraActive = true; }
        track.onended = () => {
          if (kind === 'screen') { peer.screenStream = null; peer.screenActive = false; sendLiveViewState(peer, false); }
          else { peer.cameraStream = null; peer.cameraActive = false; }
          updatePeerView(peer);
        };
      }
      updatePeerView(peer);
    };
    if (initiator) {
      bindDataChannel(peer, pc.createDataChannel('voiceup-mobile'));
      await pc.setLocalDescription(await pc.createOffer());
      socketRef.current?.emit('signal', { target: id, data: { description: pc.localDescription } });
    }
    updatePeerView(peer);
    return peer;
  }, [addOfferMedia, bindAnswerMedia, bindDataChannel, closePeer, sendLiveViewState, updatePeerView]);

  const receiveSignal = useCallback(async ({ from, name, color, avatar, data }) => {
    const id = String(from || '');
    if (!id || id === socketRef.current?.id) return;
    try {
      let peer = peersRef.current.get(id);
      if (!peer) peer = await createPeer({ id, name, color, avatar }, false);
      if (!peer || peer.closed) return;
      if (data?.description) {
        await peer.pc.setRemoteDescription(data.description);
        if (data.description.type === 'offer') {
          await bindAnswerMedia(peer);
          if (peer.pendingCandidates.length) await Promise.all(peer.pendingCandidates.splice(0).map((candidate) => peer.pc.addIceCandidate(candidate)));
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          socketRef.current?.emit('signal', { target: id, data: { description: peer.pc.localDescription } });
        }
      }
      if (data?.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate);
        else peer.pendingCandidates.push(data.candidate);
      }
    } catch {
      showNotice('Não foi possível concluir uma conexão de voz com um participante.');
    }
  }, [bindAnswerMedia, createPeer, showNotice]);

  const mergeMembers = useCallback((items = []) => {
    setMembers((old) => {
      const next = new Map(old.map((item) => [String(item.id), item]));
      items.forEach((item) => {
        if (item?.id) next.set(String(item.id), mergePresenceMember(next.get(String(item.id)), item));
      });
      return [...next.values()];
    });
  }, []);

  const addMessage = useCallback((packet) => {
    if (!packet?.messageId) return;
    setMessages((old) => old.some((message) => message.messageId === packet.messageId) ? old : [...old, packet]);
    const channel = String(packet.textChannel || 'geral');
    const mine = isOwnMessage(packet, socketRef.current?.id, CLIENT_ID);
    const mentioned = isMessageMention(packet, socketRef.current?.id, CLIENT_ID);
    if (!mine && (tabRef.current !== 'chat' || activeTextRef.current.toLocaleLowerCase('pt-BR') !== channel.toLocaleLowerCase('pt-BR'))) {
      setUnreadChannels((current) => ({ ...current, [channel]: Math.min(99, Number(current[channel] || 0) + 1) }));
    }
    if (!mine && preferencesRef.current.vibrateOnMessage && navigator.vibrate) {
      navigator.vibrate(mentioned ? [80, 50, 120] : 45);
    }
  }, []);

  const connectServer = useCallback((options = {}) => {
    const preserveVoice = options?.preserveVoice === true;
    setAppError('');
    let host;
    try { host = normalizeHost(serverRef.current.host); } catch (error) { setAppError(error.message); return; }
    const name = String(profileRef.current.name || '').trim();
    const roomId = String(serverRef.current.roomId || '').trim();
    if (!name) { setAppError('Escolha um nick antes de entrar.'); return; }
    if (!roomId) { setAppError('Informe o código da sala.'); return; }
    socketRef.current?.disconnect();
    closeAllPeers();
    clearInterval(latencyTimerRef.current);
    setMembers([]); setMessages([]); setUnreadChannels({}); setConnecting(true); setConnectionState('connecting'); setTab('channels');
    if (!preserveVoice) { activeVoiceRef.current = ''; setActiveVoice(''); }
    const socket = io(host, {
      transports: ['websocket', 'polling'],
      timeout: 12000,
      reconnection: true,
      reconnectionDelay: 700,
      reconnectionDelayMax: 5000
    });
    socketRef.current = socket;
    let joinedSocketId = '';
    let legacyJoinTimer = null;
    const joinPayload = (extra = {}, protectedIdentity = false) => ({
      roomId,
      roomPassword: serverRef.current.password || '',
      voiceChannel: activeVoiceRef.current || LOBBY_CHANNEL,
      name,
      color: profileRef.current.color,
      avatar: profileRef.current.avatar,
      clientId: CLIENT_ID,
      status: profileRef.current.status,
          platform: CLIENT_PLATFORM,
      capabilities: [
        'voiceup-mobile-react', 'cluster-routing', 'advanced-channels', 'webrtc-telemetry',
        ...(protectedIdentity ? ['identity-proof-v1'] : [])
      ],
      ...extra
    });
    const emitProtectedJoin = async (challenge) => {
      const socketId = socket.id;
      if (socketRef.current !== socket || !socket.connected || !challenge || joinedSocketId === socketId) return;
      try {
        const proof = await signIdentityChallenge({ challenge, socketId, roomId, clientId: CLIENT_ID });
        if (socketRef.current !== socket || !socket.connected || socket.id !== socketId || joinedSocketId === socketId) return;
        clearTimeout(legacyJoinTimer);
        joinedSocketId = socketId;
        socket.emit('join-room', joinPayload(proof, true));
      } catch {
        if (socketRef.current === socket && socket.connected && joinedSocketId !== socket.id) {
          joinedSocketId = socket.id;
          socket.emit('join-room', joinPayload());
        }
      }
    };
    socket.on('identity-challenge', ({ challenge } = {}) => { void emitProtectedJoin(String(challenge || '')); });
    socket.on('connect', () => {
      setConnectionState('connected');
      joinedSocketId = '';
      clearTimeout(legacyJoinTimer);
      legacyJoinTimer = setTimeout(() => {
        if (socketRef.current !== socket || !socket.connected || joinedSocketId === socket.id) return;
        joinedSocketId = socket.id;
        socket.emit('join-room', joinPayload());
      }, 1200);
      socket.emit('identity-challenge-request');
      clearInterval(latencyTimerRef.current);
      const ping = () => socket.connected && socket.emit('latency-ping', { sentAt: Date.now() });
      ping();
      latencyTimerRef.current = setInterval(ping, 10000);
    });
    socket.on('color-assigned', ({ color }) => {
      if (color) setProfile((current) => ({ ...current, color }));
    });
    socket.on('room-layout', (layout = {}) => {
      const textChannels = Array.isArray(layout.textChannels) && layout.textChannels.length ? layout.textChannels : ['geral'];
      setRoomLayout({
        ...layout,
        voiceChannels: Array.isArray(layout.voiceChannels) && layout.voiceChannels.length ? layout.voiceChannels : ['Geral'],
        textChannels,
        voiceChannelSettings: Array.isArray(layout.voiceChannelSettings) ? layout.voiceChannelSettings : [],
        textChannelSettings: Array.isArray(layout.textChannelSettings) ? layout.textChannelSettings : []
      });
      setActiveText((current) => textChannels.includes(current) ? current : textChannels[0]);
    });
    socket.on('server-profile', (value = {}) => setServerProfile(value));
    socket.on('room-joined', async ({ peers = [], voiceChannel, limits, serverProfile: nextProfile } = {}) => {
      clearTimeout(legacyJoinTimer);
      const firstJoin = !inServerRef.current;
      setConnecting(false); setInServer(true);
      setConnectionState('connected');
      if (nextProfile) setServerProfile(nextProfile);
      const joinedVoice = voiceChannel && voiceChannel !== LOBBY_CHANNEL ? voiceChannel : '';
      if (joinedVoice !== activeVoiceRef.current) closeAllPeers();
      activeVoiceRef.current = joinedVoice; setActiveVoice(joinedVoice);
      mergeMembers(peers);
      socket.emit('request-room-presence');
      socket.emit('audio-state-update', { micMuted, outputMuted: Boolean(preferencesRef.current.outputMuted) });
      socket.emit('media-state-update', {
        camera: cameraTrackRef.current?.readyState === 'live',
        screen: screenTrackRef.current?.readyState === 'live'
      });
      if (joinedVoice) await Promise.allSettled(peers.map((peer) => createPeer(peer, true)));
      if (firstJoin) showNotice(limits?.total ? `Você entrou. As calls aceitam até ${limits.total} participantes.` : 'Conectado ao servidor.');
    });
    socket.on('room-presence', ({ members: list = [] } = {}) => setMembers((old) => {
      const previous = new Map(old.map((member) => [String(member.id), member]));
      return (Array.isArray(list) ? list : []).filter((member) => member?.id).map((member) => mergePresenceMember(previous.get(String(member.id)), member));
    }));
    socket.on('peer-joined', async (peer) => {
      mergeMembers([peer]);
      if (activeVoiceRef.current) await createPeer(peer, false);
    });
    socket.on('peer-left', ({ id }) => closePeer(String(id || '')));
    socket.on('signal', receiveSignal);
    socket.on('chat-history', ({ messages: history = [] } = {}) => {
      const ordered = Array.isArray(history) ? [...history].sort((left, right) => Number(left.createdAt) - Number(right.createdAt)) : [];
      setMessages(ordered);
    });
    socket.on('text-message', addMessage);
    socket.on('message-edited', (packet) => setMessages((old) => old.map((message) => message.messageId === packet.messageId ? { ...message, ...packet } : message)));
    socket.on('message-reaction', (packet) => setMessages((old) => old.map((message) => message.messageId === packet.messageId ? { ...message, reactions: packet.reactions || {} } : message)));
    socket.on('message-pinned', (packet) => setMessages((old) => old.map((message) => message.messageId === packet.messageId ? { ...message, pinned: Boolean(packet.pinned), pinnedBy: packet.pinnedBy || '' } : message)));
    socket.on('message-deleted', ({ messageId }) => setMessages((old) => old.filter((message) => message.messageId !== messageId)));
    socket.on('latency-pong', ({ sentAt } = {}) => {
      const value = Date.now() - Number(sentAt);
      if (Number.isFinite(value) && value >= 0 && value < 10000) setLatency(Math.round(value));
    });
    socket.on('server-ping', ({ sentAt } = {}) => socket.emit('server-pong', { sentAt }));
    socket.on('room-password-required', ({ message } = {}) => {
      const text = message || 'A senha desta sala está incorreta.';
      socket.disconnect(); setConnecting(false); setInServer(false); setConnectionState('offline'); setAppError(text);
    });
    socket.on('identity-proof-required', ({ message } = {}) => {
      const text = message || 'Este perfil protegido precisa ser validado por uma versão mais recente.';
      socket.disconnect(); setConnecting(false); setInServer(false); setConnectionState('offline'); setAppError(text);
    });
    socket.on('session-replaced', ({ message } = {}) => {
      if (socket.io?.opts) socket.io.opts.reconnection = false;
      closeAllPeers();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null; cameraStreamRef.current = null; screenStreamRef.current = null;
      localAudioTrackRef.current = null; cameraTrackRef.current = null; screenTrackRef.current = null; screenAudioTrackRef.current = null;
      activeVoiceRef.current = ''; setActiveVoice(''); setCameraOn(false); setScreenOn(false); setLocalLiveViewers([]);
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
      setInServer(false); setConnecting(false); setConnectionState('offline');
      setAppError(message || 'Esta conexão foi substituída por uma reconexão mais recente deste perfil.');
    });
    socket.on('server-action', ({ action, message } = {}) => {
      closeAllPeers();
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null; cameraStreamRef.current = null; screenStreamRef.current = null;
      localAudioTrackRef.current = null; cameraTrackRef.current = null; screenTrackRef.current = null;
      activeVoiceRef.current = ''; setActiveVoice(''); setCameraOn(false); setScreenOn(false);
      socket.disconnect(); socketRef.current = null;
      setInServer(false); setConnecting(false); setConnectionState('offline');
      setAppError(message || (action === 'banned' ? 'Você foi banido deste servidor.' : 'Você foi removido deste servidor.'));
    });
    socket.on('cluster-redirect', ({ url, reason } = {}) => {
      const target = safeHttpUrl(url);
      if (!target || target.replace(/\/$/, '') === host) return;
      const voiceChannel = activeVoiceRef.current;
      showNotice(reason || 'Migrando para um host disponível…');
      socket.disconnect();
      const nextServer = { ...serverRef.current, host: target.replace(/\/$/, '') };
      serverRef.current = nextServer; setServer(nextServer);
      setTimeout(() => { activeVoiceRef.current = voiceChannel; connectServerRef.current?.({ preserveVoice: true }); }, 120);
    });
    socket.on('app-error', (message) => {
      const text = String(message || 'O servidor recusou a ação.');
      if (inServerRef.current) showNotice(text); else setAppError(text);
      setConnecting(false);
    });
    socket.on('connect_error', () => {
      setConnectionState(inServerRef.current ? 'reconnecting' : 'offline');
      if (inServerRef.current) showNotice('Servidor indisponível. Tentando reconectar…');
      else setAppError('Não foi possível alcançar este servidor. Confira a URL e a rede.');
      setConnecting(false);
    });
    socket.on('disconnect', (reason) => {
      clearTimeout(legacyJoinTimer);
      clearInterval(latencyTimerRef.current);
      if (reason !== 'io client disconnect') {
        closeAllPeers();
        setConnectionState('reconnecting');
        showNotice('Conexão interrompida. Tentando reconectar…');
      }
    });
  }, [addMessage, closeAllPeers, closePeer, createPeer, mergeMembers, micMuted, receiveSignal, showNotice]);

  useEffect(() => { connectServerRef.current = connectServer; }, [connectServer]);

  const joinVoice = useCallback(async (channel) => {
    if (!socketRef.current?.connected) { showNotice('Entre no servidor antes de entrar em uma call.'); return; }
    if (channel === activeVoiceRef.current) { setTab('call'); return; }
    try {
      await ensureAudio();
      socketRef.current.emit('switch-voice-channel', { voiceChannel: channel });
      setTab('call');
    } catch (error) {
      showNotice(error.message || 'Libere o microfone para entrar na call.');
    }
  }, [ensureAudio, showNotice]);

  const leaveVoice = useCallback(() => {
    closeAllPeers();
    activeVoiceRef.current = '';
    setActiveVoice('');
    socketRef.current?.emit('switch-voice-channel', { voiceChannel: LOBBY_CHANNEL });
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current = null; localAudioTrackRef.current = null;
    cameraStreamRef.current = null; cameraTrackRef.current = null;
    screenStreamRef.current = null; screenTrackRef.current = null; screenAudioTrackRef.current = null;
    setMicMuted(false);
    setCameraOn(false); setScreenOn(false);
    socketRef.current?.emit('audio-state-update', { micMuted: false, outputMuted: Boolean(preferencesRef.current.outputMuted) });
    socketRef.current?.emit('media-state-update', { camera: false, screen: false });
    setLocalLiveViewers([]);
    showNotice('Você saiu da call.');
  }, [closeAllPeers, showNotice]);

  const disconnectServer = useCallback(() => {
    leaveVoice();
    socketRef.current?.disconnect(); socketRef.current = null;
    clearInterval(latencyTimerRef.current);
    setInServer(false); setConnecting(false); setConnectionState('offline'); setLatency(null); setMembers([]); setMessages([]); setServerProfile({});
    showNotice('Você saiu do servidor.');
  }, [leaveVoice, showNotice]);

  const broadcastAudioState = useCallback((audioState) => {
    socketRef.current?.emit('audio-state-update', audioState);
    peersRef.current.forEach((peer) => {
      if (peer.channel?.readyState === 'open') {
        try { peer.channel.send(JSON.stringify({ type: 'audio-state', audioState })); } catch { /* connection closing */ }
      }
    });
  }, []);

  const toggleMic = useCallback(() => {
    const next = !micMuted;
    setMicMuted(next);
    if (localAudioTrackRef.current) localAudioTrackRef.current.enabled = !next;
    broadcastAudioState({ micMuted: next, outputMuted: Boolean(preferencesRef.current.outputMuted) });
  }, [broadcastAudioState, micMuted]);

  const toggleOutput = useCallback(() => {
    const next = !preferencesRef.current.outputMuted;
    setPreferences((current) => ({ ...current, outputMuted: next }));
    broadcastAudioState({ micMuted, outputMuted: next });
  }, [broadcastAudioState, micMuted]);

  const updatePeerAudio = useCallback((id, patch) => {
    setPeerAudio((current) => ({
      ...current,
      [id]: { muted: false, volume: 1, ...(current[id] || {}), ...patch }
    }));
  }, []);

  const broadcastMediaState = useCallback((type, description) => {
    peersRef.current.forEach((peer) => {
      if (peer.channel?.readyState === 'open') {
        try { peer.channel.send(JSON.stringify({ type, description })); } catch { /* connection closing */ }
      }
    });
  }, []);

  const publishServerMediaState = useCallback((kind, track) => {
    socketRef.current?.emit('media-state-update', {
      camera: kind === 'camera' ? Boolean(track) : cameraTrackRef.current?.readyState === 'live',
      screen: kind === 'screen' ? Boolean(track) : screenTrackRef.current?.readyState === 'live'
    });
  }, []);

  const tuneVideoSender = useCallback(async (sender, kind) => {
    if (!sender?.getParameters || !sender?.setParameters) return;
    const height = Number(preferencesRef.current.videoQuality) || 720;
    const prioritizeFps = preferencesRef.current.prioritizeLiveFps !== false;
    for (const withPreference of [true, false]) {
      try {
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) parameters.encodings = [{}];
        parameters.encodings[0].maxFramerate = kind === 'screen' ? (prioritizeFps ? 30 : 20) : 30;
        parameters.encodings[0].maxBitrate = kind === 'screen'
          ? (height >= 720 ? 3_000_000 : 1_700_000)
          : (height >= 720 ? 1_800_000 : 1_000_000);
        if (withPreference) parameters.degradationPreference = kind === 'screen'
          ? (prioritizeFps ? 'maintain-framerate' : 'maintain-resolution')
          : 'balanced';
        else delete parameters.degradationPreference;
        await sender.setParameters(parameters);
        return;
      } catch {
        // Older Android WebViews may reject degradationPreference.
      }
    }
  }, []);

  const publishTrack = useCallback(async (kind, track) => {
    const field = kind === 'screen' ? 'screenSender' : 'cameraSender';
    await Promise.allSettled([...peersRef.current.values()].map(async (peer) => {
      const sender = peer[field];
      await sender?.replaceTrack(track || null);
      if (track) await tuneVideoSender(sender, kind);
    }));
    broadcastMediaState(track ? 'video-on' : 'video-off', kind);
    publishServerMediaState(kind, track);
  }, [broadcastMediaState, publishServerMediaState, tuneVideoSender]);

  const publishScreenAudio = useCallback(async (track) => {
    await Promise.allSettled([...peersRef.current.values()].map((peer) => peer.screenAudioSender?.replaceTrack(track || null)));
  }, []);

  const toggleCamera = useCallback(async () => {
    if (cameraTrackRef.current?.readyState === 'live') {
      await publishTrack('camera', null);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null; cameraTrackRef.current = null;
      setCameraOn(false); return;
    }
    try {
      const height = Number(preferencesRef.current.videoQuality) || 720;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: preferencesRef.current.cameraFacing || 'user' },
          width: { ideal: Math.round(height * 16 / 9) },
          height: { ideal: height }
        },
        audio: false
      });
      cameraStreamRef.current = stream; cameraTrackRef.current = stream.getVideoTracks()[0] || null;
      try { if (cameraTrackRef.current) cameraTrackRef.current.contentHint = 'motion'; } catch { /* optional WebRTC hint */ }
      await publishTrack('camera', cameraTrackRef.current);
      setCameraOn(Boolean(cameraTrackRef.current));
    } catch (error) {
      showNotice(error?.message || 'Não foi possível acessar a câmera.');
    }
  }, [publishTrack, showNotice]);

  const switchCamera = useCallback(async () => {
    const nextFacing = preferencesRef.current.cameraFacing === 'environment' ? 'user' : 'environment';
    setPreferences((current) => ({ ...current, cameraFacing: nextFacing }));
    if (!cameraTrackRef.current?.readyState || cameraTrackRef.current.readyState !== 'live') {
      showNotice(nextFacing === 'environment' ? 'Câmera traseira selecionada.' : 'Câmera frontal selecionada.');
      return;
    }
    try {
      const height = Number(preferencesRef.current.videoQuality) || 720;
      const replacement = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacing }, width: { ideal: Math.round(height * 16 / 9) }, height: { ideal: height } },
        audio: false
      });
      const nextTrack = replacement.getVideoTracks()[0];
      try { if (nextTrack) nextTrack.contentHint = 'motion'; } catch { /* optional WebRTC hint */ }
      await publishTrack('camera', nextTrack);
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = replacement; cameraTrackRef.current = nextTrack;
      setCameraOn(Boolean(nextTrack));
    } catch (error) {
      setPreferences((current) => ({ ...current, cameraFacing: nextFacing === 'user' ? 'environment' : 'user' }));
      showNotice(error?.message || 'Não foi possível trocar a câmera.');
    }
  }, [publishTrack, showNotice]);

  const toggleScreen = useCallback(async () => {
    if (screenTrackRef.current?.readyState === 'live') {
      await publishTrack('screen', null);
      await publishScreenAudio(null);
      screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null; screenTrackRef.current = null; screenAudioTrackRef.current = null;
      setScreenOn(false); setLocalLiveViewers([]); return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showNotice('O compartilhamento de tela ainda não foi disponibilizado pelo Android deste aparelho.');
      return;
    }
    try {
      const prioritizeFps = preferencesRef.current.prioritizeLiveFps !== false;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: prioritizeFps ? 30 : 20, max: 30 } },
        audio: true
      });
      const track = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0] || null;
      try { if (track) track.contentHint = prioritizeFps ? 'motion' : 'detail'; } catch { /* optional WebRTC hint */ }
      track.onended = () => {
        void publishTrack('screen', null); void publishScreenAudio(null);
        screenStreamRef.current = null; screenTrackRef.current = null; screenAudioTrackRef.current = null; setScreenOn(false); setLocalLiveViewers([]);
      };
      screenStreamRef.current = stream; screenTrackRef.current = track; screenAudioTrackRef.current = audioTrack;
      await publishTrack('screen', track);
      await publishScreenAudio(audioTrack);
      setScreenOn(true);
    } catch (error) {
      if (error?.name !== 'NotAllowedError') showNotice(error?.message || 'Não foi possível compartilhar a tela.');
    }
  }, [publishScreenAudio, publishTrack, showNotice]);

  const broadcastTyping = useCallback((active) => {
    peersRef.current.forEach((peer) => {
      if (peer.channel?.readyState === 'open') {
        try { peer.channel.send(JSON.stringify({ type: 'typing', active, name: profileRef.current.name, textChannel: activeTextRef.current })); } catch { /* connection closing */ }
      }
    });
  }, []);

  const changeDraft = useCallback((value) => {
    setDraft(value);
    broadcastTyping(Boolean(value.trim()));
    clearTimeout(typingSendTimerRef.current);
    typingSendTimerRef.current = setTimeout(() => broadcastTyping(false), 1400);
  }, [broadcastTyping]);

  const sendMessage = useCallback((event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (!socketRef.current?.connected) { showNotice('Aguarde a reconexão antes de enviar.'); return; }
    const mentions = mentionIdsForText(text, members);
    if (editingMessage) {
      socketRef.current.emit('edit-message', { messageId: editingMessage.messageId, text, textChannel: editingMessage.textChannel || activeText, mentions });
    } else {
      const packet = {
        text,
        textChannel: activeText,
        messageId: `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt: Date.now(),
        mentions,
        reply: replyingTo ? replySnapshot(replyingTo) : null
      };
      socketRef.current.emit('text-message', packet);
    }
    setDraft('');
    setEditingMessage(null); setReplyingTo(null);
    broadcastTyping(false);
  }, [activeText, broadcastTyping, draft, editingMessage, members, replyingTo, showNotice]);

  const beginReply = useCallback((message) => {
    setEditingMessage(null); setReplyingTo(message); setDraft('');
  }, []);

  const beginEdit = useCallback((message) => {
    setReplyingTo(null); setEditingMessage(message); setDraft(String(message.text || ''));
  }, []);

  const cancelComposerAction = useCallback(() => {
    setReplyingTo(null); setEditingMessage(null); setDraft(''); broadcastTyping(false);
  }, [broadcastTyping]);

  const reactToMessage = useCallback((messageId, emoji) => {
    socketRef.current?.emit('react-message', { messageId, textChannel: activeTextRef.current, emoji });
    setReactionTarget('');
  }, []);

  const togglePinnedMessage = useCallback((message) => {
    socketRef.current?.emit('pin-message', { messageId: message.messageId, textChannel: message.textChannel || activeTextRef.current, pinned: !message.pinned });
  }, []);

  const deleteMessage = useCallback((message) => {
    if (!isOwnMessage(message, socketRef.current?.id, CLIENT_ID)) return;
    if (!window.confirm('Apagar esta mensagem para todas as pessoas?')) return;
    socketRef.current?.emit('delete-message', { messageId: message.messageId, textChannel: message.textChannel || activeTextRef.current });
  }, []);

  const selectTextChannel = useCallback((channel) => {
    setActiveText(channel); setTab('chat'); setShowPinned(false); setReactionTarget('');
    setUnreadChannels((current) => ({ ...current, [channel]: 0 }));
  }, []);

  const mentionMember = useCallback((member) => {
    const mention = `@${String(member?.name || '').trim()}`;
    if (!mention.slice(1)) return;
    setEditingMessage(null);
    setDraft((current) => current ? `${current.replace(/\s*$/, '')} ${mention} ` : `${mention} `);
    setTab('chat');
  }, []);

  const saveCurrentServer = useCallback(() => {
    const current = { ...server, password: '' };
    setSavedServers((old) => {
      const next = [current, ...old.filter((item) => item.host !== current.host || item.roomId !== current.roomId)].slice(0, 12);
      localStorage.setItem('voiceup-mobile-servers-v1', JSON.stringify(next));
      return next;
    });
    showNotice('Servidor salvo neste aparelho.');
  }, [server, showNotice]);

  const removeSavedServer = useCallback((target) => {
    setSavedServers((old) => {
      const next = old.filter((item) => item.host !== target.host || item.roomId !== target.roomId);
      localStorage.setItem('voiceup-mobile-servers-v1', JSON.stringify(next));
      return next;
    });
  }, []);

  const chooseAvatar = useCallback((event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type) || file.size > 1_500_000) {
      setAppError('Use uma imagem PNG, JPG ou WebP com até 1,5 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProfile((current) => ({ ...current, avatar: String(reader.result || '') }));
    reader.readAsDataURL(file);
  }, []);

  const membersById = useMemo(() => {
    const all = new Map(members.map((member) => [String(member.id), member]));
    if (socketRef.current?.id) all.set(socketRef.current.id, {
      ...(all.get(socketRef.current.id) || {}),
      id: socketRef.current.id,
      clientId: CLIENT_ID,
      name: profile.name,
      color: profile.color,
      avatar: profile.avatar,
      status: profile.status,
      voiceChannel: activeVoice,
      voiceupAudioState: { micMuted, outputMuted: Boolean(preferences.outputMuted) },
      voiceupMediaState: { camera: cameraOn, screen: screenOn }
    });
    return [...all.values()].map((member) => {
      const peer = remotePeers[String(member.id)];
      if (!peer) return member;
      return {
        ...member,
        voiceupMediaState: {
          camera: member.voiceupMediaState?.camera === true || peer.cameraActive,
          screen: member.voiceupMediaState?.screen === true || peer.screenActive
        }
      };
    }).sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR', { sensitivity: 'base' }));
  }, [activeVoice, cameraOn, members, micMuted, preferences.outputMuted, profile, remotePeers, screenOn]);

  const activeMessages = messages.filter((message) => String(message.textChannel || 'geral').toLowerCase() === String(activeText).toLowerCase());
  const pinnedMessages = activeMessages.filter((message) => message.pinned);
  const activeRemotePeers = Object.values(remotePeers).filter((peer) => peer.connected || peer.cameraStream || peer.screenStream);
  const memberNames = membersById.map((member) => member.name);
  const typingNames = Object.values(typingPeers).filter((entry) => String(entry.textChannel).toLowerCase() === String(activeText).toLowerCase()).map((entry) => entry.name);
  const totalUnread = Object.values(unreadChannels).reduce((total, value) => total + Number(value || 0), 0);
  const activeTextSettings = roomLayout.textChannelSettings?.find((channel) => String(channel.name).toLowerCase() === String(activeText).toLowerCase()) || {};
  const displayedServerName = serverProfile.name || server.name || 'VoiceUP';
  const activeCallStartedAt = membersForVoiceChannel(membersById, activeVoice)
    .map((member) => Number(member.callStartedAt))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right)[0] || 0;
  const activeCallDuration = formatCallDuration(activeCallStartedAt, clock);

  useEffect(() => {
    peersRef.current.forEach((peer) => {
      sendLiveViewState(peer, tab === 'call' && Boolean(peer.screenStream && peer.screenActive));
    });
  }, [remotePeers, sendLiveViewState, tab]);

  if (!inServer) {
    return (
      <main className="welcome-shell">
        <section className="welcome-copy">
          <div className="brand-lockup"><span className="brand-mark">V</span><strong>VoiceUP</strong></div>
          <p className="eyebrow">VOICEUP PARA ANDROID</p>
          <h1>Converse de onde estiver.</h1>
          <p>Entre nos mesmos servidores do VoiceUP com chat completo, voz, câmera e transmissões.</p>
          <div className="feature-line"><span>Chat completo</span><span>Chamadas WebRTC</span><span>ServerHost e Cloud</span></div>
        </section>
        <section className="join-card">
          <header><span className="brand-mark small">V</span><div><h2>Entrar no VoiceUP</h2><p>Seu perfil fica salvo apenas neste aparelho.</p></div></header>
          {appError && <div className="error-box">{appError}</div>}
          <div className="profile-editor">
            <label className="avatar-upload" title="Alterar foto de perfil">
              <Avatar name={profile.name} color={profile.color} avatar={profile.avatar} size="large" />
              <span>Alterar foto</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseAvatar} />
            </label>
            <label>Seu nick<input value={profile.name} maxLength="24" onChange={(event) => setProfile((current) => ({ ...current, name: event.target.value }))} /></label>
          </div>
          <div className="color-row" aria-label="Cor do perfil">{COLORS.map((color) => <button key={color} className={profile.color === color ? 'selected' : ''} style={{ background: color }} onClick={() => setProfile((current) => ({ ...current, color }))} aria-label={`Selecionar cor ${color}`} />)}</div>
          <section className="server-form">
            <p className="eyebrow">CONECTAR AO SERVIDOR</p>
            <h3>Entrar em uma sala</h3>
            <label>Nome do servidor<input value={server.name} onChange={(event) => setServer((current) => ({ ...current, name: event.target.value }))} /></label>
            <label>Servidor host<input value={server.host} inputMode="url" onChange={(event) => setServer((current) => ({ ...current, host: event.target.value }))} /></label>
            <label>Código da sala<input value={server.roomId} onChange={(event) => setServer((current) => ({ ...current, roomId: event.target.value }))} /></label>
            <label>Senha da sala <small>opcional</small><input type="password" value={server.password} onChange={(event) => setServer((current) => ({ ...current, password: event.target.value }))} /></label>
            <div className="form-actions"><button className="secondary-button" onClick={saveCurrentServer}>Salvar</button><button className="primary-button" disabled={connecting} onClick={connectServer}>{connecting ? 'Conectando…' : 'Entrar na sala'}</button></div>
          </section>
          {savedServers.length > 0 && <section className="saved-list"><h3>Meus servidores</h3>{savedServers.map((item, index) => <div className="saved-entry" key={`${item.host}-${item.roomId}-${index}`}><button className="saved-open" onClick={() => setServer((current) => ({ ...current, ...item, password: '' }))}><span className="saved-icon">S</span><span><strong>{item.name || item.roomId}</strong><small>{item.host} · sala {item.roomId}</small></span></button><button className="saved-remove" title="Remover servidor salvo" aria-label={`Remover ${item.name || item.roomId}`} onClick={() => removeSavedServer(item)}>×</button></div>)}</section>}
          <p className="mobile-note">Compatível com VoiceUP 1.1.2 ou mais recente. A transmissão de tela depende do suporte do Android.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell" data-view={tab}>
      {notice && <div className="toast">{notice}</div>}
      <header className="app-header">
        <div className="brand-lockup"><span className="brand-mark small">{serverProfile.icon ? <img src={serverProfile.icon} alt="" /> : 'V'}</span><strong>{displayedServerName}</strong></div>
        <div className={`header-status ${connectionState}`}><i />{connectionState === 'reconnecting' ? 'Reconectando…' : activeVoice ? `${activeVoice}${activeCallDuration ? ` · ${activeCallDuration}` : ''}${latency !== null ? ` · ${latency} ms` : ''}` : `Online${latency !== null ? ` · ${latency} ms` : ''}`}</div>
      </header>
      <aside className="channels-panel" id="server-channels" aria-label="Canais do servidor">
        <div className="server-heading"><span className="brand-mark small">{serverProfile.icon ? <img src={serverProfile.icon} alt="" /> : 'V'}</span><div><strong>{displayedServerName}</strong><small>{membersById.length} membro(s) online</small></div></div>
        {serverProfile.description && <p className="server-description">{serverProfile.description}</p>}
        <section aria-label="Canais de voz"><p className="eyebrow">CANAIS DE VOZ</p>{roomLayout.voiceChannels.map((channel) => {
          const settings = roomLayout.voiceChannelSettings?.find((item) => item.name === channel) || {};
          const channelMembers = membersForVoiceChannel(membersById, channel);
          const channelStartedAt = channelMembers.map((member) => Number(member.callStartedAt)).filter((value) => Number.isFinite(value) && value > 0).sort((left, right) => left - right)[0] || 0;
          const channelDuration = formatCallDuration(channelStartedAt, clock);
          return <div className="voice-channel-group" key={channel}><button className={`channel-button ${activeVoice === channel ? 'active' : ''}`} aria-pressed={activeVoice === channel} onClick={() => joinVoice(channel)}><svg className="channel-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></svg><span className="channel-name">{channel}</span>{settings.locked && <span title="Canal fechado">🔒</span>}{channelDuration && <small className="channel-duration">{channelDuration}</small>}<em>{channelMembers.length || ''}</em></button>{channelMembers.length > 0 && <div className="channel-roster">{channelMembers.slice(0, 5).map((member) => <div className="channel-member-compact" key={member.id}><Avatar name={member.name} color={member.color} avatar={member.avatar} size="small" status={member.status || 'online'} platform={member.platform} /><span title={member.name}>{member.name}{String(member.id) === String(socketRef.current?.id) ? ' (você)' : ''}</span>{member.voiceupAudioState?.micMuted && <b title="Microfone desligado">⌁</b>}<MediaBadges state={member.voiceupMediaState} /></div>)}{channelMembers.length > 5 && <small className="channel-more">+{channelMembers.length - 5} participante(s)</small>}</div>}</div>;
        })}</section>
        <section aria-label="Canais de texto"><p className="eyebrow">CANAIS DE TEXTO</p>{roomLayout.textChannels.map((channel) => {
          const count = Number(unreadChannels[channel] || 0);
          const settings = roomLayout.textChannelSettings?.find((item) => item.name === channel) || {};
          return <button key={channel} className={`channel-button ${activeText === channel && tab === 'chat' ? 'active' : ''}`} aria-pressed={activeText === channel && tab === 'chat'} onClick={() => selectTextChannel(channel)}><span className="channel-icon" aria-hidden="true">#</span><span className="channel-name">{channel}</span>{settings.readOnly && <span title="Somente leitura">🔒</span>}{count > 0 && <b className="unread-badge">{count}</b>}</button>;
        })}</section>
        <section className="my-card"><Avatar name={profile.name} color={profile.color} avatar={profile.avatar} status={profile.status} platform={CLIENT_PLATFORM} /><div><strong>{profile.name}</strong><label className="presence-select"><select value={profile.status} onChange={(event) => { const status = event.target.value; setProfile((current) => ({ ...current, status })); profileRef.current = { ...profileRef.current, status }; socketRef.current?.emit('presence-update', { status, platform: CLIENT_PLATFORM }); for (const peer of peersRef.current.values()) { if (peer.channel?.readyState === 'open') peer.channel.send(JSON.stringify({ type: 'presence-state', status, platform: CLIENT_PLATFORM })); } }}><option value="online">Online</option><option value="idle">Ausente</option><option value="dnd">Não perturbe</option></select></label></div><button title="Sair do servidor" onClick={disconnectServer}>↪</button></section>
      </aside>
      <section className="main-panel">
        {(tab === 'call' || tab === 'channels') && <section className="call-view">
          {!activeVoice ? <div className="empty-call"><Avatar name={profile.name} color={profile.color} avatar={profile.avatar} size="hero" status={profile.status} platform={CLIENT_PLATFORM} /><h1>Você entrou no servidor</h1><p>Escolha um canal de voz para entrar na chamada.</p><button className="secondary-button mobile-channel-shortcut" onClick={() => setTab('channels')}>Ver canais de voz e texto</button></div> : <>
            <div className="call-grid">
              {cameraOn && <MediaTile stream={cameraStreamRef.current} muted mirror={preferences.cameraFacing !== 'environment'} local label={`${profile.name} (você) · câmera`} />}
              {screenOn && <MediaTile stream={screenStreamRef.current} muted local label={`${profile.name} (você) · tela`} badge={localLiveViewers.length ? `${localLiveViewers.length} assistindo` : 'Ao vivo'} />}
              {!cameraOn && !screenOn && <article className="member-tile local"><Avatar name={profile.name} color={profile.color} avatar={profile.avatar} size="hero" status={profile.status} platform={CLIENT_PLATFORM} /><strong>{profile.name} (você)</strong><small>{micMuted ? 'Microfone desligado' : `Canal ${activeVoice}${activeCallDuration ? ` · ${activeCallDuration}` : ''}`}</small></article>}
              {activeRemotePeers.map((peer) => <section className="peer-media" key={peer.id}>{peer.screenStream && <MediaTile stream={peer.screenStream} label={`${peer.name} · tela`} badge="Ao vivo" />}{peer.cameraStream && <MediaTile stream={peer.cameraStream} label={`${peer.name} · câmera`} />}{!peer.cameraStream && !peer.screenStream && <article className="member-tile"><Avatar name={peer.name} color={peer.color} avatar={peer.avatar} size="hero" status={members.find((member) => member.id === peer.id)?.status || peer.status || 'online'} platform={members.find((member) => member.id === peer.id)?.platform || peer.platform} /><strong>{peer.name}</strong><MediaBadges state={{ camera: peer.cameraActive, screen: peer.screenActive }} /><small>{peer.audioState?.micMuted ? 'Microfone desligado' : 'Conectado ao canal'}</small></article>}</section>)}
            </div>
            <div className="call-controls"><button className={micMuted ? 'danger' : ''} onClick={toggleMic} title="Mutar ou desmutar microfone">{micMuted ? 'Mic desligado' : 'Microfone'}</button><button className={preferences.outputMuted ? 'danger' : ''} onClick={toggleOutput}>{preferences.outputMuted ? 'Som desligado' : 'Áudio'}</button><button className={cameraOn ? 'on' : ''} onClick={toggleCamera}>Câmera</button>{cameraOn && <button onClick={switchCamera}>Trocar câmera</button>}<button className={screenOn ? 'on' : ''} onClick={toggleScreen}>Tela</button><button onClick={() => setTab('settings')}>Ajustes</button><button className="hangup" onClick={leaveVoice}>Sair da call</button></div>
          </>}
        </section>}
        {tab === 'chat' && <section className="chat-view">
          <header><div><p className="eyebrow">CANAL DE TEXTO</p><h1># {activeText}</h1>{activeTextSettings.slowModeSeconds > 0 && <small>Modo lento · {activeTextSettings.slowModeSeconds}s</small>}</div><button className={showPinned ? 'active' : ''} onClick={() => setShowPinned((value) => !value)}>📌 {pinnedMessages.length}</button></header>
          {showPinned && <aside className="pinned-drawer"><header><strong>Mensagens fixadas</strong><button onClick={() => setShowPinned(false)}>×</button></header>{pinnedMessages.length === 0 ? <p>Nenhuma mensagem fixada neste canal.</p> : pinnedMessages.map((message) => <article key={message.messageId}><strong>{message.name}</strong><p>{message.text}</p></article>)}</aside>}
          <div className="messages">{activeMessages.length === 0 && <p className="empty-messages">Nenhuma mensagem em #{activeText} ainda.</p>}{activeMessages.map((message) => <MessageItem key={message.messageId} message={message} mine={isOwnMessage(message, socketRef.current?.id, CLIENT_ID)} mentioned={isMessageMention(message, socketRef.current?.id, CLIENT_ID)} memberNames={memberNames} externalMediaAutoLoad={preferences.externalMediaAutoLoad === true} reactionOpen={reactionTarget === message.messageId} onReply={beginReply} onEdit={beginEdit} onDelete={deleteMessage} onReact={reactToMessage} onToggleReactions={(id) => setReactionTarget((current) => current === id ? '' : id)} onTogglePin={togglePinnedMessage} />)}<div ref={messagesEndRef} /></div>
          {typingNames.length > 0 && <p className="typing-indicator">{typingNames.slice(0, 2).join(' e ')} {typingNames.length > 1 ? 'estão digitando…' : 'está digitando…'}</p>}
          {(replyingTo || editingMessage) && <div className="composer-context"><div><small>{editingMessage ? 'Editando mensagem' : `Respondendo a ${replyingTo.name}`}</small><p>{editingMessage?.text || replyingTo?.text}</p></div><button type="button" onClick={cancelComposerAction}>×</button></div>}
          <form className="chat-form" onSubmit={sendMessage}><input value={draft} onChange={(event) => changeDraft(event.target.value)} placeholder={activeTextSettings.readOnly ? 'Este canal é somente leitura' : `Mensagem em #${activeText}`} maxLength="500" disabled={Boolean(activeTextSettings.readOnly)} /><button type="submit" disabled={Boolean(activeTextSettings.readOnly) || !draft.trim()}>{editingMessage ? 'Salvar' : 'Enviar'}</button></form>
        </section>}
        {tab === 'members' && <section className="members-mobile"><h1>Membros</h1><MemberList members={membersById} selfId={socketRef.current?.id} activeVoice={activeVoice} peerAudio={peerAudio} onPeerAudio={updatePeerAudio} onMention={mentionMember} /></section>}
        {tab === 'settings' && <SettingsPanel preferences={preferences} setPreferences={setPreferences} connectionState={connectionState} latency={latency} activeVoice={activeVoice} cameraOn={cameraOn} onSwitchCamera={switchCamera} />}
      </section>
      <aside className="members-panel"><header><strong>Membros</strong></header><MemberList members={membersById} selfId={socketRef.current?.id} activeVoice={activeVoice} peerAudio={peerAudio} onPeerAudio={updatePeerAudio} onMention={mentionMember} /></aside>
      <nav className="mobile-nav" aria-label="Navegação do servidor"><button className={tab === 'channels' ? 'active' : ''} aria-pressed={tab === 'channels'} aria-controls="server-channels" onClick={() => setTab('channels')}>Canais</button><button className={tab === 'call' ? 'active' : ''} aria-pressed={tab === 'call'} onClick={() => setTab('call')}>Call</button><button className={tab === 'chat' ? 'active' : ''} aria-pressed={tab === 'chat'} onClick={() => selectTextChannel(activeText)}>Chat{totalUnread > 0 && <b>{Math.min(99, totalUnread)}</b>}</button><button className={tab === 'members' ? 'active' : ''} aria-pressed={tab === 'members'} onClick={() => setTab('members')}>Membros</button><button className={tab === 'settings' ? 'active' : ''} aria-pressed={tab === 'settings'} onClick={() => setTab('settings')}>Ajustes</button></nav>
      {/* Keep voice playback mounted while browsing channels, chat or members. */}
      <div className="audio-sinks" aria-hidden="true">{Object.values(remotePeers).flatMap((peer) => {
        const local = peerAudio[peer.id] || { muted: false, volume: 1 };
        const muted = Boolean(preferences.outputMuted || local.muted);
        return [<AudioSink key={`${peer.id}-voice`} stream={peer.audioStream} muted={muted} volume={clampVolume(preferences.voiceVolume) * clampVolume(local.volume)} />, <AudioSink key={`${peer.id}-stream`} stream={peer.screenAudioStream} muted={muted} volume={clampVolume(preferences.streamVolume) * clampVolume(local.volume)} />];
      })}</div>
    </main>
  );
}

function MemberList({ members, selfId, activeVoice, peerAudio, onPeerAudio, onMention }) {
  return <div className="member-list">{members.length === 0 && <p className="empty-members">Carregando participantes…</p>}{members.map((member) => {
    const mine = String(member.id) === String(selfId);
    const inMyCall = Boolean(!mine && activeVoice && member.voiceChannel === activeVoice);
    const audio = member.voiceupAudioState || {};
    const localAudio = peerAudio?.[member.id] || { muted: false, volume: 1 };
    return <article className="member-row" key={member.id}><Avatar name={member.name} color={member.color} avatar={member.avatar} status={member.status || 'online'} platform={member.platform} /><div className="member-details"><div className="member-name-line"><strong>{member.name}{mine ? ' (você)' : ''}{member.isBot ? ' · bot' : ''}</strong><MediaBadges state={member.voiceupMediaState} /><PingBars ping={member.ping} /></div><small>{member.voiceChannel ? `Voz · ${member.voiceChannel}` : 'Fora da call'}{audio.micMuted ? ' · mic off' : ''}{audio.outputMuted ? ' · sem áudio' : ''}</small>{inMyCall && <label className="member-volume"><button type="button" onClick={() => onPeerAudio(member.id, { muted: !localAudio.muted })}>{localAudio.muted ? 'Ouvir' : 'Silenciar'}</button><input type="range" min="0" max="1" step="0.1" value={clampVolume(localAudio.volume)} aria-label={`Volume de ${member.name}`} onChange={(event) => onPeerAudio(member.id, { volume: Number(event.target.value), muted: false })} /></label>}</div>{!mine && <button type="button" className="mention-button" onClick={() => onMention(member)} title={`Mencionar ${member.name}`}>@</button>}</article>;
  })}</div>;
}

export default App;
