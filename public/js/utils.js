/* ═══════════════════════════════════════════
   UTILS — shared state, helpers, balance, log
   ═══════════════════════════════════════════ */

const FIRST_NAMES = [
  'Emma','Liam','Olivia','Noah','Ava','Ethan','Sophia','Mason','Isabella','Logan',
  'Mia','Lucas','Charlotte','Aiden','Amelia','Jackson','Harper','Elijah','Evelyn',
  'Sebastian','Abigail','Mateo','Emily','James','Ella','Benjamin','Elizabeth','Carter',
  'Camila','Luke','Luna','Owen','Sofia','Wyatt','Avery','Dylan','Mila','Nathan',
  'Aria','Henry','Scarlett','Ryan','Penelope','Michael','Layla','Alexander','Riley',
];
const LAST_NAMES = [
  'Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Wilson',
  'Martinez','Anderson','Taylor','Thomas','Hernandez','Moore','Martin','Jackson',
  'Thompson','White','Lopez','Lee','Gonzalez','Harris','Clark','Lewis','Robinson',
  'Walker','Perez','Hall','Young','Allen','Sanchez','Wright','King','Scott','Green',
];
function randomName() {
  return FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)] + ' ' +
         LAST_NAMES [Math.floor(Math.random() * LAST_NAMES.length)];
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
      balanceBar.textContent = `${d.credits} кр. / $${d.dollars.toFixed(2)}`;
    }
  } catch {}
}
refreshBalance();
setInterval(refreshBalance, 60000);

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
document.getElementById('lightbox-close').addEventListener('click', closeLightbox);
document.getElementById('lightbox-close-x').addEventListener('click', closeLightbox);
lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

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
      container.innerHTML = '<span style="color:#888;">Нет записей</span>';
      return;
    }
    container.innerHTML = '';
    d.entries.forEach(line => {
      const el = document.createElement('div');
      el.className = 'log-entry';
      el.innerHTML = line.replace(/(https?:\/\/\S+|\/(?:uploads|lookbooks|environments|characters)\/\S+)/g,
        url => `<a href="${url}" target="_blank">${url}</a>`);
      container.appendChild(el);
    });
  } catch { container.innerHTML = '<span style="color:#888;">Ошибка загрузки лога</span>'; }
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
