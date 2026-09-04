(() => {
  'use strict';

  const PROCESSOR_NAME = '@sapphi-red/web-noise-suppressor/rnnoise';
  const ENGINE_BASE_URL = new URL('.', document.currentScript?.src || location.href);
  const WORKLET_URL = new URL('vendor/rnnoise/rnnoise-worklet.js', ENGINE_BASE_URL).href;
  const MAX_ASSET_BYTES = 512 * 1024;
  const assetCache = new Map();

  const asArrayBuffer = (value) => {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    if (value?.type === 'Buffer' && Array.isArray(value.data)) return Uint8Array.from(value.data).buffer;
    throw new Error('O VoiceUP recebeu um componente RNNoise inválido.');
  };

  const loadAsset = async (name) => {
    if (!assetCache.has(name)) {
      const loader = window.voiceupDesktop?.rnnoiseAsset;
      if (typeof loader !== 'function') throw new Error('RNNoise está disponível apenas no aplicativo VoiceUP para Windows.');
      assetCache.set(name, Promise.resolve(loader(name)).then((value) => {
        const buffer = asArrayBuffer(value);
        if (!buffer.byteLength || buffer.byteLength > MAX_ASSET_BYTES) throw new Error('O componente RNNoise não pôde ser validado.');
        return buffer;
      }));
    }
    return assetCache.get(name);
  };

  const supportsSimd = () => {
    try {
      return WebAssembly.validate(new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0,
        10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
      ]));
    } catch { return false; }
  };

  const clampGain = (value) => Math.max(0, Math.min(2, Number(value) || 0));

  const create = async (sourceTrack, { gain = 1 } = {}) => {
    if (!(sourceTrack instanceof MediaStreamTrack) || sourceTrack.kind !== 'audio' || sourceTrack.readyState !== 'live') {
      throw new Error('O microfone não está disponível para o RNNoise.');
    }
    if (!window.AudioContext || !window.AudioWorkletNode || !window.WebAssembly) {
      throw new Error('Este computador não oferece o mecanismo de áudio exigido pelo RNNoise.');
    }

    let context = null;
    let source = null;
    let suppressor = null;
    let gainNode = null;
    let destination = null;
    let outputTrack = null;
    let closed = false;
    let sourceEnded = null;

    const close = async () => {
      if (closed) return;
      closed = true;
      if (sourceEnded) sourceTrack.removeEventListener('ended', sourceEnded);
      try { suppressor?.port?.postMessage('destroy'); } catch { /* already gone */ }
      try { source?.disconnect(); } catch { /* already gone */ }
      try { suppressor?.disconnect(); } catch { /* already gone */ }
      try { gainNode?.disconnect(); } catch { /* already gone */ }
      outputTrack?.stop?.();
      await context?.close?.().catch(() => {});
    };

    try {
      const useSimd = supportsSimd();
      const cachedWasm = await loadAsset(useSimd ? 'simd' : 'wasm');

      context = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      if (context.sampleRate !== 48000) throw new Error('RNNoise requer áudio em 48 kHz.');
      await context.audioWorklet.addModule(WORKLET_URL);

      suppressor = new AudioWorkletNode(context, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'discrete',
        processorOptions: {
          maxChannels: 1,
          wasmBinary: cachedWasm.slice(0)
        }
      });
      source = context.createMediaStreamSource(new MediaStream([sourceTrack]));
      gainNode = context.createGain();
      gainNode.gain.value = clampGain(gain);
      destination = context.createMediaStreamDestination();
      source.connect(suppressor).connect(gainNode).connect(destination);
      outputTrack = destination.stream.getAudioTracks()[0];
      if (!outputTrack) throw new Error('O RNNoise não criou uma saída de microfone.');
      outputTrack.contentHint = 'speech';
      sourceEnded = () => void close();
      sourceTrack.addEventListener('ended', sourceEnded, { once: true });
      await context.resume();
      if (context.state !== 'running') throw new Error('O mecanismo RNNoise não pôde iniciar.');

      return Object.freeze({
        track: outputTrack,
        sourceTrack,
        sampleRate: context.sampleRate,
        usingSimd: useSimd,
        setGain(value) {
          if (!closed && gainNode) gainNode.gain.setValueAtTime(clampGain(value), context.currentTime);
        },
        close
      });
    } catch (error) {
      await close();
      throw error;
    }
  };

  window.voiceupRnnoise = Object.freeze({
    supported: Boolean(window.AudioContext && window.AudioWorkletNode && window.WebAssembly && window.voiceupDesktop?.rnnoiseAsset),
    create
  });
})();
