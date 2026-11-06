#!/usr/bin/env node
'use strict';
/*
 * tools/docs.js — static audit + living documentation for the zero-build frontend.
 *
 *   node tools/docs.js          regenerate headers (Defines/Uses) and docs/MAP.md, docs/SYMBOLS.md
 *   node tools/docs.js --check  fail (exit 1) on errors or stale docs, write nothing
 *
 * Reads the script order from public/index.html, parses every file with acorn, resolves identifiers
 * with a scope walk, and reports undefined variables, load-order violations and duplicate globals.
 */
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DOCS = path.join(ROOT, 'docs');
const MAX_LINES = 400;
const SCRIPT_RE = /<script src="js\/([^"]+)"><\/script>/g;

const GLOBALS = new Set((
  'Object Array String Number Boolean Symbol Math JSON Date RegExp Error TypeError RangeError SyntaxError EvalError ' +
  'Promise Map Set WeakMap WeakSet Proxy Reflect parseInt parseFloat isNaN isFinite NaN Infinity undefined globalThis ' +
  'encodeURIComponent decodeURIComponent encodeURI decodeURI BigInt Intl ArrayBuffer Uint8Array Uint8ClampedArray ' +
  'Int32Array Float32Array Float64Array DataView eval arguments window self document navigator location history ' +
  'localStorage sessionStorage indexedDB console fetch Headers Request Response FormData URL URLSearchParams Blob File ' +
  'FileReader FileList Image HTMLElement HTMLCanvasElement Element Node Event CustomEvent KeyboardEvent PointerEvent ' +
  'MouseEvent AbortController AbortSignal setTimeout clearTimeout setInterval clearInterval requestAnimationFrame ' +
  'cancelAnimationFrame queueMicrotask atob btoa alert confirm prompt getComputedStyle devicePixelRatio ResizeObserver ' +
  'MutationObserver DOMParser XMLSerializer TextEncoder TextDecoder structuredClone createImageBitmap performance ' +
  'crypto matchMedia IntersectionObserver OffscreenCanvas Path2D CanvasRenderingContext2D ImageData DataTransfer'
).split(/\s+/));

/* ---------- AST helpers ---------- */

function walkChildren(node, fn) {
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'type') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach((c) => { if (c && typeof c.type === 'string') fn(c); });
    else if (value && typeof value.type === 'string') fn(value);
  }
}

function patternNames(p, names) {
  if (!p) return;
  switch (p.type) {
    case 'Identifier': names.add(p.name); break;
    case 'ObjectPattern': p.properties.forEach((prop) => patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, names)); break;
    case 'ArrayPattern': p.elements.forEach((el) => patternNames(el, names)); break;
    case 'AssignmentPattern': patternNames(p.left, names); break;
    case 'RestElement': patternNames(p.argument, names); break;
    default: break;
  }
}

/* Names declared in `node`, not entering nested functions (block scoping is intentionally over-approximated). */
function declaredIn(node, names) {
  walkChildren(node, (child) => {
    switch (child.type) {
      case 'FunctionDeclaration': names.add(child.id.name); return;
      case 'FunctionExpression': case 'ArrowFunctionExpression': return;
      case 'ClassDeclaration': names.add(child.id.name); break;
      case 'VariableDeclaration': child.declarations.forEach((d) => patternNames(d.id, names)); break;
      case 'CatchClause': patternNames(child.param, names); break;
      default: break;
    }
    declaredIn(child, names);
  });
}

function topLevelDefines(ast) {
  const out = new Map();
  const add = (name, line, kind) => { if (!out.has(name)) out.set(name, { line, kind }); };
  ast.body.forEach((node) => {
    if (node.type === 'FunctionDeclaration') add(node.id.name, node.loc.start.line, 'function');
    else if (node.type === 'ClassDeclaration') add(node.id.name, node.loc.start.line, 'class');
    else if (node.type === 'VariableDeclaration') {
      node.declarations.forEach((d) => {
        const names = new Set();
        patternNames(d.id, names);
        names.forEach((n) => add(n, node.loc.start.line, node.kind));
      });
    }
  });
  return out;
}

