/**
 * Boot the mark. Returns null when WebGL2 is unavailable or a shader fails,
 * leaving the host's plain text in place.
 *
 * The handle outlives a lost GL context: the engine stops while the browser
 * holds the context, and boots afresh on the same elements when it is handed
 * back, so a caller keeps one handle for the life of the element.
 *
 * @param {InkMarkOptions} opts
 * @returns {InkMark | null}
 */
export function mountInkMark(opts: InkMarkOptions): InkMark | null;
/**
 * The tom.to identity mark: a flock of brush-drawn "birds" rendered in WebGL
 * that forms a wordmark, scatters when disturbed, and drifts between the words
 * it is given. The simulation runs on the GPU via transform feedback: glyph
 * homes come from a distance-transform sample of the text that preserves each
 * stroke's medial ridge, and paper grain is a tileable texture baked once and
 * composited so it shows only in the ink.
 *
 * One engine serves every place the mark appears:
 *
 *   - a site masthead (word plus a row of nav links: real <a> elements give
 *     the hit targets and accessible text, drawn transparent while the engine
 *     is live, and a second class of particles inks the labels over them; nav
 *     particles seek their text but skip the cursor flee, gusts and swirl);
 *   - a signature embedded in a game's own markup (a word in a box, see the
 *     SIGNATURE preset);
 *   - an overlay dropped onto a finished page (see overlay.js).
 *
 * Glyph samples are stored as offsets in font-size units about the text's
 * centre, so a form can be placed anywhere at any size without re-rasterising.
 * That is what lets one instance move: a layout is a set of centres and sizes,
 * and the flock is re-homed onto it every frame it changes.
 *
 * Modes:
 *   inline — the mark forms in its own layout box, as any other block would.
 *   dock   — one instance that travels. It renders into a fixed, click-through
 *            stage and interpolates between two computed layouts as the page
 *            scrolls: a full-size hero centred near the top of the viewport,
 *            and a compact bar pinned to the top with the links beside the
 *            wordmark. The word and the links are positioned by script, so the
 *            hit targets travel with the ink, and the host's CSS is driven by
 *            custom properties on `wrap` (--ink-band, --ink-spacer, --ink-clip,
 *            --ink-bar, --ink-bar-h).
 *   banner — the dock's bar, held: the same fixed stage and layouts, with the
 *            travel pinned at its end. The flee is off and the word (if it is
 *            a link) is clickable. A running instance switches between dock
 *            and banner as the page changes: it re-reads the mode from the
 *            nearest `[data-inkmark]` ancestor of `wrap`'s parent on every
 *            sync() and glides between the forms.
 *
 * Requires WebGL2; without it mountInkMark returns null and the host's plain
 * text stays visible. `wrap` carries the `is-live` class while the engine runs.
 *
 * Every property named with a leading underscore is internal and is mangled by
 * the build (see scripts/build.js); the public option and handle names are not.
 */
/** The serif stack the mark is set in. Host CSS for the fallback text should match. */
export const FONT_FAMILY: "'Palatino Linotype', 'Book Antiqua', Palatino, 'Iowan Old Style', 'Hoefler Text', Georgia, serif";
/** The words the mark drifts between when none are given. */
export const WORDS: string[];
/**
 * The mark as a corner signature on a game's splash: white ink, right-aligned
 * in its box, a nudge of a flee rather than a hero gust (a passing cursor
 * should move the ink aside, not blast it across the artwork), and settled on
 * load: an arrival animation would draw the eye to a corner.
 * @type {Partial<InkMarkOptions>}
 */
export const SIGNATURE: Partial<InkMarkOptions>;
export type InkMarkOptions = {
    /**
     * root element: takes `is-live`, and the dock's custom properties
     */
    wrap: HTMLElement;
    /**
     * transparent canvas, sized by CSS (default: the first canvas in wrap)
     */
    canvas?: HTMLCanvasElement | undefined;
    /**
     * box the wordmark forms in (default: wrap); null for a links-only row
     */
    word?: HTMLElement | null | undefined;
    /**
     * link elements the flock inks labels over (default: none)
     */
    nav?: HTMLElement[] | undefined;
    mode?: "inline" | "dock" | "banner" | undefined;
    /**
     * the words cycled through, in order (default: WORDS)
     */
    words?: string[] | undefined;
    /**
     * CSS font-family the text is set in (default: FONT_FAMILY)
     */
    font?: string | undefined;
    /**
     * ink colour, 0..1 RGB (default: near-black)
     */
    ink?: [number, number, number] | undefined;
    /**
     * overall ink opacity (default 1)
     */
    opacity?: number | undefined;
    /**
     * where the word sits in its box (inline mode)
     */
    align?: "right" | "center" | "left" | undefined;
    /**
     * cursor-flee radius, px (default 122)
     */
    fleeR?: number | undefined;
    /**
     * cursor-flee strength (default 4.6); 0 disables
     */
    fleeForce?: number | undefined;
    /**
     * max font size as a fraction of the box height (default 0.42)
     */
    wordCap?: number | undefined;
    /**
     * fixed modes: the hero slot's height, px (default 200)
     */
    wordHeight?: number | undefined;
    /**
     * fixed modes: height of the docked bar (default 72)
     */
    dockHeight?: number | undefined;
    /**
     * dock: px of scroll the hero→bar travel takes (default 260)
     */
    dockSpan?: number | undefined;
    /**
     * dock: docked font size as a fraction of the bar (default 0.62)
     */
    dockCap?: number | undefined;
    /**
     * start parked on the word with no opening gust (default false)
     */
    settle?: boolean | undefined;
};
export type InkMark = {
    /**
     * bring the instance in line with the page (mode, viewport, layout)
     */
    sync: () => void;
    /**
     * stop, drop every listener, and release the GL context
     */
    destroy: () => void;
};
export type Sample = {
    _nrm: Float32Array;
    _n: number;
    _jit: number;
};
export type Layout = {
    /**
     * wordmark centre x
     */
    _wx: number;
    /**
     * wordmark centre y
     */
    _wy: number;
    /**
     * wordmark font size
     */
    _ws: number;
    /**
     * wordmark element box width
     */
    _wbw: number;
    /**
     * wordmark element box height
     */
    _wbh: number;
    /**
     * label centres x
     */
    _nx: number[];
    /**
     * label centres y
     */
    _ny: number[];
    /**
     * label element box widths
     */
    _nw: number[];
    /**
     * label element box heights
     */
    _nh: number[];
    /**
     * label ink font sizes
     */
    _nis: number[];
    _band: number;
    _barH: number;
    _spacer: number;
};
export type Face = "word" | "nav" | "cur";
