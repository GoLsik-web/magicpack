// Орда по ступеням T0–T7: на каждую ступень — своя мини-сцена со своим местом, светом и погодой,
// и в ней видно то поведение, что обещано и работает в игре.
import * as THREE from 'three';
import { Humanoid, Stalker, Wolf, Crow, mat, seeded } from './models.js';
import { heightAt, hash } from './world.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const ease = (x) => x * x * (3 - 2 * x);

// ------------------------------------------------------------------ спрайт-подпись («?», «!», счётчик стаи)
function label(text, color, w = 64) {
  const c = document.createElement('canvas');
  c.width = w * 2;
  c.height = 64;
  const g = c.getContext('2d');
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false, opacity: 0.9 }));
  s.userData.draw = (t) => {
    g.clearRect(0, 0, c.width, 64);
    g.font = 'bold 44px Unbounded, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.fillStyle = color;
    g.fillText(t, c.width / 2, 34);
    if (s.material.map) s.material.map.needsUpdate = true;
  };
  s.userData.draw(text);
  s.material.map = new THREE.CanvasTexture(c);
  s.material.color.setScalar(0.75);
  s.scale.set(0.7 * (c.width / 64), 0.7, 1);
  return s;
}

class Agent {
  constructor(director, mob, x, z, hp = 3) {
    this.d = director;
    this.mob = mob;
    this.pos = V(x, 0, z);
    this.vel = V(0, 0, 0);
    this.hp = hp;
    this.maxHp = hp;
    this.alive = true;
    this.cool = 0;
    this.goal = null;
    director.group.add(mob.root);
    this.place();
  }

  place() {
    this.pos.y = heightAt(this.pos.x, this.pos.z) + 1;
    this.mob.root.position.copy(this.pos);
  }

  /** Идти к точке со скоростью sp; вернуть расстояние. */
  seek(target, sp, dt) {
    const d = V(target.x - this.pos.x, 0, target.z - this.pos.z);
    const dist = d.length();
    if (dist > 0.15) {
      d.normalize().multiplyScalar(sp * Math.min(1, dist / 0.8));
      this.vel.lerp(d, Math.min(1, dt * 3.5));
    } else this.vel.multiplyScalar(0.8);
    return dist;
  }

  stop(dt) {
    this.vel.multiplyScalar(Math.max(0, 1 - dt * 6));
  }

  face(p, dt, k = 6) {
    const yaw = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let dy = yaw - this.mob.root.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.mob.root.rotation.y += dy * Math.min(1, dt * k);
  }

  dist(o) {
    return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
  }

  update(dt, t) {
    if (!this.alive) {
      this.mob.animate(dt, t);
      return;
    }
    this.pos.addScaledVector(this.vel, dt);
    this.place();
    const sp = this.vel.length();
    this.mob.speed = sp;
    if (sp > 0.08 && !this.facing) {
      const yaw = Math.atan2(this.vel.x, this.vel.z);
      let dy = yaw - this.mob.root.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.mob.root.rotation.y += dy * Math.min(1, dt * 5);
    }
    this.facing = false;
    this.mob.animate(dt, t);
  }

  hurt(from) {
    if (!this.alive) return;
    this.hp--;
    this.mob.hurt();
    if (from) this.vel.add(V(this.pos.x - from.pos.x, 0, this.pos.z - from.pos.z).normalize().multiplyScalar(2.2));   // отбросило
    this.d.fx('hit', this.pos);
    if (this.hp <= 0) this.die(from);
  }

  die(from) {
    this.alive = false;
    this.vel.set(0, 0, 0);
    if (this.mob.die) this.mob.die(1);
    this.d.fx('death', this.pos);
    this.d.kills++;
  }
}

export class Horde {
  constructor(world, center) {
    this.w = world;
    this.c = center;                    // центр площадки орды
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.tier = -1;
    this.noise = null;
    this.cursor = V(center.x, center.y + 1, center.z);
    this.shot = { pos: V(center.x + 3, center.y + 6.5, center.z + 15), look: V(center.x - 2, center.y + 1.2, center.z - 5) };
    this.fxList = [];
    this.agents = [];
    this.time = 0;
    this.clear();
    world.updaters.push((dt, t) => this.update(dt, t));
  }

  y(x, z) {
    return heightAt(x, z) + 1;
  }

  at(dx, dz, dy = 0) {
    return V(this.c.x + dx, this.y(this.c.x + dx, this.c.z + dz) + dy, this.c.z + dz);
  }

  clear() {
    for (const r of this.rings || []) this.w.scene.remove(r.m);
    this.w.scene.remove(this.group);
    this.group = new THREE.Group();
    this.w.scene.add(this.group);
    this.agents = [];
    this.walkers = [];
    this.survivors = [];
    this.stalkers = [];
    this.wolves = [];
    this.crows = [];
    this.flying = [];
    this.bolts = [];
    this.rings = [];
    this.kills = 0;
    this.flags = {};
  }

  add(mob, x, z, hp, list) {
    const a = new Agent(this, mob, this.c.x + x, this.c.z + z, hp);
    this.agents.push(a);
    list.push(a);
    return a;
  }

  walker(x, z, i, hp = 2) {
    const kinds = ['walker', 'walker_b', 'walker_v', 'walker_c'];
    const a = this.add(new Humanoid(kinds[i % 4], 'walker', i + 3), x, z, hp, this.walkers);
    a.mob.root.rotation.y = Math.PI;
    a.speedMul = 0.85 + hash(i, 3) * 0.3;
    return a;
  }

  survivor(x, z, tex = 'survivor', item = 'sword') {
    const a = this.add(new Humanoid(tex, 'survivor', 99 + x, item), x, z, 999, this.survivors);
    a.mob.root.rotation.y = Math.PI;
    return a;
  }

  wolf(x, z, i) {
    const a = this.add(new Wolf(i % 2 ? 'wolf_b' : 'wolf', i), x, z, 2, this.wolves);
    a.mob.root.rotation.y = Math.PI;
    return a;
  }

  crow(i, around, r = 9, h = 9) {
    const c = new Crow(i);
    c.root.scale.setScalar(1.4);
    this.group.add(c.root);
    this.crows.push({ c, around, r, h, a: i * 1.7, sp: 0.35 + hash(i, 2) * 0.2 });
  }

