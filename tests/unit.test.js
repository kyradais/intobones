'use strict';
/*
 * Unit tests: the real frontend scripts are loaded in jsdom (same order as index.html) and exercised with a
 * mocked fetch. Nothing here calls a real 9router. Canvas-dependent code is covered by tests/browser.test.js.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const http = require('http');
const { JSDOM, VirtualConsole } = require('jsdom');
const { analyzeProject, injectDeps } = require('../tools/docs');
const { createServer } = require('../server');

const INDEX = path.join(__dirname, '..', 'public', 'index.html');
const pageErrors = [];
let win;

const plain = (value) => JSON.parse(JSON.stringify(value));
const run = (code) => win.eval(code);
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function loadApp() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Not implemented/.test(e.message)) pageErrors.push(e.message); });
  vc.on('error', (...args) => pageErrors.push(args.join(' ')));
  const dom = await JSDOM.fromFile(INDEX, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc });
  if (dom.window.document.readyState !== 'complete') await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  await new Promise((resolve) => setTimeout(resolve, 60));
  return dom.window;
}

function response(status, body, headers) {
  const h = headers || {};
  return {
    ok: status < 400,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    headers: { get: (key) => (h[key.toLowerCase()] === undefined ? null : h[key.toLowerCase()]) }
  };
}

function connect(mode, base) {
  run('S.conn.mode = ' + JSON.stringify(mode || 'proxy') + '; S.conn.baseUrl = ' + JSON.stringify(base || 'http://h.test:1/v1') + '; S.conn.apiKey = "key123";');
}

function fakeClock() {
  const clock = {
    t: 0,
    queue: [],
    now() { return clock.t; },
    setTimeout(fn, ms) { clock.queue.push({ at: clock.t + ms, fn }); return clock.queue.length; },
    async advance(ms) {
      const end = clock.t + ms;
      await flush();
      for (;;) {
        clock.queue.sort((a, b) => a.at - b.at);
        const next = clock.queue[0];
        if (!next || next.at > end) break;
        clock.queue.shift();
        clock.t = Math.max(clock.t, next.at);
        next.fn();
        await flush();
      }
      clock.t = end;
      await flush();
    }
  };
  return clock;
}

test.before(async () => { win = await loadApp(); });
test.after(() => { win.close(); });

/* ---------- app boot ---------- */

test('app boots, builds the three panels and logs no errors', () => {
  assert.equal(win.document.querySelectorAll('#stepper .step').length, 3);
  assert.ok(win.document.querySelector('#in-base'));
  assert.ok(win.document.querySelector('#editor'));
  assert.ok(win.document.querySelector('#btn-dl-svg'));
  assert.equal(run('S.ui.step'), 1);
  assert.deepEqual(pageErrors, []);
});

/* ---------- models ---------- */

test('classifyModel separates image, vision and unusable models', () => {
  const classify = (id) => run('classifyModel(' + JSON.stringify(id) + ')');
  assert.equal(classify('ag/gemini-3.1-flash-image'), 'image');
  assert.equal(classify('cf/@cf/black-forest-labs/flux-2-klein-9b'), 'image');
  assert.equal(classify('openai/gpt-image-1'), 'image');
  assert.equal(classify('minimax/MiniMax-VL-01'), 'vision');
  assert.equal(classify('gemini-2.5-pro'), 'vision');
  assert.equal(classify('text-embedding-3-small'), 'other');
  assert.equal(run('classifyModel("custom", { capabilities: ["image_generation"] })'), 'image');
});

test('parseModelList accepts OpenAI lists, bare arrays and junk', () => {
  const parse = (value) => plain(run('parseModelList(' + JSON.stringify(value) + ')')).map((m) => m.id);
  assert.deepEqual(parse({ data: [{ id: 'a' }, { id: 'b' }, { nope: 1 }] }), ['a', 'b']);
  assert.deepEqual(parse(['x', 'y']), ['x', 'y']);
  assert.deepEqual(parse({}), []);
});

