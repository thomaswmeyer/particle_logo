# particle_logo

The tom.to identity mark: a flock of brush-drawn "birds" rendered in WebGL that
forms a wordmark, scatters when disturbed, and drifts between `tom.to` and
`tom meyer`. One engine, used three ways:

| use | how | where it runs |
|---|---|---|
| a site's masthead: the word over a row of nav links, docking into a bar as the page scrolls | `mountInkMark({ wrap, word, nav, mode })` | [tom.to](https://tom.to) (`src/components/InkMark.astro` in tomto_blog) |
| a signature embedded in a game's own markup | `mountInkMark({ ...SIGNATURE, wrap })` | Lord of the Swarm's splash |
| an overlay dropped onto a finished page | `overlayInkMark({ until })`, or `dist/overlay.iife.js` in a script tag | Rainbow Balance's start screen |

The simulation runs on the GPU via transform feedback. Particle homes come from
a distance-transform sample of the text that preserves each stroke's medial
ridge, so thin strokes never vanish beside thick ones; paper grain is a tileable
texture baked once and composited so it shows only in the ink. Samples are
stored as offsets in font-size units about the text's centre, so placing the
flock is a similarity transform: any position, any size, no re-rasterising,
which is what lets the masthead's one instance travel from hero to bar.
Requires WebGL2; without it the host's plain text stays visible.

## Use

```sh
npm install github:thomaswmeyer/particle_logo#<commit>
```

It is not on npm: pin a commit. `dist/` is committed, so the install needs no
build step and no install scripts.

```js
import { mountInkMark, SIGNATURE } from 'particle_logo';

// the engine draws into a transparent canvas, sized by CSS, and forms the word
// in the box of `word` (default: wrap itself). `wrap` carries `is-live` while
// the engine runs, which is the host's cue to hide its plain-text fallback.
const mark = mountInkMark({ ...SIGNATURE, wrap: document.getElementById('splash-mark') });
mark?.destroy(); // when the element goes: drops the listeners and the GL context
```

```js
import { overlayInkMark } from 'particle_logo/overlay';

// makes its own link, canvas and styles in the bottom-right corner, and leaves
// (fades, then releases its context) once #start-screen is hidden or removed
overlayInkMark({ until: '#start-screen', bottom: 100 });
```

Or, with no bundler at all, append `dist/overlay.iife.js` to the page as a
script; it mounts itself when it runs, with its options as data attributes:

```html
<script data-until="#start-screen" data-bottom="100">…dist/overlay.iife.js…</script>
```

`src/inkmark.js` documents every option in its JSDoc, and `dist/*.d.ts` carry
the same as types. The engine takes its text metrics from the host's font, so
the fallback text's CSS should use `FONT_FAMILY` (exported) for the two to line
up. `exports` resolve to `src/` under the `development` condition (Vite's dev
server), so a driver's shader log points at the source as written, and to the
minified `dist/` everywhere else.

### Modes

- **inline** (default): the mark forms in its own layout box.
- **dock**: one instance that travels. It renders into a fixed, click-through
  stage and interpolates between a full-size hero and a compact bar as the
  page scrolls, positioning `word` and the `nav` links so the hit targets
  travel with the ink. It drives the host's CSS through custom properties on
  `wrap`: `--ink-band` (the stage height), `--ink-spacer` (the space to hold in
  the flow), `--ink-clip` (where to feather the canvas out), `--ink-bar` (0..1,
  how far into the bar) and `--ink-bar-h`.
- **banner**: the dock's bar, held. A running instance switches between dock
  and banner as the page changes: on each `sync()` it re-reads the mode from
  the nearest `[data-inkmark]` ancestor of `wrap`'s parent and glides between
  the forms rather than snapping. The host calls `sync()` on every navigation
  and whenever its layout changes under the mark; resizes are handled.

The blog's `InkMark.astro` is the reference host for the fixed modes: the
markup and CSS live there, the engine here.

## Develop

```sh
npm install
npm run check   # tsc over the JSDoc types
npm run build   # src/ → dist/, and commit the result
npm test        # boots src/ and dist/ in headless Chromium: shaders compile, ink is drawn
npm run demo    # http://localhost:8765/demo/  (?dist for the built files)
```

The build is Rainbow Balance's squeeze, less the zip: every `#version 300 es`
template literal goes through
[shader-minifier-js](https://github.com/thomaswmeyer/shader-minifier-js) (the
port of Shader Minifier, pinned to a commit; uniforms, attributes and varyings
keep their names, since the engine looks them up by name), then esbuild
bundles and minifies, then terser makes a second pass mangling every property
that starts with `_`, which is why the source names its internals that way.
`npm run build -- --pack` also writes `dist/overlay.packed.js` through
Roadroller, for a page that ships in a zip; a page served with brotli gains
nothing from it. The build prints what each stage bought and what a page pays
after gzip and brotli.

`npm test` needs Chromium; playwright's own if it is installed, else the one at
`$CHROMIUM_EXECUTABLE` or `/opt/pw-browsers/chromium`. It is a boot-and-draw
check for both the source and the built files, not a pixel comparison between
them: the flock is seeded at random, so two runs never match, but a shader the
minifier broke fails to compile, and that is what the test catches.
