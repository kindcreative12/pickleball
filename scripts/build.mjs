// Produces dist/ — the whole game as static files. The Node server serves this
// directory too, so local play and GitHub Pages run byte-identical output.
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';

const OUT = 'dist';

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

await esbuild.build({
  entryPoints: ['src/client/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production',
  outfile: `${OUT}/bundle.js`,
});

copyFileSync('src/client/index.html', `${OUT}/index.html`);

// Pages pipes output through Jekyll unless this file exists, which would drop
// anything it treats as a source file rather than an asset.
writeFileSync(`${OUT}/.nojekyll`, '');

console.log(`built -> ${OUT}/`);
