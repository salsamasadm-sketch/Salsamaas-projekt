'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { FileStore } = require('../src/store/memory');
const { parseKeys, sha256 } = require('../src/auth');
const { makeSessions } = require('../src/session');
const { computeSettlement } = require('../src/bar');

const mk = () => crypto.randomBytes(32).toString('base64url');
const RK = mk(), WK = mk();
const keys = parseKeys(`web:read:${sha256(RK).toString('hex')},chef:write:${sha256(WK).toString('hex')}`);

async function start() {
  const app = createApp({ store: new FileStore(null), keys, sessions: makeSessions(mk()), logger: () => {} });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { token, body } = {}) => {
    const res = await fetch(base + path, { method, headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
    return { status: res.status, body: json, text, headers: res.headers };
  };
  return { call, base, close: () => server.close() };
}

async function setup(s) {
  const chef = (await s.call('POST', '/app/api/login', { body: { apiKey: WK } })).body.token;
  await s.call('POST', '/app/api/staff', { token: chef, body: { ref: 'lena', pin: '482913', hourlyRateCents: 1400 } });
  const lena = (await s.call('POST', '/app/api/login', { body: { ref: 'lena', pin: '482913' } })).body.token;
  const p = async (name, priceCents, category) => (await s.call('POST', '/app/api/products', { token: chef, body: { name, priceCents, category } })).body;
  return { chef, lena, cola: await p('Cola', 350, 'softdrinks'), mojito: await p('Mojito', 850, 'cocktails'), entry: await p('Eintritt Übungsabend', 800, 'eintritt'), wsIncl: await p('Workshop inkl.', 0, 'eintritt') };
}

test('Login: read-Schluessel, falsche PIN und fehlende Sitzung werden abgewiesen', async () => {
  const s = await start();
  assert.equal((await s.call('POST', '/app/api/login', { body: { apiKey: RK } })).status, 401);
  const { lena } = await setup(s);
  assert.equal((await s.call('POST', '/app/api/login', { body: { ref: 'lena', pin: '000000' } })).status, 401);
  assert.equal((await s.call('GET', '/app/api/dashboard')).status, 401);
  assert.equal((await s.call('GET', '/app/api/dashboard', { token: lena })).status, 403); // Team sieht keine Zahlen
  assert.equal((await s.call('GET', '/app/api/staff', { token: lena })).status, 403);
  assert.equal((await s.call('GET', '/app/api/dashboard', { token: 'x.y' })).status, 401);
  s.close();
});

test('PIN-Sperre nach 5 Fehlversuchen pro Kuerzel', async () => {
  const s = await start();
  await setup(s);
  for (let i = 0; i < 5; i++) await s.call('POST', '/app/api/login', { body: { ref: 'lena', pin: '111111' } });
  assert.equal((await s.call('POST', '/app/api/login', { body: { ref: 'lena', pin: '482913' } })).status, 429);
  s.close();
});

test('Kasse: oeffnen, verkaufen, stornieren, schliessen, Abrechnung mit Kassen- und Inventardifferenz', async () => {
  const s = await start();
  const { chef, lena, cola, mojito, entry, wsIncl } = await setup(s);
  // Ohne Schicht keine Kasse; mit Bar-Schicht nur die Theke am eigenen Standort
  assert.equal((await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 0 } })).body.error, 'no_shift');
  await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'bar', location: 'pasing' } });
  assert.equal((await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', station: 'tuer', cashStartCents: 0 } })).body.error, 'wrong_station');
  assert.equal((await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'maxvorstadt', cashStartCents: 0 } })).body.error, 'wrong_station');
  const cur = (await s.call('GET', '/app/api/bar/current?location=maxvorstadt&station=tuer', { token: lena })).body;
  assert.deepEqual([cur.location, cur.station, cur.locked], ['pasing', 'theke', true]);
  const open = await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 10000, stockStart: { [cola.id]: 20, [mojito.id]: 10 } } });
  assert.equal(open.status, 201);
  const id = open.body.id;
  assert.equal((await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 0, stockStart: {} } })).status, 409);

  // Eintritt geht nur an der Tuer-Kasse
  assert.equal((await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: entry.id, qty: 1 }] } })).body.error, 'wrong_station');
  const door = (await s.call('POST', '/app/api/bar/open', { token: chef, body: { location: 'pasing', station: 'tuer', cashStartCents: 5000 } })).body;
  // Lena (Theke) darf an der Tuer-Kasse nichts buchen
  assert.equal((await s.call('POST', `/app/api/bar/${door.id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: entry.id, qty: 1 }] } })).body.error, 'wrong_station');
  assert.equal(door.station, 'tuer');
  assert.equal((await s.call('POST', `/app/api/bar/${door.id}/sales`, { token: chef, body: { payment: 'bar', items: [{ productId: cola.id, qty: 1 }] } })).body.error, 'wrong_station');
  await s.call('POST', `/app/api/bar/${door.id}/sales`, { token: chef, body: { payment: 'bar', items: [{ productId: entry.id, qty: 2 }] } });
  await s.call('POST', `/app/api/bar/${door.id}/sales`, { token: chef, body: { payment: 'karte', items: [{ productId: wsIncl.id, qty: 1 }] } });
  const doorClose = (await s.call('POST', `/app/api/bar/${door.id}/close`, { token: chef, body: { cashEndCents: 6600 } })).body;
  assert.deepEqual([doorClose.guests, doorClose.ticketRevenueCents, doorClose.cashDiffCents, doorClose.items.length], [3, 1600, 0, 0]);
  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 2 }] } });
  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'karte', items: [{ productId: mojito.id, qty: 1 }] } });
  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'gratis', items: [{ productId: cola.id, qty: 1 }] } });
  const wrong = await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: mojito.id, qty: 3 }] } });
  assert.equal((await s.call('DELETE', `/app/api/bar/${id}/sales/${wrong.body.id}`, { token: lena })).status, 204);
  // Preis kommt vom Server: ein mitgeschickter Preis wird abgelehnt
  assert.equal((await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 1, priceCents: 1 }] } })).status, 400);

  // Soll Theke: 100 + 2*3,50 = 107,00; gezaehlt 104 -> -3,00. Cola: 20-3=17, gezaehlt 16 -> -1
  const close = await s.call('POST', `/app/api/bar/${id}/close`, { token: lena, body: { cashEndCents: 10400, stockEnd: { [cola.id]: 16, [mojito.id]: 9 } } });
  assert.equal(close.status, 200);
  const r = close.body;
  assert.equal(r.revenueCents, 700 + 850);
  assert.equal(r.ticketRevenueCents, 0);
  assert.equal(r.drinksRevenueCents, 1550);
  assert.equal(r.cashExpectedCents, 10700);
  assert.equal(r.cashDiffCents, -300);
  assert.equal(r.voidedCount, 1);
  assert.deepEqual(r.items.find((i) => i.productId === cola.id).diff, -1);
  assert.deepEqual(r.items.find((i) => i.productId === mojito.id).diff, 0);
  assert.equal(r.items.some((i) => i.productId === entry.id), false); // Eintritt hat kein Inventar
  assert.equal((await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 1 }] } })).status, 409);

  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  assert.equal(d.bar.revenueCents, 1550);
  assert.equal(d.bar.ticketRevenueCents, 1600);
  assert.equal(d.bar.guests, 3); // Gaeste von der Tuer, Getraenke von der Theke, ein Abend
  assert.equal(d.bar.nights, 1);
  assert.equal(Math.round(d.kpis.find((k) => k.id === 'barPerGuest').value), Math.round(1550 / 3));
  assert.ok(d.todos.some((t) => /Inventar/.test(t.text)));

  const csv = await s.call('GET', `/app/api/export/abende?month=${r.date.slice(0, 7)}`, { token: chef });
  assert.equal(csv.status, 200);
  assert.match(csv.text, /Kassendifferenz/);
  assert.match(csv.text, /-3,00/);
  s.close();
});

test('Stunden: stempeln, nachtragen, keine Ueberschneidung, Minijob-Kosten', async () => {
  const s = await start();
  const { chef, lena } = await setup(s);
  assert.equal((await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'bar', location: 'maxvorstadt' } })).status, 201);
  assert.equal((await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'bar', location: 'maxvorstadt' } })).status, 409);
  assert.equal((await s.call('POST', '/app/api/shifts/stop', { token: lena })).status, 200);
  const end = new Date(Date.now() - 3 * 3_600_000), st = new Date(end - 2 * 3_600_000);
  assert.equal((await s.call('POST', '/app/api/shifts/own', { token: lena, body: { kind: 'kurs', location: 'pasing', start: st.toISOString(), end: end.toISOString() } })).status, 201);
  assert.equal((await s.call('POST', '/app/api/shifts/own', { token: lena, body: { kind: 'kurs', location: 'pasing', start: st.toISOString(), end: end.toISOString() } })).status, 409);
  const old = new Date(Date.now() - 10 * 86_400_000);
  assert.equal((await s.call('POST', '/app/api/shifts/own', { token: lena, body: { kind: 'kurs', location: 'pasing', start: old.toISOString(), end: new Date(+old + 3_600_000).toISOString() } })).status, 400);
  const me = (await s.call('GET', '/app/api/me', { token: lena })).body;
  assert.equal(me.recent.length, 2);
  assert.equal('rateCents' in me.recent[0], false); // Team sieht keine Loehne
  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  const lenaRow = d.personnel.byStaff.find((x) => x.ref === 'lena');
  // 2 Std. nachgetragen + gestempelte Sekunden-Schicht (minutengenau = 0 Min.) = 2 Std. x 14 €
  assert.equal(lenaRow.earnedCents, 2800);
  // Deaktivieren sperrt sofort
  await s.call('PATCH', '/app/api/staff/lena', { token: chef, body: { active: false } });
  assert.equal((await s.call('GET', '/app/api/me', { token: lena })).status, 401);
  s.close();
});

test('Oberflaeche wird mit strenger CSP ausgeliefert', async () => {
  const s = await start();
  const res = await fetch(`${s.base}/app/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  s.close();
});

test('Abrechnung: Gratis zaehlt fuers Inventar, nicht als Umsatz; Nachfuellen erhoeht Soll', () => {
  const products = [{ id: 'a', name: 'Bier', priceCents: 400, category: 'bier' }];
  const r = computeSettlement({ id: 's', date: '2026-11-01', location: 'pasing', cashStartCents: 0, stockStart: { a: 5 }, restock: { a: 10 }, stockEnd: { a: 11 }, cashEndCents: 800, closedAt: 'x' },
    [{ payment: 'bar', items: [{ productId: 'a', qty: 2, priceCents: 400 }] }, { payment: 'gratis', items: [{ productId: 'a', qty: 1, priceCents: 400 }] }], products);
  assert.equal(r.revenueCents, 800);
  assert.equal(r.items[0].expectedEnd, 12);
  assert.equal(r.items[0].diff, -1);
  assert.equal(r.cashDiffCents, 0);
  assert.equal(r.freeUnits, 1);
});

test('Zeitraum, Vorperiode, Jahr und Kursgebuehr vor Ort', async () => {
  const { computeDashboard, computeYear } = require('../src/dashboard');
  const products = [{ id: 'k', name: 'Kurs 4 Wochen', priceCents: 9900, category: 'kursgebuehr' }, { id: 'e', name: 'Eintritt', priceCents: 800, category: 'eintritt' }, { id: 'b', name: 'Bier', priceCents: 400, category: 'bier' }];
  const ses = (id, date) => ({ id, date, location: 'pasing', cashStartCents: 0, stockStart: { b: 10 }, stockEnd: { b: 9 }, cashEndCents: 0, closedAt: `${date}T23:00:00Z` });
  const barsessions = [ses('s1', '2026-09-12'), ses('s2', '2026-10-10'), ses('s3', '2026-10-17')];
  const sales = [
    { sessionId: 's1', payment: 'karte', items: [{ productId: 'b', qty: 1, priceCents: 400 }] },
    { sessionId: 's2', payment: 'karte', note: 'Anna', items: [{ productId: 'k', qty: 1, priceCents: 9900 }, { productId: 'e', qty: 1, priceCents: 800 }] },
    { sessionId: 's3', payment: 'karte', items: [{ productId: 'b', qty: 1, priceCents: 400 }] },
  ];
  const s = computeSettlement(barsessions[1], [sales[1]], products);
  assert.equal(s.courseFeeCents, 9900);
  assert.equal(s.ticketCount, 1); // Kursgebuehr zaehlt nicht als Gast
  assert.equal(s.drinksRevenueCents, 0);
  assert.deepEqual(s.courseFees[0].refs, ['Anna']);
  assert.equal(s.items.some((i) => i.productId === 'k'), false); // kein Inventar

  const week = computeDashboard({ from: '2026-10-10', to: '2026-10-16', barsessions, sales, products, settings: { fixedCostsCents: { maxvorstadt: 31000, pasing: 0 } } });
  assert.equal(week.bar.nights, 1);
  assert.equal(week.kpis.find((k) => k.id === 'courseRevenue').value, 9900);
  assert.equal(week.totals.fixedCents, 7000); // 7 Tage x 310 € / 31 Tage
  assert.deepEqual([week.previous.from, week.previous.to], ['2026-10-03', '2026-10-09']);
  const oct = computeDashboard({ month: '2026-10', barsessions, sales, products });
  assert.equal(oct.previous.from, '2026-09-01');
  assert.equal(oct.kpis.find((k) => k.id === 'barRevenue').prev, 400);
  const y = computeYear({ year: 2026, barsessions, sales, products });
  assert.equal(y.months[9].nights, 2);
  assert.equal(y.months[9].courseCents, 9900);
  assert.equal(y.totals.nights, 3);
});

test('Aushilfen beim Kassenabschluss: minutengenau, bar mindert Kassensoll, Ueberweisung als To-do', async () => {
  const s = await start();
  const { chef, lena, cola } = await setup(s);
  await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'bar', location: 'pasing' } });
  const ses = (await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 10000, stockStart: { [cola.id]: 5 } } })).body;
  await s.call('POST', `/app/api/bar/${ses.id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 2 }] } });
  const t0 = new Date(Date.now() - 5 * 3_600_000);
  const at = (min) => new Date(t0.getTime() + min * 60_000).toISOString();
  const r = (await s.call('POST', `/app/api/bar/${ses.id}/close`, { token: lena, body: { cashEndCents: 10700 - 2896, stockEnd: { [cola.id]: 3 }, helpers: [
    { name: 'Carla', start: at(0), end: at(125), rateCents: 1390, payout: 'bar' },          // 2:05 = 2,083 Std. x 13,90 € = 28,96 €
    { name: 'Jonas', start: at(0), end: at(180), rateCents: 1500, payout: 'ueberweisung' }, // 3,00 Std. = 45,00 €
  ] } })).body;
  assert.equal(r.helpers[0].hours, 2.08);
  assert.equal(r.helpers[0].payCents, 2896);
  assert.equal(r.helpers[1].payCents, 4500);
  assert.equal(r.helperCashCents, 2896);
  assert.equal(r.cashExpectedCents, 10000 + 700 - 2896);
  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  assert.ok(d.todos.some((t) => /Jonas: 45,00 € überweisen/.test(t.text)));
  assert.ok(!d.todos.some((t) => /Carla/.test(t.text)));
  assert.equal(d.personnel.helpers.length, 2);
  const jonas = d.personnel.helpers.find((x) => x.name === 'Jonas');
  await s.call('PATCH', `/app/api/shifts/${jonas.id}`, { token: chef, body: { paid: true } });
  const d2 = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  assert.ok(!d2.todos.some((t) => /Jonas/.test(t.text)));
  s.close();
});

test('Kombi-Kasse (Tuer + Theke): eine Person kassiert Eintritt und Getraenke', async () => {
  const s = await start();
  const { lena, cola, entry } = await setup(s);
  await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'kombi', location: 'maxvorstadt' } });
  const cur = (await s.call('GET', '/app/api/bar/current?location=pasing&station=tuer', { token: lena })).body;
  assert.deepEqual([cur.location, cur.station], ['maxvorstadt', 'kombi']);
  const ses = (await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'maxvorstadt', station: 'kombi', cashStartCents: 5000, stockStart: { [cola.id]: 10 } } })).body;
  assert.equal((await s.call('POST', `/app/api/bar/${ses.id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: entry.id, qty: 2 }, { productId: cola.id, qty: 1 }] } })).status, 201);
  const r = (await s.call('POST', `/app/api/bar/${ses.id}/close`, { token: lena, body: { cashEndCents: 5000 + 1600 + 350, stockEnd: { [cola.id]: 9 } } })).body;
  assert.deepEqual([r.station, r.guests, r.ticketRevenueCents, r.drinksRevenueCents, r.cashDiffCents, r.missingUnits], ['kombi', 2, 1600, 350, 0, 0]);
  s.close();
});

