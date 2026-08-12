// ============================================================
// Production Tracker — board application logic
// ============================================================

// ---------------- global state ----------------
const state = {
  user: null,
  projectsSummary: [],   // for home view
  project: null,         // current project row
  role: null,             // 'owner' | 'editor' | 'viewer'
  stages: [],             // [{id, stage_name, stage_order}]
  items: [],               // [{id, name, assignee, due_date, notes, sort_order}]
  progress: {},            // "itemId:stageId" -> boolean
  members: [],
  pendingInvites: [],
  filter: 'all',
  searchQuery: '',
  sortByDue: false,
  selectMode: false,
  selectedIds: new Set(),
  dirty: false,
  pendingItemFields: new Map(),   // itemId -> {fields}
  pendingProgress: new Map(),     // "itemId:stageId" -> boolean
  draggedItemId: null,
  attachmentsForItemId: null,
};

const els = {};
document.querySelectorAll('[id]').forEach(el => { els[el.id] = el; });

// ---------------- theme toggle ----------------
function syncThemeButtonLabel() {
  if (!els.themeToggleBtn) return;
  const isLight = document.documentElement.classList.contains('theme-light');
  els.themeToggleBtn.textContent = isLight ? 'Dark' : 'Light';
}
syncThemeButtonLabel();
els.themeToggleBtn?.addEventListener('click', () => {
  const isLight = document.documentElement.classList.toggle('theme-light');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  syncThemeButtonLabel();
});

// ---------------- boot ----------------
(async function boot() {
  const { data: session } = await DataAPI.getSession();
  if (!session) { window.location.href = 'login.html'; return; }
  state.user = session.user;
  await loadHome();
})();

els.signOutBtn?.addEventListener('click', async () => {
  await DataAPI.signOut();
  window.location.href = 'login.html';
});

els.profileBtn?.addEventListener('click', openProfileView);
els.profileBackBtn?.addEventListener('click', loadHome);

async function openProfileView() {
  const { data, error } = await DataAPI.getMyProfile();
  if (error) { showToast(error.message, true); return; }

  els.profileFullName.value = data.full_name || '';
  els.profileCurrentEmail.value = state.user.email;
  els.profileNewEmail.value = '';
  els.profileCurrentPw.value = '';
  els.profileNewPw.value = '';
  els.profileConfirmPw.value = '';
  ['err-profileNewEmail','err-profileCurrentPw','err-profileNewPw','err-profileConfirmPw'].forEach(id => {
    if (els[id]) els[id].textContent = '';
  });

  if (data.avatar_url) {
    els.avatarPreview.innerHTML = `<img src="${data.avatar_url}" alt="Profile picture">`;
  } else {
    els.avatarPreview.innerHTML = (data.full_name || state.user.email || '?').charAt(0).toUpperCase();
  }

  showView('profileView');
}

els.avatarUploadBtn.addEventListener('click', () => els.avatarFileInput.click());
els.avatarFileInput.addEventListener('change', async () => {
  const file = els.avatarFileInput.files[0];
  els.avatarFileInput.value = '';
  if (!file) return;
  els.avatarUploadBtn.disabled = true;
  els.avatarUploadBtn.innerHTML = '<span class="spinner"></span>Uploading…';
  const { data, error } = await DataAPI.uploadAvatar(file);
  els.avatarUploadBtn.disabled = false;
  els.avatarUploadBtn.textContent = 'Change picture';
  if (error) { showToast(error.message, true); return; }
  els.avatarPreview.innerHTML = `<img src="${data.avatar_url}" alt="Profile picture">`;
  showToast('Picture updated.');
});

els.saveNameBtn.addEventListener('click', async () => {
  const name = els.profileFullName.value.trim();
  if (!name) { showToast('Name cannot be empty.', true); return; }
  els.saveNameBtn.disabled = true;
  const { error } = await DataAPI.updateProfile({ full_name: name });
  els.saveNameBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  showToast('Name saved.');
});

els.changeEmailBtn.addEventListener('click', async () => {
  const newEmail = els.profileNewEmail.value.trim();
  els['err-profileNewEmail'].textContent = '';
  if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    els['err-profileNewEmail'].textContent = 'Enter a valid email address.';
    return;
  }
  els.changeEmailBtn.disabled = true;
  els.changeEmailBtn.innerHTML = '<span class="spinner"></span>Sending…';
  const { error } = await DataAPI.changeEmail(newEmail);
  els.changeEmailBtn.disabled = false;
  els.changeEmailBtn.textContent = 'Change email';
  if (error) { showToast(error.message, true); return; }
  els.profileNewEmail.value = '';
  showToast(`Confirmation link sent to ${newEmail}. Click it to finish the change.`);
});

els.changePwBtn.addEventListener('click', async () => {
  const current = els.profileCurrentPw.value;
  const next = els.profileNewPw.value;
  const confirm = els.profileConfirmPw.value;
  ['err-profileCurrentPw','err-profileNewPw','err-profileConfirmPw'].forEach(id => els[id].textContent = '');

  let ok = true;
  if (!current) { els['err-profileCurrentPw'].textContent = 'Enter your current password.'; ok = false; }
  if (next.length < 8) { els['err-profileNewPw'].textContent = 'Use at least 8 characters.'; ok = false; }
  if (confirm !== next) { els['err-profileConfirmPw'].textContent = 'Passwords do not match.'; ok = false; }
  if (!ok) return;

  els.changePwBtn.disabled = true;
  els.changePwBtn.innerHTML = '<span class="spinner"></span>Updating…';
  const { error } = await DataAPI.changePassword(current, next);
  els.changePwBtn.disabled = false;
  els.changePwBtn.textContent = 'Change password';
  if (error) { els['err-profileCurrentPw'].textContent = error.message; return; }
  els.profileCurrentPw.value = '';
  els.profileNewPw.value = '';
  els.profileConfirmPw.value = '';
  showToast('Password changed.');
});

// ---------------- utils ----------------
function showToast(msg, isError) {
  const t = els.toast;
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}
function setLoading(on) { els.loadingOverlay.classList.toggle('show', on); }
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(name).classList.add('active');
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function escHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ============================================================
// HOME VIEW
// ============================================================
async function loadHome() {
  setLoading(true);
  const { data, error } = await DataAPI.listProjects();
  setLoading(false);
  if (error) { showToast(error.message, true); return; }
  state.projectsSummary = data;
  renderHome();
  showView('homeView');
  renderDashboard(); // fires its own queries, doesn't block the view
}

