/* js/core/history.js — Undo/redo stacks for body-part edits (snapshots of S.parts).
 * State: reads and replaces S.parts, resets S.selectedId when the selected part disappears
 * Gotchas: only S.parts is versioned; slices and settings are not. pushHistory() clears the redo stack.
 *
 * @auto-deps-begin
 * Defines: _hist, canRedo, canUndo, clearHistory, pushHistory, redo, restoreParts, snapshotParts,
 *   undo
 * Uses: S, commit
 * @auto-deps-end
 */
const _hist = { undo: [], redo: [], max: 60 };

function snapshotParts() {
  return JSON.stringify(S.parts);
}

function pushHistory(label) {
  _hist.undo.push({ label: label || 'edit', parts: snapshotParts() });
  if (_hist.undo.length > _hist.max) _hist.undo.shift();
  _hist.redo.length = 0;
}

function restoreParts(json) {
  S.parts = JSON.parse(json);
  if (S.selectedId && !S.parts.some((p) => p.id === S.selectedId)) S.selectedId = null;
}

function undo() {
  const entry = _hist.undo.pop();
  if (!entry) return false;
  _hist.redo.push({ label: entry.label, parts: snapshotParts() });
  restoreParts(entry.parts);
  commit();
  return true;
}

function redo() {
  const entry = _hist.redo.pop();
  if (!entry) return false;
  _hist.undo.push({ label: entry.label, parts: snapshotParts() });
  restoreParts(entry.parts);
  commit();
  return true;
}

function canUndo() {
  return _hist.undo.length > 0;
}

function canRedo() {
  return _hist.redo.length > 0;
}

function clearHistory() {
  _hist.undo.length = 0;
  _hist.redo.length = 0;
}
