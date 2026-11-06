/* js/model/types.js — Body-part schema, default humanoid preset and validateParts() for untrusted model output.
 * State: pure helpers (the only S access is findPart/newPart reading S.parts)
 * Gotchas: all coordinates are source-image pixels. validateParts() accepts bbox objects/arrays, Gemini-style
 *          box_2d [ymin,xmin,ymax,xmax] in 0-1000, and values normalized to 0-1. It never trusts parents or ids.
 *
 * @auto-deps-begin
 * Defines: DEFAULT_PARTS, DEFAULT_PART_IDS, clamp, findPart, looksNormalized, newPart, numbersOf,
 *   readBox, readPoint, readPolygon, scalePart, slugId, validateParts
 * Uses: S
 * @auto-deps-end
 */
const DEFAULT_PARTS = [
  { id: 'pelvis', label: 'Pelvis', parent: null },
  { id: 'torso', label: 'Torso', parent: 'pelvis' },
  { id: 'neck', label: 'Neck', parent: 'torso' },
  { id: 'head', label: 'Head', parent: 'neck' },
  { id: 'upper_arm_L', label: 'Upper arm L', parent: 'torso' },
  { id: 'lower_arm_L', label: 'Lower arm L', parent: 'upper_arm_L' },
  { id: 'hand_L', label: 'Hand L', parent: 'lower_arm_L' },
  { id: 'upper_arm_R', label: 'Upper arm R', parent: 'torso' },
  { id: 'lower_arm_R', label: 'Lower arm R', parent: 'upper_arm_R' },
  { id: 'hand_R', label: 'Hand R', parent: 'lower_arm_R' },
  { id: 'upper_leg_L', label: 'Upper leg L', parent: 'pelvis' },
  { id: 'lower_leg_L', label: 'Lower leg L', parent: 'upper_leg_L' },
  { id: 'foot_L', label: 'Foot L', parent: 'lower_leg_L' },
  { id: 'upper_leg_R', label: 'Upper leg R', parent: 'pelvis' },
  { id: 'lower_leg_R', label: 'Lower leg R', parent: 'upper_leg_R' },
  { id: 'foot_R', label: 'Foot R', parent: 'lower_leg_R' }
];
const DEFAULT_PART_IDS = DEFAULT_PARTS.map((p) => p.id);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugId(text) {
  const slug = String(text || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug || 'part';
}

function numbersOf(value) {
  if (Array.isArray(value)) return value.map(Number);
  if (value && typeof value === 'object') return Object.values(value).map(Number);
  return [];
}

function looksNormalized(list) {
  const values = [];
  list.forEach((r) => {
    if (!r || typeof r !== 'object' || r.box_2d) return;
    values.push(...numbersOf(r.bbox), ...numbersOf(r.pivot));
    (Array.isArray(r.polygon) ? r.polygon : []).forEach((pt) => values.push(...numbersOf(pt)));
  });
  const finite = values.filter(Number.isFinite);
  return finite.length > 0 && finite.every((v) => v >= 0 && v <= 1.0001);
}

function readBox(r, W, H, frac) {
  let x; let y; let w; let h;
  if (Array.isArray(r.box_2d) && r.box_2d.length === 4) {
    const [ymin, xmin, ymax, xmax] = r.box_2d.map(Number);
    x = (xmin / 1000) * W; y = (ymin / 1000) * H;
    w = ((xmax - xmin) / 1000) * W; h = ((ymax - ymin) / 1000) * H;
  } else if (Array.isArray(r.bbox) && r.bbox.length === 4) {
    [x, y, w, h] = r.bbox.map(Number);
  } else if (r.bbox && typeof r.bbox === 'object') {
    x = Number(r.bbox.x); y = Number(r.bbox.y);
    w = Number(r.bbox.w !== undefined ? r.bbox.w : r.bbox.width);
    h = Number(r.bbox.h !== undefined ? r.bbox.h : r.bbox.height);
  } else {
    return null;
  }
  if (![x, y, w, h].every(Number.isFinite)) return null;
  if (frac && !r.box_2d) { x *= W; y *= H; w *= W; h *= H; }
  x = clamp(Math.round(x), 0, W - 1);
  y = clamp(Math.round(y), 0, H - 1);
  w = clamp(Math.round(w), 1, W - x);
  h = clamp(Math.round(h), 1, H - y);
  return { x, y, w, h };
}

function readPoint(value, W, H, frac) {
  const pair = Array.isArray(value) ? value.map(Number) : [Number(value && value.x), Number(value && value.y)];
  if (pair.length < 2 || !pair.slice(0, 2).every(Number.isFinite)) return null;
  const k = frac ? [W, H] : [1, 1];
  return [clamp(Math.round(pair[0] * k[0]), 0, W - 1), clamp(Math.round(pair[1] * k[1]), 0, H - 1)];
}

function readPolygon(value, W, H, frac) {
  if (!Array.isArray(value)) return null;
  const pts = value.map((pt) => readPoint(pt, W, H, frac)).filter(Boolean);
  return pts.length >= 3 ? pts : null;
}

function validateParts(raw, W, H) {
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.parts) ? raw.parts : []);
  const frac = looksNormalized(list);
  const out = [];
  const seen = new Set();
  list.forEach((r, i) => {
    if (!r || typeof r !== 'object') return;
    const bbox = readBox(r, W, H, frac);
    if (!bbox) return;
    const base = slugId(r.id || r.label || 'part_' + (i + 1));
    let id = base;
    for (let n = 2; seen.has(id); n += 1) id = base + '_' + n;
    seen.add(id);
    const pivot = readPoint(r.pivot, W, H, frac) || [Math.round(bbox.x + bbox.w / 2), Math.round(bbox.y + bbox.h / 2)];
    out.push({
      id,
      label: String(r.label || id),
      parent: r.parent ? slugId(r.parent) : null,
      bbox,
      polygon: readPolygon(r.polygon, W, H, frac),
      pivot: { x: pivot[0], y: pivot[1] },
      occluded: !!r.occluded,
      z: Number.isFinite(Number(r.z)) ? Number(r.z) : i
    });
  });
  out.forEach((p) => { if (p.parent === p.id || !seen.has(p.parent)) p.parent = null; });
  return out;
}

function scalePart(part, sx, sy) {
  const copy = JSON.parse(JSON.stringify(part));
  copy.bbox = { x: part.bbox.x * sx, y: part.bbox.y * sy, w: part.bbox.w * sx, h: part.bbox.h * sy };
  copy.pivot = { x: part.pivot.x * sx, y: part.pivot.y * sy };
  copy.polygon = part.polygon ? part.polygon.map((pt) => [pt[0] * sx, pt[1] * sy]) : null;
  return copy;
}

function findPart(id) {
  return S.parts.find((p) => p.id === id) || null;
}

function newPart(label) {
  const W = S.source.width || 100;
  const H = S.source.height || 100;
  const w = Math.max(8, Math.round(W * 0.2));
  const h = Math.max(8, Math.round(H * 0.2));
  const x = Math.round((W - w) / 2);
  const y = Math.round((H - h) / 2);
  const base = slugId(label || 'part');
  let id = base;
  for (let n = 2; findPart(id); n += 1) id = base + '_' + n;
  const z = S.parts.reduce((max, p) => Math.max(max, p.z), 0) + 1;
  return {
    id, label: label || id, parent: null, bbox: { x, y, w, h }, polygon: null,
    pivot: { x: x + Math.round(w / 2), y: y + Math.round(h / 2) }, occluded: false, z
  };
}
