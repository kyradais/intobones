# Architecture

Intobones is a zero-build web app: classic `<script>` tags, one global store, a tiny Node server.

## 1. State management

All state lives in the global `S` (`public/js/core/state.js`).

| Helper | Use |
|--------|-----|
| `edit(fn, label)` | Undoable change to `S.parts`: snapshots history, runs `fn(S)`, then `commit()` |
| `commit()` | Call after any direct change to `S`: schedules a debounced save, then `refresh()` |
| `refresh()` | Calls every `subscribe()`d renderer (`syncAll` in `app.js`); never saves |
| `selectPart(id)` | Changes the selection and refreshes |

Lifecycle: `bootstrap()` loads settings, builds the three panels once, subscribes `syncAll`, restores the last session from IndexedDB, then calls `refresh()`.
Panels are built once and updated in place by `sync*Panel()`; controls with focus are skipped so typing is never overwritten.

Only `S.parts` is undoable. The canvas editor mutates the dragged part directly and pushes one history entry on the first real movement, then `commit()` on release.

## 2. Script loading protocol

The order of the `<script>` tags in `public/index.html` is the dependency order:
`core` → `api` → `model` → `processing` → `export` → `view` → `app.js`.

A script may reference a later script's symbols only inside functions (run time). Root-level code (load time) may use earlier scripts only.
`tools/docs.js` enforces this, plus: no undefined names, no duplicate globals, files under 400 lines.
`docs/MAP.md` and `docs/SYMBOLS.md` are generated; the `Defines:`/`Uses:` header lines too.

## 3. Roles, API layer and proxy

```
UI ──> pipeline.js ──> vision.js / imagegen.js ──> Limiters.<role>.schedule ──> apiFetch ──> /proxy/* ──> 9router
```

- **Vision model**: `chat/completions` with `image_url` content. The image is downscaled to 1024px, the reply is parsed by `extractJson()` and checked by `validateParts()`, then boxes are scaled back to the source size.
- **Image model**: `images/generations` with the 9router body (`model`, `prompt`, `n`, `size`, `quality`, `background`, `image_detail`, `output_format`, `watermark`, `prompt_extend`), plus `image` for inpainting.
- **Proxy**: the browser calls `/proxy/<path>` with `X-Target-Base: <base url>`. `server.js` forwards method, body, `Authorization` and `Content-Type`, and returns the upstream response. Proxy-side failures return 502 with `X-Proxy-Error: 1`. Cross-origin callers get 403.
- **Rate limiter**: one `RateLimiter` per role, reading `S.limits.<role>` live. Retries only errors flagged `retryable` (429, 5xx).
- **Errors**: `ApiError.kind` is one of `config`, `auth`, `notfound`, `ratelimit`, `server`, `network`, `badjson`, `http`.

## 4. Serialization and backward compatibility

- Settings (`intobones.settings.v1` in localStorage): connection, selected models, overrides, limits, options.
- Session (IndexedDB key `session`): `source`, `parts`, `results` so the last image and slices can be downloaded again after a reload.
- Project file (`serializeProject()`, `PROJECT_VERSION = 2`): `{ app, version, source, parts, options, results }`.
  Loading always goes through `migrateProject()`. v1 files used `part.box`; v2 uses `part.bbox`.

## 5. Recipes

**Add a tool or workflow**: write the function in `processing/pipeline.js` (wrap it in `withBusy()`), add a button in the relevant `build*Panel()`, enable/disable it in the matching `sync*Panel()`.

**Add a UI event listener**: use `h('button', { onclick })` while building the panel, or `addEventListener` in the panel's build function. Do not add listeners inside `sync*Panel()` (it runs on every refresh).

**Add a persistent field**: add the default to `S`; for a setting add it to `settingsSnapshot()`/`loadSettings()`; for project data add it to `serializeProject()`/`deserializeProject()`, bump `PROJECT_VERSION` and add a `migrateProject()` branch; add a unit test in `tests/unit.test.js`.

**Add a new script file**: create it with the standard header, add the `<script>` tag in dependency order, run `npm run docs`.

**Model lists**: `allModels()` merges the discovered models with `S.models.custom` (ids added by hand). `applyClassification()` fills `S.models.vision`/`image` from, in order, the manual kind, `S.models.overrides`, then the `classifyModel()` name heuristic; with `S.options.showAllModels` both lists contain every model that is not hidden.

**Support another model family**: adjust `classifyModel()` (name hints) or let users override in the UI; if the request or response shape differs, change `buildImageBody()`, `imageFromResponse()` or `messageText()` only.

**Add a body-part preset**: extend `DEFAULT_PARTS` in `model/types.js`; the vision prompt lists `DEFAULT_PART_IDS` automatically.

## 6. Tests

- `tests/unit.test.js`: loads the real scripts in jsdom, mocks `fetch`, and uses a fake clock for the limiter. No real API calls.
- `tests/browser.test.js`: Chromium via puppeteer-core; covers canvas slicing, editor drawing and mobile layout.
- `npm test` also runs `tools/docs.js --check`.
