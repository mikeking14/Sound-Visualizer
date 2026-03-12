// 3D combined visualization using Three.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
    this.mesh = null;
    this.pointCloud = null;
    this._needsUpdate = true;
    this._animFrame = null;

    state.on('features', () => { this._needsUpdate = true; });
  }

  init(container) {
    this.container = container;
    const w = container.clientWidth;
    const h = container.clientHeight || 300;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.scene.fog = new THREE.Fog(0x0a0a1a, 50, 200);

    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 500);
    this.camera.position.set(30, 20, 30);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(15, 5, 15);

    // Lighting
    const ambient = new THREE.AmbientLight(0x404060, 0.5);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(20, 40, 20);
    this.scene.add(dir);

    // Grid helper
    const grid = new THREE.GridHelper(60, 60, 0x222244, 0x111133);
    this.scene.add(grid);

    // Axes
    const axes = new THREE.AxesHelper(5);
    this.scene.add(axes);

    this._animate();
  }

  render(ctx) {
    if (!this._needsUpdate || !ctx.features || !ctx.features.spectrogram || ctx.features.spectrogram.length === 0) return;
    this._needsUpdate = false;
    this._buildTerrain(ctx.features);
  }

  resize() {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || 300;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _buildTerrain(features) {
    // Remove old
    if (this.mesh) { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
    if (this.pointCloud) { this.scene.remove(this.pointCloud); this.pointCloud.geometry.dispose(); this.pointCloud.material.dispose(); }

    const spec = features.spectrogram;
    const maxFrames = 200;
    const maxBins = 100;
    const frameStep = Math.max(1, Math.floor(spec.length / maxFrames));
    const binStep = Math.max(1, Math.floor(spec[0].length / maxBins));

    const numX = Math.min(maxFrames, spec.length);
    const numZ = Math.min(maxBins, spec[0].length);

    // Build terrain geometry
    const geometry = new THREE.PlaneGeometry(60, 30, numX - 1, numZ - 1);
    geometry.rotateX(-Math.PI / 2);

    const positions = geometry.attributes.position.array;
    const colors = new Float32Array(positions.length);

    // Find max value for normalization
    let maxVal = 0;
    for (let i = 0; i < spec.length; i += frameStep) {
      for (let j = 0; j < spec[i].length; j += binStep) {
        const v = Math.log10(spec[i][j] + 1e-6) + 6;
        if (v > maxVal) maxVal = v;
      }
    }
    if (maxVal === 0) maxVal = 1;

    for (let iz = 0; iz < numZ; iz++) {
      for (let ix = 0; ix < numX; ix++) {
        const idx = iz * numX + ix;
        const frameIdx = Math.min(ix * frameStep, spec.length - 1);
        const binIdx = Math.min(iz * binStep, spec[frameIdx].length - 1);

        let val = Math.log10(spec[frameIdx][binIdx] + 1e-6) + 6;
        val = Math.max(0, val) / maxVal;

        // Set Y (height)
        positions[idx * 3 + 1] = val * 15;

        // Color based on height + spectral centroid
        const centroid = features.spectralCentroid[frameIdx] || 0;
        const maxCentroid = features.sampleRate / 4;
        const hue = (centroid / maxCentroid) * 0.7;

        const color = new THREE.Color();
        color.setHSL(hue, 0.8, 0.2 + val * 0.6);
        colors[idx * 3] = color.r;
        colors[idx * 3 + 1] = color.g;
        colors[idx * 3 + 2] = color.b;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 30,
      side: THREE.DoubleSide,
      wireframe: false,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Add wireframe overlay
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      opacity: 0.05,
      transparent: true,
    });
    const wireMesh = new THREE.Mesh(geometry.clone(), wireMaterial);
    wireMesh.position.y = 0.01;
    this.mesh.add(wireMesh);
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
