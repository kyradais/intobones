/* js/core/storage.js — Browser persistence: settings in localStorage, last session (image + parts + slices) in IndexedDB.
 * State: reads S.conn/models/limits/options; writes them back on load; loads S.source/parts/results from the session
 * Gotchas: the API key is stored in plain text in this browser. IndexedDB may be missing (tests, private mode);
 *          every call then falls back to an in-memory Map and never throws.
 *
 * @auto-deps-begin
 * Defines: IDB_NAME, IDB_STORE, SETTINGS_KEY, _mem, _saveTimer, clearAllData, idbClear, idbGet,
 *   idbOpen, idbPut, idbRun, loadSession, loadSettings, saveSession, saveSettings, scheduleSave,
 *   settingsSnapshot
 * Uses: S, refresh, resetProject
 * @auto-deps-end
 */
const SETTINGS_KEY = 'intobones.settings.v1';
const IDB_NAME = 'intobones';
const IDB_STORE = 'kv';
const _mem = new Map();
let _saveTimer = null;

function settingsSnapshot() {
  return {
    conn: { baseUrl: S.conn.baseUrl, apiKey: S.conn.apiKey, mode: S.conn.mode },
    models: { visionId: S.models.visionId, imageId: S.models.imageId, overrides: S.models.overrides, custom: S.models.custom },
    limits: S.limits,
    options: S.options
  };
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settingsSnapshot())); } catch (err) { /* storage full or blocked */ }
}

function loadSettings() {
  let data;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (err) {
    return false;
  }
  Object.assign(S.conn, data.conn || {});
  Object.assign(S.models, data.models || {});
  ['vision', 'image'].forEach((role) => Object.assign(S.limits[role], (data.limits || {})[role] || {}));
  Object.assign(S.options, data.options || {});
  return true;
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRun(mode, action) {
  return idbOpen().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = action(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  }));
}

async function idbPut(key, value) {
  _mem.set(key, value);
  try { await idbRun('readwrite', (store) => store.put(value, key)); } catch (err) { /* memory fallback already set */ }
}

async function idbGet(key) {
  try {
    const value = await idbRun('readonly', (store) => store.get(key));
    return value === undefined ? _mem.get(key) : value;
  } catch (err) {
    return _mem.get(key);
  }
}

async function idbClear() {
  _mem.clear();
  try { await idbRun('readwrite', (store) => store.clear()); } catch (err) { /* nothing to clear */ }
}

async function saveSession() {
  if (!S.source.dataUrl) return idbPut('session', null);
  return idbPut('session', { source: S.source, parts: S.parts, results: S.results });
}

async function loadSession() {
  const data = await idbGet('session');
  if (!data || !data.source || !data.source.dataUrl) return false;
  S.source = data.source;
  S.parts = data.parts || [];
  S.results = Object.assign({ partImages: {}, stamp: 0 }, data.results);
  S.selectedId = null;
  return true;
}

function scheduleSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    saveSettings();
    saveSession();
  }, 400);
}

async function clearAllData() {
  clearTimeout(_saveTimer);
  try { localStorage.removeItem(SETTINGS_KEY); } catch (err) { /* ignore */ }
  await idbClear();
  resetProject();
  S.conn.baseUrl = '';
  S.conn.apiKey = '';
  S.conn.status = 'idle';
  S.models = { all: [], custom: [], vision: [], image: [], visionId: '', imageId: '', overrides: {} };
  S.ui.tests = { conn: null, vision: null, image: null };
  refresh();
}