async function renderDashboard() {
  const projects = state.projectsSummary;
  if (!projects.length) {
    els.dashboardStats.innerHTML = '';
    els.dashboardTrend.innerHTML = '';
    return;
  }

  // ---- aggregate item stats across every project ----
  const itemToProject = new Map(); // item_id -> { dueDate, finalStageId }
  projects.forEach(p => {
    const stagesSorted = [...(p.stages || [])].sort((a, b) => a.stage_order - b.stage_order);
    const finalStageId = stagesSorted.length ? stagesSorted[stagesSorted.length - 1].id : null;
    (p.items || []).forEach(item => {
      itemToProject.set(item.id, { dueDate: item.due_date, finalStageId });
    });
  });
  const itemIds = [...itemToProject.keys()];

  const { data: progressRows, error: progErr } = await DataAPI.getProgressForItems(itemIds);
  if (progErr) { els.dashboardStats.innerHTML = ''; return; }

  const finalDoneSet = new Set();  // item ids completed on their project's final stage
  const anyDoneSet = new Set();    // item ids with at least one completed stage
  (progressRows || []).forEach(row => {
    anyDoneSet.add(row.item_id);
    const meta = itemToProject.get(row.item_id);
    if (meta && row.stage_id === meta.finalStageId) finalDoneSet.add(row.item_id);
  });

  const today = todayStr();
  let complete = 0, overdue = 0, inProgress = 0, notStarted = 0;
  itemToProject.forEach((meta, itemId) => {
    if (finalDoneSet.has(itemId)) { complete++; return; }
    if (meta.dueDate && meta.dueDate < today) { overdue++; return; }
    if (anyDoneSet.has(itemId)) { inProgress++; return; }
    notStarted++;
  });
  const total = itemIds.length;
  const pct = total ? Math.round(complete / total * 100) : 0;

  els.dashboardStats.innerHTML = `
    <div class="stat-box"><div class="stat-label">Active projects</div><div class="stat-value">${projects.length}</div></div>
    <div class="stat-box"><div class="stat-label">Total items</div><div class="stat-value">${total}</div></div>
    <div class="stat-box"><div class="stat-label">Complete</div><div class="stat-value" style="color:var(--ok)">${complete} <span style="font-size:12px;color:var(--text-faint)">(${pct}%)</span></div></div>
    <div class="stat-box"><div class="stat-label">In progress</div><div class="stat-value" style="color:var(--warn)">${inProgress}</div></div>
    <div class="stat-box"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--danger)">${overdue}</div></div>
  `;

  // ---- 7-day activity trend, pulled straight from the activity log ----
  const projectIds = projects.map(p => p.id);
  const { data: activityRows, error: actErr } = await DataAPI.getRecentActivityTimestamps(projectIds, 7);
  if (actErr) { els.dashboardTrend.innerHTML = ''; return; }

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString(undefined, { weekday: 'short' })[0] });
  }
  const countByDay = {};
  (activityRows || []).forEach(row => {
    const key = row.created_at.slice(0, 10);
    countByDay[key] = (countByDay[key] || 0) + 1;
  });
  const maxCount = Math.max(1, ...days.map(d => countByDay[d.key] || 0));

  els.dashboardTrend.innerHTML = `
    <div class="trend-box">
      <h2>Activity — last 7 days</h2>
      <div class="trend-sub">${(activityRows || []).length} events across all projects</div>
      <div class="trend-chart">
        ${days.map(d => {
          const c = countByDay[d.key] || 0;
          const h = Math.round((c / maxCount) * 100);
          return `<div class="trend-bar" title="${c} events">
            <div class="bar-fill" style="height:${h}%"></div>
            <div class="bar-label">${d.label}</div>
          </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderHome() {
  const grid = els.projectGrid;
  grid.innerHTML = '';

  const newCard = document.createElement('div');
  newCard.className = 'new-project-card';
  newCard.innerHTML = '<div class="plus">+</div><div>New project</div>';
  newCard.addEventListener('click', openSetupView);
  grid.appendChild(newCard);

  if (!state.projectsSummary.length) {
    // still show the new-project card; add an empty note beneath via footer text
  }

  state.projectsSummary.forEach(p => {
    const itemCount = (p.items || []).length;
    const isOwner = p.owner_id === state.user.id;
    const card = document.createElement('div');
    card.className = 'project-card';
    card.style.position = 'relative';
    card.innerHTML = `
      ${isOwner ? `<button class="project-delete-btn" title="Delete project">×</button>` : ''}
      <div class="p-name">${escHtml(p.title)}</div>
      <div class="p-meta">${itemCount} ${itemCount === 1 ? escHtml(p.item_singular) : escHtml(p.item_plural)} · ${(p.stages || []).length} stages</div>
      <div class="p-bar"><i style="width:0%"></i></div>
      <div class="p-pct">Loading…</div>
    `;
    card.addEventListener('click', () => openBoard(p.id));
    if (isOwner) {
      card.querySelector('.project-delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${p.title}" permanently? This deletes all its items, stages, and history. This cannot be undone.`)) return;
        const { error } = await DataAPI.deleteProject(p.id);
        if (error) { showToast(error.message, true); return; }
        state.projectsSummary = state.projectsSummary.filter(x => x.id !== p.id);
        renderHome();
        showToast('Project deleted.');
      });
    }
    grid.appendChild(card);
    computeHomeCardPct(p, card);
  });
}

async function computeHomeCardPct(p, card) {
  const itemIds = (p.items || []).map(i => i.id);
  const stagesSorted = [...(p.stages || [])].sort((a,b) => a.stage_order - b.stage_order);
  const finalStage = stagesSorted[stagesSorted.length - 1];
  const bar = card.querySelector('.p-bar > i');
  const pctEl = card.querySelector('.p-pct');
  if (!itemIds.length || !finalStage) { pctEl.textContent = 'No items yet'; return; }

  const { data, error } = await sb.from('item_progress')
    .select('item_id', { count: 'exact' })
    .in('item_id', itemIds)
    .eq('stage_id', finalStage.id)
    .eq('completed', true);
  if (error) { pctEl.textContent = '—'; return; }
  const pct = Math.round((data.length / itemIds.length) * 100);
  bar.style.width = pct + '%';
  pctEl.textContent = pct + '% complete';
}

// ============================================================
// SETUP VIEW (new project)
// ============================================================
let setupStages = [];
let setupTrackMode = 'multiple';

function openSetupView() {
  setupStages = ['Not Started', 'In Progress', 'Review', 'Complete'];
  setupTrackMode = 'multiple';
  els.setupName.value = '';
  els.setupItemSingular.value = 'Track';
  els.setupItemPlural.value = 'Tracks';
  showFieldError2(els.setupName, els['err-setupName'], '');
  renderStageEditor(els.setupStageEditor, setupStages, (list) => { setupStages = list; });
  updateSetupModeButtons();
  showView('setupView');
}
els.setupBackBtn.addEventListener('click', () => showView('homeView'));