  /** Блоки сцены одной отрисовкой. list: [[dx, y, dz]] относительно центра, y — абсолютная высота. */
  blocks(m, list) {
    return this.w.blocks(mat(m, { bump: 1.2 }), list.map(([dx, y, dz]) => [this.c.x + dx, y, this.c.z + dz]), this.group);
  }

  /** Одиночный блок (может разлететься). */
  block(m, dx, y, dz) {
    const o = new THREE.Mesh(this.w._box ||= new THREE.BoxGeometry(1, 1, 1), mat(m));
    o.position.set(this.c.x + dx + 0.5, y + 0.5, this.c.z + dz + 0.5);
    o.castShadow = o.receiveShadow = true;
    this.group.add(o);
    return o;
  }

  cross(name, list, size = 1) {
    const m = mat(name, { wind: 0.1, anchored: true, side: THREE.DoubleSide });
    const geo = new THREE.PlaneGeometry(size, size).translate(0, size / 2, 0);
    for (const part of [geo, geo.clone().rotateY(Math.PI / 2)]) {
      const im = new THREE.InstancedMesh(part, m, list.length);
      const o = new THREE.Object3D();
      list.forEach(([dx, dz], i) => {
        o.position.set(this.c.x + dx, this.y(this.c.x + dx, this.c.z + dz), this.c.z + dz);
        o.rotation.y = hash(i, 4) * 3;
        o.updateMatrix();
        im.setMatrixAt(i, o.matrix);
      });
      im.receiveShadow = true;
      this.group.add(im);
    }
  }

  tag(a, text, color, h = 2.6) {
    if (a.label) a.mob.root.remove(a.label);
    a.label = label(text, color);
    a.label.position.set(0, h, 0);
    a.mob.root.add(a.label);
    return a.label;
  }