function analyzeSource(src, file) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', locations: true });
  const rootNames = new Set();
  declaredIn(ast, rootNames);
  const defines = topLevelDefines(ast);
  defines.forEach((_, name) => rootNames.add(name));
  const refs = [];

  function ref(name, node, scopes, depth) {
    if (scopes.some((s) => s.has(name))) return;
    refs.push({ name, line: node.loc.start.line, loadTime: depth === 0, file });
  }

  function visitPattern(p, scopes, depth) {
    if (!p) return;
    switch (p.type) {
      case 'ObjectPattern':
        p.properties.forEach((prop) => {
          if (prop.type === 'RestElement') return visitPattern(prop.argument, scopes, depth);
          if (prop.computed) visit(prop.key, scopes, depth);
          return visitPattern(prop.value, scopes, depth);
        });
        break;
      case 'ArrayPattern': p.elements.forEach((el) => visitPattern(el, scopes, depth)); break;
      case 'AssignmentPattern': visitPattern(p.left, scopes, depth); visit(p.right, scopes, depth); break;
      case 'RestElement': visitPattern(p.argument, scopes, depth); break;
      case 'Identifier': break;
      default: visit(p, scopes, depth);
    }
  }

  function visitFunction(node, scopes, depth) {
    const names = new Set();
    node.params.forEach((p) => patternNames(p, names));
    if (node.type === 'FunctionExpression' && node.id) names.add(node.id.name);
    if (node.type !== 'ArrowFunctionExpression') names.add('arguments');
    if (node.body.type === 'BlockStatement') declaredIn(node.body, names);
    const inner = scopes.concat([names]);
    node.params.forEach((p) => visitPattern(p, inner, depth + 1));
    visit(node.body, inner, depth + 1);
  }

  function visit(node, scopes, depth) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': ref(node.name, node, scopes, depth); return;
      case 'MemberExpression':
        visit(node.object, scopes, depth);
        if (node.computed) visit(node.property, scopes, depth);
        return;
      case 'Property':
        if (node.computed) visit(node.key, scopes, depth);
        visit(node.value, scopes, depth);
        return;
      case 'PropertyDefinition':
        if (node.computed) visit(node.key, scopes, depth);
        if (node.value) visit(node.value, scopes, depth + 1);
        return;
      case 'MethodDefinition':
        if (node.computed) visit(node.key, scopes, depth);
        visit(node.value, scopes, depth);
        return;
      case 'LabeledStatement': visit(node.body, scopes, depth); return;
      case 'BreakStatement': case 'ContinueStatement': case 'MetaProperty': return;
      case 'FunctionDeclaration': case 'FunctionExpression': case 'ArrowFunctionExpression':
        visitFunction(node, scopes, depth); return;
      case 'VariableDeclarator':
        visitPattern(node.id, scopes, depth);
        visit(node.init, scopes, depth);
        return;
      case 'CatchClause':
        visitPattern(node.param, scopes, depth);
        visit(node.body, scopes, depth);
        return;
      default:
        walkChildren(node, (child) => visit(child, scopes, depth));
    }
  }

  visit(ast, [rootNames], 0);
  return { defines, refs, lines: src.replace(/\n$/, '').split('\n').length };
}

/* ---------- project analysis ---------- */

function headerDescription(src) {
  const m = /^\/\*\s*\S+\s+[—-]\s+(.+)$/m.exec(src.split('\n')[0] || '');
  return m ? m[1].trim() : '';
}

function wrapList(label, list) {
  const items = list.length ? list : ['(none)'];
  const lines = [];
  let cur = ' * ' + label + ':';
  items.forEach((item, i) => {
    const tok = ' ' + item + (i < items.length - 1 ? ',' : '');
    if ((cur + tok).length > 100) { lines.push(cur); cur = ' *  ' + tok; } else cur += tok;
  });
  lines.push(cur);
  return lines.join('\n') + '\n';
}

const MARKER_RE = /( \* @auto-deps-begin\n)([\s\S]*?)( \* @auto-deps-end)/;

function injectDeps(src, defines, uses) {
  if (!MARKER_RE.test(src)) return null;
  const body = wrapList('Defines', defines) + wrapList('Uses', uses);
  return src.replace(MARKER_RE, (_m, a, _b, c) => a + body + c);
}

/** entries: [{ file, src }] in script load order. Pure: touches no files. */
function analyzeProject(entries) {
  const errors = [];
  const warnings = [];
  const first = entries.map((e) => ({ file: e.file, src: e.src, info: null }));
  first.forEach((e) => {
    try { e.info = analyzeSource(e.src, e.file); } catch (err) { errors.push(e.file + ': parse error: ' + err.message); }
  });
  const owner = new Map();
  first.forEach((e, idx) => {
    if (!e.info) return;
    e.info.defines.forEach((_d, name) => {
      if (owner.has(name)) errors.push(e.file + ': global "' + name + '" is already defined in ' + entries[owner.get(name)].file);
      else owner.set(name, idx);
    });
  });
  const result = first.map((e, idx) => {
    const uses = new Set();
    if (e.info) {
      e.info.refs.forEach((r) => {
        if (owner.has(r.name)) {
          const defIdx = owner.get(r.name);
          if (defIdx === idx) return;
          uses.add(r.name);
          if (r.loadTime && defIdx > idx) errors.push(e.file + ':' + r.line + ': "' + r.name + '" is used at load time but defined later in ' + entries[defIdx].file);
        } else if (!GLOBALS.has(r.name)) {
          errors.push(e.file + ':' + r.line + ': "' + r.name + '" is not defined in any script');
        }
      });
      if (e.info.lines > MAX_LINES) warnings.push(e.file + ': ' + e.info.lines + ' lines (limit ' + MAX_LINES + ')');
    }
    const defines = e.info ? Array.from(e.info.defines.keys()).sort() : [];
    const sortedUses = Array.from(uses).sort();
    const head = e.src.slice(0, 900);
    if (!/@auto-deps-begin/.test(head)) errors.push(e.file + ': missing @auto-deps-begin/@auto-deps-end header markers');
    if (!/State:/.test(head) || !/Gotchas:/.test(head)) warnings.push(e.file + ': header should have State: and Gotchas: lines');
    const injected = injectDeps(e.src, defines, sortedUses) || e.src;
    let final = null;
    try { final = analyzeSource(injected, e.file); } catch (err) { /* already reported */ }
    return { file: e.file, src: injected, desc: headerDescription(e.src), defines, uses: sortedUses, final };
  });
  return { errors, warnings, files: result, owner };
}