test('Wochenplan: Kosten, Konflikte, Minijob-Prognose, Kopieren, WhatsApp-Text; Rechnungstrainer', async () => {
  const s = await start();
  const { chef, lena } = await setup(s);
  await s.call('POST', '/app/api/staff', { token: chef, body: { ref: 'diego', pin: '771122', hourlyRateCents: 3000, employment: 'rechnung' } });
  const mon = '2030-03-04'; // Montag
  const add = (b) => s.call('POST', '/app/api/plan', { token: chef, body: b });
  assert.equal((await add({ date: mon, start: '19:00', end: '20:30', location: 'maxvorstadt', kind: 'kurs', title: 'Salsa Beginner 1', staffRef: 'diego' })).status, 201);
  await add({ date: '2030-03-09', start: '20:00', end: '23:59', location: 'maxvorstadt', kind: 'bar', staffRef: 'lena' });
  await add({ date: '2030-03-09', start: '22:00', end: '23:00', location: 'pasing', kind: 'empfang', staffRef: 'lena' }); // Ueberschneidung
  await add({ date: '2030-03-09', start: '16:00', end: '19:00', location: 'maxvorstadt', kind: 'workshop', title: 'Bachata Workshop', guestName: 'Luis', feeCents: 25000 });
  await add({ date: '2030-03-08', start: '20:00', end: '23:00', location: 'pasing', kind: 'empfang' }); // offen
  assert.equal((await add({ date: mon, start: '19:00', end: '20:00', location: 'pasing', kind: 'kurs', staffRef: 'niemand' })).status, 400);
  const w = (await s.call('GET', '/app/api/plan?week=2030-03-06', { token: chef })).body;
  assert.equal(w.week, mon);
  assert.equal(w.kw, 10);
  assert.equal(w.totals.slots, 5);
  assert.equal(w.totals.workshops, 1);
  assert.equal(w.totals.open, 1);
  assert.equal(w.slots.find((x) => x.title === 'Salsa Beginner 1').costCents, 4500); // 1,5 Std. x 30 €
  assert.equal(w.slots.find((x) => x.guestName === 'Luis').costCents, 25000);    // Pauschale
  assert.ok(w.conflicts.some((c) => /lena ist Samstag doppelt verplant/.test(c.text)));
  assert.ok(w.conflicts.some((c) => /hat noch niemanden/.test(c.text)));
  assert.match(w.whatsappText, /KW 10/);
  assert.match(w.whatsappText, /Bachata Workshop/);
  assert.equal(w.people.find((p) => p.who === 'diego').employment, 'rechnung');
  assert.ok(w.people.find((p) => p.who === 'lena').minijob);
  assert.equal((await s.call('GET', '/app/api/plan?week=2030-03-06', { token: lena })).status, 403);
  // Kopieren in die Folgewoche, doppeltes Kopieren legt nichts doppelt an
  assert.equal((await s.call('POST', '/app/api/plan/copy', { token: chef, body: { from: mon, to: '2030-03-11' } })).body.copied, 5);
  assert.equal((await s.call('POST', '/app/api/plan/copy', { token: chef, body: { from: mon, to: '2030-03-11' } })).body.copied, 0);
  // Rechnungsstatus
  const inv = (await s.call('GET', '/app/api/invoices?month=2030-03', { token: chef })).body;
  assert.deepEqual(inv.map((i) => [i.ref, i.status]), [['diego', 'offen']]);
  await s.call('PUT', '/app/api/invoices/diego/2030-03', { token: chef, body: { status: 'bezahlt' } });
  assert.equal((await s.call('GET', '/app/api/invoices?month=2030-03', { token: chef })).body[0].status, 'bezahlt');
  s.close();
});

