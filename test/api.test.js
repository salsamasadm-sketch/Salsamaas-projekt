'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../src/app');
const { FileStore } = require('../src/store/memory');
const { parseKeys, sha256 } = require('../src/auth');

const mk = () => crypto.randomBytes(32).toString('base64url');
const RK = mk(), WK = mk();
const keys = parseKeys(`web:read:${sha256(RK).toString('hex')},admin:write:${sha256(WK).toString('hex')}`);
const course = { title: 'Salsa Beginner', location: 'pasing', style: 'salsa', level: 'Beginner', weekday: 2, startTime: '19:00', durationMin: 60, startDate: '2026-11-10', capacity: 2, priceCents: 9000, published: true };

async function start(opts = {}) {
  const logs = [];
  const app = createApp({ store: new FileStore(null), keys, allowedOrigins: ['https://salsamas.de'], logger: (l) => logs.push(l), ...opts });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, path, { key, body, headers } = {}) =>
    fetch(base + path, { method, headers: { ...(key && { Authorization: `Bearer ${key}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { call, logs, close: () => server.close() };
}

test('ohne/mit falschem Schluessel: 401, nichts wird preisgegeben', async () => {
  const s = await start();
  assert.equal((await s.call('GET', '/api/v1/courses')).status, 401);
  assert.equal((await s.call('GET', '/api/v1/courses', { key: mk() })).status, 401);
  assert.equal((await s.call('GET', '/api/v1/stats', { headers: { Authorization: 'Basic abc' } })).status, 401);
  s.close();
});

test('read-Schluessel darf nicht schreiben (403)', async () => {
  const s = await start();
  assert.equal((await s.call('POST', '/api/v1/courses', { key: RK, body: course })).status, 403);
  assert.equal((await s.call('GET', '/api/v1/courses', { key: RK })).status, 200);
  s.close();
});

test('Kurs anlegen, aendern, Teilnehmerzahl und Zahlung', async () => {
  const s = await start();
  const c = await (await s.call('POST', '/api/v1/courses', { key: WK, body: course })).json();
  const e1 = await (await s.call('POST', `/api/v1/courses/${c.id}/enrollments`, { key: WK, body: { participantRef: 'bs-1' } })).json();
  assert.equal(e1.paymentStatus, 'open');
  assert.equal((await s.call('POST', `/api/v1/courses/${c.id}/enrollments`, { key: WK, body: { participantRef: 'bs-1' } })).status, 409); // Duplikat
  await s.call('POST', `/api/v1/courses/${c.id}/enrollments`, { key: WK, body: { participantRef: 'bs-2' } });
  assert.equal((await s.call('POST', `/api/v1/courses/${c.id}/enrollments`, { key: WK, body: { participantRef: 'bs-3' } })).status, 409); // voll
  const p = await s.call('PATCH', `/api/v1/enrollments/${e1.id}`, { key: WK, body: { paymentStatus: 'paid', amountPaidCents: 9000, version: 1 } });
  assert.equal((await p.json()).paymentStatus, 'paid');
  const u = await s.call('PATCH', `/api/v1/courses/${c.id}`, { key: WK, body: { capacity: 10, version: 1 } });
  assert.equal((await u.json()).capacity, 10);
  const st = await (await s.call('GET', '/api/v1/stats', { key: RK })).json();
  assert.deepEqual([st[0].participants, st[0].paid, st[0].open, st[0].spotsLeft], [2, 1, 1, 8]);
  s.close();
});

test('Versionskonflikt (zwei Admins gleichzeitig): 409 statt stilles Ueberschreiben', async () => {
  const s = await start();
  const c = await (await s.call('POST', '/api/v1/courses', { key: WK, body: course })).json();
  await s.call('PATCH', `/api/v1/courses/${c.id}`, { key: WK, body: { priceCents: 100, version: 1 } });
  assert.equal((await s.call('PATCH', `/api/v1/courses/${c.id}`, { key: WK, body: { priceCents: 200, version: 1 } })).status, 409);
  s.close();
});

test('Angriffe: Mass-Assignment, XSS, Injection-IDs, Typen, grosse Bodies, falscher Content-Type', async () => {
  const s = await start();
  const c = await (await s.call('POST', '/api/v1/courses', { key: WK, body: course })).json();
  const bad = async (body) => (await s.call('POST', '/api/v1/courses', { key: WK, body })).status;
  assert.equal(await bad({ ...course, id: 'evil', version: 99 }), 400);            // unbekannte Felder
  assert.equal(await bad({ ...course, title: '<script>alert(1)</script>' }), 400); // XSS
  assert.equal(await bad({ ...course, capacity: '10' }), 400);                     // falscher Typ
  assert.equal(await bad({ ...course, priceCents: -1 }), 400);
  assert.equal(await bad({ ...course, __proto__: { admin: true }, constructor: 'x' }), 400);
  assert.equal((await s.call('GET', '/api/v1/courses/..%2F..%2Fetc', { key: RK })).status, 400);
  assert.equal((await s.call('GET', `/api/v1/courses/${encodeURIComponent("1' OR '1'='1")}`, { key: RK })).status, 400);
  assert.equal((await s.call('POST', '/api/v1/courses', { key: WK, body: 'x'.repeat(20000) })).status, 413);
  assert.equal((await s.call('POST', '/api/v1/courses', { key: WK, body: '{kaputt' })).status, 400);
  s.close();
});

test('falscher Content-Type bei POST wird abgelehnt (415)', async () => {
  const s = await start();
  const { call } = s;
  const res = await call('POST', '/api/v1/courses', { key: WK, body: 'a=b', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(res.status, 415);
  s.close();
});

test('Oeffentlicher Endpunkt zeigt nur veroeffentlichte Kurse ohne interne Felder', async () => {
  const s = await start();
  await s.call('POST', '/api/v1/courses', { key: WK, body: course });
  await s.call('POST', '/api/v1/courses', { key: WK, body: { ...course, title: 'Geheim', published: false, notes: 'intern' } });
  const list = await (await s.call('GET', '/public/courses')).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].notes, undefined);
  assert.equal(list[0].capacity, undefined);
  assert.equal(list[0].spotsLeft, 2);
  s.close();
});

test('CORS nur fuer erlaubte Origins, Security-Header gesetzt, kein X-Powered-By', async () => {
  const s = await start();
  const ok = await s.call('GET', '/public/courses', { headers: { Origin: 'https://salsamas.de' } });
  const evil = await s.call('GET', '/public/courses', { headers: { Origin: 'https://evil.example' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://salsamas.de');
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  assert.ok(ok.headers.get('strict-transport-security'));
  assert.equal(ok.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(ok.headers.get('x-powered-by'), null);
  s.close();
});

test('Brute-Force: nach 10 Fehlversuchen wird gesperrt (429)', async () => {
  const s = await start();
  let last;
  for (let i = 0; i < 12; i++) last = (await s.call('GET', '/api/v1/courses', { key: mk() })).status;
  assert.equal(last, 429);
  s.close();
});

test('Audit-Log enthaelt keine Schluessel und keine Request-Inhalte', async () => {
  const s = await start();
  await s.call('POST', '/api/v1/courses', { key: WK, body: { ...course, notes: 'GEHEIMNOTIZ' } });
  const dump = JSON.stringify(s.logs);
  assert.ok(!dump.includes(WK) && !dump.includes('GEHEIMNOTIZ'));
  assert.ok(s.logs.some((l) => l.event === 'course_created' && l.path));
  s.close();
});

test('Startet nie ohne Schluessel konfiguriert', () => {
  assert.deepEqual(parseKeys(''), []);
  assert.throws(() => parseKeys('x:admin:abc'));
});
