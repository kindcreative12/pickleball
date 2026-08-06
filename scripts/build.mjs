// Produces dist/ — the whole game as static files. The Node server serves this
// directory too, so local play and GitHub Pages run byte-identical output.
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const OUT = 'dist';
const production = process.env.NODE_ENV === 'production';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/**
 * The bundle filename carries a content hash. Pages serves everything with a
 * ten-minute cache and the HTML and the script are separate requests, so a
 * fixed name lets a browser pair new HTML with a stale script — which in this
 * game means peers silently disagreeing about the wire format. Hashing makes
 * that impossible: new HTML can only ever reference the matching bundle.
 */
const result = await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: production,
  sourcemap: !production,
  outdir: OUT,
  entryNames: 'bundle-[hash]',
  metafile: true,
});

const bundle = Object.keys(result.metafile.outputs)
  .map((p) => p.replace(/\\/g, '/'))
  .find((p) => p.endsWith('.js'));
if (!bundle) throw new Error('esbuild produced no javascript output');
const bundleName = bundle.split('/').pop();

const source = readFileSync('src/client/index.html', 'utf8');
const html = source.replace('./bundle.js', `./${bundleName}`);
if (html === source) {
  throw new Error('index.html no longer references ./bundle.js — nothing to rewrite');
}
writeFileSync(`${OUT}/index.html`, html);

// Pages pipes output through Jekyll unless this file exists, which would drop
// anything it treats as a source file rather than an asset.
writeFileSync(`${OUT}/.nojekyll`, '');

console.log(`built -> ${OUT}/ (${bundleName})`);
