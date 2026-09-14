/* Shared, deterministic policy; WebRTC retains final congestion control. */
((scope) => {
  function createState() { return { previous: null, bad: 0, good: 0, fps: null, changedAt: 0 }; }
  function sample(state, report, maximumFps) {
    const now = Number(report.timestamp);
    const previous = state.previous;
    state.previous = report;
    if (!previous || previous.id !== report.id || now <= previous.timestamp || now - previous.timestamp > 10000) {
      state.bad = state.good = 0;
      return null;
    }
    const frames = Number(report.framesEncoded) - Number(previous.framesEncoded);
    // Idle/static desktops and counter resets do not indicate encoder pressure.
    if (!Number.isFinite(frames) || frames <= 0) { state.bad = state.good = 0; return null; }
    const seconds = (now - previous.timestamp) / 1000;
    const durations = report.qualityLimitationDurations;
    const oldDurations = previous.qualityLimitationDurations;
    const limited = durations && oldDurations
      ? ['cpu', 'bandwidth'].some((reason) => (Number(durations[reason] || 0) - Number(oldDurations[reason] || 0)) / seconds > .35)
      : ['cpu', 'bandwidth'].includes(report.qualityLimitationReason);
    const encodeTime = (Number(report.totalEncodeTime) - Number(previous.totalEncodeTime)) / frames;
    const current = Math.min(maximumFps, state.fps || maximumFps);
    const healthy = report.qualityLimitationReason === 'none' && (!Number.isFinite(encodeTime) || encodeTime * current < .65);
    state.bad = limited ? state.bad + 1 : 0;
    state.good = !limited && healthy ? state.good + 1 : 0;
    // Three consecutive samples before reducing; at least 30 seconds of
    // health and 45 seconds since the last change before a gradual recovery.
    let next = current;
    if (state.bad >= 3 && now - state.changedAt >= 9000) next = Math.max(Math.min(15, maximumFps), Math.round(current * .75));
    else if (state.good >= 10 && now - state.changedAt >= 45000) next = Math.min(maximumFps, Math.ceil(current * 1.15));
    if (next === current) return null;
    state.bad = state.good = 0;
    state.changedAt = now;
    state.fps = next;
    return next;
  }
  const api = { createState, sample };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.voiceupLiveQuality = api;
})(globalThis);
