/* Per-connection caps. Never change constraints on the shared capture track. */
(function (root) {
  'use strict';
  const choices = Object.freeze(['auto', '360', '480', '720', '1080']);
  const normalize = (value) => choices.includes(value) ? value : null;
  function encoding(source, ceiling, choice) {
    const height = Math.max(1, Number(source.height) || 720);
    const requested = choice === 'auto' ? height : Number(choice) || height;
    const target = Math.min(height, Number(ceiling.height) || height, requested);
    const scale = Math.max(1, height / target);
    return {
      scaleResolutionDownBy: scale,
      maxFramerate: Math.min(ceiling.fps, choice === 'auto' ? ceiling.fps : 30),
      maxBitrate: Math.min(ceiling.bitrate, Math.max(250000, Math.round(ceiling.bitrate / (scale * scale))))
    };
  }
  const api = { choices, normalize, encoding, senders: new WeakMap() };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.voiceupViewerQuality = api;
})(globalThis);
