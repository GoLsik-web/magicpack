// Покровитель: стела памяти у ворот столицы (имена покровителей — навсегда) и знамёна с именами на ветру.
import * as THREE from 'three';
import { skin } from './models.js';
import { heightAt } from './world.js';

const NAMES = ['ТВОЁ ИМЯ', 'Rain09k', 'Хранитель стены', 'Первый костёр', 'Ночной дозор', 'Свет в окне'];

/** Текстура с надписями: светящиеся «высеченные» буквы на тёмном камне. */
function plaque(lines, w = 256, h = 512) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.fillStyle = '#c9a6ff';
  g.font = '700 22px "Unbounded", sans-serif';
  g.fillText('ПОКРОВИТЕЛИ', w / 2, 46);
  g.fillRect(w * 0.2, 60, w * 0.6, 2);
  lines.forEach((s, i) => {
    g.font = (i === 0 ? '700 26px' : '500 22px') + ' "Golos Text", sans-serif';
    g.fillStyle = i === 0 ? '#ffe7a8' : '#b89ae8';
    g.fillText(s, w / 2, 110 + i * 62);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTex(name, color) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,.25)';
  for (let y = 0; y < 256; y += 8) g.fillRect(0, y, 128, 1);
  g.strokeStyle = '#e8c872';
  g.lineWidth = 4;
  g.strokeRect(8, 8, 112, 240);
  g.fillStyle = '#e8c872';
  g.beginPath();                                     // знак: ромб-руна
  g.moveTo(64, 50); g.lineTo(88, 90); g.lineTo(64, 130); g.lineTo(40, 90); g.closePath(); g.fill();
  g.fillStyle = color;
  g.beginPath(); g.moveTo(64, 70); g.lineTo(76, 90); g.lineTo(64, 110); g.lineTo(52, 90); g.closePath(); g.fill();
  g.fillStyle = '#f4e6c0';
  g.textAlign = 'center';
  g.font = '700 17px "Golos Text", sans-serif';
  name.split(' ').forEach((s, i) => g.fillText(s, 64, 170 + i * 24));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Patron {
  constructor(world, at) {
    this.w = world;
    const g = (this.group = new THREE.Group());
    world.scene.add(g);
    const y0 = heightAt(Math.floor(at.x), Math.floor(at.z)) + 1;
    const box = (world._box ||= new THREE.BoxGeometry(1, 1, 1));
    const put = (m, x, y, z, sx = 1, sy = 1, sz = 1) => {
      const o = new THREE.Mesh(box, m);
      o.scale.set(sx, sy, sz);
      o.position.set(at.x + x, y0 + y + sy / 2, at.z + z);
      o.castShadow = o.receiveShadow = true;
      g.add(o);
      return o;
    };
    // ступени и постамент
    put(skin('cobble'), 0, 0, 0, 5, 0.5, 5);
    put(skin('bricks'), 0, 0.5, 0, 3, 1, 3);
    // сама стела: сужается кверху
    put(skin('bricks'), 0, 1.5, 0, 1.6, 3, 1.6);
    put(skin('bricks'), 0, 4.5, 0, 1.2, 1.6, 1.2);
    // кристалл на вершине — медленно вращается и светится
    this.crystal = put(skin('crystal', 3), 0, 6.3, 0, 0.7, 0.7, 0.7);
    this.crystal.castShadow = false;
    world.lamp({ obj: this.crystal, color: 0xb27cff, power: (t) => 6 + Math.sin(t * 1.7) * 1.5, distance: 11 });
    // доска с именами на лицевой стороне (к зрителю, +z)
    this.plate = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.8), new THREE.MeshBasicMaterial({
      map: plaque(NAMES), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.plate.position.set(at.x, y0 + 3.05, at.z + 0.81);
    g.add(this.plate);
    // знамёна по бокам: древко, перекладина, полотно на ветру
    this.flags = [];
    [[-3.2, 'ТВОЁ ИМЯ', '#4b2a7a'], [3.2, 'Ночной дозор', '#7a2a2a']].forEach(([x, name, color]) => {
      put(skin('log'), x, 0.5, -0.5, 0.2, 6, 0.2);
      put(skin('log'), x, 6.2, -0.5, 1.8, 0.15, 0.15);
      const geo = new THREE.PlaneGeometry(1.6, 3.2, 6, 12);
      geo.translate(0, -1.6, 0);
      const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bannerTex(name, color), side: THREE.DoubleSide, roughness: 0.9 }));
      cloth.position.set(at.x + x, y0 + 6.15, at.z - 0.35);
      cloth.castShadow = true;
      g.add(cloth);
      this.flags.push({ cloth, base: geo.attributes.position.array.slice(), phase: x });
    });
    // свечи у подножия
    [[-1.8, 1.8], [1.8, 1.8], [-1.8, -1.8], [1.8, -1.8]].forEach(([x, z]) => {
      const c = put(new THREE.MeshBasicMaterial({ color: 0xffd08a }), x, 0.5, z, 0.12, 0.35, 0.12);
      c.castShadow = false;
      world.lamp({ obj: c, color: 0xffa050, power: (t) => 1.6 + Math.sin(t * 9 + x * 3 + z) * 0.3, distance: 5 });
    });
    world.updaters.push((dt, t) => this.update(dt, t));
  }

  update(dt, t) {
    this.crystal.rotation.y = t * 0.6;
    this.crystal.position.y += Math.sin(t * 1.3) * 0.002;
    this.plate.material.opacity = 0.8 + Math.sin(t * 1.1) * 0.2;
    if (document.body.dataset.shot !== 'patron' && document.body.dataset.shot !== 'town') return;   // ветер — только в кадре
    for (const f of this.flags) {
      const p = f.cloth.geometry.attributes.position, a = p.array, b = f.base;
      for (let i = 0; i < a.length; i += 3) {
        const down = -b[i + 1] / 3.2, side = b[i] + 0.8;
        a[i + 2] = b[i + 2] + Math.sin(t * 2.2 + side * 2.4 + down * 2 + f.phase) * 0.18 * (0.3 + down);
      }
      p.needsUpdate = true;
    }
  }
}