test('Getraenkekarte, Einkaufspreise, Wareneinsatz und Einkaeufe', async () => {
  const s = await start();
  const { chef } = await setup(s);
  const imp = (await s.call('POST', '/app/api/products/import-catalog', { token: chef })).body;
  assert.equal(imp.created, 44); // 16 Getränke + 13 Tickets/Check-ins + 16 Kursgebühren, 'Eintritt Übungsabend' gab es schon (keine Doppelung)
  assert.equal((await s.call('POST', '/app/api/products/import-catalog', { token: chef })).body.created, 0); // keine Doppelungen
  const products = (await s.call('GET', '/app/api/products', { token: chef })).body;
  const helles = products.find((p) => p.name === 'Helles');
  assert.deepEqual([helles.priceCents, helles.costCents], [450, 71]);
  // 10 Helles verkauft, 1 fehlt laut Inventar: Wareneinsatz = 11 x 0,71
  const ses = (await s.call('POST', '/app/api/bar/open', { token: chef, body: { location: 'pasing', cashStartCents: 0, stockStart: { [helles.id]: 20 } } })).body;
  await s.call('POST', `/app/api/bar/${ses.id}/sales`, { token: chef, body: { payment: 'bar', items: [{ productId: helles.id, qty: 10 }] } });
  const r = (await s.call('POST', `/app/api/bar/${ses.id}/close`, { token: chef, body: { cashEndCents: 4500, stockEnd: { [helles.id]: 9 } } })).body;
  assert.deepEqual([r.cogsCents, r.missingCogsCents], [710, 71]);
  await s.call('POST', '/app/api/purchases', { token: chef, body: { date: r.date, supplier: 'METRO Pasing', totalCents: 34738, depositCents: 8378 } });
  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  const k = d.kpis.find((x) => x.id === 'cogsPct');
  assert.equal(Math.round(k.value * 10) / 10, Math.round((781 / 4500) * 1000) / 10);
  assert.match(k.hint, /Einkäufe 263,60 €/);
  assert.equal(d.totals.cogsCents, 781);
  s.close();
});

