# Intobones

Turn **one character image** into **one SVG with separate body parts** for 2D game bones rigging.

Intobones uses a single 9router (OpenAI-compatible) API with **two models of your choice**:

| Role | Endpoint | What it does |
|------|----------|--------------|
| Vision model | `POST chat/completions` | Looks at the character, returns body parts, boxes and joint pivots as JSON |
| Image model | `POST images/generations` | Optional: creates a character from text, and completes hidden areas of a part |

The parts themselves are cut from your **original pixels** in the browser (Canvas), so style, size and position never drift.
Everything is packed into one SVG: one `<g id="part">` per body part, with `data-pivot-x/y` and `data-parent` for rigging tools.

## Run

```bash
npm install        # only needed for tests and docs tooling; the app itself has zero dependencies
npm start          # http://127.0.0.1:3500
```

Environment: `PORT` (default 3500), `HOST` (default `127.0.0.1`).

## Use

1. **Connect**: enter the 9router Base URL (for example `http://localhost:20128/v1`) and API key, then *Connect and find models*.
   Use *Test connection* for a quick reachability check (one `GET /models`). Pick a vision model and an image model and press *Test* on each.
   If a model is missing or sits in the wrong list (some Cloudflare models are not recognized by name), add its exact id under *Add a model by hand*, tick *Show every model in both lists*, or fix it under *A model is in the wrong list?*. Manual models are kept when you reconnect. The API key, model choices, rate limits and the last image/result are saved in this browser.
2. **Analyze and edit**: upload, drop or paste a full-body character (or describe one and generate it). Run *Find body parts*, then drag boxes, resize handles and pink pivots until they are right. Set each part's parent to draw the skeleton.
3. **Export**: *Slice parts and continue*, then download the SVG, the individual PNGs, or a project file you can reopen later.

### CORS

By default the browser talks to the small built-in proxy (`/proxy/*`), which forwards to your Base URL, so CORS never gets in the way.
The proxy only listens on `127.0.0.1` and refuses requests from other origins. *Direct* mode skips it, but then the API must send CORS headers.

### Generation rate

Each model type has its own queue: requests per minute, parallel requests, minimum delay and retries with backoff (429 and 5xx, honoring `Retry-After`). Queued requests can be cancelled.

## Develop

```bash
npm run docs       # regenerate file headers, docs/MAP.md and docs/SYMBOLS.md
npm test           # docs check + unit tests (jsdom, mocked API)
npm run test:ui    # headless Chromium test (set CHROME_PATH if none is found)
```

Read `AGENTS.md` first when changing code, and `docs/ARCHITECTURE.md` for the design.

## Notes

- Image-to-image support on `images/generations` depends on the provider. Intobones sends the cropped part in an `image` field; if your model ignores it, hidden-area completion will return a new drawing instead of a repair. The step is optional and off by default.
- The API key is stored in plain text in `localStorage`. Use *Clear saved data* on shared computers.
