// @ts-check
/**
 * The mark dropped onto a finished page: a corner signature over a game's
 * start screen, added by a script the page did not know about (Rainbow
 * Balance's Cloudflare build appends it after the js13k zip is written, so it
 * costs the zip nothing). It makes its own link, canvas and styles, boots the
 * engine as a SIGNATURE, and can take itself down again once the page moves on.
 */
import { FONT_FAMILY, SIGNATURE, mountInkMark } from './inkmark.js';

/**
 * @typedef {object} OverlayOptions
 * @property {string} [href]     where the mark links (default https://tom.to/)
 * @property {string} [label]    accessible name of the link
 * @property {string} [text]     plain-text fallback shown without WebGL2 (default the first word)
 * @property {string[]} [words]  the words cycled through
 * @property {string} [font]     CSS font-family for the text (default FONT_FAMILY)
 * @property {number} [bottom]   px from the bottom edge, or the safe-area inset if larger (default 16)
 * @property {number} [right]    px from the right edge, or the safe-area inset if larger (default 16)
 * @property {number} [zIndex]   (default 9)
 * @property {string} [size]     CSS length for the font size (default clamp(28px, 6.5vmin, 48px))
 * @property {string | Element | null} [until]
 *   an element (or selector) the mark lives with: when it is hidden
 *   (display none or the hidden attribute) or removed, the mark fades out and
 *   releases its GL context, the way a start screen's signature goes when Play
 *   is pressed. If it is already gone when the overlay mounts, the mark never appears.
 */

/**
 * @param {OverlayOptions} [opts]
 * @returns {{ leave(): void, destroy(): void }} handle: `leave` fades the mark out and destroys it, `destroy` is immediate
 */
export function overlayInkMark(opts = {}) {
  const {
    href = 'https://tom.to/', label = "tom.to — the site of the game's author",
    words, text = (words ?? [])[0] ?? 'tom.to', font = FONT_FAMILY,
    bottom = 16, right = 16, zIndex = 9, size = 'clamp(28px, 6.5vmin, 48px)',
  } = opts;
  const until = typeof opts.until === 'string' ? document.querySelector(opts.until) : opts.until ?? null;
  const gone = () => !!until && (!until.isConnected || getComputedStyle(until).display === 'none');
  const noop = { leave() { /* nothing mounted */ }, destroy() { /* nothing mounted */ } };
  if (opts.until && (!until || gone())) return noop;

  // One rule set for the mark. The word forms inside the link's box, right
  // aligned; the canvas overscans the box by 80px on every side, which is all
  // the room the strays a cursor scatters ever need, and ignores the pointer
  // so the page's own buttons keep their hit targets.
  const style = document.createElement('style');
  style.textContent = `.inkmark-overlay{--f:${size};position:fixed;z-index:${zIndex};`
    + `right:max(${right}px,env(safe-area-inset-right,0px));`
    + `bottom:max(${bottom}px,env(safe-area-inset-bottom,0px));`
    + 'width:calc(var(--f)*5.3);height:calc(var(--f)*1.4);display:flex;align-items:center;'
    + `justify-content:flex-end;font:600 var(--f)/1 ${font};color:rgba(255,255,255,.92);`
    + 'text-decoration:none;cursor:pointer;user-select:none;-webkit-user-select:none;'
    + '-webkit-tap-highlight-color:transparent;transition:opacity .6s}'
    + '.inkmark-overlay.gone{opacity:0;pointer-events:none}'
    + '.inkmark-overlay:focus-visible{outline:2px solid rgba(255,255,255,.85);outline-offset:4px;border-radius:4px}'
    + '.inkmark-overlay.is-live span{visibility:hidden}'
    + '.inkmark-overlay canvas{position:absolute;top:-80px;left:-80px;width:calc(100% + 160px);'
    + 'height:calc(100% + 160px);pointer-events:none}';
  document.head.append(style);

  const mark = document.createElement('a');
  mark.className = 'inkmark-overlay';
  mark.href = href;
  mark.target = '_blank';
  mark.rel = 'noopener noreferrer';
  mark.setAttribute('aria-label', label);
  const span = document.createElement('span');
  span.setAttribute('aria-hidden', 'true');
  span.textContent = text;
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  mark.append(span, canvas);
  document.body.append(mark);

  const ink = mountInkMark({ ...SIGNATURE, wrap: mark, canvas, words, font });

  let watch = /** @type {MutationObserver | null} */ (null);
  let done = false;
  const destroy = () => {
    if (done) return;
    done = true;
    watch?.disconnect();
    ink?.destroy();
    mark.remove();
    style.remove();
  };
  // The flock keeps flying through the fade, then hands back its GL context
  // and listeners: the game needs every context it can get.
  const leave = () => {
    if (done) return;
    mark.classList.add('gone');
    setTimeout(destroy, 700);
  };
  if (until) {
    watch = new MutationObserver(() => { if (gone()) leave(); });
    watch.observe(until, { attributes: true });
    if (until.parentNode) watch.observe(until.parentNode, { childList: true });
  }
  return { leave, destroy };
}
