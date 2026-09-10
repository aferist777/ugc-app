/* admin.js — the people list on /admin.

   Loads the public view of every user, draws one row each, and drives the four actions the
   server offers: create, reset, disable, enable. The only state worth guarding is the one-time
   password: it arrives in exactly one response and is put on screen in a popup that, once
   closed, cannot be reopened - the page keeps no copy, on purpose. */

(function () {

const $ = (id) => document.getElementById(id);

// ── time, as a person would say it ────────────────────────────────────────
function ago(iso) {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60); if (h < 24) return h + ' h ago';
  const d = Math.floor(h / 24); if (d < 30) return d + ' d ago';
  return new Date(iso).toISOString().slice(0, 10);
}

function setStatus(text, err) {
  const el = $('adm-status');
  el.textContent = text || '';
  el.className = 'adm-status' + (err ? ' err' : '');
}

// ── the list ──────────────────────────────────────────────────────────────
function chip(text, cls) {
  const s = document.createElement('span');
  s.className = 'adm-chip ' + cls;
  s.textContent = text;
  return s;
}

function btn(label, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lib-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function row(u) {
  const tr = document.createElement('tr');
  if (u.disabled) tr.className = 'off';
  const td = (child, cls) => {
    const c = document.createElement('td');
    if (cls) c.className = cls;
    if (typeof child === 'string') c.textContent = child; else c.appendChild(child);
    tr.appendChild(c);
    return c;
  };

  td(u.nickname, 'adm-nick');
  // Until the person changes it, the login IS the nickname - shown muted so it is obvious that
  // nothing has been chosen yet.
  const login = document.createElement('span');
  login.className = 'adm-login' + (u.login === u.nickname ? ' pending' : '');
  login.textContent = u.login;
  const loginCell = td(login);
  // SOMEBODY WHO COMES FROM PARTNER has no password here and never sees a sign-in form;
  // their address over there is the thing that identifies them, so it is shown under the
  // login rather than left for whoever opens the users file.
  if (u.source === 'partner') {
    const from = document.createElement('span');
    from.className = 'adm-from';
    from.textContent = u.email ? 'Partner · ' + u.email : 'Partner';
    from.title = 'Signs in through Partner. No password here.';
    loginCell.appendChild(from);
  }
  // THE ROLE IS A CHOICE, not a label. An admin sees everybody's keys, everybody's projects
  // and this list; changing that is one of the few things worth being able to do without
  // opening a file on the server. Saved the moment it is chosen - there is nothing to
  // compose here, so an Apply button would only be a second click.
  const roleSel = document.createElement('select');
  roleSel.className = 'adm-role' + (u.role === 'admin' ? ' is-admin' : '');
  for (const r of ['user', 'admin']) {
    const o = document.createElement('option');
    o.value = r; o.textContent = r;
    if (u.role === r) o.selected = true;
    roleSel.appendChild(o);
  }
  roleSel.title = 'An admin can see every key, every project and this list';
  roleSel.addEventListener('change', () => setRole(u, roleSel));
  td(roleSel);
  td(ago(u.createdAt), 'adm-time');
  td(ago(u.lastSeenAt), 'adm-time');
  // How much they did today, from the audit log; a click opens their rows on the Activity tab.
  const act = document.createElement('a');
  act.href = '#activity';
  act.className = 'adm-act';
  act.dataset.uid = u.id;
  act.textContent = '…';
  act.addEventListener('click', (e) => { e.preventDefault(); document.dispatchEvent(new CustomEvent('adm-activity-user', { detail: { uid: u.id } })); });
  td(act, 'adm-time');
  td(u.disabled ? chip('disabled', 'off') : (u.mustChange ? chip('pending', 'pending') : chip('active', 'on')));

  const actions = document.createElement('div');
  actions.className = 'adm-actions';
  actions.appendChild(btn('Reset', () => reset(u)));
  actions.appendChild(u.disabled ? btn('Enable', () => toggle(u, false)) : btn('Disable', () => toggle(u, true)));
  td(actions);
  return tr;
}

async function load() {
  try {
    const d = await fetch('/api/admin/users').then(r => r.json());
    if (!d.success) throw new Error(d.error || 'refused');
    const host = $('adm-rows');
    host.innerHTML = '';
    d.users.forEach(u => host.appendChild(row(u)));
    $('adm-count').textContent = d.users.length + (d.users.length === 1 ? ' person' : ' people');
    setStatus('');
    // Today's count per person, after the list is on screen: a second, cheap request.
    fetch('/api/audit/meta').then(r => r.json()).then(m => {
      const c = (m && m.todayCounts) || {};
      host.querySelectorAll('.adm-act[data-uid]').forEach(a => { const n = c[a.dataset.uid] || 0; a.textContent = n ? n + ' today' : '— today'; a.title = 'Open on the Activity tab'; });
    }).catch(() => {});
  } catch (e) {
    setStatus('Could not load the list: ' + e.message, true);
  }
}

// ── the actions ───────────────────────────────────────────────────────────
async function post(url) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
  return d;
}

async function create() {
  const b = $('adm-create');
  b.disabled = true;
  try {
    const d = await post('/api/admin/users');
    await load();
    showPassword(d.user, d.password);
  } catch (e) { setStatus('Not created: ' + e.message, true); }
  finally { b.disabled = false; }
}

async function reset(u) {
  if (!confirm(`Issue a new password for ${u.nickname}? The current one stops working at once.`)) return;
  try {
    const d = await post(`/api/admin/users/${encodeURIComponent(u.id)}/reset`);
    await load();
    showPassword(d.user, d.password);
  } catch (e) { setStatus('Not reset: ' + e.message, true); }
}

async function toggle(u, disable) {
  try {
    await post(`/api/admin/users/${encodeURIComponent(u.id)}/${disable ? 'disable' : 'enable'}`);
    await load();
    setStatus(`${u.nickname} ${disable ? 'disabled' : 'enabled'}.`);
  } catch (e) { setStatus('Not changed: ' + e.message, true); }
}

// Making somebody an admin, or taking it back. The select is put back to what it was if the
// server refuses - the last admin standing cannot be demoted, and a dropdown left showing a
// change that did not happen is worse than no dropdown at all.
async function setRole(u, sel) {
  const want = sel.value;
  const was = u.role;
  sel.disabled = true;
  try {
    const r = await fetch(`/api/admin/users/${encodeURIComponent(u.id)}/role`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: want }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.success) throw new Error(d.error || ('HTTP ' + r.status));
    await load();
    setStatus(`${u.nickname} is now ${want}.`);
  } catch (e) {
    sel.value = was;
    sel.disabled = false;
    setStatus('Not changed: ' + e.message, true);
  }
}

