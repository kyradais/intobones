/* js/view/panel-export.js — Step 3: SVG preview, part thumbnails, downloads and project save/load.
 * State: reads S.parts, S.results (partImages, stamp), S.source; deserializeProject() replaces the whole project
 * Gotchas: the preview is rebuilt only when S.results.stamp or the part list changes, because the SVG embeds every
 *          image as base64 and rebuilding it on each refresh would be slow. Last results survive page reloads.
 *
 * @auto-deps-begin
 * Defines: _px, buildExportPanel, loadProjectFile, syncExportPanel, thumbCard
 * Uses: $, S, completeHiddenPart, currentSvg, describeError, deserializeProject, downloadPartPngs,
 *   downloadProject, downloadSvg, goStep, h, refresh, toast, withBusy
 * @auto-deps-end
 */
const _px = { sig: '' };

function buildExportPanel() {
  const projectInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'in-project', onchange: loadProjectFile });
  $('#panel-export').replaceChildren(
    h('div', { class: 'export-layout' },
      h('section', { class: 'card' },
        h('h2', null, 'SVG preview'),
        h('div', { class: 'checker', id: 'svg-preview' }),
        h('p', { class: 'muted', id: 'export-info' }, '')),
      h('div', { class: 'side-col' },
        h('section', { class: 'card' },
          h('h3', null, 'Download'),
          h('button', { type: 'button', class: 'btn primary', id: 'btn-dl-svg', onclick: downloadSvg }, 'Download SVG (all parts)'),
          h('button', { type: 'button', class: 'btn ghost', id: 'btn-dl-png', onclick: () => withBusy('Downloading PNGs', downloadPartPngs) }, 'Download each part as PNG'),
          h('button', { type: 'button', class: 'btn ghost', onclick: downloadProject }, 'Save project file'),
          projectInput,
          h('button', { type: 'button', class: 'btn ghost', onclick: () => projectInput.click() }, 'Open project file')),
        h('section', { class: 'card' },
          h('h3', null, 'Parts'),
          h('div', { class: 'thumbs', id: 'thumbs' })))),
    h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => goStep(2) }, 'Back to editing')));
}

async function loadProjectFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    deserializeProject(await file.text());
    S.ui.step = Object.keys(S.results.partImages).length ? 3 : 2;
    refresh();
    toast('Project loaded.', 'ok');
  } catch (err) {
    toast('Could not open the project: ' + describeError(err), 'error');
  }
}

function thumbCard(part) {
  const img = S.results.partImages[part.id];
  const canComplete = !!(img && S.models.imageId && !S.ui.busy);
  return h('figure', { class: 'thumb' },
    h('div', { class: 'checker thumb-img' }, img ? h('img', { src: img.dataUrl, alt: part.label }) : null),
    h('figcaption', null, h('strong', null, part.label), h('span', { class: 'muted' }, img ? img.w + ' × ' + img.h + (img.inpainted ? ', completed' : '') : 'not sliced')),
    h('button', {
      type: 'button', class: 'btn ghost small', disabled: !canComplete || null,
      title: 'Redraw the hidden areas of this part with the image model',
      onclick: () => completeHiddenPart(part.id)
    }, 'Complete hidden area'));
}

function syncExportPanel() {
  if (S.ui.step !== 3) return;
  const sig = [S.results.stamp, S.parts.length, S.ui.busy, S.models.imageId].join('|');
  if (sig === _px.sig) return;
  _px.sig = sig;
  const hasImages = Object.keys(S.results.partImages).length > 0;
  const preview = $('#svg-preview');
  if (hasImages) {
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(currentSvg({ showPivots: true }));
    preview.replaceChildren(h('img', { src: url, alt: 'Exported SVG preview' }));
  } else {
    preview.replaceChildren(h('p', { class: 'muted pad' }, 'Slice the parts in step 2 to see the SVG.'));
  }
  $('#export-info').textContent = S.parts.length + ' parts in one SVG. Pivots are shown here and hidden in the file.';
  $('#btn-dl-svg').disabled = !hasImages;
  $('#btn-dl-png').disabled = !hasImages;
  $('#thumbs').replaceChildren(...S.parts.map(thumbCard));
}
