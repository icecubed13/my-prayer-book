(() => {
  const data = window.SIDDUR_DATA;
  const storageKey = data.storageKey || 'personal-siddur-custom-content-v1';
  const syncKey = `${storageKey}-sync-v1`;
  let syncMeta = readJson(syncKey, null);
  let store = readStore();
  let conflict = null;
  let lastSyncMessage = '';

  function emptyStore() {
    return { version: 1, sections: [], prayers: [] };
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readStore() {
    const parsed = readJson(storageKey, emptyStore());
    if (!parsed || !Array.isArray(parsed.sections) || !Array.isArray(parsed.prayers)) return emptyStore();
    return parsed;
  }

  function saveStore() {
    localStorage.setItem(storageKey, JSON.stringify(store));
  }

  function saveSyncMeta() {
    if (syncMeta) localStorage.setItem(syncKey, JSON.stringify(syncMeta));
    else localStorage.removeItem(syncKey);
  }

  function safeId(prefix, title) {
    const base = title.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || prefix;
    return `${prefix}-${base}-${Date.now().toString(36)}`;
  }

  function applyCustomContent() {
    store.sections.forEach((section) => {
      if (!data.groups.some((group) => group.id === section.id)) {
        data.groups.push({ ...section, entries: [], isCustom: true });
      }
    });
    store.prayers.forEach((prayer) => {
      const group = data.groups.find((item) => item.id === prayer.groupId);
      if (group && !group.entries.some((entry) => entry.id === prayer.id)) {
        group.entries.push({
          ...prayer,
          headings: [],
          exactText: true,
          isCustom: true,
          content: prayer.text,
          showSectionLinks: false,
        });
      }
    });
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
  }

  function canEdit() {
    return !syncMeta || Boolean(syncMeta.editToken);
  }

  function shareUrl(mode) {
    if (!syncMeta) return '';
    const token = mode === 'edit' ? syncMeta.editToken : syncMeta.viewToken;
    if (!token) return '';
    const readerSuffix = mode === 'edit' && syncMeta.viewToken ? `/${syncMeta.viewToken}` : '';
    return `${location.origin}${location.pathname}#${mode === 'edit' ? 'edit' : 'shared'}/${syncMeta.collectionId}/${token}${readerSuffix}`;
  }

  function authHeaders(token) {
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }

  async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function pullRemote() {
    if (!syncMeta?.collectionId || !(syncMeta.editToken || syncMeta.viewToken)) return false;
    const token = syncMeta.editToken || syncMeta.viewToken;
    const response = await fetchWithTimeout(`./api/collections/${encodeURIComponent(syncMeta.collectionId)}`, {
      headers: authHeaders(token),
    });
    if (!response.ok) throw new Error(response.status === 404 ? 'Collection not found.' : 'Unable to download the cloud collection.');
    const remote = await response.json();
    const changed = JSON.stringify(store) !== JSON.stringify(remote.data);
    store = remote.data;
    saveStore();
    syncMeta.revision = remote.revision;
    syncMeta.viewToken = remote.viewToken || syncMeta.viewToken;
    syncMeta.pending = false;
    syncMeta.lastSyncedAt = new Date().toISOString();
    saveSyncMeta();
    lastSyncMessage = 'Cloud collection is up to date.';
    conflict = null;
    return changed;
  }

  async function pushRemote(force = false) {
    if (!syncMeta?.editToken) return false;
    const response = await fetchWithTimeout(`./api/collections/${encodeURIComponent(syncMeta.collectionId)}`, {
      method: 'PUT',
      headers: authHeaders(syncMeta.editToken),
      body: JSON.stringify({ data: store, revision: syncMeta.revision, force }),
    });
    if (response.status === 409) {
      const remote = await response.json();
      conflict = remote;
      syncMeta.pending = true;
      saveSyncMeta();
      lastSyncMessage = 'This collection was changed on another device. Choose which copy to keep.';
      return false;
    }
    if (!response.ok) throw new Error('Your changes remain saved offline, but cloud synchronization is unavailable.');
    const saved = await response.json();
    syncMeta.revision = saved.revision;
    syncMeta.pending = false;
    syncMeta.lastSyncedAt = new Date().toISOString();
    saveSyncMeta();
    lastSyncMessage = 'Changes synchronized.';
    conflict = null;
    return true;
  }

  function markPending() {
    if (!syncMeta?.editToken) return;
    syncMeta.pending = true;
    saveSyncMeta();
  }

  async function createCloudCollection() {
    const response = await fetchWithTimeout('./api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: data.title || document.title, data: store }),
    });
    if (!response.ok) throw new Error('Cloud synchronization could not be set up.');
    const created = await response.json();
    syncMeta = {
      collectionId: created.collectionId,
      editToken: created.editToken,
      viewToken: created.viewToken,
      revision: created.revision,
      pending: false,
      lastSyncedAt: new Date().toISOString(),
    };
    saveSyncMeta();
    lastSyncMessage = 'Cloud synchronization is ready.';
  }

  async function initialize() {
    const match = location.hash.match(/^#(shared|edit)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?$/);
    if (match) {
      syncMeta = {
        collectionId: match[2],
        editToken: match[1] === 'edit' ? match[3] : null,
        viewToken: match[1] === 'shared' ? match[3] : (match[4] || null),
        revision: 0,
        pending: false,
        lastSyncedAt: null,
      };
      saveSyncMeta();
      history.replaceState(null, '', '#home');
    }
    try {
      if (syncMeta?.pending && syncMeta.editToken) {
        await pushRemote();
      } else if (syncMeta) {
        await pullRemote();
      }
    } catch {
      lastSyncMessage = 'Using the offline copy. Synchronization will retry when a connection is available.';
    }
    applyCustomContent();
  }

  const ready = initialize();

  function sectionOptions(selectedId = '') {
    return data.groups.map((group) => `<option value="${group.id}" ${group.id === selectedId ? 'selected' : ''}>${escapeHtml(group.title)}</option>`).join('');
  }

  function renderLibrary(editable) {
    if (!store.prayers.length) return '<p class="empty-library">No personal prayers have been added yet.</p>';
    return store.prayers.map((prayer) => {
      const group = data.groups.find((item) => item.id === prayer.groupId);
      return `<article class="custom-item">
        <h3>${escapeHtml(prayer.title)}</h3>
        <p>${escapeHtml(group?.title || 'Uncategorized')}${prayer.occasion ? ` · ${escapeHtml(prayer.occasion)}` : ''}</p>
        <div class="item-actions">
          <a href="#${prayer.id}">Open</a>
          ${editable ? `<a href="#manage/${prayer.id}">Edit</a><button class="delete-link" type="button" data-delete="${prayer.id}">Delete</button>` : ''}
        </div>
      </article>`;
    }).join('');
  }

  function syncPanel() {
    if (!syncMeta) {
      return `<section class="sync-card">
        <div><span class="sync-state local">Local only</span><h2>Use this collection on every device</h2><p>Create a private cloud collection while keeping this device’s offline copy.</p></div>
        <button class="primary-button" id="enableSync" type="button">Enable cloud sync</button>
      </section>`;
    }
    const readerUrl = shareUrl('view');
    const editorUrl = shareUrl('edit');
    const status = syncMeta.pending ? 'Waiting to sync' : 'Cloud synchronized';
    return `<section class="sync-card">
      <div>
        <span class="sync-state ${syncMeta.pending ? 'pending' : 'synced'}">${status}</span>
        <h2>${canEdit() ? 'Cloud collection' : 'Shared collection'}</h2>
        <p>${lastSyncMessage || (canEdit() ? 'Changes are available across your devices.' : 'This is a read-only family copy.')}</p>
      </div>
      <div class="sync-actions">
        <button class="secondary-button" id="syncNow" type="button">Sync now</button>
        ${readerUrl ? '<button class="secondary-button" id="copyReaderLink" type="button">Copy reader link</button>' : ''}
        ${editorUrl ? '<button class="secondary-button" id="copyEditorLink" type="button">Copy private editor link</button>' : ''}
        <button class="secondary-button" id="disconnectSync" type="button">Keep offline copy only</button>
      </div>
      ${conflict ? `<div class="sync-conflict" role="alert"><strong>Two devices changed this collection.</strong><span>Choose the version that should become the cloud copy.</span><div><button class="primary-button" id="keepDeviceCopy" type="button">Keep this device</button><button class="secondary-button" id="useCloudCopy" type="button">Use cloud copy</button></div></div>` : ''}
      <p class="share-warning">Keep the private editor link confidential. Anyone with it can change this collection.</p>
      <p class="import-status" id="syncStatus" role="status"></p>
    </section>`;
  }

  function editorForm(editing, preselectedGroup) {
    return `<form class="editor-card" id="prayerForm">
      <h2>${editing ? 'Update this prayer' : 'Add a prayer or blessing'}</h2>
      <p class="form-intro">Required fields are marked with an asterisk.</p>
      <input type="hidden" name="id" value="${escapeHtml(editing?.id || '')}" />
      <div class="field-grid">
        <div class="field full"><label for="prayerTitle">Title *</label><input id="prayerTitle" name="title" required maxlength="140" value="${escapeHtml(editing?.title || '')}" /></div>
        <div class="field"><label for="prayerSection">Section *</label><select id="prayerSection" name="groupId" required>${sectionOptions(preselectedGroup)}<option value="__new__">Create a new section…</option></select></div>
        <div class="field"><label for="prayerOccasion">Occasion</label><input id="prayerOccasion" name="occasion" maxlength="160" placeholder="Shabbat, morning, illness…" value="${escapeHtml(editing?.occasion || '')}" /></div>
        <div class="new-section-fields" id="newSectionFields" hidden><div class="field-grid">
          <div class="field"><label for="newSectionTitle">New section title *</label><input id="newSectionTitle" name="newSectionTitle" maxlength="100" /></div>
          <div class="field"><label for="newSectionHebrew">Hebrew label</label><input id="newSectionHebrew" name="newSectionHebrew" dir="auto" maxlength="100" /></div>
          <div class="field full"><label for="newSectionDescription">Section description</label><input id="newSectionDescription" name="newSectionDescription" maxlength="220" placeholder="A short description for the table of contents" /></div>
        </div></div>
        <div class="field"><label for="prayerPurpose">Purpose</label><input id="prayerPurpose" name="purpose" maxlength="180" placeholder="Gratitude, healing, remembrance…" value="${escapeHtml(editing?.purpose || '')}" /></div>
        <div class="field"><label for="prayerSource">Source or tradition</label><input id="prayerSource" name="sourceTradition" maxlength="180" placeholder="Traditional, original, scripture reference…" value="${escapeHtml(editing?.sourceTradition || '')}" /></div>
        <div class="field full"><label for="prayerLanguage">Language or transliteration</label><input id="prayerLanguage" name="language" maxlength="120" placeholder="English, Hebrew, transliteration…" value="${escapeHtml(editing?.language || '')}" /></div>
        <div class="field full"><label for="prayerText">Prayer or blessing text *</label><textarea id="prayerText" name="text" required spellcheck="true" placeholder="Enter the complete text here…">${escapeHtml(editing?.text || '')}</textarea><small>Line breaks, punctuation, spelling, and wording are preserved exactly as entered.</small></div>
        <div class="field full"><label for="prayerNotes">Notes or instructions</label><textarea class="notes-input" id="prayerNotes" name="notes" placeholder="Optional context, directions, or personal notes…">${escapeHtml(editing?.notes || '')}</textarea></div>
      </div>
      <div class="form-actions"><button class="primary-button" type="submit">${editing ? 'Save changes' : 'Add to prayer book'}</button>${editing ? '<a class="secondary-button" href="#manage">Cancel</a>' : ''}</div>
      <p class="saved-note">Text is stored exactly as entered and is never sent to an AI service.</p>
    </form>`;
  }

  function bindSyncControls(view) {
    const status = view.querySelector('#syncStatus');
    view.querySelector('#enableSync')?.addEventListener('click', async () => {
      const button = view.querySelector('#enableSync');
      button.disabled = true;
      button.textContent = 'Creating…';
      try {
        await createCloudCollection();
        render();
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Enable cloud sync';
        const localStatus = view.querySelector('.sync-card p');
        localStatus.textContent = error.message;
      }
    });
    view.querySelector('#syncNow')?.addEventListener('click', async () => {
      status.textContent = 'Synchronizing…';
      try {
        if (syncMeta.pending && syncMeta.editToken) await pushRemote();
        else await pullRemote();
        if (conflict) render();
        else {
          status.textContent = 'Synchronization complete.';
          setTimeout(() => location.reload(), 450);
        }
      } catch (error) {
        status.textContent = error.message;
      }
    });
    view.querySelector('#copyReaderLink')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(shareUrl('view'));
      status.textContent = 'Reader link copied.';
    });
    view.querySelector('#copyEditorLink')?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(shareUrl('edit'));
      status.textContent = 'Private editor link copied.';
    });
    view.querySelector('#disconnectSync')?.addEventListener('click', () => {
      if (!confirm('Keep this device’s offline copy and disconnect it from cloud synchronization?')) return;
      syncMeta = null;
      conflict = null;
      saveSyncMeta();
      location.reload();
    });
    view.querySelector('#keepDeviceCopy')?.addEventListener('click', async () => {
      status.textContent = 'Saving this device as the cloud copy…';
      try {
        syncMeta.revision = conflict.revision;
        await pushRemote(true);
        location.reload();
      } catch (error) {
        status.textContent = error.message;
      }
    });
    view.querySelector('#useCloudCopy')?.addEventListener('click', () => {
      store = conflict.data;
      saveStore();
      syncMeta.revision = conflict.revision;
      syncMeta.pending = false;
      saveSyncMeta();
      conflict = null;
      location.reload();
    });
  }

  function render(target = '') {
    const view = document.querySelector('#manageView');
    const editable = canEdit();
    const editing = editable ? store.prayers.find((prayer) => prayer.id === target) : null;
    const preselectedGroup = editing?.groupId || (data.groups.some((group) => group.id === target) ? target : data.groups[0]?.id || '');
    view.innerHTML = `<div class="manage-shell">
      <header class="manage-header"><div><div class="home-ornament" aria-hidden="true"><span></span>✦<span></span></div><p class="eyebrow">Your collection</p><h1>${editing ? 'Edit Prayer' : editable ? 'Manage Prayers' : 'Shared Prayer Book'}</h1><p>${editable ? 'Add a prayer or blessing exactly as you want it to appear. Changes remain available offline.' : 'This collection was shared with you as a read-only prayer book.'}</p></div>
        <div><div class="backup-actions"><button class="secondary-button" id="exportCollection" type="button">Export backup</button>${editable ? '<button class="secondary-button" id="importCollection" type="button">Import backup</button><input id="importFile" type="file" accept="application/json,.json" hidden />' : ''}</div><p class="import-status" id="importStatus" role="status"></p></div>
      </header>
      ${syncPanel()}
      <div class="manage-layout ${editable ? '' : 'read-only-layout'}">
        ${editable ? editorForm(editing, preselectedGroup) : ''}
        <section class="library-card"><h2>${editable ? 'Your added prayers' : 'Prayers in this collection'}</h2><p class="library-intro">${editable ? 'Open, edit, or remove prayers you have added.' : 'Open any prayer to read it.'}</p><div class="custom-library">${renderLibrary(editable)}</div></section>
      </div>
    </div>`;

    bindSyncControls(view);
    const form = view.querySelector('#prayerForm');
    if (form) {
      const sectionSelect = view.querySelector('#prayerSection');
      const newFields = view.querySelector('#newSectionFields');
      const newTitle = view.querySelector('#newSectionTitle');
      const toggleNewSection = () => {
        const isNew = sectionSelect.value === '__new__';
        newFields.hidden = !isNew;
        newTitle.required = isNew;
      };
      sectionSelect.addEventListener('change', toggleNewSection);
      toggleNewSection();
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = 'Saving…';
        const values = Object.fromEntries(new FormData(form));
        let groupId = values.groupId;
        if (groupId === '__new__') {
          groupId = safeId('section', values.newSectionTitle);
          store.sections.push({ id: groupId, title: values.newSectionTitle.trim(), hebrew: values.newSectionHebrew.trim() || '✦', description: values.newSectionDescription.trim() || 'A personal collection of prayers and blessings.' });
        }
        const now = new Date().toISOString();
        const record = { id: values.id || safeId('prayer', values.title), title: values.title.trim(), groupId, purpose: values.purpose.trim(), occasion: values.occasion.trim(), sourceTradition: values.sourceTradition.trim(), language: values.language.trim(), text: values.text, notes: values.notes, createdAt: editing?.createdAt || now, updatedAt: now };
        const existingIndex = store.prayers.findIndex((prayer) => prayer.id === record.id);
        if (existingIndex >= 0) store.prayers[existingIndex] = record;
        else store.prayers.push(record);
        saveStore();
        markPending();
        try { await pushRemote(); } catch { /* The offline copy is authoritative until retry. */ }
        location.hash = record.id;
        location.reload();
      });
    }

    view.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async () => {
      const prayer = store.prayers.find((item) => item.id === button.dataset.delete);
      if (!prayer || !confirm(`Delete “${prayer.title}”? This cannot be undone unless it is in an exported backup.`)) return;
      store.prayers = store.prayers.filter((item) => item.id !== prayer.id);
      store.sections = store.sections.filter((section) => section.id !== prayer.groupId || store.prayers.some((item) => item.groupId === section.id));
      saveStore();
      markPending();
      try { await pushRemote(); } catch { /* Retry when online. */ }
      location.hash = 'manage';
      location.reload();
    }));

    view.querySelector('#exportCollection').addEventListener('click', () => {
      const payload = { format: 'personal-prayer-book', exportedAt: new Date().toISOString(), data: store };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `prayer-book-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });

    const fileInput = view.querySelector('#importFile');
    view.querySelector('#importCollection')?.addEventListener('click', () => fileInput.click());
    fileInput?.addEventListener('change', async () => {
      const status = view.querySelector('#importStatus');
      try {
        const parsed = JSON.parse(await fileInput.files[0].text());
        const incoming = parsed.data || parsed;
        if (!Array.isArray(incoming.sections) || !Array.isArray(incoming.prayers)) throw new Error('invalid');
        const sections = new Map([...store.sections, ...incoming.sections].map((item) => [item.id, item]));
        const prayers = new Map([...store.prayers, ...incoming.prayers].map((item) => [item.id, item]));
        store = { version: 1, sections: [...sections.values()], prayers: [...prayers.values()] };
        saveStore();
        markPending();
        try { await pushRemote(); } catch { /* Retry when online. */ }
        status.textContent = `Imported ${incoming.prayers.length} prayer${incoming.prayers.length === 1 ? '' : 's'}.`;
        setTimeout(() => location.reload(), 650);
      } catch {
        status.textContent = 'That file is not a valid prayer book backup.';
      }
    });
  }

  window.addEventListener('online', async () => {
    try {
      const changed = syncMeta?.pending && syncMeta.editToken ? await pushRemote() : await pullRemote();
      if (changed) location.reload();
    } catch { /* Keep the offline copy. */ }
  });

  window.SIDDUR_MANAGER = { render, ready, canEdit };
})();
