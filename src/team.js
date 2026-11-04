'use strict';
const crypto = require('node:crypto');
const express = require('express');
const { z } = require('zod');
const { rateLimit } = require('express-rate-limit');
const { hashPin, verifyPin } = require('./session');
const { sha256 } = require('./auth');
const { computeDashboard, computeYear, rangeOf, mergeSettings, berlinDate } = require('./dashboard');
const { computeSettlement, buildHelpers, helperShift, STATIONS, stationOf, allowedAtStation, stationForKind } = require('./bar');
const S = require('./schemas');

/**
 * Chef- und Team-App (Handy-Webseite unter /app).
 * - Team (Bar, Tanzlehrer, Minijobber): Kuerzel + PIN, Arbeitszeit stempeln oder von-bis eintragen,
 *   Bar-Kasse oeffnen (Kassen-/Inventarbestand), Getraenke verkaufen, Kasse mit Abrechnung schliessen.
 *   Sieht keine Loehne und keine Monatszahlen.
 * - Chef: Anmeldung mit dem bestehenden write-API-Schluessel, sieht Dashboard und verwaltet alles.
 */
const LOC = z.enum(S.LOCATIONS);
const KIND = z.enum(['bar', 'kurs', 'empfang', 'kombi', 'sonstiges']);
const ref = z.string().regex(/^[A-Za-z0-9_.-]{2,30}$/, 'Kürzel: 2–30 Zeichen, nur Buchstaben/Zahlen');
const pin = z.string().regex(/^\d{6,8}$/, 'PIN: 6–8 Ziffern');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)), 'ungültiges Datum');
const iso = z.string().datetime({ offset: true });
const cents = (max) => z.number().int().min(0).max(max);
const note = z.string().trim().max(200).refine((s) => !/[<>\u0000-\u001F]/.test(s), 'unerlaubte Zeichen');

const loginStaff = z.object({ ref, pin }).strict();
const loginOwner = z.object({ apiKey: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }).strict();
const shiftStart = z.object({ kind: KIND, location: LOC }).strict();
const shiftManual = z.object({ staffRef: ref, kind: KIND, location: LOC, start: iso, end: iso }).strict()
  .refine((s) => new Date(s.end) > new Date(s.start) && new Date(s.end) - new Date(s.start) <= 16 * 3_600_000, 'Ende muss nach Start liegen (max. 16 Std.)');
const ownShift = z.object({ kind: KIND, location: LOC, start: iso, end: iso }).strict()
  .refine((s) => new Date(s.end) > new Date(s.start) && new Date(s.end) - new Date(s.start) <= 16 * 3_600_000, 'Ende muss nach Start liegen (max. 16 Std.)');
const CATEGORIES = ['eintritt', 'workshop', 'kursgebuehr', 'softdrinks', 'bier', 'wein', 'cocktails', 'longdrinks', 'shots', 'heiss', 'snacks', 'sonstiges'];
const pname = z.string().trim().min(1).max(40).refine((s) => !/[<>\u0000-\u001F]/.test(s), 'unerlaubte Zeichen');
const productCreate = z.object({ name: pname, priceCents: cents(100_000), category: z.enum(CATEGORIES), active: z.boolean().default(true), sort: z.number().int().min(0).max(999).default(100) }).strict();
const productPatch = z.object({ name: pname.optional(), priceCents: cents(100_000).optional(), category: z.enum(CATEGORIES).optional(), active: z.boolean().optional(), sort: z.number().int().min(0).max(999).optional() }).strict()
  .refine((o) => Object.keys(o).length > 0, 'mindestens ein Feld ändern');
