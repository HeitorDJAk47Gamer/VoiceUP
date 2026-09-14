export function isPublishingTrack(track) {
  return Boolean(track && track.readyState === 'live');
}

export function hasActiveVideoTrack(stream) {
  if (!stream || typeof stream.getVideoTracks !== 'function') return false;
  return stream.getVideoTracks().some((track) => isPublishingTrack(track) && track.muted !== true);
}

export function shouldRenderRemoteVideo(active, stream) {
  return Boolean(active) && hasActiveVideoTrack(stream);
}
