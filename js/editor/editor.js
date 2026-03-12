// Audio editing: crop, trim, instrument separation
export class AudioEditor {
  constructor(state, engine) {
    this.state = state;
    this.engine = engine;
  }

  // Crop to selection (keep only selected region)
  crop() {
    const sel = this.state.get('selection');
    const buffer = this.state.get('audioBuffer');
    if (!sel || !buffer) return null;

    const startSample = Math.floor(sel.start * buffer.sampleRate);
    const endSample = Math.floor(sel.end * buffer.sampleRate);
    const length = endSample - startSample;

    const ctx = this.engine.ctx;
    const newBuffer = ctx.createBuffer(
      buffer.numberOfChannels,
      length,
      buffer.sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = newBuffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        dst[i] = src[startSample + i];
      }
    }

    return newBuffer;
  }

  // Delete selection (remove selected region)
  deleteSelection() {
    const sel = this.state.get('selection');
    const buffer = this.state.get('audioBuffer');
    if (!sel || !buffer) return null;

    const startSample = Math.floor(sel.start * buffer.sampleRate);
    const endSample = Math.floor(sel.end * buffer.sampleRate);
    const newLength = buffer.length - (endSample - startSample);

    const ctx = this.engine.ctx;
    const newBuffer = ctx.createBuffer(
      buffer.numberOfChannels,
      newLength,
      buffer.sampleRate
    );

    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = newBuffer.getChannelData(ch);
      let di = 0;
      for (let i = 0; i < startSample; i++) dst[di++] = src[i];
      for (let i = endSample; i < buffer.length; i++) dst[di++] = src[i];
    }

    return newBuffer;
  }

  // Harmonic-Percussive Source Separation
  async separateHarmonicPercussive(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = this._getMono(audioBuffer);
    const fftSize = 2048;
    const hopSize = 512;

    // STFT
    const { magnitude, phase, numFrames, numBins } = this._stft(mono, fftSize, hopSize);

    // Median filtering
    const harmonicKernelSize = 17; // vertical (frequency) median for harmonic
    const percussiveKernelSize = 17; // horizontal (time) median for percussive

    const harmonicMag = new Float32Array(magnitude.length);
    const percussiveMag = new Float32Array(magnitude.length);

    // Vertical median filter -> harmonic
    for (let t = 0; t < numFrames; t++) {
      for (let f = 0; f < numBins; f++) {
        const values = [];
        const half = Math.floor(harmonicKernelSize / 2);
        for (let df = -half; df <= half; df++) {
          const ff = Math.max(0, Math.min(numBins - 1, f + df));
          values.push(magnitude[t * numBins + ff]);
        }
        values.sort((a, b) => a - b);
        harmonicMag[t * numBins + f] = values[Math.floor(values.length / 2)];
      }
    }

    // Horizontal median filter -> percussive
    for (let f = 0; f < numBins; f++) {
      for (let t = 0; t < numFrames; t++) {
        const values = [];
        const half = Math.floor(percussiveKernelSize / 2);
        for (let dt = -half; dt <= half; dt++) {
          const tt = Math.max(0, Math.min(numFrames - 1, t + dt));
          values.push(magnitude[tt * numBins + f]);
        }
        values.sort((a, b) => a - b);
        percussiveMag[t * numBins + f] = values[Math.floor(values.length / 2)];
      }
    }

    // Soft masks
    const harmonicSpec = new Float32Array(magnitude.length);
    const percussiveSpec = new Float32Array(magnitude.length);

    for (let i = 0; i < magnitude.length; i++) {
      const h = harmonicMag[i];
      const p = percussiveMag[i];
      const total = h + p + 1e-10;
      harmonicSpec[i] = magnitude[i] * (h / total);
      percussiveSpec[i] = magnitude[i] * (p / total);
    }

    // iSTFT
    const harmonicAudio = this._istft(harmonicSpec, phase, numFrames, numBins, fftSize, hopSize, mono.length);
    const percussiveAudio = this._istft(percussiveSpec, phase, numFrames, numBins, fftSize, hopSize, mono.length);

    const ctx = this.engine.ctx;
    const harmonicBuffer = ctx.createBuffer(1, harmonicAudio.length, sampleRate);
    harmonicBuffer.getChannelData(0).set(harmonicAudio);

    const percussiveBuffer = ctx.createBuffer(1, percussiveAudio.length, sampleRate);
    percussiveBuffer.getChannelData(0).set(percussiveAudio);

    return { harmonic: harmonicBuffer, percussive: percussiveBuffer };
  }

  // Spectral gating for noise reduction
  async denoiseSpectralGate(audioBuffer, threshold = 0.02) {
    const sampleRate = audioBuffer.sampleRate;
    const mono = this._getMono(audioBuffer);
    const fftSize = 2048;
    const hopSize = 512;

    const { magnitude, phase, numFrames, numBins } = this._stft(mono, fftSize, hopSize);

    // Gate: zero out bins below threshold
    const gated = new Float32Array(magnitude.length);
    let maxMag = 0;
    for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > maxMag) maxMag = magnitude[i];

    const absThreshold = threshold * maxMag;
    for (let i = 0; i < magnitude.length; i++) {
      gated[i] = magnitude[i] > absThreshold ? magnitude[i] : magnitude[i] * 0.1;
    }

    const result = this._istft(gated, phase, numFrames, numBins, fftSize, hopSize, mono.length);
    const ctx = this.engine.ctx;
    const outBuffer = ctx.createBuffer(1, result.length, sampleRate);
    outBuffer.getChannelData(0).set(result);
    return outBuffer;
  }

  // STFT
  _stft(signal, fftSize, hopSize) {
    const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
    const numBins = fftSize / 2 + 1;
    const magnitude = new Float32Array(numFrames * numBins);
    const phase = new Float32Array(numFrames * numBins);
    const window = new Float32Array(fftSize);

    // Hann window
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }

    for (let t = 0; t < numFrames; t++) {
      const offset = t * hopSize;
      const real = new Float32Array(fftSize);
      const imag = new Float32Array(fftSize);

      for (let i = 0; i < fftSize; i++) {
        real[i] = signal[offset + i] * window[i];
      }

      this._fftInPlace(real, imag, fftSize);

      for (let f = 0; f < numBins; f++) {
        const idx = t * numBins + f;
        magnitude[idx] = Math.sqrt(real[f] * real[f] + imag[f] * imag[f]);
        phase[idx] = Math.atan2(imag[f], real[f]);
      }
    }

    return { magnitude, phase, numFrames, numBins };
  }

  // Inverse STFT with overlap-add
  _istft(magnitude, phase, numFrames, numBins, fftSize, hopSize, outputLength) {
    const output = new Float32Array(outputLength);
    const windowSum = new Float32Array(outputLength);
    const window = new Float32Array(fftSize);

    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
    }

    for (let t = 0; t < numFrames; t++) {
      const real = new Float32Array(fftSize);
      const imag = new Float32Array(fftSize);

      // Reconstruct complex spectrum
      for (let f = 0; f < numBins; f++) {
        const idx = t * numBins + f;
        real[f] = magnitude[idx] * Math.cos(phase[idx]);
        imag[f] = magnitude[idx] * Math.sin(phase[idx]);
      }
      // Mirror for negative frequencies
      for (let f = 1; f < numBins - 1; f++) {
        real[fftSize - f] = real[f];
        imag[fftSize - f] = -imag[f];
      }

      this._ifftInPlace(real, imag, fftSize);

      const offset = t * hopSize;
      for (let i = 0; i < fftSize && offset + i < outputLength; i++) {
        output[offset + i] += real[i] * window[i];
        windowSum[offset + i] += window[i] * window[i];
      }
    }

    // Normalize by window sum
    for (let i = 0; i < outputLength; i++) {
      if (windowSum[i] > 1e-8) output[i] /= windowSum[i];
    }

    return output;
  }

  _fftInPlace(real, imag, n) {
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let m = n >> 1;
      while (m >= 1 && j >= m) { j -= m; m >>= 1; }
      j += m;
    }
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angle = -2 * Math.PI / size;
      const wR = Math.cos(angle), wI = Math.sin(angle);
      for (let i = 0; i < n; i += size) {
        let cR = 1, cI = 0;
        for (let k = 0; k < halfSize; k++) {
          const e = i + k, o = i + k + halfSize;
          const tR = cR * real[o] - cI * imag[o];
          const tI = cR * imag[o] + cI * real[o];
          real[o] = real[e] - tR; imag[o] = imag[e] - tI;
          real[e] += tR; imag[e] += tI;
          const newCR = cR * wR - cI * wI;
          cI = cR * wI + cI * wR; cR = newCR;
        }
      }
    }
  }

  _ifftInPlace(real, imag, n) {
    // Conjugate
    for (let i = 0; i < n; i++) imag[i] = -imag[i];
    this._fftInPlace(real, imag, n);
    for (let i = 0; i < n; i++) { real[i] /= n; imag[i] = -imag[i] / n; }
  }

  _getMono(audioBuffer) {
    if (audioBuffer.numberOfChannels === 1) return audioBuffer.getChannelData(0);
    const l = audioBuffer.getChannelData(0);
    const r = audioBuffer.getChannelData(1);
    const mono = new Float32Array(l.length);
    for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
    return mono;
  }
}
