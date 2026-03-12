// Offline feature extraction using custom DSP
// Meyda is loaded globally via script tag

export class FeatureExtractor {
  constructor(state) {
    this.state = state;
  }

  async extract(audioBuffer, onProgress) {
    const sampleRate = audioBuffer.sampleRate;
    const bufferSize = 2048;
    const hopSize = 1024;
    const mono = this._getMono(audioBuffer);
    const totalFrames = Math.floor((mono.length - bufferSize) / hopSize) + 1;

    // Initialize feature arrays
    const features = {
      sampleRate,
      bufferSize,
      hopSize,
      totalFrames,
      duration: audioBuffer.duration,
      // Time-series scalars
      rms: new Float32Array(totalFrames),
      spectralCentroid: new Float32Array(totalFrames),
      spectralBandwidth: new Float32Array(totalFrames),
      spectralRolloff: new Float32Array(totalFrames),
      spectralFlux: new Float32Array(totalFrames),
      zcr: new Float32Array(totalFrames),
      loudness: new Float32Array(totalFrames),
      harmonicity: new Float32Array(totalFrames),
      // Multi-dimensional
      spectrogram: [],
      chromagram: [],
      mfcc: [],
      // Stereo features
      stereoWidth: null,
      phaseCorrelation: null,
      // Raw waveform peaks for display
      waveformPeaks: null,
    };

    // Stereo features if applicable
    if (audioBuffer.numberOfChannels >= 2) {
      features.stereoWidth = new Float32Array(totalFrames);
      features.phaseCorrelation = new Float32Array(totalFrames);
    }

    // Compute waveform peaks for display
    features.waveformPeaks = this._computeWaveformPeaks(mono, 4000);

    let prevSpectrum = null;

    // Check if Meyda is available
    const hasMeyda = typeof Meyda !== 'undefined';

    for (let i = 0; i < totalFrames; i++) {
      const start = i * hopSize;
      const frame = mono.slice(start, start + bufferSize);

      if (hasMeyda) {
        try {
          const result = Meyda.extract(
            ['rms', 'spectralCentroid', 'spectralSpread', 'spectralRolloff',
             'spectralFlux', 'zcr', 'loudness', 'chroma', 'mfcc',
             'amplitudeSpectrum'],
            frame,
            { sampleRate, bufferSize, numberOfMFCCCoefficients: 13 }
          );

          if (result) {
            features.rms[i] = result.rms || 0;
            features.spectralCentroid[i] = result.spectralCentroid || 0;
            features.spectralBandwidth[i] = result.spectralSpread || 0;
            features.spectralRolloff[i] = result.spectralRolloff || 0;
            features.spectralFlux[i] = result.spectralFlux || 0;
            features.zcr[i] = result.zcr || 0;
            features.loudness[i] = result.loudness ? result.loudness.total : 0;

            if (result.amplitudeSpectrum) {
              features.spectrogram.push(Array.from(result.amplitudeSpectrum));
            }
            if (result.chroma) {
              features.chromagram.push(Array.from(result.chroma));
            }
            if (result.mfcc) {
              features.mfcc.push(Array.from(result.mfcc));
            }
          }
        } catch (e) {
          // Fallback to custom if Meyda fails on a frame
          this._extractFrameCustom(frame, features, i, prevSpectrum, sampleRate, bufferSize);
        }
      } else {
        this._extractFrameCustom(frame, features, i, prevSpectrum, sampleRate, bufferSize);
      }

      // Harmonicity (always custom)
      features.harmonicity[i] = this._computeHarmonicity(frame, sampleRate);

      // Stereo features
      if (audioBuffer.numberOfChannels >= 2) {
        const left = audioBuffer.getChannelData(0).slice(start, start + bufferSize);
        const right = audioBuffer.getChannelData(1).slice(start, start + bufferSize);
        features.stereoWidth[i] = this._computeStereoWidth(left, right);
        features.phaseCorrelation[i] = this._computePhaseCorrelation(left, right);
      }

      // Update prev spectrum for flux
      if (features.spectrogram.length > 0) {
        prevSpectrum = features.spectrogram[features.spectrogram.length - 1];
      }

      // Progress callback (yield control every 100 frames)
      if (i % 100 === 0) {
        const progress = (i / totalFrames) * 100;
        if (onProgress) onProgress(progress);
        this.state.set('extractionProgress', progress);
        await new Promise(r => setTimeout(r, 0));
      }
    }

    if (onProgress) onProgress(100);
    this.state.set('extractionProgress', 100);
    return features;
  }

