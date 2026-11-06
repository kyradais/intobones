/* js/model/serialize.js — Project file (.json) save/load with version migration.
 * State: reads S.source/parts/options/results; deserializeProject() replaces them and clears undo history
 * Gotchas: bump PROJECT_VERSION and add a branch in migrateProject() whenever a persistent field changes.
 *          v1 stored boxes as part.box; v2 uses part.bbox. Old files must keep loading.
 *
 * @auto-deps-begin
 * Defines: PROJECT_VERSION, deserializeProject, migrateProject, serializeProject
 * Uses: S, clearHistory, commit, validateParts
 * @auto-deps-end
 */
const PROJECT_VERSION = 2;

function serializeProject() {
  return {
    app: 'intobones',
    version: PROJECT_VERSION,
    source: S.source,
    parts: S.parts,
    options: S.options,
    results: S.results
  };
}

function migrateProject(input) {
  const obj = JSON.parse(JSON.stringify(input));
  let version = Number(obj.version) || 1;
  if (version < 2) {
    (obj.parts || []).forEach((p) => {
      if (p.box && !p.bbox) { p.bbox = p.box; delete p.box; }
    });
    version = 2;
  }
  obj.version = version;
  return obj;
}

function deserializeProject(json) {
  const obj = migrateProject(typeof json === 'string' ? JSON.parse(json) : json);
  if (obj.app && obj.app !== 'intobones') throw new Error('This file is not an Intobones project.');
  const source = Object.assign({ dataUrl: '', width: 0, height: 0, name: '' }, obj.source);
  S.source = source;
  S.parts = source.width ? validateParts(obj.parts || [], source.width, source.height) : (obj.parts || []);
  S.options = Object.assign({}, S.options, obj.options || {});
  S.results = Object.assign({ partImages: {}, stamp: 0 }, obj.results || {});
  S.selectedId = null;
  clearHistory();
  commit();
}
