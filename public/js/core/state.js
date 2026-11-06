/* js/core/state.js — Global store S plus the edit()/commit()/refresh() mutation helpers.
 * State: owns every field of S (conn, models, limits, options, source, parts, selectedId, results, ui)
 * Gotchas: edit() is for undoable part changes; after changing settings directly call commit().
 *          refresh() only re-renders; it never persists.
 *
 * @auto-deps-begin
 * Defines: S, _subscribers, commit, edit, refresh, resetProject, selectPart, subscribe
 * Uses: clearHistory, pushHistory, scheduleSave
 * @auto-deps-end
 */
const S = {
  conn: { baseUrl: '', apiKey: '', mode: 'proxy', status: 'idle', message: '' },
  models: { all: [], custom: [], vision: [], image: [], visionId: '', imageId: '', overrides: {} },
  limits: {
    vision: { rpm: 10, concurrency: 1, minDelayMs: 500, retries: 3 },
    image: { rpm: 4, concurrency: 1, minDelayMs: 2000, retries: 3 }
  },
  options: { padding: 4, inpaint: false, watermark: false, promptExtend: false, charPrompt: '', showAllModels: false },
  source: { dataUrl: '', width: 0, height: 0, name: '' },
  parts: [],
  selectedId: null,
  results: { partImages: {}, stamp: 0 },
  ui: { step: 1, busy: '', tests: { conn: null, vision: null, image: null } }
};

const _subscribers = [];

function subscribe(fn) {
  _subscribers.push(fn);
}

function refresh() {
  _subscribers.forEach((fn) => {
    try { fn(S); } catch (err) { console.error('refresh subscriber failed', err); }
  });
}

function commit() {
  scheduleSave();
  refresh();
}

function edit(mutator, label) {
  pushHistory(label || 'edit');
  mutator(S);
  commit();
}

function selectPart(id) {
  S.selectedId = id;
  refresh();
}

function resetProject() {
  S.source = { dataUrl: '', width: 0, height: 0, name: '' };
  S.parts = [];
  S.selectedId = null;
  S.results = { partImages: {}, stamp: 0 };
  clearHistory();
}