/* ---------- docs rendering ---------- */

function renderMap(files, owner) {
  const rows = files.map((f, i) => {
    const deps = Array.from(new Set(f.uses.map((u) => files[owner.get(u)].file))).sort();
    return '| ' + (i + 1) + ' | `js/' + f.file + '` | ' + (f.desc || '-') + ' | ' + (f.final ? f.final.lines : '?') + ' | ' +
      (deps.length ? deps.map((d) => '`' + d + '`').join(', ') : '-') + ' |';
  });
  return [
    '# Code map',
    '',
    '<!-- AUTO-GENERATED by tools/docs.js. Do not edit by hand; run `npm run docs`. -->',
    '',
    'Files are listed in script load order (the order of the `<script>` tags in `public/index.html`).',
    'A file may only use, at load time, symbols from files listed above it.',
    '',
    '| # | File | Purpose | Lines | Depends on |',
    '|---|------|---------|-------|------------|',
    ...rows,
    ''
  ].join('\n');
}

function renderSymbols(files) {
  const rows = [];
  files.forEach((f) => {
    if (!f.final) return;
    f.final.defines.forEach((d, name) => rows.push({ name, kind: d.kind, where: 'js/' + f.file + ':' + d.line }));
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return [
    '# Global symbols',
    '',
    '<!-- AUTO-GENERATED by tools/docs.js. Do not edit by hand; run `npm run docs`. -->',
    '',
    '| Symbol | Kind | Location |',
    '|--------|------|----------|',
    ...rows.map((r) => '| `' + r.name + '` | ' + r.kind + ' | `' + r.where + '` |'),
    ''
  ].join('\n');
}

/* ---------- main ---------- */

function main() {
  const check = process.argv.includes('--check');
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  const order = Array.from(html.matchAll(SCRIPT_RE)).map((m) => m[1]);
  const entries = [];
  const preErrors = [];
  order.forEach((file) => {
    const full = path.join(PUBLIC, 'js', file);
    if (!fs.existsSync(full)) preErrors.push(file + ': listed in index.html but missing on disk');
    else entries.push({ file, src: fs.readFileSync(full, 'utf8') });
  });
  const jsDir = path.join(PUBLIC, 'js');
  const onDisk = [];
  (function scan(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) scan(p);
      else if (d.name.endsWith('.js')) onDisk.push(path.relative(jsDir, p).split(path.sep).join('/'));
    });
  }(jsDir));
  const warnings = onDisk.filter((f) => !order.includes(f)).map((f) => f + ': not loaded by index.html');

  const res = analyzeProject(entries);
  const errors = preErrors.concat(res.errors);
  warnings.push(...res.warnings);

  const outputs = [];
  res.files.forEach((f) => outputs.push({ file: path.join(PUBLIC, 'js', f.file), content: f.src }));
  outputs.push({ file: path.join(DOCS, 'MAP.md'), content: renderMap(res.files, res.owner) });
  outputs.push({ file: path.join(DOCS, 'SYMBOLS.md'), content: renderSymbols(res.files) });

  const stale = outputs.filter((o) => !fs.existsSync(o.file) || fs.readFileSync(o.file, 'utf8') !== o.content);
  if (check) {
    stale.forEach((o) => errors.push(path.relative(ROOT, o.file) + ' is stale. Run `npm run docs`.'));
  } else if (!errors.length) {
    fs.mkdirSync(DOCS, { recursive: true });
    stale.forEach((o) => fs.writeFileSync(o.file, o.content));
  }

  warnings.forEach((w) => console.warn('warning: ' + w));
  errors.forEach((e) => console.error('error: ' + e));
  if (errors.length) {
    console.error(errors.length + ' problem(s) found.');
    process.exit(1);
  }
  console.log(check ? 'docs: up to date, ' + entries.length + ' scripts checked' : 'docs: ' + stale.length + ' file(s) updated, ' + entries.length + ' scripts checked');
}

if (require.main === module) main();

module.exports = { analyzeSource, analyzeProject, injectDeps, GLOBALS };
