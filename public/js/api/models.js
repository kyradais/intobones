/* js/api/models.js — Model discovery (GET /models), classification, manual models, connection test and model Test buttons.
 * State: writes S.models (all, custom, vision, image, visionId, imageId, overrides), S.conn.*, S.ui.tests (conn, vision, image)
 * Gotchas: 9router gives no reliable capability metadata, so classification is a name heuristic; the user can override
 *          it per model, add model ids by hand (S.models.custom, kept across reconnects) or show every model in both
 *          lists (S.options.showAllModels). If /models 404s the base URL is retried with /v1 appended.
 *
 * @auto-deps-begin
 * Defines: IMAGE_NAME_RE, IMAGE_PREFERRED_RE, SKIP_NAME_RE, VISION_PREFERRED_RE, addCustomModel,
 *   allModels, applyClassification, classifyModel, discoverModels, fetchModelsWithFallback,
 *   modelKind, parseModelList, pickDefault, removeCustomModel, runModelTest, setModelKind,
 *   setShowAllModels, testConnection, testImageModel, testVisionModel
 * Uses: ApiError, Limiters, S, apiFetch, commit, describeError, generateImage, makeTestImage,
 *   messageText, normalizeBase, refresh
 * @auto-deps-end
 */
const IMAGE_NAME_RE = new RegExp([
  'image', 'flux', 'imagen', 'dall-?e', 'diffusion', 'sdxl', 'sd-?xl', 'midjourney', 'seedream', 'nano-?banana',
  'recraft', 'ideogram', 'dreamshaper', 'lykon', 'phoenix', 'lucid', 'leonardo', 'kandinsky', 'playground',
  'hidream', 'qwen-image', 'z-image', 'lcm', '\\bsd[-_ ]?\\d', 'text-to-image'
].join('|'), 'i');
const SKIP_NAME_RE = /embed|rerank|whisper|tts|speech|audio|moderation|transcribe/i;
const VISION_PREFERRED_RE = /vl|vision|gemini|gpt-4|gpt-5|claude|minimax|qwen.*vl|pixtral|llava/i;
const IMAGE_PREFERRED_RE = /gemini.*image|flux|imagen|gpt-image|seedream/i;

function classifyModel(id, meta) {
  const m = meta || {};
  const caps = [].concat(m.capabilities || [], m.modalities || [], m.output_modalities || [], m.type || []);
  const capText = caps.map(String).join(' ').toLowerCase();
  if (SKIP_NAME_RE.test(id) || /embedding|rerank|audio|speech/.test(capText)) return 'other';
  if (/image_generation|image-generation|text-to-image/.test(capText)) return 'image';
  if (/\bimage\b/.test(capText) && /output/.test(capText)) return 'image';
  return IMAGE_NAME_RE.test(id) ? 'image' : 'vision';
}

function parseModelList(json) {
  const list = Array.isArray(json) ? json : (json && (json.data || json.models)) || [];
  return list
    .map((item) => (typeof item === 'string' ? { id: item } : item))
    .filter((item) => item && typeof item.id === 'string' && item.id)
    .map((item) => ({ id: item.id, meta: item }));
}

/** Discovered models plus manually added ones that the API did not list. */
function allModels() {
  const known = new Set(S.models.all.map((m) => m.id));
  const manual = S.models.custom.filter((c) => !known.has(c.id)).map((c) => ({ id: c.id, meta: {}, manual: true }));
  return S.models.all.concat(manual);
}

function pickDefault(ids, preferred, current) {
  if (current && ids.includes(current)) return current;
  return ids.find((id) => preferred.test(id)) || ids[0] || '';
}

function modelKind(model) {
  const custom = S.models.custom.find((c) => c.id === model.id);
  if (custom) return custom.kind;
  return S.models.overrides[model.id] || classifyModel(model.id, model.meta);
}

function applyClassification() {
  const models = allModels();
  models.forEach((model) => { model.kind = modelKind(model); });
  const usable = models.filter((m) => m.kind !== 'other').map((m) => m.id);
  const everything = models.filter((m) => S.models.overrides[m.id] !== 'other').map((m) => m.id);
  const byKind = (kind) => models.filter((m) => m.kind === kind).map((m) => m.id);
  S.models.vision = S.options.showAllModels ? everything : byKind('vision');
  S.models.image = S.options.showAllModels ? everything : byKind('image');
  S.models.visionId = pickDefault(S.models.vision, VISION_PREFERRED_RE, S.models.visionId);
  S.models.imageId = pickDefault(S.models.image, IMAGE_PREFERRED_RE, S.models.imageId);
  return usable;
}

