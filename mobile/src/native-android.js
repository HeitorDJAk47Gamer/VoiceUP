import { Capacitor, registerPlugin } from '@capacitor/core';

const UPDATE_PAGE = 'https://voiceup.shardweb.app/downloads/android';
const VoiceUpUpdater = registerPlugin('VoiceUpUpdater');
const VoiceUpScreenShare = registerPlugin('VoiceUpScreenShare');

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function distributionChannel() {
  if (!isNativeAndroid()) return 'web';
  const result = await VoiceUpUpdater.getChannel();
  return result?.channel === 'play' ? 'play' : 'apk';
}

export async function openOfficialApkDownload() {
  if (isNativeAndroid()) {
    await VoiceUpUpdater.openDownload({ url: UPDATE_PAGE });
    return;
  }
  window.open(UPDATE_PAGE, '_blank', 'noopener,noreferrer');
}

function base64Pcm16(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Int16Array(bytes.buffer);
}

export async function startNativeScreenShare({ withAudio, maxDimension, frameRate, onStatus, onStopped }) {
  if (!isNativeAndroid()) throw new Error('A captura nativa de tela só está disponível no aplicativo Android.');

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
  if (!context || typeof canvas.captureStream !== 'function') throw new Error('Este Android não conseguiu preparar a transmissão da tela.');

  let stopped = false;
  let drawing = false;
  let pendingFrame = null;
  let stream = null;
  let firstFrameResolve;
  let firstFrameReject;
  let startedResolve;
  let startedReject;
  let audioContext = null;
  let audioDestination = null;
  let nextAudioTime = 0;
  let nativeStarted = false;
  const handles = [];
  const firstFrame = new Promise((resolve, reject) => { firstFrameResolve = resolve; firstFrameReject = reject; });
  const nativeReady = new Promise((resolve, reject) => { startedResolve = resolve; startedReject = reject; });

  if (withAudio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) {
      audioContext = new AudioContext({ sampleRate: 48_000 });
      audioDestination = audioContext.createMediaStreamDestination();
      void audioContext.resume().catch(() => {});
    }
  }

  const removeListeners = async () => {
    await Promise.allSettled(handles.splice(0).map((handle) => handle?.remove?.()));
  };

  const closeWebMedia = async () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
    audioContext = null;
    audioDestination = null;
    await removeListeners();
  };

  const finishFromNative = async (reason) => {
    if (stopped) return;
    stopped = true;
    firstFrameReject?.(new Error(reason || 'O compartilhamento de tela foi encerrado.'));
    startedReject?.(new Error(reason || 'O compartilhamento de tela foi encerrado.'));
    await closeWebMedia();
    onStopped?.(reason || 'O compartilhamento de tela foi encerrado.');
  };

  const drawPendingFrame = () => {
    if (drawing || stopped || !pendingFrame) return;
    drawing = true;
    const frame = pendingFrame;
    pendingFrame = null;
    const image = new Image();
    image.onload = () => {
      if (!stopped) {
        const width = Math.max(2, Number(frame.width) || image.naturalWidth || 2);
        const height = Math.max(2, Number(frame.height) || image.naturalHeight || 2);
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        firstFrameResolve?.();
        firstFrameResolve = null;
        firstFrameReject = null;
      }
      drawing = false;
      drawPendingFrame();
    };
    image.onerror = () => {
      drawing = false;
      drawPendingFrame();
    };
    image.src = `data:image/jpeg;base64,${frame.data}`;
  };

  handles.push(await VoiceUpScreenShare.addListener('screenStarted', (status) => {
    nativeStarted = true;
    canvas.width = Math.max(2, Number(status.width) || 2);
    canvas.height = Math.max(2, Number(status.height) || 2);
    startedResolve?.(status);
    startedResolve = null;
    startedReject = null;
  }));
  handles.push(await VoiceUpScreenShare.addListener('screenFrame', (frame) => {
    if (frame?.data) {
      pendingFrame = frame;
      drawPendingFrame();
    }
  }));
  handles.push(await VoiceUpScreenShare.addListener('screenAudio', (chunk) => {
    if (!audioContext || !audioDestination || stopped || !chunk?.data) return;
    try {
      const samples = base64Pcm16(chunk.data);
      if (!samples.length) return;
      const sampleRate = Math.max(8_000, Number(chunk.sampleRate) || 48_000);
      const buffer = audioContext.createBuffer(1, samples.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) channel[index] = samples[index] / 32768;
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioDestination);
      if (nextAudioTime < audioContext.currentTime || nextAudioTime > audioContext.currentTime + 0.6) nextAudioTime = audioContext.currentTime + 0.04;
      source.start(nextAudioTime);
      nextAudioTime += buffer.duration;
    } catch {
      onStatus?.('O áudio do sistema foi interrompido; a tela continua sendo transmitida.');
    }
  }));
  handles.push(await VoiceUpScreenShare.addListener('screenStopped', ({ reason } = {}) => {
    void finishFromNative(reason);
  }));
  handles.push(await VoiceUpScreenShare.addListener('screenWarning', ({ message } = {}) => {
    if (message) onStatus?.(message);
  }));

  try {
    await VoiceUpScreenShare.start({
      withAudio: Boolean(withAudio),
      maxDimension: Math.max(360, Math.min(1080, Number(maxDimension) || 720)),
      frameRate: Math.max(6, Math.min(15, Number(frameRate) || 10))
    });
    const status = await Promise.race([
      nativeReady,
      new Promise((_, reject) => setTimeout(() => reject(new Error('A captura de tela não iniciou a tempo.')), 12_000))
    ]);
    if (stopped || !nativeStarted) throw new Error('A captura de tela foi encerrada antes de iniciar.');
    stream = canvas.captureStream(Math.max(6, Math.min(15, Number(frameRate) || 10)));
    if (withAudio && status?.audioEnabled && audioDestination) {
      await audioContext.resume().catch(() => {});
      const audioTrack = audioDestination.stream.getAudioTracks()[0];
      if (audioTrack) stream.addTrack(audioTrack);
    } else if (withAudio) {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      audioContext = null;
      audioDestination = null;
      onStatus?.('Este aparelho ou o conteúdo aberto não liberou o áudio do sistema; a tela seguirá sem áudio.');
    }
    await Promise.race([
      firstFrame,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Nenhuma imagem da tela foi recebida.')), 12_000))
    ]);
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) throw new Error('O Android não criou a faixa de vídeo da tela.');
    return {
      stream,
      audioEnabled: Boolean(stream.getAudioTracks().length),
      stop: async () => {
        if (stopped) return;
        stopped = true;
        await VoiceUpScreenShare.stop().catch(() => {});
        await closeWebMedia();
      }
    };
  } catch (error) {
    if (!stopped) {
      stopped = true;
      await VoiceUpScreenShare.stop().catch(() => {});
      await closeWebMedia();
    }
    throw error;
  }
}

export { UPDATE_PAGE };
