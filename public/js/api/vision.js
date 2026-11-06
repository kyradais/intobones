/* js/api/vision.js — Character analysis through the vision model (chat/completions with an image).
 * State: reads S.models.visionId and S.source; returns validated parts (does not write S.parts)
 * Gotchas: the image is downscaled to 1024px before sending, and returned coordinates are scaled back to the source.
 *          Models often wrap JSON in code fences or prose, so extractJson() is deliberately forgiving.
 *
 * @auto-deps-begin
 * Defines: analyzeCharacter, buildVisionPrompt, extractJson, messageText
 * Uses: ApiError, DEFAULT_PART_IDS, Limiters, S, apiFetch, scaleDataUrl, scalePart, validateParts
 * @auto-deps-end
 */
function buildVisionPrompt(width, height) {
  return [
    'You are a rigging assistant for 2D game animation (bones/skeleton rigging).',
    'The attached image is a single character, ' + width + ' x ' + height + ' pixels.',
    'Split the character into separate body parts that can be cut out and rigged.',
    'Return ONLY a JSON object, with no commentary and no code fences, in exactly this shape:',
    '{"image":{"width":' + width + ',"height":' + height + '},"parts":[{"id":"head","label":"Head","parent":"neck",',
    '"bbox":{"x":0,"y":0,"w":0,"h":0},"polygon":[[0,0],[0,0],[0,0]],"pivot":{"x":0,"y":0},"occluded":false,"z":10}]}',
    'Rules:',
    '- All coordinates are pixels in the provided image. bbox is the top-left corner plus width and height.',
    '- Use these ids when the part exists: ' + DEFAULT_PART_IDS.join(', ') + '. Skip parts that are not visible. For non-humanoid characters invent short snake_case ids.',
    '- "pivot" is the joint where the part rotates, normally where it attaches to its parent.',
    '- "parent" is the id of the part it attaches to, or null for the root (usually pelvis or torso).',
    '- "polygon" is optional: an outline of the visible part with at least 3 points.',
    '- Set "occluded" to true when the part is partly hidden behind another part.',
    '- "z" is the draw order; larger values are drawn in front.'
  ].join('\n');
}

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const attempts = [raw];
  const o1 = raw.indexOf('{');
  const o2 = raw.lastIndexOf('}');
  if (o1 >= 0 && o2 > o1) attempts.push(raw.slice(o1, o2 + 1));
  const a1 = raw.indexOf('[');
  const a2 = raw.lastIndexOf(']');
  if (a1 >= 0 && a2 > a1) attempts.push(raw.slice(a1, a2 + 1));
  for (const candidate of attempts) {
    try { return JSON.parse(candidate); } catch (err) { /* try the next candidate */ }
  }
  throw new ApiError('badjson', 'The vision model did not return valid JSON. Try again or pick another vision model.');
}

function messageText(resp) {
  const msg = resp && resp.choices && resp.choices[0] && resp.choices[0].message;
  if (!msg) return '';
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return msg.content.map((c) => (typeof c === 'string' ? c : c.text || '')).join('');
  return '';
}

async function analyzeCharacter() {
  if (!S.models.visionId) throw new ApiError('config', 'Select a vision model first.');
  if (!S.source.dataUrl) throw new ApiError('config', 'Add a character image first.');
  const scaled = await scaleDataUrl(S.source.dataUrl, 1024);
  const body = {
    model: S.models.visionId,
    temperature: 0.1,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildVisionPrompt(scaled.width, scaled.height) },
        { type: 'image_url', image_url: { url: scaled.dataUrl } }
      ]
    }]
  };
  const resp = await Limiters.vision.schedule(({ signal }) => apiFetch('chat/completions', { method: 'POST', body, signal }));
  const raw = extractJson(messageText(resp));
  const parts = validateParts(raw, scaled.width, scaled.height);
  if (!parts.length) throw new ApiError('badjson', 'The model found no usable body parts. Try another vision model.');
  const sx = S.source.width / scaled.width;
  const sy = S.source.height / scaled.height;
  return validateParts(parts.map((p) => scalePart(p, sx, sy)), S.source.width, S.source.height);
}