const stock = z.record(S.id, z.number().int().min(0).max(10_000)).refine((o) => Object.keys(o).length <= 300, 'zu viele Artikel');
const sessionOpen = z.object({ location: LOC, station: z.enum(STATIONS).default('theke'), cashStartCents: cents(10_000_000), stockStart: stock.default({}) }).strict();
const saleSchema = z.object({ note: z.string().trim().min(1).max(60).refine((s) => !/[<>\u0000-\u001F]/.test(s), 'unerlaubte Zeichen').optional(), payment: z.enum(['bar', 'karte', 'gratis']), items: z.array(z.object({ productId: S.id, qty: z.number().int().min(1).max(50) }).strict()).min(1).max(30) }).strict();
const helperIn = z.object({ name: z.string().trim().min(2).max(40).refine((s) => !/[<>\u0000-\u001F]/.test(s), 'unerlaubte Zeichen'), start: iso, end: iso, rateCents: cents(10_000), payout: z.enum(['bar', 'ueberweisung']) }).strict()
  .refine((h) => new Date(h.end) > new Date(h.start) && new Date(h.end) - new Date(h.start) <= 16 * 3_600_000, 'Aushilfe: Ende muss nach Beginn liegen (max. 16 Std.)');
const sessionClose = z.object({ helpers: z.array(helperIn).max(10).default([]), cashEndCents: cents(10_000_000), cashOutCents: cents(10_000_000).default(0), stockEnd: stock.default({}), restock: stock.default({}), guests: z.number().int().min(0).max(3000).optional(), note: note.optional() }).strict();
const staffCreate = z.object({ ref, pin, hourlyRateCents: cents(20_000), active: z.boolean().default(true) }).strict();
const staffPatch = z.object({ pin: pin.optional(), hourlyRateCents: cents(20_000).optional(), active: z.boolean().optional() }).strict()
  .refine((o) => Object.keys(o).length > 0, 'mindestens ein Feld ändern');
const settingsSchema = z.object({
  targets: z.object({ utilizationPct: z.number().min(0).max(100), openPaymentsPct: z.number().min(0).max(100), barPerGuestCents: cents(100_000), barPersonnelPct: z.number().min(0).max(200) }).strict(),
  fixedCostsCents: z.object({ maxvorstadt: cents(100_000_000), pasing: cents(100_000_000) }).strict(),
  minijobLimitCents: cents(1_000_000),
}).strict();
const monthQ = (q) => (/^\d{4}-\d{2}$/.test(q || '') ? q : null);
const dayQ = (q) => (/^\d{4}-\d{2}-\d{2}$/.test(q || '') && !Number.isNaN(Date.parse(q)) ? q : null);
/** Zeitraum aus ?from=&to= (max. 2 Jahre) oder ?month=; sonst null bzw. der aktuelle Monat */
function rangeQ(q, fallbackCurrent) {
  const from = dayQ(q.from), to = dayQ(q.to);
  if (from && to && from <= to && Date.parse(to) - Date.parse(from) <= 731 * 86_400_000) return { from, to };
  const month = monthQ(q.month) || (fallbackCurrent ? berlinDate(new Date()).slice(0, 7) : null);
  return month ? rangeOf({ month }) : null;
}
const inR = (r, d) => !r || (d >= r.from && d <= r.to);

