// @ts-check
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
export const FONT_FAMILY =
  "'Palatino Linotype', 'Book Antiqua', Palatino, 'Iowan Old Style', 'Hoefler Text', Georgia, serif";

/** The words the mark drifts between when none are given. */
export const WORDS = ['tom.to', 'tom meyer'];

/**
 * The mark as a corner signature on a game's splash: white ink, right-aligned
 * in its box, a nudge of a flee rather than a hero gust (a passing cursor
 * should move the ink aside, not blast it across the artwork), and settled on
 * load: an arrival animation would draw the eye to a corner.
 * @type {Partial<InkMarkOptions>}
 */
export const SIGNATURE = {
  ink: [1, 1, 1], opacity: 0.95, align: 'right', wordCap: 0.71,
  fleeR: 50, fleeForce: 0.29, settle: true,
};

/**
 * @typedef {object} InkMarkOptions
 * @property {HTMLElement} wrap            root element: takes `is-live`, and the dock's custom properties
 * @property {HTMLCanvasElement} [canvas]  transparent canvas, sized by CSS (default: the first canvas in wrap)
 * @property {HTMLElement | null} [word]   box the wordmark forms in (default: wrap); null for a links-only row
 * @property {HTMLElement[]} [nav]         link elements the flock inks labels over (default: none)
 * @property {'inline' | 'dock' | 'banner'} [mode]
 * @property {string[]} [words]            the words cycled through, in order (default: WORDS)
 * @property {[number, number, number]} [ink]  ink colour, 0..1 RGB (default: near-black)
 * @property {number} [opacity]            overall ink opacity (default 1)
 * @property {'center' | 'left' | 'right'} [align]  where the word sits in its box (inline mode)
 * @property {number} [fleeR]              cursor-flee radius, px (default 122)
 * @property {number} [fleeForce]          cursor-flee strength (default 4.6); 0 disables
 * @property {number} [wordCap]            max font size as a fraction of the box height (default 0.42)
 * @property {number} [wordHeight]         fixed modes: the hero slot's height, px (default 200)
 * @property {number} [dockHeight]         fixed modes: height of the docked bar (default 72)
 * @property {number} [dockSpan]           dock: px of scroll the hero→bar travel takes (default 260)
 * @property {number} [dockCap]            dock: docked font size as a fraction of the bar (default 0.62)
 * @property {boolean} [settle]            start parked on the word with no opening gust (default false)
 */

/**
 * @typedef {object} InkMark
 * @property {() => void} sync  bring the instance in line with the page (mode, viewport, layout)
 * @property {() => void} destroy  stop, drop every listener, and release the GL context
 */

/** @typedef {{ _nrm: Float32Array, _n: number, _jit: number }} Sample */
/**
 * @typedef {object} Layout
 * @property {number} _wx wordmark centre x
 * @property {number} _wy wordmark centre y
 * @property {number} _ws wordmark font size
 * @property {number} _wbw wordmark element box width
 * @property {number} _wbh wordmark element box height
 * @property {number[]} _nx label centres x
 * @property {number[]} _ny label centres y
 * @property {number[]} _nw label element box widths
 * @property {number[]} _nh label element box heights
 * @property {number[]} _nis label ink font sizes
 * @property {number} _band
 * @property {number} _barH
 * @property {number} _spacer
 */
/** @typedef {'word' | 'nav' | 'cur'} Face */

// The flock's rest state. SEEK and REST_AMP are also baked into the sim shader
// as the nav particles' constant seek and breeze.
const SEEK = 0.011, REST_AMP = 0.013, FLIGHT_AMP = 0.5, WANDER = 0.8;
const FLIGHT_S = 2, CYCLE_S = 8, DPR_MAX = 2;
// particles per sampled glyph coord (calibrated to the original look)
const WORD_DENS = 0.7, NAV_DENS = 1.47;
// the current page's label is drawn at NAV_CUR times its size and is not a link
const NAV_CUR = 2;
// hovered labels swell to this multiple of their laid-out size
const NAV_BOOST = 1.25;
// spawn radius around each particle's home at startup/realloc
const SPAWN_R = 40;
// hero wordmark font px, the amplitude tuning baseline
const BREEZE_REF = 84;
// hero and dock layout constants
const HERO_TOP = 44, HERO_GAP = 38, HERO_LEAD = 14, LINE_GAP = 10;
const DOCK_GAP = 30, DOCK_LEAD = 40, NAV_PAD = 10;
// The three faces the mark is set in. Nav labels take the bold face and the
// anchors' letter-spacing, so ink and hit target line up. The current page's
// label, drawn outsized as the page's heading, takes the regular face: the
// bold link face enlarged reads as a slab. It is 400 rather than 600 because
// Palatino on iOS has only Regular and Bold, and anything from 600 up is Bold.
const WEIGHT = { word: '600', nav: '800', cur: '400' };

// Simulation: transform feedback advances (pos, vel, ang) entirely on the GPU.
// iAux.x is 1 for nav-label particles: they use the fixed rest seek/amp and
// ignore the pointer flee and gusts, only ever flying home to their text.
// iAux.z is 1 while a nav label is hovered: its particles seek harder so the
// flock springs out to the enlarged glyphs.
const SIM_VERT = `#version 300 es
in vec2 iPos; in vec2 iVel; in float iAng; in vec2 iHome; in float iSeed; in vec3 iAux;
uniform float uT, uSeek, uAmp, uBrz, uAct, uJit, uDtn, uFleeR, uFleeF;
uniform vec2 uPtr, uGust;
out vec2 vPos; out vec2 vVel; out float vAng;
// the rest state (SEEK, REST_AMP): nav particles never leave it
const float SEEK_N = .011, AMP_N = .013, DAMP = .9;
// nav stroke scale is size/44; the breeze is tuned against the hero's 84px
const float NAV_BRZ = 44. / 84.;
float h(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float flow(vec2 p, float t){ return sin(p.x*.006 + t*.30) + cos(p.y*.006 - t*.24) + .5*sin((p.x+p.y)*.004 + t*.18); }
void main(){
  vec2 pos = iPos, vel = iVel;
  vel += (iHome - pos) * mix(uSeek, SEEK_N, iAux.x) * (1. + iAux.z * 13.) * uDtn;
  float a = flow(pos, uT) * 3.14159265;
  vec2 fd = vec2(cos(a), sin(a));
  // breeze scales with glyph size: word particles use the instance factor,
  // nav particles derive theirs from their stroke scale
  vel += fd * mix(uAmp * uBrz, AMP_N * iAux.y * NAV_BRZ, iAux.x) * uDtn;
  if (uAct > .5 && iAux.x < .5) {
    vec2 dv = pos - uPtr; float d2 = dot(dv, dv);
    if (d2 < uFleeR * uFleeR && d2 > .01) {
      float d = sqrt(d2), f = 1. - d / uFleeR; f = f * f * uFleeF;
      vec2 n = dv / d;
      // pushed straight out and swirled sideways in equal measure
      vel += (n + vec2(-n.y, n.x)) * f * uDtn;
    }
  }
  vel += (uGust + (vec2(h(iSeed*13.1), h(iSeed*7.7)) * 2. - 1.) * uJit) * (1. - iAux.x);
  // hovered nav particles damp harder than the rest state, but deliberately a
  // touch under the critical point for the boosted seek: a visible overshoot
  // on hover reads as "these are particles", then settles without ringing
  vel *= pow(DAMP - iAux.z * .12, uDtn);
  pos += vel * uDtn;
  float s = length(vel);
  vec2 vd = s > 1e-4 ? vel / s : fd;
  vec2 dir = mix(fd, vd, clamp((s - .05) / .35, 0., 1.));
  float tg = atan(dir.y, dir.x);
  vAng = iAng + atan(sin(tg - iAng), cos(tg - iAng)) * min(.15 * uDtn, 1.);
  vPos = pos; vVel = vel;
  gl_Position = vec4(0);
}`;
const SIM_FRAG = `#version 300 es
precision mediump float; out vec4 o; void main(){ o = vec4(0); }`;

