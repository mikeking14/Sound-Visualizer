// Audio engine: loading, decoding, playback
export class AudioEngine {
  constructor(state) {
    this.state = state;
    this.ctx = null;
    this.sourceNode = null;
    this.analyserNode = null;
    this.gainNode = null;
    this.startTime = 0;
    this.pauseTime = 0;
    this._animFrame = null;
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.analyserNode = this.ctx.createAnalyser();
      this.analyserNode.fftSize = 4096;
      this.analyserNode.smoothingTimeConstant = 0.8;
      this.gainNode = this.ctx.createGain();
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  async loadFile(file) {
    this._ensureContext();
    this.stop();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
    this.state.update({
      audioBuffer,
      fileName: file.name,
      duration: audioBuffer.duration,
      channelCount: audioBuffer.numberOfChannels,
      sampleRate: audioBuffer.sampleRate,
      currentTime: 0,
      selection: null,
    });
    this.pauseTime = 0;
    return audioBuffer;
  }

  play(startFrom) {
    this._ensureContext();
    const buffer = this.state.get('audioBuffer');
    if (!buffer) return;

    this.stop(true);

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.connect(this.gainNode);

    const offset = startFrom !== undefined ? startFrom : this.pauseTime;
    this.startTime = this.ctx.currentTime - offset;
    this.sourceNode.start(0, offset);
    this.state.set('isPlaying', true);

    this.sourceNode.onended = () => {
      if (this.state.get('isPlaying')) {
        this.stop();
      }
    };

    this._startTimeUpdate();
  }

  pause() {
    if (!this.state.get('isPlaying')) return;
    this.pauseTime = this.ctx.currentTime - this.startTime;
    this._stopSource();
    this.state.set('isPlaying', false);
    this._stopTimeUpdate();
  }

  stop(internal) {
    this._stopSource();
    this.pauseTime = 0;
    if (!internal) {
      this.state.update({ isPlaying: false, currentTime: 0 });
    }
    this._stopTimeUpdate();
  }

  seek(time) {
    const duration = this.state.get('duration');
    time = Math.max(0, Math.min(time, duration));
    this.pauseTime = time;
    this.state.set('currentTime', time);
    if (this.state.get('isPlaying')) {
      this.play(time);
    }
  }

  setVolume(vol) {
    this._ensureContext();
    this.gainNode.gain.value = vol;
  }

  getAnalyserData() {
    if (!this.analyserNode) return null;
    const data = new Float32Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getFloatFrequencyData(data);
    return data;
  }

  getTimeDomainData() {
    if (!this.analyserNode) return null;
    const data = new Float32Array(this.analyserNode.fftSize);
    this.analyserNode.getFloatTimeDomainData(data);
    return data;
  }

  _stopSource() {
    if (this.sourceNode) {
      try { this.sourceNode.stop(); } catch (e) {}
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
  }

  _startTimeUpdate() {
    this._stopTimeUpdate();
    const update = () => {
      if (this.state.get('isPlaying') && this.ctx) {
        const t = this.ctx.currentTime - this.startTime;
        const dur = this.state.get('duration');
        this.state.set('currentTime', Math.min(t, dur));
        if (t >= dur) {
          this.stop();
          return;
        }
      }
      this._animFrame = requestAnimationFrame(update);
    };
    this._animFrame = requestAnimationFrame(update);
  }

  _stopTimeUpdate() {
    if (this._animFrame) {
      cancelAnimationFrame(this._animFrame);
      this._animFrame = null;
    }
  }
}
