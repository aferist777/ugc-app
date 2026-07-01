/* ═══════════════════════════════════════════
   UTILS — shared state, helpers, balance, log
   ═══════════════════════════════════════════ */

const NAME_MEN = [
  'Джон','Майк','Дейв','Джеймс','Роберт','Вильям','Ричард','Джозеф','Томас','Чарльз',
  'Кристофер','Даниэль','Мэтью','Энтони','Марк','Дональд','Стивен','Эндрю','Пол','Джоша',
  'Кеннет','Кевин','Брайан','Джордж','Эдвард','Рональд','Тимоти','Джейсон','Джеффри','Райан',
];
const NAME_WOMEN = [
  'Стефани','Ребекка','Мури','Патриция','Дженнифер','Линда','Элизабет','Барбара','Сьюзан','Джессика',
  'Сара','Карен','Нэнси','Лиза','Бетси','Маргарет','Сандра','Джули','Кимберли','Эмили',
  'Донна','Мишель','Дороти','Кэрол','Аманда','Мелисса','Дебора','Шерон','Лора','Синтия',
];
const NAME_LAST = [
  'Биверович','Беатов','Ченикрин','Буллович','Иглович','Койотов','Вейлович','Мустангов','Тарскин','Бурович',
  'Джагратов','Пантерин','Кардиналович','Сорнеров','Колчин','Сигаллович','Орков','Бронкович','Байтонов','Кристин',
  'Вульович','Выдустаров','Лайонин','Сетчеревич','Салмонов','Бакович','Блюгиллин','Тайгерович','Ориолов','Сталлионович',
];
const NAME_MIDDLE = [
  'Антрепренёр','Смит Кузнецов','Портер Перкин','Тейлорд Воркер','Сток Брокер',
  'Аэробик Инструктор','Аркейд Менеджер','Компьютер Программер','Телемаркетер','Видео Стор Клерк',
  'Контракт Воркер','Деливери Драйвер','Секретари','Фэктори Фанд','Сейлсмен',
  'Риэл Эстейт Агент','Механик','Трак Драйвер','Полис Офицер','Нёрс',
  'Бонк Теллер','Флайт Аттендант','Электришн','Плумбер','Джанитор',
  'Кук','Вейтер','Мюзишн','Фотографер','График Дизайнер',
];

function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function randomName(gender) {
  const first  = gender === 'male' ? rnd(NAME_MEN) : rnd(NAME_WOMEN);
  const last   = rnd(NAME_LAST);
  const middle = Math.random() < 0.5 ? rnd(NAME_MIDDLE) : null;
  return middle ? `${first} ${middle} ${last}` : `${first} ${last}`;
}

// ── Status bar ────────────────────────────────────────────────────────────────
const statusBar  = document.getElementById('status-bar');
const balanceBar = document.getElementById('balance-bar');
function setStatus(msg) { statusBar.textContent = msg; }

// ── Balance ───────────────────────────────────────────────────────────────────
let currentCredits = null;

async function refreshBalance() {
  try {
    const d = await fetch('/api/balance').then(r => r.json());
    if (d.success) {
      currentCredits = d.credits;
      balanceBar.textContent = `${d.credits} cr. / $${d.dollars.toFixed(2)}`;
    }
  } catch {}
}
refreshBalance();
setInterval(refreshBalance, 60000);

// ── Thumbnail path helper ─────────────────────────────────────────────────────
// Given a server image path like "/characters/foo.jpg",
// returns "/characters/thumbs/foo.jpg" (client uses this for display;
// the full path is used only for the lightbox).
function toThumbPath(imgPath) {
  if (!imgPath) return imgPath;
  const clean = imgPath.split('?')[0];
  const slash = clean.lastIndexOf('/');
  return clean.slice(0, slash + 1) + 'thumbs/' + clean.slice(slash + 1).replace(/\.[^.]+$/, '') + '.jpg';
}

// ── Cache-friendly thumbnail loader ───────────────────────────────────────────
// Display a thumbnail in <img> from a FULL image path: tries thumb -> full image
// -> a "missing" state. Crucially it adds NO per-render cache-buster, so the
// browser caches good thumbnails (and revalidates cheaply via ETag) instead of
// re-downloading every image on each render -- the old `?t=Date.now()` made the
// obraz/character grids re-fetch everything every time, which is what made them
// load slowly. URLs that 404'd this session are remembered and skipped, so
// re-renders and polling stop hammering files that are missing on the server.
window._missingImgUrls = window._missingImgUrls || new Set();
function loadThumb(img, fullPath) {
  if (!img) return;
  const full  = fullPath || '';
  const thumb = full ? (toThumbPath(full) || full) : '';
  const miss  = window._missingImgUrls;
  const giveUp = () => { img.onerror = null; img.classList.add('thumb-missing'); img.removeAttribute('src'); };
  if (!thumb || (miss.has(thumb) && miss.has(full))) { giveUp(); return; }
  img.onerror = function () {
    img.onerror = null; miss.add(thumb);
    if (full && full !== thumb && !miss.has(full)) {
      img.onerror = function () { miss.add(full); giveUp(); };
      img.src = full;                                   // thumb missing -> try full once
    } else giveUp();
  };
  img.src = (miss.has(thumb) && full && !miss.has(full)) ? full : thumb;
}
window.loadThumb = loadThumb;

// ── Utilities ─────────────────────────────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(',')[1]);
    r.onerror   = reject;
    r.readAsDataURL(blob);
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────────────
const lightbox    = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
function openLightbox(src)  { lightboxImg.src = src; lightbox.classList.add('open'); }
function closeLightbox()    { lightbox.classList.remove('open'); lightboxImg.src = ''; }
document.getElementById('lightbox-close')?.addEventListener('click', closeLightbox);
document.getElementById('lightbox-close-x')?.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
// Chromeless preview: a second click on the image itself closes it too.
lightboxImg.addEventListener('click', closeLightbox);

// ── Generation log ────────────────────────────────────────────────────────────
function toggleLog() {
  const body  = document.getElementById('log-body');
  const arrow = document.getElementById('log-toggle-arrow');
  const open  = body.classList.toggle('open');
  arrow.textContent = open ? '▼' : '▶';
  if (open) loadLog();
}

async function loadLog() {
  const container = document.getElementById('log-entries');
  try {
    const d = await fetch('/api/log').then(r => r.json());
    if (!d.success || !d.entries.length) {
      container.innerHTML = '<span style="color:#888;">No entries</span>';
      return;
    }
    container.innerHTML = '';
    d.entries.forEach(line => {
      const el = document.createElement('div');
      el.className = 'log-entry' + (line.includes('❌') ? ' log-error' : '');
      el.innerHTML = line.replace(/(https?:\/\/\S+|\/(?:uploads|lookbooks|environments|characters)\/\S+)/g,
        url => `<a href="${url}" target="_blank">${url}</a>`);
      container.appendChild(el);
    });
  } catch { container.innerHTML = '<span style="color:#888;">Failed to load log</span>'; }
}

async function logGeneration(type, mediaUrl, creditsBefore) {
  await refreshBalance();
  try {
    await fetch('/api/log/entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, mediaUrl, creditsBefore, creditsAfter: currentCredits }),
    });
  } catch {}
}

async function logError(type, errorMsg) {
  try {
    await fetch('/api/log/entry', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: `❌ ${type}`, mediaUrl: String(errorMsg || 'Unknown error') }),
    });
  } catch {}
}