function createTeamRouter({ store, keys, sessions, logger }) {
  const r = express.Router();
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const log = (req, event) => logger({ ts: new Date().toISOString(), event, principal: req.session?.sub, ip: req.ip, path: req.path });
  const parse = (schema, data, res) => {
    const x = schema.safeParse(data);
    if (!x.success) { res.status(400).json({ error: 'validation_failed', details: x.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }); return null; }
    return x.data;
  };
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const hasBody = Number(req.get('content-length') || 0) > 0 || req.get('transfer-encoding');
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && hasBody && !req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    next();
  });

  // --- Anmeldung ---
  // Pro IP: 10 Fehlversuche / 15 Min. Zusaetzlich pro Kuerzel: 5 Fehlversuche sperren das Kuerzel 15 Min.
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });
  const fails = new Map();
  const locked = (k) => { const f = fails.get(k); return f && f.n >= 5 && Date.now() - f.t < 15 * 60_000; };
  const fail = (k) => { const f = fails.get(k); fails.set(k, { n: f && Date.now() - f.t < 15 * 60_000 ? f.n + 1 : 1, t: Date.now() }); };

  r.post('/login', loginLimiter, wrap(async (req, res) => {
    if (req.body && 'apiKey' in req.body) {
      const d = parse(loginOwner, req.body, res); if (!d) return;
      const given = sha256(d.apiKey);
      let found = null;
      for (const k of keys) if (crypto.timingSafeEqual(given, k.hash)) found = k;
      if (!found || found.role !== 'write') { log(req, 'app_login_failed'); return res.status(401).json({ error: 'unauthorized' }); }
      req.session = { sub: found.name };
      log(req, 'app_login_owner');
      return res.json({ token: sessions.issue({ sub: found.name, role: 'owner' }, 12 * 3600), role: 'owner', ref: found.name });
    }
    const d = parse(loginStaff, req.body, res); if (!d) return;
    const k = d.ref.toLowerCase();
    if (locked(k)) return res.status(429).json({ error: 'too_many_requests' });
    const p = await store.getDoc('staff', k);
    const ok = verifyPin(d.pin, p?.pinHash);
    if (!ok || p.active === false) { fail(k); log(req, 'app_login_failed'); return res.status(401).json({ error: 'unauthorized' }); }
    fails.delete(k);
    req.session = { sub: p.ref };
    log(req, 'app_login_staff');
    res.json({ token: sessions.issue({ sub: p.id, role: 'staff' }, 14 * 24 * 3600), role: 'staff', ref: p.ref });
  }));

  // --- Ab hier nur mit gueltiger Sitzung ---
  r.use(wrap(async (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.get('authorization') || '');
    const s = m && sessions.verify(m[1]);
    if (!s) return res.status(401).json({ error: 'unauthorized' });
    if (s.role === 'staff') {
      // Deaktivierte Mitarbeiter verlieren sofort den Zugang.
      const p = await store.getDoc('staff', s.sub);
      if (!p || p.active === false) return res.status(401).json({ error: 'unauthorized' });
      req.staff = p;
    }
    req.session = s;
    next();
  }));
  const owner = (req, res, next) => (req.session.role === 'owner' ? next() : res.status(403).json({ error: 'forbidden' }));

  // Team: eigene Daten
  r.get('/me', wrap(async (req, res) => {
    if (req.session.role === 'owner') return res.json({ role: 'owner', ref: req.session.sub });
    const me = req.staff;
    const mine = (await store.listDocs('shifts')).filter((s) => s.staffRef === me.ref);
    const month = berlinDate(new Date()).slice(0, 7);
    const monthShifts = mine.filter((s) => berlinDate(s.start).slice(0, 7) === month);
    const hours = monthShifts.reduce((a, s) => a + ((s.end ? new Date(s.end) : new Date()) - new Date(s.start)) / 3_600_000, 0);
    res.json({
      role: 'staff', ref: me.ref,
      openShift: mine.find((s) => !s.end) || null,
      monthHours: Math.round(hours * 10) / 10,
      recent: mine.sort((a, b) => b.start.localeCompare(a.start)).slice(0, 10).map(({ id, kind, location, start, end }) => ({ id, kind, location, start, end })),
    });
  }));

  r.post('/shifts/start', wrap(async (req, res) => {
    if (!req.staff) return res.status(403).json({ error: 'forbidden' });
    const d = parse(shiftStart, req.body, res); if (!d) return;
    const open = (await store.listDocs('shifts')).find((s) => s.staffRef === req.staff.ref && !s.end);
    if (open) return res.status(409).json({ error: 'shift_running', shift: open });
    const s = { id: crypto.randomUUID(), staffRef: req.staff.ref, ...d, start: new Date().toISOString(), end: null, rateCents: req.staff.hourlyRateCents, createdBy: req.staff.ref };
    await store.putDoc('shifts', s); log(req, 'shift_started');
    res.status(201).json({ id: s.id, kind: s.kind, location: s.location, start: s.start, end: null });
  }));
  r.post('/shifts/stop', wrap(async (req, res) => {
    if (!req.staff) return res.status(403).json({ error: 'forbidden' });
    const open = (await store.listDocs('shifts')).find((s) => s.staffRef === req.staff.ref && !s.end);
    if (!open) return res.status(409).json({ error: 'no_shift_running' });
    const s = { ...open, end: new Date().toISOString() };
    await store.putDoc('shifts', s); log(req, 'shift_stopped');
    res.json({ id: s.id, kind: s.kind, location: s.location, start: s.start, end: s.end });
  }));

  // Arbeitszeit nachtraeglich "von-bis" eintragen (z. B. Tanzlehrer nach dem Kurs). Nur eigene, nur die letzten 3 Tage.
  r.post('/shifts/own', wrap(async (req, res) => {
    if (!req.staff) return res.status(403).json({ error: 'forbidden' });
    const d = parse(ownShift, req.body, res); if (!d) return;
    const age = (Date.now() - new Date(d.start)) / 86_400_000;
    if (age > 3 || new Date(d.end) > new Date(Date.now() + 10 * 60_000)) return res.status(400).json({ error: 'validation_failed', details: [{ path: 'start', message: 'nur die letzten 3 Tage, nicht in der Zukunft' }] });
    const mine = (await store.listDocs('shifts')).filter((s) => s.staffRef === req.staff.ref);
    const overlaps = mine.some((s) => new Date(s.start) < new Date(d.end) && new Date(s.end || Date.now()) > new Date(d.start));
    if (overlaps) return res.status(409).json({ error: 'overlap' });
    const s = { id: crypto.randomUUID(), staffRef: req.staff.ref, ...d, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), rateCents: req.staff.hourlyRateCents, createdBy: req.staff.ref };
    await store.putDoc('shifts', s); log(req, 'shift_added_own');
    res.status(201).json({ id: s.id, kind: s.kind, location: s.location, start: s.start, end: s.end });
  }));

  // --- Bar-Kasse ---
  const by = (req) => (req.session.role === 'staff' ? req.staff.ref : 'chef');
  /**
   * Team ist an den Kassenplatz und Standort seiner laufenden Schicht gebunden
   * (Empfang/Tuer -> Tuer-Kasse, sonst Theke). Ohne Schicht keine Kasse. Chef ist frei.
   * Liefert { location, station } oder schickt selbst die Fehlermeldung (dann null).
   */
  const kasseScope = async (req, res) => {
    if (req.session.role === 'owner') return { owner: true };
    const shift = (await store.listDocs('shifts')).find((x) => x.staffRef === req.staff.ref && !x.end && !x.helper);
    if (!shift) { res.status(403).json({ error: 'no_shift' }); return null; }
    return { location: shift.location, station: stationForKind(shift.kind) };
  };
  const inScope = (scope, ses) => scope.owner || (ses.location === scope.location && stationOf(ses) === scope.station);
  const activeSales = async (sessionId) => (await store.listDocs('sales')).filter((x) => x.sessionId === sessionId && !x.voided);
  const settlement = async (session) => {
    const [sales, products] = await Promise.all([activeSales(session.id), store.listDocs('products')]);
    const all = (await store.listDocs('sales')).filter((x) => x.sessionId === session.id);
    return { ...computeSettlement(session, sales, products), voidedCount: all.length - sales.length, openedBy: session.openedBy, closedBy: session.closedBy || null, openedAt: session.openedAt, closedAt: session.closedAt || null, note: session.note || null };
  };
  const loadOpen = async (id) => {
    const ses = S.id.safeParse(id).success ? await store.getDoc('barsessions', id) : null;
    return ses;
  };

  r.get('/products', wrap(async (req, res) => {
    const list = (await store.listDocs('products')).filter((p) => req.session.role === 'owner' || p.active !== false);
    res.json(list.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
  }));

  // Offene Kasse am Standort + letzter gezaehlter Bestand (zum Vorausfuellen beim Oeffnen)
  r.get('/bar/current', wrap(async (req, res) => {
    const scope = await kasseScope(req, res); if (!scope) return;
    const location = scope.owner ? (S.LOCATIONS.includes(req.query.location) ? req.query.location : null) : scope.location;
    if (!location) return res.status(400).json({ error: 'invalid_location' });
    const station = scope.owner ? (STATIONS.includes(req.query.station) ? req.query.station : 'theke') : scope.station;
    // Eine Kasse pro Standort und Kassenplatz (Tuer und Theke haben getrennte Kassenladen)
    const sessions = (await store.listDocs('barsessions')).filter((b) => b.location === location && stationOf(b) === station);
    const open = sessions.find((b) => !b.closedAt) || null;
    const last = sessions.filter((b) => b.closedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
    res.json({ location, station, locked: !scope.owner, session: open && { id: open.id, date: open.date, location: open.location, station, openedBy: open.openedBy, openedAt: open.openedAt }, settlement: open ? await settlement(open) : null, lastStock: last?.stockEnd || {}, lastSessionId: last?.id || null });
  }));

  r.post('/bar/open', wrap(async (req, res) => {
    const d = parse(sessionOpen, req.body, res); if (!d) return;
    const scope = await kasseScope(req, res); if (!scope) return;
    if (!scope.owner && (d.location !== scope.location || d.station !== scope.station)) return res.status(403).json({ error: 'wrong_station' });
    if (d.station === 'tuer') d.stockStart = {};
    const open = (await store.listDocs('barsessions')).find((b) => b.location === d.location && stationOf(b) === d.station && !b.closedAt);
    if (open) return res.status(409).json({ error: 'session_open', sessionId: open.id });
    const ses = { id: crypto.randomUUID(), date: berlinDate(new Date()), ...d, openedBy: by(req), openedAt: new Date().toISOString(), closedAt: null };
    await store.putDoc('barsessions', ses); log(req, 'bar_opened');
    res.status(201).json({ id: ses.id, date: ses.date, location: ses.location, station: ses.station });
  }));

  r.post('/bar/:id/sales', wrap(async (req, res) => {
    const d = parse(saleSchema, req.body, res); if (!d) return;
    const ses = await loadOpen(req.params.id);
    if (!ses) return res.status(404).json({ error: 'not_found' });
    if (ses.closedAt) return res.status(409).json({ error: 'session_closed' });
    const scope = await kasseScope(req, res); if (!scope) return;
    if (!inScope(scope, ses)) return res.status(403).json({ error: 'wrong_station' });
    // Preise kommen immer vom Server, nie vom Handy.
    const products = new Map((await store.listDocs('products')).map((p) => [p.id, p]));
    const items = [];
    for (const it of d.items) {
      const p = products.get(it.productId);
      if (!p || p.active === false) return res.status(400).json({ error: 'unknown_product' });
      if (!allowedAtStation(stationOf(ses), p.category)) return res.status(400).json({ error: 'wrong_station' });
      items.push({ productId: p.id, qty: it.qty, priceCents: p.priceCents });
    }
    const sale = { id: crypto.randomUUID(), sessionId: ses.id, at: new Date().toISOString(), by: by(req), payment: d.payment, items, ...(d.note && { note: d.note }) };
    await store.putDoc('sales', sale);
    res.status(201).json({ id: sale.id, totalCents: d.payment === 'gratis' ? 0 : items.reduce((a, i) => a + i.qty * i.priceCents, 0) });
  }));

  // Storno: wird nicht geloescht, sondern markiert (nachvollziehbar in der Abrechnung)
  r.delete('/bar/:id/sales/:saleId', wrap(async (req, res) => {
    const ses = await loadOpen(req.params.id);
    if (!ses || !S.id.safeParse(req.params.saleId).success) return res.status(404).json({ error: 'not_found' });
    if (ses.closedAt && req.session.role !== 'owner') return res.status(409).json({ error: 'session_closed' });
    const scope = await kasseScope(req, res); if (!scope) return;
    if (!inScope(scope, ses)) return res.status(403).json({ error: 'wrong_station' });
    const sale = await store.getDoc('sales', req.params.saleId);
    if (!sale || sale.sessionId !== ses.id || sale.voided) return res.status(404).json({ error: 'not_found' });
    await store.putDoc('sales', { ...sale, voided: true, voidedBy: by(req), voidedAt: new Date().toISOString() }); log(req, 'sale_voided');
    res.sendStatus(204);
  }));

  r.get('/bar/:id/sales', wrap(async (req, res) => {
    const ses = await loadOpen(req.params.id);
    if (!ses) return res.status(404).json({ error: 'not_found' });
    const scope = await kasseScope(req, res); if (!scope) return;
    if (!inScope(scope, ses)) return res.status(403).json({ error: 'wrong_station' });
    const list = (await store.listDocs('sales')).filter((x) => x.sessionId === ses.id).sort((a, b) => b.at.localeCompare(a.at));
    res.json(req.session.role === 'owner' ? list : list.slice(0, 15));
  }));

  r.post('/bar/:id/close', wrap(async (req, res) => {
    const d = parse(sessionClose, req.body, res); if (!d) return;
    const ses = await loadOpen(req.params.id);
    if (!ses) return res.status(404).json({ error: 'not_found' });
    if (ses.closedAt) return res.status(409).json({ error: 'session_closed' });
    const scope = await kasseScope(req, res); if (!scope) return;
    if (!inScope(scope, ses)) return res.status(403).json({ error: 'wrong_station' });
    const { helpers: helperInput, ...rest } = d;
    const helpers = buildHelpers(ses, helperInput, () => crypto.randomUUID());
    const next = { ...ses, ...rest, helpers, closedBy: by(req), closedAt: new Date().toISOString() };
    for (const hl of helpers) await store.putDoc('shifts', helperShift(next, hl));
    await store.putDoc('barsessions', next); log(req, 'bar_closed');
    res.json(await settlement(next));
  }));

  // Abrechnung ansehen: Chef immer, Team nur die letzten 3 Tage
  r.get('/bar/sessions/:id', wrap(async (req, res) => {
    const ses = await loadOpen(req.params.id);
    if (!ses) return res.status(404).json({ error: 'not_found' });
    if (req.session.role === 'staff' && (Date.parse(berlinDate(new Date())) - Date.parse(ses.date)) / 86_400_000 > 3) return res.status(403).json({ error: 'forbidden' });
    res.json(await settlement(ses));
  }));

  // --- Nur Chef ---
  r.get('/dashboard', owner, wrap(async (req, res) => {
    const range = rangeQ(req.query, true);
    const [courses, enrollments, staff, shifts, barsessions, sales, products, settings] = await Promise.all([
      store.listCourses({}), store.listAllEnrollments(), store.listDocs('staff'), store.listDocs('shifts'), store.listDocs('barsessions'), store.listDocs('sales'), store.listDocs('products'), store.getDoc('settings', 'main'),
    ]);
    res.json(computeDashboard({ ...range, courses, enrollments, staff, shifts, barsessions, sales: sales.filter((x) => !x.voided), products, settings }));
  }));

  r.get('/year', owner, wrap(async (req, res) => {
    const year = /^\d{4}$/.test(req.query.year || '') ? Number(req.query.year) : Number(berlinDate(new Date()).slice(0, 4));
    const [courses, enrollments, staff, shifts, barsessions, sales, products, settings] = await Promise.all([
      store.listCourses({}), store.listAllEnrollments(), store.listDocs('staff'), store.listDocs('shifts'), store.listDocs('barsessions'), store.listDocs('sales'), store.listDocs('products'), store.getDoc('settings', 'main'),
    ]);
    res.json(computeYear({ year, courses, enrollments, staff, shifts, barsessions, sales: sales.filter((x) => !x.voided), products, settings }));
  }));

  r.get('/bar/sessions', owner, wrap(async (req, res) => {
    const range = rangeQ(req.query, false);
    const list = (await store.listDocs('barsessions')).filter((b) => inR(range, b.date));
    res.json((await Promise.all(list.map(settlement))).sort((a, b) => b.date.localeCompare(a.date)));
  }));
  // Monatsexport (CSV, Excel-tauglich mit ; und UTF-8-BOM) fuer Buchhaltung/Steuerberater
  r.get('/export/:kind', owner, wrap(async (req, res) => {
    const range = rangeQ(req.query, false);
    if (!range || !['abende', 'schichten'].includes(req.params.kind)) return res.status(400).json({ error: 'invalid_request' });
    const q = (v) => { const t = String(v ?? ''); return /[;"\n]/.test(t) || /^[=+\-@]/.test(t) ? `"${t.replace(/^([=+\-@])/, "'$1").replace(/"/g, '""')}"` : t; };
    const money = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
    let rows;
    if (req.params.kind === 'abende') {
      const list = (await Promise.all((await store.listDocs('barsessions')).filter((b) => inR(range, b.date)).map(settlement))).sort((a, b) => a.date.localeCompare(b.date));
      rows = [['Datum', 'Standort', 'Kassenplatz', 'Gäste', 'Eintritt+Workshops', 'Getränke', 'Umsatz gesamt', 'davon bar', 'davon Karte', 'Kasse Anfang', 'Entnahmen', 'Kasse Soll', 'Kasse gezählt', 'Kassendifferenz', 'Fehlmenge Stück', 'Storno', 'geöffnet von', 'geschlossen von', 'Notiz'],
        ...list.map((s) => [s.date, s.location, s.station === 'tuer' ? 'Tür' : s.station === 'kombi' ? 'Tür + Theke' : 'Theke', s.guests ?? '', money(s.ticketRevenueCents), money(s.drinksRevenueCents), money(s.revenueCents), money(s.cashSalesCents), money(s.cardSalesCents), money(s.cashStartCents), money(s.cashOutCents), money(s.cashExpectedCents), money(s.cashCountedCents), money(s.cashDiffCents), s.missingUnits, s.voidedCount, s.openedBy, s.closedBy || 'offen', s.note || ''])];
    } else {
      const list = (await store.listDocs('shifts')).filter((s) => inR(range, berlinDate(s.start))).sort((a, b) => a.staffRef.localeCompare(b.staffRef) || a.start.localeCompare(b.start));
      const t = (iso) => new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
      rows = [['Kürzel', 'Tätigkeit', 'Standort', 'Beginn', 'Ende', 'Stunden', 'Stundenlohn', 'Kosten'],
        ...list.map((s) => { const hrs = s.end ? (new Date(s.end) - new Date(s.start)) / 3_600_000 : 0; return [s.staffRef, s.kind, s.location, t(s.start), s.end ? t(s.end) : 'läuft', hrs.toFixed(2).replace('.', ','), money(s.rateCents), money(Math.round(hrs * s.rateCents))]; })];
    }
    log(req, `export_${req.params.kind}`);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="salsamas-${req.params.kind}-${range.from}_${range.to}.csv"` });
    res.send(`\ufeff${rows.map((r) => r.map(q).join(';')).join('\r\n')}\r\n`);
  }));
  r.delete('/bar/sessions/:id', owner, wrap(async (req, res) => {
    const ses = await loadOpen(req.params.id);
    if (!ses) return res.status(404).json({ error: 'not_found' });
    for (const x of (await store.listDocs('sales')).filter((y) => y.sessionId === ses.id)) await store.removeDoc('sales', x.id);
    await store.removeDoc('barsessions', ses.id); log(req, 'bar_session_deleted');
    res.sendStatus(204);
  }));

  r.post('/products', owner, wrap(async (req, res) => {
    const d = parse(productCreate, req.body, res); if (!d) return;
    const p = { id: crypto.randomUUID(), ...d, createdAt: new Date().toISOString() };
    await store.putDoc('products', p); log(req, 'product_created');
    res.status(201).json(p);
  }));
  r.patch('/products/:id', owner, wrap(async (req, res) => {
    const d = parse(productPatch, req.body, res); if (!d) return;
    const cur = S.id.safeParse(req.params.id).success ? await store.getDoc('products', req.params.id) : null;
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const p = { ...cur, ...d, updatedAt: new Date().toISOString() };
    await store.putDoc('products', p); log(req, 'product_updated');
    res.json(p);
  }));

  const publicStaff = ({ pinHash, ...p }) => p;
  r.get('/staff', owner, wrap(async (req, res) => res.json((await store.listDocs('staff')).map(publicStaff).sort((a, b) => a.ref.localeCompare(b.ref)))));
  r.post('/staff', owner, wrap(async (req, res) => {
    const d = parse(staffCreate, req.body, res); if (!d) return;
    const id = d.ref.toLowerCase();
    if (await store.getDoc('staff', id)) return res.status(409).json({ error: 'already_exists' });
    const p = { id, ref: d.ref, pinHash: hashPin(d.pin), hourlyRateCents: d.hourlyRateCents, active: d.active, createdAt: new Date().toISOString() };
    await store.putDoc('staff', p); log(req, 'staff_created');
    res.status(201).json(publicStaff(p));
  }));
  r.patch('/staff/:id', owner, wrap(async (req, res) => {
    const d = parse(staffPatch, req.body, res); if (!d) return;
    const cur = /^[a-z0-9_.-]{2,30}$/.test(req.params.id) ? await store.getDoc('staff', req.params.id) : null;
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const { pin: newPin, ...rest } = d;
    const p = { ...cur, ...rest, ...(newPin && { pinHash: hashPin(newPin) }), updatedAt: new Date().toISOString() };
    await store.putDoc('staff', p); log(req, 'staff_updated');
    res.json(publicStaff(p));
  }));

  r.get('/shifts', owner, wrap(async (req, res) => {
    const range = rangeQ(req.query, false);
    const list = (await store.listDocs('shifts')).filter((s) => inR(range, berlinDate(s.start)));
    res.json(list.sort((a, b) => b.start.localeCompare(a.start)));
  }));
  // Nachtragen/Korrigieren durch den Chef (z. B. vergessenes Ausstempeln)
  r.post('/shifts', owner, wrap(async (req, res) => {
    const d = parse(shiftManual, req.body, res); if (!d) return;
    const p = await store.getDoc('staff', d.staffRef.toLowerCase());
    if (!p) return res.status(404).json({ error: 'not_found' });
    const s = { id: crypto.randomUUID(), ...d, staffRef: p.ref, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), rateCents: p.hourlyRateCents, createdBy: 'chef' };
    await store.putDoc('shifts', s); log(req, 'shift_added');
    res.status(201).json(s);
  }));
  // Aushilfe: Ueberweisung erledigt markieren
  r.patch('/shifts/:id', owner, wrap(async (req, res) => {
    const d = parse(z.object({ paid: z.boolean() }).strict(), req.body, res); if (!d) return;
    const cur = S.id.safeParse(req.params.id).success ? await store.getDoc('shifts', req.params.id) : null;
    if (!cur) return res.status(404).json({ error: 'not_found' });
    const next = { ...cur, paid: d.paid, paidAt: d.paid ? new Date().toISOString() : null };
    await store.putDoc('shifts', next); log(req, 'shift_paid');
    res.json(next);
  }));
  r.delete('/shifts/:id', owner, wrap(async (req, res) => {
    if (!S.id.safeParse(req.params.id).success) return res.status(400).json({ error: 'invalid_id' });
    if (!(await store.removeDoc('shifts', req.params.id))) return res.status(404).json({ error: 'not_found' });
    log(req, 'shift_deleted'); res.sendStatus(204);
  }));

  r.get('/settings', owner, wrap(async (req, res) => res.json(mergeSettings(await store.getDoc('settings', 'main')))));
  r.put('/settings', owner, wrap(async (req, res) => {
    const d = parse(settingsSchema, req.body, res); if (!d) return;
    await store.putDoc('settings', { id: 'main', ...d, updatedAt: new Date().toISOString() }); log(req, 'settings_updated');
    res.json(mergeSettings(d));
  }));

  return r;
}

module.exports = { createTeamRouter };
