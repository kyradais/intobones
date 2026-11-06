# Instructions for AI coding agents

## Onboarding order

1. Read `docs/MAP.md` (what each file is for, in load order).
2. Open the one or two scripts related to your task.
3. Use `docs/SYMBOLS.md` to find where a global lives.
4. Check `CHECKLIST.md` before adding a feature (it may already exist or be planned).

## Rules

- **Zero build.** Plain scripts loaded by `<script>` tags in `public/index.html`. No bundler, no framework, no `import`/`export` in `public/js`.
- **File size.** No frontend script over 400 lines. Split by responsibility and add the new file to `index.html` in dependency order.
- **Header block.** Every `public/js` file starts with the standard header (purpose, `State:`, `Gotchas:`, and the `@auto-deps-begin/@auto-deps-end` markers). Never edit the lines between the markers by hand.
- **State.** All state lives in `S` (`core/state.js`). Undoable part changes go through `edit(fn, label)`. After changing settings or other fields directly, call `commit()`. `refresh()` only re-renders.
- **Persistence.** Any new persistent field must be added to `settingsSnapshot()`/`loadSettings()` (settings) or `serializeProject()`/`deserializeProject()` (project), with a `migrateProject()` branch when the format changes.
- **API calls.** Always go through `apiFetch()` and the matching `Limiters.<role>.schedule()`. Never log or display the API key.
- **Load order.** A script may use another script's symbols at load time only if that script is listed earlier. Use inside functions is fine in any order.
- **UI.** Build DOM with `h()`. Panels are built once and updated by `sync*Panel()` on every `refresh()`; do not rebuild a control that has focus.

## After every change

```bash
npm run docs   # when you added/renamed/removed a global, or touched a header
npm test       # docs check + unit tests; must exit 0
npm run test:ui  # when you touched canvas, slicing, SVG export or layout
```

`npm test` fails if the generated docs are stale, a name is undefined, or a load-time use happens before its definition.