test('discoverModels retries with /v1, fills both model lists and updates the dropdowns', async () => {
  connect('proxy', 'http://h.test:1');
  run('S.models = { all: [], custom: [], vision: [], image: [], visionId: "", imageId: "", overrides: {} };');
  const seen = [];
  win.fetch = async (url, init) => {
    seen.push([url, init.headers['X-Target-Base']]);
    if (init.headers['X-Target-Base'] === 'http://h.test:1') return response(404, { error: { message: 'no route' } });
    return response(200, { data: [{ id: 'mm/MiniMax-VL-01' }, { id: 'ag/gemini-3.1-flash-image' }, { id: 'cf/@cf/black-forest-labs/flux-2-klein-9b' }] });
  };
  await run('discoverModels()');
  assert.deepEqual(seen, [['/proxy/models', 'http://h.test:1'], ['/proxy/models', 'http://h.test:1/v1']]);
  assert.equal(run('S.conn.baseUrl'), 'http://h.test:1/v1');
  assert.deepEqual(plain(run('S.models.vision')), ['mm/MiniMax-VL-01']);
  assert.equal(run('S.models.imageId'), 'ag/gemini-3.1-flash-image');
  assert.equal(win.document.querySelector('#sel-image').options.length, 2);
  assert.equal(win.document.querySelector('#sel-vision').value, 'mm/MiniMax-VL-01');
});

test('model override moves a model to the other list', () => {
  run('setModelKind("mm/MiniMax-VL-01", "image")');
  assert.ok(plain(run('S.models.image')).includes('mm/MiniMax-VL-01'));
  run('setModelKind("mm/MiniMax-VL-01", "auto")');
  assert.ok(plain(run('S.models.vision')).includes('mm/MiniMax-VL-01'));
});

/* ---------- api client ---------- */

test('apiFetch builds proxy and direct requests', async () => {
  const calls = [];
  win.fetch = async (url, init) => { calls.push({ url, init }); return response(200, { ok: true }); };
  connect('proxy', 'h.test:1/v1/');
  await run('apiFetch("models")');
  assert.equal(calls[0].url, '/proxy/models');
  assert.equal(calls[0].init.headers['X-Target-Base'], 'http://h.test:1/v1');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer key123');
  connect('direct', 'http://h.test:1/v1');
  await run('apiFetch("/chat/completions", { method: "POST", body: { a: 1 } })');
  assert.equal(calls[1].url, 'http://h.test:1/v1/chat/completions');
  assert.equal(calls[1].init.headers['X-Target-Base'], undefined);
  assert.equal(calls[1].init.body, '{"a":1}');
  assert.equal(run('joinUrl("http://x/", "/images/generations")'), 'http://x/images/generations');
});

test('apiFetch maps failures to readable, typed errors', async () => {
  connect('proxy');
  const expectKind = async (res, kind, check) => {
    win.fetch = async () => res;
    await assert.rejects(run('apiFetch("models")'), (err) => { assert.equal(err.kind, kind); if (check) check(err); return true; });
  };
  await expectKind(response(401, { error: { message: 'bad key' } }), 'auth', (e) => assert.match(e.message, /bad key/));
  await expectKind(response(404, 'nope'), 'notfound');
  await expectKind(response(429, { error: 'slow down' }, { 'retry-after': '2' }), 'ratelimit', (e) => { assert.equal(e.retryable, true); assert.equal(e.retryAfterMs, 2000); });
  await expectKind(response(503, 'down'), 'server', (e) => assert.equal(e.retryable, true));
  await expectKind(response(502, { error: { message: 'ECONNREFUSED' } }, { 'x-proxy-error': '1' }), 'network', (e) => assert.equal(e.retryable, false));
  await expectKind(response(200, '<html>oops</html>'), 'badjson');
  win.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(run('apiFetch("models")'), (err) => err.kind === 'network');
});

/* ---------- vision & image ---------- */

