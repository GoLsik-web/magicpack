// Сайт: одна 3D-сцена на всю страницу. Разделы переключают «площадку» — камера перелетает туда,
// сцена отвечает на выбор ступени орды и уровня поселения, на мышь и клики.
import * as THREE from 'three';
import { World, SITES, heightAt, logo } from './world.js';
import { Humanoid, skin } from './models.js';
import { Horde } from './horde.js';
import { Town, STAGES } from './town.js';

const canvas = document.getElementById('scene');
let world;
try {
  world = new World(canvas);
} catch (e) {
  document.body.classList.add('no3d');           // без WebGL — страница остаётся читаемой
  throw e;
}
const site = (n) => SITES.find((s) => s.name === n);
const at = (s, dx = 0, dy = 0, dz = 0) => new THREE.Vector3(s.x + dx, s.h + 1 + dy, s.z + dz);

// ------------------------------------------------------------------ шапка: лагерь у частокола, орда из темноты
const hero = site('hero');
logo(world, 'MAGIC PACK', at(hero, 0, 11, -10), 1);
const camp = [];
{
  // частокол: заострённые брёвна дугой, в середине — ворота из досок
  const logs = [], tips = [], gate = [];
  for (let a = -1.25; a <= 1.25; a += 0.085) {
    const x = Math.round(hero.x + Math.sin(a) * 9), z = Math.round(hero.z - 2 - Math.cos(a) * 9);
    if (logs.some(([lx, , lz]) => lx === x && lz === z)) continue;
    const y = heightAt(x, z) + 1, h = 3 + ((x * 7 + z) & 1);
    const g = Math.abs(a) < 0.12;
    for (let k = 0; k < h; k++) (g ? gate : logs).push([x, y + k, z]);
    if (!g) tips.push([x, y + h, z]);
  }
  world.blocks('spruce_log', logs);
  world.blocks('spruce_planks', gate);
  for (const [x, y, z] of tips) {                        // острия
    const m = world.block('spruce_log', x, y, z);
    m.scale.set(0.55, 0.7, 0.55);
    m.position.y -= 0.15;
    m.rotation.y = 0.78;
  }
  // лагерь: костёр, палатка, ящики, бочки, фонари
  world.fire(at(hero, 0, 0, 2), 1.15);
  // палатка: два полотнища шалашом, колышки, внутри — спальник
  {
    const g = new THREE.Group();
    g.position.set(hero.x - 5.5, hero.h + 1, hero.z - 1.5);
    g.rotation.y = 0.35;
    for (const sd of [-1, 1]) {
      const cloth = new THREE.Mesh(world._box ||= new THREE.BoxGeometry(1, 1, 1), skin('wool_red'));
      cloth.scale.set(2.3, 0.08, 3.6);
      cloth.rotation.z = -sd * 0.9;
      cloth.position.set(sd * 0.72, 0.9, 0);
      cloth.castShadow = cloth.receiveShadow = true;
      g.add(cloth);
    }
    const ridge = new THREE.Mesh(world._box, skin('spruce_log'));
    ridge.scale.set(0.12, 0.12, 4);
    ridge.position.y = 1.78;
    g.add(ridge);
    const bed = new THREE.Mesh(world._box, skin('wool_white'));
    bed.scale.set(0.9, 0.12, 2);
    bed.position.set(0, 0.06, -0.3);
    bed.receiveShadow = true;
    g.add(bed);
    world.scene.add(g);
  }
  world.blocks('spruce_planks', [[hero.x + 5, hero.h + 1, hero.z - 1], [hero.x + 6, hero.h + 1, hero.z - 1], [hero.x + 5, hero.h + 2, hero.z - 1]]);
  world.blocks('hay', [[hero.x + 6, hero.h + 1, hero.z]]);
  world.cart(hero.x + 7, hero.z - 4, 2.4);
  for (const [dx, dz] of [[-4, -1], [4, -1]]) {
    const post = world.block('spruce_log', hero.x + dx, hero.h + 1, hero.z + dz);
    post.scale.set(0.2, 1.4, 0.2);
    post.position.y += 0.2;
    const l = world.block(skin('lantern'), hero.x + dx, hero.h + 2, hero.z + dz);
    l.scale.setScalar(0.4);
    l.position.y += 0.05;
    world.lamp({ pos: l.position.clone(), color: 0xffb060, power: 9, distance: 12 });
  }
  // выжившие у огня: один ест, второй сторожит с факелом, маг держит обережный круг
  const people = [[-2, 3, 'survivor', 2.6, 'bread', 'eat'], [2.4, 3.2, 'survivor_b', -2.5, 'torch', 'idle'],
    [0.5, 5.2, 'mage', Math.PI, 'staff', 'cast'], [-1.5, -3.5, 'survivor_c', 0, 'sword', 'idle']];
  for (const [dx, dz, tex, yaw, item, state] of people) {
    const h = new Humanoid(tex, 'survivor', dx * 7 + 3, item);
    h.root.position.copy(at(hero, dx, 0, dz));
    h.root.rotation.y = yaw;
    h.state = state;
    world.scene.add(h.root);
    camp.push(h);
  }
  // орда за частоколом: силуэты с горящими глазами подходят и скребут брёвна
  for (let k = 0; k < (world.mobile ? 8 : 18); k++) {
    const h = new Humanoid(['walker', 'walker_b', 'walker_v', 'walker_c'][k % 4], 'walker', k + 11);
    const x = hero.x + (Math.random() - 0.5) * 30, z = hero.z - 17 - Math.random() * 16;
    h.root.position.set(x, heightAt(x, z) + 1, z);
    h.home = h.root.position.clone();
    const a = Math.max(-1.1, Math.min(1.1, Math.atan2(x - hero.x, -(z - hero.z + 2))));
    h.goal = new THREE.Vector3(hero.x + Math.sin(a) * 10.3, 0, hero.z - 2 - Math.cos(a) * 10.3);
    world.scene.add(h.root);
    camp.push(h);
  }
}
const mouse = new THREE.Vector2(), ray = new THREE.Raycaster();
const cursorWorld = new THREE.Vector3();
world.updaters.push((dt, t) => {
  for (const h of camp) {
    if (h.kind === 'walker') {
      const p = h.root.position;
      const d = new THREE.Vector3(h.goal.x - p.x, 0, h.goal.z - p.z);
      const dist = d.length();
      const sp = dist > 0.4 ? 0.55 : 0;
      h.speed += (sp - h.speed) * Math.min(1, dt * 3);
      if (dist > 0.4) {
        d.normalize();
        p.x += d.x * dt * h.speed;
        p.z += d.z * dt * h.speed;
        let dy = Math.atan2(d.x, d.z) - h.root.rotation.y;
        h.root.rotation.y += Math.atan2(Math.sin(dy), Math.cos(dy)) * Math.min(1, dt * 4);
      } else if (Math.random() < dt * 0.5) h.play('attack', 0.6);     // скребёт частокол
      p.y = heightAt(p.x, p.z) + 1;
      h.lookTarget = h.goal.clone().setY(p.y + 1.5).lerp(cursorWorld, 0.3);
    } else if (h.state !== 'cast' && h.state !== 'eat') h.lookTarget = cursorWorld;
    h.animate(dt, t);
  }
});