// ── the one-time password ─────────────────────────────────────────────────
function showPassword(user, password) {
  $('adm-cred-login').textContent = user.login;
  $('adm-cred-pass').textContent = password;
  $('adm-ov').hidden = false;
}

function hidePassword() {
  // Wiped from the DOM as well as hidden: a closed popup that still holds the text is a
  // password one devtools panel away.
  $('adm-cred-pass').textContent = '';
  $('adm-cred-login').textContent = '';
  $('adm-ov').hidden = true;
}

async function copyPassword() {
  const text = $('adm-cred-login').textContent + '  ' + $('adm-cred-pass').textContent;
  try { await navigator.clipboard.writeText(text); $('adm-copy').textContent = 'Copied'; }
  catch { $('adm-copy').textContent = 'Select and copy'; }
  setTimeout(() => { $('adm-copy').textContent = 'Copy'; }, 1600);
}

// ── wiring ────────────────────────────────────────────────────────────────
$('adm-create').addEventListener('click', create);
$('adm-pop-close').addEventListener('click', hidePassword);
$('adm-copy').addEventListener('click', copyPassword);
$('adm-ov').addEventListener('click', (e) => { if (e.target.id === 'adm-ov') hidePassword(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('adm-ov').hidden) hidePassword();
});

load();

})();
