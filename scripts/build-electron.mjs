import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

await Promise.all([
  build({
    entryPoints: [path.join(root, 'electron', 'main.ts')],
    outfile: path.join(root, 'dist-electron', 'main.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
  }),
  build({
    entryPoints: [path.join(root, 'electron', 'preload.ts')],
    outfile: path.join(root, 'dist-electron', 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
  }),
]);

console.log('Built electron main.cjs and preload.cjs');