function setModelKind(id, kind) {
  if (kind === 'auto') delete S.models.overrides[id];
  else S.models.overrides[id] = kind;
  applyClassification();
  commit();
}

function setShowAllModels(on) {
  S.options.showAllModels = !!on;
  applyClassification();
  commit();
}

function addCustomModel(rawId, kind) {
  const id = String(rawId || '').trim();
  if (!id) throw new ApiError('config', 'Type the model id first.');
  if (/\s/.test(id)) throw new ApiError('config', 'A model id cannot contain spaces.');
  const role = kind === 'vision' ? 'vision' : 'image';
  S.models.custom = S.models.custom.filter((c) => c.id !== id).concat([{ id, kind: role }]);
  applyClassification();
  S.models[role + 'Id'] = id;
  S.ui.tests[role] = null;
  commit();
  return id;
}

function removeCustomModel(id) {
  S.models.custom = S.models.custom.filter((c) => c.id !== id);
  applyClassification();
  commit();
}

async function fetchModelsWithFallback() {
  try {
    return await apiFetch('models');
  } catch (err) {
    const base = normalizeBase(S.conn.baseUrl);
    if (err.kind !== 'notfound' || /\/v1$/.test(base)) throw err;
    S.conn.baseUrl = base + '/v1';
    try {
      return await apiFetch('models');
    } catch (err2) {
      S.conn.baseUrl = base;
      throw err2;
    }
  }
}

async function discoverModels() {
  if (!normalizeBase(S.conn.baseUrl)) throw new ApiError('config', 'Enter the Base URL first.');
  S.conn.status = 'connecting';
  S.conn.message = 'Connecting…';
  refresh();
  try {
    const json = await fetchModelsWithFallback();
    S.models.all = parseModelList(json);
    if (!S.models.all.length && !S.models.custom.length) throw new ApiError('badjson', 'Connected, but the API returned no models. You can add model ids by hand.');
    applyClassification();
    S.conn.status = 'ok';
    S.conn.message = S.models.all.length + ' models found (' + S.models.vision.length + ' vision, ' + S.models.image.length + ' image)';
    commit();
    return S.models.all;
  } catch (err) {
    S.conn.status = 'error';
    S.conn.message = describeError(err);
    commit();
    throw err;
  }
}

/** Lightweight connectivity check: one GET /models. Does not touch the model lists. */
async function testConnection() {
  S.ui.tests.conn = { state: 'running' };
  refresh();
  const started = Date.now();
  const route = S.conn.mode === 'direct' ? 'directly' : 'through the proxy';
  try {
    if (!normalizeBase(S.conn.baseUrl)) throw new ApiError('config', 'Enter the Base URL first.');
    const count = parseModelList(await fetchModelsWithFallback()).length;
    S.ui.tests.conn = { state: 'ok', ms: Date.now() - started, message: 'Reached the API ' + route + '; ' + count + ' models listed.' };
  } catch (err) {
    const ms = Date.now() - started;
    S.ui.tests.conn = err.kind === 'notfound'
      ? { state: 'warn', ms, message: 'The server answered, but /models was not found. Add model ids by hand, or check the Base URL (usually ends with /v1).' }
      : { state: 'fail', ms, message: describeError(err) };
  }
  commit();
  return S.ui.tests.conn;
}

async function runModelTest(role, task) {
  S.ui.tests[role] = { state: 'running' };
  refresh();
  const started = Date.now();
  try {
    await task();
    S.ui.tests[role] = { state: 'ok', ms: Date.now() - started };
  } catch (err) {
    S.ui.tests[role] = { state: 'fail', ms: Date.now() - started, message: describeError(err) };
  }
  refresh();
  return S.ui.tests[role];
}

function testVisionModel() {
  return runModelTest('vision', async () => {
    if (!S.models.visionId) throw new ApiError('config', 'Select a vision model first.');
    const body = {
      model: S.models.visionId,
      max_tokens: 20,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Reply with the single word: ok' },
          { type: 'image_url', image_url: { url: makeTestImage() } }
        ]
      }]
    };
    const resp = await Limiters.vision.schedule(({ signal }) => apiFetch('chat/completions', { method: 'POST', body, signal }));
    if (!messageText(resp)) throw new ApiError('badjson', 'The model replied with an empty message.');
  });
}

function testImageModel() {
  return runModelTest('image', async () => {
    await generateImage('A simple red circle on a white background, flat vector style.');
  });
}
