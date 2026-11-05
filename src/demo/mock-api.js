'use strict';
/*
 * Demo-Modus: beantwortet /app/api/* direkt im Browser mit Beispieldaten (kein Server).
 * Nutzt dieselbe Rechenlogik wie der echte Server (computeDashboard, computeSettlement).
 * Wird nur von scripts/build-demo.js in die Demo-Seite eingebaut.
 */
(() => {
  const { computeDashboard, computeYear, rangeOf, mergeSettings, berlinDate } = window.__cockpit.dashboard;
  const { computeSettlement, buildHelpers, helperShift } = window.__cockpit.bar;
  const { computeWeek, computeInvoices, mondayOf, addDays } = window.__cockpit.plan;
  const KEY = 'cockpit.demo.db.v13';
  const fresh = () => JSON.parse(JSON.stringify(window.__cockpit.seed));
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { db = fresh(); }
  db.plan = db.plan || {}; db.invoices = db.invoices || {}; db.purchases = db.purchases || {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* privat */ } };
  window.__cockpit.resetDemo = () => { db = fresh(); save(); try { localStorage.removeItem('cockpit.auth'); } catch { /* */ } location.reload(); };

  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  const list = (c) => Object.values(db[c]);
  const today = () => berlinDate(new Date());
  const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (status, error, details) => json(status, { error, ...(details && { details: [{ path: '', message: details }] }) });
  const tokenOf = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  const readToken = (h) => { try { return JSON.parse(decodeURIComponent(escape(atob(String(h || '').replace(/^Bearer /, ''))))); } catch { return null; } };
  const enrollments = () => list('enrollments');
  const activeSales = (sid) => list('sales').filter((x) => x.sessionId === sid && !x.voided);
  const settle = (ses) => {
    const all = list('sales').filter((x) => x.sessionId === ses.id);
    return { ...computeSettlement(ses, all.filter((x) => !x.voided), list('products')), voidedCount: all.filter((x) => x.voided).length, openedBy: ses.openedBy, closedBy: ses.closedBy || null, openedAt: ses.openedAt, closedAt: ses.closedAt || null, note: ses.note || null };
  };
  const publicStaff = ({ pinHash, ...p }) => p;

  function handle(method, path, query, body, auth) {
    if (method === 'POST' && path === '/login') {
      if ('apiKey' in body) return body.apiKey.trim().length >= 8 ? json(200, { token: tokenOf({ role: 'owner', sub: 'chef' }), role: 'owner', ref: 'chef' }) : err(401, 'unauthorized');
      const p = db.staff[String(body.ref || '').toLowerCase()];
      if (!p || p.active === false || body.pin !== '123456') return err(401, 'unauthorized');
      return json(200, { token: tokenOf({ role: 'staff', sub: p.id }), role: 'staff', ref: p.ref });
    }
    if (!auth) return err(401, 'unauthorized');
    const owner = auth.role === 'owner';
    const staff = owner ? null : db.staff[auth.sub];
    if (!owner && (!staff || staff.active === false)) return err(401, 'unauthorized');
    const by = owner ? 'chef' : staff.ref;
    const only = () => (owner ? null : err(403, 'forbidden'));
    // Team an Kassenplatz/Standort der laufenden Schicht gebunden
    const scope = () => { if (owner) return { owner: true }; const sh = list('shifts').find((x) => x.staffRef === staff.ref && !x.end && !x.helper); return sh ? { location: sh.location, station: sh.kind === 'empfang' ? 'tuer' : sh.kind === 'kombi' ? 'kombi' : 'theke' } : null; };
    const stOf = (b) => (['tuer', 'kombi'].includes(b.station) ? b.station : 'theke');
    const inScope = (sc, b) => sc.owner || (b.location === sc.location && stOf(b) === sc.station);
    if (path.startsWith('/bar/') && !path.startsWith('/bar/sessions') && !scope()) return err(403, 'no_shift');
    let m;

    if (method === 'GET' && path === '/me') {
      if (owner) return json(200, { role: 'owner', ref: 'chef' });
      const mine = list('shifts').filter((s) => s.staffRef === staff.ref);
      const month = today().slice(0, 7);
      const hours = mine.filter((s) => berlinDate(s.start).slice(0, 7) === month).reduce((a, s) => a + ((s.end ? new Date(s.end) : new Date()) - new Date(s.start)) / 3_600_000, 0);
      return json(200, { role: 'staff', ref: staff.ref, openShift: mine.find((s) => !s.end) || null, monthHours: Math.round(hours * 10) / 10, recent: mine.sort((a, b) => b.start.localeCompare(a.start)).slice(0, 10) });
    }
    if (method === 'POST' && path === '/shifts/start') {
      if (!staff) return err(403, 'forbidden');
      if (list('shifts').some((s) => s.staffRef === staff.ref && !s.end)) return err(409, 'shift_running');
      const s = { id: uid(), staffRef: staff.ref, kind: body.kind, location: body.location, start: new Date().toISOString(), end: null, rateCents: staff.hourlyRateCents };
      db.shifts[s.id] = s; save(); return json(201, s);
    }
    if (method === 'POST' && path === '/shifts/stop') {
      if (!staff) return err(403, 'forbidden');
      const s = list('shifts').find((x) => x.staffRef === staff.ref && !x.end);
      if (!s) return err(409, 'no_shift_running');
      s.end = new Date().toISOString(); save(); return json(200, s);
    }
    if (method === 'POST' && path === '/shifts/own') {
      if (!staff) return err(403, 'forbidden');
      const a = new Date(body.start), b = new Date(body.end);
      if (!(b > a) || b - a > 16 * 3_600_000) return err(400, 'validation_failed', 'Ende muss nach Start liegen (max. 16 Std.)');
      if ((Date.now() - a) / 86_400_000 > 3 || b > new Date(Date.now() + 600_000)) return err(400, 'validation_failed', 'nur die letzten 3 Tage, nicht in der Zukunft');
      if (list('shifts').some((s) => s.staffRef === staff.ref && new Date(s.start) < b && new Date(s.end || Date.now()) > a)) return err(409, 'overlap');
      const s = { id: uid(), staffRef: staff.ref, kind: body.kind, location: body.location, start: a.toISOString(), end: b.toISOString(), rateCents: staff.hourlyRateCents };
      db.shifts[s.id] = s; save(); return json(201, s);
    }
    if (method === 'GET' && path === '/products') return json(200, list('products').filter((p) => owner || p.active !== false).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    if (method === 'GET' && path === '/bar/current') {
      const sc = scope();
      const station = sc.owner ? (['tuer', 'kombi'].includes(query.get('station')) ? query.get('station') : 'theke') : sc.station;
      const location = sc.owner ? query.get('location') : sc.location;
      const ss = list('barsessions').filter((b) => b.location === location && stOf(b) === station);
      const open = ss.find((b) => !b.closedAt) || null;
      const last = ss.filter((b) => b.closedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
      return json(200, { location, station, locked: !sc.owner, session: open, settlement: open ? settle(open) : null, lastStock: last?.stockEnd || {} });
    }
    if (method === 'POST' && path === '/bar/open') {
      const station = ['tuer', 'kombi'].includes(body.station) ? body.station : 'theke';
      const sc = scope(); if (!sc.owner && (body.location !== sc.location || station !== sc.station)) return err(403, 'wrong_station');
      if (list('barsessions').some((b) => b.location === body.location && stOf(b) === station && !b.closedAt)) return err(409, 'session_open');
      const ses = { id: uid(), date: today(), stockStart: {}, ...body, station, openedBy: by, openedAt: new Date().toISOString(), closedAt: null };
      db.barsessions[ses.id] = ses; save(); return json(201, ses);
    }
    if ((m = path.match(/^\/bar\/([^/]+)\/sales$/))) {
      const ses = db.barsessions[m[1]]; if (!ses) return err(404, 'not_found');
      if (!inScope(scope(), ses)) return err(403, 'wrong_station');
      if (method === 'GET') return json(200, list('sales').filter((x) => x.sessionId === ses.id).sort((a, b) => b.at.localeCompare(a.at)));
      if (ses.closedAt) return err(409, 'session_closed');
      const isTicket = (pid) => ['eintritt', 'workshop'].includes(db.products[pid]?.category);
      if (body.items.some((it) => !db.products[it.productId] || (stOf(ses) !== 'kombi' && isTicket(it.productId) !== (stOf(ses) === 'tuer')))) return err(400, 'wrong_station');
      const items = body.items.map((it) => ({ productId: it.productId, qty: it.qty, priceCents: db.products[it.productId].priceCents }));
      const sale = { id: uid(), sessionId: ses.id, at: new Date().toISOString(), by, payment: body.payment, items, ...(body.note && { note: String(body.note).slice(0, 60) }) };
      db.sales[sale.id] = sale; save(); return json(201, { id: sale.id });
    }
    if (method === 'DELETE' && (m = path.match(/^\/bar\/([^/]+)\/sales\/([^/]+)$/))) {
      const sale = db.sales[m[2]]; if (!sale || sale.voided) return err(404, 'not_found');
      if (!inScope(scope(), db.barsessions[sale.sessionId] || {})) return err(403, 'wrong_station');
      Object.assign(sale, { voided: true, voidedBy: by, voidedAt: new Date().toISOString() }); save(); return json(204);
    }
    if (method === 'POST' && (m = path.match(/^\/bar\/([^/]+)\/close$/))) {
      const ses = db.barsessions[m[1]]; if (!ses) return err(404, 'not_found');
      if (ses.closedAt) return err(409, 'session_closed');
      if (!inScope(scope(), ses)) return err(403, 'wrong_station');
      const { helpers: hIn = [], ...rest } = body;
      const helpers = buildHelpers(ses, hIn, uid);
      Object.assign(ses, { cashOutCents: 0, restock: {}, stockEnd: {}, ...rest, helpers, closedBy: by, closedAt: new Date().toISOString() }); save();
      for (const hl of helpers) db.shifts[hl.id] = helperShift(ses, hl);
      save();
      return json(200, settle(ses));
    }
    if (method === 'GET' && (m = path.match(/^\/bar\/sessions\/([^/]+)$/))) return db.barsessions[m[1]] ? json(200, settle(db.barsessions[m[1]])) : err(404, 'not_found');

    // --- nur Chef ---
    const deny = only(); if (deny) return deny;
    const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : null;
    const qf = query.get('from'), qt = query.get('to');
    const range = /^\d{4}-\d{2}-\d{2}$/.test(qf || '') && /^\d{4}-\d{2}-\d{2}$/.test(qt || '') && qf <= qt ? { from: qf, to: qt } : month ? rangeOf({ month }) : null;
    const inR = (d) => !range || (d >= range.from && d <= range.to);
    const data = () => ({ purchases: list('purchases'), invoices: list('invoices'), courses: list('courses'), enrollments: enrollments(), staff: list('staff'), shifts: list('shifts'), barsessions: list('barsessions'), sales: list('sales').filter((x) => !x.voided), products: list('products'), settings: db.settings.main });
    if (method === 'GET' && path === '/year') return json(200, computeYear({ year: Number(query.get('year')) || Number(today().slice(0, 4)), ...data() }));
    if (method === 'GET' && path === '/dashboard') {
      return json(200, computeDashboard({ ...(range || rangeOf({ month: today().slice(0, 7) })), purchases: list('purchases'), invoices: list('invoices'), courses: list('courses'), enrollments: enrollments(), staff: list('staff'), shifts: list('shifts'), barsessions: list('barsessions'), sales: list('sales').filter((x) => !x.voided), products: list('products'), settings: db.settings.main }));
    }
    if (method === 'GET' && path === '/bar/sessions') return json(200, list('barsessions').filter((b) => inR(b.date)).map(settle).sort((a, b) => b.date.localeCompare(a.date)));
    if (method === 'GET' && path === '/staff') return json(200, list('staff').map(publicStaff).sort((a, b) => a.ref.localeCompare(b.ref)));
    if (method === 'POST' && path === '/staff') {
      const id = String(body.ref).toLowerCase();
      if (!/^[a-z0-9_.-]{2,30}$/.test(id)) return err(400, 'validation_failed', 'Kürzel: 2–30 Zeichen, nur Buchstaben/Zahlen');
      if (db.staff[id]) return err(409, 'already_exists');
      db.staff[id] = { id, ref: body.ref, hourlyRateCents: body.hourlyRateCents, employment: body.employment || 'minijob', active: true }; save(); return json(201, db.staff[id]);
    }
    if (method === 'PATCH' && (m = path.match(/^\/staff\/([^/]+)$/))) {
      const p = db.staff[m[1]]; if (!p) return err(404, 'not_found');
      const { pin, ...rest } = body;
      if (pin !== undefined && !/^\d{6,8}$/.test(pin)) return err(400, 'validation_failed', 'PIN: 6–8 Ziffern');
      Object.assign(p, rest); save(); return json(200, publicStaff(p));
    }
    if (method === 'GET' && path === '/shifts') return json(200, list('shifts').filter((s) => inR(berlinDate(s.start))).sort((a, b) => b.start.localeCompare(a.start)));
    if (method === 'POST' && path === '/shifts') {
      const p = db.staff[String(body.staffRef).toLowerCase()]; if (!p) return err(404, 'not_found');
      const s = { id: uid(), ...body, staffRef: p.ref, start: new Date(body.start).toISOString(), end: new Date(body.end).toISOString(), rateCents: p.hourlyRateCents };
      if (!(new Date(s.end) > new Date(s.start))) return err(400, 'validation_failed', 'Ende muss nach Start liegen');
      db.shifts[s.id] = s; save(); return json(201, s);
    }
    if (method === 'PATCH' && (m = path.match(/^\/shifts\/([^/]+)$/))) { const sh = db.shifts[m[1]]; if (!sh) return err(404, 'not_found'); sh.paid = !!body.paid; save(); return json(200, sh); }
    if (method === 'DELETE' && (m = path.match(/^\/shifts\/([^/]+)$/))) { if (!db.shifts[m[1]]) return err(404, 'not_found'); delete db.shifts[m[1]]; save(); return json(204); }
    // Getraenkekarte + Einkaeufe
    if (method === 'POST' && path === '/products/import-catalog') {
      const have = new Set(list('products').map((p) => p.name.toLowerCase())); let n = 0;
      for (const [i, c] of [...window.__cockpit.catalog.TICKETS, ...window.__cockpit.catalog.CATALOG].entries()) { if (have.has(c.name.toLowerCase())) continue; const id = uid(); db.products[id] = { id, name: c.name, priceCents: c.priceCents, costCents: c.costCents, color: c.color, source: c.source, category: c.category, active: true, sort: 100 + i * 10 }; n++; }
      save(); return json(200, { created: n });
    }
    if (method === 'GET' && path === '/purchases') return json(200, list('purchases').filter((p) => inR(p.date)).sort((a, b) => b.date.localeCompare(a.date)));
    if (method === 'POST' && path === '/purchases') { if (!body.supplier || !body.date || !(body.totalCents >= 0)) return err(400, 'validation_failed', 'Datum, Lieferant und Betrag angeben'); const p = { id: uid(), depositCents: 0, ...body }; db.purchases[p.id] = p; save(); return json(201, p); }
    if (method === 'DELETE' && (m = path.match(/^\/purchases\/([^/]+)$/))) { if (!db.purchases[m[1]]) return err(404, 'not_found'); delete db.purchases[m[1]]; save(); return json(204); }
    // Wochenplan
    if (method === 'GET' && path === '/plan') return json(200, computeWeek({ week: /^\d{4}-\d{2}-\d{2}$/.test(query.get('week') || '') ? query.get('week') : today(), plan: list('plan'), staff: list('staff'), shifts: list('shifts'), settings: mergeSettings(db.settings.main) }));
    if (method === 'POST' && path === '/plan/copy') {
      const src = mondayOf(body.from), dst = mondayOf(body.to);
      const shiftD = Math.round((Date.parse(dst) - Date.parse(src)) / 86_400_000);
      const key = (s) => `${s.date}_${s.start}_${s.location}_${s.kind}_${s.staffRef || s.guestName || ''}`;
      const existing = new Set(list('plan').filter((s) => s.date >= dst && s.date <= addDays(dst, 6)).map(key));
      let n = 0;
      for (const s of list('plan').filter((x) => x.date >= src && x.date <= addDays(src, 6))) { const c = { ...s, id: uid(), date: addDays(s.date, shiftD) }; if (existing.has(key(c))) continue; db.plan[c.id] = c; n++; }
      save(); return json(200, { copied: n });
    }
    if (method === 'POST' && path === '/plan') {
      if (body.staffRef && !db.staff[String(body.staffRef).toLowerCase()]) return err(400, 'validation_failed', 'Person nicht gefunden');
      if (!/^\d{2}:\d{2}$/.test(body.start || '') || !/^\d{2}:\d{2}$/.test(body.end || '')) return err(400, 'validation_failed', 'Uhrzeit HH:MM');
      const slot = { id: uid(), ...body }; db.plan[slot.id] = slot; save(); return json(201, slot);
    }
    if ((m = path.match(/^\/plan\/([^/]+)$/))) {
      const cur = db.plan[m[1]]; if (!cur) return err(404, 'not_found');
      if (method === 'DELETE') { delete db.plan[m[1]]; save(); return json(204); }
      if (method === 'PATCH') { Object.assign(cur, body); save(); return json(200, cur); }
    }
    if (method === 'GET' && path === '/invoices') return json(200, computeInvoices({ month: query.get('month') || today().slice(0, 7), staff: list('staff'), shifts: list('shifts'), invoices: list('invoices') }));
    if (method === 'PUT' && (m = path.match(/^\/invoices\/([^/]+)\/(\d{4}-\d{2})$/))) { const doc = { id: `${m[1]}_${m[2]}`, staffId: m[1], month: m[2], status: body.status }; db.invoices[doc.id] = doc; save(); return json(200, doc); }
    if (method === 'GET' && path === '/settings') return json(200, mergeSettings(db.settings.main));
    if (method === 'PUT' && path === '/settings') { db.settings.main = { id: 'main', ...body }; save(); return json(200, mergeSettings(body)); }
    if (method === 'POST' && path === '/products') {
      const p = { id: uid(), active: true, sort: 100, ...body }; db.products[p.id] = p; save(); return json(201, p);
    }
    if (method === 'PATCH' && (m = path.match(/^\/products\/([^/]+)$/))) {
      const p = db.products[m[1]]; if (!p) return err(404, 'not_found'); Object.assign(p, body); save(); return json(200, p);
    }
    return err(404, 'not_found');
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/app/api');
    if (i < 0) return realFetch(input, init);
    const path = url.pathname.slice(i + '/app/api'.length);
    const headers = new Headers(init.headers || {});
    let body = {};
    try { body = init.body ? JSON.parse(init.body) : {}; } catch { return err(400, 'invalid_json'); }
    await new Promise((r) => setTimeout(r, 60));
    try { return handle((init.method || 'GET').toUpperCase(), path, url.searchParams, body, readToken(headers.get('Authorization'))); } catch (e) { console.error(e); return err(500, 'internal_error'); }
  };
})();
