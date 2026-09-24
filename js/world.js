// Мир сайта: блоковый рельеф с рекой и прудами, лес, руины, погода, ночь с туманом у земли.
// Одна сцена на всю страницу — камера перелетает между «площадками» (шапка, орда, поселение) по мере прокрутки.
// Картинка — как Майнкрафт с шейдерами: PBR-блоки с рельефом, стелющийся туман, отражения неба в воде,
// мягкие тени, свечение, затенение в стыках (GTAO), цветокор. «Настроение» (закат, ночь, гроза, кровавая луна)
// плавно перетекает при смене сцены.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { tex, mat, WIND, LAMP } from './models.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ------------------------------------------------------------------ туман у земли: во всех материалах сцены
// Обычный туман — по расстоянию; к нему добавлен стелющийся слой: гуще у земли и в низинах, редеет вверх.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth; varying vec3 vFogWorld;\n#endif';
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vec4 fogW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogW = instanceMatrix * fogW;
  #endif
  vFogWorld = (modelMatrix * fogW).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor; varying float vFogDepth; varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear; uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    float low = exp( - max( vFogWorld.y - 4.2, 0.0 ) * 0.42 );
    float mist = ( 1.0 - exp( - vFogDepth * 0.045 ) ) * low * 0.55;
    fogFactor = clamp( fogFactor + mist * ( 1.0 - fogFactor ), 0.0, 1.0 );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;

// ------------------------------------------------------------------ блоки мира: что на гранях, прозрачен ли
// Весь неподвижный мир (земля, лес, руины, частокол) хранится как воксели и «запекается» в сетку:
// рисуются только видимые грани, в углах — затенение как в Майнкрафте (smooth lighting), по чанкам 32×32.
const TYPES = {
  grass: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' },
  log: { top: 'log_top', side: 'log', bump: 1.2 }, spruce_log: { top: 'log_top', side: 'spruce_log', bump: 1.2 },
  burnt_log: { side: 'burnt_log', bump: 1.2 },
  leaves: { trans: true, wind: 0.05 }, spruce_leaves: { trans: true, wind: 0.04 }, dead_leaves: { trans: true, wind: 0.05 },
  ash: { glow: 0.25 }, sand: { bump: 0.6 }, mossy_cobble: { bump: 1.2 },
  cobble: { bump: 1.2 }, bricks: { bump: 1.2 }, cracked_bricks: { bump: 1.2 },
  dirt: {}, stone: {}, path: {}, gravel: {}, mud: {}, planks: {}, spruce_planks: {}, burnt_planks: {}, hay: {}, wool_red: {}, wool_white: {},
};
const vkey = (x, y, z) => ((x + 1024) * 2048 + (z + 1024)) * 256 + (y + 64);
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]] },
];
const AO = [0.42, 0.6, 0.8, 1];

