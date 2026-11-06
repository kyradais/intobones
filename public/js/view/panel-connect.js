/* js/view/panel-connect.js — Step 1: connection + Test connection, model pickers, manual models, rate limits, options.
 * State: reads/writes S.conn, S.models (visionId, imageId, overrides, custom), S.limits, S.options; reads S.ui.tests
 * Gotchas: inputs write straight into S and call commit() on "change". syncConnectPanel() skips any control that has
 *          focus so typing is never overwritten. The model lists are rebuilt only when their contents change.
 *
 * @auto-deps-begin
 * Defines: _pc, addManualModel, buildConnectPanel, confirmClear, connectAndDiscover, field,
 *   fillSelect, limitsBlock, modelBlock, numberInput, showQueue, syncChip, syncClassifyList,
 *   syncConnectPanel, syncManualList
 * Uses: $, Limiters, S, addCustomModel, allModels, clamp, clearAllData, commit, describeError,
 *   discoverModels, goStep, h, normalizeBase, removeCustomModel, setHidden, setModelKind,
 *   setShowAllModels, testConnection, testImageModel, testVisionModel, toast, withBusy
 * @auto-deps-end
 */
const _pc = { listSig: '' };

function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), control, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function numberInput(role, key, min, max) {
  return h('input', {
    type: 'number', min, max, step: 1, value: S.limits[role][key], 'data-role': role, 'data-key': key,
    onchange: (e) => {
      const n = clamp(Math.round(Number(e.target.value) || 0), min, max);
      S.limits[role][key] = n;
      e.target.value = n;
      commit();
    }
  });
}

function limitsBlock(role, title) {
  return h('div', { class: 'limit-block' },
    h('div', { class: 'limit-head' }, h('h4', null, title), h('span', { class: 'queue', id: 'queue-' + role }, 'idle')),
    field('Requests per minute', numberInput(role, 'rpm', 1, 600)),
    field('Parallel requests', numberInput(role, 'concurrency', 1, 8)),
    field('Minimum delay (ms)', numberInput(role, 'minDelayMs', 0, 60000)),
    field('Retries on 429/5xx', numberInput(role, 'retries', 0, 8)));
}

function modelBlock(role, title, hint, test) {
  return h('div', { class: 'model-block' },
    field(title, h('select', {
      id: 'sel-' + role,
      onchange: (e) => { S.models[role + 'Id'] = e.target.value; S.ui.tests[role] = null; commit(); }
    }), hint),
    h('div', { class: 'test-row' },
      h('button', { type: 'button', class: 'btn ghost', id: 'test-' + role, onclick: test }, 'Test ' + role + ' model'),
      h('span', { class: 'chip', id: 'chip-' + role }, 'not tested')));
}

function buildConnectPanel() {
  const root = $('#panel-connect');
  const keyInput = h('input', {
    type: 'password', id: 'in-key', autocomplete: 'off', spellcheck: 'false', placeholder: 'sk-…',
    onchange: (e) => { S.conn.apiKey = e.target.value.trim(); commit(); }
  });
  root.replaceChildren(
    h('div', { class: 'grid-2' },
      h('section', { class: 'card' },
        h('h2', null, 'Connection'),
        field('Base URL', h('input', {
          type: 'text', id: 'in-base', spellcheck: 'false', placeholder: 'http://localhost:20128/v1',
          onchange: (e) => { S.conn.baseUrl = normalizeBase(e.target.value); commit(); }
        }), 'Your 9router endpoint. If it ends without /v1 and /models is not found, /v1 is tried automatically.'),
        field('API key', h('div', { class: 'key-row' }, keyInput,
          h('button', { type: 'button', class: 'btn ghost small', onclick: (e) => {
            const show = keyInput.type === 'password';
            keyInput.type = show ? 'text' : 'password';
            e.target.textContent = show ? 'Hide' : 'Show';
          } }, 'Show')), 'Saved in this browser only, as plain text.'),
        field('Request route', h('select', {
          id: 'in-mode',
          onchange: (e) => { S.conn.mode = e.target.value; commit(); }
        }, h('option', { value: 'proxy' }, 'Through the local proxy (no CORS problems)'), h('option', { value: 'direct' }, 'Direct from the browser (needs CORS on the API)'))),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn primary', id: 'btn-connect', onclick: connectAndDiscover }, 'Connect and find models'),
          h('button', { type: 'button', class: 'btn ghost', id: 'test-conn', onclick: testConnection }, 'Test connection'),
          h('span', { class: 'status', id: 'conn-status' }, 'Not connected')),
        h('span', { class: 'chip', id: 'chip-conn', hidden: true }, '')),
      h('section', { class: 'card' },
        h('h2', null, 'Models'),
        modelBlock('vision', 'Vision model', 'Reads the character and finds the body parts.', testVisionModel),
        modelBlock('image', 'Image model', 'Generates characters and completes hidden areas (both optional).', testImageModel),
        h('div', { class: 'model-block' },
          h('span', { class: 'field-label' }, 'Add a model by hand'),
          h('div', { class: 'manual-row' },
            h('input', { type: 'text', id: 'in-manual', spellcheck: 'false', placeholder: 'cf/@cf/black-forest-labs/flux-1-schnell', onkeydown: (e) => { if (e.key === 'Enter') addManualModel(); } }),
            h('select', { id: 'sel-manual-kind', 'aria-label': 'Model type' }, h('option', { value: 'image' }, 'Image'), h('option', { value: 'vision' }, 'Vision')),
            h('button', { type: 'button', class: 'btn ghost', id: 'btn-manual', onclick: addManualModel }, 'Add')),
          h('span', { class: 'field-hint' }, 'Use the exact id your 9router expects. The model is selected right away, and kept when you reconnect.'),
          h('div', { class: 'manual-list', id: 'manual-list' })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-showall', onchange: (e) => setShowAllModels(e.target.checked) }), 'Show every model in both lists'),
        h('details', { class: 'classify' }, h('summary', null, 'A model is in the wrong list?'), h('div', { id: 'classify-list', class: 'classify-list' })))),
    h('section', { class: 'card' },
      h('h2', null, 'Generation rate'),
      h('p', { class: 'muted' }, 'Keeps a model from running out of quota. Each model type has its own queue.'),
      h('div', { class: 'grid-2' }, limitsBlock('vision', 'Vision model'), limitsBlock('image', 'Image model')),
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { Limiters.vision.cancelAll(); Limiters.image.cancelAll(); } }, 'Cancel queued requests'))),
    h('section', { class: 'card' },
      h('h2', null, 'Request options'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-watermark', onchange: (e) => { S.options.watermark = e.target.checked; commit(); } }), 'Ask the API to add a watermark'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-extend', onchange: (e) => { S.options.promptExtend = e.target.checked; commit(); } }), 'Let the API rewrite my prompts (prompt_extend)')),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn danger ghost', onclick: confirmClear }, 'Clear saved data'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => goStep(2) }, 'Continue to the image')));
  Limiters.vision.onChange((st) => showQueue('vision', st));
  Limiters.image.onChange((st) => showQueue('image', st));
}

