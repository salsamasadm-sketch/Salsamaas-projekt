'use strict';
const { computeSettlement } = require('./bar');
/**
 * Rechnet aus den Rohdaten die Chef-Uebersicht: Kennzahlen mit Ampel, To-dos und Verbesserungsideen.
 * Reine Funktion (keine Datenbank), damit sie leicht testbar ist.
 */

const DEFAULT_SETTINGS = {
  targets: { utilizationPct: 75, openPaymentsPct: 5, barPerGuestCents: 600, barPersonnelPct: 30 },
  fixedCostsCents: { maxvorstadt: 0, pasing: 0 },
  minijobLimitCents: 60300, // Minijob-Grenze 2026 (bei Gesetzesaenderung in den Einstellungen anpassen)
};
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const LOC_LABEL = { maxvorstadt: 'Maxvorstadt', pasing: 'Pasing' };

const berlinFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const berlinDate = (d) => berlinFmt.format(new Date(d));
const weekday = (date) => new Date(`${date}T12:00:00Z`).getUTCDay();
const eur = (c) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const pct = (v) => `${Math.round(v)} %`;
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);

function mergeSettings(s) {
  s = s || {};
  return {
    targets: { ...DEFAULT_SETTINGS.targets, ...(s.targets || {}) },
    fixedCostsCents: { ...DEFAULT_SETTINGS.fixedCostsCents, ...(s.fixedCostsCents || {}) },
    minijobLimitCents: s.minijobLimitCents ?? DEFAULT_SETTINGS.minijobLimitCents,
  };
}

/** Stunden einer Schicht; laufende Schichten zaehlen bis "jetzt". */
function shiftHours(sh, now) {
  const end = sh.end ? new Date(sh.end) : now;
  return Math.max(0, (end - new Date(sh.start)) / 3_600_000);
}
const shiftCost = (sh, now) => Math.round(shiftHours(sh, now) * (sh.rateCents || 0));

/** Ampel: ok = Ziel erreicht, warn = bis 15 % daneben, bad = deutlich daneben. */
function status(value, target, dir) {
  if (value == null || target == null || Number.isNaN(value)) return 'none';
  const good = dir === 'min' ? value >= target : value <= target;
  if (good) return 'ok';
  const off = dir === 'min' ? (target - value) / (target || 1) : (value - target) / (target || 1);
  return off <= 0.15 ? 'warn' : 'bad';
}

