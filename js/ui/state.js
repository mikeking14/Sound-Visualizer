// Centralized reactive state with event emitter pattern
export class AppState {
  constructor() {
    this._listeners = {};
    this._state = {
      audioBuffer: null,
      fileName: '',
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      zoomLevel: 1,
      scrollOffset: 0,
      selection: null, // { start, end } in seconds
      features: null,
      extractionProgress: 0,
      activePanel: null,
      panelVisibility: {},
      theme: 'dark',
      channelCount: 1,
      sampleRate: 44100,
    };
  }

  get(key) {
    return this._state[key];
  }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    this._emit(key, value, old);
  }

  update(obj) {
    for (const [key, value] of Object.entries(obj)) {
      this._state[key] = value;
    }
    for (const key of Object.keys(obj)) {
      this._emit(key, this._state[key]);
    }
  }

  on(key, fn) {
    if (!this._listeners[key]) this._listeners[key] = [];
    this._listeners[key].push(fn);
    return () => this.off(key, fn);
  }

  off(key, fn) {
    if (!this._listeners[key]) return;
    this._listeners[key] = this._listeners[key].filter(f => f !== fn);
  }

  _emit(key, value, old) {
    if (!this._listeners[key]) return;
    for (const fn of this._listeners[key]) {
      fn(value, old);
    }
  }
}
