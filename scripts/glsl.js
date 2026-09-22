/**
 * Shader minification, through `shader-minifier-js` (the TypeScript port of
 * Ctrl-Alt-Test's Shader Minifier, github.com/thomaswmeyer/shader-minifier-js),
 * pinned to a commit in package.json.
 *
 * It is a real compiler pass: it parses, folds constants, inlines single-use
 * locals and functions, and renames every identifier the JS side does not
 * address by name. Uniforms, attributes and varyings keep their names
 * (`preserveExternals`) because the engine looks them up by name, and `main`
 * is never renamed. The options are the ones its Vite plugin uses, so this
 * build and a Vite build agree, and the plugin's `test/angle-compile.test.ts`
 * is the promise that ANGLE accepts the output. `--webgl` is on, which is the
 * flag that refuses the two rewrites Chrome rejects.
 *
 * Every shader is a template literal that starts with `#version 300 es` and
 * is a whole translation unit: there is no path for snippets meant to be
 * concatenated later, since the minifier renames functions and would break a
 * call it cannot see.
 */

import { minify } from 'shader-minifier-js';
import { toMinifierOptions } from 'shader-minifier-js/vite';

/** Matches a whole-shader template literal in a source file, body in group 1. */
export const SHADER_TEMPLATE = /`(#version 300 es[^`]*)`/g;

/** The Vite plugin's defaults, so this build and a Vite build agree. */
const OPTIONS = toMinifierOptions({});

/**
 * @param {string} src a whole shader, `#version` first
 * @param {string} [name] for error messages
 * @returns {string}
 */
export function minifyGlsl(src, name = 'shader') {
    // The extension only names the file in error messages; the port reads the
    // stage off the code (`gl_Position` means vertex) for --drop-default-precision.
    const file = `${name}.${/gl_Position/.test(src) ? 'vert' : 'frag'}`;
    try {
        return minify([{ name: file, content: src }], OPTIONS).code.trim();
    } catch (e) {
        throw new Error(`GLSL minification failed (${file}): ${e.message}`);
    }
}