test('Gaeste zaehlen nur Eintritte zum Uebungsabend, Workshop-Tickets nicht doppelt', () => {
  const { TICKETS } = require('../src/catalog');
  const products = TICKETS.map((t, i) => ({ id: `t${i}`, ...t }));
  const id = (n) => products.find((p) => p.name === n).id;
  const sales = [
    { payment: 'bar', items: [{ productId: id('Workshop mit Partner (p. P.)'), qty: 2, priceCents: 1500 }] },
    { payment: 'bar', items: [{ productId: id('Workshop-Teilnehmer bleibt (inkl.)'), qty: 2, priceCents: 0 }] },
    { payment: 'karte', items: [{ productId: id('Eintritt Übungsabend'), qty: 3, priceCents: 1000 }] },
  ];
  const r = computeSettlement({ id: 's', date: '2026-11-07', location: 'pasing', station: 'tuer', cashStartCents: 0, cashEndCents: 3000, closedAt: 'x' }, sales, products);
  assert.equal(r.guests, 5);              // 3 Eintritt + 2 Workshop-Teilnehmer, die bleiben
  assert.equal(r.workshopCount, 2);
  assert.equal(r.ticketRevenueCents, 6000);
  assert.equal(r.ticketCostCents, 30);    // 5 Eventbaender
  assert.equal(r.cashDiffCents, 0);
});

