class VoiceUpProcessPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queuedFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (data?.reset) {
        this.queue = [];
        this.offset = 0;
        this.queuedFrames = 0;
        return;
      }
      if (!(data instanceof ArrayBuffer) || data.byteLength < 4) return;
      const pcm = new Int16Array(data);
      this.queue.push(pcm);
      this.queuedFrames += Math.floor(pcm.length / 2);
      while (this.queuedFrames > 24000 && this.queue.length > 1) {
        const removed = this.queue.shift();
        this.queuedFrames -= Math.floor((removed.length - this.offset) / 2);
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] || left;
    left.fill(0);
    if (right !== left) right.fill(0);
    for (let frame = 0; frame < left.length;) {
      const chunk = this.queue[0];
      if (!chunk) break;
      if (this.offset + 1 >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
        continue;
      }
      const available = Math.floor((chunk.length - this.offset) / 2);
      const count = Math.min(left.length - frame, available);
      for (let index = 0; index < count; index += 1) {
        left[frame + index] = chunk[this.offset + index * 2] / 32768;
        right[frame + index] = chunk[this.offset + index * 2 + 1] / 32768;
      }
      this.offset += count * 2;
      this.queuedFrames = Math.max(0, this.queuedFrames - count);
      frame += count;
      if (this.offset >= chunk.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor('voiceup-process-pcm', VoiceUpProcessPcmProcessor);