test('extractJson tolerates fences, prose and arrays, and rejects garbage', () => {
  const extract = (text) => plain(run('extractJson(' + JSON.stringify(text) + ')'));
  assert.deepEqual(extract('```json\n{"parts":[1]}\n```'), { parts: [1] });
  assert.deepEqual(extract('Here you go: {"a":2} hope it helps'), { a: 2 });
  assert.deepEqual(extract('[1,2]'), [1, 2]);
  assert.throws(() => run('extractJson("no json here")'), (err) => err.kind === 'badjson');
});

test('validateParts clamps, dedupes and understands several coordinate formats', () => {
  const v = (raw, w, h) => plain(run('validateParts(' + JSON.stringify(raw) + ',' + w + ',' + h + ')'));
  const clamped = v({ parts: [{ id: 'Head', bbox: { x: -5, y: 10, w: 5000, h: 20 } }] }, 100, 100);
  assert.deepEqual(clamped[0].bbox, { x: 0, y: 10, w: 100, h: 20 });
  assert.deepEqual(clamped[0].pivot, { x: 50, y: 20 });
  const dupes = v([{ id: 'arm', bbox: [1, 1, 5, 5] }, { id: 'arm', bbox: [1, 1, 5, 5] }, { id: 'bad' }, null, { id: 'nan', bbox: { x: 'a', y: 0, w: 1, h: 1 } }], 50, 50);
  assert.deepEqual(dupes.map((p) => p.id), ['arm', 'arm_2']);
  const box2d = v([{ id: 'gem', box_2d: [100, 200, 500, 600] }], 1000, 2000);
  assert.deepEqual(box2d[0].bbox, { x: 200, y: 200, w: 400, h: 800 });
  const frac = v([{ id: 'f', bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, pivot: { x: 0.5, y: 0.5 } }], 200, 100);
  assert.deepEqual(frac[0].bbox, { x: 20, y: 20, w: 60, h: 40 });
  assert.deepEqual(frac[0].pivot, { x: 100, y: 50 });
  const parents = v([{ id: 'a', parent: 'ghost', bbox: [0, 0, 5, 5] }, { id: 'b', parent: 'b', bbox: [0, 0, 5, 5] }, { id: 'c', parent: 'a', bbox: [0, 0, 5, 5] }], 20, 20);
  assert.deepEqual(parents.map((p) => p.parent), [null, null, 'a']);
});

test('analyzeCharacter sends the image, parses the reply and scales boxes to the source size', async () => {
  connect('proxy');
  const original = win.scaleDataUrl;
  win.scaleDataUrl = async (dataUrl) => ({ dataUrl, width: 100, height: 200, scale: 0.5 });
  run('S.source = { dataUrl: "data:image/png;base64,AAAA", width: 200, height: 400, name: "c.png" }; S.models.visionId = "mm/vl"; S.limits.vision.minDelayMs = 0;');
  let sent;
  win.fetch = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    const reply = '```json\n{"parts":[{"id":"head","label":"Head","bbox":{"x":10,"y":10,"w":20,"h":20},"pivot":{"x":20,"y":30}}]}\n```';
    return response(200, { choices: [{ message: { content: reply } }] });
  };
  const parts = plain(await run('analyzeCharacter()'));
  win.scaleDataUrl = original;
  assert.equal(sent.url, '/proxy/chat/completions');
  assert.equal(sent.body.model, 'mm/vl');
  const content = sent.body.messages[0].content;
  assert.equal(content[1].type, 'image_url');
  assert.match(content[0].text, /100 x 200/);
  assert.deepEqual(parts[0].bbox, { x: 20, y: 20, w: 40, h: 40 });
  assert.deepEqual(parts[0].pivot, { x: 40, y: 60 });
});