test('Pass-Check-ins: Check-in = bezahlt, erwartete Auszahlung zaehlt zum Umsatz, nicht zur Kasse', () => {
  const { TICKETS } = require('../src/catalog');
  const { computeDashboard } = require('../src/dashboard');
  const products = TICKETS.map((t, i) => ({ id: `t${i}`, ...t }));
  const id = (n) => products.find((p) => p.name === n).id;
  const sales = [
    { sessionId: 's', payment: 'bar', items: [{ productId: id('Wellpass · Übungsabend'), qty: 2, priceCents: 0 }] },
    { sessionId: 's', payment: 'bar', items: [{ productId: id('Urban Sports Club · Workshop'), qty: 1, priceCents: 0 }] },
    { sessionId: 's', payment: 'bar', items: [{ productId: id('Übungsabend nach Workshop-Check-in'), qty: 1, priceCents: 500 }] },
    { sessionId: 's', payment: 'karte', items: [{ productId: id('Wellhub · Übungsabend'), qty: 1, priceCents: 0 }] },
  ];
  const ses = { id: 's', date: '2026-11-07', location: 'pasing', station: 'tuer', cashStartCents: 0, cashEndCents: 500, closedAt: '2026-11-07T23:00:00Z' };
  const r = computeSettlement(ses, sales, products);
  assert.equal(r.guests, 4);                    // 2 Wellpass + 1 Aufzahlung + 1 Wellhub (Workshop-Check-in zaehlt nicht)
  assert.equal(r.platformCheckins, 4);
  assert.equal(r.platformRevenueCents, 2 * 1300 + 1000 + 1500);
  assert.equal(r.cashExpectedCents, 500);       // nur die 5-€-Aufzahlung ist Bargeld
  assert.equal(r.cashDiffCents, 0);
  const d = computeDashboard({ month: '2026-11', barsessions: [ses], sales, products });
  assert.equal(d.bar.platformRevenueCents, 5100);
  assert.equal(d.totals.incomeCents, 500 + 5100);
  assert.deepEqual(d.bar.platforms.map((p) => [p.platform, p.checkins]), [['Wellpass', 2], ['Urban Sports Club', 1], ['Wellhub', 1]]);
});

