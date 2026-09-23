// Поселение растёт: плетень → частокол → каменная стена → руны и барьер; с уровнями прибавляются дома.
import * as THREE from 'three';
import { Humanoid, skin } from './models.js';
import { heightAt } from './world.js';

export const STAGES = [
  { name: 'Развалины', text: 'Три лачуги и костёр. Ни стены, ни стражи.' },
  { name: 'Плетень', text: 'Жители обносят двор плетнём. Первые дома у стены.' },
  { name: 'Частокол', text: 'Заострённые брёвна в рост человека. Появляются новые работники.' },
  { name: 'Каменная стена', text: 'Строители кладут камень снаружи, старое разбирают. Зубцы, вышки, свои здания у работников.' },
  { name: 'Руны и барьер', text: 'Маги обходят стену и накладывают руны. Слабые мертвецы у барьера сгорают.' },
];

const R = 13;

export class Town {
  constructor(world, center) {
    this.w = world;
    this.c = center;
    this.group = new THREE.Group();
    world.scene.add(this.group);
    this.anim = [];
    this.stage = -1;
    this.wall = [];
    this.houses = [];
    this.runes = [];
    world.fire(new THREE.Vector3(center.x, this.y(center.x, center.z), center.z), 1);
    this.mage = new Humanoid('mage', 'survivor', 41, 'staff');
    this.mage.root.visible = false;
    this.group.add(this.mage.root);
    this.barrier = new THREE.Mesh(new THREE.SphereGeometry(R + 2, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { t: { value: 0 }, k: { value: 0 } },
        vertexShader: 'varying vec3 n; varying vec3 v; varying vec3 p; void main(){ n = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); v = -mv.xyz; p = position; gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform float t; uniform float k; varying vec3 n; varying vec3 v; varying vec3 p; void main(){ float f = pow(1. - abs(dot(normalize(n), normalize(v))), 2.5); float bands = .5 + .5*sin(p.y*3. - t*2.); float hex = step(.92, fract(p.x*.6 + t*.1)) + step(.92, fract(p.z*.6)); gl_FragColor = vec4(vec3(.7,.35,1.)*(f*1.6 + bands*.08 + hex*.15), (f*.8 + .05)*k); }',
      }));
    this.barrier.position.set(center.x, this.y(center.x, center.z), center.z);
    world.scene.add(this.barrier);
    world.updaters.push((dt, t) => this.update(dt, t));
  }

  y(x, z) {
    return heightAt(Math.floor(x), Math.floor(z)) + 1;
  }

  block(mat, x, y, z, s = 1) {
    const m = new THREE.Mesh(this.w._box ||= new THREE.BoxGeometry(1, 1, 1), mat);
    m.scale.setScalar(s);
    m.position.set(x + 0.5, y + 0.5 * s, z + 0.5);
    m.castShadow = true;
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  /** Блок «вырастает» из земли с задержкой — видно, как кладут. */
  rise(m, delay) {
    const target = m.position.y;
    m.userData.target = target;
    m.position.y = target - 1.2;
    m.scale.y = 0.01;
    this.anim.push({ m, delay, dur: 0.5, mode: 'rise' });
  }

  sink(m, delay) {
    this.anim.push({ m, delay, dur: 0.6, mode: 'sink' });
  }

  ring() {
    const pts = [];
    for (let a = 0; a < Math.PI * 2; a += 1 / R) {
      const x = Math.round(this.c.x + Math.cos(a) * R), z = Math.round(this.c.z + Math.sin(a) * R);
      if (Math.abs(a - Math.PI / 2) < 0.22) continue;             // ворота к зрителю
      if (!pts.some((p) => p[0] === x && p[1] === z)) pts.push([x, z, a]);
    }
    return pts;
  }

  house(x, z, size, big, delay) {
    // домик: стены из досок с брёвнами по углам, дверь к центру, ровная двускатная крыша, фронтоны
    const out = [];
    const w = size, d = size, h = big ? 4 : 3;
    const planks = skin('planks'), log = skin('log'), roof = skin(big ? 'bricks' : 'log');
    const y0 = this.y(x + w / 2, z + d / 2);
    let k = 0;
    const put = (mat, xx, yy, zz, dl) => {
      const m = this.block(mat, x + xx, y0 + yy, z + zz);
      this.rise(m, delay + dl);
      out.push(m);
    };
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) for (let zz = 0; zz < d; zz++) {
      if (!(xx === 0 || zz === 0 || xx === w - 1 || zz === d - 1)) continue;
      if (zz === d - 1 && xx === Math.floor(w / 2) && yy < 2) continue;             // дверь
      const corner = (xx === 0 || xx === w - 1) && (zz === 0 || zz === d - 1);
      put(corner ? log : planks, xx, yy, zz, (k++) * 0.012);
    }
    const half = Math.ceil((d + 2) / 2);
    for (let s = 0; s < half; s++) {
      const za = -1 + s, zb = d - s;
      for (let xx = -1; xx <= w; xx++) {
        put(roof, xx, h + s, za, 0.5 + (k++) * 0.005);
        if (zb !== za) put(roof, xx, h + s, zb, 0.5 + (k++) * 0.005);
      }
      for (let zz = za + 1; zz < zb; zz++) {                                         // фронтоны
        put(planks, 0, h + s, zz, 0.5 + (k++) * 0.005);
        put(planks, w - 1, h + s, zz, 0.5 + (k++) * 0.005);
      }
    }
    if (big) {                                                   // кристалл на коньке — здание работника
      const c = this.block(skin('crystal', 3), x + w / 2 - 0.5, y0 + h + half, z + d / 2 - 0.5, 0.8);
      this.rise(c, delay + 1.2);
      out.push(c);
    }
    return out;
  }

  setStage(s) {
    if (s === this.stage) return;
    const up = s > this.stage;
    const pts = this.ring();
    // старая стена разбирается, когда новая уже стоит (как в игре: строят снаружи, потом сносят)
    const old = this.wall;
    this.wall = [];
    let delay = 0;
    const mats = [null, skin('log'), skin('log'), skin('bricks'), skin('bricks')];
    const heights = [0, 1, 4, 5, 5];
    if (s > 0) {
      pts.forEach(([x, z, a], i) => {
        const y0 = this.y(x, z);
        for (let yy = 0; yy < heights[s]; yy++) {
          const m = this.block(mats[s], x, y0 + yy, z, s === 1 ? 0.55 : 1);
          this.rise(m, (i / pts.length) * 1.8 + yy * 0.08);
          this.wall.push(m);
        }
        if (s >= 3 && i % 2 === 0) {                                 // зубцы
          const m = this.block(mats[s], x, y0 + heights[s], z);
          this.rise(m, 1.9 + (i / pts.length) * 0.6);
          this.wall.push(m);
        }
      });
      delay = 2.2;
    }
    old.sunk = true;
    old.forEach((m, i) => this.sink(m, (up ? delay : 0) + (i / Math.max(1, old.length)) * 0.8));
    this.later(this.wall);
    // дома
    // дома по кругу у костра, с промежутками; дверь смотрит на огонь; к зрителю (+z) — открытая площадь
    const angles = [-Math.PI / 2, -Math.PI / 2 - 0.95, -Math.PI / 2 + 0.95, Math.PI, 0, -Math.PI / 2 - 1.9, -Math.PI / 2 + 1.9];
    const want = [3, 4, 5, 7, 7][s];
    while (this.houses.length < want) {
      const i = this.houses.length, a = angles[i], size = i === 0 || i === 4 ? 5 : 4;
      const cx = this.c.x + Math.cos(a) * 7.5, cz = this.c.z + Math.sin(a) * 7.5;
      const h = this.house(Math.round(cx - size / 2), Math.round(cz - size / 2), size, (i === 0 || i === 4) && s >= 3, 0.3 + i * 0.35);
      // тёплый фонарь у двери — дом «жилой», читается ночью
      this.later(h);
      const lamp = new THREE.Object3D();
      lamp.position.set(cx, this.y(cx, cz) + 2.2, cz + size / 2 + 0.8);
      this.group.add(lamp);
      this.w.lamp({ obj: lamp, color: 0xffb060, power: 5, distance: 9 });
      h.push(lamp);
      this.houses.push(h);
    }
    while (this.houses.length > want) {
      const h = this.houses.pop();
      h.sunk = true;
      h.forEach((m, i) => this.sink(m, i * 0.004));
    }
    // руны и маг
    this.runes.forEach((m) => this.sink(m, 0));
    this.runes = [];
    this.mage.root.visible = s >= 4;
    this.runeQueue = s >= 4 ? pts.filter((p, i) => i % 5 === 0) : [];
    this.runeAt = 0;
    this.stage = s;
  }

  /**
   * Когда стройка набора блоков (дом, кольцо стены) закончилась — склеить его в несколько сеток по материалам:
   * сотни отдельных блоков превращаются в пару отрисовок.
   */
  later(list) {
    let end = 0;
    for (const a of this.anim) if (list.includes(a.m)) end = Math.max(end, a.delay + a.dur);
    (this.pending ||= []).push({ list, end: (this.now || 0) + end + 0.2 });
  }

  bakeSet(list) {
    const meshes = list.filter((m) => m.isMesh);
    if (!meshes.length) return;
    const c = new THREE.Vector3();
    meshes.forEach((m) => c.add(m.position));
    c.multiplyScalar(1 / meshes.length);
    const g = new THREE.Group();
    g.position.copy(c);
    this.group.add(g);
    g.updateMatrixWorld(true);
    for (const m of meshes) g.attach(m);
    this.w.merge(g);
    const rest = list.filter((m) => !m.isMesh);
    list.length = 0;
    list.push(g, ...rest);
  }

  update(dt, t) {
    this.now = t;
    if (this.pending) for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p.list.sunk) this.pending.splice(i, 1);
      else if (t >= p.end && !this.anim.some((a) => p.list.includes(a.m))) {
        this.bakeSet(p.list);
        this.pending.splice(i, 1);
      }
    }
    for (let i = this.anim.length - 1; i >= 0; i--) {
      const a = this.anim[i];
      a.delay -= dt;
      if (a.delay > 0) continue;
      a.k = Math.min(1, (a.k || 0) + dt / a.dur);
      const e = 1 - Math.pow(1 - a.k, 3);
      if (a.mode === 'rise') {
        a.m.scale.y = Math.max(0.01, e * (a.m.scale.x));
        a.m.position.y = a.m.userData.target - (1 - e) * 1.2;
      } else {
        a.m.position.y -= dt * 3;
        a.m.scale.multiplyScalar(1 - dt * 1.5);
        if (a.k >= 1) {
          this.group.remove(a.m);
        }
      }
      if (a.k >= 1) this.anim.splice(i, 1);
    }
    // маг обходит стену и кладёт руны
    const k = this.barrier.material.uniforms.k;
    k.value += ((this.stage >= 4 ? 0.35 + Math.min(0.65, this.runes.length * 0.08) : 0) - k.value) * dt * 1.5;
    this.barrier.material.uniforms.t.value = t;
    if (this.stage >= 4 && this.runeQueue.length) {
      const [x, z] = this.runeQueue[0];
      const inner = new THREE.Vector3(this.c.x + (x - this.c.x) * 0.8, 0, this.c.z + (z - this.c.z) * 0.8);
      const m = this.mage.root.position;
      m.y = this.y(m.x || this.c.x, m.z || this.c.z);
      const d = new THREE.Vector3(inner.x - m.x, 0, inner.z - m.z);
      if (d.length() > 0.6) {
        d.normalize();
        m.addScaledVector(d, dt * 3.2);
        this.mage.root.rotation.y = Math.atan2(d.x, d.z);
        this.mage.speed = 1;
        this.mage.state = 'idle';
      } else {
        this.mage.speed = 0;
        this.runeAt += dt;
        this.mage.state = 'cast';                                           // колдует
        if (this.runeAt > 0.7) {
          this.runeAt = 0;
          this.runeQueue.shift();
          const r = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4), new THREE.MeshBasicMaterial({
            map: skin('rune').map, color: 0xd7a2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
          r.rotation.x = -Math.PI / 2;
          r.position.set(inner.x, this.y(inner.x, inner.z) + 0.03, inner.z);
          this.group.add(r);
          this.runes.push(r);
        }
      }
      this.mage.animate(dt, t);
    }
    for (const r of this.runes) r.material.opacity = 0.7 + Math.sin(t * 3 + r.position.x) * 0.3;
  }
}
