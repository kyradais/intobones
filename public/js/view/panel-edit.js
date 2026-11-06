/* js/view/panel-edit.js — Step 2: image input (upload, drop, paste, generate), analysis, part list and canvas editor.
 * State: reads/writes S.options (padding, inpaint, charPrompt), S.parts via edit(); reads S.source, S.selectedId, S.ui.busy
 * Gotchas: the part list is rebuilt on refresh unless a text field inside it has focus. Renames use "change", not
 *          "input", so a rebuild never interrupts typing. Part ids never change after creation (parents point to them).
 *
 * @auto-deps-begin
 * Defines: buildEditPanel, initDropAndPaste, partRow, syncEditPanel
 * Uses: $, S, addPart, analyzeSource, canRedo, canUndo, clamp, commit, edit, field,
 *   generateCharacter, h, initEditor, loadSourceFile, partColor, redo, removePart, selectPart,
 *   setHidden, sliceParts, syncEditorImage, undo
 * @auto-deps-end
 */
function buildEditPanel() {
  const root = $('#panel-edit');
  const fileInput = h('input', { type: 'file', accept: 'image/*', id: 'in-file', hidden: true, onchange: (e) => { loadSourceFile(e.target.files[0]); e.target.value = ''; } });
  const stage = h('div', { class: 'stage', id: 'stage' },
    h('canvas', { id: 'editor', 'aria-label': 'Character with body part boxes' }),
    h('div', { class: 'dropzone', id: 'dropzone' },
      h('strong', null, 'Drop a character image here'),
      h('span', null, 'or paste it, or choose a file. A full-body character facing the camera works best.'),
      h('button', { type: 'button', class: 'btn primary', onclick: () => fileInput.click() }, 'Choose image')));
  root.replaceChildren(h('div', { class: 'editor-layout' },
    h('div', { class: 'stage-col' }, stage,
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn ghost small', id: 'btn-undo', onclick: undo }, 'Undo'),
        h('button', { type: 'button', class: 'btn ghost small', id: 'btn-redo', onclick: redo }, 'Redo'),
        h('span', { class: 'muted', id: 'src-info' }, ''))),
    h('div', { class: 'side-col' },
      h('section', { class: 'card' },
        h('h3', null, 'Image'),
        fileInput,
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => fileInput.click() }, 'Upload image')),
        field('Or describe a character', h('textarea', {
          id: 'in-charprompt', rows: 3, placeholder: 'A knight with a red scarf, flat colors, side-scroller style',
          onchange: (e) => { S.options.charPrompt = e.target.value; commit(); }
        }), 'Uses the image model. Optional.'),
        h('button', { type: 'button', class: 'btn ghost', id: 'btn-generate', onclick: generateCharacter }, 'Generate character')),
      h('section', { class: 'card' },
        h('h3', null, 'Body parts'),
        h('button', { type: 'button', class: 'btn primary', id: 'btn-analyze', onclick: analyzeSource }, 'Find body parts with the vision model'),
        h('div', { class: 'parts', id: 'parts-list' }),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost small', id: 'btn-add', onclick: addPart }, 'Add part'))),
      h('section', { class: 'card' },
        h('h3', null, 'Slice'),
        field('Padding around each part (px)', h('input', {
          type: 'number', id: 'in-padding', min: 0, max: 64, step: 1,
          onchange: (e) => { S.options.padding = clamp(Math.round(Number(e.target.value) || 0), 0, 64); commit(); }
        })),
        h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'opt-inpaint', onchange: (e) => { S.options.inpaint = e.target.checked; commit(); } }), 'Complete hidden areas with the image model'),
        h('button', { type: 'button', class: 'btn primary', id: 'btn-slice', onclick: sliceParts }, 'Slice parts and continue')))));
  initEditor($('#editor'));
  initDropAndPaste($('#stage'));
}

function initDropAndPaste(stage) {
  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('over'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('over'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    stage.classList.remove('over');
    if (e.dataTransfer.files[0]) loadSourceFile(e.dataTransfer.files[0]);
  });
  document.addEventListener('paste', (e) => {
    if (S.ui.step !== 2 || !e.clipboardData) return;
    const item = Array.from(e.clipboardData.items || []).find((it) => it.type.startsWith('image/'));
    if (item) loadSourceFile(item.getAsFile());
  });
}

function partRow(part) {
  const parents = S.parts.filter((p) => p.id !== part.id);
  return h('div', { class: 'part-row' + (part.id === S.selectedId ? ' selected' : ''), 'data-id': part.id, onclick: () => selectPart(part.id) },
    h('span', { class: 'swatch', style: 'background:' + partColor(part.id) }),
    h('input', {
      type: 'text', value: part.label, 'aria-label': 'Label for ' + part.id,
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => edit(() => { part.label = e.target.value.trim() || part.id; }, 'rename')
    }),
    h('select', {
      value: part.parent || '', 'aria-label': 'Parent of ' + part.id, title: 'Parent part (bone connection)',
      onclick: (e) => e.stopPropagation(),
      onchange: (e) => edit(() => { part.parent = e.target.value || null; }, 'parent')
    }, h('option', { value: '' }, 'no parent'), parents.map((p) => h('option', { value: p.id }, p.label))),
    h('label', { class: 'check tiny', title: 'Partly hidden behind another part', onclick: (e) => e.stopPropagation() },
      h('input', { type: 'checkbox', checked: part.occluded, onchange: (e) => edit(() => { part.occluded = e.target.checked; }, 'occluded') }), 'hidden'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Delete part', 'aria-label': 'Delete ' + part.label, onclick: (e) => { e.stopPropagation(); removePart(part.id); } }, '×'));
}

function syncEditPanel() {
  const has = !!S.source.dataUrl;
  const busy = !!S.ui.busy;
  setHidden($('#dropzone'), has);
  $('#src-info').textContent = has ? S.source.name + ' — ' + S.source.width + ' × ' + S.source.height + ' px' : '';
  const list = $('#parts-list');
  const active = document.activeElement;
  const typing = list.contains(active) && active.tagName === 'INPUT' && active.type === 'text';
  if (!typing) {
    list.replaceChildren(...(S.parts.length ? S.parts.map(partRow) : [h('p', { class: 'muted' }, has ? 'No parts yet. Run the vision model, or add parts by hand.' : 'Add an image first.')]));
  }
  if (document.activeElement !== $('#in-charprompt')) $('#in-charprompt').value = S.options.charPrompt || '';
  if (document.activeElement !== $('#in-padding')) $('#in-padding').value = S.options.padding;
  $('#opt-inpaint').checked = !!S.options.inpaint;
  $('#btn-undo').disabled = !canUndo();
  $('#btn-redo').disabled = !canRedo();
  $('#btn-analyze').disabled = busy || !has || !S.models.visionId;
  $('#btn-analyze').title = S.models.visionId ? '' : 'Connect and choose a vision model in step 1';
  $('#btn-generate').disabled = busy || !S.models.imageId;
  $('#btn-generate').title = S.models.imageId ? '' : 'Connect and choose an image model in step 1';
  $('#btn-add').disabled = !has;
  $('#btn-slice').disabled = busy || !has || !S.parts.length;
  $('#opt-inpaint').disabled = !S.models.imageId;
  syncEditorImage();
}