test('Privatstunde durch das Team: Leader 30 €, Follower 15 € als Verguetung, Storno entfernt sie', async () => {
  const s = await start();
  const { chef, lena } = await setup(s);
  await s.call('POST', '/app/api/staff', { token: chef, body: { ref: 'diego', pin: '771122', hourlyRateCents: 2500, employment: 'rechnung' } });
  await s.call('POST', '/app/api/products/import-catalog', { token: chef });
  const priv = (await s.call('GET', '/app/api/products', { token: chef })).body.find((p) => p.name === 'Privatstunde');
  assert.equal(priv.privateLesson, true);
  await s.call('POST', '/app/api/shifts/start', { token: lena, body: { kind: 'bar', location: 'pasing' } });
  // Beim Uebungsabend gibt es an der Theke keine Kursgebuehren
  const abend = (await s.call('POST', '/app/api/bar/open', { token: chef, body: { location: 'maxvorstadt', occasion: 'abend', cashStartCents: 0, stockStart: {} } })).body;
  assert.equal((await s.call('POST', `/app/api/bar/${abend.id}/sales`, { token: chef, body: { payment: 'bar', items: [{ productId: priv.id, qty: 1 }] } })).body.error, 'wrong_station');
  const ses = (await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', occasion: 'kurs', cashStartCents: 0, stockStart: {} } })).body;
  const sale = (await s.call('POST', `/app/api/bar/${ses.id}/sales`, { token: lena, body: { payment: 'karte', items: [{ productId: priv.id, qty: 2 }], privateLesson: { leader: 'diego', follower: 'lena' } } })).body;
  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  const diego = d.personnel.byStaff.find((x) => x.ref === 'diego');
  assert.equal(diego.earnedCents, 6000);      // 2 Privatstunden x 30 €
  const inv = (await s.call('GET', `/app/api/invoices?month=${d.month}`, { token: chef })).body.find((i) => i.ref === 'diego');
  assert.equal(inv.amountCents, 6000);
  const shifts = (await s.call('GET', '/app/api/shifts', { token: chef })).body.filter((x) => x.kind === 'privat');
  assert.deepEqual(shifts.map((x) => [x.staffRef, x.role, x.fixedCents]).sort(), [['diego', 'Leader', 6000], ['lena', 'Follower', 3000]]);
  await s.call('DELETE', `/app/api/bar/${ses.id}/sales/${sale.id}`, { token: lena });
  assert.equal((await s.call('GET', '/app/api/shifts', { token: chef })).body.filter((x) => x.kind === 'privat').length, 0);
  s.close();
});

test('Anlass: Uebungsabend ohne Kursgebuehren, Kursbetrieb mit allem', () => {
  const { allowedAtStation } = require('../src/bar');
  assert.equal(allowedAtStation('theke', 'bier', 'abend'), true);
  assert.equal(allowedAtStation('theke', 'kursgebuehr', 'abend'), false);
  assert.equal(allowedAtStation('theke', 'eintritt', 'abend'), false);
  assert.equal(allowedAtStation('kombi', 'workshop', 'abend'), true);
  assert.equal(allowedAtStation('kombi', 'kursgebuehr', 'abend'), false);
  assert.equal(allowedAtStation('tuer', 'bier', 'abend'), false);
  assert.equal(allowedAtStation('theke', 'kursgebuehr', 'kurs'), true);
  assert.equal(allowedAtStation('theke', 'workshop', 'kurs'), true);
  assert.equal(allowedAtStation('tuer', 'kursgebuehr', 'kurs'), true);
  assert.equal(allowedAtStation('tuer', 'cocktails', 'kurs'), false);
});