function updateSetupModeButtons() {
  els.modeMultipleBtn.classList.toggle('primary', setupTrackMode === 'multiple');
  els.modeSingleBtn.classList.toggle('primary', setupTrackMode === 'single');
}
els.modeMultipleBtn.addEventListener('click', () => { setupTrackMode = 'multiple'; updateSetupModeButtons(); });
els.modeSingleBtn.addEventListener('click', () => { setupTrackMode = 'single'; updateSetupModeButtons(); });

els.addStageBtn.addEventListener('click', () => {
  setupStages.push('New Stage');
  renderStageEditor(els.setupStageEditor, setupStages, (list) => { setupStages = list; });
});

function showFieldError2(inputEl, errEl, msg) {
  if (!errEl) return;
  inputEl.classList.toggle('invalid', !!msg);
  errEl.textContent = msg || '';
}

// generic stage editor renderer: rows with drag-handle, number, text input, remove.
// onChange(newOrderedNameList) fires on any edit/remove/reorder.
function renderStageEditor(container, names, onChange, idsList) {
  container.innerHTML = '';
  names.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'stage-row';
    row.draggable = true;
    row.dataset.index = i;
    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <span class="stage-num">${i + 1}</span>
      <input type="text" value="${escHtml(name)}">
      <button class="remove-stage" title="Remove stage">×</button>
    `;
    const input = row.querySelector('input');
    input.addEventListener('input', () => { names[i] = input.value; onChange([...names]); });
    row.querySelector('.remove-stage').addEventListener('click', () => {
      if (names.length <= 1) { showToast('A pipeline needs at least one stage.', true); return; }
      names.splice(i, 1);
      if (idsList) idsList.splice(i, 1);
      onChange([...names]);
      renderStageEditor(container, names, onChange, idsList);
    });
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', e => e.preventDefault());
    row.addEventListener('drop', e => {
      e.preventDefault();
      const from = +document.querySelector('.stage-row.dragging').dataset.index;
      const to = i;
      if (from === to) return;
      const [moved] = names.splice(from, 1);
      names.splice(to, 0, moved);
      if (idsList) { const [mi] = idsList.splice(from, 1); idsList.splice(to, 0, mi); }
      onChange([...names]);
      renderStageEditor(container, names, onChange, idsList);
    });
    container.appendChild(row);
  });
}

els.createProjectBtn.addEventListener('click', async () => {
  const title = els.setupName.value.trim();
  if (!title) { showFieldError2(els.setupName, els['err-setupName'], 'Give your project a name.'); return; }
  if (!setupStages.length) { showToast('Add at least one stage.', true); return; }

  els.createProjectBtn.disabled = true;
  els.createProjectBtn.innerHTML = '<span class="spinner"></span>Creating…';
  const { data, error } = await DataAPI.createProject({
    title,
    itemSingular: els.setupItemSingular.value.trim() || 'Item',
    itemPlural: els.setupItemPlural.value.trim() || 'Items',
    stages: setupStages,
    trackMode: setupTrackMode
  });
  els.createProjectBtn.disabled = false;
  els.createProjectBtn.textContent = 'Create board';

  if (error) { showToast(error.message, true); return; }
  showToast('Project created.');
  await openBoard(data.id);
});

// ============================================================
// BOARD VIEW
// ============================================================
async function openBoard(projectId) {
  setLoading(true);
  const { data, error } = await DataAPI.getProjectFull(projectId);
  setLoading(false);
  if (error) { showToast(error.message, true); return; }

  state.project = data.project;
  state.stages = [...data.stages].sort((a,b) => a.stage_order - b.stage_order);
  state.items = data.items;
  state.members = data.members;
  const me = data.members.find(m => m.user_id === state.user.id);
  state.role = me ? me.role : (data.project.owner_id === state.user.id ? 'owner' : 'viewer');

  state.progress = {};
  data.progress.forEach(p => { state.progress[`${p.item_id}:${p.stage_id}`] = p.completed; });

  state.filter = 'all';
  state.searchQuery = '';
  els.searchBox.value = '';
  state.sortByDue = false;
  state.selectMode = false;
  state.selectedIds.clear();
  state.dirty = false;
  state.pendingItemFields.clear();
  state.pendingProgress.clear();

  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  els.summaryPanel.classList.remove('open');
  els.stagePanel.classList.remove('open');
  els.membersPanel.classList.remove('open');
  els.activityPanel.classList.remove('open');
  els.attachmentsPanel.classList.remove('open');
  els.modePanel.classList.remove('open');
  els.bulkBar.classList.remove('open');

  renderBoardHeader();
  renderBoard();
  updateLastSavedLabel();
  showView('boardView');
}

els.boardBackBtn.addEventListener('click', loadHome);

els.deleteProjectBtn.addEventListener('click', async () => {
  if (!confirm(`Delete "${state.project.title}" permanently? This deletes all its items, stages, and history. This cannot be undone.`)) return;
  els.deleteProjectBtn.disabled = true;
  const { error } = await DataAPI.deleteProject(state.project.id);
  els.deleteProjectBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  showToast('Project deleted.');
  await loadHome();
});

function isReadOnly() { return state.role === 'viewer'; }

function renderBoardHeader() {
  els.boardTitle.textContent = state.project.title;
  els.boardTitle.contentEditable = state.role !== 'viewer';
  els.boardSubtitle.textContent = `Tracking ${state.items.length} ${state.items.length === 1 ? state.project.item_singular : state.project.item_plural} · ${state.stages.length} stages · role: ${state.role}`;
  els.finishLabel.textContent = state.stages.length ? `${state.project.item_plural} Complete` : 'Complete';
  updateMasterMeter();

  // stage select for bulk bar
  els.bulkStageSelect.innerHTML = state.stages.map(s => `<option value="${s.id}">${escHtml(s.stage_name)}</option>`).join('');
  els.deleteProjectBtn.style.display = state.role === 'owner' ? 'inline-block' : 'none';

  // single-track mode: hide the multi-item controls, unless the one track
  // got deleted and we need Add Item back to recover.
  const isSingle = state.project.track_mode === 'single';
  const needsRecovery = isSingle && state.items.length === 0;
  els.addItemBtn.style.display = (!isSingle || needsRecovery) ? '' : 'none';
  els.importCsvBtn.style.display = isSingle ? 'none' : '';
  els.searchBox.style.display = isSingle ? 'none' : '';
}

els.boardTitle.addEventListener('blur', async () => {
  const newTitle = els.boardTitle.textContent.trim() || state.project.title;
  els.boardTitle.textContent = newTitle;
  if (newTitle === state.project.title) return;
  const { error } = await DataAPI.updateProjectMeta(state.project.id, { title: newTitle });
  if (error) { showToast(error.message, true); els.boardTitle.textContent = state.project.title; return; }
  state.project.title = newTitle;
  showToast('Project renamed.');
});

function getStatus(item) {
  const final = state.stages[state.stages.length - 1];
  if (!final) return 'notstarted';
  const doneFinal = getProg(item.id, final.id);
  if (doneFinal) return 'complete';
  const overdue = item.due_date && item.due_date < todayStr();
  if (overdue) return 'overdue';
  const anyDone = state.stages.some(s => getProg(item.id, s.id));
  return anyDone ? 'inprogress' : 'notstarted';
}
function getProg(itemId, stageId) {
  const key = `${itemId}:${stageId}`;
  return state.pendingProgress.has(key) ? state.pendingProgress.get(key) : !!state.progress[key];
}
function statusLabel(s) {
  return { notstarted: 'Not started', inprogress: 'In progress', complete: 'Complete', overdue: 'Overdue' }[s];
}

function updateMasterMeter() {
  const final = state.stages[state.stages.length - 1];
  const total = state.items.length;
  const done = total && final ? state.items.filter(i => getProg(i.id, final.id)).length : 0;
  const pct = total ? Math.round(done / total * 100) : 0;
  els.masterMeter.querySelector('i').style.width = pct + '%';
  els.completeCount.textContent = total ? `${done}/${total} (${pct}%)` : '–';
}

function updateLastSavedLabel() {
  if (state.dirty) {
    els.lastSaved.textContent = 'Unsaved changes';
    els.lastSaved.style.color = 'var(--warn)';
  } else if (state._lastSavedAt) {
    els.lastSaved.textContent = 'Saved ' + state._lastSavedAt.toLocaleTimeString();
    els.lastSaved.style.color = '';
  } else {
    els.lastSaved.textContent = 'Not saved yet';
    els.lastSaved.style.color = '';
  }
}
function markDirty() { state.dirty = true; updateLastSavedLabel(); }

// ---------------- filters ----------------
document.getElementById('filterBar').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  state.filter = btn.dataset.filter;
  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b === btn));
  renderBoard();
});

els.searchBox.addEventListener('input', () => {
  state.searchQuery = els.searchBox.value.trim();
  renderBoard();
});

els.sortDueBtn.addEventListener('click', () => {
  state.sortByDue = !state.sortByDue;
  els.sortDueBtn.classList.toggle('primary', state.sortByDue);
  renderBoard();
});

// ---------------- select mode / bulk bar ----------------
els.selectModeBtn.addEventListener('click', () => toggleSelectMode());
function toggleSelectMode(force) {
  state.selectMode = force !== undefined ? force : !state.selectMode;
  if (!state.selectMode) state.selectedIds.clear();
  els.bulkBar.classList.toggle('open', state.selectMode);
  els.selectModeBtn.classList.toggle('primary', state.selectMode);
  renderBoard();
}
function updateBulkCount() {
  els.bulkCount.textContent = `${state.selectedIds.size} selected`;
}
els.bulkCancelBtn.addEventListener('click', () => toggleSelectMode(false));

els.bulkCheckBtn.addEventListener('click', () => bulkSetStage(true));
els.bulkUncheckBtn.addEventListener('click', () => bulkSetStage(false));
function bulkSetStage(completed) {
  if (!state.selectedIds.size) { showToast('Select some items first.', true); return; }
  const stageId = els.bulkStageSelect.value;
  state.selectedIds.forEach(id => {
    state.pendingProgress.set(`${id}:${stageId}`, completed);
  });
  markDirty();
  renderBoard();
}
els.bulkDeleteBtn.addEventListener('click', async () => {
  if (!state.selectedIds.size) { showToast('Select some items first.', true); return; }
  if (!confirm(`Delete ${state.selectedIds.size} item(s)? This cannot be undone.`)) return;
  const ids = [...state.selectedIds];
  setLoading(true);
  const { error } = await DataAPI.bulkDeleteItems(ids);
  setLoading(false);
  if (error) { showToast(error.message, true); return; }
  state.items = state.items.filter(i => !ids.includes(i.id));
  ids.forEach(id => { for (const k of [...state.pendingProgress.keys()]) if (k.startsWith(id+':')) state.pendingProgress.delete(k); state.pendingItemFields.delete(id); });
  state.selectedIds.clear();
  showToast('Items deleted.');
  renderBoardHeader();
  renderBoard();
});

// ============================================================
// ITEM CARDS
// ============================================================
function visibleItems() {
  let list = [...state.items];
  if (state.project.track_mode === 'single') {
    list = state.project.primary_item_id
      ? list.filter(i => i.id === state.project.primary_item_id)
      : list.slice(0, 1);
  }
  if (state.filter !== 'all') list = list.filter(i => getStatus(i) === state.filter);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(i =>
      (i.name || '').toLowerCase().includes(q) ||
      (i.assignee || '').toLowerCase().includes(q)
    );
  }
  if (state.sortByDue) {
    list.sort((a, b) => (a.due_date || '9999-99-99').localeCompare(b.due_date || '9999-99-99'));
  }
  return list;
}

function renderBoard() {
  updateMasterMeter();
  updateBulkCount();
  const board = els.board;
  board.innerHTML = '';
  const list = visibleItems();
  const canDrag = state.filter === 'all' && !state.sortByDue && !state.searchQuery && state.project.track_mode !== 'single' && !isReadOnly();

  if (!list.length) {
    board.innerHTML = '<div class="empty-note">No items match this filter.</div>';
  }

  list.forEach(item => board.appendChild(renderItemCard(item, canDrag)));
}

function renderItemCard(item, canDrag) {
  const status = getStatus(item);
  const card = document.createElement('div');
  card.className = `item-card status-${status}`;
  card.dataset.id = item.id;
  card.draggable = canDrag;

  const nameField = state.pendingItemFields.get(item.id)?.name ?? item.name;
  const assigneeField = state.pendingItemFields.get(item.id)?.assignee ?? (item.assignee || '');
  const dueField = state.pendingItemFields.get(item.id)?.due_date ?? (item.due_date || '');

  card.innerHTML = `
    <div class="ic-head">
      ${state.selectMode ? `<input type="checkbox" class="ic-select" ${state.selectedIds.has(item.id) ? 'checked' : ''}>` : ''}
      <div class="ic-title-wrap">
        <input class="ic-name" value="${escHtml(nameField)}" ${isReadOnly() ? 'disabled' : ''}>
        <div class="ic-meta">
          <input class="assignee-field" placeholder="Unassigned" value="${escHtml(assigneeField)}" ${isReadOnly() ? 'disabled' : ''}>
          <input class="due-field" type="date" value="${dueField}" ${isReadOnly() ? 'disabled' : ''}>
        </div>
      </div>
      ${!isReadOnly() ? `<button class="ic-delete" title="Delete item">×</button>` : ''}
    </div>
    <div class="ic-status-row"><span class="status-pill ${status}">${statusLabel(status)}</span></div>
    <div class="ic-tear"></div>
    <div class="ic-stages"></div>
    <div class="ic-footer">
      <button class="action-btn ic-attach-btn" data-item="${item.id}">📎 Attachments</button>
    </div>
  `;

  const stagesWrap = card.querySelector('.ic-stages');
  state.stages.forEach((s, idx) => {
    const done = getProg(item.id, s.id);
    const tag = document.createElement('span');
    tag.className = `stage-tag ${done ? 'done' : ''} ${idx === state.stages.length - 1 ? 'final' : ''}`;
    tag.textContent = s.stage_name;
    if (!isReadOnly()) {
      tag.addEventListener('click', () => {
        state.pendingProgress.set(`${item.id}:${s.id}`, !done);
        markDirty();
        renderBoard();
      });
    }
    stagesWrap.appendChild(tag);
  });

  // field edits -> local state + dirty, flushed on Save
  if (!isReadOnly()) {
    const nameInput = card.querySelector('.ic-name');
    nameInput.addEventListener('input', () => queueField(item.id, 'name', nameInput.value));
    const assigneeInput = card.querySelector('.assignee-field');
    assigneeInput.addEventListener('input', () => queueField(item.id, 'assignee', assigneeInput.value));
    const dueInput = card.querySelector('.due-field');
    dueInput.addEventListener('change', () => { queueField(item.id, 'due_date', dueInput.value || null); renderBoard(); });

    card.querySelector('.ic-delete').addEventListener('click', () => deleteItem(item.id));
  }

  if (state.selectMode) {
    card.querySelector('.ic-select').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedIds.add(item.id); else state.selectedIds.delete(item.id);
      updateBulkCount();
    });
  }

  card.querySelector('.ic-attach-btn').addEventListener('click', () => openAttachmentsPanel(item.id, item.name));

  if (canDrag) {
    card.addEventListener('dragstart', () => { state.draggedItemId = item.id; card.classList.add('dragging'); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); state.draggedItemId = null; });
    card.addEventListener('dragover', e => e.preventDefault());
    card.addEventListener('drop', e => {
      e.preventDefault();
      if (!state.draggedItemId || state.draggedItemId === item.id) return;
      const fromIdx = state.items.findIndex(i => i.id === state.draggedItemId);
      const toIdx = state.items.findIndex(i => i.id === item.id);
      const [moved] = state.items.splice(fromIdx, 1);
      state.items.splice(toIdx, 0, moved);
      renderBoard();
      persistItemOrder();
    });
  }

  return card;
}

async function persistItemOrder() {
  // only rows whose position actually changed need a write
  const updates = [];
  state.items.forEach((item, idx) => {
    if (item.sort_order !== idx) updates.push({ id: item.id, fields: { sort_order: idx } });
  });
  if (!updates.length) return;

  const { error } = await DataAPI.bulkUpdateItems(updates);
  if (error) { showToast('Reorder could not be saved: ' + error.message, true); return; }
  updates.forEach(u => {
    const item = state.items.find(i => i.id === u.id);
    if (item) item.sort_order = u.fields.sort_order;
  });
}

function queueField(itemId, field, value) {
  const existing = state.pendingItemFields.get(itemId) || {};
  existing[field] = value;
  state.pendingItemFields.set(itemId, existing);
  markDirty();
}

async function deleteItem(itemId) {
  if (!confirm('Delete this item? This cannot be undone.')) return;
  setLoading(true);
  const { error } = await DataAPI.deleteItem(itemId);
  setLoading(false);
  if (error) { showToast(error.message, true); return; }
  state.items = state.items.filter(i => i.id !== itemId);
  state.pendingItemFields.delete(itemId);
  for (const k of [...state.pendingProgress.keys()]) if (k.startsWith(itemId + ':')) state.pendingProgress.delete(k);
  if (state.project.primary_item_id === itemId) state.project.primary_item_id = null; // DB already nulled it via ON DELETE SET NULL
  showToast('Item deleted.');
  renderBoardHeader();
  renderBoard();
}

els.addItemBtn.addEventListener('click', () => addItem());
async function addItem() {
  if (isReadOnly()) { showToast('You have view-only access to this project.', true); return; }
  els.addItemBtn.disabled = true;
  const name = `New ${state.project.item_singular}`;
  const { data, error } = await DataAPI.createItem(state.project.id, { name, sort_order: state.items.length });
  els.addItemBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  state.items.push(data);
  if (state.project.track_mode === 'single' && !state.project.primary_item_id) {
    const { error: modeErr } = await DataAPI.setTrackMode(state.project.id, 'single', data.id);
    if (!modeErr) state.project.primary_item_id = data.id;
  }
  renderBoardHeader();
  renderBoard();
}

// ============================================================
// CSV IMPORT
// ============================================================
function parseCsv(text) {
  // handles quoted fields with embedded commas/newlines/escaped quotes ("")
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

els.importCsvBtn.addEventListener('click', () => {
  if (isReadOnly()) { showToast('You have view-only access to this project.', true); return; }
  els.csvFileInput.click();
});

els.csvFileInput.addEventListener('change', async () => {
  const file = els.csvFileInput.files[0];
  els.csvFileInput.value = '';
  if (!file) return;

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) { showToast('CSV needs a header row plus at least one data row.', true); return; }

  const header = rows[0].map(h => h.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  if (nameIdx === -1) { showToast(`No "name" column found. Header must include: name, assignee, due_date, notes.`, true); return; }
  const assigneeIdx = header.indexOf('assignee');
  const dueIdx = header.indexOf('due_date');
  const notesIdx = header.indexOf('notes');

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const dataRows = rows.slice(1).filter(r => r[nameIdx] && r[nameIdx].trim());
  if (!dataRows.length) { showToast('No rows with a name value found.', true); return; }

  const toImport = dataRows.map((r, i) => {
    const due = dueIdx > -1 ? r[dueIdx]?.trim() : '';
    return {
      name: r[nameIdx].trim(),
      assignee: assigneeIdx > -1 ? (r[assigneeIdx] || '').trim() || null : null,
      due_date: due && dateRe.test(due) ? due : null,
      notes: notesIdx > -1 ? (r[notesIdx] || '').trim() || null : null,
      sort_order: state.items.length + i,
    };
  });

  if (!confirm(`Import ${toImport.length} ${toImport.length === 1 ? state.project.item_singular : state.project.item_plural}?`)) return;

  els.importCsvBtn.disabled = true;
  els.importCsvBtn.innerHTML = '<span class="spinner"></span>Importing…';
  const { data, error } = await DataAPI.bulkCreateItems(state.project.id, toImport);
  els.importCsvBtn.disabled = false;
  els.importCsvBtn.textContent = 'Import CSV';

  if (error) { showToast(error.message, true); return; }
  state.items.push(...data);
  showToast(`Imported ${data.length} items.`);
  renderBoardHeader();
  renderBoard();
});

// ============================================================
// SAVE PROGRESS (flush pending field edits + stage toggles)
// ============================================================
els.saveBtn.addEventListener('click', async () => {
  if (!state.dirty) { showToast('Nothing to save.'); return; }
  els.saveBtn.disabled = true;
  els.saveBtn.innerHTML = '<span class="spinner"></span>Saving…';

  try {
    if (state.pendingItemFields.size) {
      const updates = [...state.pendingItemFields.entries()].map(([id, fields]) => ({ id, fields }));
      const { error } = await DataAPI.bulkUpdateItems(updates);
      if (error) { showToast(error.message, true); return; }
      updates.forEach(u => {
        const item = state.items.find(i => i.id === u.id);
        if (item) Object.assign(item, u.fields);
      });
      state.pendingItemFields.clear();
    }

    if (state.pendingProgress.size) {
      // group by stageId + completed value
      const groups = new Map(); // "stageId:completed" -> [itemIds]
      for (const [key, completed] of state.pendingProgress.entries()) {
        const [itemId, stageId] = key.split(':');
        const gk = `${stageId}:${completed}`;
        if (!groups.has(gk)) groups.set(gk, []);
        groups.get(gk).push(itemId);
      }
      for (const [gk, itemIds] of groups.entries()) {
        const [stageId, completedStr] = gk.split(':');
        const completed = completedStr === 'true';
        const { error } = await DataAPI.bulkSetProgress(itemIds, stageId, completed);
        if (error) { showToast(error.message, true); return; }
        itemIds.forEach(itemId => { state.progress[`${itemId}:${stageId}`] = completed; });
      }
      state.pendingProgress.clear();
    }

    state.dirty = false;
    state._lastSavedAt = new Date();
    updateLastSavedLabel();
    showToast('Progress saved.');
    renderBoard();
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'Save Progress';
  }
});

// ============================================================
// STAGE EDITOR (board)
// ============================================================
let boardStageNames = [];
let boardStageIds = [];

// ============================================================
// BOARD MODE (single track vs multiple)
// ============================================================
let modeChoice = 'multiple';

els.modeBtn.addEventListener('click', () => {
  closeOtherPanels('modePanel');
  modeChoice = state.project.track_mode || 'multiple';
  updateModeButtons();
  els.modePanel.classList.toggle('open');
});

function updateModeButtons() {
  els.modeBtnMultiple.classList.toggle('primary', modeChoice === 'multiple');
  els.modeBtnSingle.classList.toggle('primary', modeChoice === 'single');
  const needsPicker = modeChoice === 'single' && state.items.length > 1;
  els.primaryItemPickerWrap.style.display = needsPicker ? 'block' : 'none';
  if (needsPicker) {
    const current = state.project.primary_item_id;
    els.primaryItemPicker.innerHTML = state.items.map(i =>
      `<option value="${i.id}" ${i.id === current ? 'selected' : ''}>${escHtml(i.name)}</option>`
    ).join('');
  }
}
els.modeBtnMultiple.addEventListener('click', () => { modeChoice = 'multiple'; updateModeButtons(); });
els.modeBtnSingle.addEventListener('click', () => { modeChoice = 'single'; updateModeButtons(); });

els.saveModeBtn.addEventListener('click', async () => {
  let primaryId = null;
  if (modeChoice === 'single') {
    if (state.items.length > 1) {
      primaryId = els.primaryItemPicker.value;
      if (!primaryId) { showToast('Pick which item stays as the track.', true); return; }
    } else {
      primaryId = state.items[0]?.id || null;
    }
  }
  els.saveModeBtn.disabled = true;
  const { error } = await DataAPI.setTrackMode(state.project.id, modeChoice, primaryId);
  els.saveModeBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  state.project.track_mode = modeChoice;
  state.project.primary_item_id = primaryId;
  els.modePanel.classList.remove('open');
  showToast(modeChoice === 'single' ? 'Switched to one track.' : 'Switched to multiple tracks.');
  renderBoardHeader();
  renderBoard();
});

els.editStagesBtn.addEventListener('click', () => {
  closeOtherPanels('stagePanel');
  boardStageNames = state.stages.map(s => s.stage_name);
  boardStageIds = state.stages.map(s => s.id);
  renderStageEditor(els.boardStageEditor, boardStageNames, (list) => { boardStageNames = list; }, boardStageIds);
  els.stagePanel.classList.toggle('open');
});
els.boardAddStageBtn.addEventListener('click', () => {
  boardStageNames.push('New Stage');
  boardStageIds.push(null);
  renderStageEditor(els.boardStageEditor, boardStageNames, (list) => { boardStageNames = list; }, boardStageIds);
});
els.saveStagesBtn.addEventListener('click', async () => {
  if (!boardStageNames.length) { showToast('Add at least one stage.', true); return; }
  const list = boardStageNames.map((name, i) => ({ id: boardStageIds[i] || undefined, name }));
  els.saveStagesBtn.disabled = true;
  const { error } = await DataAPI.replaceStages(state.project.id, list);
  els.saveStagesBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  showToast('Stages saved.');
  await openBoard(state.project.id);
  els.stagePanel.classList.remove('open');
});

// ============================================================
// SUMMARY PANEL
// ============================================================
els.summaryBtn.addEventListener('click', () => {
  closeOtherPanels('summaryPanel');
  els.summaryPanel.classList.toggle('open');
  if (els.summaryPanel.classList.contains('open')) renderSummary();
});

function closeOtherPanels(keep) {
  ['summaryPanel', 'stagePanel', 'membersPanel', 'activityPanel', 'attachmentsPanel', 'modePanel'].forEach(id => {
    if (id !== keep) els[id].classList.remove('open');
  });
}

function renderSummary() {
  const total = state.items.length;
  const counts = { notstarted: 0, inprogress: 0, complete: 0, overdue: 0 };
  state.items.forEach(i => counts[getStatus(i)]++);

  els.summaryGrid.innerHTML = `
    <div class="stat-box"><div class="stat-label">Total</div><div class="stat-value">${total}</div></div>
    <div class="stat-box"><div class="stat-label">Not started</div><div class="stat-value" style="color:var(--idle)">${counts.notstarted}</div></div>
    <div class="stat-box"><div class="stat-label">In progress</div><div class="stat-value" style="color:var(--warn)">${counts.inprogress}</div></div>
    <div class="stat-box"><div class="stat-label">Complete</div><div class="stat-value" style="color:var(--ok)">${counts.complete}</div></div>
    <div class="stat-box"><div class="stat-label">Overdue</div><div class="stat-value" style="color:var(--danger)">${counts.overdue}</div></div>
  `;

  els.stageBreakdown.innerHTML = state.stages.map(s => {
    const done = state.items.filter(i => getProg(i.id, s.id)).length;
    const pct = total ? Math.round(done / total * 100) : 0;
    return `<div class="stage-bd-row">
      <span class="name">${escHtml(s.stage_name)}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <span class="pct">${pct}%</span>
    </div>`;
  }).join('');

  els.summaryTableBody.innerHTML = state.items.map(item => {
    const status = getStatus(item);
    const doneCount = state.stages.filter(s => getProg(item.id, s.id)).length;
    const pending = state.stages.filter(s => !getProg(item.id, s.id)).map(s => s.stage_name).join(', ') || '—';
    return `<tr>
      <td>${escHtml(item.name)}</td>
      <td><span class="status-pill ${status}">${statusLabel(status)}</span></td>
      <td>${doneCount}/${state.stages.length}</td>
      <td>${escHtml(item.assignee || '—')}</td>
      <td>${item.due_date || '—'}</td>
      <td>${escHtml(pending)}</td>
    </tr>`;
  }).join('');
}

function summaryToText() {
  const lines = [`${state.project.title} — Progress Summary`, `Generated ${new Date().toLocaleString()}`, ''];
  state.items.forEach(item => {
    const status = statusLabel(getStatus(item));
    const doneCount = state.stages.filter(s => getProg(item.id, s.id)).length;
    lines.push(`${item.name} — ${status} (${doneCount}/${state.stages.length}) — assignee: ${item.assignee || '—'} — due: ${item.due_date || '—'}`);
  });
  return lines.join('\n');
}
function summaryToCsv() {
  const rows = [['Item','Status','Progress','Assignee','Due','Pending stages']];
  state.items.forEach(item => {
    const status = statusLabel(getStatus(item));
    const doneCount = state.stages.filter(s => getProg(item.id, s.id)).length;
    const pending = state.stages.filter(s => !getProg(item.id, s.id)).map(s => s.stage_name).join('; ');
    rows.push([item.name, status, `${doneCount}/${state.stages.length}`, item.assignee || '', item.due_date || '', pending]);
  });
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
}
function summaryToJson() {
  return JSON.stringify({
    project: state.project.title,
    generated: new Date().toISOString(),
    items: state.items.map(item => ({
      name: item.name,
      status: getStatus(item),
      assignee: item.assignee || null,
      due_date: item.due_date || null,
      stages: state.stages.map(s => ({ stage: s.stage_name, completed: getProg(item.id, s.id) }))
    }))
  }, null, 2);
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
els.copySummaryBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(summaryToText());
  showToast('Summary copied to clipboard.');
});
els.downloadTxtBtn.addEventListener('click', () => download(`${state.project.title}-summary.txt`, summaryToText(), 'text/plain'));
els.downloadCsvBtn.addEventListener('click', () => download(`${state.project.title}-summary.csv`, summaryToCsv(), 'text/csv'));
els.downloadJsonBtn.addEventListener('click', () => download(`${state.project.title}-summary.json`, summaryToJson(), 'application/json'));

// ============================================================
// MEMBERS PANEL
// ============================================================
els.membersBtn.addEventListener('click', async () => {
  closeOtherPanels('membersPanel');
  els.membersPanel.classList.toggle('open');
  if (els.membersPanel.classList.contains('open')) {
    if (state.role === 'owner') {
      const { data, error } = await DataAPI.listPendingInvites(state.project.id);
      if (!error) state.pendingInvites = data;
    }
    renderMembers();
  }
});

function renderMembers() {
  const isOwner = state.role === 'owner';
  els.inviteRow.style.display = isOwner ? 'flex' : 'none';
  els.membersHint.style.display = isOwner ? 'block' : 'none';

  const memberRows = state.members.map(m => `
    <div class="member-row">
      <div><span class="member-email">${escHtml(m.profiles?.email || m.user_id)}</span><span class="member-role">${m.role}</span></div>
      ${isOwner && m.role !== 'owner' ? `<button class="action-btn danger" data-mid="${m.id}">Remove</button>` : ''}
    </div>
  `).join('');

  const inviteRows = isOwner ? state.pendingInvites.map(inv => `
    <div class="member-row">
      <div><span class="member-email">${escHtml(inv.email)}</span><span class="member-role">${inv.role} · pending</span></div>
      <button class="action-btn" data-invite="${inv.id}">Cancel invite</button>
    </div>
  `).join('') : '';

  els.membersList.innerHTML = memberRows + inviteRows;

  els.membersList.querySelectorAll('button[data-mid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this member from the project?')) return;
      btn.disabled = true;
      const { error } = await DataAPI.removeMember(btn.dataset.mid);
      if (error) { showToast(error.message, true); btn.disabled = false; return; }
      state.members = state.members.filter(m => m.id !== btn.dataset.mid);
      renderMembers();
      showToast('Member removed.');
    });
  });

  els.membersList.querySelectorAll('button[data-invite]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const { error } = await DataAPI.cancelInvite(btn.dataset.invite);
      if (error) { showToast(error.message, true); btn.disabled = false; return; }
      state.pendingInvites = state.pendingInvites.filter(i => i.id !== btn.dataset.invite);
      renderMembers();
      showToast('Invite cancelled.');
    });
  });
}

// ============================================================
// ACTIVITY LOG
// ============================================================
const ACTIVITY_META = {
  item_created:      { icon: '＋', cls: 'created',     verb: 'added item' },
  item_deleted:      { icon: '×', cls: 'deleted',      verb: 'deleted item' },
  item_renamed:      { icon: '✎', cls: 'renamed',      verb: 'renamed item' },
  stage_completed:   { icon: '✓', cls: 'completed',    verb: 'checked' },
  stage_uncompleted: { icon: '↺', cls: 'uncompleted',  verb: 'unchecked' },
  stage_added:       { icon: '＋', cls: 'stage',        verb: 'added stage' },
  stage_renamed:     { icon: '✎', cls: 'stage',        verb: 'renamed stage' },
  stage_removed:     { icon: '×', cls: 'stage',        verb: 'removed stage' },
  member_added:      { icon: '👤', cls: 'member',       verb: 'added member' },
  member_removed:    { icon: '👤', cls: 'member',       verb: 'removed member' },
};

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function activityLine(row) {
  const meta = ACTIVITY_META[row.action] || { verb: row.action };
  const actor = row.profiles?.full_name || row.profiles?.email || 'Someone';
  let what = '';
  if (row.action === 'stage_completed' || row.action === 'stage_uncompleted') {
    what = `<b>${escHtml(row.stage_name || '')}</b> on <b>${escHtml(row.item_name || '')}</b>`;
  } else if (row.item_name) {
    what = `<b>${escHtml(row.item_name)}</b>`;
  } else if (row.stage_name) {
    what = `<b>${escHtml(row.stage_name)}</b>`;
  } else if (row.detail) {
    what = `<b>${escHtml(row.detail)}</b>`;
  }
  const showDetailSuffix = row.detail && (row.item_name || row.stage_name);
  return `${escHtml(actor)} ${meta.verb} ${what}${showDetailSuffix ? ` <span style="color:var(--text-faint)">${escHtml(row.detail)}</span>` : ''}`;
}

els.activityBtn.addEventListener('click', async () => {
  closeOtherPanels('activityPanel');
  els.activityPanel.classList.toggle('open');
  if (els.activityPanel.classList.contains('open')) {
    els.activityFeed.innerHTML = '<div class="empty-note">Loading…</div>';
    const { data, error } = await DataAPI.listActivity(state.project.id);
    if (error) { els.activityFeed.innerHTML = `<div class="empty-note">${escHtml(error.message)}</div>`; return; }
    renderActivity(data);
  }
});

function renderActivity(rows) {
  if (!rows.length) {
    els.activityFeed.innerHTML = '<div class="empty-note">No activity yet.</div>';
    return;
  }
  els.activityFeed.innerHTML = rows.map(row => {
    const meta = ACTIVITY_META[row.action] || { icon: '•', cls: 'stage' };
    return `
      <div class="activity-row">
        <span class="activity-icon ${meta.cls}">${meta.icon}</span>
        <span class="activity-text">${activityLine(row)}</span>
        <span class="activity-time">${timeAgo(row.created_at)}</span>
      </div>
    `;
  }).join('');
}

els.inviteBtn.addEventListener('click', async () => {
  const email = els.inviteEmail.value.trim();
  if (!email) { showToast('Enter an email to invite.', true); return; }
  els.inviteBtn.disabled = true;
  els.inviteBtn.innerHTML = '<span class="spinner"></span>Inviting…';
  const { data, error } = await DataAPI.inviteMember(state.project.id, email, els.inviteRole.value);
  els.inviteBtn.disabled = false;
  els.inviteBtn.textContent = 'Invite';
  if (error) { showToast(error.message, true); return; }
  els.inviteEmail.value = '';

  if (data.pending) {
    state.pendingInvites.push(data);
  } else {
    const { data: full } = await DataAPI.getProjectFull(state.project.id);
    if (full) state.members = full.members;
  }
  renderMembers();

  const { error: mailErr } = await DataAPI.sendInviteEmail(state.project.id, email, els.inviteRole.value);
  if (mailErr) {
    showToast(data.pending ? 'Invite saved, but the email failed to send.' : 'Member added, but the email failed to send.', true);
  } else {
    showToast(data.pending ? 'Invite email sent.' : 'Member added and notified by email.');
  }
});

// ============================================================
// ATTACHMENTS PANEL (scoped to one item at a time)
// ============================================================
async function openAttachmentsPanel(itemId, itemName) {
  closeOtherPanels('attachmentsPanel');
  state.attachmentsForItemId = itemId;
  els.attachmentsItemName.textContent = `Attachments — ${itemName}`;
  els.attachAddRow.style.display = isReadOnly() ? 'none' : 'flex';
  els.attachmentsPanel.classList.add('open');
  await reloadAttachments();
}

async function reloadAttachments() {
  els.attachmentsList.innerHTML = '<div class="empty-note">Loading…</div>';
  const { data, error } = await DataAPI.listAttachments(state.attachmentsForItemId);
  if (error) { els.attachmentsList.innerHTML = `<div class="empty-note">${escHtml(error.message)}</div>`; return; }
  renderAttachments(data);
}

function formatBytes(n) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function renderAttachments(rows) {
  if (!rows.length) {
    els.attachmentsList.innerHTML = '<div class="empty-note">No attachments yet.</div>';
    return;
  }
  els.attachmentsList.innerHTML = rows.map(a => `
    <div class="attach-row" data-id="${a.id}">
      <span class="attach-icon">${a.kind === 'file' ? '📄' : '🔗'}</span>
      <span class="attach-name" data-open="${a.id}">${escHtml(a.label)}</span>
      <span class="attach-meta">${a.kind === 'file' ? formatBytes(a.size_bytes) : 'link'}</span>
      ${!isReadOnly() ? `<button class="action-btn danger" data-del="${a.id}">Remove</button>` : ''}
    </div>
  `).join('');

  const rowsById = new Map(rows.map(r => [r.id, r]));

  els.attachmentsList.querySelectorAll('[data-open]').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', async () => {
      const a = rowsById.get(el.dataset.open);
      if (a.kind === 'link') { window.open(a.url, '_blank'); return; }
      const { data: url, error } = await DataAPI.getSignedUrl(a.file_path);
      if (error) { showToast(error.message, true); return; }
      window.open(url, '_blank');
    });
  });

  els.attachmentsList.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const a = rowsById.get(btn.dataset.del);
      if (!confirm(`Remove "${a.label}"?`)) return;
      btn.disabled = true;
      const { error } = await DataAPI.deleteAttachment(a);
      if (error) { showToast(error.message, true); btn.disabled = false; return; }
      showToast('Attachment removed.');
      reloadAttachments();
    });
  });
}

els.closeAttachmentsBtn.addEventListener('click', () => els.attachmentsPanel.classList.remove('open'));

els.attachUploadBtn.addEventListener('click', () => els.attachFileInput.click());
els.attachFileInput.addEventListener('change', async () => {
  const file = els.attachFileInput.files[0];
  els.attachFileInput.value = '';
  if (!file) return;
  els.attachUploadBtn.disabled = true;
  els.attachUploadBtn.innerHTML = '<span class="spinner"></span>Uploading…';
  const { error } = await DataAPI.uploadFileAttachment(state.project.id, state.attachmentsForItemId, file);
  els.attachUploadBtn.disabled = false;
  els.attachUploadBtn.textContent = 'Upload file';
  if (error) { showToast(error.message, true); return; }
  showToast('File attached.');
  reloadAttachments();
});

els.attachAddLinkBtn.addEventListener('click', async () => {
  const url = els.attachLinkUrl.value.trim();
  if (!url) { showToast('Paste a link first.', true); return; }
  els.attachAddLinkBtn.disabled = true;
  const { error } = await DataAPI.addLinkAttachment(state.project.id, state.attachmentsForItemId, url, els.attachLinkLabel.value.trim());
  els.attachAddLinkBtn.disabled = false;
  if (error) { showToast(error.message, true); return; }
  els.attachLinkUrl.value = '';
  els.attachLinkLabel.value = '';
  showToast('Link added.');
  reloadAttachments();
});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
  if (document.getElementById('boardView').classList.contains('active') === false) return;
  const typing = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable;

  if (e.key === 'Escape') {
    if (state.selectMode) { toggleSelectMode(false); return; }
    ['summaryPanel','stagePanel','membersPanel','activityPanel','attachmentsPanel','modePanel'].forEach(id => els[id].classList.remove('open'));
    return;
  }
  if (typing) return;

  if (e.key.toLowerCase() === 'n') { e.preventDefault(); addItem(); }
  if (e.key === '/') {
    e.preventDefault();
    els.searchBox.focus();
  }
});