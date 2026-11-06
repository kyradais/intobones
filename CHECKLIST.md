# Feature checklist

`[x]` implemented, `[-]` in progress, `[ ]` planned.

## Core architecture and foundation
- [x] Global store `S` with `edit()`, `commit()`, `refresh()`
- [x] Undo/redo for part edits
- [x] Settings in localStorage, last session in IndexedDB (memory fallback)
- [x] Project file save/load with version migration (v1 to v2)
- [x] Static analysis, living docs (`tools/docs.js`)

## API layer
- [x] 9router client with proxy and direct modes, readable errors
- [x] Local proxy in `server.js` (same-origin only, 127.0.0.1)
- [x] Model discovery with `/v1` fallback, vision/image classification, manual override
- [x] Test button per model
- [x] Test connection button (GET /models, with ok/warning/failure result)
- [x] Manual model ids (vision or image), persisted, kept across reconnects
- [x] "Show every model in both lists" option
- [x] Vision analysis (JSON contract, tolerant parser, coordinate formats)
- [x] Image generation (b64 and URL results)
- [x] Per-role rate limiter (rpm, concurrency, delay, retries, Retry-After, cancel)

## Processing and export
- [x] Canvas slicer from original pixels, padding, polygon clipping
- [x] Optional inpainting of hidden parts
- [x] Single SVG export with pivots, parents, z order
- [x] Per-part PNG download
- [ ] Background removal for generated characters
- [ ] ZIP download of all PNGs
- [ ] Export to Spine/DragonBones JSON skeleton

## UI panels and tooling
- [x] Connect panel (connection, models, rate limits, options)
- [x] Part editor: select, move, resize, pivot drag, parent, hidden flag, add/delete
- [x] Skeleton overlay (bones between pivots)
- [x] Upload, drag and drop, paste, generate from text
- [x] SVG preview and part thumbnails
- [ ] Keyboard nudging of selected part
- [ ] Draw a new box by dragging on empty canvas

## Tests
- [x] Unit tests (jsdom): models, client, vision parsing, validation, limiter, SVG, serialize, analyzer, server
- [x] Browser test (Chromium): slicing, editor drawing, no overflow at 375px
- [ ] Visual regression screenshots
