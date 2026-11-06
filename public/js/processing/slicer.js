/* js/processing/slicer.js — Canvas helpers: load/scale images and cut each body part from the ORIGINAL pixels.
 * State: sliceAll() reads S.source/parts/options.padding and writes S.results.partImages and S.results.stamp
 * Gotchas: needs a real canvas (browser). Parts are cropped from the full-resolution source, never from the
 *          downscaled analysis copy. A polygon, when present, clips the crop so pixels outside it become transparent.
 *
 * @auto-deps-begin
 * Defines: cropRect, fileToDataUrl, loadImage, makeTestImage, scaleDataUrl, sliceAll, sliceOne
 * Uses: S
 * @auto-deps-end
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the image.'));
    img.src = src;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function scaleDataUrl(dataUrl, maxSide) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale >= 1) return { dataUrl, width, height, scale: 1 };
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h, scale };
}

function makeTestImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 32, 32);
  g.fillStyle = '#e0245e';
  g.fillRect(8, 8, 16, 16);
  return canvas.toDataURL('image/png');
}

function cropRect(part, pad, W, H) {
  const b = part.bbox;
  const x = Math.max(0, Math.floor(b.x - pad));
  const y = Math.max(0, Math.floor(b.y - pad));
  const x2 = Math.min(W, Math.ceil(b.x + b.w + pad));
  const y2 = Math.min(H, Math.ceil(b.y + b.h + pad));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

function sliceOne(img, part, pad) {
  const r = cropRect(part, pad, img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = r.w;
  canvas.height = r.h;
  const g = canvas.getContext('2d');
  if (part.polygon && part.polygon.length >= 3) {
    g.beginPath();
    part.polygon.forEach((pt, i) => {
      if (i === 0) g.moveTo(pt[0] - r.x, pt[1] - r.y);
      else g.lineTo(pt[0] - r.x, pt[1] - r.y);
    });
    g.closePath();
    g.clip();
  }
  g.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
  return { dataUrl: canvas.toDataURL('image/png'), x: r.x, y: r.y, w: r.w, h: r.h, inpainted: false };
}

async function sliceAll() {
  if (!S.source.dataUrl || !S.parts.length) throw new Error('Add an image and at least one part first.');
  const img = await loadImage(S.source.dataUrl);
  const pad = Math.max(0, Number(S.options.padding) || 0);
  const images = {};
  S.parts.forEach((part) => { images[part.id] = sliceOne(img, part, pad); });
  S.results.partImages = images;
  S.results.stamp = Date.now();
  return images;
}
