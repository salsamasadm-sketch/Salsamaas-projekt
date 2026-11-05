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
  const { TICKETS } = require('../src/catalog');
  const tickets = TICKETS.map((c, i) => ({ id: `t${i + 1}`, ...c, active: true, sort: i, createdAt: new Date(now).toISOString() }));
  // Indizes: 0 Eintritt 10 €, 1 inkl. 0 €, 2 Workshop Einzel, 3 mit Partner, 4 2 Workshops Einzel, 5 2 Workshops Partner
  for (const p of tickets) await store.putDoc('products', p);
  // Echte Salsamas-Getraenkekarte mit Einkaufspreisen aus der METRO-Rechnung
  const { CATALOG } = require('../src/catalog');
  const products = CATALOG.map((c, i) => ({ id: `p${i + 1}`, name: c.name, priceCents: c.priceCents, costCents: c.costCents, color: c.color, source: c.source, category: c.category, active: true, sort: 100 + i * 10, createdAt: new Date(now).toISOString() }));
  for (const p of products) await store.putDoc('products', p);

  // Beschaeftigungsart: Minijob (Bar/Tuer) oder auf Rechnung (Trainer)
  const staff = [['lena', 1390, 'minijob'], ['marco', 1500, 'minijob'], ['sofia', 1390, 'minijob'], ['diego', 2500, 'rechnung'], ['carmen', 3500, 'rechnung']];
  for (const [ref, rate, employment] of staff) await store.putDoc('staff', { id: ref, ref, pinHash: hashPin('123456'), hourlyRateCents: rate, employment, active: true, createdAt: new Date(now).toISOString() });

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
      // Workshop am Samstag: Teilnehmer kaufen Workshop-Tickets und bleiben mit 0-€-Eintritt
      if (withWorkshop && g < 18) {
        const passWs = tickets.filter((x) => x.category === 'checkin' && x.checkinFor === 'workshop');
        const w = g % 4 === 0 ? pick(passWs) : pick([tickets[2], tickets[3], tickets[3], tickets[4], tickets[5], tickets[5]]);
        await store.putDoc('sales', { id: crypto.randomUUID(), sessionId: doorSid, at: new Date(open.getTime() - 4 * 3_600_000).toISOString(), by: 'sofia', payment: rnd() < 0.5 ? 'bar' : 'karte', items: [{ productId: w.id, qty: 1, priceCents: w.priceCents }] });
      }
      // Pass-Gaeste: ca. 20 % checken per Wellpass / Urban Sports Club / Wellhub ein (Check-in = bezahlt)
      const passAbend = tickets.filter((x) => x.category === 'checkin' && x.checkinFor === 'abend');
      const r0 = rnd();
      const t = withWorkshop && g < 14 ? (g % 4 === 0 ? tickets.find((x) => x.name === 'Übungsabend nach Workshop-Check-in') : tickets[1]) : r0 < 0.1 ? passAbend[0] : r0 < 0.18 ? passAbend[1] : r0 < 0.21 ? passAbend[2] : tickets[0];
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
  // Aushilfen (nicht registriert), Stunden minutengenau
  const helperDays = [12, 5].map((d) => new Date(now - d * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }));
  await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'Carla', helper: true, kind: 'bar', location: 'maxvorstadt', start: new Date(`${helperDays[0]}T20:30:00+01:00`).toISOString(), end: new Date(`${helperDays[0]}T23:45:00+01:00`).toISOString(), rateCents: 1390, payout: 'bar', paid: true, createdBy: 'kasse' });
  await store.putDoc('shifts', { id: crypto.randomUUID(), staffRef: 'Jonas', helper: true, kind: 'empfang', location: 'pasing', start: new Date(`${helperDays[1]}T19:45:00+01:00`).toISOString(), end: new Date(`${helperDays[1]}T22:50:00+01:00`).toISOString(), rateCents: 1500, payout: 'ueberweisung', paid: false, createdBy: 'kasse' });
  // Einkauf: METRO-Rechnung vom 23.10.2026 (bar bezahlt)
  await store.putDoc('purchases', { id: crypto.randomUUID(), date: '2026-10-23', supplier: 'METRO München-Pasing', totalCents: 47434, depositCents: 7497, location: 'maxvorstadt', note: 'Cola, Fanta, Red Bull, Adelholzener, Sekt, Hugo, Aperol, Havana Club, Limetten, Zewa/Toilettenpapier (16,48 € Betriebsbedarf) – bar bezahlt' });
  // Einkauf: METRO-Rechnung vom 31.10.2026 (Brutto inkl. Pfand)
  await store.putDoc('purchases', { id: crypto.randomUUID(), date: '2026-10-31', supplier: 'METRO München-Pasing', totalCents: 34738, depositCents: 8378, location: 'pasing', note: 'Augustiner, Cola, Red Bull, Adelholzener, Aperol Spritz, Eventbänder' });
  // Wochenplan: Vorwoche, diese Woche, naechste Woche (diese Woche mit absichtlichem Konflikt und offenem Einsatz)
  {
    const today = new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
    const monday = (d) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
    const plus = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
    const template = [
      [0, '19:00', '20:15', 'maxvorstadt', 'kurs', 'Salsa Beginner 1', 'diego'], [0, '20:15', '21:30', 'maxvorstadt', 'kurs', 'Salsa Beginner 2', 'diego'],
      [1, '19:30', '20:45', 'pasing', 'kurs', 'Kizomba Basics', 'carmen'],
      [2, '19:00', '20:15', 'maxvorstadt', 'kurs', 'Bachata Beginner', 'carmen'], [2, '20:30', '23:30', 'pasing', 'empfang', 'Übungsabend Tür', 'sofia'], [2, '20:30', '23:30', 'pasing', 'bar', 'Übungsabend Theke', 'lena'],
      [3, '19:00', '20:15', 'pasing', 'kurs', 'Salsa Beginner Pasing', 'diego'],
      [4, '20:30', '00:30', 'maxvorstadt', 'empfang', 'Übungsabend Tür', 'sofia'], [4, '20:30', '00:30', 'maxvorstadt', 'bar', 'Übungsabend Theke', 'lena'], [4, '20:30', '00:30', 'maxvorstadt', 'bar', 'Übungsabend Theke 2', 'marco'],
      [5, '15:00', '18:00', 'maxvorstadt', 'workshop', 'Bachata Sensual Workshop', null, 'Luis (Gasttrainer)', 25000],
      [5, '20:30', '01:00', 'maxvorstadt', 'bar', 'Salsa Party Theke', 'lena'], [5, '20:30', '01:00', 'maxvorstadt', 'empfang', 'Salsa Party Tür', null],
      [5, '20:00', '00:00', 'pasing', 'kombi', 'Bachata Social', 'marco'],
    ];
    for (const [wk, extra] of [[-7, false], [0, true], [7, false]]) {
      const mon = plus(monday(today), wk);
      for (const [d, start, end, location, kind, title, staffRef, guestName, feeCents] of template) {
        await store.putDoc('plan', { id: crypto.randomUUID(), date: plus(mon, d), start, end, location, kind, title, staffRef: staffRef || null, guestName: guestName || null, feeCents: feeCents ?? null });
      }
      // diese Woche: Marco zusaetzlich an der Theke Maxvorstadt -> Doppelbuchung mit Pasing
      if (extra) await store.putDoc('plan', { id: crypto.randomUUID(), date: plus(mon, 5), start: '21:00', end: '01:00', location: 'maxvorstadt', kind: 'bar', title: 'Salsa Party Theke 2', staffRef: 'marco', guestName: null, feeCents: null });
    }
    // Rechnung von Diego fuer den Vormonat: eingegangen, noch nicht bezahlt
    const [y, m] = today.slice(0, 7).split('-').map(Number);
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    await store.putDoc('invoices', { id: `diego_${prev}`, staffId: 'diego', month: prev, status: 'erhalten' });
  }
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
