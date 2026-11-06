'use strict';
/*
 * Intobones server — zero dependencies.
 *  - Serves ./public as static files (extension-less unknown paths fall back to index.html).
 *  - /proxy/<path> forwards to the API base URL given in the X-Target-Base header, so the
 *    browser never talks cross-origin to the 9router (no CORS problems).
 *  - Binds to 127.0.0.1 by default: the proxy is meant for local use only.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 25 * 1024 * 1024;
const PROXY_TIMEOUT_MS = 120000;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection']);
const FORWARD_HEADERS = ['content-type', 'authorization', 'accept', 'user-agent'];

function sendJson(res, status, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, headers));
  res.end(body);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

function serveStatic(req, res) {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://local').pathname); }
  catch (e) { return sendJson(res, 400, { error: { message: 'Bad request path' } }); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJson(res, 403, { error: { message: 'Forbidden' } });
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return pipeFile(res, file);
    if (path.extname(rel)) return sendJson(res, 404, { error: { message: 'Not found' } });
    pipeFile(res, path.join(PUBLIC_DIR, 'index.html'));
  });
}

function pipeFile(res, file) {
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  const stream = fs.createReadStream(file);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

function resolveTarget(req) {
  const target = req.headers['x-target-base'];
  if (!target) throw new Error('Missing X-Target-Base header');
  const base = new URL(String(target));
  if (base.protocol !== 'http:' && base.protocol !== 'https:') throw new Error('Target must be http or https');
  const rest = req.url.slice('/proxy'.length) || '/';
  return new URL(base.href.replace(/\/+$/, '') + rest);
}

function handleProxy(req, res) {
  if (!sameOrigin(req)) return sendJson(res, 403, { error: { message: 'Cross-origin proxy use is blocked' } });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, OPTIONS' });
    return res.end();
  }
  let url;
  try { url = resolveTarget(req); }
  catch (e) { return sendJson(res, 400, { error: { message: e.message } }, { 'X-Proxy-Error': '1' }); }

  const headers = {};
  FORWARD_HEADERS.forEach((name) => { if (req.headers[name]) headers[name] = req.headers[name]; });
  if (req.headers['content-length']) headers['content-length'] = req.headers['content-length'];

  const lib = url.protocol === 'https:' ? https : http;
  const upstream = lib.request(url, { method: req.method, headers, timeout: PROXY_TIMEOUT_MS }, (up) => {
    const out = {};
    Object.keys(up.headers).forEach((k) => { if (!HOP_BY_HOP.has(k)) out[k] = up.headers[k]; });
    res.writeHead(up.statusCode || 502, out);
    up.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('Upstream timed out')));
  upstream.on('error', (e) => {
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, { error: { message: 'Could not reach ' + url.origin + ': ' + e.message } }, { 'X-Proxy-Error': '1' });
  });

  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY) {
      upstream.destroy();
      if (!res.headersSent) sendJson(res, 413, { error: { message: 'Request body too large' } }, { 'X-Proxy-Error': '1' });
      req.destroy();
    }
  });
  req.pipe(upstream);
}

function createServer() {
  return http.createServer((req, res) => {
    if (req.url === '/proxy' || req.url.startsWith('/proxy/')) return handleProxy(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: { message: 'Method not allowed' } });
    serveStatic(req, res);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3500;
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => {
    console.log('Intobones running at http://' + host + ':' + port);
  });
}

module.exports = { createServer };
