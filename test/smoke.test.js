/**
 * Does the mark boot and draw? Once from src/ and once from dist/, in headless
 * Chromium with SwiftShader for the WebGL2: every shader compiles (the minified
 * ones included), every instance on the demo page claims is-live, ink lands on
 * each canvas after a few frames, nothing is logged as an error, and the
 * overlay leaves when the element it lives with is hidden.
 *
 * Not a pixel comparison of src against dist: the flock is seeded at random,
 * so two runs never match. What this proves is that the minified build runs
 * the same code paths without a compile or link error, which is what a
 * shader minifier can break.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { chromium } from 'playwright';
import { serve } from './serve.js';

/** @type {import('playwright').Browser} */
let browser;
/** @type {{ url: string, close(): void }} */
let server;

before(async () => {
    // the environment's own Chromium, when the installed playwright's build is missing
    const local = process.env.CHROMIUM_EXECUTABLE || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
    let executablePath;
    try { executablePath = chromium.executablePath(); if (!existsSync(executablePath)) executablePath = local; }
    catch { executablePath = local; }
    browser = await chromium.launch({
        executablePath,
        args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    });
    server = await serve();
});
after(async () => { await browser?.close(); server?.close(); });

/**
 * Count the pixels a canvas has ink on. The GL drawing buffer is cleared once
 * composited, so it is copied to a 2d canvas inside a frame, right after the
 * engine's own rAF callback (registered earlier, so it runs first) has drawn.
 * @param {import('playwright').Page} page
 * @param {string} selector
 */
const inked = (page, selector) => page.evaluate((sel) => new Promise((resolve) => {
    requestAnimationFrame(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector(sel));
        const o = document.createElement('canvas');
        o.width = c.width; o.height = c.height;
        const ctx = /** @type {CanvasRenderingContext2D} */ (o.getContext('2d'));
        ctx.drawImage(c, 0, 0);
        const d = ctx.getImageData(0, 0, o.width, o.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 8) n++;
        resolve(n);
    });
}), selector);

for (const variant of ['src', 'dist']) {
    test(`the mark boots and draws from ${variant}/`, async () => {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
        /** @type {string[]} */
        const errors = [];
        page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));
        await page.goto(`${server.url}/demo/${variant === 'dist' ? '?dist' : ''}`);

        // every instance claimed the page
        await page.waitForSelector('#masthead.is-live', { timeout: 15000 });
        await page.waitForSelector('#splash-mark.is-live');
        await page.waitForSelector('.inkmark-overlay.is-live');
        const handles = await page.evaluate(() => Object.entries(window.__inkmark).map(([k, v]) => [k, !!v]));
        assert.deepEqual(handles, [['head', true], ['sig', true], ['over', true]]);

        // and drew on it: let the flock gather for a moment first
        await page.waitForTimeout(1200);
        const head = await inked(page, '#masthead canvas');
        const sig = await inked(page, '#splash-mark canvas');
        const over = await inked(page, '.inkmark-overlay canvas');
        assert.ok(head > 2000, `masthead ink: ${head} px`);
        assert.ok(sig > 300, `signature ink: ${sig} px`);
        assert.ok(over > 300, `overlay ink: ${over} px`);

        // the flee reacts to the pointer without error, and a resize re-syncs
        await page.mouse.move(500, 150);
        await page.setViewportSize({ width: 700, height: 800 });
        await page.waitForTimeout(300);

        // pressing Play hides the splash: the overlay fades and removes itself
        await page.click('#play');
        await page.waitForFunction(() => !document.querySelector('.inkmark-overlay'), null, { timeout: 5000 });
        await page.evaluate(() => window.__inkmark.head.destroy());

        assert.deepEqual(errors, []);
        await page.close();
    });
}