test('generateImage posts the 9router body and returns a data URL', async () => {
  connect('proxy');
  run('S.models.imageId = "ag/gemini-3.1-flash-image"; S.options.watermark = false; S.options.promptExtend = false; S.limits.image.minDelayMs = 0;');
  const bodies = [];
  win.fetch = async (url, init) => { bodies.push({ url, body: JSON.parse(init.body) }); return response(200, { data: [{ b64_json: 'QUJD' }] }); };
  const out = await run('generateImage("a cat", "data:image/png;base64,REF")');
  assert.equal(out, 'data:image/png;base64,QUJD');
  assert.equal(bodies[0].url, '/proxy/images/generations');
  assert.equal(bodies[0].body.model, 'ag/gemini-3.1-flash-image');
  assert.equal(bodies[0].body.output_format, 'png');
  assert.equal(bodies[0].body.watermark, false);
  assert.equal(bodies[0].body.image, 'data:image/png;base64,REF');
  win.fetch = async () => response(200, { data: [] });
  await assert.rejects(run('generateImage("x")'), (err) => err.kind === 'badjson');
});

/* ---------- rate limiter ---------- */

test('limiter: concurrency 1 runs jobs one at a time, in order', async () => {
  const RateLimiter = run('RateLimiter');
  const lim = new RateLimiter({ rpm: 100, concurrency: 1, minDelayMs: 0, retries: 0 }, fakeClock());
  let active = 0; let maxActive = 0; const order = [];
  const job = (n) => async () => {
    active += 1; maxActive = Math.max(maxActive, active); order.push(n);
    await flush(); active -= 1; return n;
  };
  const results = await Promise.all([1, 2, 3].map((n) => lim.schedule(job(n))));
  assert.deepEqual(results, [1, 2, 3]);
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(maxActive, 1);
});

test('limiter: requests-per-minute cap holds the third job for a minute', async () => {
  const RateLimiter = run('RateLimiter');
  const clock = fakeClock();
  const lim = new RateLimiter({ rpm: 2, concurrency: 5, minDelayMs: 0, retries: 0 }, clock);
  const startedAt = [];
  const promises = [0, 1, 2].map(() => lim.schedule(async () => { startedAt.push(clock.now()); }));
  await clock.advance(0);
  assert.equal(startedAt.length, 2);
  await clock.advance(59999);
  assert.equal(startedAt.length, 2);
  await clock.advance(1);
  await Promise.all(promises);
  assert.deepEqual(startedAt, [0, 0, 60000]);
});

test('limiter: minimum delay spaces out starts', async () => {
  const RateLimiter = run('RateLimiter');
  const clock = fakeClock();
  const lim = new RateLimiter({ rpm: 100, concurrency: 3, minDelayMs: 1000, retries: 0 }, clock);
  const startedAt = [];
  const promises = [0, 1].map(() => lim.schedule(async () => { startedAt.push(clock.now()); }));
  await clock.advance(999);
  assert.equal(startedAt.length, 1);
  await clock.advance(1);
  await Promise.all(promises);
  assert.deepEqual(startedAt, [0, 1000]);
});

test('limiter: retryable errors back off exponentially; Retry-After wins; others fail fast', async () => {
  const RateLimiter = run('RateLimiter');
  const clock = fakeClock();
  const lim = new RateLimiter({ rpm: 100, concurrency: 1, minDelayMs: 0, retries: 2 }, clock);
  let attempts = 0;
  const p = lim.schedule(async () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('429'), { retryable: true });
    return 'done';
  });
  await clock.advance(0);
  assert.equal(attempts, 1);
  await clock.advance(999);
  assert.equal(attempts, 1);
  await clock.advance(1);
  assert.equal(attempts, 2);
  await clock.advance(2000);
  assert.equal(await p, 'done');

  let tries = 0;
  const withHeader = lim.schedule(async () => {
    tries += 1;
    if (tries === 1) throw Object.assign(new Error('429'), { retryable: true, retryAfterMs: 5000 });
    return 'ok';
  });
  await clock.advance(4999);
  assert.equal(tries, 1);
  await clock.advance(1);
  assert.equal(await withHeader, 'ok');

  let hard = 0;
  await assert.rejects(lim.schedule(async () => { hard += 1; throw new Error('fatal'); }), /fatal/);
  assert.equal(hard, 1);
});

