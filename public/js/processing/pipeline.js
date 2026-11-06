/* js/processing/pipeline.js — User-level workflows: set source, generate, analyze, slice, complete hidden areas.
 * State: writes S.source, S.parts, S.selectedId, S.results, S.ui.busy, S.ui.step, S.options.charPrompt
 * Gotchas: every workflow goes through withBusy(), which blocks double runs, reports errors as toasts and always
 *          clears S.ui.busy. Cancelled requests (AbortError) are silent.
 *
 * @auto-deps-begin
 * Defines: addPart, analyzeSource, completeHiddenPart, generateCharacter, goStep, loadSourceFile,
 *   removePart, setSourceFromDataUrl, sliceParts, withBusy
 * Uses: S, analyzeCharacter, commit, describeError, edit, fileToDataUrl, generateImage,
 *   inpaintOccluded, inpaintPart, loadImage, newPart, refresh, resetProject, sliceAll, toast
 * @auto-deps-end
 */
async function withBusy(label, task) {
  if (S.ui.busy) {
    toast('Wait for "' + S.ui.busy + '" to finish.', 'info');
    return undefined;
  }
  S.ui.busy = label;
  refresh();
  try {
    return await task();
  } catch (err) {
    if (!err || err.name !== 'AbortError') toast(describeError(err), 'error');
    return undefined;
  } finally {
    S.ui.busy = '';
    refresh();
  }
}

async function setSourceFromDataUrl(dataUrl, name) {
  const img = await loadImage(dataUrl);
  resetProject();
  S.source = { dataUrl, width: img.naturalWidth, height: img.naturalHeight, name: name || 'character.png' };
  S.ui.step = 2;
  commit();
}

function loadSourceFile(file) {
  return withBusy('Loading image', async () => {
    if (!file || !/^image\//.test(file.type)) throw new Error('Choose an image file (PNG, JPG or WebP).');
    await setSourceFromDataUrl(await fileToDataUrl(file), file.name);
    toast('Image loaded: ' + S.source.width + ' × ' + S.source.height + ' px', 'ok');
  });
}

function generateCharacter() {
  return withBusy('Generating character', async () => {
    const prompt = String(S.options.charPrompt || '').trim();
    if (!prompt) throw new Error('Describe the character first.');
    const full = prompt + '. Full body, facing front, neutral standing pose, arms slightly away from the body, plain background, 2D game art.';
    await setSourceFromDataUrl(await generateImage(full), 'generated.png');
    toast('Character generated.', 'ok');
  });
}

function analyzeSource() {
  return withBusy('Analyzing character', async () => {
    const parts = await analyzeCharacter();
    edit((s) => {
      s.parts = parts;
      s.selectedId = parts[0] ? parts[0].id : null;
      s.results = { partImages: {}, stamp: 0 };
    }, 'analyze');
    toast(parts.length + ' parts detected. Adjust the boxes if needed.', 'ok');
  });
}

function sliceParts() {
  return withBusy('Slicing parts', async () => {
    await sliceAll();
    commit();
    if (S.options.inpaint && S.models.imageId) {
      const done = await inpaintOccluded();
      if (done) toast(done + ' hidden areas completed.', 'ok');
    }
    S.ui.step = 3;
    commit();
  });
}

function completeHiddenPart(id) {
  return withBusy('Completing hidden area', async () => {
    await inpaintPart(id);
    toast('Part completed: ' + id, 'ok');
  });
}

function addPart() {
  const part = newPart('Part');
  edit((s) => {
    s.parts.push(part);
    s.selectedId = part.id;
  }, 'add part');
}

function removePart(id) {
  edit((s) => {
    s.parts = s.parts.filter((p) => p.id !== id);
    s.parts.forEach((p) => { if (p.parent === id) p.parent = null; });
    delete s.results.partImages[id];
    if (s.selectedId === id) s.selectedId = null;
  }, 'remove part');
}

function goStep(step) {
  S.ui.step = step;
  refresh();
}
