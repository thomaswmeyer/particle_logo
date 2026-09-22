# particle_logo

A wordmark drawn by a flock of WebGL brush strokes that scatters from the
cursor and re-forms. The tom.to mark; usable for any short word.

## Size

| file | minified | brotli | what it is |
|---|--:|--:|---|
| `dist/inkmark.js` | 20.1 KB | 7.6 KB | the engine, ESM |
| `dist/overlay.js` | 2.1 KB | 0.9 KB | corner overlay, imports the engine |
| `dist/overlay.iife.js` | 22.2 KB | 8.3 KB | overlay + engine, self-mounting script tag |

4.8 KB of the engine is GLSL (10.7 KB before shader-minifier-js). Nothing is
loaded at runtime: no fonts, no textures, the paper grain is baked on boot.
At runtime the flock is a few thousand particles simulated on the GPU
(transform feedback) and two draw calls a frame; it runs at 60 fps on a phone.
Without WebGL2 it does nothing and the host's text stays.

## Use

```sh
npm install github:thomaswmeyer/particle_logo#<commit>   # not on npm; pin a commit
```

`dist/` is committed, so installing needs no build.

```js
import { mountInkMark } from 'particle_logo';

const mark = mountInkMark({
  wrap: el,                        // gets class `is-live` while running; hide your text with it
  words: ['acme', 'acme labs'],    // cycled every 8 s; one word never changes
  font: 'Georgia, serif',          // what the text is rasterised in; match your fallback text
  ink: [0.09, 0.07, 0.05],         // 0..1 RGB
  opacity: 1,
  align: 'center',                 // or 'left' | 'right', inside `wrap`'s box
  wordCap: 0.42,                   // font size ≤ this × box height
  fleeR: 122, fleeForce: 4.6,      // cursor scatter radius (px) and strength; 0 disables
  settle: false,                   // true: start parked on the word, no opening gust
});
mark?.destroy();
```

The markup is yours: `wrap` holds a transparent `<canvas>` sized by CSS (give
it overscan so scattered strokes are not clipped) and the fallback text. The
word forms in `wrap`'s box, or in `word` if you pass one. See `demo/`.

Presets and other entry points:

- `SIGNATURE`: white, right-aligned, gentle flee, settled. A corner of a game's
  splash: `mountInkMark({ ...SIGNATURE, wrap })`.
- `overlayInkMark({ until: '#start-screen', bottom: 100 })` from
  `particle_logo/overlay`: makes its own link and canvas bottom-right and
  leaves when `until` is hidden or removed.
- `dist/overlay.iife.js` in a `<script>` tag does the same with no bundler,
  options as `data-until`, `data-bottom`, `data-words`, `data-font`, `data-href`.
- `nav: [...links]`: a row of `<a>` elements the flock also letters (they stay
  the hit targets). `mode: 'dock' | 'banner'` makes one instance fly between a
  hero and a top bar as the page scrolls; the host CSS is driven by custom
  properties on `wrap`. tom.to's `InkMark.astro` is the reference for that.

Every option is documented in `src/inkmark.js`; `dist/*.d.ts` are the types.

## Develop

```sh
npm run check   # tsc over the JSDoc
npm run build   # src/ → dist/; commit the result
npm test        # boots src/ and dist/ in headless Chromium: shaders compile, ink is drawn
npm run demo    # localhost:8765/demo/  (?dist for the built files)
```

Build: each `#version 300 es` template through shader-minifier-js (uniforms,
attributes and varyings keep their names), esbuild, then terser mangling every
`_`-prefixed property, which is why internals are named that way.
`npm run build -- --pack` adds a Roadroller build for pages shipped in a zip;
under brotli it gains nothing.
