/* js/export/svg.js — Builds the single SVG (one <g> per body part) and downloads SVG / PNG / project files.
 * State: reads S.source, S.parts, S.results.partImages
 * Gotchas: buildSvg() is pure and runs without a DOM. Each group carries data-pivot-x/y so rigging tools can read the
 *          joint position; groups are ordered by z. Pivot circles are hidden (display="none") by default.
 *
 * @auto-deps-begin
 * Defines: baseFileName, buildSvg, currentSvg, downloadPartPngs, downloadProject, downloadSvg,
 *   escapeXml
 * Uses: S, downloadHref, downloadText, serializeProject, sleep
 * @auto-deps-end
 */
function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function buildSvg(source, parts, partImages, opts) {
  const showPivots = !!(opts && opts.showPivots);
  const ordered = parts.slice().sort((a, b) => a.z - b.z);
  const meta = {
    app: 'intobones',
    version: 2,
    width: source.width,
    height: source.height,
    parts: ordered.map((p) => ({ id: p.id, label: p.label, parent: p.parent, pivot: p.pivot, z: p.z }))
  };
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + source.width + '" height="' + source.height + '" viewBox="0 0 ' + source.width + ' ' + source.height + '">',
    '  <metadata id="intobones-metadata">' + escapeXml(JSON.stringify(meta)) + '</metadata>',
    '  <g id="character">'
  ];
  ordered.forEach((p) => {
    const img = partImages[p.id];
    const attrs = [
      'id="' + escapeXml(p.id) + '"',
      'data-label="' + escapeXml(p.label) + '"',
      'data-parent="' + escapeXml(p.parent || '') + '"',
      'data-pivot-x="' + Math.round(p.pivot.x) + '"',
      'data-pivot-y="' + Math.round(p.pivot.y) + '"',
      'data-z="' + p.z + '"',
      'data-occluded="' + (p.occluded ? 'true' : 'false') + '"'
    ];
    lines.push('    <g ' + attrs.join(' ') + '>');
    if (img) {
      const uri = escapeXml(img.dataUrl);
      lines.push('      <image x="' + img.x + '" y="' + img.y + '" width="' + img.w + '" height="' + img.h + '" href="' + uri + '" xlink:href="' + uri + '"/>');
    }
    const display = showPivots ? '' : ' display="none"';
    lines.push('      <circle class="pivot" cx="' + Math.round(p.pivot.x) + '" cy="' + Math.round(p.pivot.y) + '" r="4" fill="#e0245e"' + display + '/>');
    lines.push('    </g>');
  });
  lines.push('  </g>', '</svg>', '');
  return lines.join('\n');
}

function currentSvg(opts) {
  return buildSvg(S.source, S.parts, S.results.partImages, opts);
}

function baseFileName() {
  return (S.source.name || 'character').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'character';
}

function downloadSvg() {
  downloadText(baseFileName() + '_parts.svg', currentSvg(), 'image/svg+xml');
}

async function downloadPartPngs() {
  const entries = Object.entries(S.results.partImages);
  for (const [id, img] of entries) {
    downloadHref(baseFileName() + '_' + id + '.png', img.dataUrl);
    await sleep(250);
  }
  return entries.length;
}

function downloadProject() {
  downloadText(baseFileName() + '.intobones.json', JSON.stringify(serializeProject()), 'application/json');
}