// ------------------------------------------------------------------ орда и поселение
const horde = new Horde(world, at(site('horde'), 0, -1, 0));
const town = new Town(world, at(site('town'), 0, -1, 0));

// ------------------------------------------------------------------ камера: площадки по разделам
const SHOTS = {
  hero: { pos: at(hero, 0, 7, 20), look: at(hero, 0, 7, -10) },
  world: { pos: at(hero, 16, 5, 14), look: at(hero, -2, 1, -8) },
  horde: horde.shot,                                   // ставит сценка ступени: у каждой свой ракурс
  town: { pos: at(site('town'), 0, 21, 34), look: at(site('town'), 0, 0, -3) },
  join: { pos: at(hero, -8, 4, 12), look: at(hero, 0, 1, 2) },
  patron: { pos: at(site('town'), 12, 7, 16), look: at(site('town'), 0, 4, 0) },
  quiet: { pos: at(hero, 0, 30, 45), look: at(hero, 0, 0, -30) },
};
let shot = SHOTS.hero;
const camPos = SHOTS.hero.pos.clone(), camLook = SHOTS.hero.look.clone();
const sections = [...document.querySelectorAll('section[data-shot]')];
const tops = () => sections.map((el) => el.offsetTop);
const ease = (x) => x * x * (3 - 2 * x);

/**
 * Где камера по прокрутке: между площадками соседних разделов, по дуге (в середине пути камера
 * приподнимается и отходит — пролёт над местностью, а не «сквозь» холм).
 */
