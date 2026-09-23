// Мобы и материалы сайта. Модели собраны из «коробок» как в Майнкрафте, но руки и ноги разбиты на два сустава
// (локоть, колено) — анимации в духе Fresh Animations: шаг с коленом, вес тела, покачивание, инерция суставов.
// Текстуры — tex/*.png (рисует tools/site/textures.py): цвет, карта нормалей *_n, свечение *_e.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new THREE.TextureLoader();
const cache = {};
const GLOWING = new Set(['walker', 'walker_b', 'walker_v', 'walker_c', 'mage', 'stalker', 'crystal', 'rune', 'lantern',
  'wolf', 'wolf_b', 'crow', 'ash', 'torch', 'staff']);
const FLAT = new Set(['rune', 'tall_grass', 'dry_grass', 'fern', 'flower_red', 'flower_blue', 'flower_white', 'reeds',
  'mushroom', 'wheat', 'cobweb', 'lily', 'sword', 'pickaxe', 'axe', 'torch', 'bread', 'staff', 'crow']);

export function tex(name, srgb = true) {
  const key = name + (srgb ? '' : ':lin');
  if (!cache[key]) {
    const t = loader.load('tex/' + name + '.png');
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestMipmapLinearFilter;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    cache[key] = t;
  }
  return cache[key];
}

/** Огни: мир подставляет сюда функцию add(spec) — факел в руке светит через общий набор огней. */
export const LAMP = { add: null };

/** Общий ветер: время для колыхания листвы и травы (обновляет мир). */
export const WIND = { time: { value: 0 }, strength: { value: 1 } };

