// Magic Pack: смена сцен по разделам (два слоя видео, плавный переход), проявление текста, ступени орды и этапы поселения.
// Кадры сняты в игре заранее (папка v/): в браузере только воспроизведение — никакой 3D-графики на стороне игрока.
(() => {
  const body = document.body;
  const sections = [...document.querySelectorAll('main > section')];
  const layers = [...document.querySelectorAll('.stage .layer')];
  const small = matchMedia('(max-width: 860px)').matches;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches || (navigator.connection && navigator.connection.saveData);
  const src = (clip) => `v/${clip}${small ? '_m' : ''}.mp4`;
  let front = 0, current = '';

  /** Показать сцену: грузится в задний слой, после первого кадра — плавная смена. */
  function show(clip) {
    if (clip === current) return;
    current = clip;
    const next = layers[1 - front], prev = layers[front];
    next.poster = `v/${clip}.jpg`;
    if (still) {
      next.removeAttribute('src');
      next.load();
      swap();
      return;
    }
    next.src = src(clip);
    next.loop = true;
    next.preload = 'auto';
    const go = () => { next.removeEventListener('loadeddata', go); if (current === clip) { next.play().catch(() => {}); swap(); } };
    next.addEventListener('loadeddata', go);
    next.load();
    function swap() {
      next.classList.add('on');
      prev.classList.remove('on');
      front = 1 - front;
      setTimeout(() => { if (!prev.classList.contains('on')) { prev.pause(); } }, 1700);
    }
  }

  // ---------------------------------------------------------------- указатель разделов
  const pager = document.querySelector('.pager');
  pager.innerHTML = sections.map((s) => `<a href="#${s.id}"><span>${s.dataset.name}</span><i></i></a>`).join('');
  const dots = [...pager.children];
  const links = [...document.querySelectorAll('.links a')];

  // ---------------------------------------------------------------- какой раздел на экране
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      const s = e.target;
      s.classList.add('in');
      show(s.dataset.clip);
      body.dataset.align = s.querySelector('.center') ? 'center' : '';
      dots.forEach((d) => d.classList.toggle('on', d.getAttribute('href') === '#' + s.id));
      links.forEach((l) => l.classList.toggle('on', l.getAttribute('href') === '#' + s.id));
    }
  }, { threshold: 0.45 });
  sections.forEach((s) => {
    s.querySelectorAll('.reveal').forEach((r, i) => r.style.setProperty('--i', i));
    io.observe(s);
  });

  const top = document.querySelector('.top');
  addEventListener('scroll', () => top.classList.toggle('solid', scrollY > 40), { passive: true });

  // на вкладке в фоне видео не нужно
  document.addEventListener('visibilitychange', () => {
    const v = layers[front];
    if (document.hidden) v.pause(); else if (v.src && !still) v.play().catch(() => {});
  });

  // ---------------------------------------------------------------- ступени орды
  const MIND = [
    ['Просто мертвецы', 'Идут напролом, по одному.'],
    ['Слышат и приходят', 'Идут на шум и приходят туда, где ты шумел.'],
    ['Ждут своих', 'Не нападают, пока не соберётся стая.'],
    ['Выбирают жертву', 'Бьют того, кто занят. Потеряв троих — бегут.'],
    ['Давят числом', 'Обходят с флангов. Плетень не держит.'],
    ['Тянут сквозь стену', 'Эндермен выдёргивает из-за укрытия. Камень ломают.'],
    ['Прочёсывают район', 'Спрятался — ищут там, где видели.'],
    ['Лунная ночь', 'Вся орда разом. Нужны стены и магия.'],
  ];
  const tiers = document.getElementById('tiers'), tierBody = document.getElementById('tierbody');
  const words = (t, d0) => t.split(' ').map((w, k) => `<i style="--d:${(d0 + k * 0.05).toFixed(2)}s">${w}</i>`).join(' ');
  let tier = 0, auto = true;
  MIND.forEach((m, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.textContent = 'T' + i;
    b.addEventListener('click', () => { auto = false; setTier(i); });
    tiers.appendChild(b);
  });
  function setTier(i) {
    tier = i;
    [...tiers.children].forEach((c, k) => { c.classList.toggle('on', k === i); c.classList.toggle('done', k < i); c.setAttribute('aria-selected', k === i); });
    tierBody.innerHTML = `<b>${words(MIND[i][0], 0)}</b><span>${words(MIND[i][1], 0.2)}</span>`;
  }
  setTier(0);
  // пока раздел на экране и никто не нажимал — ступени листаются сами
  const orda = document.getElementById('orda');
  setInterval(() => {
    if (auto && orda.classList.contains('in') && !document.hidden) {
      const r = orda.getBoundingClientRect();
      if (r.top < innerHeight * 0.5 && r.bottom > innerHeight * 0.5) setTier((tier + 1) % MIND.length);
    }
  }, 3800);

  // ---------------------------------------------------------------- этапы поселения
  const STAGES = [
    ['Развалины', 'Три лачуги и костёр. Ни стены, ни стражи.'],
    ['Плетень', 'Жители обносят двор плетнём. Первые дома у стены.'],
    ['Частокол', 'Заострённые брёвна в рост человека. Появляются новые работники.'],
    ['Каменная стена', 'Строители кладут камень снаружи, старое разбирают. Вышки, свои здания у работников.'],
    ['Руны и барьер', 'Маги обходят стену и накладывают руны. Слабые мертвецы у барьера сгорают.'],
  ];
  const st = document.getElementById('stages');
  st.innerHTML = STAGES.map(([n, t]) => `<li><b>${n}</b><span>${t}</span></li>`).join('');
  const items = [...st.children];
  const setStage = (i) => items.forEach((li, k) => li.classList.toggle('on', k === i));
  items.forEach((li, i) => { li.addEventListener('mouseenter', () => setStage(i)); li.addEventListener('click', () => setStage(i)); });
  setStage(0);

  requestAnimationFrame(() => body.classList.add('ready'));
})();