const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
function scrollShot() {
  const T = tops(), y = scrollY;
  let i = 0;
  while (i < T.length - 1 && y >= T[i + 1]) i++;
  const a = SHOTS[sections[i].dataset.shot];
  const next = sections[i + 1];
  // раздел выше экрана: пока его дочитывают, камера стоит; переход — на последнем экране раздела
  const span = next ? T[i + 1] - T[i] : 1;
  const run = Math.min(span, innerHeight);
  const f = next ? Math.max(0, Math.min(1, (y - (T[i + 1] - run)) / run)) : 0;
  const b = next ? SHOTS[next.dataset.shot] : a;
  const e = ease(f);
  wantPos.lerpVectors(a.pos, b.pos, e);
  wantLook.lerpVectors(a.look, b.look, e);
  const far = a.pos.distanceTo(b.pos);
  wantPos.y += Math.sin(Math.PI * e) * Math.min(18, far * 0.12);
  const name = (f < 0.5 ? sections[i] : next).dataset.shot;
  return name;
}

// настроение под раздел (у орды — своё на каждую ступень)
const LOOK = { hero: 'night', world: 'night', town: 'town', join: 'night', patron: 'town', quiet: 'night' };
// мышь сдвигает камеру чуть-чуть и с инерцией
const soft = new THREE.Vector2();
world.updaters.push((dt, t) => {
  const name = scrollShot();
  if (document.body.dataset.shot !== name) enter(name);
  const k = 1 - Math.exp(-dt * 3.2);                 // камера догоняет прокрутку мягко, без рывков
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  soft.lerp(mouse, 1 - Math.exp(-dt * 1.2));
  const sway = new THREE.Vector3(Math.sin(t * 0.13) * 0.35 + soft.x * 0.7, Math.sin(t * 0.11) * 0.18 + soft.y * 0.35, 0);
  world.camera.position.copy(camPos).add(sway);
  world.camera.lookAt(camLook);
  world.follow(camLook);
  world.setLook(LOOK[document.body.dataset.shot] || horde.look || 'night');
});
function enter(name) {
  shot = SHOTS[name] || shot;
  document.body.dataset.shot = name;
  if (name === 'horde' && horde.tier < 0) setTier(2);
  if (name === 'town' && town.stage < 0) setStage(0);
}

// ------------------------------------------------------------------ прокрутка: мягко притягивает к соседнему разделу
// На телефоне — родная прокрутка с привязкой CSS (scroll-snap). На ПК колесо, клавиши и ссылки меню
// ведут к следующему разделу плавным разгоном-торможением; длинный раздел сначала дочитывается.
const touch = matchMedia('(pointer: coarse)').matches;
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
let glide = null, lastWheel = 0, wheelSum = 0;
function glideTo(y) {
  y = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
  if (Math.abs(y - scrollY) < 2) return;
  if (calm) return void scrollTo(0, y);
  const from = scrollY, dist = y - from;
  const dur = Math.min(1400, 700 + Math.abs(dist) * 0.35);
  const t0 = performance.now();
  glide = { y };
  const step = (now) => {
    if (!glide || glide.y !== y) return;
    const x = Math.min(1, (now - t0) / dur);
    const e = x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;   // плавно тронулся — плавно встал
    scrollTo(0, from + dist * e);
    if (x < 1) requestAnimationFrame(step);
    else glide = null, (lastWheel = performance.now());
  };
  requestAnimationFrame(step);
}
function current() {
  const T = tops();
  let i = 0;
  for (let k = 0; k < T.length; k++) if (Math.abs(T[k] - scrollY) < Math.abs(T[i] - scrollY)) i = k;
  return i;
}
function move(dir) {
  const T = tops(), y = scrollY, H = document.documentElement.scrollHeight;
  let k = 0;
  while (k < T.length - 1 && y >= T[k + 1] - 4) k++;
  const bottom = T[k + 1] ?? H;
  if (dir > 0) {
    // длинный раздел сначала дочитывается, потом — к следующему
    if (bottom - (y + innerHeight) > 8) return glideTo(Math.min(y + innerHeight * 0.85, bottom - innerHeight));
    return glideTo(bottom);
  }
  if (y - T[k] > 8) return glideTo(Math.max(T[k], y - innerHeight * 0.85));
  if (k > 0) glideTo(Math.max(T[k - 1], T[k] - innerHeight));
}
if (!touch) {
  document.documentElement.style.scrollBehavior = 'auto';
  addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.target.closest?.('.mindbody, textarea, select')) return;
    e.preventDefault();
    const now = performance.now();
    // тачпад шлёт хвост инерции — один жест = один переход
    if (glide || now - lastWheel < 180) { lastWheel = now; return; }
    wheelSum += e.deltaY * (e.deltaMode === 1 ? 30 : 1);
    if (Math.abs(wheelSum) < 24) { setTimeout(() => (wheelSum = 0), 200); return; }
    lastWheel = now;
    move(Math.sign(wheelSum));
    wheelSum = 0;
  }, { passive: false });
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;
    const dir = { PageDown: 1, ArrowDown: 1, ' ': e.shiftKey ? -1 : 1, PageUp: -1, ArrowUp: -1 }[e.key];
    if (e.key === 'Home') { e.preventDefault(); return glideTo(0); }
    if (e.key === 'End') { e.preventDefault(); return glideTo(1e9); }
    if (!dir) return;
    e.preventDefault();
    if (!glide) move(dir);
  });
  // полоса прокрутки или перетаскивание: остановились между разделами — дотянуть к ближайшему
  let idle;
  addEventListener('scroll', () => {
    if (glide) return;
    clearTimeout(idle);
    idle = setTimeout(() => {
      if (glide || performance.now() - lastWheel < 400) return;
      const T = tops(), i = current();
      const tall = (T[i + 1] ?? document.documentElement.scrollHeight) - T[i] > innerHeight + 8;
      if (!tall && Math.abs(T[i] - scrollY) > 4) glideTo(T[i]);
    }, 260);
  }, { passive: true });
} else {
  document.documentElement.style.scrollSnapType = 'y proximity';
  sections.forEach((el) => (el.style.scrollSnapAlign = 'start'));
}
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => {
  const el = document.querySelector(a.getAttribute('href'));
  if (!el) return;
  e.preventDefault();
  glideTo(el.offsetTop);
  history.replaceState(null, '', a.getAttribute('href'));
}));
scrollShot();
camPos.copy(wantPos);
camLook.copy(wantLook);