function windify(m, amount, anchored) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.windTime = WIND.time;
    sh.uniforms.windStrength = WIND.strength;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windTime; uniform float windStrength;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        #endif
        float sway = ${anchored ? 'clamp(position.y, 0.0, 1.0)' : '1.0'};
        float w = sin(windTime * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.6 + sin(windTime * 3.1 + wp.x * 0.9) * 0.25;
        transformed.x += w * ${amount.toFixed(3)} * sway * windStrength;
        transformed.z += cos(windTime * 1.3 + wp.z * 0.4) * ${(amount * 0.6).toFixed(3)} * sway * windStrength;`);
  };
  m.customProgramCacheKey = () => 'wind' + amount + anchored;
}

const mats = {};
/**
 * Материал блока или моба: PBR с картой нормалей — пиксели рельефные, свет цепляется за швы и выпуклости.
 * opts: glow (сила свечения), rough, wind (колыхание), anchored (корни на месте), side.
 */
export function mat(name, opts = {}) {
  const key = name + JSON.stringify(opts);
  if (mats[key]) return mats[key];
  const flat = FLAT.has(name);
  if (opts.cheap) {
    const m = new THREE.MeshLambertMaterial({ map: tex(name), alphaTest: 0.5, side: opts.side ?? THREE.DoubleSide });
    if (opts.wind) windify(m, opts.wind, opts.anchored);
    return (mats[key] = m);
  }
  const m = new THREE.MeshStandardMaterial({
    map: tex(name),
    roughness: opts.rough ?? 0.92,
    metalness: 0,
    alphaTest: 0.5,
    envMapIntensity: opts.env ?? 0.3,
    vertexColors: !!opts.vc,
    side: opts.side ?? (flat ? THREE.DoubleSide : THREE.FrontSide),
  });
  if (!flat) {
    m.normalMap = tex(name + '_n', false);
    m.normalScale = new THREE.Vector2(opts.bump ?? 1, opts.bump ?? 1);
  }
  if (GLOWING.has(name)) {
    m.emissiveMap = tex(name + '_e');
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveIntensity = opts.glow ?? 1.6;
  }
  if (opts.wind) windify(m, opts.wind, opts.anchored);
  mats[key] = m;
  return m;
}

/** Совместимость: skin(name, glow) — материал блока/моба. */
export function skin(name, glow = 1.6) {
  return mat(name, { glow });
}

// ------------------------------------------------------------------ геометрия
/** Коробка с явными прямоугольниками развёртки для граней px, nx, py, ny, pz, nz ([x, y, w, h] в пикселях). */
function boxUV(w, h, d, R, tw, th, grow = 0) {
  const g = new THREE.BoxGeometry(w + grow * 2, h + grow * 2, d + grow * 2);
  const uv = g.attributes.uv;
  ['px', 'nx', 'py', 'ny', 'pz', 'nz'].forEach((k, f) => {
    const [x, y, fw, fh] = R[k];
    const u0 = x / tw, u1 = (x + fw) / tw, v0 = 1 - y / th, v1 = 1 - (y + fh) / th;
    uv.setXY(f * 4 + 0, u0, v0);
    uv.setXY(f * 4 + 1, u1, v0);
    uv.setXY(f * 4 + 2, u0, v1);
    uv.setXY(f * 4 + 3, u1, v1);
  });
  uv.needsUpdate = true;
  return g;
}

/** Развёртка Майнкрафта для коробки (u, v; w×h×d) — или её части по высоте [from, to) для суставов. */
function rects(u, v, w, h, d, from = 0, to = h) {
  const hh = to - from, y = v + d + from;
  return {
    px: [u + d + w, y, d, hh], nx: [u, y, d, hh],
    py: [u + d, v, w, d], ny: [u + d + w, v, w, d],
    pz: [u + d, y, w, hh], nz: [u + 2 * d + w, y, w, hh],
  };
}

function box(w, h, d, u, v, tw, th, grow = 0) {
  return boxUV(w, h, d, rects(u, v, w, h, d), tw, th, grow);
}

function mesh(geo, m, parent, pos) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(...pos);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}

function joint(parent, pivot) {
  const j = new THREE.Bone();
  j.position.set(...pivot);
  parent.add(j);
  return j;
}

/**
 * Конечность из двух сегментов: верх на pivot, низ на суставе (локоть/колено) — с внешним слоем.
 * spec: [u, v, w, h, d], over: [u, v] второго слоя; split — длина верхней части в пикселях.
 */
function limb2(parent, m, T, spec, over, pivot, split, grow = 0.25) {
  const [u, v, w, h, d] = spec;
  const upper = joint(parent, pivot);
  mesh(boxUV(w, split, d, rects(u, v, w, h, d, 0, split), ...T), m, upper, [0, -split / 2, 0]);
  if (over) mesh(boxUV(w, split, d, rects(over[0], over[1], w, h, d, 0, split), ...T, grow), m, upper, [0, -split / 2, 0]);
  const lower = joint(upper, [0, -split, 0]);
  const lh = h - split;
  // низ чуть заходит в верх — на сгибе не видно щели
  mesh(boxUV(w, lh + 0.4, d, rects(u, v, w, h, d, split, h), ...T), m, lower, [0, -lh / 2 + 0.2, 0]);
  if (over) mesh(boxUV(w, lh, d, rects(over[0], over[1], w, h, d, split, h), ...T, grow), m, lower, [0, -lh / 2, 0]);
  return { upper, lower };
}

const crystalGeo = new THREE.BoxGeometry(1, 1, 1);

/** Наросты вируса: кристаллы на голове и плечах, светятся (их подхватывает bloom). */
function crystals(part, count, spread, rng, y0) {
  const m = mat('crystal', { glow: 2.2, rough: 0.25 });
  for (let i = 0; i < count; i++) {
    const c = new THREE.Mesh(crystalGeo, m);
    const s = 1 + rng() * 1.6;
    c.scale.set(s * 0.8, s * 1.8, s * 0.8);
    c.position.set((rng() - 0.5) * spread, y0 + rng() * 2, (rng() - 0.5) * spread);
    c.rotation.set((rng() - 0.5) * 0.9, rng() * 3, (rng() - 0.5) * 0.9);
    c.castShadow = true;
    part.add(c);
  }
}

export function seeded(seed) {
  let s = seed * 9301 + 49297;
  return () => ((s = (s * 9301 + 49297) % 233280) / 233280);
}

// ------------------------------------------------------------------ предметы в руках: объёмные по пикселям
const itemCache = {};
const loadImg = (src) => new Promise((ok) => {
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => ok(null);
  i.src = src;
});
const pixels = (img) => {
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, 16, 16).data;
};

/** Предмет 16×16 превращается в объёмную модель: каждый непрозрачный пиксель — кубик своего цвета. */
export function pixelItem(name, px = 0.7) {
  const g = new THREE.Group();
  itemCache[name] ||= Promise.all([loadImg('tex/' + name + '.png'), GLOWING.has(name) ? loadImg('tex/' + name + '_e.png') : null])
    .then(([img, glowImg]) => {
      const d = pixels(img), ge = pixels(glowImg);
      if (!d) return [];
      const parts = [], glowParts = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        if (d[i + 3] < 128) continue;
        const b = new THREE.BoxGeometry(px, px, px);
        b.translate((x - 7.5) * px, (7.5 - y) * px, 0);
        const col = new THREE.Color().setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace);
        const n = b.attributes.position.count, arr = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) arr.set([col.r, col.g, col.b], k * 3);
        b.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        b.deleteAttribute('uv');
        (ge && ge[i + 3] > 128 ? glowParts : parts).push(b);
      }
      const out = [];
      if (parts.length) out.push(new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 })));
      if (glowParts.length) out.push(new THREE.Mesh(mergeGeometries(glowParts), new THREE.MeshBasicMaterial({ vertexColors: true })));
      return out;
    });
  itemCache[name].then((ms) => ms.forEach((m) => {
    const c = m.clone();
    c.castShadow = true;
    g.add(c);
  }));
  return g;
}

// ------------------------------------------------------------------ базовый скелет: суставы с инерцией
const damp = (a, b, k) => a + (b - a) * k;
const ease = (x) => x * x * (3 - 2 * x);

class Rig {
  constructor() {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(1 / 16);
    this.root.add(this.body);
    this.speed = 0;
    this.phase = 0;
    this.lookTarget = null;
    this.action = null;       // разовое действие: { name, t, dur }
    this.state = 'idle';      // длительное: idle, eat, mine, cast, search, crouch, dead
    this.joints = [];
    this.tint = 0;
    this.mats = [];
  }

  /**
   * Запекание модели: все коробки (кожа, второй слой, кристаллы) склеиваются в одну-две сетки со скелетом —
   * вместо 30 отрисовок на моба одна-две. Суставы остаются теми же костями, анимация не меняется.
   */
  bakeSkin() {
    this.root.updateMatrixWorld(true);
    const bones = [];
    this.body.traverse((o) => { if (o.isBone) bones.push(o); });
    const inv = new THREE.Matrix4().copy(this.body.matrixWorld).invert();
    const byMat = new Map(), drop = [];
    this.body.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh) return;
      let b = o.parent;
      while (b && !b.isBone) b = b.parent;
      if (!b) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
      const n = g.attributes.position.count, bi = bones.indexOf(b);
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
      if (!byMat.has(o.material)) byMat.set(o.material, []);
      byMat.get(o.material).push(g);
      drop.push(o);
    });
    for (const o of drop) o.parent.remove(o);
    const skeleton = new THREE.Skeleton(bones);
    this.skinned = [];
    for (const [m, gs] of byMat) {
      const sm = new THREE.SkinnedMesh(mergeGeometries(gs), m);
      sm.castShadow = sm.receiveShadow = true;
      sm.frustumCulled = true;
      this.body.add(sm);
      sm.bind(skeleton);
      this.skinned.push(sm);
    }
    this.skeleton = skeleton;
  }

  /** Каждый сустав получает целевой поворот, а к нему идёт с инерцией — движение мягкое, «живое». */
  track(j) {
    j.userData.goal = new THREE.Euler();
    this.joints.push(j);
    return j;
  }

  settle(dt, stiff = 14) {
    const k = 1 - Math.exp(-dt * stiff);
    for (const j of this.joints) {
      const g = j.userData.goal;
      j.rotation.x = damp(j.rotation.x, g.x, k);
      j.rotation.y = damp(j.rotation.y, g.y, k);
      j.rotation.z = damp(j.rotation.z, g.z, k);
    }
  }

  play(name, dur = 0.6) {
    this.action = { name, t: 0, dur };
  }

  /** Своя копия материала на моба: можно мигнуть красным при ударе. */
  own(m) {
    const c = m.clone();
    c.onBeforeCompile = m.onBeforeCompile;
    this.mats.push(c);
    return c;
  }

  hurt() {
    this.tint = 1;
    this.play('hurt', 0.35);
  }

  die() {
    this.state = 'dead';
    this.deadT = 0;
    this.ground = this.root.position.y;
    this.speed = 0;
  }

  /** Павший зверь валится на бок и уходит в землю. */
  deadFall(dt) {
    if (this.state !== 'dead') return false;
    this.deadT += dt;
    const f = ease(Math.min(1, this.deadT / 0.7));
    this.root.rotation.z = f * Math.PI / 2 * 0.95;
    this.root.position.y = this.ground + f * 0.3 - Math.max(0, this.deadT - 2.5) * 0.4;
    this.settle(dt, 8);
    this.flash(dt);
    return true;
  }

  flash(dt) {
    if (this.tint <= 0) return;
    this.tint = Math.max(0, this.tint - dt * 3);
    for (const m of this.mats) m.color.setRGB(1, 1 - this.tint * 0.6, 1 - this.tint * 0.6);
  }

  look(dt, head, limit = 1.1, bodyYaw = 0) {
    if (!this.lookTarget) return null;
    const p = new THREE.Vector3();
    head.getWorldPosition(p);
    const d = this.lookTarget.clone().sub(p);
    let a = Math.atan2(d.x, d.z) - this.root.rotation.y - bodyYaw;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
    return { yaw: Math.max(-limit, Math.min(limit, a)), pitch: Math.max(-0.7, Math.min(0.6, pitch)) };
  }
}

/**
 * Гуманоид: заражённый (ходит, волоча ногу, руки вперёд), выживший, маг, поселенец.
 * kind: 'walker' | 'survivor' | 'mage' | 'settler'; texture — имя скина; item — что в правой руке.
 */
export class Humanoid extends Rig {
  constructor(texture, kind = 'walker', seed = 1, item = null) {
    super();
    this.kind = kind;
    const base = mat(texture, { glow: kind === 'walker' ? 1.8 : 1.4, bump: 0.7 });
    const m = this.own(base);
    const T = [64, 64];
    const rng = seeded(seed);
    this.rng = rng;
    // таз — корень ног и туловища (чтобы тело качалось и наклонялось над ногами)
    this.hips = this.track(joint(this.body, [0, 12, 0]));
    this.torso = this.track(joint(this.hips, [0, 0, 0]));
    mesh(box(8, 12, 4, 16, 16, ...T), m, this.torso, [0, 6, 0]);
    mesh(box(8, 12, 4, 16, 32, ...T, 0.25), m, this.torso, [0, 6, 0]);
    this.neck = this.track(joint(this.torso, [0, 12, 0]));
    this.head = this.track(joint(this.neck, [0, 0, 0]));
    mesh(box(8, 8, 8, 0, 0, ...T), m, this.head, [0, 4, 0]);
    mesh(box(8, 8, 8, 32, 0, ...T, 0.5), m, this.head, [0, 4, 0]);
    if (texture === 'walker_v') mesh(box(2, 4, 2, 24, 0, ...T), m, this.head, [0, 2, 5]);
    const ra = limb2(this.torso, m, T, [40, 16, 4, 12, 4], [40, 32], [-6, 12, 0], 5);
    const la = limb2(this.torso, m, T, [32, 48, 4, 12, 4], [48, 48], [6, 12, 0], 5);
    const rl = limb2(this.body, m, T, [0, 16, 4, 12, 4], [0, 32], [-2, 12, 0], 6);
    const ll = limb2(this.body, m, T, [16, 48, 4, 12, 4], [0, 48], [2, 12, 0], 6);
    this.rarm = this.track(ra.upper); this.relbow = this.track(ra.lower);
    this.larm = this.track(la.upper); this.lelbow = this.track(la.lower);
    this.rleg = this.track(rl.upper); this.rknee = this.track(rl.lower);
    this.lleg = this.track(ll.upper); this.lknee = this.track(ll.lower);
    if (kind === 'walker') {
      crystals(this.head, 2 + Math.floor(rng() * 3), 7, rng, 7);
      crystals(this.relbow, Math.floor(rng() * 2), 3, rng, -3);
      crystals(this.torso, 1 + Math.floor(rng() * 2), 6, rng, 9);
      this.limp = 0.5 + rng() * 0.5;           // хромота: одна нога короче шагает
      this.twitchAt = 2 + rng() * 5;
    }
    this.hand = new THREE.Group();
    this.hand.position.set(0, -6.5, 0);
    this.relbow.add(this.hand);
    if (item) this.hold(item);
    this.phase = rng() * 10;
    this.idleSeed = rng() * 100;
    this.bakeSkin();
  }

  hold(name) {
    this.hand.clear();
    this.item = name;
    if (!name) return;
    // предмет в кулаке: рукоять в руке, остриё вперёд-вверх (как в Майнкрафте от третьего лица).
    // grip — пиксель рукояти, tip — куда смотрит остриё на картинке, lift — на сколько поднять над «вперёд»
    const G = { sword: [2.5, 13.5, 45, 0.35], pickaxe: [4, 13.5, 45, 0.35], axe: [4, 13.5, 45, 0.35], staff: [3, 14, 45, 0.5],
      torch: [7.5, 12.5, 90, 1.0], bread: [8, 8, 0, 0] }[name] || [8, 8, 0, 0];
    const px = 0.7, it = pixelItem(name, px);
    it.position.set(-(G[0] - 7.5) * px, -(7.5 - G[1]) * px, 0);
    const pivot = new THREE.Group();
    pivot.add(it);
    pivot.rotation.set(0, -Math.PI / 2, G[3] - (G[2] * Math.PI) / 180);
    pivot.position.set(0, -0.3, 0.6);
    this.hand.add(pivot);
    if (this.torchLamp) this.torchLamp.remove();
    this.torchLamp = null;
    if (name === 'torch' && LAMP.add) {
      const anchor = new THREE.Object3D();
      anchor.position.set(0, 6, 3);
      this.hand.add(anchor);
      this.torchLamp = LAMP.add({ obj: anchor, color: 0xffa24a, distance: 12, power: (t) => 6 + Math.sin(t * 17) * 0.8 + Math.sin(t * 7.3) * 0.8 });
    }
  }

  animate(dt, t) {
    const S = this;
    const zombie = this.kind === 'walker';
    const sp = this.speed;
    const walk = Math.min(1, sp / 1.1), run = Math.min(1, Math.max(0, (sp - 1.6) / 1.4));
    this.phase += dt * (zombie ? 3.2 + sp * 3.2 : 3 + sp * 4.2);
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const G = (j) => j.userData.goal;
    const dead = this.state === 'dead';
    // ------------------------------------------------ ноги: бедро, колено; у мертвецов — хромота
    const stride = (zombie ? 0.55 : 0.7) * walk + 0.3 * run;
    const limpR = zombie ? this.limp : 1;
    G(this.rleg).x = -s * stride * limpR;
    G(this.lleg).x = s * stride;
    G(this.rknee).x = Math.max(0, c) * (0.9 * walk + 0.6 * run) * limpR;
    G(this.lknee).x = Math.max(0, -c) * (0.9 * walk + 0.6 * run);
    G(this.rleg).z = zombie ? 0.06 : 0.02;
    G(this.lleg).z = zombie ? -0.08 : -0.02;
    // ------------------------------------------------ корпус: вес переносится с ноги на ногу, наклон вперёд
    const bob = (1 - Math.cos(ph * 2)) * 0.5;
    const breath = Math.sin(t * 1.8 + this.idleSeed) * 0.5 + 0.5;
    this.body.position.y = (bob * (0.05 * walk + 0.05 * run)) - (1 - Math.cos(ph * 2)) * 0.012 * walk;
    G(this.hips).y = s * 0.12 * walk;
    G(this.hips).z = (zombie ? Math.sin(ph) * 0.07 * walk : 0) + (zombie ? 0.03 : 0);
    G(this.torso).x = (zombie ? 0.22 + 0.1 * walk : 0.04 * walk + 0.22 * run) + breath * 0.015;
    G(this.torso).y = -s * 0.14 * walk;
    G(this.torso).z = zombie ? Math.sin(ph) * 0.05 * walk : 0;
    // ------------------------------------------------ руки
    if (zombie) {
      const reach = -1.3 + Math.sin(t * 1.1 + this.idleSeed) * 0.08 - 0.15 * run;
      G(this.rarm).x = reach + s * 0.12;
      G(this.larm).x = reach - s * 0.12 - 0.12;
      G(this.relbow).x = -0.25 + Math.sin(t * 1.7 + this.idleSeed) * 0.06;    // кисти свисают
      G(this.lelbow).x = -0.35;
      G(this.rarm).z = -0.1;
      G(this.larm).z = 0.14;
      G(this.rarm).y = 0.1;
      G(this.larm).y = -0.08;
    } else {
      const swing = 0.6 * walk + 0.5 * run;
      G(this.rarm).x = s * swing + (this.item ? -0.25 : 0);
      G(this.larm).x = -s * swing;
      G(this.relbow).x = -0.15 - 0.9 * run - Math.max(0, s) * 0.3 * walk - (this.item ? 0.4 : 0);
      G(this.lelbow).x = -0.15 - 0.9 * run - Math.max(0, -s) * 0.3 * walk;
      G(this.rarm).z = -0.06 - breath * 0.03;
      G(this.larm).z = 0.06 + breath * 0.03;
      G(this.rarm).y = G(this.larm).y = 0;
    }
    // ------------------------------------------------ голова: взгляд на цель, у мёртвых — подёргивание и крен
    const lk = this.look(dt, this.head, zombie ? 0.9 : 1.2, G(this.hips).y + G(this.torso).y);
    if (lk) {
      G(this.head).y = lk.yaw;
      G(this.head).x = lk.pitch - G(this.torso).x;
    } else {
      G(this.head).y = Math.sin(t * 0.4 + this.idleSeed) * 0.35 * (1 - walk);
      G(this.head).x = -G(this.torso).x * 0.6;
    }
    G(this.head).z = zombie ? Math.sin(t * 0.7 + this.idleSeed) * 0.16 + 0.1 : 0;
    if (zombie) {
      this.twitchAt -= dt;
      if (this.twitchAt < 0) {                     // резкий рывок головой — мёртвые так делают
        this.twitchAt = 2 + this.rng() * 5;
        this.head.rotation.z += (this.rng() - 0.5) * 0.9;
        this.head.rotation.y += (this.rng() - 0.5) * 0.7;
      }
    }
    // ------------------------------------------------ длительные состояния
    switch (this.state) {
      case 'eat': {                                 // рука ко рту, голова кивает, крошки — снаружи
        const bite = Math.max(0, Math.sin(t * 7));
        G(this.rarm).x = -1.35 - bite * 0.2;
        G(this.rarm).y = 0.45;
        G(this.relbow).x = -1.2;
        G(this.head).x = 0.15 + bite * 0.1;
        break;
      }
      case 'mine': {                                // размах киркой в землю перед собой
        const k = (t * 2.2) % 1, down = k < 0.35 ? ease(k / 0.35) : 1 - ease((k - 0.35) / 0.65);
        G(this.rarm).x = -2.6 + down * 2.0;
        G(this.relbow).x = -0.6 + down * 0.4;
        G(this.torso).x = 0.1 + down * 0.35;
        G(this.head).x = 0.3;
        G(this.rknee).x = G(this.lknee).x = 0.25;
        G(this.rleg).x = G(this.lleg).x = -0.15;
        this.body.position.y = -0.05;
        break;
      }
      case 'cast': {                                // руки вверх, пальцы к небу, мантия колышется
        const w = Math.sin(t * 2.5);
        G(this.rarm).x = -2.7 + w * 0.12;
        G(this.larm).x = -2.7 - w * 0.12;
        G(this.rarm).z = -0.35;
        G(this.larm).z = 0.35;
        G(this.relbow).x = G(this.lelbow).x = -0.2;
        G(this.head).x = -0.4;
        break;
      }
      case 'search': {                              // оглядывается, принюхивается
        G(this.head).y = Math.sin(t * 1.3 + this.idleSeed) * 0.9;
        G(this.head).x = -0.15 + Math.sin(t * 3.1) * 0.05;
        break;
      }
      case 'crouch': {                              // присел за укрытием
        G(this.torso).x = 0.5;
        G(this.rleg).x = G(this.lleg).x = -0.9;
        G(this.rknee).x = G(this.lknee).x = 1.5;
        G(this.rarm).x = -0.5;
        G(this.larm).x = -0.3;
        this.body.position.y = -0.28;
        break;
      }
      case 'panic': {                               // руки к голове, дрожит
        G(this.rarm).x = G(this.larm).x = -2.2;
        G(this.relbow).x = G(this.lelbow).x = -1.6;
        G(this.rarm).z = -0.6;
        G(this.larm).z = 0.6;
        this.body.position.x = Math.sin(t * 40) * 0.01;
        break;
      }
    }
    // ------------------------------------------------ разовые действия поверх
    const A = this.action;
    if (A) {
      A.t += dt;
      const k = Math.min(1, A.t / A.dur);
      const e = Math.sin(k * Math.PI);
      if (A.name === 'attack') {
        if (zombie) {                               // выпад: тело вперёд, руки бьют сверху
          G(this.torso).x += e * 0.5;
          G(this.rarm).x = -1.3 - e * 1.1;
          G(this.larm).x = -1.3 - e * 1.1;
          G(this.relbow).x = G(this.lelbow).x = -0.1;
        } else {                                    // замах и удар сверху вниз
          const up = k < 0.35 ? ease(k / 0.35) : 1 - ease((k - 0.35) / 0.65);
          G(this.rarm).x = -0.3 - up * 2.4 + (k > 0.35 ? (1 - up) * 0.6 : 0);
          G(this.rarm).y = 0.3 * up;
          G(this.relbow).x = -0.2 - up * 0.5;
          G(this.torso).y += (k > 0.35 ? -0.45 : 0.3) * e;
          G(this.torso).x += 0.2 * e;
        }
      } else if (A.name === 'hurt') {               // отшатнулся
        G(this.torso).x -= e * 0.35;
        G(this.head).x -= e * 0.4;
        this.body.position.z = -e * 0.08;
      } else if (A.name === 'lunge') {              // сталкер/мертвец бросается
        G(this.torso).x += e * 0.7;
        G(this.rleg).x = -e * 0.9;
        G(this.lleg).x = e * 0.6;
      }
      if (k >= 1) this.action = null;
    }
    // ------------------------------------------------ смерть: падает, суставы обмякают
    if (dead) {
      this.deadT = (this.deadT || 0) + dt;
      const f = ease(Math.min(1, this.deadT / 0.9));
      this.root.rotation.x = -f * (Math.PI / 2 - 0.08) * (this.fallDir || 1);
      this.root.position.y = this.ground + f * 0.25 - Math.max(0, this.deadT - 2.5) * 0.4;
      G(this.rarm).x = -0.3 * f;
      G(this.larm).x = -0.8 * f;
      G(this.rarm).z = -1.2 * f;
      G(this.larm).z = 1.0 * f;
      G(this.relbow).x = G(this.lelbow).x = -0.4;
      G(this.head).y = 0.8 * f;
      G(this.rleg).x = -0.3;
      G(this.lknee).x = 0.6;
    }
    this.settle(dt, dead ? 8 : zombie ? 10 : 14);
    this.flash(dt);
  }

  die(dir = 1) {
    this.state = 'dead';
    this.deadT = 0;
    this.fallDir = dir;
    this.ground = this.root.position.y;
    this.speed = 0;
  }
}

/** Сталкер (эндермен-подобный): длинные руки-ноги с суставами, дрожит, рот раскрывается в ярости. */
export class Stalker extends Rig {
  constructor(seed = 7) {
    super();
    this.kind = 'stalker';
    const m = this.own(mat('stalker', { glow: 2.4 }));
    const T = [64, 32];
    this.hips = this.track(joint(this.body, [0, 26, 0]));
    this.torso = this.track(joint(this.hips, [0, 0, 0]));
    mesh(box(8, 12, 4, 32, 16, ...T), m, this.torso, [0, 6, 0]);
    this.head = this.track(joint(this.torso, [0, 12, 0]));
    mesh(box(8, 8, 8, 0, 0, ...T), m, this.head, [0, 4, 0]);
    this.jaw = this.track(joint(this.head, [0, 1, 0]));
    mesh(box(8, 1, 8, 0, 0, ...T, 0.1), m, this.jaw, [0, -0.5, 0]);
    const ra = limb2(this.torso, m, T, [56, 0, 2, 30, 2], null, [-5, 11, 0], 15, 0);
    const la = limb2(this.torso, m, T, [56, 0, 2, 30, 2], null, [5, 11, 0], 15, 0);
    const rl = limb2(this.body, m, T, [56, 0, 2, 30, 2], null, [-2, 26, 0], 14, 0);
    const ll = limb2(this.body, m, T, [56, 0, 2, 30, 2], null, [2, 26, 0], 14, 0);
    this.rarm = this.track(ra.upper); this.relbow = this.track(ra.lower);
    this.larm = this.track(la.upper); this.lelbow = this.track(la.lower);
    this.rleg = this.track(rl.upper); this.rknee = this.track(rl.lower);
    this.lleg = this.track(ll.upper); this.lknee = this.track(ll.lower);
    crystals(this.head, 3, 7, seeded(seed), 7);
    this.anger = 0;
    this.bakeSkin();
  }

  animate(dt, t) {
    if (this.deadFall(dt)) return;
    const G = (j) => j.userData.goal;
    const walk = Math.min(1, this.speed / 1.2);
    this.phase += dt * (2 + this.speed * 3);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    G(this.rleg).x = -s * 0.5 * walk;
    G(this.lleg).x = s * 0.5 * walk;
    G(this.rknee).x = Math.max(0, c) * 0.8 * walk;
    G(this.lknee).x = Math.max(0, -c) * 0.8 * walk;
    G(this.torso).x = 0.12 + this.anger * 0.2;
    G(this.rarm).x = s * 0.35 * walk - this.anger * 0.9;
    G(this.larm).x = -s * 0.35 * walk - this.anger * 0.9;
    G(this.relbow).x = -0.2 - this.anger * 0.4;
    G(this.lelbow).x = -0.2 - this.anger * 0.4;
    G(this.rarm).z = -0.08;
    G(this.larm).z = 0.08;
    G(this.jaw).x = this.anger * 0.5;
    this.body.position.y = Math.sin(t * 9) * 0.01 * (1 + this.anger * 3);   // дрожь
    const lk = this.look(dt, this.head, 1.2);
    if (lk) {
      G(this.head).y = lk.yaw;
      G(this.head).x = lk.pitch;
    }
    G(this.head).z = Math.sin(t * 5.3) * 0.05 * (1 + this.anger * 2);
    const A = this.action;
    if (A) {
      A.t += dt;
      const k = Math.min(1, A.t / A.dur), e = Math.sin(k * Math.PI);
      if (A.name === 'grab') {                      // руки выбрасываются вперёд и тянут на себя
        G(this.rarm).x = -1.6 - e * 0.3;
        G(this.larm).x = -1.6 - e * 0.3;
        G(this.relbow).x = G(this.lelbow).x = k < 0.5 ? 0 : -1.2;
        G(this.torso).x += e * 0.4;
      }
      if (k >= 1) this.action = null;
    }
    this.settle(dt, 9);
    this.flash(dt);
  }
}

/** Волк (заражённый): рысь диагональными парами, голова покачивается, хвост; прыжок и вой. */
export class Wolf extends Rig {
  constructor(texture = 'wolf', seed = 3) {
    super();
    this.kind = 'wolf';
    const m = this.own(mat(texture, { glow: 1.8, bump: 0.7 }));
    const T = [64, 32];
    this.chest = this.track(joint(this.body, [0, 10, 0]));
    mesh(box(6, 9, 6, 18, 14, ...T), m, this.chest, [0, 0, -2]).rotation.x = Math.PI / 2;
    mesh(box(8, 6, 7, 21, 0, ...T), m, this.chest, [0, 0.5, 2.5]).rotation.x = Math.PI / 2;
    this.head = this.track(joint(this.chest, [0, 1.5, 7]));
    mesh(box(6, 6, 4, 0, 0, ...T), m, this.head, [0, 0, 1]);
    mesh(box(3, 3, 4, 0, 10, ...T), m, this.head, [0, -1.5, 4.5]);
    this.jaw = this.track(joint(this.head, [0, -2.5, 3]));
    mesh(box(3, 1, 4, 0, 10, ...T), m, this.jaw, [0, -0.5, 1.5]);
    const ear1 = mesh(box(2, 2, 1, 16, 14, ...T), m, this.head, [-2, 4, 0.5]);
    const ear2 = mesh(box(2, 2, 1, 16, 14, ...T), m, this.head, [2, 4, 0.5]);
    this.ears = [ear1, ear2];
    this.legs = [];
    for (const [x, z] of [[-1.5, 5], [1.5, 5], [-1.5, -5], [1.5, -5]]) {
      const l = limb2(this.body, m, T, [0, 18, 2, 8, 2], null, [x, 8, z], 4, 0);
      this.legs.push({ up: this.track(l.upper), low: this.track(l.lower), front: z > 0 });
    }
    this.tail = this.track(joint(this.chest, [0, 2, -6.5]));
    mesh(box(2, 8, 2, 9, 18, ...T), m, this.tail, [0, -4, 0]);
    crystals(this.chest, 2, 5, seeded(seed), 3);
    this.bakeSkin();
  }

  animate(dt, t) {
    if (this.deadFall(dt)) return;
    const G = (j) => j.userData.goal;
    const walk = Math.min(1, this.speed / 1.5), run = Math.min(1, Math.max(0, (this.speed - 2.5) / 2));
    this.phase += dt * (3 + this.speed * 3.5);
    const ph = this.phase;
    this.legs.forEach((l, i) => {
      // рысь: левая передняя с правой задней; галоп — передние вместе
      const off = run > 0.5 ? (l.front ? 0 : Math.PI * 0.7) : ((i === 0 || i === 3) ? 0 : Math.PI);
      const s = Math.sin(ph + off);
      G(l.up).x = s * (0.6 * walk + 0.3 * run);
      G(l.low).x = (l.front ? -1 : 1) * Math.max(0, Math.cos(ph + off)) * 0.7 * walk;
    });
    G(this.chest).x = Math.sin(ph * 2) * 0.04 * walk - run * 0.05;
    this.body.position.y = Math.abs(Math.sin(ph)) * 0.08 * run;
    const lk = this.look(dt, this.head, 0.9);
    G(this.head).y = lk ? lk.yaw : Math.sin(t * 0.6) * 0.3;
    G(this.head).x = (lk ? lk.pitch : 0) + Math.sin(ph * 2) * 0.06 * walk + 0.1;
    G(this.tail).x = 0.5 + walk * 0.4 + Math.sin(t * 2) * 0.05;
    G(this.tail).y = Math.sin(t * (this.state === 'hunt' ? 14 : 3)) * 0.25;
    G(this.jaw).x = this.state === 'hunt' ? 0.35 + Math.sin(t * 8) * 0.1 : 0.05;
    if (this.state === 'howl') {                   // вой: морда в небо
      G(this.chest).x = -0.35;
      G(this.head).x = -1.0;
      G(this.jaw).x = 0.6 + Math.sin(t * 3) * 0.1;
    }
    const A = this.action;
    if (A) {
      A.t += dt;
      const k = Math.min(1, A.t / A.dur), e = Math.sin(k * Math.PI);
      if (A.name === 'leap') {
        this.body.position.y = e * 1.1;
        G(this.chest).x = (k < 0.5 ? -0.4 : 0.3) * e;
        this.legs.forEach((l) => (G(l.up).x = (l.front ? -1.2 : 1.1) * e));
        G(this.jaw).x = 0.7 * e;
      }
      if (k >= 1) this.action = null;
    }
    this.settle(dt, 12);
    this.flash(dt);
  }
}

/** Ворона: кружит над полем, машет крыльями и планирует; на земле прыгает и клюёт. */
export class Crow extends Rig {
  constructor(seed = 1) {
    super();
    this.kind = 'crow';
    const m = mat('crow', { glow: 1.2 });
    const T = [48, 16];
    this.torso = this.track(joint(this.body, [0, 3, 0]));
    mesh(box(4, 4, 6, 0, 6, ...T), m, this.torso, [0, 0, 0]);
    this.head = this.track(joint(this.torso, [0, 2, 3]));
    mesh(box(3, 3, 3, 0, 0, ...T), m, this.head, [0, 1, 1]);
    mesh(box(1, 1, 2, 12, 0, ...T), m, this.head, [0, 0.8, 3.2]);
    this.lw = this.track(joint(this.torso, [2, 1, 0]));
    this.rw = this.track(joint(this.torso, [-2, 1, 0]));
    mesh(box(1, 3, 6, 20, 6, ...T), m, this.lw, [1.5, 0, 0]).rotation.z = Math.PI / 2;
    mesh(box(1, 3, 6, 20, 6, ...T), m, this.rw, [-1.5, 0, 0]).rotation.z = Math.PI / 2;
    mesh(box(3, 1, 3, 18, 0, ...T), m, this.torso, [0, 0.5, -4]);
    this.flying = true;
    this.phase = seeded(seed)() * 10;
    this.bakeSkin();
  }

  animate(dt, t) {
    const G = (j) => j.userData.goal;
    if (this.flying) {
      this.phase += dt * 11;
      const glide = Math.sin(t * 0.7 + this.phase * 0.01) > 0.3;
      const flap = glide ? 0.15 : Math.sin(this.phase) * 0.9;
      G(this.lw).z = flap;
      G(this.rw).z = -flap;
      G(this.torso).x = -0.1;
    } else {
      G(this.lw).z = G(this.rw).z = 0;
      const peck = Math.max(0, Math.sin(t * 5 + this.phase)) ** 6;
      G(this.torso).x = peck * 0.6;
      G(this.head).x = peck * 0.5;
    }
    this.settle(dt, 18);
  }
}
