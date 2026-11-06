'use strict';
/*
 * Browser sanity test: real Chromium (puppeteer-core) against the real server.
 * Covers what jsdom cannot: canvas slicing, the editor drawing, and layout at phone width.
 * If no Chromium can be launched the test is skipped, unless BROWSER_REQUIRED=1.
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const puppeteer = require('puppeteer-core');
const { createServer } = require('../server');

const SYSTEM_PATHS = [
  process.env.CHROME_PATH,
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

async function launch() {
  const attempts = [];
  for (const executablePath of SYSTEM_PATHS) {
    if (fs.existsSync(executablePath)) attempts.push({ executablePath, args: ['--no-sandbox'] });
  }
  try {
    const chromium = require('@sparticuz/chromium');
    attempts.push({ executablePath: await chromium.executablePath(), args: chromium.args });
  } catch (err) { /* package unavailable on this platform */ }
  for (const opts of attempts) {
    try { return await puppeteer.launch({ headless: true, ...opts }); } catch (err) { /* try the next one */ }
  }
  return null;
}

async function main() {
  const browser = await launch();
  if (!browser) {
    const msg = 'No Chromium could be launched.';
    if (process.env.BROWSER_REQUIRED === '1') throw new Error(msg);
    console.log('SKIP: ' + msg + ' Set CHROME_PATH to run the browser test.');
    return;
  }
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const problems = [];
  try {
    const page = await browser.newPage();
    page.on('pageerror', (err) => problems.push('pageerror: ' + err.message));
    page.on('console', (msg) => { if (msg.type() === 'error') problems.push('console: ' + msg.text()); });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0' });

    assert.equal(await page.$$eval('#stepper .step', (els) => els.length), 3, 'stepper renders three steps');
    assert.ok(await page.$('#in-base'), 'connect panel renders');

    const flow = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 200; c.height = 300;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 300);
      g.fillStyle = '#d33'; g.fillRect(70, 20, 60, 60);
      g.fillStyle = '#36c'; g.fillRect(60, 90, 80, 120);
      await setSourceFromDataUrl(c.toDataURL('image/png'), 'fixture.png');
      edit((s) => {
        s.parts = validateParts([
          { id: 'head', label: 'Head', parent: 'torso', bbox: { x: 70, y: 20, w: 60, h: 60 }, pivot: { x: 100, y: 80 }, z: 2 },
          { id: 'torso', label: 'Torso', parent: null, bbox: { x: 60, y: 90, w: 80, h: 120 }, polygon: [[60, 90], [140, 90], [140, 210], [60, 210]], pivot: { x: 100, y: 150 }, z: 1 }
        ], 200, 300);
        s.selectedId = 'head';
      }, 'fixture');
      await sliceAll();
      goStep(3);
      commit();
      const head = S.results.partImages.head;
      const probe = document.createElement('canvas');
      const img = await loadImage(head.dataUrl);
      probe.width = img.width; probe.height = img.height;
      probe.getContext('2d').drawImage(img, 0, 0);
      const px = probe.getContext('2d').getImageData(Math.floor(img.width / 2), Math.floor(img.height / 2), 1, 1).data;
      return { keys: Object.keys(S.results.partImages), headSize: [head.w, head.h], center: Array.from(px), svg: currentSvg() };
    });
    assert.deepEqual(flow.keys.sort(), ['head', 'torso']);
    assert.deepEqual(flow.headSize, [68, 68], 'head crop includes the default 4px padding');
    assert.ok(flow.center[0] > 180 && flow.center[1] < 90, 'head slice keeps the original red pixels');
    assert.equal((flow.svg.match(/<g id=/g) || []).length - 1, 2, 'svg has one group per part (plus the wrapper)');
    await page.waitForSelector('#svg-preview img');

    await page.evaluate(() => goStep(2));
    const drawn = await page.evaluate(() => {
      const c = document.querySelector('#editor');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) colored += 1;
      return colored;
    });
    assert.ok(drawn > 1000, 'editor canvas draws the image and boxes');

    await page.setViewport({ width: 375, height: 800 });
    for (const step of [1, 2, 3]) {
      await page.evaluate((n) => goStep(n), step);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 1, 'no horizontal scrolling on step ' + step + ' at 375px (overflow ' + overflow + 'px)');
    }
    assert.deepEqual(problems, [], 'no console or page errors');
    console.log('browser test: ok');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
