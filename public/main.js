async function api(path, opts = {}) {
  const base = window.API_BASE || '';
  const res = await fetch(base + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch (_) { data = { raw: text }; }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// Pasted/dragged files queue with previews
const queued = [];

function addFilesToQueue(fileList) {
  const files = Array.from(fileList || []);
  for (const f of files) {
    if (!f.type || !f.type.startsWith('image/')) continue;
    const exists = queued.find(q => q.name === f.name && q.size === f.size);
    if (exists) continue;
    const url = URL.createObjectURL(f);
    queued.push({ file: f, url, name: f.name, size: f.size });
  }
  renderQueue();
}

function clearQueue() {
  for (const q of queued) URL.revokeObjectURL(q.url);
  queued.length = 0;
  renderQueue();
}

function removeFromQueue(index) {
  const q = queued[index];
  if (!q) return;
  URL.revokeObjectURL(q.url);
  queued.splice(index, 1);
  renderQueue();
}

function renderQueue() {
  const wrap = document.getElementById('preview-wrap');
  const grid = document.getElementById('preview-grid');
  if (!wrap || !grid) return;
  grid.innerHTML = '';
  if (queued.length === 0) {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  queued.forEach((q, idx) => {
    const item = document.createElement('div');
    item.className = 'relative rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm';
    item.innerHTML = `
      <img src="${q.url}" class="w-full h-28 object-cover" alt="preview" />
      <button data-idx="${idx}" class="absolute top-1 right-1 bg-white/90 hover:bg-white text-slate-700 border border-slate-200 rounded-md px-2 py-1 text-xs">Remove</button>
    `;
    item.querySelector('button').addEventListener('click', (e) => {
      const i = Number(e.currentTarget.getAttribute('data-idx'));
      removeFromQueue(i);
    });
    grid.appendChild(item);
  });
}

async function checkMe() {
  try {
    const { user } = await api('/api/me');
    setUser(user);
    await refreshGroups();
  } catch (_) {
    setUser(null);
  }
}

function setUser(user) {
  const login = document.getElementById('login-section');
  const app = document.getElementById('app-section');
  const groups = document.getElementById('groups-section');
  const headerUser = document.getElementById('header-user');
  if (user) {
    document.getElementById('user-name').textContent = user.name;
    login.classList.add('hidden');
    app.classList.remove('hidden');
    groups.classList.remove('hidden');
    if (headerUser) headerUser.classList.remove('hidden');
  } else {
    login.classList.remove('hidden');
    app.classList.add('hidden');
    groups.classList.add('hidden');
    if (headerUser) headerUser.classList.add('hidden');
  }
}

async function login(name) {
  const base = window.API_BASE || '';
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res.ok) {
    const t = await res.json().catch(() => ({}));
    throw new Error(t.error || 'Login failed');
  }
  const data = await res.json();
  setUser(data.user);
}

async function uploadFiles(files) {
  const form = new FormData();
  for (const f of files) form.append('screenshots', f);
  const base = window.API_BASE || '';
  const res = await fetch(base + '/api/upload', {
    method: 'POST',
    credentials: 'include',
    body: form
  });
  if (!res.ok) {
    const t = await res.json().catch(() => ({}));
    throw new Error(t.error || 'Upload failed');
  }
  return res.json();
}

async function refreshGroups() {
  const { groups } = await api('/api/groups');
  renderGroups(groups);
}

function renderGroups(groups) {
  const me = document.getElementById('user-name')?.textContent || '';
  const bySection = {
    conflicts: [],
    onlyMe: [],
    missingMe: [],
    normal: []
  };

  for (const g of groups) {
    const answerers = new Set(g.answers.map(a => a.userName));
    const iAnswered = answerers.has(me);
    const othersAnswered = Array.from(answerers).some(n => n !== me);
    if (g.conflict) {
      bySection.conflicts.push(g);
    } else if (iAnswered && !othersAnswered) {
      bySection.onlyMe.push(g);
    } else if (!iAnswered && othersAnswered) {
      bySection.missingMe.push(g);
    } else {
      bySection.normal.push(g);
    }
  }

  renderSection('groups-conflicts', bySection.conflicts);
  renderSection('groups-only-me', bySection.onlyMe);
  renderSection('groups-missing-me', bySection.missingMe);
  renderSection('groups-normal', bySection.normal);
}

function renderSection(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  const wrapper = container.parentElement; // wrapper contains the heading and the container
  if (wrapper) {
    if (!list || list.length === 0) {
      wrapper.classList.add('hidden');
    } else {
      wrapper.classList.remove('hidden');
    }
  }
  for (const g of list) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl border border-slate-200 shadow-sm p-4';
    if (g.conflict) card.className += ' ring-1 ring-rose-300';
    const optionsList = g.options && g.options.length ? `
      <div class="mt-3">
        <h3 class="text-sm font-medium text-slate-600">Options</h3>
        <ul class="list-disc list-inside text-sm text-slate-700">
          ${g.options.map(o => `<li>${escapeHtml(o)}</li>`).join('')}
        </ul>
      </div>` : '';
    const answersList = g.answers && g.answers.length ? `
      <div class="mt-3">
        <h3 class="text-sm font-medium text-slate-600">Answers</h3>
        <ul class="space-y-1">
          ${g.answers.map(a => `<li class="text-sm text-slate-800"><span class=\"px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 mr-2\">${escapeHtml(a.userName)}</span> ${escapeHtml(a.chosenAnswer)}</li>`).join('')}
        </ul>
      </div>` : '<p class="text-sm text-slate-500">No answers yet</p>';
    const differingVariants = (g.variants || []).filter(v => !v.matchesCanonical);
    const variants = differingVariants.length ? `
      <details class="mt-3">
        <summary class="cursor-pointer text-sm text-slate-600">Question variants</summary>
        <ul class="mt-2 space-y-1">
          ${differingVariants.map(v => `<li class="text-sm text-slate-700"><span class=\"px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700 mr-2\">${escapeHtml(v.userName)}</span> ${escapeHtml(v.questionText)} <span class=\"ml-2 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200\">differs</span></li>`).join('')}
        </ul>
      </details>` : '';
    const conflictLine = g.conflict ? `<p class="mt-3"><span class="px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">Conflict</span></p>` : '';

    card.innerHTML = `
      <h2 class="text-base font-semibold text-slate-900">${escapeHtml(g.canonicalQuestion)}</h2>
      ${optionsList}
      ${answersList}
      ${variants}
      ${conflictLine}
    `;
    container.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-btn').addEventListener('click', async () => {
    const name = document.getElementById('name-input').value.trim();
    if (!name) return alert('Enter a name');
    try {
      await login(name);
      await refreshGroups();
    } catch (e) { alert(e.message); }
  });

  document.getElementById('refresh-btn').addEventListener('click', refreshGroups);

  // Logout
  document.getElementById('logout-btn').addEventListener('click', async () => {
    const base = window.API_BASE || '';
    await fetch(base + '/api/logout', { method: 'POST', credentials: 'include' });
    setUser(null);
    clearQueue();
  });

  // Clear all
  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!confirm('This will delete all questions and answers for everyone. Continue?')) return;
    try {
      toggleLoading(true);
      const base = window.API_BASE || '';
      await fetch(base + '/api/clear-all', { method: 'POST', credentials: 'include' });
      await refreshGroups();
    } finally {
      toggleLoading(false);
    }
  });

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inputFiles = document.getElementById('file-input').files;
    const toSend = [];
    if (queued.length > 0) toSend.push(...queued.map(q => q.file));
    if (inputFiles && inputFiles.length) toSend.push(...Array.from(inputFiles));
    if (toSend.length === 0) return alert('Add or paste screenshots first');
    try {
      toggleLoading(true);
      const res = await uploadFiles(toSend);
      await refreshGroups();
      alert(`Processed ${res.processed} items`);
      clearQueue();
      document.getElementById('file-input').value = '';
    } catch (err) {
      alert(err.message);
    } finally {
      toggleLoading(false);
    }
  });

  // Drop zone browse
  const dz = document.getElementById('drop-zone');
  if (dz) dz.addEventListener('click', () => document.getElementById('file-input').click());

  // File input → queue
  const fi = document.getElementById('file-input');
  if (fi) fi.addEventListener('change', (e) => addFilesToQueue(e.target.files));

  // Clear queue
  const cq = document.getElementById('clear-queue');
  if (cq) cq.addEventListener('click', clearQueue);

  // Global drag events prevent default
  ['dragenter','dragover','dragleave','drop'].forEach(ev => {
    document.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); });
  });
  // Highlight drop zone
  if (dz) {
    dz.addEventListener('dragover', () => dz.classList.add('ring-2','ring-indigo-300'));
    dz.addEventListener('dragleave', () => dz.classList.remove('ring-2','ring-indigo-300'));
    dz.addEventListener('drop', (e) => {
      dz.classList.remove('ring-2','ring-indigo-300');
      if (e.dataTransfer && e.dataTransfer.files) addFilesToQueue(e.dataTransfer.files);
    });
  }

  // Paste images into page
  document.addEventListener('paste', (e) => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) files.push(new File([blob], `pasted-${Date.now()}.png`, { type: blob.type || 'image/png' }));
      }
    }
    if (files.length) addFilesToQueue(files);
  });

  checkMe();
});

function toggleLoading(on) {
  const el = document.getElementById('loading');
  if (!el) return;
  if (on) el.classList.remove('hidden');
  else el.classList.add('hidden');
}