test('limiter: cancelAll rejects queued jobs and aborts the in-flight signal', async () => {
  const RateLimiter = run('RateLimiter');
  const lim = new RateLimiter({ rpm: 100, concurrency: 1, minDelayMs: 0, retries: 0 }, fakeClock());
  let release; let signal;
  const first = lim.schedule(({ signal: s }) => { signal = s; return new Promise((resolve) => { release = resolve; }); });
  const second = lim.schedule(async () => 'never');
  await flush();
  lim.cancelAll();
  await assert.rejects(second, (err) => err.name === 'AbortError');
  assert.equal(signal.aborted, true);
  release('first-result');
  assert.equal(await first, 'first-result');
});

/* ---------- svg + serialize ---------- */

test('buildSvg writes one valid group per part, ordered by z, with escaped labels', () => {
  const parts = [
    { id: 'torso', label: 'Torso & "core"', parent: null, bbox: { x: 0, y: 0, w: 10, h: 10 }, pivot: { x: 5, y: 5 }, occluded: false, z: 2 },
    { id: 'head', label: 'Head', parent: 'torso', bbox: { x: 0, y: 0, w: 5, h: 5 }, pivot: { x: 2, y: 2 }, occluded: true, z: 1 }
  ];
  const images = { head: { dataUrl: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 5, h: 5 }, torso: { dataUrl: 'data:image/png;base64,BBBB', x: 0, y: 0, w: 10, h: 10 } };
  const svg = run('buildSvg(' + JSON.stringify({ width: 40, height: 60 }) + ',' + JSON.stringify(parts) + ',' + JSON.stringify(images) + ', {})');
  const doc = new win.DOMParser().parseFromString(svg, 'image/svg+xml');
  assert.equal(doc.getElementsByTagName('parsererror').length, 0);
  const groups = Array.from(doc.querySelectorAll('g[data-label]'));
  assert.deepEqual(groups.map((g) => g.getAttribute('id')), ['head', 'torso']);
  assert.equal(groups[0].getAttribute('data-parent'), 'torso');
  assert.equal(groups[0].getAttribute('data-pivot-x'), '2');
  assert.equal(groups[0].getAttribute('data-occluded'), 'true');
  assert.equal(groups[1].getAttribute('data-label'), 'Torso & "core"');
  assert.equal(groups[0].querySelectorAll('image').length, 1);
  assert.equal(doc.documentElement.getAttribute('viewBox'), '0 0 40 60');
  assert.equal(groups[0].querySelector('circle').getAttribute('display'), 'none');
});

test('project file round-trips and old v1 files still load', () => {
  run(`
    S.source = { dataUrl: "data:image/png;base64,AAAA", width: 100, height: 100, name: "a.png" };
    S.parts = validateParts([{ id: "head", label: "Head", bbox: [10, 10, 20, 20], z: 3 }], 100, 100);
    S.results = { partImages: { head: { dataUrl: "data:image/png;base64,BBBB", x: 10, y: 10, w: 20, h: 20 } }, stamp: 5 };
  `);
  const json = run('JSON.stringify(serializeProject())');
  const before = plain(run('S.parts'));
  run('resetProject()');
  assert.equal(run('S.parts.length'), 0);
  run('deserializeProject(' + JSON.stringify(json) + ')');
  assert.deepEqual(plain(run('S.parts')), before);
  assert.equal(run('S.results.partImages.head.w'), 20);

  const v1 = { version: 1, source: { dataUrl: 'data:image/png;base64,AAAA', width: 50, height: 50, name: 'old.png' }, parts: [{ id: 'arm', label: 'Arm', box: { x: 1, y: 2, w: 10, h: 12 } }] };
  run('deserializeProject(' + JSON.stringify(v1) + ')');
  assert.deepEqual(plain(run('S.parts[0].bbox')), { x: 1, y: 2, w: 10, h: 12 });
  assert.throws(() => run('deserializeProject({ app: "other" })'), /not an Intobones project/);
});

