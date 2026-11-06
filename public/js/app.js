/* js/app.js — Bootstrap: load saved settings, build panels, wire refresh, restore the last session, keyboard shortcuts.
 * State: reads/writes S.ui.step on startup; everything else is delegated to the panel and core modules
 * Gotchas: this file must stay last in index.html. The restored session is only shown after the saved image has
 *          been loaded; if the user had parts/slices, step 3 or 2 opens directly.
 *
 * @auto-deps-begin
 * Defines: bootstrap, isTyping, onKeyDown, syncAll
 * Uses: S, buildConnectPanel, buildEditPanel, buildExportPanel, buildShell, loadSession,
 *   loadSettings, redo, refresh, removePart, subscribe, syncConnectPanel, syncEditPanel,
 *   syncExportPanel, syncShell, undo
 * @auto-deps-end
 */
function syncAll() {
  syncShell();
  syncConnectPanel();
  syncEditPanel();
  syncExportPanel();
}

function isTyping(target) {
  return !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
}

function onKeyDown(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !isTyping(e.target) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  } else if (mod && !isTyping(e.target) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && S.ui.step === 2 && S.selectedId && !isTyping(e.target)) {
    e.preventDefault();
    removePart(S.selectedId);
  }
}

async function bootstrap() {
  loadSettings();
  buildShell();
  buildConnectPanel();
  buildEditPanel();
  buildExportPanel();
  subscribe(syncAll);
  document.addEventListener('keydown', onKeyDown);
  const restored = await loadSession();
  if (restored) {
    S.ui.step = Object.keys(S.results.partImages).length ? 3 : 2;
  } else if (S.models.visionId || S.conn.baseUrl) {
    S.ui.step = 1;
  }
  refresh();
}

document.addEventListener('DOMContentLoaded', bootstrap);
