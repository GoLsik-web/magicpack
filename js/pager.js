// Указатель страниц справа (вместо полосы прокрутки): точки разделов, текущий подсвечен, клик — переход.
// При смене страницы — короткий «щелчок» (синтез Web Audio: без файлов; звук включается после первого касания).
const NAMES = { hero: 'Начало', mir: 'Мир', orda: 'Орда', posel: 'Поселения', start: 'Как зайти', donat: 'Покровитель', svyaz: 'Связь' };
const sections = [...document.querySelectorAll('main > section[id]')];
const nav = document.createElement('nav');
nav.className = 'pager';
nav.setAttribute('aria-label', 'Страницы');
nav.innerHTML = sections.map((s, i) =>
  `<a href="#${s.id}" data-i="${i}"><span class="lbl">${NAMES[s.id] || s.id}</span><i></i></a>`).join('') +
  '<b class="count"><em>01</em> / ' + String(sections.length).padStart(2, '0') + '</b>';
document.body.appendChild(nav);
const links = [...nav.querySelectorAll('a')], count = nav.querySelector('.count em');

let ctx = null;
const wake = () => {
  try { ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume?.(); } catch { ctx = null; }
};
addEventListener('pointerdown', wake, { once: true, passive: true });
addEventListener('keydown', wake, { once: true });
function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(1800, t);
  o.frequency.exponentialRampToValueAtTime(700, t + 0.04);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.07);
}

let cur = -1, raf = 0;
function update() {
  raf = 0;
  const mid = scrollY + innerHeight * 0.45;
  let i = 0;
  for (let k = 0; k < sections.length; k++) if (sections[k].offsetTop <= mid) i = k;
  if (i === cur) return;
  if (cur >= 0) tick();
  cur = i;
  links.forEach((a, k) => a.classList.toggle('on', k === i));
  count.textContent = String(i + 1).padStart(2, '0');
}
addEventListener('scroll', () => (raf ||= requestAnimationFrame(update)), { passive: true });
addEventListener('resize', update);
update();