// ------------------------------------------------------------------ шум для рельефа
export function hash(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
export function smooth(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// площадки: шапка (лагерь у частокола), орда (поле), поселение (растёт)
export const SITES = [
  { name: 'hero', x: 0, z: 0, r: 22, h: 3 },
  { name: 'horde', x: 70, z: -10, r: 30, h: 3 },
  { name: 'town', x: -70, z: 10, r: 28, h: 3 },
];
export const WATER = 2.72;                 // уровень воды (верх блока земли — h + 1)

/** Река: извилистое русло между лагерем и полем орды. */
export function riverDist(x, z) {
  const cx = 36 + Math.sin(z * 0.045) * 7 + Math.sin(z * 0.11) * 2;
  return Math.abs(x - cx);
}

/** Высота земли (в блоках) в точке — площадки выровнены, вокруг холмы, река и низины с прудами. */
export function heightAt(x, z) {
  x = Math.floor(x);
  z = Math.floor(z);
  let h = smooth(x * 0.045, z * 0.045) * 6 + smooth(x * 0.13, z * 0.13) * 2 - 0.6;
  const far = Math.hypot(x * 0.6, z) / 60;
  h += Math.max(0, far - 1) * 6;                              // к краям — холмы выше, горизонт не плоский
  const rd = riverDist(x + 0.5, z + 0.5);
  if (rd < 9) {
    const k = rd / 9, e = k * k * (3 - 2 * k);
    h = h * e + (rd < 3.2 ? 0 : 1.2) * (1 - e);
  }
  for (const s of SITES) {
    const d = Math.hypot(x + 0.5 - s.x, z + 0.5 - s.z);
    const flat = s.r * 0.65;
    if (d <= flat) return s.h;                                  // площадка сцены — ровная: ничего не висит
    if (d < s.r) {
      const k = (d - flat) / (s.r - flat);
      const e = k * k * (3 - 2 * k);
      h = s.h + (h - s.h) * e;
    }
  }
  return Math.floor(h);
}

/** Сухо ли на блоке (верх выше воды) — туда можно ставить траву, деревья, мобов. */
export const dry = (x, z) => heightAt(x, z) + 1 > WATER + 0.1;

// ------------------------------------------------------------------ настроения
const C = (h) => new THREE.Color(h);
export const LOOKS = {
  night: { zenith: 0x04040c, horizon: 0x221a38, glow: 0x9aa4ff, fog: 0x100d1c, fogD: 0.021, light: 0xaab6ff, lightI: 2.5,
    sky: 0x6a70b0, ground: 0x2e2018, hemiI: 1.35, dir: [-60, 120, 90], moon: [-120, 90, -160], disc: 0xe4e8ff, discSize: 9, exposure: 1.6,
    bloom: 0.75, rain: 0, stars: 1, wind: 1, tint: [0.84, 0.88, 1.08] },
  dusk: { zenith: 0x1c2658, horizon: 0xe07a48, glow: 0xffb46e, fog: 0x3a2836, fogD: 0.014, light: 0xffb27a, lightI: 3.2,
    sky: 0x9a90c4, ground: 0x5a3a26, hemiI: 1.6, dir: [150, 62, -40], disc: 0xffd6a0, discSize: 12, exposure: 1.15,
    bloom: 0.6, rain: 0, stars: 0.15, wind: 0.8, tint: [0.92, 0.88, 1.02] },
  deep: { zenith: 0x020308, horizon: 0x141a30, glow: 0x7a90d0, fog: 0x0c101e, fogD: 0.024, light: 0x9aaee8, lightI: 2.0,
    sky: 0x4a5488, ground: 0x201a14, hemiI: 1.05, dir: [110, 95, 70], moon: [80, 70, -170], disc: 0xd8e0ff, discSize: 7, exposure: 1.55,
    bloom: 0.85, rain: 0, stars: 1, wind: 1.2, tint: [0.8, 0.9, 1.12] },
  storm: { zenith: 0x0a0c12, horizon: 0x262a36, glow: 0x5a6070, fog: 0x1c2028, fogD: 0.027, light: 0x9aa6c0, lightI: 2.1,
    sky: 0x5a6478, ground: 0x221e1a, hemiI: 1.7, dir: [-50, 120, 80], disc: 0x606878, discSize: 0.1, exposure: 1.55,
    bloom: 0.7, rain: 1, stars: 0, wind: 2.6, tint: [0.86, 0.92, 1.04], storm: true },
  blood: { zenith: 0x0e0306, horizon: 0x4a0c14, glow: 0xff4a3a, fog: 0x1c080e, fogD: 0.026, light: 0xff9a80, lightI: 2.4,
    sky: 0x5a3a5a, ground: 0x241010, hemiI: 1.1, dir: [-60, 110, 90], moon: [-100, 70, -170], disc: 0xff3a2a, discSize: 13, exposure: 1.65,
    bloom: 1.25, rain: 0, stars: 0.3, wind: 1.5, tint: [1.04, 0.84, 0.9], embers: 1 },
  town: { zenith: 0x06050e, horizon: 0x2e2238, glow: 0xb0a0ff, fog: 0x15101c, fogD: 0.019, light: 0xb4b8ff, lightI: 2.3,
    sky: 0x6a64a0, ground: 0x302018, hemiI: 1.3, dir: [-60, 120, 90], moon: [-120, 90, -160], disc: 0xe8e8ff, discSize: 9, exposure: 1.3,
    bloom: 0.8, rain: 0, stars: 1, wind: 0.8, tint: [0.9, 0.88, 1.04] },
};

export class World {
  constructor(canvas) {
    this.canvas = canvas;
    const mobile = matchMedia('(max-width: 760px)').matches;
    this.mobile = mobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !mobile, powerPreference: 'high-performance' });
    this.maxRatio = Math.min(devicePixelRatio, mobile ? 1.25 : 1.5);
    // слабое железо (встройка, мало ядер, мало памяти) — сразу стартуем упрощённо, не ждём первых рывков
    let gpu = '';
    try {
      const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    } catch { /* нет сведений */ }
    this.weak = mobile || /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic|radeon\(tm\) graphics|vega \d graphics/i.test(gpu)
      || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    // старт — около 3 млн пикселей кадра (1080p чётко, 4K чуть мягче); дальше по скорости видеокарты:
    // мощная поднимет до полного разрешения экрана, слабая опустит до ~1 млн пикселей и упростит эффекты
    this.ratio = Math.min(this.maxRatio, this.pixels(this.weak ? 1.1e6 : 2.2e6));
    this.level = 0;                                   // ступень упрощения: 0 — полное качество
    this.renderer.setPixelRatio(this.ratio);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x100d1c, 0.021);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this.camera.position.set(0, 12, 30);
    this.clock = new THREE.Clock();
    this.updaters = [];
    this.lookName = 'night';
    LAMP.add = (spec) => this.lamp(spec);
    this.cur = this.lookState(LOOKS.night);

    this.lights();
    this.sky();
    this.clouds();
    const lite = this.weak;
    this.terrain(mobile ? 72 : 110);
    this.water();
    this.forest();
    this.plants(mobile ? 1200 : lite ? 1800 : 3000);
    this.skyline();
    this.ruins();
    this.rain(mobile ? 900 : lite ? 1200 : 2000);
    this.fireflies(mobile ? 60 : lite ? 90 : 150);
    this.ash(mobile ? 400 : lite ? 450 : 800);
    this.embers(mobile ? 200 : lite ? 300 : 500);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.8, 0.6, 0.6);
    const bs = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (w, h) => bs(Math.round(w / 2), Math.round(h / 2));
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // кадр как в трейлере: цветокор, мягкий свет в светах (halation), виньетка, зерно, аберрация по краям
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, t: { value: 0 }, tint: { value: new THREE.Vector3(0.84, 0.88, 1.08) }, flash: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float t; uniform vec3 tint; uniform float flash; varying vec2 vUv;
        float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + t*7.) * 43758.5453); }
        void main(){
          vec2 c = vUv - .5; float r = dot(c, c);
          vec2 off = c * r * .01;
          vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
          float l = dot(col, vec3(.299,.587,.114));
          col *= mix(tint, vec3(1.06,1.0,.92), smoothstep(.06,.6,l));     // холодные тени, тёплые света
          col = mix(vec3(l), col, 1.1);                                    // плотнее цвет
          col = col / (1. + col * .08);                                    // мягкое плечо в светах
          col += flash * vec3(.55,.6,.75) * (1. - r);                      // вспышка молнии
          col *= 1. - smoothstep(.14, .7, r) * .62;                        // виньетка
          col += (rnd(vUv*vec2(1920.,1080.)) - .5) * .035;                 // зерно
          gl_FragColor = vec4(col, 1.);
        }`,
    });
    this.composer.addPass(this.grade);
    this.updaters.push((dt, t) => {
      this.grade.uniforms.t.value = t;
      WIND.time.value = t;
      this.blend(dt, t);
    });
    if (this.weak) {
      this.simplify(++this.level);
      this.simplify(++this.level);
    }
    this.resize();
    addEventListener('resize', () => this.resize());
    // вкладка не видна / сцена за краем — не рисуем (экономит GPU на слабых машинах и ноутбуках)
    document.addEventListener('visibilitychange', () => this.clock.getDelta());
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setPixelRatio(this.ratio);
    this.composer.setPixelRatio(this.ratio);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ================================================================== свет и небо
  lights() {
    this.hemi = new THREE.HemisphereLight(0x5c62a0, 0x2a1c18, 1.0);
    this.scene.add(this.hemi);
    this.moon = new THREE.DirectionalLight(0xaab6ff, 1.9);
    this.moon.castShadow = true;
    const S = this.mobile || this.weak ? 1024 : 2048;
    this.moon.shadow.mapSize.set(S, S);
    this.moon.shadow.bias = -0.0003;
    this.moon.shadow.normalBias = 0.035;
    this.moon.shadow.radius = 4;
    const c = this.moon.shadow.camera;
    c.left = c.bottom = -30;
    c.right = c.top = 30;
    c.near = 1;
    c.far = 220;
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);
    this.moonDir = new THREE.Vector3(-120, 90, -160).normalize();
    this.focus = new THREE.Vector3();
  }

  sky() {
    this.skyUni = {
      zenith: { value: C(0x04040c) }, horizon: { value: C(0x221a38) }, glow: { value: C(0x9aa4ff) },
      dir: { value: new THREE.Vector3(-120, 90, -160).normalize() }, flash: { value: 0 },
    };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyUni,
      vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform vec3 zenith, horizon, glow, dir; uniform float flash; varying vec3 d;
        void main(){
          float h = clamp(d.y, -.3, 1.);
          vec3 col = mix(horizon, zenith, pow(smoothstep(-.04, .7, h), .6));
          col = mix(col, horizon * .55, smoothstep(0., -.3, h));              // под горизонтом — дымка
          float m = max(dot(d, dir), 0.);
          col += glow * (pow(m, 90.) * 1.2 + pow(m, 10.) * .22 + pow(m, 3.) * .06 * (1. - h));
          col += vec3(.5,.55,.7) * flash * (1. - h * .5);
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
    dome.renderOrder = -2;
    this.dome = dome;
    this.scene.add(dome);
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshBasicMaterial({ color: 0xe4e8ff, fog: false }));
    this.disc.renderOrder = -1;
    this.scene.add(this.disc);
    // звёзды: мерцают
    const n = 1400, pos = new Float32Array(n * 3), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.pow(Math.random(), 0.7) * 1.35 + 0.05, r = 380;
      pos.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
      sz[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(sz, 1));
    this.starUni = { t: { value: 0 }, amount: { value: 1 } };
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.starUni, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float t; varying float a;
        void main(){ a = (.45 + .55 * sin(t * (1. + seed * 3.) + seed * 40.)) * (.3 + seed * .7);
          gl_PointSize = 1.2 + seed * 1.8; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: `uniform float amount; varying float a;
        void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.85,.85,1.), a * amount * smoothstep(.5,.1,d)); }`,
    }));
    this.scene.add(this.stars);
    this.updaters.push((dt, t) => {
      this.starUni.t.value = t;
      this.dome.position.copy(this.camera.position);
      this.stars.position.copy(this.camera.position);
      this.disc.position.copy(this.camera.position).addScaledVector(this.skyUni.dir.value, 360);
      this.disc.lookAt(this.camera.position);
    });
    // отражение неба для воды и глянца (обновляется при смене настроения)
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), dome.material));
  }

  /** Облака: слои дымчатых пятен плывут по небу и через луну. */
  clouds() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    for (let i = 0; i < 60; i++) {
      const x = 30 + Math.random() * 196, y = 80 + Math.random() * 100, r = 16 + Math.random() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.25)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 256, 256);
    }
    const tx = new THREE.CanvasTexture(c);
    this.cloudMat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.5, depthWrite: false, fog: false, color: 0x3e3852 });
    this.cloudList = [];
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(160, 70), this.cloudMat);
      const a = -Math.PI * 0.9 + (i / 14) * Math.PI * 1.1;
      m.position.set(Math.cos(a) * 300, 70 + Math.random() * 60, Math.sin(a) * 300 - 40);
      m.lookAt(0, m.position.y * 0.2, 0);
      m.userData.a = a;
      m.renderOrder = -1;
      this.scene.add(m);
      this.cloudList.push(m);
    }
    this.updaters.push((dt) => {
      for (const m of this.cloudList) {
        m.userData.a += dt * 0.004 * WIND.strength.value;
        m.position.x = Math.cos(m.userData.a) * 300;
        m.position.z = Math.sin(m.userData.a) * 300 - 40;
        m.lookAt(0, m.position.y * 0.2, 0);
      }
    });
  }

  // ================================================================== рельеф
  /** Верхний блок: трава, пепел, песок у воды, тропы, гравий, грязь; под ним земля и камень — инстансами. */
  terrain(N) {
    const lists = { grass: [], ash: [], sand: [], path: [], gravel: [], mud: [], dirt: [], stone: [], mossy: [] };
    const half = N / 2;
    const done = new Set();
    this.extent = [];
    for (const s of [{ x: 0, z: 0 }, { x: 70, z: -10 }, { x: -70, z: 10 }]) {
      this.extent.push([s.x - half, s.z - half, s.x + half, s.z + half]);
      for (let i = -half; i < half; i++) for (let j = -half; j < half; j++) {
        const x = s.x + i, z = s.z + j;
        const key = x + ',' + z;
        if (done.has(key)) continue;
        done.add(key);
        const h = heightAt(x, z);
        const top = h + 1;
        const wet = top <= WATER + 0.3;
        const nearWater = !wet && (top <= WATER + 1.3 && (riverDist(x, z) < 7 || heightAt(x + 2, z) + 1 <= WATER || heightAt(x - 2, z) + 1 <= WATER
          || heightAt(x, z + 2) + 1 <= WATER || heightAt(x, z - 2) + 1 <= WATER));
        let kind = 'grass';
        if (wet) kind = hash(x * 0.3, z * 0.3) > 0.6 ? 'gravel' : hash(x * 0.7, z) > 0.5 ? 'mud' : 'sand';
        else if (nearWater) kind = 'sand';
        else if (smooth(x * 0.09 + 9, z * 0.09) > 0.7 || hash(x * 0.21, z * 0.21) > 0.93) kind = 'ash';
        else if (h >= 6 && hash(x, z) > 0.55) kind = 'mossy';
        else if (smooth(x * 0.2, z * 0.2 + 40) > 0.82) kind = 'gravel';
        lists[kind].push([x, h, z]);
        const low = Math.min(heightAt(x + 1, z), heightAt(x - 1, z), heightAt(x, z + 1), heightAt(x, z - 1), h - 1);
        for (let y = h - 1; y >= low - 1; y--) (y >= h - 2 ? lists.dirt : lists.stone).push([x, y, z]);
      }
    }
    // тропы: от лагеря к реке и к полю орды, к поселению — утоптанная земля
    const paths = [[[0, 8], [18, 4], [34, -2], [52, -8], [70, -10]], [[0, 8], [-20, 10], [-40, 12], [-70, 10]]];
    const onPath = new Set();
    for (const p of paths) for (let k = 0; k < p.length - 1; k++) {
      const [ax, az] = p[k], [bx, bz] = p[k + 1];
      const n = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= n; s += 0.5) {
        const x = Math.floor(ax + (bx - ax) * s / n + Math.sin(s * 0.3) * 1.2), z = Math.floor(az + (bz - az) * s / n);
        for (const [dx, dz] of [[0, 0], [1, 0], [0, 1]]) onPath.add((x + dx) + ',' + (z + dz));
      }
    }
    this.onPath = onPath;
    for (const k of ['grass', 'ash', 'mossy', 'gravel']) {
      lists[k] = lists[k].filter(([x, h, z]) => {
        if (onPath.has(x + ',' + z) && heightAt(x, z) + 1 > WATER + 0.3) {
          lists.path.push([x, h, z]);
          return false;
        }
        return true;
      });
    }
    for (const k in lists) {
      const type = k === 'mossy' ? 'mossy_cobble' : k;
      for (const [x, y, z] of lists[k]) this.put(x, y, z, type);
    }
  }

  /** Поставить блок в запекаемый мир. */
  put(x, y, z, type) {
    (this.vox ||= new Map()).set(vkey(x, y, z), type);
    this.voxDirty = true;
  }

  /**
   * Запекание: из вокселей — сетка видимых граней по чанкам и материалам. Грань, закрытая соседним
   * непрозрачным блоком, не рисуется; в каждом углу грани — затенение по трём соседям (как smooth lighting).
   */
  bake() {
    if (!this.vox || !this.voxDirty) return;
    for (const m of this.bakedMeshes || []) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.bakedMeshes = [];
    const V = this.vox, CH = 64;
    const occ = (x, y, z) => (V.has(vkey(x, y, z)) ? 1 : 0);
    const buckets = new Map();
    for (const [k, type] of V) {
      const y = (k % 256) - 64, zx = Math.floor(k / 256), z = (zx % 2048) - 1024, x = Math.floor(zx / 2048) - 1024;
      const T = TYPES[type];
      for (let f = 0; f < 6; f++) {
        const F = FACES[f], [nx, ny, nz] = F.n;
        const nb = V.get(vkey(x + nx, y + ny, z + nz));
        if (nb !== undefined && (!TYPES[nb].trans || (T.trans && TYPES[nb].trans))) continue;
        const tex = (ny > 0 ? T.top : ny < 0 ? T.bottom : T.side) || T.side || type;
        const bkey = Math.floor(x / CH) + ',' + Math.floor(z / CH) + ',' + tex + ',' + type;
        let b = buckets.get(bkey);
        if (!b) buckets.set(bkey, (b = { tex, type, pos: [], nor: [], uv: [], col: [], idx: [] }));
        const base = b.pos.length / 3;
        const ao = [];
        const axes = [0, 1, 2].filter((a) => F.n[a] === 0);
        for (let v = 0; v < 4; v++) {
          const c = F.c[v];
          b.pos.push(x + c[0], y + c[1], z + c[2]);
          b.nor.push(nx, ny, nz);
          b.uv.push(v === 1 || v === 2 ? 1 : 0, v >= 2 ? 1 : 0);
          const o = [x + nx, y + ny, z + nz];
          const s1 = [...o], s2 = [...o];
          s1[axes[0]] += c[axes[0]] ? 1 : -1;
          s2[axes[1]] += c[axes[1]] ? 1 : -1;
          const cr = [...s1];
          cr[axes[1]] += c[axes[1]] ? 1 : -1;
          const a1 = occ(...s1), a2 = occ(...s2);
          const a = a1 && a2 ? 0 : 3 - a1 - a2 - occ(...cr);
          ao.push(a);
          const l = AO[a];
          b.col.push(l, l, l);
        }
        // диагональ квадрата — по затенению, чтобы углы не «плыли»
        if (ao[0] + ao[2] < ao[1] + ao[3]) b.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
        else b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
      g.setIndex(b.idx);
      g.computeBoundingSphere();
      const T = TYPES[b.type];
      const opts = { vc: true };
      if (T.bump) opts.bump = T.bump;
      if (T.glow) opts.glow = T.glow;
      if (T.wind) opts.wind = T.wind;
      const m = new THREE.Mesh(g, mat(b.tex, opts));
      m.castShadow = true;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.scene.add(m);
      this.bakedMeshes.push(m);
    }
    this.voxDirty = false;
  }

  /** Неподвижную группу мешей склеить по материалам: вместо десятков отрисовок — несколько. */
  merge(group) {
    group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const byMat = new Map();
    const drop = [];
    group.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.material.transparent || o.material.isShaderMaterial) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      drop.push(o);
    });
    for (const o of drop) o.parent.remove(o);
    for (const [m, gs] of byMat) {
      const one = new THREE.Mesh(mergeGeometries(gs), m);
      one.castShadow = one.receiveShadow = true;
      group.add(one);
    }
    return group;
  }

  inside(x, z) {
    return this.extent.some(([a, b, c, d]) => x >= a + 1 && x < c - 1 && z >= b + 1 && z < d - 1);
  }

  block(m, x, y, z, shadow = true) {
    const o = new THREE.Mesh(this._box ||= new THREE.BoxGeometry(1, 1, 1), typeof m === 'string' ? mat(m) : m);
    o.position.set(x + 0.5, y + 0.5, z + 0.5);
    o.castShadow = shadow;
    o.receiveShadow = true;
    this.scene.add(o);
    return o;
  }

  /** Много одинаковых блоков одной отрисовкой. list: [[x, y, z], ...] */
  blocks(m, list, parent = this.scene, shadow = true) {
    if (!list.length) return null;
    if (parent === this.scene && typeof m === 'string' && TYPES[m]) {
      for (const [x, y, z] of list) this.put(x, y, z, m);          // неподвижное — в запекаемый мир
      return null;
    }
    const im = new THREE.InstancedMesh(this._box ||= new THREE.BoxGeometry(1, 1, 1), typeof m === 'string' ? mat(m) : m, list.length);
    const o = new THREE.Object3D();
    list.forEach(([x, y, z], k) => {
      o.position.set(x + 0.5, y + 0.5, z + 0.5);
      o.updateMatrix();
      im.setMatrixAt(k, o.matrix);
    });
    im.castShadow = shadow;
    im.receiveShadow = true;
    parent.add(im);
    return im;
  }

  // ================================================================== вода: рябь, отражение неба, глубина
  water() {
    const n = tex('water_n', false);
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.magFilter = THREE.LinearFilter;
    n.minFilter = THREE.LinearMipmapLinearFilter;
    n.repeat.set(24, 24);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x0e1a24, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86,
      normalMap: n, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4, depthWrite: false,
    });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(260, 150), this.waterMat);
    w.rotation.x = -Math.PI / 2;
    w.position.set(0, WATER, -5);
    w.receiveShadow = true;
    w.renderOrder = 1;
    this.scene.add(w);
    this.updaters.push((dt, t) => {
      n.offset.set(t * 0.006, t * 0.011);
    });
    // кувшинки и камыш у воды
    const lily = [], reeds = [];
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(10 + hash(i, 3.3) * 60), z = Math.floor(-55 + hash(i, 8.1) * 110);
      const top = heightAt(x, z) + 1;
      if (top <= WATER - 0.6 && hash(i, 1.7) > 0.55) lily.push([x + hash(i, 2) * 0.6, z + hash(i, 5) * 0.6]);
      else if (top > WATER && top < WATER + 1.4 && hash(i, 4.4) > 0.35
        && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => heightAt(x + dx, z + dz) + 1 <= WATER)) reeds.push([x + 0.5, top, z + 0.5]);
    }
    const lg = new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2);
    const lm = new THREE.InstancedMesh(lg, mat('lily', { side: THREE.DoubleSide }), lily.length);
    const o = new THREE.Object3D();
    lily.forEach(([x, z], k) => {
      o.position.set(x, WATER + 0.02, z);
      o.rotation.set(0, hash(k, 9) * 6, 0);
      o.updateMatrix();
      lm.setMatrixAt(k, o.matrix);
    });
    this.scene.add(lm);
    this.cross('reeds', reeds, 1.6, 0.06);
  }

  // ================================================================== растения: трава, папоротник, цветы — колышутся
  /** Крест из двух плоскостей на каждой точке (как трава в Майнкрафте), одной отрисовкой. */
  cross(name, pts, size = 1, wind = 0.12, jitterSize = 0.4) {
    if (!pts.length) return;
    const m = mat(name, { wind, anchored: true, side: THREE.DoubleSide, cheap: true });
    const geo = new THREE.PlaneGeometry(size, size);
    geo.translate(0, size / 2, 0);
    const o = new THREE.Object3D();
    for (const part of [geo, geo.clone().rotateY(Math.PI / 2)]) {
      const im = new THREE.InstancedMesh(part, m, pts.length);
      pts.forEach(([x, y, z], i) => {
        o.position.set(x, y, z);
        o.rotation.y = hash(i, 11) * Math.PI;
        o.scale.setScalar(1 - jitterSize / 2 + hash(i, 5) * jitterSize);
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.receiveShadow = true;
      this.scene.add(im);
      (this.plantMeshes ||= []).push(im);
    }
  }

  plants(n) {
    const kinds = { tall_grass: [], dry_grass: [], fern: [], flower_red: [], flower_blue: [], flower_white: [], mushroom: [] };
    for (let i = 0; i < n; i++) {
      const s = SITES[i % 3];
      const x = s.x + (hash(i * 1.3, 7) - 0.5) * 104, z = s.z + (hash(i * 2.1, 3) - 0.5) * 104;
      const bx = Math.floor(x), bz = Math.floor(z);
      if (!this.inside(bx, bz) || !dry(bx, bz) || this.onPath.has(bx + ',' + bz)) continue;
      const y = heightAt(bx, bz) + 1;
      const r = hash(i, 13), lush = smooth(x * 0.06, z * 0.06);
      const k = r < 0.03 ? 'flower_red' : r < 0.05 ? 'flower_blue' : r < 0.07 ? 'flower_white' : r < 0.08 ? 'mushroom'
        : lush > 0.55 ? (r < 0.25 ? 'fern' : 'tall_grass') : 'dry_grass';
      kinds[k].push([x, y, z]);
    }
    this.cross('tall_grass', kinds.tall_grass, 1, 0.14);
    this.cross('dry_grass', kinds.dry_grass, 0.9, 0.12);
    this.cross('fern', kinds.fern, 1.1, 0.1);
    this.cross('flower_red', kinds.flower_red, 0.8, 0.1, 0.2);
    this.cross('flower_blue', kinds.flower_blue, 0.8, 0.1, 0.2);
    this.cross('flower_white', kinds.flower_white, 0.8, 0.1, 0.2);
    this.cross('mushroom', kinds.mushroom, 0.6, 0.02, 0.2);
  }

  // ================================================================== лес: дубы, ели, мёртвые деревья
  forest() {
    const logs = [], spruce = [], dead = [], leaves = [], needles = [], dryLeaves = [];
    const clear = (x, z) => {
      for (const s of SITES) {
        const d = Math.hypot(x - s.x, z - s.z);
        if (d < s.r * 0.95) return false;
        // перед камерой каждой площадки — просека: деревья не заслоняют сцену
        if (z > s.z && Math.abs(x - s.x) < s.r * 0.9 && z - s.z < 42) return false;
      }
      return true;
    };
    const L = (list, x, y, z) => list.push([x, y, z]);
    const oak = (x, z, y, k) => {
      const hgt = 4 + Math.floor(hash(k, 3) * 3);
      for (let i = 0; i < hgt; i++) L(logs, x, y + i, z);
      const top = y + hgt;
      for (let dy = -2; dy <= 1; dy++) {
        const r = dy === 1 ? 1 : 2;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) === r && Math.abs(dz) === r && hash(x + dx + dy, z + dz) > 0.35) continue;   // скруглённая крона
          if (dx === 0 && dz === 0 && dy < 0) continue;
          L(leaves, x + dx, top + dy, z + dz);
        }
      }
    };
    const pine = (x, z, y, k) => {
      const hgt = 7 + Math.floor(hash(k, 4) * 5);
      for (let i = 0; i < hgt; i++) L(spruce, x, y + i, z);
      for (let i = 2; i <= hgt; i++) {
        const r = i === hgt ? 0 : Math.max(0, Math.floor((hgt - i) / 3) + ((hgt - i) % 3 === 0 ? 1 : 0));
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          if (Math.abs(dx) + Math.abs(dz) > r + 0.5) continue;
          if (dx === 0 && dz === 0 && i < hgt) continue;
          L(needles, x + dx, y + i, z + dz);
        }
      }
      L(needles, x, y + hgt, z);
    };
    const snag = (x, z, y, k) => {
      const hgt = 3 + Math.floor(hash(k, 6) * 5);
      for (let i = 0; i < hgt; i++) L(dead, x, y + i, z);
      if (hash(k, 7) > 0.4) L(dead, x + 1, y + hgt - 2, z);
      if (hash(k, 8) > 0.5) L(dead, x, y + hgt - 3, z - 1);
      if (hash(k, 9) > 0.6) for (let dx = -1; dx <= 1; dx++) L(dryLeaves, x + dx, y + hgt, z);
    };
    const taken = new Set();
    const tries = this.mobile ? 900 : 2200;
    for (let k = 0; k < tries; k++) {
      const s = SITES[k % 3];
      const x = Math.floor(s.x + (hash(k, 21) - 0.5) * 108), z = Math.floor(s.z + (hash(k, 37) - 0.5) * 108);
      if (!this.inside(x, z) || !clear(x, z) || !dry(x, z) || this.onPath.has(x + ',' + z)) continue;
      const dense = smooth(x * 0.05 + 3, z * 0.05);
      if (hash(k, 5) > dense * 1.35) continue;
      const cell = Math.floor(x / 4) + ',' + Math.floor(z / 4);
      if (taken.has(cell)) continue;
      taken.add(cell);
      const y = heightAt(x, z) + 1;
      const kind = hash(k, 55);
      if (Math.hypot(x, z * 1.4) < 40 || kind < 0.28) snag(x, z, y, k);   // у лагеря — выгоревший лес
      else if (z < -20 || kind < 0.62) pine(x, z, y, k);
      else oak(x, z, y, k);
    }
    for (const [t, l] of [['log', logs], ['spruce_log', spruce], ['burnt_log', dead], ['leaves', leaves], ['spruce_leaves', needles], ['dead_leaves', dryLeaves]])
      for (const [x, y, z] of l) this.put(x, y, z, t);
  }

  /** Силуэты руин города на горизонте: низ тонет в дымке, в редких окнах — огни выживших. */
  skyline() {
    const hazeM = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const tower = (w, h) => {
      const g = new THREE.BoxGeometry(w, h, w, 1, 4, 1);
      const pos = g.attributes.position, col = [];
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, Math.max(0, (pos.getY(i) / h + 0.5 - 0.4) / 0.6));
        const f = 0.95 + (0.1 - 0.95) * k;                    // низ — цвет дымки горизонта, верх — почти чёрный
        col.push(f, f, f);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      return g;
    };
    this.hazeM = hazeM;
    const lit = new THREE.MeshBasicMaterial({ color: 0xffb060, fog: false });
    const rng = (k) => hash(k * 1.7, k * 9.3);
    this.skyGroup = new THREE.Group();
    for (let k = 0; k < 54; k++) {
      const a = -Math.PI * 0.98 + (k / 54) * Math.PI * 0.96;
      const r = 260 + rng(k) * 60;
      const x = Math.cos(a) * r, z = Math.sin(a) * r - 20;
      const w = 6 + rng(k + 3) * 10, h = 24 + rng(k + 5) * 30;
      const b = new THREE.Mesh(tower(w, h + 70), hazeM);
      b.position.set(x, (h + 70) / 2 - 90, z);
      b.rotation.y = rng(k + 2);
      this.skyGroup.add(b);
      if (rng(k + 7) > 0.4) {                              // обломанный верх, торчащая арматура
        const t = new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, h * 0.25, w * 0.5), hazeM);
        t.position.set(x + w * 0.2, h - 20 + h * 0.12, z);
        t.rotation.z = (rng(k + 8) - 0.5) * 0.4;
        this.skyGroup.add(t);
      }
      for (let n = 0; n < 4; n++) if (rng(k * 7 + n) > 0.74) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.4), lit);
        win.position.set(x, -6 + rng(k + n) * (h - 24), z);
        win.lookAt(0, win.position.y, 0);
        win.translateZ(w / 2 + 0.05);
        this.skyGroup.add(win);
      }
    }
    this.scene.add(this.skyGroup);
    // сотня башен и окон — две отрисовки
    this.skyGroup.updateMatrixWorld(true);
    const byMat = new Map();
    for (const o of [...this.skyGroup.children]) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.color) {
        const c = new Float32Array(g.attributes.position.count * 3).fill(1);
        g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      }
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      this.skyGroup.remove(o);
    }
    for (const [m, gs] of byMat) {
      if (m === hazeM) this.skyGroup.add(new THREE.Mesh(mergeGeometries(gs), m));
      else {
        m.vertexColors = true;
        this.skyGroup.add(new THREE.Mesh(mergeGeometries(gs), m));
      }
    }
  }

  /**
   * Руины прежнего мира вокруг площадок: обрушенные стены с проломами, остовы домов без крыш,
   * брошенные телеги, завалы, обгоревшие балки; над некоторыми — дым.
   */
  ruins() {
    const rng = (k) => hash(k * 5.3, k * 2.9);
    const L = {};
    const put = (m, x, y, z) => (L[m] ||= []).push([x, y, z]);
    let k = 0;
    for (const site of SITES) {
      const count = this.mobile ? 5 : 11;
      for (let n = 0; n < count; n++, k++) {
        const a = rng(k) * Math.PI * 2;
        const r = site.r * 0.8 + rng(k + 50) * site.r * 0.6;
        const cx = Math.floor(site.x + Math.cos(a) * r), cz = Math.floor(site.z + Math.sin(a) * r);
        if (cz > site.z + site.r * 0.3 && Math.abs(cx - site.x) < site.r * 0.8) continue;   // не заслонять сцену
        if (!dry(cx, cz) || !this.inside(cx, cz)) continue;
        const kind = Math.floor(rng(k + 7) * 5);
        const wall = ['cobble', 'bricks', 'cracked_bricks', 'mossy_cobble'][Math.floor(rng(k + 9) * 4)];
        if (kind === 0) {                                     // обрушенная стена: неровный верх, пролом
          const len = 5 + Math.floor(rng(k + 3) * 7), along = rng(k + 4) > 0.5;
          for (let i = 0; i < len; i++) {
            const x = cx + (along ? i : 0), z = cz + (along ? 0 : i);
            const hgt = Math.max(1, Math.floor(1 + rng(k * 13 + i) * 4.5 * (1 - Math.abs(i - len / 2) / len)));
            const y0 = heightAt(x, z) + 1;
            for (let y = 0; y < hgt; y++) if (!(i === Math.floor(len / 2) && y < 2)) put(wall, x, y0 + y, z);
            if (rng(k * 3 + i) > 0.7) put(wall, x + (along ? 0 : 1), heightAt(x, z + 1) + 1, z + (along ? 1 : 0));   // обломки
          }
        } else if (kind === 1) {                               // остов дома: стены углом, пустые окна, балки
          const w = 5 + Math.floor(rng(k + 5) * 3), d = 4 + Math.floor(rng(k + 6) * 3);
          const y0 = Math.max(heightAt(cx, cz), heightAt(cx + w, cz + d)) + 1;
          for (let i = 0; i <= w; i++) for (let j = 0; j <= d; j++) {
            const edge = i === 0 || j === 0 || i === w || j === d;
            const x = cx + i, z = cz + j;
            for (let y = heightAt(x, z) + 1; y < y0; y++) put('cobble', x, y, z);     // фундамент по склону
            put('planks', x, y0 - 1, z);
            if (!edge) continue;
            const corner = (i === 0 || i === w) && (j === 0 || j === d);
            const hgt = corner ? 4 : Math.floor(rng(k * 7 + i * 3 + j) * 4.2);
            for (let y = 0; y < hgt; y++) {
              if (!corner && y === 1 && (i + j) % 3 === 1) continue;                 // проёмы окон
              put(corner ? 'burnt_log' : (y === 0 ? wall : 'burnt_planks'), x, y0 + y, z);
            }
          }
          if (rng(k + 12) > 0.4) for (let i = 0; i <= w; i++) put('burnt_log', cx + i, y0 + 3, cz + Math.floor(d / 2));   // балка
          if (rng(k + 13) > 0.5) this.smoke(new THREE.Vector3(cx + w / 2, y0 + 1, cz + d / 2), 0.7);
        } else if (kind === 2) {                               // завал камня
          for (let i = 0; i < 12; i++) {
            const x = cx + Math.floor(rng(k * 3 + i) * 5) - 2, z = cz + Math.floor(rng(k * 5 + i) * 5) - 2;
            const y0 = heightAt(x, z) + 1;
            put(wall, x, y0, z);
            if (rng(k + i) > 0.6) put('gravel', x, y0 + 1, z);
          }
        } else if (kind === 3) {                               // брошенная телега
          this.cart(cx, cz, rng(k + 14) * Math.PI);
        } else {                                               // обгоревшие брёвна
          for (let i = 0; i < 3; i++) {
            const m = new THREE.Mesh(this._box ||= new THREE.BoxGeometry(1, 1, 1), mat('burnt_log'));
            const x = cx + i * 0.9, z = cz + rng(k + i) * 1.5;
            m.scale.set(3 + rng(k + i + 1) * 2, 0.55, 0.55);
            m.position.set(x, heightAt(x, z) + 1.28 + (i === 2 ? 0.52 : 0), z);
            m.rotation.y = rng(k * 11 + i) * 1.2;
            m.castShadow = m.receiveShadow = true;
            this.scene.add(m);
          }
        }
      }
    }
    for (const m in L) for (const [x, y, z] of L[m]) this.put(x, y, z, m);
  }

  /** Телега: платформа из досок, колёса, оглобли; стоит на земле. */
  cart(x, z, yaw, parent = this.scene) {
    const g = new THREE.Group();
    const y = heightAt(x, z) + 1;
    g.position.set(x + 0.5, y, z + 0.5);
    g.rotation.y = yaw;
    const plank = mat('spruce_planks'), log = mat('log');
    const part = (m, sx, sy, sz, px, py, pz, rz = 0) => {
      const o = new THREE.Mesh(this._box ||= new THREE.BoxGeometry(1, 1, 1), m);
      o.scale.set(sx, sy, sz);
      o.position.set(px, py, pz);
      o.rotation.z = rz;
      o.castShadow = o.receiveShadow = true;
      g.add(o);
    };
    part(plank, 2.6, 0.15, 1.6, 0, 0.75, 0, 0.12);                  // накренилась: колесо отвалилось
    part(plank, 2.6, 0.45, 0.1, 0, 1.0, 0.75, 0.12);
    part(plank, 2.6, 0.45, 0.1, 0, 1.0, -0.75, 0.12);
    for (const [px, pz, fall] of [[0.7, 0.9, false], [0.7, -0.9, true]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.14, 10), log);
      w.castShadow = true;
      if (fall) {
        w.position.set(-0.4, 0.07, -1.8);
      } else {
        w.rotation.x = Math.PI / 2;
        w.position.set(px, 0.62, pz);
      }
      g.add(w);
    }
    part(log, 2.2, 0.1, 0.1, 2.2, 0.35, 0.5, -0.25);
    part(log, 2.2, 0.1, 0.1, 2.2, 0.35, -0.5, -0.25);
    part(mat('hay'), 0.9, 0.6, 0.9, -0.5, 1.15, 0.2, 0.12);
    parent.add(g);
    this.merge(g);
    return g;
  }

  // ================================================================== частицы: дым, огонь, пепел, дождь, светлячки
  smokeTex() {
    if (this._smokeTex) return this._smokeTex;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return (this._smokeTex = new THREE.CanvasTexture(c));
  }

  /**
   * Частицы без пересчёта на процессоре: у каждой — номер и фаза, положение по времени считает шейдер.
   * Буферы не перезаливаются каждый кадр — меняются только два числа (время, ветер).
   */
  gpuPoints(n, vertex, fragment, uniforms, extra = {}) {
    const k = new Float32Array(n), pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) k[i] = i;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('k', new THREE.BufferAttribute(k, 1));
    for (const name in extra) g.setAttribute(name, extra[name]);
    const u = { t: WIND.time, wind: WIND.strength, scale: { value: innerHeight * 0.5 }, ...uniforms };
    const m = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, vertexShader: vertex, fragmentShader: fragment });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  }

  /** Столб дыма: мягкие клубы поднимаются, растут, сносятся ветром и тают. */
  smoke(at, strength = 1, color = 0x3a3640, parent = this.scene) {
    const N = Math.round(26 * strength);
    const p = this.gpuPoints(N, `attribute float k; uniform float t, wind, scale, n; varying float vL;
        void main(){ float L = fract(k / n + t * .09); vL = L;
          vec3 q = vec3(sin(k * 3.1 + t * .3) * .4 * L + L * 3. * wind, L * 9., cos(k * 1.7) * .4 * L);
          vec4 mv = modelViewMatrix * vec4(q, 1.); gl_PointSize = (1.2 + L * 5.) * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      `uniform sampler2D map; uniform vec3 color; varying float vL;
        void main(){ vec4 tx = texture2D(map, gl_PointCoord); gl_FragColor = vec4(color, tx.a * .42 * smoothstep(0., .15, vL) * (1. - vL)); }`,
      { map: { value: this.smokeTex() }, color: { value: new THREE.Color(color) }, n: { value: N } });
    p.position.copy(at);
    parent.add(p);
    return p;
  }

  /** Живой огонь: пламя (шум в шейдере), угли, искры вверх, свет мерцает, дымок. */
  fire(at, strength = 1, parent = this.scene) {
    const group = new THREE.Group();
    group.position.copy(at);
    const uni = { t: { value: 0 } };
    const fm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: uni,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
      fragmentShader: `uniform float t; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
          return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
        void main(){
          vec2 uv = vUv; float y = uv.y;
          float q = n(vec2(uv.x*4., y*3. - t*3.)) * .6 + n(vec2(uv.x*9., y*7. - t*5.)) * .4;
          float shape = (1. - abs(uv.x - .5) * 2.4) - y * 1.15 + q * .55;
          float a = smoothstep(.0, .35, shape);
          vec3 col = mix(vec3(1.,.3,.04), vec3(1.,.85,.45), smoothstep(.2,.8,shape));
          gl_FragColor = vec4(col * a * 1.7, a);
        }`,
    });
    for (let k = 0; k < 3; k++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * strength, 1.8 * strength), fm);
      pl.position.y = 0.9 * strength;
      pl.rotation.y = (k / 3) * Math.PI;
      group.add(pl);
    }
    // дрова и камни очага
    const log = mat('burnt_log');
    for (const r of [0.4, -0.4, 1.9]) {
      const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.25), log);
      l.position.y = 0.12;
      l.rotation.y = r + 0.8;
      l.castShadow = true;
      group.add(l);
    }
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.25, 0.35), mat('cobble'));
      s.position.set(Math.cos(a) * 0.85, 0.12, Math.sin(a) * 0.85);
      s.rotation.y = a;
      s.castShadow = s.receiveShadow = true;
      group.add(s);
    }
    const coals = new THREE.Mesh(new THREE.CircleGeometry(0.55, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.85 }));
    coals.position.y = 0.03;
    group.add(coals);
    const light = this.lamp({ obj: group, offset: new THREE.Vector3(0, 1.2, 0), color: 0xff8a3a, distance: 26, shadow: true,
      power: (t) => (30 + Math.sin(t * 13) * 5 + Math.sin(t * 4.7) * 4) * strength });
    const sparks = this.gpuPoints(60, `attribute float k; uniform float t, wind, scale, h; varying float vL;
        void main(){ float rate = .35 + mod(k, 5.) * .08; float L = fract(t * rate + fract(sin(k * 91.7) * 437.5)); vL = L;
          vec3 q = vec3(sin(k * 12.9 + L * 6.) * .3 * (1. + L) + L * wind * .8, L * 5. * h, cos(k * 7.3 + L * 5.) * .3 * (1. + L));
          vec4 mv = modelViewMatrix * vec4(q, 1.); gl_PointSize = .08 * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      `varying float vL; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(1., .63, .31, (1. - vL) * smoothstep(.5, .2, d)); }`,
      { h: { value: strength } });
    sparks.material.blending = THREE.AdditiveBlending;
    group.add(sparks);
    parent.add(group);
    this.merge(group);
    this.smoke(at.clone().add(new THREE.Vector3(0, 1.6 * strength, 0)), 0.6, 0x2a2630, parent);
    this.updaters.push((dt, t) => {
      if (!this.attached(group)) return false;
      uni.t.value = t;       // пламя; искры и дым двигает шейдер
    });
    group.userData.light = light;
    return group;
  }

  /** Пепел: медленно падает и кружит — «мир после». Движение считает шейдер. */
  ash(n) {
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) base.set([Math.random() * 60, Math.random() * 30, (Math.random() - 0.5) * 60], i * 3);
    this.ashDrift = { value: 0 };
    this.ashPts = this.gpuPoints(n, `attribute float k; attribute vec3 base; uniform float t, scale, drift; varying float a;
        void main(){ float sp = .5 + mod(k, 7.) * .08;
          vec3 q = vec3(mod(base.x + drift + sin(t * .4 + k) * .6, 60.) - 30., mod(base.y - t * sp, 30.), base.z);
          vec4 mv = modelViewMatrix * vec4(q, 1.); gl_PointSize = max(1., .06 * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      `void main(){ gl_FragColor = vec4(.66, .62, .69, .5); }`, { drift: this.ashDrift }, { base: new THREE.BufferAttribute(base, 3) });
    this.scene.add(this.ashPts);
    this.updaters.push((dt) => {
      this.ashPts.position.set(Math.floor(this.focus.x / 60) * 60, 0, Math.floor(this.focus.z / 60) * 60);
      this.ashDrift.value += dt * WIND.strength.value * 0.5;
    });
  }

  /** Искры в воздухе (кровавая луна): летят снизу вверх, светятся. Движение считает шейдер. */
  embers(n) {
    const base = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) base.set([(Math.random() - 0.5) * 70, Math.random() * 25, (Math.random() - 0.5) * 70], i * 3);
    this.emberAmount = { value: 0 };
    const p = this.gpuPoints(n, `attribute float k; attribute vec3 base; uniform float t, scale;
        void main(){ float sp = .8 + mod(k, 5.) * .3;
          vec3 q = vec3(base.x + sin(t + k) * .6, mod(base.y + t * sp, 25.), base.z);
          vec4 mv = modelViewMatrix * vec4(q, 1.); gl_PointSize = max(1., .09 * scale / -mv.z); gl_Position = projectionMatrix * mv; }`,
      `uniform float amount; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(1., .42, .23, amount * smoothstep(.5, .15, d)); }`,
      { amount: this.emberAmount }, { base: new THREE.BufferAttribute(base, 3) });
    p.material.blending = THREE.AdditiveBlending;
    this.emberMat = { set opacity(v) { p.visible = v > 0.01; p.parent && (this._a.value = v); }, _a: this.emberAmount };
    this.scene.add(p);
    this.updaters.push(() => p.visible && p.position.set(this.focus.x, 0, this.focus.z));
  }

  /** Дождь: косые струи вокруг камеры, сила и угол — от ветра; при грозе — молнии. Струи двигает шейдер. */
  rain(n) {
    const R = 34;
    const base = new Float32Array(n * 6), top = new Float32Array(n * 2), k = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = Math.random() * R * 2, y = Math.random() * 30, z = (Math.random() - 0.5) * R * 2;
      base.set([x, y, z, x, y, z], i * 6);
      top[i * 2 + 1] = 1;
      k[i * 2] = k[i * 2 + 1] = i;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(base, 3));
    g.setAttribute('top', new THREE.BufferAttribute(top, 1));
    this.rainU = { t: WIND.time, shift: { value: 0 }, lean: { value: 0 }, amount: { value: 0 } };
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float top; uniform float t, shift, lean;
        void main(){ vec3 p = position; float y = mod(p.y - t * 26., 30.);
          float x = mod(p.x + shift, 68.) - 34.;
          p = vec3(x - top * lean * .7, y + top * .7, p.z);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.); }`,
      fragmentShader: `uniform float amount; void main(){ gl_FragColor = vec4(.6, .66, .75, amount * .35); }`,
    });
    const lines = new THREE.LineSegments(g, this.rainMat);
    lines.frustumCulled = false;
    this.scene.add(lines);
    this.flashT = 0;
    this.updaters.push((dt, t) => {
      const amount = this.cur.rain;
      this.rainU.amount.value = amount;
      lines.visible = amount > 0.01;
      if (!lines.visible) return;
      lines.position.set(this.camera.position.x, 0, this.camera.position.z - 10);
      const wind = WIND.strength.value * 0.12;
      this.rainU.shift.value += dt * 26 * wind;
      this.rainU.lean.value = wind;
      // молния: двойная вспышка раз в несколько секунд
      if (this.cur.storm > 0.5) {
        this.flashT -= dt;
        if (this.flashT < 0) {
          this.flashT = 4 + Math.random() * 6;
          this.flashSeq = [0, 0.09, 0.2];
          this.flashStart = t;
        }
      }
      let f = 0;
      if (this.flashSeq) for (const s of this.flashSeq) {
        const d = t - this.flashStart - s;
        if (d > 0 && d < 0.12) f = Math.max(f, 1 - d / 0.12);
      }
      this.skyUni.flash.value = f;
      this.grade.uniforms.flash.value = f * 0.5;
      this.hemi.intensity = this.cur.hemiI + f * 3;
    });
  }

  /** Светлячки у воды и опушек: медленно плавают, мерцают тёплым светом. */
  fireflies(n) {
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const z = -50 + Math.random() * 100;
      const x = 36 + Math.sin(z * 0.045) * 7 + (Math.random() - 0.5) * 22;
      pos.set([x, heightAt(x, z) + 1.4 + Math.random() * 2, z], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.flyUni = { t: { value: 0 }, amount: { value: 1 }, scale: { value: innerHeight * 0.5 } };
    const p = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.flyUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float seed; uniform float t, scale; varying float a;
        void main(){ vec3 p = position + vec3(sin(t*.5+seed*20.)*.8, sin(t*.7+seed*9.)*.4, cos(t*.4+seed*13.)*.8);
          a = pow(max(0., sin(t*(1.+seed)+seed*30.)), 3.);
          vec4 mv = modelViewMatrix * vec4(p, 1.); gl_PointSize = .25 * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float amount; varying float a;
        void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(1., .85, .4, a * amount * smoothstep(.5, 0., d)); }`,
    }));
    p.frustumCulled = false;
    this.scene.add(p);
    this.updaters.push((dt, t) => (this.flyUni.t.value = t));
  }

  // ================================================================== настроение сцены
  lookState(L) {
    return {
      zenith: C(L.zenith), horizon: C(L.horizon), glow: C(L.glow), fog: C(L.fog), fogD: L.fogD, light: C(L.light), lightI: L.lightI,
      sky: C(L.sky), ground: C(L.ground), hemiI: L.hemiI, dir: new THREE.Vector3(...L.dir).normalize(), disc: C(L.disc),
      moonDir: new THREE.Vector3(...(L.moon || L.dir)).normalize(),
      discSize: L.discSize, exposure: L.exposure, bloom: L.bloom, rain: L.rain, stars: L.stars, wind: L.wind,
      tint: new THREE.Vector3(...L.tint), storm: L.storm ? 1 : 0, embers: L.embers || 0,
    };
  }

  /** Сменить настроение: всё перетекает плавно (цвета неба, туман, свет, дождь, ветер). */
  setLook(name) {
    if (!LOOKS[name] || name === this.lookName) return;
    this.lookName = name;
    this.goal = this.lookState(LOOKS[name]);
    this.envDirty = 1;
    this.envT = 0;
  }

  /** Отражение неба для настроения: считается один раз по цветам этого настроения и хранится. */
  envFor(name) {
    this.envCache ||= {};
    if (this.envCache[name]) return this.envCache[name];
    const u = this.skyUni, L = this.lookState(LOOKS[name]);
    const keep = { z: u.zenith.value.clone(), h: u.horizon.value.clone(), g: u.glow.value.clone(), d: u.dir.value.clone() };
    u.zenith.value.copy(L.zenith);
    u.horizon.value.copy(L.horizon);
    u.glow.value.copy(L.glow);
    u.dir.value.copy(L.moonDir);
    const rt = this.pmrem.fromScene(this.envScene, 0.02);
    u.zenith.value.copy(keep.z);
    u.horizon.value.copy(keep.h);
    u.glow.value.copy(keep.g);
    u.dir.value.copy(keep.d);
    return (this.envCache[name] = rt.texture);
  }

  async cacheEnv() {
    for (const name of Object.keys(LOOKS)) {
      this.envFor(name);
      await new Promise((r) => setTimeout(r, 0));
    }
    this.scene.environment = this.envFor(this.lookName);
  }

  /** Настроение сразу, без перетекания (после прогрева). */
  snapLook(name) {
    this.lookName = name;
    this.cur = this.lookState(LOOKS[name]);
    this.goal = this.lookState(LOOKS[name]);
    this.envDirty = 0;
    this.blend(0);
    this.scene.environment = this.envFor(name);
  }

  /** Совместимость со старым API: 0 — ночь, 1 — кровавая луна. */
  mood(k) {
    if (k >= 1) this.setLook('blood');
  }

  blend(dt) {
    const g = this.goal || this.cur, c = this.cur;
    const k = 1 - Math.exp(-dt * 1.3);
    for (const key of ['zenith', 'horizon', 'glow', 'fog', 'light', 'sky', 'ground', 'disc']) c[key].lerp(g[key], k);
    for (const key of ['fogD', 'lightI', 'hemiI', 'discSize', 'exposure', 'bloom', 'rain', 'stars', 'wind', 'storm', 'embers'])
      c[key] += (g[key] - c[key]) * k;
    c.dir.lerp(g.dir, k).normalize();
    c.moonDir.lerp(g.moonDir, k).normalize();
    c.tint.lerp(g.tint, k);
    this.skyUni.zenith.value.copy(c.zenith);
    this.skyUni.horizon.value.copy(c.horizon);
    this.skyUni.glow.value.copy(c.glow);
    this.skyUni.dir.value.copy(c.moonDir);
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.density = c.fogD;
    this.moon.color.copy(c.light);
    this.moon.intensity = c.lightI;
    this.hemi.color.copy(c.sky);
    this.hemi.groundColor.copy(c.ground);
    if (!this.flashSeq) this.hemi.intensity = c.hemiI;
    this.disc.material.color.copy(c.disc);
    this.disc.scale.setScalar(c.discSize);
    this.renderer.toneMappingExposure = c.exposure;
    this.bloom.strength = c.bloom;
    this.starUni.amount.value = c.stars;
    WIND.strength.value = c.wind;
    this.grade.uniforms.tint.value.copy(c.tint);
    this.cloudMat.color.copy(c.horizon).multiplyScalar(0.7);
    this.hazeM.color.copy(c.horizon).multiplyScalar(0.62);
    this.flyUni.amount.value = Math.max(0, 1 - c.rain * 2) * (1 - c.embers);
    this.emberMat.opacity = c.embers * 0.9;
    // отражение неба: готовое на каждое настроение (считается один раз), меняется на середине перехода
    this.envT = (this.envT || 0) + dt;
    if (this.envDirty && this.envT > 0.8) {
      this.envDirty = 0;
      this.scene.environment = this.envFor(this.lookName);
    }
  }

  /**
   * Огни сцены (костры, фонари, факелы, вспышки чар) — через постоянный набор из нескольких PointLight:
   * каждый кадр им достаются ближайшие к камере источники. Число огней не меняется — шейдеры не
   * пересобираются (раньше каждая вспышка давала рывок), а тень отбрасывает только ближайший костёр.
   * spec: { obj | pos, offset, color, power (число или функция времени), distance, shadow }
   */
  lamp(spec) {
    if (!this.pool) {
      this.pool = [];
      for (let i = 0; i < (this.mobile || this.weak ? 3 : 5); i++) {
        const l = new THREE.PointLight(0xffffff, 0, 10, 1.6);
        this.scene.add(l);
        this.pool.push(l);
      }
      this.lampList = new Set();
      this.updaters.push((dt, t) => this.lampTick(t));
    }
    const L = { ...spec, at: new THREE.Vector3(), color: new THREE.Color(spec.color ?? 0xffffff) };
    L.remove = () => this.lampList.delete(L);
    this.lampList.add(L);
    return L;
  }

  lampTick(t) {
    const cam = this.camera.position, list = [];
    for (const L of this.lampList) {
      if (L.obj) {
        if (!this.attached(L.obj)) {
          this.lampList.delete(L);
          continue;
        }
        L.obj.getWorldPosition(L.at);
        if (L.offset) L.at.add(L.offset);
      } else L.at.copy(L.pos);
      L.d = L.at.distanceToSquared(cam) * (L.shadow ? 0.6 : 1);
      L.i = typeof L.power === 'function' ? L.power(t) : L.power;
      if (L.i > 0.01) list.push(L);
    }
    list.sort((a, b) => a.d - b.d);
    const shadowL = list.find((L) => L.shadow && L.d < 45 * 45);
    const rest = list.filter((L) => L !== shadowL);
    this.pool.forEach((p, i) => {
      const L = i === 0 && p.castShadow ? shadowL : rest[i - (p.castShadow ? 1 : 0)];
      if (!L) {
        p.intensity = 0;
        p.visible = i === 0;
        return;
      }
      p.visible = true;
      p.position.copy(L.at);
      p.color.copy(L.color);
      p.intensity = L.i;
      p.distance = L.distance ?? 12;
    });
  }

  /** Свет луны и его тени следуют за точкой, куда смотрит камера: тени чёткие в кадре. */
  follow(point) {
    this.focus.copy(point);
    this.moon.target.position.copy(point);
    this.moon.position.copy(point).addScaledVector(this.cur.dir, 90);
  }

  /** Объект ещё в сцене? (сценки орды пересобираются — их огонь и дым больше не обновляем) */
  attached(o) {
    while (o.parent) o = o.parent;
    return o === this.scene;
  }

  /** Кадр: все обновители; кто вернул false — больше не нужен. */
  tick(dt, t) {
    if (this.voxDirty) this.bake();
    let gone = false;
    for (const u of this.updaters) if (u(dt, t) === false) (u.gone = true), (gone = true);
    if (gone) this.updaters = this.updaters.filter((u) => !u.gone);
  }

  pixels(n) {
    return Math.sqrt(n / Math.max(1, innerWidth * innerHeight));
  }

  /** Разрешение подстраивается: не успеваем 50+ кадров — чуть меньше пикселей, успеваем с запасом — обратно. */
  adapt(dt) {
    if (document.hidden || this.warming) return;
    this.ft = (this.ft ?? 1 / 60) * 0.95 + dt * 0.05;
    this.adaptT = (this.adaptT || 0) + dt;
    if (this.adaptT < 1.5) return;
    let r = this.ratio;
    const slow = this.ft > 1 / 50, fast = this.ft < 1 / 90 && this.adaptT > 10;
    const floor = Math.min(this.maxRatio, Math.max(0.45, this.pixels(1.0e6)));
    if (slow && r > floor + 0.01) r = Math.max(floor, r * 0.85);
    else if (slow && this.level < 5) this.simplify(++this.level);
    else if (fast && r < this.maxRatio) r = Math.min(this.maxRatio, r * 1.08);
    this.adaptT = 0;
    if (r !== this.ratio) {
      this.ratio = r;
      this.resize();
    }
  }

  /** Слабая видеокарта: 1 — тени мельче, 2 — без свечения и дальней травы, 3 — тени только от луны без мобов. */
  simplify(level) {
    if (level === 1) {
      this.moon.shadow.mapSize.set(1024, 1024);
      this.moon.shadow.map?.dispose();
      this.moon.shadow.map = null;
    } else if (level === 2) {
      document.body.classList.add('lite');                    // без размытия под карточками (дорого поверх 3D)
      this.bloom.enabled = false;
      for (const p of this.plantMeshes || []) p.visible = false;
    } else if (level === 3) {
      this.renderer.shadowMap.enabled = false;
      this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
    } else if (level === 4) {
      this.grade.enabled = false;                              // цветокор, зерно, аберрация — полноэкранный проход
      for (const p of this.pool || []) p.castShadow = false;
    } else if (level === 5) {
      this.cap = 1 / 30;                                         // последний шаг: ровные 30 кадров вместо рваных 20–40
    }
  }

  run() {
    let acc = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.cap) {                                              // ограничение кадров на совсем слабом железе
        acc += this.clock.getDelta();
        if (acc < this.cap) return;
      }
      const dt = Math.min(0.05, this.cap ? acc : this.clock.getDelta()), t = this.clock.elapsedTime;
      acc = 0;
      this.tick(dt, t);
      this.renderer.shadowMap.needsUpdate = this.frames % (this.weak ? 4 : 3) === 0;
      this.composer.render();
      this.adapt(dt);
      this.frames = (this.frames || 0) + 1;
    };
    loop();
  }
}