  _extractFrameCustom(frame, features, i, prevSpectrum, sampleRate, bufferSize) {
    // Custom FFT-based extraction
    const spectrum = this._fft(frame);
    features.spectrogram.push(Array.from(spectrum));

    // RMS
    let sumSq = 0;
    for (let j = 0; j < frame.length; j++) sumSq += frame[j] * frame[j];
    features.rms[i] = Math.sqrt(sumSq / frame.length);

    // ZCR
    let crossings = 0;
    for (let j = 1; j < frame.length; j++) {
      if ((frame[j] >= 0) !== (frame[j - 1] >= 0)) crossings++;
    }
    features.zcr[i] = crossings / (frame.length - 1);

    // Spectral centroid
    let weightedSum = 0, totalEnergy = 0;
    const freqPerBin = sampleRate / bufferSize;
    for (let j = 0; j < spectrum.length; j++) {
      weightedSum += j * freqPerBin * spectrum[j];
      totalEnergy += spectrum[j];
    }
    features.spectralCentroid[i] = totalEnergy > 0 ? weightedSum / totalEnergy : 0;

    // Spectral bandwidth (spread)
    const centroid = features.spectralCentroid[i];
    let spreadSum = 0;
    for (let j = 0; j < spectrum.length; j++) {
      const freq = j * freqPerBin;
      spreadSum += spectrum[j] * (freq - centroid) * (freq - centroid);
    }
    features.spectralBandwidth[i] = totalEnergy > 0 ? Math.sqrt(spreadSum / totalEnergy) : 0;

    // Spectral rolloff (85%)
    const threshold = totalEnergy * 0.85;
    let cumEnergy = 0;
    features.spectralRolloff[i] = sampleRate / 2;
    for (let j = 0; j < spectrum.length; j++) {
      cumEnergy += spectrum[j];
      if (cumEnergy >= threshold) {
        features.spectralRolloff[i] = j * freqPerBin;
        break;
      }
    }

    // Spectral flux
    if (prevSpectrum) {
      let flux = 0;
      for (let j = 0; j < spectrum.length; j++) {
        const diff = spectrum[j] - (prevSpectrum[j] || 0);
        flux += diff * diff;
      }
      features.spectralFlux[i] = Math.sqrt(flux);
    }

    // Loudness (approximate)
    features.loudness[i] = features.rms[i] > 0 ? 20 * Math.log10(features.rms[i]) + 80 : 0;

    // Chroma (simplified)
    const chroma = new Array(12).fill(0);
    for (let j = 1; j < spectrum.length; j++) {
      const freq = j * freqPerBin;
      if (freq < 20 || freq > 8000) continue;
      const midi = 12 * Math.log2(freq / 440) + 69;
      const pitchClass = Math.round(midi) % 12;
      if (pitchClass >= 0 && pitchClass < 12) {
        chroma[pitchClass] += spectrum[j];
      }
    }
    features.chromagram.push(chroma);

    // MFCC (simplified - just use mel-scaled spectrum bins)
    const mfcc = this._simpleMFCC(spectrum, sampleRate, 13);
    features.mfcc.push(mfcc);
  }

  _fft(signal) {
    const n = signal.length;
    // Apply Hann window
    const windowed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      windowed[i] = signal[i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    }

    // DFT (for power of 2 sizes, this is acceptable)
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      real[i] = windowed[i];
      imag[i] = 0;
    }

    this._fftInPlace(real, imag, n);