function connectAndDiscover() {
  return withBusy('Connecting', async () => {
    await discoverModels();
    toast(S.conn.message, 'ok');
  });
}

function addManualModel() {
  const input = $('#in-manual');
  try {
    const id = addCustomModel(input.value, $('#sel-manual-kind').value);
    input.value = '';
    toast('Added ' + id, 'ok');
  } catch (err) {
    toast(describeError(err), 'error');
  }
}

function syncManualList() {
  $('#manual-list').replaceChildren(...S.models.custom.map((c) => h('span', { class: 'chip', title: c.kind + ' model' },
    c.kind + ': ' + c.id,
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove ' + c.id, onclick: () => removeCustomModel(c.id) }, '×'))));
}

function confirmClear() {
  if (window.confirm('Remove the saved API key, settings and last image from this browser?')) clearAllData();
}

function showQueue(role, st) {
  const el = $('#queue-' + role);
  if (!el) return;
  el.textContent = st.active || st.pending ? st.active + ' running, ' + st.pending + ' queued' : 'idle';
  el.classList.toggle('live', !!(st.active || st.pending));
}

function fillSelect(sel, ids, value) {
  sel.replaceChildren(...(ids.length ? ids : ['']).map((id) => h('option', { value: id }, id || 'No models found')));
  sel.value = value;
}

function syncClassifyList() {
  const box = $('#classify-list');
  box.replaceChildren(...allModels().map((m) => h('label', { class: 'classify-row' },
    h('span', null, m.id),
    h('select', { value: S.models.overrides[m.id] || 'auto', onchange: (e) => setModelKind(m.id, e.target.value) },
      h('option', { value: 'auto' }, 'Auto (' + m.kind + ')'), h('option', { value: 'vision' }, 'Vision'),
      h('option', { value: 'image' }, 'Image'), h('option', { value: 'other' }, 'Hide')))));
}

function syncChip(role) {
  const t = S.ui.tests[role];
  const chip = $('#chip-' + role);
  const labels = {
    running: 'testing…',
    ok: t && (role === 'conn' ? 'works (' + t.ms + ' ms): ' + t.message : 'works (' + t.ms + ' ms)'),
    warn: t && t.message,
    fail: t && 'failed: ' + t.message
  };
  chip.textContent = t ? labels[t.state] : 'not tested';
  chip.className = 'chip ' + (t ? t.state : '');
  if (role === 'conn') setHidden(chip, !t);
  $('#test-' + role).disabled = !!(t && t.state === 'running');
}

function syncConnectPanel() {
  const active = document.activeElement;
  const set = (el, val) => { if (el !== active) el.value = val; };
  set($('#in-base'), S.conn.baseUrl);
  set($('#in-key'), S.conn.apiKey);
  set($('#in-mode'), S.conn.mode);
  const st = $('#conn-status');
  st.textContent = S.conn.message || 'Not connected';
  st.className = 'status ' + S.conn.status;
  const sig = JSON.stringify([allModels().map((m) => m.id + m.kind), S.models.vision.length, S.models.image.length, S.models.visionId, S.models.imageId, S.options.showAllModels]);
  if (sig !== _pc.listSig) {
    _pc.listSig = sig;
    fillSelect($('#sel-vision'), S.models.vision, S.models.visionId);
    fillSelect($('#sel-image'), S.models.image, S.models.imageId);
    syncClassifyList();
    syncManualList();
  }
  syncChip('conn');
  syncChip('vision');
  syncChip('image');
  $('#opt-showall').checked = !!S.options.showAllModels;
  $('#opt-watermark').checked = !!S.options.watermark;
  $('#opt-extend').checked = !!S.options.promptExtend;
  showQueue('vision', Limiters.vision.status());
  showQueue('image', Limiters.image.status());
}