// ------------------------------------------------------------------ надпись из блоков
const FONT = {
  M: ['10001', '11011', '10101', '10001', '10001'], A: ['01110', '10001', '11111', '10001', '10001'],
  G: ['01111', '10000', '10011', '10001', '01110'], I: ['111', '010', '010', '010', '111'],
  C: ['01111', '10000', '10000', '10000', '01111'], P: ['11110', '10001', '11110', '10000', '10000'],
  K: ['10001', '10010', '11100', '10010', '10001'], ' ': ['00', '00', '00', '00', '00'],
};

/** «MAGIC PACK» из каменных блоков с фиолетовыми трещинами; блоки прилетают и встают на место. */
export function logo(world, text, at, scale = 1) {
  const group = new THREE.Group();
  group.position.copy(at);
  group.scale.setScalar(scale);
  const brick = new THREE.MeshStandardMaterial({ map: tex('bricks'), normalMap: tex('bricks_n', false), roughness: 0.85,
    emissive: 0xffffff, emissiveMap: tex('bricks'), emissiveIntensity: 0.35 });
  const crack = mat('crystal', { glow: 2.4, rough: 0.25 });
  const cubes = [];
  let x0 = 0;
  const widths = [...text].map((ch) => FONT[ch][0].length + 1);
  const total = widths.reduce((a, b) => a + b, 0) - 1;
  [...text].forEach((ch, i) => {
    FONT[ch].forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit !== '1') return;
      const home = new THREE.Vector3(x0 + c - total / 2, 4 - r, 0);
      cubes.push({ glow: hash(i * 13 + r, c * 7) > 0.78, home,
        from: home.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, 25 + Math.random() * 20, -20 - Math.random() * 20)),
        delay: Math.random() * 1.4 + i * 0.08 });
    }));
    x0 += widths[i];
  });
  const box = world._box ||= new THREE.BoxGeometry(1, 1, 1);
  const sets = [false, true].map((glow) => {
    const list = cubes.filter((c) => c.glow === glow);
    const im = new THREE.InstancedMesh(box, glow ? crack : brick, list.length);
    im.castShadow = true;
    im.frustumCulled = false;
    group.add(im);
    return { im, list };
  });
  world.scene.add(group);
  world.lamp({ obj: group, offset: new THREE.Vector3(0, 2, 6), color: 0xb27cff, power: 40, distance: 30 });
  let t0 = null, settled = false;
  const o = new THREE.Object3D();
  world.updaters.push((dt, t) => {
    if (t0 === null) t0 = t;
    const cam = world.camera, dist = cam.position.distanceTo(group.position);
    if (dist > 90) return;                                   // надпись далеко — не трогаем
    const visible = 2 * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist * cam.aspect;
    group.scale.setScalar(scale * Math.min(1, (visible * 0.86) / (total + 1)));
    for (const { im, list } of sets) {
      list.forEach((m, k) => {
        const q = Math.min(1, Math.max(0, (t - t0 - m.delay) / 1.1));
        const e = 1 - Math.pow(1 - q, 3);
        o.position.lerpVectors(m.from, m.home, e);
        o.rotation.set((1 - e) * 4, (1 - e) * 3, 0);
        if (q >= 1) o.position.y = m.home.y + Math.sin(t * 1.2 + m.home.x * 0.4) * 0.06;
        o.updateMatrix();
        im.setMatrixAt(k, o.matrix);
      });
      im.instanceMatrix.needsUpdate = true;
    }
  });
  return group;
}