test('undo and redo restore earlier part lists', () => {
  run(`
    resetProject();
    S.source = { dataUrl: "data:image/png;base64,AAAA", width: 100, height: 100, name: "a.png" };
    S.parts = [];
    edit((s) => { s.parts.push(newPart("One")); }, "add");
    edit((s) => { s.parts.push(newPart("Two")); }, "add");
  `);
  assert.equal(run('S.parts.length'), 2);
  run('undo()');
  assert.equal(run('S.parts.length'), 1);
  run('redo()');
  assert.equal(run('S.parts.length'), 2);
  assert.equal(run('canRedo()'), false);
  assert.deepEqual(plain(run('S.parts.map((p) => p.id)')), ['One', 'Two']);
});

test('cropRect pads, clamps to the image and never returns an empty rectangle', () => {
  const rect = (bbox, pad) => plain(run('cropRect({ bbox: ' + JSON.stringify(bbox) + ' }, ' + pad + ', 100, 80)'));
  assert.deepEqual(rect({ x: 10, y: 10, w: 20, h: 20 }, 4), { x: 6, y: 6, w: 28, h: 28 });
  assert.deepEqual(rect({ x: 0, y: 0, w: 200, h: 200 }, 10), { x: 0, y: 0, w: 100, h: 80 });
});

/* ---------- static analyzer (tools/docs.js) ---------- */

const HEADER = (name) => '/* js/' + name + ' — test file\n * State: none\n * Gotchas: none\n *\n * @auto-deps-begin\n * @auto-deps-end\n */\n';
const entry = (file, body) => ({ file, src: HEADER(file) + body });

test('analyzer accepts runtime cross-file calls, local shadowing and builtins', () => {
  const res = analyzeProject([
    entry('a.js', 'function a(zzz) { const [x, { y }] = zzz; return b(x + y) + Math.max(1, 2); }\n'),
    entry('b.js', 'function b(n) { try { return n; } catch (e) { return a(e); } }\n')
  ]);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.files[0].uses, ['b']);
  assert.deepEqual(res.files[1].uses, ['a']);
});

test('analyzer flags undefined names, load-order violations and duplicate globals', () => {
  const undef = analyzeProject([entry('a.js', 'function f() { return nope; }\n')]);
  assert.match(undef.errors.join('\n'), /"nope" is not defined/);
  const order = analyzeProject([entry('a.js', 'const x = later();\n'), entry('b.js', 'function later() { return 1; }\n')]);
  assert.match(order.errors.join('\n'), /used at load time but defined later/);
  const dupes = analyzeProject([entry('a.js', 'function same() {}\n'), entry('b.js', 'function same() {}\n')]);
  assert.match(dupes.errors.join('\n'), /"same" is already defined/);
  const noHeader = analyzeProject([{ file: 'c.js', src: 'function c() {}\n' }]);
  assert.match(noHeader.errors.join('\n'), /missing @auto-deps/);
});

test('injectDeps is idempotent and writes Defines/Uses between the markers', () => {
  const src = HEADER('a.js') + 'function a() {}\n';
  const once = injectDeps(src, ['a'], ['b']);
  assert.match(once, /@auto-deps-begin\n \* Defines: a\n \* Uses: b\n \* @auto-deps-end/);
  assert.equal(injectDeps(once, ['a'], ['b']), once);
});