// ------------------------------------------------------------------ мышь: взгляд мобов, клик-шум
addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, world.camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(shot.look.y));
  ray.ray.intersectPlane(plane, cursorWorld);
  horde.cursor.copy(cursorWorld);
});
canvas.addEventListener('click', () => {
  if (document.body.dataset.shot === 'horde' && horde.tier >= 1) horde.click(cursorWorld);
});

// ------------------------------------------------------------------ ступени орды
const MIND = [
  ['T0', 'Просто мертвецы', 'Идут напролом, по одному. Пока ты слабее их — этого хватает.'],
  ['T1', 'Слышат и приходят', 'Стук кирки расходится волнами — кого волна накрыла, тот идёт на звук. Кликни по земле — позовёшь сам.'],
  ['T2', 'Ждут своих', 'Одиночка ждёт у кромки леса, пока не соберётся стая. Раненый на трети здоровья отходит.'],
  ['T3', 'Выбирают жертву', 'Бросаются на того, кто ест, пьёт, копает. Потеряв троих за двадцать секунд — бегут.'],
  ['T4', 'Давят числом', 'Обходят с боков и идут толпой. Плетень маленького поселения больше не держит.'],
  ['T5', 'Тянут сквозь стену', 'Эндермен выдёргивает тебя из-за укрытия в два блока. Один слой камня — не защита.'],
  ['T6', 'Прочёсывают район', 'Оторвался — не забудут. Расходятся по округе и ищут там, где видели в последний раз.'],
  ['T7', 'Лунная ночь', 'Полная орда по календарю. К этому моменту у тебя должны быть стены, союзники и магия.'],
];
const ticks = document.getElementById('ticks'), mindBody = document.getElementById('mindbody');
MIND.forEach((m, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = m[0];
  b.addEventListener('click', () => setTier(i));
  ticks.appendChild(b);
});
function setTier(i) {
  horde.setTier(i);
  [...ticks.children].forEach((c, k) => c.classList.toggle('on', k === i));
  mindBody.innerHTML = `<b>${MIND[i][1]}</b><span>${MIND[i][2]}</span>`;
  document.body.style.setProperty('--tier', i / 7);
}

// ------------------------------------------------------------------ уровни поселения
const stages = document.getElementById('stages'), stageBody = document.getElementById('stagebody');
STAGES.forEach((s, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = s.name;
  b.addEventListener('click', () => setStage(i));
  stages.appendChild(b);
});
function setStage(i) {
  town.setStage(i);
  [...stages.children].forEach((c, k) => c.classList.toggle('on', k === i));
  stageBody.textContent = STAGES[i].text;
}

// ------------------------------------------------------------------ копирование адреса
document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => {
  navigator.clipboard?.writeText(b.dataset.copy);
  const was = b.textContent;
  b.textContent = 'Скопировано';
  setTimeout(() => (b.textContent = was), 1400);
}));

world.run();
window.__mp = { world, horde, town, setTier, setStage,          // для отладки в консоли
  go(name) {
    const el = sections.find((x) => x.dataset.shot === name);
    glide = null;
    scrollTo(0, el.offsetTop);
    scrollShot();
    camPos.copy(wantPos);
    camLook.copy(wantLook);
    enter(name);
  } };
document.body.classList.add('ready');
