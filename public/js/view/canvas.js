/* js/view/canvas.js — Part editor canvas: draws the image, part boxes and the bone skeleton; drag, resize, pivot edit.
 * State: reads S.source/parts/selectedId; mutates part.bbox/pivot/polygon in place during a drag, then commit()
 * Gotchas: history is pushed once, on the first real movement of a drag. Resizing drops the polygon (it would no
 *          longer match); moving translates it. Hit-testing order: handles, pivot, then smallest box under the cursor.
 *
 * @auto-deps-begin
 * Defines: HANDLE_NAMES, PART_COLORS, _ed, applyDrag, drawBones, drawEditor, drawPart, fitView,
 *   handlePoints, hitTest, initEditor, onEditorDown, onEditorMove, onEditorUp, partColor,
 *   pointerPos, resizeBox, syncEditorImage, toImage, toView
 * Uses: S, clamp, commit, findPart, loadImage, pushHistory, selectPart
 * @auto-deps-end
 */
const _ed = { canvas: null, ctx: null, img: null, imgSrc: '', view: { scale: 1, ox: 0, oy: 0 }, drag: null };
const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const PART_COLORS = ['#4054d6', '#0b8f87', '#c2410c', '#7c3aed', '#0f766e', '#b45309', '#be185d', '#1d4ed8'];

function partColor(id) {
  const idx = S.parts.findIndex((p) => p.id === id);
  return PART_COLORS[(idx < 0 ? 0 : idx) % PART_COLORS.length];
}

function initEditor(canvas) {
  _ed.canvas = canvas;
  try { _ed.ctx = canvas.getContext('2d'); } catch (err) { _ed.ctx = null; }
  canvas.addEventListener('pointerdown', onEditorDown);
  canvas.addEventListener('pointermove', onEditorMove);
  canvas.addEventListener('pointerup', onEditorUp);
  canvas.addEventListener('pointercancel', onEditorUp);
  window.addEventListener('resize', drawEditor);
}

async function syncEditorImage() {
  if (!S.source.dataUrl) {
    _ed.img = null;
    _ed.imgSrc = '';
    return drawEditor();
  }
  if (_ed.imgSrc === S.source.dataUrl) return drawEditor();
  _ed.imgSrc = S.source.dataUrl;
  try { _ed.img = await loadImage(S.source.dataUrl); } catch (err) { _ed.img = null; }
  return drawEditor();
}

function fitView() {
  const c = _ed.canvas;
  const W = S.source.width || 1;
  const H = S.source.height || 1;
  const cssW = Math.max(240, c.clientWidth || 640);
  const cssH = Math.min(Math.round((cssW * H) / W), Math.round(window.innerHeight * 0.72), 900);
  if (c.width !== cssW) c.width = cssW;
  if (c.height !== cssH) c.height = cssH;
  const scale = Math.min(c.width / W, c.height / H);
  _ed.view = { scale, ox: (c.width - W * scale) / 2, oy: (c.height - H * scale) / 2 };
}

function toView(x, y) {
  return [_ed.view.ox + x * _ed.view.scale, _ed.view.oy + y * _ed.view.scale];
}

function toImage(px, py) {
  return [(px - _ed.view.ox) / _ed.view.scale, (py - _ed.view.oy) / _ed.view.scale];
}

function handlePoints(part) {
  const b = part.bbox;
  const xs = { w: b.x, c: b.x + b.w / 2, e: b.x + b.w };
  const ys = { n: b.y, c: b.y + b.h / 2, s: b.y + b.h };
  return HANDLE_NAMES.map((name) => ({
    name,
    x: name.includes('w') ? xs.w : name.includes('e') ? xs.e : xs.c,
    y: name.includes('n') ? ys.n : name.includes('s') ? ys.s : ys.c
  }));
}

function drawBones(g) {
  g.lineWidth = 2;
  g.strokeStyle = 'rgba(224, 36, 94, 0.75)';
  S.parts.forEach((p) => {
    const parent = p.parent && findPart(p.parent);
    if (!parent) return;
    const [x1, y1] = toView(parent.pivot.x, parent.pivot.y);
    const [x2, y2] = toView(p.pivot.x, p.pivot.y);
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  });
  S.parts.forEach((p) => {
    const [x, y] = toView(p.pivot.x, p.pivot.y);
    const selected = p.id === S.selectedId;
    g.beginPath();
    g.arc(x, y, selected ? 6 : 4, 0, Math.PI * 2);
    g.fillStyle = '#e0245e';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#ffffff';
    g.stroke();
  });
}

function drawPart(g, part) {
  const color = partColor(part.id);
  const selected = part.id === S.selectedId;
  const [x, y] = toView(part.bbox.x, part.bbox.y);
  const w = part.bbox.w * _ed.view.scale;
  const h = part.bbox.h * _ed.view.scale;
  g.lineWidth = selected ? 2.5 : 1.5;
  g.strokeStyle = color;
  g.fillStyle = selected ? color + '26' : color + '0d';
  g.fillRect(x, y, w, h);
  g.strokeRect(x, y, w, h);
  if (part.polygon) {
    g.beginPath();
    part.polygon.forEach((pt, i) => {
      const [px, py] = toView(pt[0], pt[1]);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    });
    g.closePath();
    g.setLineDash([5, 4]);
    g.stroke();
    g.setLineDash([]);
  }
  g.font = '12px system-ui, sans-serif';
  const label = part.label + (part.occluded ? ' (hidden)' : '');
  const tw = g.measureText(label).width + 8;
  g.fillStyle = color;
  g.fillRect(x, Math.max(0, y - 17), tw, 17);
  g.fillStyle = '#ffffff';
  g.fillText(label, x + 4, Math.max(12, y - 5));
  if (selected) {
    handlePoints(part).forEach((hp) => {
      const [hx, hy] = toView(hp.x, hp.y);
      g.fillStyle = '#ffffff';
      g.fillRect(hx - 4, hy - 4, 8, 8);
      g.strokeRect(hx - 4, hy - 4, 8, 8);
    });
  }
}

