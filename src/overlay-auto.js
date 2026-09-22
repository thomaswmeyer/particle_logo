// @ts-check
/**
 * Entry for dist/overlay.iife.js: a script tag that mounts the overlay when it
 * runs, taking its options from the tag's data attributes, so a page (or a
 * build that appends the script to one) needs no bundler and no glue code:
 *
 *   <script data-until="#start-screen" data-bottom="100">…dist/overlay.iife.js…</script>
 *
 * data-href, data-label, data-text, data-words (comma separated), data-bottom,
 * data-right, data-z, data-size and data-until map onto OverlayOptions.
 */
import { overlayInkMark } from './overlay.js';

const d = /** @type {HTMLElement | null} */ (document.currentScript)?.dataset ?? {};
/** @param {string | undefined} v */
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
overlayInkMark({
  href: d.href, label: d.label, text: d.text,
  words: d.words ? d.words.split(',').map((w) => w.trim()) : undefined,
  bottom: num(d.bottom), right: num(d.right), zIndex: num(d.z), size: d.size,
  until: d.until,
});