/* ---------- server ---------- */

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('server: serves static files, 404s missing assets and blocks traversal', async () => {
  const server = createServer();
  const port = await listen(server);
  try {
    const index = await fetch('http://127.0.0.1:' + port + '/');
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type'), /text\/html/);
    const js = await fetch('http://127.0.0.1:' + port + '/js/app.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal((await fetch('http://127.0.0.1:' + port + '/js/missing.js')).status, 404);
    const spa = await fetch('http://127.0.0.1:' + port + '/some/route');
    assert.match(await spa.text(), /<title>Intobones/);
    const sneaky = await fetch('http://127.0.0.1:' + port + '/%2e%2e/package.json');
    assert.doesNotMatch(await sneaky.text(), /devDependencies/);
  } finally { server.close(); }
});

test('server: proxy forwards path, query, auth and body to X-Target-Base and reports failures', async () => {
  const seen = [];
  const upstream = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, method: req.method, auth: req.headers.authorization, body });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Retry-After': '7' });
      res.end(JSON.stringify({ echo: body }));
    });
  });
  const upPort = await listen(upstream);
  const server = createServer();
  const port = await listen(server);
  const base = 'http://127.0.0.1:' + port;
  try {
    const get = await fetch(base + '/proxy/models?x=1', { headers: { 'X-Target-Base': 'http://127.0.0.1:' + upPort + '/api', Authorization: 'Bearer abc' } });
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('retry-after'), '7');
    const post = await fetch(base + '/proxy/images/generations', {
      method: 'POST',
      headers: { 'X-Target-Base': 'http://127.0.0.1:' + upPort + '/api/', 'Content-Type': 'application/json' },
      body: '{"prompt":"cat"}'
    });
    assert.deepEqual(await post.json(), { echo: '{"prompt":"cat"}' });
    assert.deepEqual(seen.map((s) => [s.method, s.url, s.auth]), [['GET', '/api/models?x=1', 'Bearer abc'], ['POST', '/api/images/generations', undefined]]);

    const missing = await fetch(base + '/proxy/models');
    assert.equal(missing.status, 400);
    const bad = await fetch(base + '/proxy/models', { headers: { 'X-Target-Base': 'ftp://example.com' } });
    assert.equal(bad.status, 400);
    const down = await fetch(base + '/proxy/models', { headers: { 'X-Target-Base': 'http://127.0.0.1:1' } });
    assert.equal(down.status, 502);
    assert.equal(down.headers.get('x-proxy-error'), '1');
    const foreign = await fetch(base + '/proxy/models', { headers: { 'X-Target-Base': 'http://127.0.0.1:' + upPort, Origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403);
  } finally { server.close(); upstream.close(); }
});

/* ---------- manual models, show-all, test connection ---------- */

test('classifyModel recognises Cloudflare image models beyond flux', () => {
  const classify = (id) => run('classifyModel(' + JSON.stringify(id) + ')');
  [
    'cf/@cf/black-forest-labs/flux-1-schnell', 'cf/@cf/stabilityai/stable-diffusion-xl-base-1.0',
    'cf/@cf/bytedance/stable-diffusion-xl-lightning', 'cf/@cf/lykon/dreamshaper-8-lcm',
    'cf/@cf/leonardo/phoenix-1.0', 'cf/@cf/leonardo/lucid-origin', 'cf/@cf/runwayml/stable-diffusion-v1-5-inpainting'
  ].forEach((id) => assert.equal(classify(id), 'image', id));
  assert.equal(classify('cf/@cf/meta/llama-4-scout-17b-16e-instruct'), 'vision');
});

