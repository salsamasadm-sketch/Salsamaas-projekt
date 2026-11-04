'use strict';
/**
 * Baut eine einzelne, eigenstaendige HTML-Datei der Cockpit-App mit Beispieldaten.
 * Laeuft komplett im Browser (keine echte Datenbank, kein Server) – zum Ansehen und Weitergeben.
 *   node scripts/build-demo.js [ziel.html]
 */
const fs = require('node:fs');
const path = require('node:path');
const { FileStore } = require('../src/store/memory');
const { seed } = require('./demo');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const out = process.argv[2] || path.join(root, 'data', 'cockpit-demo.html');
// CommonJS-Datei als Browser-Modul einbetten
const wrap = (file, name, deps = {}) => `(() => { const module = { exports: {} }; const require = (n) => (${JSON.stringify(deps)})[n] && window.__cockpit[(${JSON.stringify(deps)})[n]];\n${read(file)}\nwindow.__cockpit.${name} = module.exports; })();`;
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

(async () => {
  const store = new FileStore(null);
  await seed(store);
  const db = store.db;
  for (const p of Object.values(db.staff)) delete p.pinHash;
  // Startmonat der Demo: der Monat mit den meisten Kassenabenden
  const counts = {};
  for (const b of Object.values(db.barsessions)) counts[b.date.slice(0, 7)] = (counts[b.date.slice(0, 7)] || 0) + 1;
  const month = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];

  // Echtes Logo einbetten (hell + dunkel), falls vorhanden
  const dataUri = (f) => { const fp = path.join(root, 'src', 'public', f); return fs.existsSync(fp) ? `data:image/png;base64,${fs.readFileSync(fp).toString('base64')}` : ''; };
  const logo = dataUri('logo.png');
  const logoDark = dataUri('logo-dark.png') || logo;
  const html = `<title>Salsamás Cockpit</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#14161b">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=IBM+Plex+Mono:wght@400;500;600&family=Hanken+Grotesk:wght@400;500;600;700&display=swap">
<style>
${read('src/public/style.css')}
</style>
<div class="demobar"><span>Demo mit Beispieldaten · Änderungen bleiben nur in diesem Browser</span><button type="button" id="demo-reset">Demo zurücksetzen</button></div>
<header class="top">
  <div class="brand">${logo ? `<img class="logo-img logo-light" src="${logo}" alt="Tanzschule Salsamás"><img class="logo-img logo-dark" src="${logoDark}" alt="">` : ''}<span class="wordmark">Salsamás</span><span class="tag">Cockpit</span></div>
  <button id="logout" class="ghost hidden" type="button">Abmelden</button>
</header>
<nav id="tabs" class="tabs hidden"></nav>
<main id="view"><p class="muted">Lädt …</p></main>
<div id="toast" class="toast hidden" role="status"></div>
<script>
window.__cockpit = {};
window.COCKPIT_DEMO = true;
window.COCKPIT_DEFAULT_MONTH = ${JSON.stringify(month)};
${safe(wrap('src/bar.js', 'bar'))}
${safe(wrap('src/plan.js', 'plan', { './bar': 'bar' }))}
${safe(wrap('src/dashboard.js', 'dashboard', { './bar': 'bar', './plan': 'plan' }))}
window.__cockpit.seed = ${safe(JSON.stringify(db))};
${safe(read('src/demo/mock-api.js'))}
document.getElementById('demo-reset').addEventListener('click', () => window.__cockpit.resetDemo());
${safe(read('src/public/app.js'))}
</script>
`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  console.log(`Demo gebaut: ${out} (${Math.round(html.length / 1024)} KB, Startmonat ${month})`);
})();