  // ------------------------------------------------------------------ частицы
  /** hit — брызги, death — пепел и кристаллы, tp — фиолетовые искры, debris — осколки блока, magic — вспышка чар. */
  fx(kind, at, color) {
    const n = { tp: 70, magic: 60, debris: 16, death: 30, hit: 14, crumbs: 6 }[kind] || 20;
    const cols = { tp: 0xc070ff, magic: 0xd49cff, hit: 0x7a1a1a, death: 0x8a8490, debris: color || 0x777777, crumbs: 0xc89a50 };
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), v = [];
    const up = kind === 'debris' ? 0.5 : kind === 'crumbs' ? 1.3 : 1;
    for (let i = 0; i < n; i++) {
      p.set([at.x + (Math.random() - 0.5) * 0.5, at.y + up + Math.random() * (kind === 'tp' ? 2 : 0.6), at.z + (Math.random() - 0.5) * 0.5], i * 3);
      const s = kind === 'magic' ? 5 : kind === 'crumbs' ? 0.8 : 3;
      v.push(V((Math.random() - 0.5) * s, Math.random() * (kind === 'tp' ? 1 : 3), (Math.random() - 0.5) * s));
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const glow = kind === 'tp' || kind === 'magic';
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: cols[kind], size: kind === 'debris' ? 0.14 : glow ? 0.16 : 0.1,
      transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending }));
    pts.frustumCulled = false;
    this.w.scene.add(pts);
    this.fxList.push({ pts, v, life: kind === 'tp' ? 1.4 : 1.1, grav: glow ? (kind === 'tp' ? -1.5 : 1) : 9 });
    if (glow) {
      const l = new THREE.PointLight(0xb070ff, 30, 10, 1.6);
      l.position.copy(at).add(V(0, 1, 0));
      this.w.scene.add(l);
      this.fxList.push({ light: l, life: 0.5 });
    }
  }

  /** Волна звука: кольцо расходится по земле от места шума (T1) — видно, как далеко слышно. */
  ring(at, radius = 14, color = 0xc58bff) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 64),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(at.x, this.y(at.x, at.z) + 0.06, at.z);
    this.w.scene.add(m);
    this.rings.push({ m, r: 0, max: radius, at: at.clone() });
  }

  /** Клик по земле: шум — на него сходятся (T1 и выше). */
  click(point) {
    this.noise = { at: point.clone(), until: this.time + 7 };
    this.ring(point, 18);
  }

  // ================================================================== ступени
  setTier(i) {
    this.tier = i;
    this.clear();
    this.started = this.time;
    const C = this.c, y0 = C.y + 1;              // y0 — уровень земли (верх блоков площадки)
    const shot = (p, l) => {
      this.shot.pos.set(C.x + p[0], y0 + p[1], C.z + p[2]);
      this.shot.look.set(C.x + l[0], y0 + l[1], C.z + l[2]);
    };
    const look = ['dusk', 'deep', 'deep', 'night', 'night', 'deep', 'storm', 'blood'][i];
    this.w.setLook(look);
    this.look = look;
    switch (i) {
      case 0: { // просто мертвецы: закат над полем, мертвецы бредут по одному, выживший справляется
        shot([9, 4.5, 15], [-2, 1.6, -7]);
        const wheat = [], fence = [];
        for (let x = -9; x <= -2; x++) for (let z = -3; z <= 3; z++) if (hash(x, z) > 0.12) wheat.push([x + 0.5, z + 0.5]);
        this.cross('wheat', wheat, 1);
        for (let x = -10; x <= -1; x += 1) fence.push([x, y0, -4], [x, y0, 4]);
        this.blocks('spruce_planks', fence.filter((_, k) => k % 3 !== 1));
        this.blocks('hay', [[2, y0, -2], [3, y0, -2], [2, y0 + 1, -2], [-11, y0, 0]]);
        this.w.cart(C.x + 5, C.z - 5, 0.6, this.group);
        const S = this.survivor(0, 3, 'survivor', 'sword');
        for (let k = 0; k < 4; k++) this.walker(-6 + k * 4, -22 - k * 2, k).delay = 1 + k * 4.5;
        for (let k = 0; k < 5; k++) this.crow(k, C.clone().add(V(-4, 0, -6)), 6 + k, 8 + k * 0.7);
        this.torch = null;
        S.post = S.pos.clone();
        break;
      }
      case 1: { // слышат и приходят: выживший долбит камень — стук разносится волнами, мертвецы идут на звук
        shot([-9, 4.8, 12], [1, 1.2, -5]);
        const rock = [];
        for (let x = -1; x <= 2; x++) for (let z = -4; z <= -1; z++) {
          const hgt = 1 + Math.floor(hash(x, z) * 3) - (Math.abs(x - 0.5) + Math.abs(z + 2.5) > 3 ? 1 : 0);
          for (let y = 0; y < hgt; y++) rock.push([x, y0 + y, z]);
        }
        this.blocks('stone', rock.filter((_, k) => k % 4));
        this.blocks('cobble', rock.filter((_, k) => !(k % 4)));
        this.lantern(-1.5, 0.5);
        const S = this.survivor(0.5, 0.4, 'survivor_b', 'pickaxe');
        S.mob.root.rotation.y = Math.PI;
        S.mob.state = 'mine';
        S.post = S.pos.clone();
        for (let k = 0; k < 7; k++) {
          const a = -2.6 + (k / 6) * 3.4, r = 15 + hash(k, 1) * 8;
          const w = this.walker(Math.cos(a) * r, Math.sin(a) * r - 2, k);
          w.wander = w.pos.clone();
        }
        this.flags.nextHit = 0.6;
        break;
      }
      case 2: { // ждут своих: мертвецы и волки собираются у кромки леса и не выходят, пока не наберётся стая
        shot([7, 3.6, 16], [-1, 2.4, -10]);
        const trees = [];
        for (let k = 0; k < 9; k++) {
          const x = -16 + k * 4 + Math.floor(hash(k, 2) * 2), z = -15 - Math.floor(hash(k, 5) * 3);
          const h = 7 + Math.floor(hash(k, 7) * 4), yb = this.y(C.x + x, C.z + z);
          for (let y = 0; y < h; y++) trees.push(['spruce_log', x, yb + y, z]);
          for (let y = 2; y <= h; y++) {
            const r = y === h ? 0 : Math.max(0, Math.floor((h - y) / 3) + ((h - y) % 3 === 0 ? 1 : 0));
            for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++)
              if (Math.abs(dx) + Math.abs(dz) <= r + 0.5 && (dx || dz)) trees.push(['spruce_leaves', x + dx, yb + y, z + dz]);
          }
          trees.push(['spruce_leaves', x, yb + h, z]);
        }
        this.blocks('spruce_log', trees.filter((b) => b[0] === 'spruce_log').map((b) => b.slice(1)));
        this.w.blocks(mat('spruce_leaves', { wind: 0.04 }), trees.filter((b) => b[0] === 'spruce_leaves').map(([, x, y, z]) => [C.x + x, y, C.z + z]), this.group);
        const fire = this.w.fire(this.at(3, 5), 0.8, this.group);
        fire.userData.temp = true;
        const S = this.survivor(1.5, 3.5, 'survivor', 'sword');
        S.post = S.pos.clone();
        this.survivor(4.5, 3.2, 'survivor_c', 'torch').post = V(C.x + 4.5, 0, C.z + 3.2);
        const spots = [-9, -5, -1, 3, 7];
        for (let k = 0; k < 5; k++) {
          const w = k % 2 === 0 || k === 3 ? this.walker(spots[k] + 1, -24 - k * 2, k) : this.wolf(spots[k], -24 - k * 2, k);
          w.delay = k * 1.3;
          w.spot = V(C.x + spots[k], 0, C.z - 11.5 - hash(k, 9) * 1.5);
          w.state = 'come';
        }
        this.pack = label('стая 0/5', '#c58bff', 128);
        this.pack.position.set(C.x - 1, y0 + 6.5, C.z - 12);
        this.group.add(this.pack);
        break;
      }
      case 3: { // выбирают жертву: кидаются на того, кто ест; потеряв троих — бегут
        shot([-6, 5, 15], [1, 1, -3]);
        const E = this.survivor(3, 5, 'survivor_c', 'bread');
        E.mob.state = 'eat';
        E.eating = true;
        E.post = E.pos.clone();
        this.tag(E, 'ест', '#ffcf6a', 2.4);
        const G = this.survivor(-1, 3.5, 'survivor', 'sword');
        G.post = G.pos.clone();
        for (const dx of [4, 5]) {                                   // подстилка на земле
          const b = this.block('wool_red', dx, y0, 6);
          b.scale.y = 0.08;
          b.position.y = y0 + 0.04;
        }
        this.w.cart(C.x - 6, C.z + 6, 2.2, this.group);
        this.lantern(1.5, 6.2);
        for (let k = 0; k < 6; k++) {
          const w = this.walker(-10 + k * 3.6, -15 - (k % 2) * 4, k, 1);
          const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]),
            new THREE.LineDashedMaterial({ color: 0xff5a5a, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.55, fog: false }));
          line.frustumCulled = false;
          this.group.add(line);
          w.line = line;
        }
        break;
      }
      case 4: { // давят числом: обходят с боков, плетень маленького хутора не держит
        shot([0, 14, 23], [0, 0, -1]);
        const hut = [];
        for (let x = -2; x <= 2; x++) for (let z = 4; z <= 8; z++) {
          const edge = x === -2 || x === 2 || z === 4 || z === 8;
          if (!edge) continue;
          for (let y = 0; y < 3; y++) if (!(z === 4 && x === 0 && y < 2)) hut.push([x, y0 + y, z]);
        }
        this.blocks('planks', hut);
        this.blocks('log', [[-2, y0 + 3, 4], [2, y0 + 3, 4], [-2, y0 + 3, 8], [2, y0 + 3, 8]]);
        const roof = [];                                    // крыша наполовину провалилась — видно, кто внутри
        for (let x = -3; x <= 3; x++) for (let z = 3; z <= 5; z++) roof.push([x, y0 + 3 + (Math.abs(x) <= 1 ? 1 : 0), z]);
        this.blocks('spruce_planks', roof);
        this.blocks('burnt_log', [[-3, y0 + 3, 7], [3, y0 + 3, 6]]);
        this.fence = [];
        for (let a = 0; a < Math.PI * 2; a += 0.21) {
          const dx = Math.round(Math.cos(a) * 8), dz = Math.round(6 + Math.sin(a) * 6.5);
          if (this.fence.some((b) => b.userData.dx === dx && b.userData.dz === dz)) continue;
          const b = this.block(Math.round(a * 10) % 2 ? 'log' : 'spruce_planks', dx, y0, dz);
          b.scale.set(0.3, 1.2, 0.3);
          b.position.y += 0.1;
          b.userData = { dx, dz };
          this.fence.push(b);
        }
        this.survivor(-0.5, 6, 'survivor', 'sword').post = V(C.x - 0.5, 0, C.z + 6);
        this.survivor(1, 6.5, 'survivor_b', 'torch').post = V(C.x + 1, 0, C.z + 6.5);
        for (let k = 0; k < (this.w.mobile ? 10 : 16); k++) {
          const side = k % 2 ? 1 : -1;
          const w = this.walker(side * (2 + (k >> 1) * 1.2), -20 - (k >> 1) * 1.4, k);
          w.side = side;
          w.row = k >> 1;
        }
        break;
      }
      case 5: { // тянут сквозь стену: сталкер выдёргивает выжившего из-за укрытия в два блока
        shot([12, 7.5, 8], [-2.5, 1.4, -1]);
        const wall = [];
        for (let x = -4; x <= 4; x++) for (let y = 0; y < 2; y++) wall.push([0, y0 + y, x - 0.0]);
        // стена поперёк взгляда камеры: камера смотрит вдоль оси x, стена вдоль z — видно обе стороны
        this.blocks('cobble', wall.map(([_, y, z]) => [0, y, z]));
        this.blocks('mossy_cobble', [[0, y0 + 2, -3], [0, y0 + 2, 2]]);
        const S = this.survivor(1.8, 0, 'survivor_b', 'sword');
        S.mob.state = 'crouch';
        S.post = S.pos.clone();
        S.mob.root.rotation.y = -Math.PI / 2;
        const st = this.add(new Stalker(), -4.5, -1, 999, this.stalkers);
        st.mob.root.visible = false;
        st.mob.root.rotation.y = Math.PI / 2;
        const aura = new THREE.PointLight(0xa060ff, 6, 7, 1.8);    // вокруг сталкера — фиолетовый отсвет
        aura.position.set(0, 2.2, 0.6);
        st.mob.root.add(aura);
        for (let k = 0; k < 4; k++) this.walker(-9 - k * 1.5, -4 + k * 2.5, k);
        this.lantern(3, 2);
        break;
      }
      case 6: { // прочёсывают район: гроза, руины; выживший спрятался — мёртвые обыскивают, где видели последний раз
        shot([6, 9, 20], [-1, 1, -4]);
        const R = [];
        const house = (x0, z0, w, d, door) => {
          for (let x = 0; x <= w; x++) for (let z = 0; z <= d; z++) {
            if (!(x === 0 || z === 0 || x === w || z === d)) continue;
            const corner = (x === 0 || x === w) && (z === 0 || z === d);
            const h = corner ? 4 : 1 + Math.floor(hash(x0 + x, z0 + z) * 3);
            for (let y = 0; y < h; y++) {
              if (door(x, z) && y < 2) continue;
              R.push([corner ? 'burnt_log' : y === 0 ? 'cobble' : hash(x, y + z) > 0.5 ? 'cracked_bricks' : 'burnt_planks', x0 + x, y0 + y, z0 + z]);
            }
          }
        };
        house(-11, -6, 5, 4, (x, z) => x === 5 && z === 2);
        house(4, -9, 5, 5, (x, z) => x === 0 && z === 2);
        house(-3, 3, 5, 4, (x, z) => z === 0 && x === 2);
        for (const m of ['burnt_log', 'cobble', 'cracked_bricks', 'burnt_planks'])
          this.blocks(m, R.filter((b) => b[0] === m).map((b) => b.slice(1)));
        this.w.cart(C.x - 3, C.z - 12, 1.2, this.group);
        this.w.fire(this.at(-8.5, -4), 0.55, this.group);        // тлеет в развалинах — под дождём едва живой
        this.lantern(2.5, 2.5);
        const S = this.survivor(12, 2, 'survivor_b', 'sword');
        S.route = [V(C.x + 5, 0, C.z + 1), V(C.x - 0.5, 0, C.z + 1), V(C.x - 0.5, 0, C.z + 5.5)];
        this.hideAt = V(C.x - 0.5, 0, C.z + 5.5);
        this.lastSeen = V(C.x + 2, 0, C.z + 1);
        for (let k = 0; k < 8; k++) {
          const w = this.walker(10 + (k % 4) * 2, -8 - Math.floor(k / 4) * 3, k);
          w.delay = 1.5 + k * 0.4;
        }
        this.probes = [V(-8.5, 0, -4), V(-6, 0, -2), V(6.5, 0, -6.5), V(3, 0, -7), V(-0.5, 0, 1.5), V(-4, 0, 5), V(3, 0, 5), V(0, 0, -3)]
          .map((p) => p.add(V(C.x, 0, C.z)));
        break;
      }
      case 7: { // лунная ночь: полная орда по календарю; стена, руны, маги держат барьер
        shot([0, 15.5, 25], [0, 1.5, -8]);
        const W = [], crenel = [];
        for (let x = -15; x <= 15; x++) {
          for (let y = 0; y < 4; y++) W.push([x, y0 + y, 4]);
          for (let y = 0; y < 3; y++) W.push([x, y0 + y, 5]);
          if (x % 2 === 0) crenel.push([x, y0 + 4, 4]);
        }
        this.blocks('bricks', W);
        this.blocks('cracked_bricks', crenel);
        // руны на стене и барьер перед ней
        const runeM = new THREE.MeshBasicMaterial({ map: mat('rune').map, color: 0xd7a2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
        this.runes = [];
        for (let x = -12; x <= 12; x += 4) {
          const r = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), runeM);
          r.position.set(C.x + x + 0.5, y0 + 2, C.z + 3.97);
          r.rotation.y = Math.PI;
          this.group.add(r);
          this.runes.push(r);
        }
        this.barrier = new THREE.Mesh(new THREE.PlaneGeometry(34, 9, 1, 1), new THREE.ShaderMaterial({
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
          uniforms: { t: { value: 0 }, hit: { value: V(0, -9, 0) }, hitT: { value: 9 } },
          vertexShader: 'varying vec2 vUv; varying vec3 vP; void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
          fragmentShader: `uniform float t, hitT; uniform vec3 hit; varying vec2 vUv; varying vec3 vP;
            void main(){
              vec2 g = vUv * vec2(34., 9.) * .9;
              vec2 h = abs(fract(vec2(g.x + mod(floor(g.y), 2.) * .5, g.y)) - .5);
              float hex = smoothstep(.44, .5, max(h.x, h.y));
              float wave = .5 + .5 * sin(vUv.y * 12. - t * 2. + vUv.x * 4.);
              float fade = smoothstep(0., .25, vUv.y) * smoothstep(1., .55, vUv.y);
              float d = length(vP.xy - hit.xy), ripple = smoothstep(1., 0., abs(d - hitT * 7.)) * exp(-hitT * 2.5);
              float a = (hex * .16 * (.4 + wave) + .05 + wave * .05 + ripple * .9) * fade;
              gl_FragColor = vec4(vec3(.75,.45,1.) * a, a);
            }`,
        }));
        this.barrier.position.set(C.x + 0.5, y0 + 4, C.z + 2.2);
        this.group.add(this.barrier);
        for (const x of [-14, -3, 8, 15]) this.w.fire(V(C.x + x + 0.5, y0 + 4, C.z + 4.5), 0.5, this.group);   // жаровни на стене
        // на стене: маги и защитники
        const onWall = (x, tex, kind, item) => {
          const a = this.add(new Humanoid(tex, kind, 50 + x, item), x, 4.5, 999, this.survivors);
          a.onWall = y0 + 4;
          a.mob.root.rotation.y = Math.PI;
          a.post = a.pos.clone();
          return a;
        };
        this.mages = [onWall(-6, 'mage', 'survivor', 'staff'), onWall(5, 'mage', 'survivor', 'staff')];
        this.mages.forEach((m, k) => (m.cast = 1 + k * 0.9));
        onWall(-1, 'survivor', 'survivor', 'torch');
        onWall(10, 'survivor_b', 'survivor', 'sword');
        onWall(-11, 'survivor_c', 'survivor', 'torch');
        const n = this.w.mobile ? 20 : 38;
        for (let k = 0; k < n; k++) this.walker((hash(k, 1) - 0.5) * 30, -6 - hash(k, 2) * 22, k, 1).respawn = true;
        for (let k = 0; k < 3; k++) this.wolf(-10 + k * 9, -24 - k * 2, k).respawn = true;
        const st = this.add(new Stalker(3), 7, -18, 3, this.stalkers);
        st.respawn = true;
        st.mob.anger = 1;
        break;
      }
    }
    this.agents.forEach((a) => a.place());
  }

  /** Фонарь на столбике: тёплый свет в темноте. */
  lantern(dx, dz) {
    const yb = this.y(this.c.x + dx, this.c.z + dz);
    const post = this.block('spruce_log', dx, yb, dz);
    post.scale.set(0.2, 1, 0.2);
    const l = this.block('lantern', dx, yb + 1, dz);
    l.scale.setScalar(0.4);
    l.position.y -= 0.3;
    const light = new THREE.PointLight(0xffb060, 10, 14, 1.6);
    light.position.copy(l.position);
    light.castShadow = !this.w.mobile;
    light.shadow.mapSize.set(256, 256);
    this.group.add(light);
    return light;
  }

  // ================================================================== ход сценки
  update(dt, t) {
    this.time = t;
    // частицы и вспышки
    for (let i = this.fxList.length - 1; i >= 0; i--) {
      const f = this.fxList[i];
      f.life -= dt;
      if (f.light) {
        f.light.intensity = Math.max(0, f.life) * 60;
        if (f.life <= 0) {
          this.w.scene.remove(f.light);
          this.fxList.splice(i, 1);
        }
        continue;
      }
      const a = f.pts.geometry.attributes.position;
      f.v.forEach((v, k) => {
        v.y -= dt * f.grav;
        a.setXYZ(k, a.getX(k) + v.x * dt, a.getY(k) + v.y * dt, a.getZ(k) + v.z * dt);
      });
      a.needsUpdate = true;
      f.pts.material.opacity = Math.max(0, Math.min(1, f.life * 1.5));
      if (f.life <= 0) {
        this.w.scene.remove(f.pts);
        this.fxList.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.r += dt * 11;
      r.m.scale.setScalar(r.r);
      r.m.material.opacity = Math.max(0, 1 - r.r / r.max) * 0.8;
      if (r.r > r.max) {
        this.w.scene.remove(r.m);
        this.rings.splice(i, 1);
      }
    }
    if (this.tier < 0) return;
    const T = t - this.started;
    this.T = T;
    const live = (l) => l.filter((a) => a.alive);
    // вороны кружат
    for (const c of this.crows) {
      c.a += dt * c.sp;
      c.c.root.position.set(c.around.x + Math.cos(c.a) * c.r, c.around.y + c.h + Math.sin(c.a * 2) * 0.6, c.around.z + Math.sin(c.a) * c.r);
      c.c.root.rotation.y = -c.a;
      c.c.animate(dt, t);
    }
    // разлёт обломков (плетень)
    for (const b of this.flying) {
      const f = b.userData.fly;
      f.y -= dt * 14;
      b.position.addScaledVector(f, dt);
      b.rotation.x += dt * 7;
      b.rotation.z += dt * 4;
      const g = this.y(b.position.x, b.position.z);
      if (b.position.y < g + 0.15) {
        b.position.y = g + 0.15;
        f.multiplyScalar(0.3);
        f.y = Math.abs(f.y) * 0.2;
      }
    }
    const step = this['tier' + this.tier];
    if (step) step.call(this, dt, t, T);
    this.separate(dt);
    for (const a of this.agents) a.update(dt, t);
    for (const a of this.survivors) if (a.onWall !== undefined) {
      a.pos.y = a.onWall;
      a.mob.root.position.y = a.onWall;
    }
  }

  /** Мёртвые не проходят друг сквозь друга: мягкое расталкивание. */
  separate(dt) {
    const L = this.agents.filter((a) => a.alive && a.onWall === undefined);
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
      const a = L[i], b = L[j];
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.01 && d < 0.9) {
        const k = ((0.9 - d) / d) * dt * 3;
        if (!a.anchored) a.pos.x -= dx * k, a.pos.z -= dz * k;
        if (!b.anchored) b.pos.x += dx * k, b.pos.z += dz * k;
      }
    }
  }

  /** Выживший отбивается: ближний мертвец в радиусе — замах, удар, отброс. */
  fight(S, dt, reach = 2.1) {
    let near = null, nd = 1e9;
    for (const w of [...this.walkers, ...this.wolves]) if (w.alive) {
      const d = w.dist(S);
      if (d < nd) nd = d, near = w;
    }
    S.cool -= dt;
    if (near && nd < 7) {
      S.mob.lookTarget = near.pos.clone().add(V(0, 1.4, 0));
      S.face(near.pos, dt);
      S.facing = true;
    }
    if (near && nd < reach && S.cool <= 0) {
      S.cool = 0.75;
      S.mob.play('attack', 0.45);
      const target = near;
      setTimeout(() => target.hurt(S), 180);
    }
    return { near, nd };
  }

  /** Мертвец бьёт, если дотянулся. */
  bite(w, S, dt) {
    w.cool -= dt;
    if (w.dist(S) < 1.35 && w.cool <= 0) {
      w.cool = 1.1;
      w.mob.play(w.mob.kind === 'wolf' ? 'leap' : 'attack', 0.5);
      S.mob.hurt();
    }
  }

  // ------------------------------------------------------------------ T0
  tier0(dt, t, T) {
    const S = this.survivors[0];
    this.fight(S, dt);
    S.seek(S.post, 0.8, dt);
    for (const w of this.walkers) {
      if (!w.alive) continue;
      w.mob.lookTarget = S.pos.clone().add(V(0, 1.5, 0));
      if (T > w.delay) w.seek(S.pos, 0.75 * w.speedMul, dt);
      this.bite(w, S, dt);
    }
    if (live(this.walkers).length === 0 && !this.flags.end) this.flags.end = T;
    if (this.flags.end && T - this.flags.end > 4) this.setTier(0);
    function live(l) { return l.filter((a) => a.alive); }
  }

  // ------------------------------------------------------------------ T1
  tier1(dt, t, T) {
    const S = this.survivors[0];
    const threat = this.walkers.some((w) => w.alive && w.dist(S) < 4);
    if (threat) {
      S.mob.state = 'idle';
      S.mob.hold('sword');
      this.fight(S, dt);
    } else if (S.mob.state === 'mine') {
      S.face(V(S.pos.x, 0, S.pos.z - 3), dt);
      S.facing = true;
      // удар киркой — кусочки камня и волна звука
      this.flags.nextHit -= dt;
      if (this.flags.nextHit <= 0) {
        this.flags.nextHit = 1 / 2.2;
        this.fx('debris', V(S.pos.x, S.pos.y - 0.3, S.pos.z - 1.3), 0x77777c);
        if ((this.flags.hits = (this.flags.hits || 0) + 1) % 3 === 0) this.ring(S.pos, 22);
      }
    }
    S.seek(S.post, 0.6, dt);
    for (const w of this.walkers) {
      if (!w.alive) continue;
      // услышал: волна дошла до него — поворачивает голову и идёт к источнику
      for (const r of this.rings) if (Math.abs(r.at.distanceTo(V(w.pos.x, r.at.y, w.pos.z)) - r.r) < 0.8 && !w.heard) {
        w.heard = r.at.clone();
        this.tag(w, '!', '#ffb04a');
        setTimeout(() => w.label && (w.label.visible = false), 1400);
      }
      if (this.noise && t < this.noise.until && w.pos.distanceTo(V(this.noise.at.x, w.pos.y, this.noise.at.z)) < 22) {
        w.mob.lookTarget = this.noise.at.clone().add(V(0, 1, 0));
        if (w.seek(this.noise.at, 1.2, dt) < 1.5) w.stop(dt);
      } else if (w.heard) {
        w.mob.lookTarget = S.pos.clone().add(V(0, 1.5, 0));
        w.seek(S.pos, 1.05 * w.speedMul, dt);
        this.bite(w, S, dt);
      } else {
        w.mob.lookTarget = null;
        if (!w.wp || w.seek(w.wp, 0.35, dt) < 0.6) w.wp = w.wander.clone().add(V((hash(t, w.pos.x) - 0.5) * 6, 0, (hash(w.pos.z, t) - 0.5) * 6));
      }
    }
    if (T > 26 || (T > 8 && this.walkers.every((w) => !w.alive))) this.setTier(1);
  }

  // ------------------------------------------------------------------ T2
  tier2(dt, t, T) {
    const [S, S2] = this.survivors;
    const pack = [...this.walkers, ...this.wolves];
    const gathered = pack.filter((w) => w.state === 'wait').length;
    if (!this.flags.go) this.pack.userData.draw('стая ' + gathered + '/' + pack.length);
    if (gathered >= 4 && !this.flags.go) {
      this.flags.go = T;
      this.pack.userData.draw('вперёд');
      for (const w of this.wolves) w.mob.state = 'howl';
    }
    for (const s of [S, S2]) {
      this.fight(s, dt);
      s.seek(s.post, 0.8, dt);
    }
    for (const w of pack) {
      if (!w.alive) continue;
      w.mob.lookTarget = S.pos.clone().add(V(0, 1.5, 0));
      if (T < w.delay) continue;
      if (w.hp === 1 && w.maxHp > 1 && w.state !== 'flee') {                    // треть здоровья — отходит к лесу
        w.state = 'flee';
        this.tag(w, '…', '#9a9aa8');
      }
      if (w.state === 'flee') {
        w.mob.lookTarget = null;
        if (w.seek(V(w.pos.x, 0, this.c.z - 24), 0.7, dt) < 1) w.mob.root.visible = false;
        continue;
      }
      if (w.state === 'come' && w.seek(w.spot, w.mob.kind === 'wolf' ? 2 : 1.3, dt) < 0.5) w.state = 'wait';
      if (w.state === 'wait') {
        w.stop(dt);
        w.face(S.pos, dt, 3);
        w.facing = true;
        if (w.mob.kind === 'wolf') w.mob.state = this.flags.go && T - this.flags.go < 1.4 ? 'howl' : 'hunt';
      }
      if (this.flags.go && T - this.flags.go > 1.4 && w.state !== 'flee') {
        w.state = 'charge';
        if (w.mob.kind === 'wolf') w.mob.state = 'hunt';
        const target = w.dist(S) < w.dist(S2) ? S : S2;
        w.seek(target.pos, (w.mob.kind === 'wolf' ? 2.6 : 1.3) * (w.speedMul || 1), dt);
        this.bite(w, target, dt);
      }
    }
    if (pack.every((w) => !w.alive || w.state === 'flee') && this.flags.go && !this.flags.end) this.flags.end = T;
    if ((this.flags.end && T - this.flags.end > 3) || T > 34) this.setTier(2);
  }

  // ------------------------------------------------------------------ T3
  tier3(dt, t, T) {
    const [E, G] = this.survivors;
    const flee = this.kills >= 3;
    // охранник встаёт между едящим и стаей
    const alive = this.walkers.filter((w) => w.alive);
    if (!flee && alive.length) {
      const mid = alive.reduce((p, w) => p.add(w.pos), V(0, 0, 0)).multiplyScalar(1 / alive.length);
      const guard = E.pos.clone().lerp(mid, 0.28);
      G.seek(guard, 1.5, dt);
    } else G.seek(G.post, 0.8, dt);
    this.fight(G, dt, 2.3);
    E.seek(E.post, 0.5, dt);
    if (flee && !this.flags.fled) {
      this.flags.fled = T;
      for (const w of alive) this.tag(w, '!', '#ff6a6a');
    }
    for (const w of this.walkers) {
      if (w.line) {
        w.line.visible = w.alive && !flee;
        if (w.line.visible) {
          w.line.geometry.setFromPoints([w.pos.clone().add(V(0, 1.6, 0)), E.pos.clone().add(V(0, 1.2, 0))]);
          w.line.computeLineDistances();
        }
      }
      if (!w.alive) continue;
      if (flee) {
        w.mob.lookTarget = null;
        w.seek(V(w.pos.x * 1.02 - this.c.x * 0.02, 0, this.c.z - 30), 2.1, dt);
        continue;
      }
      w.mob.lookTarget = E.pos.clone().add(V(0, 1.2, 0));
      w.seek(E.pos, 1.15 * w.speedMul, dt);
      this.bite(w, E, dt);
    }
    if (E.mob.state === 'eat' && Math.random() < dt * 2) this.fx('crumbs', E.pos);
    if ((this.flags.fled && T - this.flags.fled > 5) || T > 30) this.setTier(3);
  }

  // ------------------------------------------------------------------ T4
  tier4(dt, t, T) {
    const C = this.c;
    for (const s of this.survivors) {
      const { nd } = this.fight(s, dt);
      s.seek(s.post, 0.8, dt);
      if (s.mob.item === 'torch') s.mob.state = nd < 5 ? 'panic' : 'idle';
    }
    for (const w of this.walkers) {
      if (!w.alive) continue;
      w.mob.lookTarget = V(C.x, C.y + 1.5, C.z + 6);
      // сначала расходятся по дуге на фланги, потом сжимают кольцо со всех сторон
      if (T < 7) {
        const a = (0.2 + (w.row / 8) * 1.6) * w.side;
        const p = V(C.x + Math.sin(a) * 15, 0, C.z + 6 - Math.cos(a) * 13);
        w.seek(p, 1.25 * w.speedMul, dt);
      } else {
        const target = this.survivors[w.row % 2].pos;
        w.seek(target, 1.0 * w.speedMul, dt);
        this.bite(w, this.survivors[w.row % 2], dt);
      }
      for (const b of this.fence) {                                  // плетень ломается от напора
        if (b.userData.fly) continue;
        const d = Math.hypot(w.pos.x - b.position.x, w.pos.z - b.position.z);
        if (d < 0.9) {
          b.userData.fly = V((b.position.x - C.x) * -0.25 + (Math.random() - 0.5) * 2, 4, (b.position.z - C.z - 6) * -0.25);
          this.flying.push(b);
          this.fx('debris', b.position.clone().add(V(0, -0.5, 0)), 0x6b4f35);
        } else if (d < 1.4) w.stop(dt * 0.4);
      }
    }
    if (T > 26) this.setTier(4);
  }

  // ------------------------------------------------------------------ T5
  tier5(dt, t, T) {
    const C = this.c;
    const S = this.survivors[0], st = this.stalkers[0];
    for (const w of this.walkers) {
      if (!w.alive) continue;
      w.mob.lookTarget = S.pos.clone().add(V(0, 1.2, 0));
      if (this.flags.pulled) {
        w.seek(S.pos, 1.2 * w.speedMul, dt);
        this.bite(w, S, dt);
      } else {
        // упёрлись в стену: скребут руками, пройти не могут
        const p = V(C.x - 1.1, 0, Math.max(C.z - 4, Math.min(C.z + 4, S.pos.z + (w.pos.z - S.pos.z) * 0.5)));
        if (w.seek(p, 0.9 * w.speedMul, dt) < 0.6 && Math.random() < dt) w.mob.play('attack', 0.5);
      }
    }
    st.mob.lookTarget = S.pos.clone().add(V(0, 1.2, 0));
    if (T > 2 && !st.mob.root.visible) {
      st.mob.root.visible = true;
      this.fx('tp', st.pos);
    }
    st.mob.anger = Math.min(1, Math.max(0, (T - 2.5) / 1.5));
    if (T > 4.4 && !this.flags.grab) {
      this.flags.grab = T;
      st.mob.play('grab', 0.9);
    }
    if (this.flags.grab && T - this.flags.grab > 0.45 && !this.flags.pulled) {
      this.flags.pulled = true;
      this.fx('tp', S.pos);
      S.pos.set(st.pos.x + 1.3, 0, st.pos.z + 0.6);
      S.post = S.pos.clone();
      S.mob.state = 'idle';
      S.mob.play('hurt', 0.5);
      this.fx('tp', S.pos);
    }
    if (this.flags.pulled) {
      this.fight(S, dt);
      S.seek(S.post, 0.5, dt);
    }
    st.stop(dt);
    st.face(S.pos, dt, 4);
    st.facing = true;
    if (T > 17) this.setTier(5);
  }

  // ------------------------------------------------------------------ T6
  tier6(dt, t, T) {
    const S = this.survivors[0];
    if (S.route.length) {
      if (S.seek(S.route[0], 2.4, dt) < 0.5) S.route.shift();
      if (!S.route.length) {
        S.mob.state = 'crouch';
        S.hidden = T;
      }
    } else S.stop(dt);
    if (!this.ghost && T > 1.2) {                                    // «видели здесь»: призрачный силуэт
      const g = new Humanoid('survivor_b', 'survivor', 5);
      g.root.traverse((o) => {
        if (o.isMesh) o.material = new THREE.MeshBasicMaterial({ color: 0xc58bff, transparent: true, opacity: 0.22, depthWrite: false, fog: false });
      });
      g.root.position.set(this.lastSeen.x, this.y(this.lastSeen.x, this.lastSeen.z), this.lastSeen.z);
      g.root.rotation.y = -Math.PI / 2;
      this.group.add(g.root);
      this.ghost = g;
    }
    if (this.ghost) this.ghost.root.visible = S.hidden !== undefined && Math.sin(t * 3) > -0.6;
    for (const w of this.walkers) {
      if (!w.alive || T < w.delay) continue;
      if (S.hidden === undefined) {
        w.mob.lookTarget = S.pos.clone().add(V(0, 1.4, 0));
        w.seek(S.pos, 1.3 * w.speedMul, dt);
        continue;
      }
      // не видят — идут туда, где видели, и расходятся по руинам
      if (!w.search) {
        w.search = 'last';
        this.tag(w, '?', '#c58bff');
      }
      if (w.search === 'last') {
        if (w.seek(this.lastSeen, 1.1, dt) < 2.5) {
          w.search = 'probe';
          w.probe = this.probes[Math.floor(Math.random() * this.probes.length)];
        }
      } else {
        w.mob.state = 'search';
        if (w.seek(w.probe, 0.7, dt) < 0.7) {
          w.stop(dt);
          w.wait = (w.wait || 0) + dt;
          if (w.wait > 1.6) {
            w.wait = 0;
            w.probe = this.probes[Math.floor(Math.random() * this.probes.length)];
          }
        }
        if (w.label) w.label.position.y = 2.6 + Math.sin(t * 4 + w.pos.x) * 0.08;
        // нашёл
        if (w.dist(S) < 2.2 && !this.flags.found) {
          this.flags.found = T;
          this.tag(w, '!', '#ff6a6a');
          S.mob.state = 'idle';
        }
      }
      if (this.flags.found) {
        w.mob.state = 'idle';
        w.seek(S.pos, 1.3, dt);
        this.bite(w, S, dt);
      }
    }
    if (this.flags.found) this.fight(S, dt);
    if ((this.flags.found && T - this.flags.found > 5) || T > 32) this.setTier(6);
  }

  // ------------------------------------------------------------------ T7
  tier7(dt, t, T) {
    const C = this.c;
    const wallZ = C.z + 2.4;
    this.barrier.material.uniforms.t.value = t;
    this.barrier.material.uniforms.hitT.value += dt;
    for (const r of this.runes) r.material.opacity = 0.6 + Math.sin(t * 3 + r.position.x) * 0.3;
    // маги бьют чарами по толпе: светящийся заряд летит по дуге, взрыв раскидывает мёртвых
    for (const m of this.mages) {
      m.cast -= dt;
      m.mob.state = m.cast < 0.6 ? 'cast' : 'idle';
      const targets = this.walkers.filter((w) => w.alive && w.pos.z < wallZ - 1);
      if (targets.length) m.mob.lookTarget = targets[0].pos.clone().add(V(0, 1, 0));
      if (m.cast <= 0 && targets.length) {
        m.cast = 2.2 + Math.random();
        const tgt = targets[Math.floor(Math.random() * Math.min(6, targets.length))];
        const orb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe6c2ff }));
        const light = new THREE.PointLight(0xb070ff, 20, 10, 1.6);
        orb.add(light);
        orb.position.set(m.pos.x, m.onWall + 3.4, m.pos.z);
        this.group.add(orb);
        this.bolts.push({ orb, from: orb.position.clone(), to: tgt.pos.clone(), k: 0 });
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.k += dt * 1.4;
      const p = b.from.clone().lerp(b.to, b.k);
      p.y += Math.sin(b.k * Math.PI) * 4;
      b.orb.position.copy(p);
      if (b.k >= 1) {
        this.group.remove(b.orb);
        this.bolts.splice(i, 1);
        this.fx('magic', b.to);
        for (const w of [...this.walkers, ...this.wolves]) if (w.alive && w.pos.distanceTo(b.to) < 2.6) {
          w.vel.add(V(w.pos.x - b.to.x, 0, w.pos.z - b.to.z).normalize().multiplyScalar(5));
          w.hurt(null);
        }
      }
    }
    for (const s of this.survivors) if (!this.mages.includes(s)) {
      s.mob.lookTarget = V(C.x + (s.pos.x - C.x) * 0.5, C.y, C.z - 6);
      if (s.mob.item === 'sword' && Math.random() < dt * 0.6) s.mob.play('attack', 0.5);
    }
    // толпа давит на барьер; барьер вспыхивает там, где бьют
    for (const w of [...this.walkers, ...this.wolves, ...this.stalkers]) {
      if (!w.alive) {
        if (w.respawn && w.mob.deadT > 3) this.revive(w);
        continue;
      }
      w.mob.lookTarget = V(w.pos.x, C.y + 5, wallZ + 2);
      if (w.mob.kind === 'wolf') w.mob.state = 'hunt';
      const p = V(w.pos.x * 0.96 + C.x * 0.04, 0, wallZ - 0.6);
      if (w.seek(p, (w.mob.kind === 'wolf' ? 2.3 : 1.35) * (w.speedMul || 1), dt) < 1.2) {
        w.stop(dt);
        if (Math.random() < dt * 0.8) {
          w.mob.play(w.mob.kind === 'wolf' ? 'leap' : w.mob.kind === 'stalker' ? 'grab' : 'attack', 0.5);
          this.barrier.material.uniforms.hit.value.set(w.pos.x - this.barrier.position.x, 1.5 - 4 + 1, 0);
          this.barrier.material.uniforms.hitT.value = 0;
        }
      }
    }
  }

  /** Орда бесконечна: павший уходит в землю и поднимается снова в глубине поля. */
  revive(a) {
    a.alive = true;
    a.hp = a.maxHp;
    a.pos.set(this.c.x + (Math.random() - 0.5) * 30, 0, this.c.z - 24 - Math.random() * 6);
    a.mob.state = 'idle';
    a.mob.deadT = 0;
    a.mob.root.rotation.x = 0;
    a.mob.root.rotation.z = 0;
    a.place();
  }
}
