'use strict';
/**
 * Startet das Cockpit lokal mit Beispieldaten (nur zum Ausprobieren, nicht fuer echte Daten).
 *   npm run demo   ->  http://localhost:8080/app/
 * Team-Login: Kuerzel "lena", "marco" oder "sofia", PIN 123456. Chef-Schluessel wird beim Start angezeigt.
 */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { FileStore } = require('../src/store/memory');
const { parseKeys, sha256 } = require('../src/auth');
const { makeSessions, hashPin } = require('../src/session');

const file = path.join(__dirname, '..', 'data', 'demo-db.json');
if (require.main === module && process.argv.includes('--reset') && fs.existsSync(file)) fs.rmSync(file);
const fresh = !fs.existsSync(file);
const store = require.main === module ? new FileStore(file) : null;

// Fester Demo-Schluessel, damit Screenshots/Tests reproduzierbar sind. NIE produktiv verwenden.
const OWNER_KEY = process.env.DEMO_KEY || 'demo-chef-schluessel-nur-zum-testen-123';
const keys = parseKeys(`chef:write:${sha256(OWNER_KEY).toString('hex')}`);

const rnd = (() => { let s = 42; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const pick = (a) => a[Math.floor(rnd() * a.length)];

async function seed() { return seedInto(store); }
async function seedInto(store) {
  const now = Date.now();
  const fees = [['Kurs 4 Wochen', 9900, 'kursgebuehr'], ['Einzelstunde', 1500, 'kursgebuehr'], ['10er-Karte', 12000, 'kursgebuehr']]
    .map(([name, priceCents, category], i) => ({ id: `k${i + 1}`, name, priceCents, category, active: true, sort: 5 + i, createdAt: new Date(now).toISOString() }));
  for (const p of fees) await store.putDoc('products', p);
  const tickets = [['Eintritt Übungsabend', 800, 'eintritt'], ['Workshop + Party', 2500, 'workshop'], ['Workshop-Teilnehmer inkl.', 0, 'eintritt']]
    .map(([name, priceCents, category], i) => ({ id: `t${i + 1}`, name, priceCents, category, active: true, sort: i, createdAt: new Date(now).toISOString() }));
  for (const p of tickets) await store.putDoc('products', p);
  const products = [
    ['Wasser', 300, 'softdrinks'], ['Cola', 350, 'softdrinks'], ['Apfelschorle', 350, 'softdrinks'], ['Club-Mate', 400, 'softdrinks'],
    ['Bier 0,33', 400, 'bier'], ['Radler', 400, 'bier'], ['Weißwein', 550, 'wein'], ['Prosecco', 600, 'wein'],
    ['Mojito', 850, 'cocktails'], ['Caipirinha', 850, 'cocktails'], ['Cuba Libre', 750, 'longdrinks'], ['Rum-Shot', 350, 'shots'],
  ].map(([name, priceCents, category], i) => ({ id: `p${i + 1}`, name, priceCents, category, active: true, sort: i * 10, createdAt: new Date(now).toISOString() }));
  for (const p of products) await store.putDoc('products', p);

  const staff = [['lena', 1390], ['marco', 1500], ['sofia', 1390], ['diego', 2500]];
  for (const [ref, rate] of staff) await store.putDoc('staff', { id: ref, ref, pinHash: hashPin('123456'), hourlyRateCents: rate, active: true, createdAt: new Date(now).toISOString() });

  await store.putDoc('settings', { id: 'main', targets: { utilizationPct: 75, openPaymentsPct: 5, barPerGuestCents: 600, barPersonnelPct: 30 }, fixedCostsCents: { maxvorstadt: 320000, pasing: 210000 }, minijobLimitCents: 60300 });

  // Kurse + Anmeldungen
  const courses = [
    ['Salsa Beginner', 'maxvorstadt', 'salsa', 1, '19:00', 20, 17], ['Salsa Improver', 'maxvorstadt', 'salsa', 1, '20:15', 20, 12],
    ['Bachata Beginner', 'maxvorstadt', 'bachata', 3, '19:00', 24, 23], ['Kizomba Basics', 'pasing', 'kizomba', 2, '19:30', 16, 6],
    ['Salsa Beginner Pasing', 'pasing', 'salsa', 4, '19:00', 18, 14],
  ];
  for (const [title, location, style, weekday, startTime, capacity, n] of courses) {
    const c = await store.createCourse({ title, location, style, level: 'Beginner', weekday, startTime, durationMin: 75, startDate: new Date(now).toISOString().slice(0, 10), capacity, priceCents: 9900, published: true });
    for (let i = 0; i < n; i++) {
      const r = rnd();
      await store.createEnrollment(c.id, { participantRef: `bs-${c.id.slice(0, 4)}-${i}`, paymentStatus: r < 0.82 ? 'paid' : 'open', amountPaidCents: r < 0.82 ? 9900 : 0 });
    }
  }

  // Bar-Abende der letzten ~4 Wochen: Mi (Pasing), Fr + Sa (Maxvorstadt)
  let stock = Object.fromEntries(products.map((p) => [p.id, 40]));
  const stockByLoc = { maxvorstadt: { ...stock }, pasing: { ...stock } };
  for (let d = 45; d >= 1; d--) {
    const day = new Date(now - d * 86_400_000);
    const wd = day.getDay();
    const location = wd === 3 ? 'pasing' : wd === 5 || wd === 6 ? 'maxvorstadt' : null;
    if (!location) continue;
    const date = day.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const open = new Date(`${date}T20:30:00+01:00`);
    const close = new Date(`${date}T23:59:00+01:00`);
    const guests = Math.round((wd === 6 ? 110 : wd === 5 ? 80 : 45) * (0.8 + rnd() * 0.4));
    const sid = crypto.randomUUID();      // Theke
    const doorSid = crypto.randomUUID();  // Tuer
    const start = { ...stockByLoc[location] };
    const restock = {};
    for (const p of products) if (start[p.id] < 25) { restock[p.id] = 24; }
    // Eintritt: an Samstagen mit Workshop kommen Workshop-Leute inkl. zur Party
    const withWorkshop = wd === 6 && rnd() < 0.6;
    for (let g = 0; g < guests; g++) {
      const t = withWorkshop && g < 22 ? (g < 18 ? tickets[1] : tickets[2]) : tickets[0];
      await store.putDoc('sales', { id: crypto.randomUUID(), sessionId: doorSid, at: new Date(open.getTime() + rnd() * 90 * 60_000).toISOString(), by: 'sofia', payment: rnd() < 0.6 ? 'bar' : 'karte', items: [{ productId: t.id, qty: 1, priceCents: t.priceCents }] });
    }
    // Kursgebuehren vor Ort (vor dem Uebungsabend)
    for (let k = 0, n = Math.floor(rnd() * 4); k < n; k++) {
      const f = pick(fees);
      await store.putDoc('sales', { id: crypto.randomUUID(), sessionId: sid, at: new Date(open.getTime() - 20 * 60_000).toISOString(), by: 'lena', payment: rnd() < 0.5 ? 'bar' : 'karte', note: pick(['Anna K.', 'Tom', 'bs-2231', 'Mehmet', 'Julia S.']), items: [{ productId: f.id, qty: 1, priceCents: f.priceCents }] });
    }
    const sold = {};
    const nSales = Math.round(guests * (wd === 3 ? 0.9 : 1.05));
    for (let i = 0; i < nSales; i++) {
      const p = rnd() < 0.55 ? pick(products.slice(0, 6)) : pick(products);
      const qty = rnd() < 0.8 ? 1 : 2;
      const payment = rnd() < 0.03 ? 'gratis' : rnd() < 0.45 ? 'karte' : 'bar';
      sold[p.id] = (sold[p.id] || 0) + qty;
      await store.putDoc('sales', { id: crypto.randomUUID(), sessionId: sid, at: new Date(open.getTime() + rnd() * (close - open)).toISOString(), by: pick(['lena', 'marco', 'sofia']), payment, items: [{ productId: p.id, qty, priceCents: p.priceCents }] });
    }
    const end = {};
    for (const p of products) end[p.id] = Math.max(0, start[p.id] + (restock[p.id] || 0) - (sold[p.id] || 0) - (rnd() < 0.07 ? 1 : 0));
    stockByLoc[location] = end;
    const cashSales = (await store.listDocs('sales')).filter((x) => x.sessionId === sid && x.payment === 'bar').reduce((a, x) => a + x.items[0].qty * x.items[0].priceCents, 0);
    const diff = rnd() < 0.15 ? -Math.round(rnd() * 3000) : 0;
    const doorCash = (await store.listDocs('sales')).filter((x) => x.sessionId === doorSid && x.payment === 'bar').reduce((a, x) => a + x.items[0].qty * x.items[0].priceCents, 0);
    await store.putDoc('barsessions', { id: doorSid, date, location, station: 'tuer', cashStartCents: 10000, stockStart: {}, openedBy: 'sofia', openedAt: new Date(open.getTime() - 10 * 60_000).toISOString(), restock: {}, stockEnd: {}, cashOutCents: 0, cashEndCents: 10000 + doorCash - (rnd() < 0.1 ? 1000 : 0), closedBy: 'sofia', closedAt: new Date(open.getTime() + 150 * 60_000).toISOString() });
    await store.putDoc('barsessions', { id: sid, station: 'theke', date, location, cashStartCents: 15000, stockStart: start, openedBy: 'lena', openedAt: open.toISOString(), restock, stockEnd: end, cashOutCents: 0, cashEndCents: 15000 + cashSales + diff, closedBy: 'marco', closedAt: close.toISOString() });

    // Schichten passend zum Abend
    const team = ['lena', 'marco'];
    await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'sofia', kind: 'empfang', location, start: new Date(open.getTime() - 20 * 60_000).toISOString(), end: new Date(open.getTime() + 160 * 60_000).toISOString(), rateCents: 1390, createdBy: 'sofia' });
    for (const ref of team) {
      const rate = staff.find((s) => s[0] === ref)[1];
      await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: ref, kind: 'bar', location, start: new Date(open.getTime() - 30 * 60_000).toISOString(), end: new Date(close.getTime() + 30 * 60_000).toISOString(), rateCents: rate, createdBy: ref });
    }
  }
  // Aushilfen (nicht registriert), Stunden auf die Viertelstunde aufgerundet
  const helperDays = [12, 5].map((d) => new Date(now - d * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));
  await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'Carla', helper: true, kind: 'bar', location: 'maxvorstadt', start: new Date(`${helperDays[0]}T20:30:00+01:00`).toISOString(), end: new Date(`${helperDays[0]}T23:45:00+01:00`).toISOString(), rateCents: 1390, payout: 'bar', paid: true, createdBy: 'kasse' });
  await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'Jonas', helper: true, kind: 'empfang', location: 'pasing', start: new Date(`${helperDays[1]}T19:45:00+01:00`).toISOString(), end: new Date(`${helperDays[1]}T22:50:00+01:00`).toISOString(), rateCents: 1500, payout: 'ueberweisung', paid: false, createdBy: 'kasse' });
  // Unterricht (Tanzlehrer diego)
  for (let d = 45; d >= 1; d--) {
    const day = new Date(now - d * 86_400_000);
    if (![1, 3].includes(day.getDay())) continue;
    const date = day.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'diego', kind: 'kurs', location: 'maxvorstadt', start: new Date(`${date}T18:45:00+01:00`).toISOString(), end: new Date(`${date}T21:30:00+01:00`).toISOString(), rateCents: 2500, createdBy: 'diego' });
  }
}

module.exports = { seed: seedInto };

if (require.main === module) (async () => {
  if (fresh) { await seed(); console.log('Beispieldaten angelegt.'); }
  const app = createApp({ store, keys, sessions: makeSessions(crypto.randomBytes(32).toString('hex')), logger: () => {} });
  const port = Number(process.env.PORT) || 8080;
  app.listen(port, () => {
    console.log(`Cockpit (Demo): http://localhost:${port}/app/`);
    console.log('Team: Kürzel lena / marco / sofia / diego, PIN 123456');
    console.log(`Chef-Schlüssel: ${OWNER_KEY}`);
  });
})();
