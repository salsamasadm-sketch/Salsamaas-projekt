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
  const open = await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 10000, stockStart: { [cola.id]: 20, [mojito.id]: 10 } } });
  assert.equal(open.status, 201);
  const id = open.body.id;
  assert.equal((await s.call('POST', '/app/api/bar/open', { token: lena, body: { location: 'pasing', cashStartCents: 0, stockStart: {} } })).status, 409);

  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 2 }, { productId: entry.id, qty: 2 }] } });
  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'karte', items: [{ productId: mojito.id, qty: 1 }, { productId: wsIncl.id, qty: 1 }] } });
  await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'gratis', items: [{ productId: cola.id, qty: 1 }] } });
  const wrong = await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: mojito.id, qty: 3 }] } });
  assert.equal((await s.call('DELETE', `/app/api/bar/${id}/sales/${wrong.body.id}`, { token: lena })).status, 204);
  // Preis kommt vom Server: ein mitgeschickter Preis wird abgelehnt
  assert.equal((await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 1, priceCents: 1 }] } })).status, 400);

  // Soll Kasse: 100 + 2*3,50 + 2*8 = 123,00; gezaehlt 120 -> -3,00. Cola: 20-3=17, gezaehlt 16 -> -1
  const close = await s.call('POST', `/app/api/bar/${id}/close`, { token: lena, body: { cashEndCents: 12000, stockEnd: { [cola.id]: 16, [mojito.id]: 9 } } });
  assert.equal(close.status, 200);
  const r = close.body;
  assert.equal(r.revenueCents, 700 + 1600 + 850);
  assert.equal(r.ticketRevenueCents, 1600);
  assert.equal(r.drinksRevenueCents, 1550);
  assert.equal(r.guests, 3); // 2 Eintritt + 1 Workshop inkl.
  assert.equal(r.cashExpectedCents, 12300);
  assert.equal(r.cashDiffCents, -300);
  assert.equal(r.voidedCount, 1);
  assert.deepEqual(r.items.find((i) => i.productId === cola.id).diff, -1);
  assert.deepEqual(r.items.find((i) => i.productId === mojito.id).diff, 0);
  assert.equal(r.items.some((i) => i.productId === entry.id), false); // Eintritt hat kein Inventar
  assert.equal((await s.call('POST', `/app/api/bar/${id}/sales`, { token: lena, body: { payment: 'bar', items: [{ productId: cola.id, qty: 1 }] } })).status, 409);

  const d = (await s.call('GET', '/app/api/dashboard', { token: chef })).body;
  assert.equal(d.bar.revenueCents, 1550);
  assert.equal(d.bar.ticketRevenueCents, 1600);
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
  assert.ok(lenaRow.earnedCents >= 2800 && lenaRow.earnedCents <= 2810);
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