// Stroke render: each particle becomes an instanced capsule quad.
// iAux.y > 0 is a per-particle stroke scale (nav labels, which are smaller
// than the wordmark); 0 means "use the wordmark scale uniform".
const STROKE_VERT = `#version 300 es
in vec2 aCorner; in vec2 iPos; in vec2 iVel; in float iAng; in float iSeed; in vec3 iAux;
uniform vec2 uRes; uniform float uSc;
out vec2 vL; out float vLen; out float vHW; out float vNav; out float vHov; out float vBl;
void main(){
  // iAux.y < 0 withholds this particle from the draw: the flock is allocated
  // for the largest form the mark ever takes, and thins as it shrinks so the
  // ink density per letterform stays put (see wordThin below). The quad is
  // placed wholly outside clip space, so no fragment ever reads its varyings.
  if (iAux.y < 0.) { gl_Position = vec4(2, 2, 2, 1); return; }
  float sc = iAux.y > 0. ? iAux.y : uSc;
  vNav = iAux.x; vHov = iAux.z;
  // How wet the brush is, relative to the hero wordmark's 0.6. The bleed halo
  // and the soft edge below are absolute pixel distances, so without this a
  // wordmark that shrinks as it docks keeps a full-size halo on quarter-size
  // strokes and floods into a smudge. Nav labels are already sampled at the
  // size they're drawn, so they keep their tuned look.
  vBl = iAux.x > .5 ? 1. : clamp(sc / .6, .45, 1.);
  // the capsule runs len along the heading from p1; the quad is padded by
  // the brush width plus the halo on every side
  float len = 4. * sc + length(iVel) * 2.6;
  vec2 dir = vec2(cos(iAng), sin(iAng)), p1 = iPos - dir * len * .5;
  float w = 1.2 * sc * (.8 + .4 * iSeed), pad = w + 4.5;
  float al = (aCorner.y * .5 + .5) * (len + 2. * pad) - pad, pp = aCorner.x * pad;
  vec2 wp = p1 + dir * al + vec2(-dir.y, dir.x) * pp;
  vL = vec2(pp, al); vLen = len; vHW = w;
  gl_Position = vec4(wp.x / uRes.x * 2. - 1., 1. - wp.y / uRes.y * 2., 0, 1);
}`;
const STROKE_FRAG = `#version 300 es
precision highp float;
in vec2 vL; in float vLen; in float vHW; in float vNav; in float vHov; in float vBl;
out vec4 frag;
void main(){
  float pp = vL.x, al = vL.y, ay = clamp(al, 0., vLen);
  float d = length(vec2(pp, al - ay)) - vHW;
  // nav-label particles get a somewhat tighter edge and reduced bleed halo, so
  // small text reads crisper than the wordmark's watercolor look; a hovered
  // label's ink runs fuller and darker. Both distances follow the brush (vBl),
  // with the edge held to most of a pixel so small strokes stay antialiased.
  float e = max(.7, vBl);
  float ink = 1. - smoothstep((-1. + vNav * .3) * e, (1.4 - vNav * .4) * e, d);
  float bl = (1. - smoothstep(0., mix(4.5, 3.15, vNav) * vBl, max(d, 0.))) * .16 * (1. - vNav * .35);
  float a = clamp(ink * (1. + vHov * .35) + bl, 0., 1.) * (.9 + vHov * .1);
  if (a <= .002) discard;
  frag = vec4(a);
}`;

// Composite: ink coverage as premultiplied alpha over a transparent canvas, so
// whatever is behind the canvas shows through; grain modulates only the ink.
// (Vertex shaders default to highp float, so none of the three declare it.)
const COMP_VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p; gl_Position = vec4(p * 2. - 1., 0, 1);
}`;
const COMP_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uInk, uPaperTex; uniform vec2 uCRes;
uniform vec3 uInkC; uniform float uOpacity;
out vec4 frag;
// how strongly the paper grain shows in the ink, and the grain tile's size in px
const float GRAIN = .34, TILE = 150.;
void main(){
  float cov = texture(uInk, vUv).r;
  float pa = texture(uPaperTex, vUv * uCRes / TILE).r;
  float a = cov * mix(1. - GRAIN, 1., pa) * uOpacity;
  frag = vec4(uInkC * a, a);
}`;

/**
 * @param {number} v
 * @param {number} lo
 * @param {number} hi
 */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 */
const lerp = (a, b, t) => a + (b - a) * t;

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
export function mountInkMark(opts) {
  const canvas = opts.canvas ?? opts.wrap.querySelector('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  let inner = boot(opts, canvas);
  if (!inner) return null;
  let alive = true;
  const ac = new AbortController();
  // A lost GL context takes every buffer, texture and program with it and
  // leaves a frozen canvas; the loop stops until the browser restores the
  // context, and then the engine boots afresh on the same element.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    inner?.destroy(true);
    inner = null;
  }, { signal: ac.signal });
  canvas.addEventListener('webglcontextrestored', () => {
    if (alive && !inner) inner = boot(opts, canvas);
  }, { signal: ac.signal });
  return {
    sync() { inner?.sync(); },
    destroy() {
      if (!alive) return;
      alive = false;
      ac.abort();
      inner?.destroy(false);
      inner = null;
    },
  };
}

/**
 * One instance on one canvas: its own GL context and closure of state.
 * @param {InkMarkOptions} opts
 * @param {HTMLCanvasElement} canvas
 * @returns {{ sync(): void, destroy(keepContext: boolean): void } | null}
 */