test('manual models are added, selected, saved, survive reconnect and can be removed', async () => {
  connect('proxy');
  run('S.models = { all: [], custom: [], vision: [], image: [], visionId: "", imageId: "", overrides: {} }; S.options.showAllModels = false;');
  assert.throws(() => run('addCustomModel("   ", "image")'), (err) => err.kind === 'config');
  assert.throws(() => run('addCustomModel("two words", "image")'), (err) => err.kind === 'config');
  run('addCustomModel("cf/@cf/acme/mystery-gen", "image")');
  assert.equal(run('S.models.imageId'), 'cf/@cf/acme/mystery-gen');
  assert.deepEqual(plain(run('settingsSnapshot().models.custom')), [{ id: 'cf/@cf/acme/mystery-gen', kind: 'image' }]);
  const options = () => Array.from(win.document.querySelector('#sel-image').options).map((o) => o.value);
  assert.ok(options().includes('cf/@cf/acme/mystery-gen'));
  assert.match(win.document.querySelector('#manual-list').textContent, /mystery-gen/);

  win.fetch = async () => response(200, { data: [{ id: 'mm/MiniMax-VL-01' }, { id: 'cf/@cf/black-forest-labs/flux-2-klein-9b' }] });
  await run('discoverModels()');
  assert.equal(run('S.models.imageId'), 'cf/@cf/acme/mystery-gen');
  assert.deepEqual(plain(run('S.models.image')).sort(), ['cf/@cf/acme/mystery-gen', 'cf/@cf/black-forest-labs/flux-2-klein-9b']);

  run('addCustomModel("my/own-vision", "vision")');
  assert.equal(run('S.models.visionId'), 'my/own-vision');
  run('removeCustomModel("cf/@cf/acme/mystery-gen")');
  assert.ok(!options().includes('cf/@cf/acme/mystery-gen'));
  assert.equal(run('S.models.imageId'), 'cf/@cf/black-forest-labs/flux-2-klein-9b');
});

test('the manual-add form in the panel adds the model to the dropdown', () => {
  const doc = win.document;
  doc.querySelector('#in-manual').value = 'cf/@cf/typed/by-hand';
  doc.querySelector('#sel-manual-kind').value = 'image';
  doc.querySelector('#btn-manual').click();
  assert.equal(doc.querySelector('#sel-image').value, 'cf/@cf/typed/by-hand');
  assert.equal(doc.querySelector('#in-manual').value, '');
  run('removeCustomModel("cf/@cf/typed/by-hand")');
});

test('"show every model" puts all models in both dropdowns, except hidden ones', () => {
  run(`
    S.models.custom = [];
    S.models.all = parseModelList({ data: [{ id: "a/chat-model" }, { id: "b/odd-painter" }, { id: "c/text-embedding-x" }] });
    S.models.overrides = {};
    applyClassification();
  `);
  assert.deepEqual(plain(run('S.models.image')), []);
  run('setShowAllModels(true)');
  assert.deepEqual(plain(run('S.models.image')), ['a/chat-model', 'b/odd-painter', 'c/text-embedding-x']);
  assert.deepEqual(plain(run('S.models.vision')), plain(run('S.models.image')));
  run('setModelKind("c/text-embedding-x", "other")');
  assert.ok(!plain(run('S.models.image')).includes('c/text-embedding-x'));
  run('setShowAllModels(false); S.models.overrides = {}; applyClassification();');
  assert.equal(win.document.querySelector('#opt-showall').checked, false);
});

test('testConnection reports ok, a warning when /models is missing, and failures', async () => {
  connect('proxy', 'http://h.test:1/v1');
  win.fetch = async () => response(200, { data: [{ id: 'a' }, { id: 'b' }] });
  let result = plain(await run('testConnection()'));
  assert.equal(result.state, 'ok');
  assert.match(result.message, /2 models listed/);
  assert.match(win.document.querySelector('#chip-conn').textContent, /works/);
  assert.equal(win.document.querySelector('#chip-conn').hidden, false);

  win.fetch = async () => response(404, 'nope');
  result = plain(await run('testConnection()'));
  assert.equal(result.state, 'warn');
  assert.match(result.message, /add model ids by hand/i);

  win.fetch = async () => response(401, { error: { message: 'bad key' } });
  result = plain(await run('testConnection()'));
  assert.equal(result.state, 'fail');
  assert.match(result.message, /bad key/);

  run('S.conn.baseUrl = ""');
  result = plain(await run('testConnection()'));
  assert.equal(result.state, 'fail');
  assert.match(result.message, /Base URL/);
  assert.deepEqual(pageErrors, []);
});