function computeDashboard({ month, now = new Date(), courses = [], enrollments = [], staff = [], shifts = [], barsessions = [], sales = [], products = [], settings }) {
  const cfg = mergeSettings(settings);
  const t = cfg.targets;
  const inMonth = (date) => date && date.slice(0, 7) === month;
  const today = berlinDate(now);

  // --- Bar ---
  const salesBySession = new Map();
  for (const x of sales) { const l = salesBySession.get(x.sessionId) || []; l.push(x); salesBySession.set(x.sessionId, l); }
  const bars = barsessions.filter((b) => inMonth(b.date)).map((b) => computeSettlement(b, salesBySession.get(b.id) || [], products));
  // Bar-Umsatz = nur Getraenke/Snacks. Eintritt und Workshops laufen getrennt.
  const barRevenue = sum(bars, (b) => b.drinksRevenueCents);
  const ticketRevenue = sum(bars, (b) => b.ticketRevenueCents);
  const withGuests = bars.filter((b) => b.guests > 0);
  const guests = sum(withGuests, (b) => b.guests);
  const barPerGuest = guests > 0 ? sum(withGuests, (b) => b.drinksRevenueCents) / guests : null;
  const closed = bars.filter((b) => b.status === 'closed');
  const cashDiff = closed.length ? sum(closed, (b) => b.cashDiffCents || 0) : null;
  const missingUnits = sum(closed, (b) => b.missingUnits);
  const missingValue = sum(closed, (b) => b.missingValueCents);

  // --- Personal ---
  const monthShifts = shifts.filter((s) => inMonth(berlinDate(s.start)));
  const personnelCost = sum(monthShifts, (s) => shiftCost(s, now));
  const barShifts = monthShifts.filter((s) => s.kind === 'bar');
  const barPersonnelCost = sum(barShifts, (s) => shiftCost(s, now));
  const barPersonnelPct = barRevenue > 0 ? (barPersonnelCost / barRevenue) * 100 : null;
  const byStaff = staff.map((p) => {
    const mine = monthShifts.filter((s) => s.staffRef === p.ref);
    const earned = sum(mine, (s) => shiftCost(s, now));
    return { ref: p.ref, active: p.active !== false, hours: Math.round(sum(mine, (s) => shiftHours(s, now)) * 10) / 10, earnedCents: earned, minijobPct: cfg.minijobLimitCents ? Math.round((earned / cfg.minijobLimitCents) * 100) : null };
  });

  // --- Kurse (aktuelles Angebot) ---
  const live = courses.filter((c) => c.published);
  const enrByCourse = new Map(live.map((c) => [c.id, enrollments.filter((e) => e.courseId === c.id)]));
  const cap = sum(live, (c) => c.capacity);
  const participants = sum(live, (c) => enrByCourse.get(c.id).length);
  const utilizationPct = cap > 0 ? (participants / cap) * 100 : null;
  const OPEN = ['open', 'partial', 'failed'];
  const openEnr = enrollments.filter((e) => OPEN.includes(e.paymentStatus));
  const priceOf = new Map(courses.map((c) => [c.id, c.priceCents]));
  const openOwed = sum(openEnr, (e) => Math.max(0, (priceOf.get(e.courseId) || 0) - (e.amountPaidCents || 0)));
  const openPaymentsPct = enrollments.length > 0 ? (openEnr.length / enrollments.length) * 100 : null;
  // Prototyp-Annahme: Kurseinnahme zaehlt im Monat der Anmeldung.
  const courseRevenue = sum(enrollments.filter((e) => inMonth(berlinDate(e.createdAt))), (e) => e.amountPaidCents || 0);
  const courseRows = courses.map((c) => {
    const es = enrollments.filter((e) => e.courseId === c.id);
    return { id: c.id, title: c.title, location: c.location, weekday: c.weekday, startTime: c.startTime, published: c.published, capacity: c.capacity, participants: es.length, utilizationPct: c.capacity ? Math.round((es.length / c.capacity) * 100) : null, open: es.filter((e) => OPEN.includes(e.paymentStatus)).length };
  });

  // --- Gesamt ---
  const fixed = sum(Object.values(cfg.fixedCostsCents), (v) => v || 0);
  const income = barRevenue + ticketRevenue + courseRevenue;
  const costs = personnelCost + fixed;
  const profit = income - costs;

  const kpis = [
    { id: 'profit', label: 'Ergebnis Monat', unit: 'eur', value: profit, hint: `Einnahmen ${eur(income)} − Kosten ${eur(costs)}`, status: fixed === 0 ? 'none' : profit >= 0 ? 'ok' : 'bad' },
    { id: 'ticketRevenue', label: 'Eintritt & Workshops', unit: 'eur', value: ticketRevenue, hint: `${sum(bars, (b) => b.ticketCount)} Tickets`, status: 'none' },
    { id: 'barRevenue', label: 'Getränke-Umsatz', unit: 'eur', value: barRevenue, hint: `${bars.length} Abende${guests ? `, ${guests} Gäste` : ''}`, status: 'none' },
    { id: 'cashDiff', label: 'Kassendifferenz', unit: 'eur', value: cashDiff, hint: `${closed.length} Abrechnungen`, status: cashDiff == null ? 'none' : Math.abs(cashDiff) <= 500 ? 'ok' : Math.abs(cashDiff) <= 2000 ? 'warn' : 'bad' },
    { id: 'missing', label: 'Inventar-Fehlmenge', unit: 'count', value: closed.length ? missingUnits : null, hint: missingUnits ? `≈ ${eur(missingValue)} Umsatz` : 'Bestand passt', status: !closed.length ? 'none' : missingUnits === 0 ? 'ok' : missingUnits <= 3 ? 'warn' : 'bad' },
    { id: 'barPerGuest', label: 'Getränke pro Gast', unit: 'eur', value: barPerGuest, target: t.barPerGuestCents, status: status(barPerGuest, t.barPerGuestCents, 'min') },
    { id: 'barPersonnelPct', label: 'Personalquote Bar', unit: 'pct', value: barPersonnelPct, target: t.barPersonnelPct, status: status(barPersonnelPct, t.barPersonnelPct, 'max') },
    { id: 'personnelCost', label: 'Personalkosten', unit: 'eur', value: personnelCost, hint: `davon Bar ${eur(barPersonnelCost)}`, status: 'none' },
    { id: 'utilizationPct', label: 'Kurs-Auslastung', unit: 'pct', value: utilizationPct, target: t.utilizationPct, status: status(utilizationPct, t.utilizationPct, 'min') },
    { id: 'openPaymentsPct', label: 'Offene Zahlungen', unit: 'pct', value: openPaymentsPct, target: t.openPaymentsPct, hint: `${openEnr.length} offen, ${eur(openOwed)}`, status: status(openPaymentsPct, t.openPaymentsPct, 'max') },
    { id: 'courseRevenue', label: 'Kurseinnahmen', unit: 'eur', value: courseRevenue, status: 'none' },
  ];

  // --- To-dos: was jetzt erledigt werden muss ---
  const todos = [];
  for (const s of shifts.filter((x) => !x.end && shiftHours(x, now) > 12)) {
    todos.push({ level: 'bad', tab: 'personal', text: `Schicht von ${s.staffRef} läuft seit ${Math.round(shiftHours(s, now))} Std. – vermutlich Ende vergessen. Bitte korrigieren.` });
  }
  for (const b of barsessions.filter((x) => !x.closedAt && x.date < today)) {
    todos.push({ level: 'bad', tab: 'bar', text: `Kasse vom ${b.date.split('-').reverse().join('.')} (${LOC_LABEL[b.location]}) wurde nicht abgeschlossen.` });
  }
  for (const b of closed.filter((x) => Math.abs(x.cashDiffCents || 0) > 500)) {
    todos.push({ level: Math.abs(b.cashDiffCents) > 2000 ? 'bad' : 'warn', tab: 'bar', text: `Kassendifferenz ${eur(b.cashDiffCents)} am ${b.date.split('-').reverse().join('.')} (${LOC_LABEL[b.location]}) klären.` });
  }
  const withMissing = closed.filter((x) => x.missingUnits > 0);
  if (withMissing.length > 3) {
    todos.push({ level: 'bad', tab: 'bar', text: `An ${withMissing.length} Abenden fehlt laut Inventar Ware (insgesamt ${missingUnits} Stück). Details unter Abrechnungen.` });
  } else for (const b of withMissing) {
    const top = b.items.filter((i) => i.diff < 0).map((i) => `${-i.diff}× ${i.name}`).slice(0, 3).join(', ');
    todos.push({ level: b.missingUnits > 3 ? 'bad' : 'warn', tab: 'bar', text: `Inventar ${b.date.split('-').reverse().join('.')} (${LOC_LABEL[b.location]}): es fehlen ${top}.` });
  }
  const barDays = new Set(barsessions.map((b) => `${b.date}_${b.location}`));
  const missing = new Set();
  for (const s of shifts.filter((x) => x.kind === 'bar' && x.end)) {
    const d = berlinDate(s.start);
    if (d < today && inMonth(d) && !barDays.has(`${d}_${s.location}`)) missing.add(`${d}_${s.location}`);
  }
  for (const k of [...missing].sort()) {
    const [d, loc] = k.split('_');
    todos.push({ level: 'bad', tab: 'bar', text: `Keine Kasse am ${d.split('-').reverse().join('.')} (${LOC_LABEL[loc]}), obwohl eine Bar-Schicht lief.` });
  }
  if (openEnr.length > 0) todos.push({ level: openPaymentsPct > t.openPaymentsPct ? 'bad' : 'warn', tab: 'kurse', text: `${openEnr.length} offene Zahlungen über ${eur(openOwed)} nachhalten.` });
  for (const p of byStaff.filter((x) => x.active && x.minijobPct >= 85)) {
    todos.push({ level: p.minijobPct >= 100 ? 'bad' : 'warn', tab: 'personal', text: `${p.ref} hat ${p.minijobPct} % der Minijob-Grenze erreicht (${eur(p.earnedCents)} von ${eur(cfg.minijobLimitCents)}). Einsätze diesen Monat planen.` });
  }
  if (fixed === 0) todos.push({ level: 'info', tab: 'ziele', text: 'Fixkosten (Miete usw.) hinterlegen, damit das Ergebnis stimmt.' });

  // --- Verbesserungen: Auffaelligkeiten mit konkretem Hinweis ---
  const insights = [];
  if (barPerGuest != null && status(barPerGuest, t.barPerGuestCents, 'min') !== 'ok') {
    insights.push({ level: 'warn', text: `Getränke-Umsatz pro Gast ${eur(barPerGuest)} liegt unter dem Ziel ${eur(t.barPerGuestCents)}. Ideen: Happy-Hour-Getränk, Kombi Eintritt + Drink, Bar beim Ansagen erwähnen.` });
  }
  // Pro Wochentag: Personalquote und Umsatz pro Gast
  const byWd = new Map();
  for (const b of bars) {
    const w = weekday(b.date); const r = byWd.get(w) || { rev: 0, guests: 0, guestRev: 0, cost: 0 };
    r.rev += b.drinksRevenueCents; if (b.guests > 0) { r.guests += b.guests; r.guestRev += b.drinksRevenueCents; } byWd.set(w, r);
  }
  for (const s of barShifts) {
    const w = weekday(berlinDate(s.start)); const r = byWd.get(w) || { rev: 0, guests: 0, guestRev: 0, cost: 0 };
    r.cost += shiftCost(s, now); byWd.set(w, r);
  }
  const wdRows = [...byWd.entries()].map(([w, r]) => ({ weekday: w, label: WEEKDAYS[w], revenueCents: r.rev, guests: r.guests, personnelPct: r.rev > 0 ? (r.cost / r.rev) * 100 : null, perGuestCents: r.guests > 0 ? r.guestRev / r.guests : null })).sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  for (const r of wdRows.filter((x) => x.personnelPct != null && x.personnelPct > t.barPersonnelPct)) {
    insights.push({ level: status(r.personnelPct, t.barPersonnelPct, 'max'), text: `${r.label}: Personalquote Bar ${pct(r.personnelPct)} (Ziel ${pct(t.barPersonnelPct)}). Besetzung oder Schichtlänge prüfen.` });
  }
  const best = wdRows.filter((x) => x.perGuestCents != null).sort((a, b) => b.perGuestCents - a.perGuestCents)[0];
  if (best && wdRows.length > 1) insights.push({ level: 'info', text: `Stärkster Bar-Abend: ${best.label} mit ${eur(best.perGuestCents)} pro Gast. Was dort gut läuft, auf andere Abende übertragen.` });
  for (const c of courseRows.filter((x) => x.published && x.utilizationPct != null && x.utilizationPct < 50)) {
    insights.push({ level: 'warn', text: `Kurs „${c.title}" (${LOC_LABEL[c.location]}) nur zu ${c.utilizationPct} % gebucht. Gezielt bewerben (Story, WhatsApp-Gruppen) oder Termin überdenken.` });
  }
  if (utilizationPct != null && utilizationPct >= 95) insights.push({ level: 'info', text: `Kurse fast voll (${pct(utilizationPct)}). Zusatztermin oder Warteliste lohnt sich.` });
  if (missingUnits > 0) insights.push({ level: 'warn', text: `Im Monat fehlen ${missingUnits} Artikel laut Inventar (≈ ${eur(missingValue)} Umsatz). Zählung beim Öffnen/Schließen zu zweit machen und Freigetränke immer als „Personal/Gratis" buchen.` });
  if (bars.length === 0 && monthShifts.length === 0) insights.push({ level: 'info', text: 'Für diesen Monat gibt es noch keine Bar- oder Schichtdaten.' });

  // Einkaufsliste: letzter gezaehlter Endbestand vs. Ø-Verbrauch der letzten 4 Abende (x1,5 Puffer)
  const shopping = [];
  const prodById = new Map(products.map((p) => [p.id, p]));
  for (const location of Object.keys(LOC_LABEL)) {
    const recent = barsessions.filter((b) => b.location === location && b.closedAt).sort((a, b) => b.closedAt.localeCompare(a.closedAt)).slice(0, 4)
      .map((b) => computeSettlement(b, salesBySession.get(b.id) || [], products));
    if (!recent.length) continue;
    for (const it of recent[0].items) {
      const p = prodById.get(it.productId);
      if (!p || p.active === false || it.countedEnd == null) continue;
      const avg = recent.reduce((a, r) => a + (r.items.find((x) => x.productId === it.productId)?.sold || 0), 0) / recent.length;
      const need = Math.ceil(avg * 1.5) - it.countedEnd;
      if (avg > 0 && need > 0) shopping.push({ location, productId: p.id, name: p.name, stock: it.countedEnd, avgPerNight: Math.round(avg * 10) / 10, need });
    }
  }
  shopping.sort((a, b) => a.location.localeCompare(b.location) || b.need - a.need);
  for (const location of new Set(shopping.map((x) => x.location))) {
    const n = shopping.filter((x) => x.location === location).length;
    todos.push({ level: 'warn', tab: 'einkauf', text: `Einkauf ${LOC_LABEL[location]}: ${n} Artikel reichen nicht sicher für den nächsten Abend.` });
  }

  const order = { bad: 0, warn: 1, info: 2, ok: 3, none: 4 };
  todos.sort((a, b) => order[a.level] - order[b.level]);
  insights.sort((a, b) => order[a.level] - order[b.level]);

  // Tagesreihe Bar fuer das Diagramm
  const daily = new Map();
  for (const b of bars) { const r = daily.get(b.date) || { date: b.date, revenueCents: 0, drinksCents: 0, ticketCents: 0, guests: 0 }; r.revenueCents += b.revenueCents; r.drinksCents += b.drinksRevenueCents; r.ticketCents += b.ticketRevenueCents; r.guests += b.guests || 0; daily.set(b.date, r); }
  // Gaeste-Mix: Eintritt Uebungsabend vs. Workshop (+Party) vs. Workshop inkl.
  const ticketMix = new Map();
  for (const b of bars) for (const t of b.tickets) { const r = ticketMix.get(t.productId) || { name: t.name, qty: 0, revenueCents: 0 }; r.qty += t.qty; r.revenueCents += t.revenueCents; ticketMix.set(t.productId, r); }
  // Bestseller im Monat
  const top = new Map();
  for (const b of bars) for (const i of b.items) { const r = top.get(i.productId) || { name: i.name, qty: 0, revenueCents: 0 }; r.qty += i.sold; r.revenueCents += i.revenueCents; top.set(i.productId, r); }

  return {
    month,
    settings: cfg,
    kpis,
    todos,
    insights,
    bar: { revenueCents: barRevenue, ticketRevenueCents: ticketRevenue, ticketMix: [...ticketMix.values()].sort((a, b) => b.qty - a.qty), guests, nights: bars.length, cashDiffCents: cashDiff, missingUnits, missingValueCents: missingValue, daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)), byWeekday: wdRows, topProducts: [...top.values()].filter((x) => x.qty > 0).sort((a, b) => b.revenueCents - a.revenueCents), sessions: bars.sort((a, b) => b.date.localeCompare(a.date)) },
    shopping,
    personnel: { totalCents: personnelCost, barCents: barPersonnelCost, byStaff },
    courses: { utilizationPct, participants, capacity: cap, openCount: openEnr.length, openOwedCents: openOwed, rows: courseRows },
    totals: { incomeCents: income, costsCents: costs, fixedCents: fixed, profitCents: profit },
  };
}

module.exports = { computeDashboard, mergeSettings, berlinDate, shiftHours, shiftCost, DEFAULT_SETTINGS };