function boot(opts, canvas) {
  const wrap = opts.wrap;
  const MODE = opts.mode ?? 'inline';
  // dock and banner are one fixed-stage engine: banner is the dock held at the
  // end of its travel. Which of the two applies is the page's choice, not the
  // instance's (see readMode).
  const DOCKING = MODE === 'dock' || MODE === 'banner';
  let PINNED = false;
  // null in links-only instances: no wordmark particles, no text cycling
  const wordEl = opts.word === undefined ? wrap : opts.word;
  const navEls = opts.nav ?? [];
  const CYCLE = opts.words?.length ? opts.words : WORDS;
  const INK = opts.ink ?? [23 / 255, 19 / 255, 13 / 255];
  const OPACITY = opts.opacity ?? 1;
  const ALIGN = opts.align ?? 'center';
  const FLEE_R = opts.fleeR ?? 122, FLEE_FORCE = opts.fleeForce ?? 4.6;
  const WORD_CAP = opts.wordCap ?? 0.42;
  const DOCK_H = opts.dockHeight ?? 72, DOCK_SPAN = opts.dockSpan ?? 260, DOCK_CAP = opts.dockCap ?? 0.62;
  // the hero slot height: the largest the wordmark is ever drawn follows from
  // it, whatever the viewport width
  const slotH = opts.wordHeight ?? 200;
  const spawnR = opts.settle ? 0 : SPAWN_R;

  // The current page's label is drawn at NAV_CUR times its size and is not a
  // link: in the bar it is the page's heading. navCur marks it; navKeep is
  // how many of each label's particles its present sample actually uses.
  /** @type {boolean[]} */
  const navCur = [];
  /** @type {number[]} */
  let navKeep = [];
  /** @param {number} i */
  const navMul = (i) => (navCur[i] ? NAV_CUR : 1);
  const navHover = navEls.map(() => false);
  function readMode() {
    const host = wrap.parentElement?.closest('[data-inkmark]');
    const m = host ? host.getAttribute('data-inkmark') : MODE;
    PINNED = DOCKING && m === 'banner';
    // The wordmark is a link home only where it reads as a masthead. As the
    // hero it stays click-through (the flee still sees the pointer, which is
    // listened for on the window).
    if (DOCKING && wordEl && wordEl.tagName === 'A') {
      wordEl.style.pointerEvents = PINNED ? 'auto' : 'none';
      wordEl.tabIndex = PINNED ? 0 : -1;
    }
    // the label for the section we are in: outsized by the layouts. On the
    // section's own page it is inert; on a page inside it (a post under
    // /blog/) it stays a link back up, though it doesn't swell on hover.
    const here = location.pathname.replace(/\/+$/, '');
    navEls.forEach((a, i) => {
      const target = (a.getAttribute('href') || '').replace(/\/+$/, '');
      const exact = PINNED && target === here;
      navCur[i] = exact || (PINNED && !!target && here.startsWith(target + '/'));
      if (navCur[i]) { a.setAttribute('aria-current', exact ? 'page' : 'true'); navHover[i] = false; }
      else a.removeAttribute('aria-current');
      a.style.pointerEvents = exact ? 'none' : '';
      a.tabIndex = exact ? -1 : 0;
    });
  }
  readMode();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // a host may claim is-live during parse to avoid a fallback flash; give it
  // back if the engine can't actually run here
  const noBoot = () => { wrap.classList.remove('is-live'); return null; };
  /** @type {WebGL2RenderingContext | null} */
  let glTry = null;
  try { glTry = canvas.getContext('webgl2', { alpha: true, antialias: true }); } catch { /* no WebGL2 */ }
  if (!glTry) return noBoot();
  const gl = glTry;

  /**
   * @param {number} type
   * @param {string} src
   */
  function compile(type, src) {
    const s = gl.createShader(type); if (!s) return null;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('inkmark shader:', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  /**
   * @param {string} vsSrc
   * @param {string} fsSrc
   * @param {string[]} [tf] transform-feedback varyings to capture
   */
  function link(vsSrc, fsSrc, tf) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc), fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const p = gl.createProgram(); if (!p) return null;
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    if (tf) gl.transformFeedbackVaryings(p, tf, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('inkmark link:', gl.getProgramInfoLog(p)); return null; }
    return p;
  }
  const simProg = link(SIM_VERT, SIM_FRAG, ['vPos', 'vVel', 'vAng']);
  const strokeProg = link(STROKE_VERT, STROKE_FRAG);
  const compProg = link(COMP_VERT, COMP_FRAG);
  if (!simProg || !strokeProg || !compProg) return noBoot();
  wrap.classList.add('is-live');

  // attribute and uniform locations, looked up once and keyed by name
  /**
   * @template {string} K
   * @template T
   * @param {readonly K[]} names
   * @param {(n: K) => T} get
   * @returns {Record<K, T>}
   */
  const locs = (names, get) => /** @type {Record<K, T>} */ (Object.fromEntries(names.map((n) => [n, get(n)])));
  /**
   * @template {string} K
   * @param {WebGLProgram} p
   * @param {readonly K[]} names
   */
  const attribs = (p, names) => locs(names, (n) => gl.getAttribLocation(p, n));
  /**
   * @template {string} K
   * @param {WebGLProgram} p
   * @param {readonly K[]} names
   */
  const uniforms = (p, names) => locs(names, (n) => gl.getUniformLocation(p, n));
  const sa = attribs(simProg, ['iPos', 'iVel', 'iAng', 'iHome', 'iSeed', 'iAux']);
  const ra = attribs(strokeProg, ['aCorner', 'iPos', 'iVel', 'iAng', 'iSeed', 'iAux']);
  const su = uniforms(simProg, ['uT', 'uSeek', 'uAmp', 'uBrz', 'uAct', 'uJit', 'uDtn', 'uFleeR', 'uFleeF', 'uPtr', 'uGust']);
  const ru = uniforms(strokeProg, ['uRes', 'uSc']);
  const cu = uniforms(compProg, ['uInk', 'uPaperTex', 'uCRes', 'uInkC', 'uOpacity']);

  gl.disable(gl.DEPTH_TEST);

  // Offscreen ink buffer (pass 1 target; single-channel: only coverage is
  // stored, the ink colour is applied in the composite) and the composite's
  // empty VAO.
  const inkTex = gl.createTexture(), fbo = gl.createFramebuffer(), emptyVao = gl.createVertexArray();
  let fbw = 0, fbh = 0;
  gl.bindTexture(gl.TEXTURE_2D, inkTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  function allocFbo() {
    if (fbw === canvas.width && fbh === canvas.height) return;
    fbw = canvas.width; fbh = canvas.height;
    gl.bindTexture(gl.TEXTURE_2D, inkTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, fbw, fbh, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, inkTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // Tileable paper grain baked once into a 128x128 texture (periodic value
  // noise, sampled with REPEAT): no per-frame noise evaluation.
  function makePaper() {
    const S = 128, d = new Uint8Array(S * S);
    /**
     * @param {number} ix
     * @param {number} iy
     * @param {number} p
     */
    function h2(ix, iy, p) {
      ix = ((ix % p) + p) % p; iy = ((iy % p) + p) % p;
      const n = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453; return n - Math.floor(n);
    }
    /**
     * @param {number} u
     * @param {number} v
     * @param {number} p
     */
    function vn(u, v, p) {
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = h2(x0, y0, p), b = h2(x0 + 1, y0, p), c = h2(x0, y0 + 1, p), e = h2(x0 + 1, y0 + 1, p);
      const tp = a + (b - a) * sx, bo = c + (e - c) * sx; return tp + (bo - tp) * sy;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const n = vn(u * 32, v * 32, 32) * 0.5 + vn(u * 64, v * 64, 64) * 0.33 + vn(u * 96, v * 96, 96) * 0.17;
      d[y * S + x] = Math.max(0, Math.min(255, (n * 255) | 0));
    }
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, S, S, 0, gl.RED, gl.UNSIGNED_BYTE, d);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }
  const paperTex = makePaper();

  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  // Lifecycle: `alive` gates the rAF loop and any late async callback, so an
  // instance whose element left the page stops simulating instead of holding
  // a GL context and burning frames forever.
  let alive = true, rafId = 0, scrollPending = false;
  let N = 0, NW = 0, W = 0, H = 0, DPR = 1;
  // One entry per nav link: particle count, offset into the flock, stroke scale.
  /** @type {number[]} */
  let navCounts = [];
  /** @type {number[]} */
  const navScales = [];
  /** @type {number[]} */
  let navOffsets = [];
  let auxArr = new Float32Array(0);
  let word = CYCLE[0], cycleIdx = 0, flight = 0, lastCycle = 0, prevT = 0;
  // how excited the flock is by the mark moving under it (dock travel)
  let travel = 0;
  const gust = [0, 0];
  const pointer = { _x: -1e4, _y: -1e4, _active: false };
  let homes = new Float32Array(0);
  let strokeScale = 1;

  // Ping-pong particle state: interleaved (pos.xy, vel.xy, ang), stride 20 bytes.
  // auxBuf holds the static per-particle (navFlag, strokeScale, hover) triples.
  const stateBuf = [gl.createBuffer(), gl.createBuffer()], homeBuf = gl.createBuffer(), seedBuf = gl.createBuffer(), auxBuf = gl.createBuffer();
  /** @type {WebGLVertexArrayObject[]} */
  const simVao = [];
  /** @type {WebGLVertexArrayObject[]} */
  const drawVao = [];
  let cur = 0, allocated = false;
  /**
   * @param {number} l attribute location
   * @param {number} size
   * @param {number} stride
   * @param {number} off
   * @param {number} [div] instance divisor
   */
  function en(l, size, stride, off, div = 0) {
    if (l < 0) return;
    gl.enableVertexAttribArray(l);
    gl.vertexAttribPointer(l, size, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(l, div);
  }
  /** (Re)allocate the particle buffers and VAOs for the current N. */
  function alloc() {
    for (const v of simVao.concat(drawVao)) gl.deleteVertexArray(v);
    const sd = new Float32Array(N);
    for (let i = 0; i < N; i++) sd[i] = Math.random();
    // the state is left empty here: every allocation is followed by a
    // seedState from sync, which places the flock about its homes
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf[0]); gl.bufferData(gl.ARRAY_BUFFER, N * 20, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf[1]); gl.bufferData(gl.ARRAY_BUFFER, N * 20, gl.DYNAMIC_COPY);
    gl.bindBuffer(gl.ARRAY_BUFFER, homeBuf); gl.bufferData(gl.ARRAY_BUFFER, N * 8, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); gl.bufferData(gl.ARRAY_BUFFER, sd, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, auxBuf); gl.bufferData(gl.ARRAY_BUFFER, N * 12, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 2; i++) {
      const sv = gl.createVertexArray(); gl.bindVertexArray(sv);
      gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf[i]);
      en(sa.iPos, 2, 20, 0); en(sa.iVel, 2, 20, 8); en(sa.iAng, 1, 20, 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, homeBuf); en(sa.iHome, 2, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); en(sa.iSeed, 1, 4, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, auxBuf); en(sa.iAux, 3, 12, 0);
      simVao[i] = /** @type {WebGLVertexArrayObject} */ (sv);
      const dv = gl.createVertexArray(); gl.bindVertexArray(dv);
      gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf); en(ra.aCorner, 2, 8, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf[i]);
      en(ra.iPos, 2, 20, 0, 1); en(ra.iVel, 2, 20, 8, 1); en(ra.iAng, 1, 20, 16, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf); en(ra.iSeed, 1, 4, 0, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, auxBuf); en(ra.iAux, 3, 12, 0, 1);
      drawVao[i] = /** @type {WebGLVertexArrayObject} */ (dv);
    }
    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    homes = new Float32Array(N * 2);
    allocated = true;
  }

  // ---- text metrics and glyph sampling ---------------------------------
  const off = document.createElement('canvas');
  const octx = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d', { willReadFrequently: true }));
  /** @param {number} i */
  const navFace = (i) => /** @type {Face} */ (navCur[i] ? 'cur' : 'nav');
  /**
   * @param {number} size
   * @param {Face} face
   */
  function setFont(size, face) {
    octx.font = `${WEIGHT[face]} ${size}px ${FONT_FAMILY}`;
    try { octx.letterSpacing = face === 'word' ? '0em' : '0.08em'; } catch { /* older engines */ }
  }
  // Width of `text` per 1px of font size, cached.
  /** @type {Map<string, number>} */
  const measCache = new Map();
  /**
   * @param {string} text
   * @param {Face} face
   */
  function measure(text, face) {
    const key = `${face}|${text}`;
    let per = measCache.get(key);
    if (per === undefined) {
      setFont(200, face);
      per = octx.measureText(text).width / 200;
      measCache.set(key, per);
    }
    return per;
  }
  // Largest font size that fits `text` in a box: width-limited, then capped
  // as a fraction of the box height (which is what keeps the wordmark from
  // filling its whole slot).
  /**
   * @param {string} text
   * @param {number} boxW
   * @param {number} boxH
   * @param {number} cap
   */
  const fitWord = (text, boxW, boxH, cap) => Math.max(4, Math.min((boxW * 0.84) / measure(text, 'word'), boxH * cap));
  /**
   * @param {string} text
   * @param {number} boxW
   */
  const fitNav = (text, boxW) => Math.max(4, boxW / measure(text, 'nav'));
  // Brush weight for a glyph of `size`: it tracks the font size in both
  // classes, so a mark that shrinks as it docks thins its brush instead of
  // turning into a blob. The nav scale is what the shaders see as iAux.y.
  /** @param {number} size */
  const wordScale = (size) => clamp(size / 140, 0.28, 1.4);
  /** @param {number} size */
  const navScale = (size) => clamp(size / 44, 0.34, 0.9);

  /** @type {Sample} */
  const NO_SAMPLE = { _nrm: new Float32Array(0), _n: 0, _jit: 0 };
  /**
   * Rasterise `text` at `size` and reduce it to particle homes via a distance
   * transform: erode thick strokes by a margin but always keep each stroke's
   * medial ridge, so thin lines never vanish beside thick ones. Coordinates
   * come back normalised (offsets from the text's centre in units of the font
   * size), so the same sample can be placed at any size or position without
   * re-rasterising. `erodeAt` is the size the erosion is judged at (default:
   * the sample's own): a label scaled up as the current page's is sampled as
   * its normal-size self, enlarged, rather than eroded down to a thin band.
   *
   * @param {string} text
   * @param {number} size
   * @param {Face} face
   * @param {number} [erodeAt]
   * @returns {Sample}
   */
  function sampleGlyphs(text, size, face, erodeAt = size) {
    const per = measure(text, face);
    const pad = Math.max(10, Math.round(size * 0.3));
    const w = Math.max(2, Math.round(per * size) + pad * 2);
    const h = Math.max(2, Math.round(size * 1.5) + pad * 2);
    // resizing the canvas resets the 2d context, so the font is set after
    off.width = w; off.height = h;
    octx.clearRect(0, 0, w, h);
    octx.fillStyle = '#fff'; octx.textAlign = 'center'; octx.textBaseline = 'middle';
    setFont(size, face);
    octx.fillText(text, w / 2, h / 2);
    const scale = face === 'word' ? wordScale(erodeAt) : navScale(erodeAt);
    const img = octx.getImageData(0, 0, w, h).data;
    const WH = w * h, D = new Float32Array(WH);
    for (let i = 0; i < WH; i++) D[i] = img[i * 4 + 3] > 96 ? 1e9 : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!D[i]) continue; let v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 1);
      if (y > 0) v = Math.min(v, D[i - w] + 1);
      if (x > 0 && y > 0) v = Math.min(v, D[i - w - 1] + 1.414);
      if (x < w - 1 && y > 0) v = Math.min(v, D[i - w + 1] + 1.414);
      D[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; if (!D[i]) continue; let v = D[i];
      if (x < w - 1) v = Math.min(v, D[i + 1] + 1);
      if (y < h - 1) v = Math.min(v, D[i + w] + 1);
      if (x < w - 1 && y < h - 1) v = Math.min(v, D[i + w + 1] + 1.414);
      if (x > 0 && y < h - 1) v = Math.min(v, D[i + w - 1] + 1.414);
      D[i] = v;
    }
    /**
     * @param {number} px
     * @param {number} py
     */
    const g = (px, py) => (px < 0 || py < 0 || px >= w || py >= h ? 0 : D[py * w + px]);
    // Erode relative to stroke width: at small sizes the survivor set
    // collapses to the medial ridge, a thin skeleton of the letterforms,
    // instead of a blobby filled shape.
    /** @type {number[]} */
    const coords = [];
    const m = Math.max(1, Math.round(3.2 * scale));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const d = D[y * w + x]; if (d <= 0) continue;
      if (d >= m || (d >= g(x - 1, y) && d >= g(x + 1, y) && d >= g(x, y - 1) && d >= g(x, y + 1) &&
        d >= g(x - 1, y - 1) && d >= g(x + 1, y - 1) && d >= g(x - 1, y + 1) && d >= g(x + 1, y + 1))) coords.push(x, y);
    }
    const nrm = new Float32Array(coords.length);
    for (let i = 0; i < coords.length; i += 2) {
      nrm[i] = (coords[i] - w / 2) / size;
      nrm[i + 1] = (coords[i + 1] - h / 2) / size;
    }
    return { _nrm: nrm, _n: coords.length / 2, _jit: 1 / size };
  }
  // Sampling is the one expensive thing the engine does on the main thread (a
  // rasterise and two distance-transform passes per text), and the same
  // handful of texts at the same handful of sizes are asked for over and over:
  // every word cycle, every navigation, every resize. Sizes are rounded to the
  // pixel so the cache actually hits. Bounded for the flow layout, whose label
  // sizes track the viewport.
  /** @type {Map<string, Sample>} */
  const sampleCache = new Map();
  /**
   * @param {string} text
   * @param {number} size
   * @param {Face} face
   * @param {number} [erodeAt]
   */
  function sampleCached(text, size, face, erodeAt) {
    const sz = Math.max(4, Math.round(size)), es = erodeAt ? Math.max(4, Math.round(erodeAt)) : 0;
    const key = `${face}|${text}|${sz}|${es}`;
    let s = sampleCache.get(key);
    if (!s) {
      if (sampleCache.size > 64) sampleCache.clear();
      s = sampleGlyphs(text, sz, face, es || undefined);
      sampleCache.set(key, s);
    }
    return s;
  }

  // ---- placing a sample -------------------------------------------------
  let wordSample = NO_SAMPLE;
  /** @type {Sample[]} */
  let navSamples = [];
  // Per-particle sub-pixel jitter, in font-size units and fixed for the
  // particle's life: re-rolling it every placement would make the ink boil.
  let jitter = new Float32Array(0);
  let breeze = 1;
  function makeJitter() {
    jitter = new Float32Array(N * 2);
    for (let i = 0; i < N * 2; i++) jitter[i] = Math.random() - 0.5;
  }
  /**
   * Spread `count` particles over a sample's coords (cycling when the counts
   * differ) placed about (cx, cy) at `size`.
   * @param {Sample} s
   * @param {number} at
   * @param {number} count
   * @param {number} cx
   * @param {number} cy
   * @param {number} size
   */
  function place(s, at, count, cx, cy, size) {
    const cn = s._n, j = s._jit * size;
    for (let k = 0; k < count; k++) {
      const o = (at + k) * 2;
      if (!cn) { homes[o] = cx; homes[o + 1] = cy; continue; }
      const idx = Math.floor((k * cn) / count) * 2;
      homes[o] = cx + s._nrm[idx] * size + jitter[o] * j;
      homes[o + 1] = cy + s._nrm[idx + 1] * size + jitter[o + 1] * j;
    }
  }
  /**
   * @param {number} cx
   * @param {number} cy
   * @param {number} size
   */
  function placeWord(cx, cy, size) {
    if (!NW) return;
    place(wordSample, 0, NW, cx, cy, size);
    strokeScale = wordScale(size);
    // ambient drift and flight amplitude scale with glyph size, so a docked
    // or corner-sized mark shivers proportionally rather than being tossed about
    breeze = clamp(size / BREEZE_REF, 0.25, 1.5);
  }
  /**
   * @param {number} i
   * @param {number} cx
   * @param {number} cy
   * @param {number} size
   */
  function placeNav(i, cx, cy, size) {
    const s = navSamples[i];
    if (!s) return;
    const keep = navKeep[i] || navCounts[i];
    place(s, navOffsets[i], keep, cx, cy, size);
    // the rest of the label's budget waits, hidden, at its centre
    for (let k = keep; k < navCounts[i]; k++) { homes[(navOffsets[i] + k) * 2] = cx; homes[(navOffsets[i] + k) * 2 + 1] = cy; }
    navScales[i] = navScale(size);
  }
  // The word is sampled once, at the largest size it is ever drawn. Placed
  // smaller, that sample's ridge carries more particles per pixel than the
  // letterforms can hold and the brush halos flood the counters, so draw an
  // evenly spaced fraction of them, proportional to the size. The flock is
  // also budgeted for the widest word it cycles through, so a narrower word
  // draws proportionally fewer of them too. Nav labels are sampled at their
  // own size and budgeted per label, and never need this.
  let wordAux = new Float32Array(0);
  let lastThin = -1;
  /** @param {number} size */
  function wordThin(size) {
    if (!NW) return;
    let f = Math.min(1, size / Math.max(1, refWordSize()))
      * Math.min(1, (wordSample._n * WORD_DENS) / NW);
    f = Math.max(0.12, f);
    if (Math.abs(f - lastThin) < 0.02) return;
    lastThin = f;
    if (wordAux.length !== NW * 3) wordAux = new Float32Array(NW * 3);
    for (let k = 0, seen = -1; k < NW; k++) {
      const b = Math.floor(k * f);
      wordAux[k * 3 + 1] = b === seen ? -1 : 0;
      seen = b;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, auxBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, wordAux, 0, NW * 3);
  }
  function uploadHomes() {
    gl.bindBuffer(gl.ARRAY_BUFFER, homeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, homes);
  }
  /**
   * Write one label's aux slice: (navFlag, strokeScale, hover) per particle.
   * Particles beyond what the label's present sample uses are withheld
   * (strokeScale -1): in the fixed modes each label's budget is the count it
   * needs at the outsized current-page size, so counts stay put from page to
   * page and the flock never re-spawns when a different label becomes current.
   * A label's slice only changes on a sync or a hover (its size is the same at
   * both ends of the travel), so it is written there, not per frame.
   * @param {number} i
   */
  function writeAux(i) {
    const at = navOffsets[i], cnt = navCounts[i], hov = navHover[i] ? 1 : 0;
    const keep = navKeep[i] || cnt;
    for (let k = 0; k < cnt; k++) {
      const o = (at + k) * 3;
      auxArr[o] = 1; auxArr[o + 1] = k < keep ? navScales[i] : -1; auxArr[o + 2] = hov;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, auxBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, at * 12, auxArr, at * 3, cnt * 3);
  }

  // ---- layouts ----------------------------------------------------------
  // A layout is just where the mark's parts sit and how big they are. The
  // instance holds two of them and interpolates: `layA` is the resting form
  // (the hero, or, outside the fixed modes, the one measured from the DOM) and
  // `layB` the docked bar. In inline mode the two are the same object, so the
  // interpolation is a no-op and nothing is ever repositioned.
  /** @returns {Layout} */
  const emptyLayout = () => ({
    _wx: 0, _wy: 0, _ws: 20, _wbw: 0, _wbh: 0,
    _nx: [], _ny: [], _nw: [], _nh: [], _nis: [],
    _band: 0, _barH: 0, _spacer: 0,
  });
  // empty until the first sync builds them
  let layA = emptyLayout(), layB = layA;
  let navSize = 19, navH = 30;
  // live values from the last applyLayout, so hover can re-place one label
  /** @type {number[]} */
  const curNx = [];
  /** @type {number[]} */
  const curNy = [];
  /** @type {number[]} */
  const curNis = [];

  /** @param {number} i */
  const navText = (i) => (navEls[i].textContent || '').trim().toUpperCase();
  /**
   * Greedy wrap of label widths into centred rows; returns each label's
   * centre x plus the row it landed on.
   * @param {number[]} widths
   * @param {number} gap
   * @param {number} maxW
   * @param {number} centerX
   */
  function rowsOf(widths, gap, maxW, centerX) {
    /** @type {number[][]} */
    const lines = [[]];
    let used = 0;
    widths.forEach((w, i) => {
      const line = lines[lines.length - 1];
      const add = (line.length ? gap : 0) + w;
      if (used + add > maxW && line.length) { lines.push([i]); used = w; }
      else { line.push(i); used += add; }
    });
    /** @type {number[]} */
    const cx = [];
    /** @type {number[]} */
    const row = [];
    lines.forEach((line, li) => {
      const total = line.reduce((t, idx, k) => t + widths[idx] + (k ? gap : 0), 0);
      let x = centerX - total / 2;
      for (const idx of line) {
        cx[idx] = x + widths[idx] / 2; row[idx] = li;
        x += widths[idx] + gap;
      }
    });
    return { _cx: cx, _row: row, _lines: lines.length };
  }

  // fixed modes: both layouts are computed from the viewport, not measured,
  // so the mark can be put anywhere without a DOM round-trip per frame.
  function buildDockLayouts() {
    const VW = document.documentElement.clientWidth || window.innerWidth;
    const CW = Math.min(VW - 32, 720), padX = (VW - CW) / 2;
    const widths = navEls.map((_a, i) => measure(navText(i), navFace(i)) * navSize * navMul(i) + NAV_PAD * 2);
    // rows are as tall as the tallest label in the layout
    const rowH = navEls.reduce((h, _a, i) => Math.max(h, navH * navMul(i)), navH);

    const hero = emptyLayout();
    hero._ws = fitWord(word, CW, slotH, WORD_CAP);
    hero._wx = VW / 2; hero._wy = HERO_TOP + slotH / 2;
    hero._wbw = measure(word, 'word') * hero._ws + 24; hero._wbh = hero._ws * 1.35;
    const hr = rowsOf(widths, HERO_GAP, CW, VW / 2);
    const hTop = HERO_TOP + slotH + HERO_LEAD;
    hero._nx = hr._cx;
    hero._ny = navEls.map((_a, i) => hTop + hr._row[i] * (rowH + LINE_GAP) + rowH / 2);
    hero._nw = widths; hero._nh = navEls.map((_a, i) => navH * navMul(i));
    hero._nis = navEls.map((_a, i) => navSize * navMul(i));
    const hBottom = navEls.length
      ? hTop + hr._lines * rowH + (hr._lines - 1) * LINE_GAP
      : HERO_TOP + slotH;
    // the band is what the canvas mask keeps: leave room below the ink for
    // strays and for the 60px feather, so nothing is cut mid-stroke
    hero._band = hBottom + 96; hero._spacer = hBottom + 44; hero._barH = 0;

    const dock = emptyLayout();
    // The bar is laid out for the widest word the mark cycles through, not
    // the one showing now: otherwise the links would slide, or the whole bar
    // restack, every time the flock swaps words. Every word gets the widest
    // one's size, and is centred in its slot.
    const widest = CYCLE.concat([word]).reduce((a, b) => (measure(b, 'word') > measure(a, 'word') ? b : a));
    dock._ws = fitWord(widest, Math.min(360, CW * 0.55), DOCK_H, DOCK_CAP);
    const slotW = measure(widest, 'word') * dock._ws;
    dock._wbw = slotW + 20; dock._wbh = dock._ws * 1.35;
    dock._nw = widths; dock._nh = hero._nh; dock._nis = hero._nis;
    // Preferred docked form: wordmark left, links in a row beside it, on the
    // content column if it fits there and otherwise centred on the viewport
    // (down to a 16px margin). Only when even that fails are they stacked,
    // and the bar grows.
    const rowW = widths.reduce((t, w, i) => t + w + (i ? DOCK_GAP : 0), 0);
    const need = slotW + DOCK_LEAD + rowW;
    if (!navEls.length || need <= VW - 32) {
      const left = need <= CW ? padX : (VW - need) / 2;
      dock._barH = DOCK_H;
      dock._wx = left + slotW / 2; dock._wy = DOCK_H / 2;
      let x = left + slotW + DOCK_LEAD;
      widths.forEach((w, i) => {
        dock._nx[i] = x + w / 2; dock._ny[i] = DOCK_H / 2;
        x += w + DOCK_GAP;
      });
    } else {
      const dr = rowsOf(widths, DOCK_GAP, CW, VW / 2);
      const dTop = dock._ws * 1.15 + 10;
      dock._wx = VW / 2; dock._wy = dock._ws * 0.62 + 6;
      dock._nx = dr._cx;
      dock._ny = navEls.map((_a, k) => dTop + dr._row[k] * (rowH + LINE_GAP) + rowH / 2);
      dock._barH = dTop + dr._lines * rowH + (dr._lines - 1) * LINE_GAP + 10;
    }
    // each form holds its own space in the flow: the page reserves the hero's
    // when the mark travels, and just the bar's when it is held there
    dock._band = dock._barH + 86; dock._spacer = dock._barH;
    layA = hero; layB = dock;
  }

  // inline: one layout, read from where the browser laid the mark out.
  function buildFlowLayout() {
    const cr = canvas.getBoundingClientRect();
    const L = emptyLayout();
    if (wordEl) {
      const wr = wordEl.getBoundingClientRect();
      const bw = Math.max(2, wr.width), bh = Math.max(2, wr.height);
      L._ws = fitWord(word, bw, bh, WORD_CAP);
      // a word can sit flush to either edge of its box: a corner signature
      // stays pinned to its corner rather than breathing in and out as the
      // words change width
      const tw = measure(word, 'word') * L._ws;
      L._wx = wr.left - cr.left + (ALIGN === 'right' ? bw - tw / 2 : ALIGN === 'left' ? tw / 2 : bw / 2);
      L._wy = wr.top - cr.top + bh / 2;
      L._wbw = bw; L._wbh = bh;
    }
    navEls.forEach((a, i) => {
      const r = a.getBoundingClientRect();
      L._nx[i] = r.left - cr.left + r.width / 2; L._ny[i] = r.top - cr.top + r.height / 2;
      L._nw[i] = Math.max(2, r.width); L._nh[i] = Math.max(2, r.height);
      L._nis[i] = fitNav(navText(i), Math.max(2, r.width));
    });
    layA = L; layB = L;
  }

  /**
   * absolutely position an element's box about a centre
   * @param {HTMLElement} el
   * @param {number} cx
   * @param {number} cy
   * @param {number} w
   * @param {number} h
   */
  function placeBox(el, cx, cy, w, h) {
    el.style.left = `${cx - w / 2}px`; el.style.top = `${cy - h / 2}px`;
    el.style.width = `${w}px`; el.style.height = `${h}px`;
  }
  /**
   * Put the mark at `t` of its travel: 0 = layA (hero / flow), 1 = the bar.
   * In the fixed modes this also moves the real elements, so the links' hit
   * targets and the ink stay locked together.
   * @param {number} t
   */
  function applyLayout(t) {
    if (!allocated) return;
    const A = layA, B = layB;
    const wx = lerp(A._wx, B._wx, t), wy = lerp(A._wy, B._wy, t), ws = lerp(A._ws, B._ws, t);
    if (DOCKING) {
      wrap.style.setProperty('--ink-clip', `${lerp(A._band, B._band, t)}px`);
      wrap.style.setProperty('--ink-bar', String(t));
      wrap.style.setProperty('--ink-bar-h', `${lerp(A._barH, B._barH, t)}px`);
      if (wordEl) placeBox(wordEl, wx, wy, lerp(A._wbw, B._wbw, t), lerp(A._wbh, B._wbh, t));
    }
    navEls.forEach((a, i) => {
      curNx[i] = lerp(A._nx[i], B._nx[i], t);
      curNy[i] = lerp(A._ny[i], B._ny[i], t);
      curNis[i] = lerp(A._nis[i], B._nis[i], t);
      if (DOCKING) placeBox(a, curNx[i], curNy[i], lerp(A._nw[i], B._nw[i], t), lerp(A._nh[i], B._nh[i], t));
      placeNav(i, curNx[i], curNy[i], curNis[i] * (navHover[i] ? NAV_BOOST : 1));
    });
    placeWord(wx, wy, ws);
    wordThin(ws);
    uploadHomes();
  }

  /**
   * Hover (and keyboard focus) swells one label: its ink is re-placed at a
   * larger size about the same centre, so everything slides straight outward
   * and back rather than reshuffling.
   * @param {number} i
   * @param {boolean} on
   */
  function setHover(i, on) {
    if (!allocated || i >= navOffsets.length || navCur[i]) return;
    navHover[i] = on;
    placeNav(i, curNx[i], curNy[i], curNis[i] * (on ? NAV_BOOST : 1));
    gl.bindBuffer(gl.ARRAY_BUFFER, homeBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, navOffsets[i] * 8, homes, navOffsets[i] * 2, navCounts[i] * 2);
    writeAux(i);
    if (reduce) { settle(); draw(); }
  }
  // The scatter-and-swirl flight used for word transitions and startup; gust
  // strength follows the breeze factor so small marks get small gusts.
  function gesture() {
    flight = 1;
    const a = Math.random() * Math.PI * 2, g = 2.4 * breeze;
    gust[0] += Math.cos(a) * g; gust[1] += Math.sin(a) * g;
  }
  /**
   * @param {string} text
   * @param {boolean} withGesture
   */
  function setTarget(text, withGesture) {
    word = text;
    // A new word is a new form, and a different length: re-fit the layouts to
    // it first (so it is sampled at the size it will actually be drawn), then
    // re-sample and re-place at the current point of the travel.
    if (DOCKING) buildDockLayouts(); else buildFlowLayout();
    wordSample = sampleCached(word, refWordSize(), 'word');
    lastThin = -1;
    applyLayout(dockT);
    if (withGesture) gesture();
  }
  /**
   * Seed every particle within `spread` px of its home with up to `maxVel`
   * drift: spread 0 parks the flock exactly on the text (reduced motion, and
   * the `settle` option); SPAWN_R gives the gentle gather-in on startup/realloc.
   * @param {number} spread
   * @param {number} maxVel
   */
  function seedState(spread, maxVel) {
    const s0 = new Float32Array(N * 5);
    for (let i = 0; i < N; i++) {
      const o = i * 5, a = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const va = Math.random() * Math.PI * 2, vm = Math.random() * maxVel;
      s0[o] = homes[i * 2] + Math.cos(a) * r; s0[o + 1] = homes[i * 2 + 1] + Math.sin(a) * r;
      s0[o + 2] = Math.cos(va) * vm; s0[o + 3] = Math.sin(va) * vm; s0[o + 4] = va;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, stateBuf[cur]);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, s0);
    // Leave no state buffer on the generic binding: transform feedback refuses
    // to write into a buffer that is also bound there, and once the ping-pong
    // flips this would be the write target; every other sim step would be
    // dropped and the flock would judder between two frames.
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }
  // Reduced motion: park every particle on its home and render one still frame.
  const settle = () => seedState(0, 0);

  /**
   * @param {number} t   seconds, for the flow field
   * @param {number} amp breeze amplitude
   * @param {number} seek home-seeking strength
   * @param {number} dtn frame time normalised to 60fps steps
   */
  function sim(t, amp, seek, dtn) {
    gl.useProgram(simProg);
    gl.uniform1f(su.uT, t); gl.uniform1f(su.uSeek, seek); gl.uniform1f(su.uAmp, amp); gl.uniform1f(su.uDtn, dtn);
    gl.uniform1f(su.uBrz, breeze);
    gl.uniform1f(su.uFleeR, FLEE_R); gl.uniform1f(su.uFleeF, PINNED ? 0 : FLEE_FORCE);
    gl.uniform1f(su.uAct, pointer._active ? 1 : 0); gl.uniform2f(su.uPtr, pointer._x, pointer._y);
    gl.uniform2f(su.uGust, gust[0], gust[1]); gl.uniform1f(su.uJit, (gust[0] || gust[1]) ? 1 : 0);
    gl.bindVertexArray(simVao[cur]);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, stateBuf[cur ^ 1]);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, N);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gust[0] = gust[1] = 0;
    cur ^= 1;
  }
  /** Draw one frame: ink coverage offscreen, then the grain composite. */
  function draw() {
    // pass 1: ink coverage accumulates into the offscreen buffer's red channel
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(strokeProg);
    gl.uniform2f(ru.uRes, W, H); gl.uniform1f(ru.uSc, strokeScale);
    gl.bindVertexArray(drawVao[cur]);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, N);
    // pass 2: composite the ink colour over transparent, grain modulating density
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(compProg);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, inkTex); gl.uniform1i(cu.uInk, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, paperTex); gl.uniform1i(cu.uPaperTex, 1);
    gl.uniform2f(cu.uCRes, W, H);
    gl.uniform3f(cu.uInkC, INK[0], INK[1], INK[2]);
    gl.uniform1f(cu.uOpacity, OPACITY);
    gl.bindVertexArray(emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The word is sampled at the largest size it is ever drawn. In the fixed
  // modes that is the hero's cap at the slot height, whatever the viewport
  // width, so there is detail enough at every point of the travel and the
  // particle count is a property of the instance rather than of the window.
  const refWordSize = () => (DOCKING ? slotH * WORD_CAP : layA._ws);
  // dockT is where the mark is on its travel; glide is the part of that which
  // is not explained by the page (see sync), decaying to zero
  let dockT = 0, glide = 0;

  /**
   * Re-sample and re-budget the flock. Flock sizes follow the sampled glyphs:
   * font size and letterform coverage drive particle counts, not the box's
   * area. Everything here is cached, so after the first pass it is a few
   * lookups; the buffers are reallocated only when a budget actually changes,
   * which in the fixed modes is never. Returns true when the flock was
   * reallocated and so needs seeding.
   */
  function resample() {
    wordSample = wordEl ? sampleCached(word, refWordSize(), 'word') : NO_SAMPLE;
    // the word's budget is for the widest word it cycles through, so a cycle
    // never changes the count (wordThin draws the narrower word's share)
    const wn = wordEl
      ? Math.max(...CYCLE.concat([word]).map((w) => sampleCached(w, refWordSize(), 'word')._n))
      : 0;
    NW = wordEl ? Math.max(200, Math.min(16000, Math.round(wn * WORD_DENS))) : 0;
    // Each label is sampled at the size it is drawn: erosion and brush weight
    // follow the sample size, so a sample only looks right at its own. Its
    // particle budget, though, is what it would need as the current page's
    // outsized label, so the budget is the same on every page (see writeAux);
    // the surplus waits hidden. The outsized label is its normal self
    // enlarged: eroded as at its normal size, with a cap that grows with its
    // area.
    const CAP = 1200, capCur = CAP * NAV_CUR * NAV_CUR;
    /**
     * @param {Sample} s
     * @param {number} cap
     */
    const countFor = (s, cap) => Math.max(220, Math.min(cap, Math.round(s._n * NAV_DENS)));
    /** @param {number} i */
    const sampleCur = (i) => sampleCached(navText(i), navSize * NAV_CUR, 'cur', navSize);
    navSamples = navEls.map((_a, i) =>
      navCur[i] ? sampleCur(i) : sampleCached(navText(i), Math.max(layA._nis[i], layB._nis[i]), 'nav'),
    );
    navKeep = navSamples.map((s, i) => countFor(s, navCur[i] ? capCur : CAP));
    navCounts = navSamples.map((_s, i) =>
      !DOCKING || navCur[i] ? navKeep[i] : Math.max(navKeep[i], countFor(sampleCur(i), capCur)),
    );
    let want = NW;
    navOffsets = navCounts.map((c) => { const at = want; want += c; return at; });
    const fresh = want !== N || !allocated;
    if (fresh) { N = want; alloc(); makeJitter(); auxArr = new Float32Array(N * 3); }
    lastThin = -1;
    return fresh;
  }

  /**
   * Bring the instance in line with the page: mode, viewport, layouts, canvas
   * size, samples. Called directly on boot and by the host on each navigation
   * (a new page's spacer has to be right on its first frame), and coalesced
   * to one call per frame for everything else (see requestSync): a window
   * drag fires resize many times a second.
   */
  function sync() {
    if (!alive) return;
    DPR = Math.min(window.devicePixelRatio || 1, DPR_MAX);
    const wasPinned = PINNED;
    readMode();
    if (navEls.length) {
      const fs = parseFloat(getComputedStyle(navEls[0]).fontSize);
      if (fs > 0) navSize = fs;
      navH = Math.max(28, Math.round(navSize * 1.7));
    }
    if (DOCKING) {
      buildDockLayouts();
      wrap.style.setProperty('--ink-band', `${layA._band}px`);
      wrap.style.setProperty('--ink-spacer', `${(PINNED ? layB : layA)._spacer}px`);
    }
    const cr = canvas.getBoundingClientRect();
    W = Math.max(2, Math.round(cr.width)); H = Math.max(2, Math.round(cr.height));
    if (!DOCKING) buildFlowLayout();
    // setting a canvas's size clears it (a blank frame), so only when it moved
    const cw = Math.round(W * DPR), ch = Math.round(H * DPR);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    allocFbo();
    const fresh = resample();
    // the body may be a new element on every page: follow the new one's height
    if (spanObs) { spanObs.disconnect(); spanObs.observe(document.body); }
    updateSpan();
    // A navigation can flip the mode under a running instance. Rather than
    // snapping to the new form, carry the difference as a glide the frame loop
    // decays, so the mark flies between hero and bar just as it does under
    // scroll.
    if (PINNED !== wasPinned && !reduce) glide = dockT - goal();
    dockT = goal() + glide;
    applyLayout(dockT);
    navEls.forEach((_a, i) => writeAux(i));
    if (fresh && !reduce) seedState(spawnR * breeze, spawnR ? 0.6 : 0);
    if (reduce) { settle(); draw(); }
  }
  let syncPending = false;
  function requestSync() {
    if (syncPending) return;
    syncPending = true;
    requestAnimationFrame(() => { syncPending = false; sync(); });
  }
  // The dock travel is scaled to how far the page can scroll (updateSpan), and
  // content that arrives late (images, islands) changes that.
  const spanObs = DOCKING && typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => { if (alive) updateSpan(); })
    : null;

  // The travel is locked to scroll, but a page has to have somewhere to scroll
  // to. Short pages complete the dock over whatever range they do have, and
  // pages that barely scroll at all (nothing worth docking for) keep the mark
  // at full size rather than twitching it on a few px.
  let dockSpan = 0;
  function updateSpan() {
    if (!DOCKING) return;
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    dockSpan = max < 80 ? 0 : Math.min(DOCK_SPAN, max * 0.9);
  }
  // 0 at the top of the page, 1 once it has been scrolled `dockSpan` px, eased
  // so both ends of the travel are calm.
  function dockProgress() {
    if (!DOCKING || !dockSpan) return 0;
    const r = clamp((window.scrollY || 0) / dockSpan, 0, 1);
    return r * r * (3 - 2 * r);
  }
  // where the page wants the mark: held in the bar, or wherever the scroll has
  // taken it
  const goal = () => (PINNED ? 1 : dockProgress());

  // integrate by real elapsed time: speed is identical at 60/120/any fps
  /** @param {number} now rAF timestamp, ms */
  function frame(now) {
    if (!alive) return;
    const t = now * 0.001;
    if (!prevT) prevT = t;
    const dt = Math.min(0.05, t - prevT); prevT = t;
    const dtn = dt * 60;
    flight = Math.max(0, flight - dt / FLIGHT_S);
    // The pointer is kept in client space and mapped onto the canvas here,
    // once a frame and before this frame's style writes, rather than with a
    // layout-forcing rect read on every pointer event.
    if (pointer._active) {
      const pr = canvas.getBoundingClientRect();
      pointer._x = ptrClient._x - pr.left; pointer._y = ptrClient._y - pr.top;
    }
    if (DOCKING) {
      if (glide) { glide *= 0.95 ** dtn; if (Math.abs(glide) < 1e-3) glide = 0; }
      const nt = goal() + glide;
      if (Math.abs(nt - dockT) > 1e-4) {
        // the flock lifts while the mark is actually moving under it, so the
        // travel reads as flight rather than a slide
        travel = Math.min(1, travel + Math.abs(nt - dockT) * 5);
        dockT = nt;
        applyLayout(dockT);
      }
      travel *= 0.93 ** dtn;
      if (travel < 1e-3) travel = 0;
    }
    if (wordEl && CYCLE.length > 1 && now - lastCycle > CYCLE_S * 1000) {
      lastCycle = now;
      cycleIdx = (cycleIdx + 1) % CYCLE.length;
      setTarget(CYCLE[cycleIdx], true);
    }
    const lift = flight + travel * 0.55;
    sim(t, REST_AMP + lift * FLIGHT_AMP, SEEK * (1 - WANDER * flight), dtn);
    draw();
    rafId = requestAnimationFrame(frame);
  }

  // Unified Pointer Events (no mouse+touch mix): avoids iOS synthesizing a
  // mousemove after touchend that re-arms the repel. Listeners live on the
  // window because the canvas never receives events itself.
  // Every listener this instance adds is signed with one controller, so
  // destroy drops them all at once: the window-level ones would outlive the
  // element, and a re-boot on the same element (after a context restore)
  // would stack a second set on the links.
  const ac = new AbortController(), on = { signal: ac.signal };
  const ptrClient = { _x: 0, _y: 0 };
  /** @param {PointerEvent} e */
  const moveAt = (e) => {
    ptrClient._x = e.clientX; ptrClient._y = e.clientY; pointer._active = true;
  };
  const pointerOff = () => { pointer._active = false; };
  window.addEventListener('pointerdown', moveAt, on);
  window.addEventListener('pointermove', moveAt, on);
  document.documentElement.addEventListener('pointerleave', pointerOff, on);
  window.addEventListener('pointerup', pointerOff, on);
  window.addEventListener('pointercancel', pointerOff, on);
  window.addEventListener('blur', pointerOff, on);
  window.addEventListener('resize', requestSync, on);
  // Re-measure once the fonts have settled (the promise resolves either way,
  // and unlike `load` it is there for an instance created after the page too).
  document.fonts?.ready.then(() => { if (alive) requestSync(); });
  // Reduced motion runs no animation loop, so the travel is applied straight
  // from the scroll position, one still frame at a time.
  function onDockScroll() {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      if (!alive) return;
      dockT = goal();
      applyLayout(dockT); settle(); draw();
    });
  }
  if (DOCKING && reduce) window.addEventListener('scroll', onDockScroll, { passive: true, signal: ac.signal });
  // nav hover (and keyboard focus) swells the hovered label. Focus is gated on
  // :focus-visible: refocusing the window re-fires `focus` on the last clicked
  // anchor (e.g. a mailto link that kept document focus), which must not
  // re-trigger the swell; only real keyboard focus should.
  navEls.forEach((a, i) => {
    a.addEventListener('pointerenter', () => setHover(i, true), on);
    a.addEventListener('pointerleave', () => setHover(i, false), on);
    a.addEventListener('focus', () => {
      try { if (!a.matches(':focus-visible')) return; } catch { /* no :focus-visible */ }
      setHover(i, true);
    }, on);
    a.addEventListener('blur', () => setHover(i, false), on);
  });

  /**
   * Stop the loop, drop every listener and hand back the GL context, which
   * browsers only allow a handful of. `keepContext` is for a context the
   * browser itself took away: it will hand it back, and there is nothing left
   * to release meanwhile.
   * @param {boolean} keepContext
   */
  function destroy(keepContext) {
    if (!alive) return;
    alive = false;
    if (rafId) cancelAnimationFrame(rafId);
    ac.abort();
    spanObs?.disconnect();
    if (keepContext) return;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  sync();
  if (reduce) {
    settle(); draw();
  } else {
    // Particles spawn in a tight halo around their homes (seedState in sync);
    // the opening gust still swirls the flock once before settling. A settled
    // mark starts parked on the word instead, and nav particles ignore gusts,
    // so links-only instances skip it too.
    if (wordEl && !opts.settle) gesture();
    lastCycle = performance.now();
    rafId = requestAnimationFrame(frame);
  }
  return { sync, destroy };
}
