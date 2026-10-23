// Atmospheric sky + drifting cloud dome + image-based lighting from the sky.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { NOISE_GLSL } from './glsl.js';

export class SkySystem {
  constructor(renderer, scene, opts = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(3500);
    this.sky.material.depthWrite = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);
    const u = this.sky.material.uniforms;
    u.turbidity.value = opts.turbidity ?? 5.5;
    u.rayleigh.value = opts.rayleigh ?? 1.6;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.sun = new THREE.Vector3();

    // clouds
    this.cloudUniforms = {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3() },
      uCover: { value: opts.cloudCover ?? 0.45 },
      uSunCol: { value: new THREE.Color(1, 0.9, 0.75) },
      uShadeCol: { value: new THREE.Color(0.55, 0.58, 0.66) },
    };
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w * 0.99999; }`,
      fragmentShader: /* glsl */`
        ${NOISE_GLSL}
        uniform float uTime; uniform vec3 uSun; uniform float uCover; uniform vec3 uSunCol; uniform vec3 uShadeCol;
        varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          if (d.y < 0.0) discard;
          vec2 uv = d.xz / (d.y + 0.12);
          vec2 wind = vec2(uTime * 0.004, uTime * 0.0015);
          vec3 p = vec3(uv * 1.1 + wind, uTime * 0.002);
          float n = fbm5(p) * 0.65 + fbm3(p * 3.1 + 7.0) * 0.35;
          float c = smoothstep(0.55 - uCover, 0.95 - uCover, n + 0.25);
          // wispy streaks high up
          float cirrus = smoothstep(0.35, 0.8, fbm3(vec3(uv.x*0.6 + wind.x*2.0, uv.y*3.0, 3.0))) * 0.35;
          c = max(c, cirrus * (1.0 - c));
          // lighting: thicker = darker underside, rim brighter towards the sun
          float thick = smoothstep(0.0, 1.0, (n + 0.25 - (0.55 - uCover)) * 2.0);
          float sunAmt = pow(max(dot(d, normalize(uSun)), 0.0), 6.0);
          vec3 col = mix(uSunCol, uShadeCol, thick * 0.75);
          col += uSunCol * sunAmt * (1.0 - thick) * 1.2;
          float horizon = smoothstep(0.0, 0.18, d.y);
          gl_FragColor = vec4(col, c * horizon * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), cloudMat);
    this.clouds.renderOrder = -9;
    scene.add(this.clouds);

    // env scene for PMREM
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(50);
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
  }

  setSun(elevationDeg, azimuthDeg) {
    const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
    const theta = THREE.MathUtils.degToRad(azimuthDeg);
    this.sun.setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sun);
    this.cloudUniforms.uSun.value.copy(this.sun);
    // cloud colours with sun height
    const e = Math.max(0, elevationDeg) / 50;
    const warm = new THREE.Color(1.0, 0.62, 0.38), noon = new THREE.Color(1.0, 0.97, 0.93);
    this.cloudUniforms.uSunCol.value.copy(warm).lerp(noon, Math.min(1, e));
    this.cloudUniforms.uShadeCol.value.set(0.42, 0.45, 0.54).lerp(new THREE.Color(0.66, 0.69, 0.76), Math.min(1, e));
    // env map: rebuilding the PMREM is the costly part, so slow seasonal drift only refreshes it every few degrees
    if (this._envEl !== undefined && Math.abs(elevationDeg - this._envEl) < 3.5) return this.sun;
    this._envEl = elevationDeg;
    const eu = this.envSky.material.uniforms, su = this.sky.material.uniforms;
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) eu[k].value = su[k].value;
    eu.sunPosition.value.copy(this.sun);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
    this.scene.environment = this.envRT.texture;
    return this.sun;
  }

  update(t) { this.cloudUniforms.uTime.value = t; }

  dispose() {
    this.scene.remove(this.sky, this.clouds);
    if (this.envRT) this.envRT.dispose();
    this.pmrem.dispose();
  }
}