    // Magnitude spectrum (first half)
    const halfN = n / 2;
    const magnitude = new Float32Array(halfN);
    for (let i = 0; i < halfN; i++) {
      magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / n;
    }
    return magnitude;
  }

  _fftInPlace(real, imag, n) {
    // Bit reversal
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }

    // Cooley-Tukey
    for (let size = 2; size <= n; size *= 2) {
      const halfSize = size / 2;
      const angle = -2 * Math.PI / size;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);

      for (let i = 0; i < n; i += size) {
        let curReal = 1, curImag = 0;
        for (let k = 0; k < halfSize; k++) {
          const evenIdx = i + k;
          const oddIdx = i + k + halfSize;
          const tReal = curReal * real[oddIdx] - curImag * imag[oddIdx];
          const tImag = curReal * imag[oddIdx] + curImag * real[oddIdx];
          real[oddIdx] = real[evenIdx] - tReal;
          imag[oddIdx] = imag[evenIdx] - tImag;
          real[evenIdx] += tReal;
          imag[evenIdx] += tImag;
          const newCurReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = newCurReal;
        }
      }
    }
  }

  _simpleMFCC(spectrum, sampleRate, numCoeffs) {
    // Simplified MFCC: mel-filter bank then DCT
    const numFilters = 26;
    const melSpectrum = new Float32Array(numFilters);
    const maxFreq = sampleRate / 2;
    const melMax = 2595 * Math.log10(1 + maxFreq / 700);

    for (let i = 0; i < numFilters; i++) {
      const melLow = (melMax * i) / (numFilters + 1);
      const melHigh = (melMax * (i + 2)) / (numFilters + 1);
      const melCenter = (melMax * (i + 1)) / (numFilters + 1);
      const freqLow = 700 * (Math.pow(10, melLow / 2595) - 1);
      const freqHigh = 700 * (Math.pow(10, melHigh / 2595) - 1);
      const freqCenter = 700 * (Math.pow(10, melCenter / 2595) - 1);

      const binLow = Math.floor(freqLow / maxFreq * spectrum.length);
      const binHigh = Math.ceil(freqHigh / maxFreq * spectrum.length);
      const binCenter = Math.round(freqCenter / maxFreq * spectrum.length);

      for (let j = binLow; j < binHigh && j < spectrum.length; j++) {
        let weight;
        if (j < binCenter) {
          weight = (j - binLow) / (binCenter - binLow + 1);
        } else {
          weight = (binHigh - j) / (binHigh - binCenter + 1);
        }
        melSpectrum[i] += spectrum[j] * Math.max(0, weight);
      }
      melSpectrum[i] = Math.log(melSpectrum[i] + 1e-10);
    }

    // DCT-II
    const mfcc = new Array(numCoeffs);
    for (let i = 0; i < numCoeffs; i++) {
      let sum = 0;
      for (let j = 0; j < numFilters; j++) {
        sum += melSpectrum[j] * Math.cos(Math.PI * i * (j + 0.5) / numFilters);
      }
      mfcc[i] = sum;
    }
    return mfcc;
  }

  _computeHarmonicity(frame, sampleRate) {
    // Normalized autocorrelation
    const n = frame.length;
    let energy = 0;
    for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
    if (energy < 1e-10) return 0;

    // Search in pitch range 50Hz - 500Hz
    const minLag = Math.floor(sampleRate / 500);
    const maxLag = Math.min(Math.floor(sampleRate / 50), n - 1);

    let maxCorr = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0;
      for (let i = 0; i < n - lag; i++) {
        corr += frame[i] * frame[i + lag];
      }
      corr /= energy;
      if (corr > maxCorr) maxCorr = corr;
    }
    return Math.max(0, Math.min(1, maxCorr));
  }

  _computeStereoWidth(left, right) {
    let midEnergy = 0, sideEnergy = 0;
    for (let i = 0; i < left.length; i++) {
      const mid = (left[i] + right[i]) / 2;
      const side = (left[i] - right[i]) / 2;
      midEnergy += mid * mid;
      sideEnergy += side * side;
    }
    return midEnergy > 1e-10 ? Math.min(1, Math.sqrt(sideEnergy / midEnergy)) : 0;
  }

  _computePhaseCorrelation(left, right) {
    const n = left.length;
    let sumL = 0, sumR = 0;
    for (let i = 0; i < n; i++) { sumL += left[i]; sumR += right[i]; }
    const meanL = sumL / n, meanR = sumR / n;

    let cov = 0, varL = 0, varR = 0;
    for (let i = 0; i < n; i++) {
      const dl = left[i] - meanL, dr = right[i] - meanR;
      cov += dl * dr;
      varL += dl * dl;
      varR += dr * dr;
    }
    const denom = Math.sqrt(varL * varR);
    return denom > 1e-10 ? cov / denom : 0;
  }

  _getMono(audioBuffer) {
    if (audioBuffer.numberOfChannels === 1) {
      return audioBuffer.getChannelData(0);
    }
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.getChannelData(1);
    const mono = new Float32Array(left.length);
    for (let i = 0; i < left.length; i++) {
      mono[i] = (left[i] + right[i]) / 2;
    }
    return mono;
  }

  _computeWaveformPeaks(samples, numPeaks) {
    const samplesPerPeak = Math.floor(samples.length / numPeaks);
    const peaks = { min: new Float32Array(numPeaks), max: new Float32Array(numPeaks) };
    for (let i = 0; i < numPeaks; i++) {
      let min = Infinity, max = -Infinity;
      const start = i * samplesPerPeak;
      const end = Math.min(start + samplesPerPeak, samples.length);
      for (let j = start; j < end; j++) {
        if (samples[j] < min) min = samples[j];
        if (samples[j] > max) max = samples[j];
      }
      peaks.min[i] = min;
      peaks.max[i] = max;
    }
    return peaks;
  }
}
