/**
 * A static server for the repo root, no dependencies: `npm run demo` serves
 * the demo page, and the smoke test uses the same server on a spare port.
 */
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, dirname, normalize } from 'path';
import { fileURLToPath } from 'url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.ts': 'text/plain' };

/**
 * @param {number} port 0 picks a free one
 * @returns {Promise<{ url: string, close(): void }>}
 */
export function serve(port = 0) {
    const server = createServer(async (req, res) => {
        const path = normalize(decodeURIComponent((req.url || '/').split('?')[0]));
        if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
        const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
        if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        try {
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
            res.end(body);
        } catch {
            res.writeHead(404); res.end('not found');
        }
    });
    return new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => {
            const a = /** @type {import('net').AddressInfo} */ (server.address());
            resolve({ url: `http://127.0.0.1:${a.port}`, close: () => server.close() });
        });
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { url } = await serve(8765);
    console.log(`${url}/demo/  (add ?dist for the built files)`);
}
