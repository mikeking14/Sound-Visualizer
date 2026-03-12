// 3D combined visualization using Three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BANDS = {
  all:  { label: 'All', range: [0, 1.0], color: [0.55, 0.8, 0.5] },
  bass: { label: 'Bass', range: [0, 0.025], color: [0.0, 0.9, 0.55] },   // 20-250 Hz (approx)
  mids: { label: 'Mids', range: [0.025, 0.4], color: [0.28, 0.85, 0.55] }, // 250-4kHz
  highs:{ label: 'Highs', range: [0.4, 1.0], color: [0.6, 0.8, 0.55] },   // 4k-20kHz
};

export class Scene3DPanel {
  constructor(state) {
    this.id = 'scene3d';
    this.title = '3D Sound Landscape';
    this.state = state;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.container = null;
    this.wrapper = null;
    this.terrainGroup = null;
    this._needsUpdate = true;
    this._animFrame = null;
    this._activeBand = 'all';
    this._features = null;
    this._bandButtons = {};
    this._autoRotate = false;
    this._labelSprites = [];

    state.on('features', () => { this._needsUpdate = true; });
  }

  init(container) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight || 500;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060612);

    this.camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
    this.camera.position.set(40, 25, 40);

    this.renderer = new THREE.WebGLRenderer({
      antialias: false,  // disabled for perf
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(30, 4, 15);
    this.controls.maxPolarAngle = Math.PI * 0.48;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 120;
    this.controls.rotateSpeed = 0.6;

    // Lighting
    const ambient = new THREE.AmbientLight(0x303050, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(30, 50, 30);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0x4466ff, 0.3);
    fill.position.set(-20, 10, -20);
    this.scene.add(fill);

    // Ground grid
    this._addGrid();

    // Axis labels
    this._addAxisLabels();

    this.terrainGroup = new THREE.Group();
    this.scene.add(this.terrainGroup);

    this._animate();
  }

  _addGrid() {
    const gridGeo = new THREE.BufferGeometry();
    const verts = [];
    const size = 60;
    const divisions = 30;
    const step = size / divisions;
    for (let i = 0; i <= divisions; i++) {
      const pos = i * step;
      verts.push(pos, -0.05, 0, pos, -0.05, 30);
      verts.push(0, -0.05, pos > 30 ? 30 : pos, 60, -0.05, pos > 30 ? 30 : pos);
    }
    // Only push Z lines up to 30
    for (let i = 0; i <= 15; i++) {
      const pos = i * 2;
      verts.push(0, -0.05, pos, 60, -0.05, pos);
    }
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    const gridMat = new THREE.LineBasicMaterial({ color: 0x1a1a3a, transparent: true, opacity: 0.5 });
    this.scene.add(new THREE.LineSegments(gridGeo, gridMat));

    // Simpler approach: Three.js GridHelper
    const grid = new THREE.GridHelper(60, 30, 0x1a1a3a, 0x111128);
    grid.position.set(30, -0.05, 15);
    // Scale Z to half
    grid.scale.set(1, 1, 0.5);
    this.scene.add(grid);
  }

  _addAxisLabels() {
    // We'll add simple sprite labels for axes
    this._addTextSprite('Time →', 30, -1.5, -2, 0xaaaacc);
    this._addTextSprite('Frequency →', -3, -1.5, 15, 0xaaaacc, true);
    this._addTextSprite('Amplitude', -3, 8, -2, 0xaaaacc);
  }

  _addTextSprite(text, x, y, z, color, rotated = false) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.7 });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(x, y, z);
    sprite.scale.set(12, 3, 1);
    this.scene.add(sprite);
    this._labelSprites.push(sprite);
  }

  render(ctx) {
    if (!this._needsUpdate || !ctx.features || !ctx.features.spectrogram || ctx.features.spectrogram.length === 0) return;
    this._needsUpdate = false;
    this._features = ctx.features;
    this._buildTerrain();
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || 500;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setBand(bandKey) {
    if (!BANDS[bandKey] || this._activeBand === bandKey) return;
    this._activeBand = bandKey;
    // Update button styling
    Object.entries(this._bandButtons).forEach(([key, btn]) => {
      btn.classList.toggle('active', key === bandKey);
    });
    if (this._features) {
      this._buildTerrain();
    }
  }

  setAutoRotate(enabled) {
    this._autoRotate = enabled;
    if (this.controls) {
      this.controls.autoRotate = enabled;
      this.controls.autoRotateSpeed = 1.2;
    }
  }

  _buildTerrain() {
    // Clear old
    while (this.terrainGroup.children.length > 0) {
      const child = this.terrainGroup.children[0];
      this.terrainGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
        else child.material.dispose();
      }
    }

    const features = this._features;
    const spec = features.spectrogram;
    const band = BANDS[this._activeBand];

    // Determine resolution based on data - cap for performance
    const maxFrames = 150;
    const maxBins = 80;

    const totalBins = spec[0].length;
    const binStart = Math.floor(band.range[0] * totalBins);
    const binEnd = Math.min(Math.ceil(band.range[1] * totalBins), totalBins);
    const bandBins = binEnd - binStart;

    const frameStep = Math.max(1, Math.ceil(spec.length / maxFrames));
    const binStep = Math.max(1, Math.ceil(bandBins / maxBins));

    const numX = Math.min(maxFrames, Math.ceil(spec.length / frameStep));
    const numZ = Math.min(maxBins, Math.ceil(bandBins / binStep));

    if (numX < 2 || numZ < 2) return;

    // Build geometry
    const geometry = new THREE.PlaneGeometry(60, 30, numX - 1, numZ - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const colors = new Float32Array(positions.length);

    // Find max for normalization
    let maxVal = 0;
    for (let iz = 0; iz < numZ; iz++) {
      for (let ix = 0; ix < numX; ix++) {
        const fi = Math.min(ix * frameStep, spec.length - 1);
        const bi = Math.min(binStart + iz * binStep, totalBins - 1);
        const v = Math.log10(spec[fi][bi] + 1e-6) + 6;
        if (v > maxVal) maxVal = v;
      }
    }
    if (maxVal <= 0) maxVal = 1;

    const hslColor = new THREE.Color();
    const [baseHue, baseSat, baseLit] = band.color;

    for (let iz = 0; iz < numZ; iz++) {
      for (let ix = 0; ix < numX; ix++) {
        const idx = iz * numX + ix;
        const fi = Math.min(ix * frameStep, spec.length - 1);
        const bi = Math.min(binStart + iz * binStep, totalBins - 1);

        let val = Math.log10(spec[fi][bi] + 1e-6) + 6;
        val = Math.max(0, val) / maxVal;

        // Height
        positions[idx * 3 + 1] = val * 15;

        // Color: use band base hue, vary lightness with amplitude
        const hueShift = (iz / numZ) * 0.15; // slight hue variation across frequency
        const hue = (baseHue + hueShift) % 1.0;
        const lightness = 0.08 + val * 0.55;
        hslColor.setHSL(hue, baseSat, lightness);

        colors[idx * 3] = hslColor.r;
        colors[idx * 3 + 1] = hslColor.g;
        colors[idx * 3 + 2] = hslColor.b;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Main mesh - use Lambert for speed
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.terrainGroup.add(mesh);

    // Subtle wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.03,
    });
    const wire = new THREE.Mesh(geometry.clone(), wireMat);
    wire.position.y = 0.02;
    this.terrainGroup.add(wire);
  }

  _animate() {
    const loop = () => {
      this._animFrame = requestAnimationFrame(loop);
      if (this.controls) this.controls.update();
      if (this.renderer && this.scene && this.camera) {
        this.renderer.render(this.scene, this.camera);
      }
    };
    loop();
  }

  destroy() {
    if (this._animFrame) cancelAnimationFrame(this._animFrame);
    if (this.renderer) this.renderer.dispose();
  }
}