function drawEditor() {
  const c = _ed.canvas;
  if (!c || !_ed.ctx) return;
  fitView();
  const g = _ed.ctx;
  g.clearRect(0, 0, c.width, c.height);
  if (!_ed.img) return;
  g.drawImage(_ed.img, _ed.view.ox, _ed.view.oy, S.source.width * _ed.view.scale, S.source.height * _ed.view.scale);
  S.parts.slice().sort((a, b) => a.z - b.z).forEach((p) => drawPart(g, p));
  drawBones(g);
}

function pointerPos(e) {
  const r = _ed.canvas.getBoundingClientRect();
  const k = _ed.canvas.width / r.width;
  return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
}

function hitTest(px, py) {
  const sel = findPart(S.selectedId);
  if (sel) {
    for (const hp of handlePoints(sel)) {
      const [hx, hy] = toView(hp.x, hp.y);
      if (Math.abs(px - hx) <= 7 && Math.abs(py - hy) <= 7) return { id: sel.id, mode: 'resize', handle: hp.name };
    }
  }
  for (const p of S.parts) {
    const [x, y] = toView(p.pivot.x, p.pivot.y);
    if (Math.hypot(px - x, py - y) <= 8) return { id: p.id, mode: 'pivot' };
  }
  const [ix, iy] = toImage(px, py);
  const inside = S.parts.filter((p) => ix >= p.bbox.x && ix <= p.bbox.x + p.bbox.w && iy >= p.bbox.y && iy <= p.bbox.y + p.bbox.h);
  inside.sort((a, b) => a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h);
  return inside[0] ? { id: inside[0].id, mode: 'move' } : null;
}

function onEditorDown(e) {
  if (!_ed.img) return;
  const [px, py] = pointerPos(e);
  const hit = hitTest(px, py);
  if (!hit) { selectPart(null); return; }
  const part = findPart(hit.id);
  _ed.canvas.setPointerCapture(e.pointerId);
  _ed.drag = { hit, start: [px, py], orig: JSON.parse(JSON.stringify(part)), moved: false };
  if (S.selectedId !== hit.id) selectPart(hit.id);
}

function resizeBox(orig, handle, ix, iy) {
  let x1 = orig.x; let y1 = orig.y; let x2 = orig.x + orig.w; let y2 = orig.y + orig.h;
  if (handle.includes('w')) x1 = Math.min(ix, x2 - 4);
  if (handle.includes('e')) x2 = Math.max(ix, x1 + 4);
  if (handle.includes('n')) y1 = Math.min(iy, y2 - 4);
  if (handle.includes('s')) y2 = Math.max(iy, y1 + 4);
  x1 = clamp(x1, 0, S.source.width - 4); y1 = clamp(y1, 0, S.source.height - 4);
  x2 = clamp(x2, x1 + 4, S.source.width); y2 = clamp(y2, y1 + 4, S.source.height);
  return { x: Math.round(x1), y: Math.round(y1), w: Math.round(x2 - x1), h: Math.round(y2 - y1) };
}

function applyDrag(drag, px, py) {
  const part = findPart(drag.hit.id);
  const k = _ed.view.scale;
  const dx = (px - drag.start[0]) / k;
  const dy = (py - drag.start[1]) / k;
  const o = drag.orig;
  if (drag.hit.mode === 'move') {
    const nx = clamp(o.bbox.x + dx, 0, S.source.width - o.bbox.w);
    const ny = clamp(o.bbox.y + dy, 0, S.source.height - o.bbox.h);
    const mx = nx - o.bbox.x; const my = ny - o.bbox.y;
    part.bbox = { x: Math.round(nx), y: Math.round(ny), w: o.bbox.w, h: o.bbox.h };
    part.pivot = { x: Math.round(o.pivot.x + mx), y: Math.round(o.pivot.y + my) };
    part.polygon = o.polygon ? o.polygon.map((pt) => [Math.round(pt[0] + mx), Math.round(pt[1] + my)]) : null;
  } else if (drag.hit.mode === 'pivot') {
    const [ix, iy] = toImage(px, py);
    part.pivot = { x: Math.round(clamp(ix, 0, S.source.width)), y: Math.round(clamp(iy, 0, S.source.height)) };
  } else {
    const [ix, iy] = toImage(px, py);
    part.bbox = resizeBox(o.bbox, drag.hit.handle, ix, iy);
    part.polygon = null;
  }
}

function onEditorMove(e) {
  if (!_ed.img) return;
  const [px, py] = pointerPos(e);
  const drag = _ed.drag;
  if (!drag) {
    const hit = hitTest(px, py);
    _ed.canvas.style.cursor = !hit ? 'default' : hit.mode === 'move' ? 'move' : hit.mode === 'pivot' ? 'crosshair' : 'nwse-resize';
    return;
  }
  if (!drag.moved) {
    if (Math.hypot(px - drag.start[0], py - drag.start[1]) < 3) return;
    drag.moved = true;
    pushHistory('drag');
  }
  applyDrag(drag, px, py);
  drawEditor();
}

function onEditorUp(e) {
  const drag = _ed.drag;
  _ed.drag = null;
  if (!drag) return;
  if (_ed.canvas.hasPointerCapture && _ed.canvas.hasPointerCapture(e.pointerId)) _ed.canvas.releasePointerCapture(e.pointerId);
  if (drag.moved) commit();
}
