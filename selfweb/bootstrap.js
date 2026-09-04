/* Runs before the shared Client scripts. No connection or media request here. */
(() => {
  'use strict';
  const prefix = 'voiceup-selfweb-v1:';
  function storage(kind) {
    const memory = new Map();
    let backing;
    try { backing = window[kind]; const key=prefix+'probe'; backing.setItem(key,'1'); backing.removeItem(key); } catch { backing=null; }
    return Object.freeze({
      get persistent() { return Boolean(backing); },
      getItem(key) {
        key=String(key);
        if (memory.has(key)) return memory.get(key);
        try { return backing?.getItem(prefix+key) ?? null; } catch { backing=null; return null; }
      },
      setItem(key,value) {
        key=String(key); value=String(value); memory.set(key,value);
        try { backing?.setItem(prefix+key,value); } catch { backing=null; }
      },
      removeItem(key) {
        key=String(key); memory.set(key,null);
        try { backing?.removeItem(prefix+key); } catch { backing=null; }
      }
    });
  }
  window.voiceupSelfWebStorage = Object.freeze({local:storage('localStorage'),session:storage('sessionStorage')});
  window.voiceupSocketClientReady = Promise.resolve(window.io);
  window.voiceupRnnoise = Object.freeze({supported:false});
  window.voiceupSelfWebCapabilities = Object.freeze({
    secureContext: window.isSecureContext,
    rtc: typeof RTCPeerConnection === 'function',
    identity: Boolean(window.crypto?.subtle),
    microphone: Boolean(navigator.mediaDevices?.getUserMedia),
    screen: Boolean(navigator.mediaDevices?.getDisplayMedia),
    outputDevice: typeof HTMLMediaElement.prototype.setSinkId === 'function'
  });
})();
