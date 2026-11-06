/* js/processing/inpaint.js — Optional completion of occluded body parts with the image model.
 * State: reads S.parts/results.partImages; replaces S.results.partImages[id] and bumps S.results.stamp
 * Gotchas: off by default (S.options.inpaint). The generated image is resized to the original crop rectangle so the
 *          part keeps its position in the SVG. Provider support for reference images varies; failures keep the original slice.
 *
 * @auto-deps-begin
 * Defines: buildInpaintPrompt, inpaintOccluded, inpaintPart, resizeDataUrl
 * Uses: S, commit, findPart, generateImage, loadImage, refresh
 * @auto-deps-end
 */
function buildInpaintPrompt(part) {
  return [
    'This image is one cut-out body part ("' + part.label + '") of a 2D game character, prepared for bones rigging.',
    'Part of it is hidden behind another body part or cropped away.',
    'Redraw the complete part in exactly the same art style, colors, line work and lighting.',
    'Keep the same pose, scale and framing. Only fill in the missing areas.',
    'Use a plain transparent or solid white background and do not add other body parts, text or effects.'
  ].join(' ');
}

async function resizeDataUrl(dataUrl, width, height) {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

async function inpaintPart(id) {
  const part = findPart(id);
  const slice = S.results.partImages[id];
  if (!part || !slice) throw new Error('Slice the parts before completing hidden areas.');
  const generated = await generateImage(buildInpaintPrompt(part), slice.dataUrl);
  const resized = await resizeDataUrl(generated, slice.w, slice.h);
  S.results.partImages[id] = Object.assign({}, slice, { dataUrl: resized, inpainted: true });
  S.results.stamp = Date.now();
  commit();
}

async function inpaintOccluded() {
  const targets = S.parts.filter((p) => p.occluded && S.results.partImages[p.id]);
  let done = 0;
  for (const part of targets) {
    S.ui.busy = 'Completing hidden areas ' + (done + 1) + '/' + targets.length;
    refresh();
    await inpaintPart(part.id);
    done += 1;
  }
  return done;
}
