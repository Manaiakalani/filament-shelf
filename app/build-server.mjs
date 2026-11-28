// Builds the self-hosted bundle into dist-server/: a page template, hashed JS/CSS, fonts, icon,
// the catalog, and validate.mjs (the app's own backup validator, for the server to reuse).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const out = 'dist-server', assets = path.join(out, 'assets');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(assets, { recursive: true });
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

const js = (await build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, write: false, format: 'iife', target: 'es2019',
  jsx: 'automatic', legalComments: 'none', define: { 'process.env.NODE_ENV': '"production"' },
})).outputFiles[0].text;

fs.writeFileSync('.selfhost-entry.css', '@import "./src/fonts-selfhost.css";\n' + fs.readFileSync('src/styles.css', 'utf8') +
  '\n:root{--display:"Bricolage Grotesque Variable","Bricolage Grotesque","Avenir Next","Segoe UI",system-ui,sans-serif;--body:"Instrument Sans Variable","Instrument Sans","Avenir Next","Segoe UI",system-ui,sans-serif}\n');
const cssRes = await build({
  entryPoints: ['.selfhost-entry.css'], bundle: true, minify: true, write: false, outdir: assets,
  loader: { '.woff2': 'file', '.woff': 'file' }, assetNames: '[name]-[hash]', publicPath: '/assets', legalComments: 'none',
});
fs.rmSync('.selfhost-entry.css');
let css = '';
for (const f of cssRes.outputFiles) {
  if (f.path.endsWith('.css')) css = f.text;
  else fs.writeFileSync(path.join(assets, path.basename(f.path)), f.contents);
}
const jsName = 'app-' + hash(js) + '.js', cssName = 'app-' + hash(css) + '.css';
fs.writeFileSync(path.join(assets, jsName), js);
fs.writeFileSync(path.join(assets, cssName), css);
const icon = fs.readFileSync('icon.png');
const iconName = 'icon-' + hash(icon) + '.png';
fs.writeFileSync(path.join(assets, iconName), icon);

const catalog = JSON.stringify(JSON.parse(fs.readFileSync('src/catalog.json', 'utf8'))).replace(/</g, '\\u003c');
let html = fs.readFileSync('template-server.html', 'utf8').replace('__JS__', jsName).replace('__CSS__', cssName).replaceAll('__ICON__', iconName).replace('__CATALOG__', () => catalog);
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync('src/seed.json', path.join(out, 'seed.json'));
fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
  name: 'Filament Shelf', short_name: 'Shelf', start_url: '/', scope: '/', display: 'standalone',
  background_color: '#C9D0DB', theme_color: '#C9D0DB',
  icons: [
    { src: '/assets/' + iconName, sizes: '1024x1024', type: 'image/png', purpose: 'any' },
    { src: '/assets/' + iconName, sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
  ],
}));

await build({ entryPoints: ['src/validate-entry.mjs'], bundle: true, platform: 'node', format: 'esm', outfile: path.join(out, 'validate.mjs'), legalComments: 'none' });
const size = (p) => (fs.statSync(p).size / 1024).toFixed(0) + ' KB';
console.log('dist-server ready:', jsName, size(path.join(assets, jsName)), cssName, size(path.join(assets, cssName)), fs.readdirSync(assets).length, 'asset files');
