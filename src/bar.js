'use strict';
/** Arbeitszeit minutengenau (ohne Aufrunden), z. B. 2:05 Std. = 2,083 Std. */
const billedHours = (start, end) => Math.round(Math.max(0, new Date(end) - new Date(start)) / 60_000) / 60;
const round2 = (x) => Math.round(x * 100) / 100;

/**
 * Aushilfen (nicht registriert) beim Kassenabschluss: Stunden minutengenau, Lohn berechnen.
 * payout: 'bar' = aus dieser Kasse ausgezahlt (mindert das Kassensoll), 'ueberweisung' = wird ueberwiesen (Minijob).
 */
function buildHelpers(session, input = [], newId) {
  return input.map((x) => {
    const hours = billedHours(x.start, x.end);
    return { id: newId(), name: x.name, start: new Date(x.start).toISOString(), end: new Date(x.end).toISOString(), hours: round2(hours), rateCents: x.rateCents, payCents: Math.round(hours * x.rateCents), payout: x.payout };
  });
}
/** Aus einer Aushilfe wird eine Schicht (damit sie in Personalkosten und Export auftaucht). */
const helperShift = (session, hl) => ({ id: hl.id, staffRef: hl.name, helper: true, kind: session.station === 'tuer' ? 'empfang' : session.station === 'kombi' ? 'kombi' : 'bar', location: session.location, start: hl.start, end: hl.end, rateCents: hl.rateCents, payout: hl.payout, paid: hl.payout === 'bar', sessionId: session.id, createdBy: 'kasse' });

/** Kategorien ohne Inventar: Eintritt und Workshops (zaehlen als Gaeste). */
const TICKET_CATEGORIES = ['eintritt', 'workshop', 'checkin'];
/** Kursgebuehren vor Ort: kein Inventar, keine Gaeste, zaehlen zu den Kurseinnahmen. */
const COURSE_CATEGORIES = ['kursgebuehr'];
/**
 * Kassenabrechnung eines Bar-Abends (reine Funktion).
 *
 * Kasse:    Soll = Anfangsbestand + Barverkäufe − Entnahmen;  Differenz = gezählt − Soll
 * Inventar: Soll = Anfang + Nachgefüllt − Verkauft;            Differenz = gezählt − Soll
 * Negative Differenz = es fehlt etwas (Geld bzw. Ware).
 * Zahlart "gratis" (Personal-/Freigetränk) zählt fürs Inventar, aber nicht als Umsatz.
 * Eintritt/Workshop: kein Inventar, getrennter Umsatz, jedes Ticket = 1 Gast (auch 0-€-Tickets "Workshop inkl.").
 */
function computeSettlement(session, sales, products = []) {
  const name = new Map(products.map((p) => [p.id, p.name]));
  const isTicket = new Set(products.filter((p) => TICKET_CATEGORIES.includes(p.category)).map((p) => p.id));
  const isCourse = new Set(products.filter((p) => COURSE_CATEGORIES.includes(p.category)).map((p) => p.id));
  const tickets = new Map();
  const fees = new Map();
  // Gast zum Uebungsabend: Eintritt (auch 0-€/Aufzahlung) oder Pass-Check-in fuer den Uebungsabend
  const prodById = new Map(products.map((p) => [p.id, p]));
  const isEntry = new Set(products.filter((p) => p.category === 'eintritt' || (p.category === 'checkin' && p.checkinFor !== 'workshop')).map((p) => p.id));
  const platforms = new Map();
  let platformRev = 0, platformCount = 0;
  let ticketRev = 0, ticketCount = 0, entryCount = 0, courseRev = 0;
  const sold = new Map(); // productId -> { qty, revenueCents }
  let cash = 0, card = 0, count = 0, freeUnits = 0;
  for (const s of sales) {
    count += 1;
    for (const it of s.items) {
      const r = sold.get(it.productId) || { qty: 0, revenueCents: 0 };
      const value = s.payment === 'gratis' ? 0 : it.qty * it.priceCents;
      if (isCourse.has(it.productId)) {
        const f = fees.get(it.productId) || { productId: it.productId, name: name.get(it.productId) || it.productId, qty: 0, revenueCents: 0, refs: [] };
        f.qty += it.qty; f.revenueCents += value; if (s.note) f.refs.push(s.note); fees.set(it.productId, f);
        courseRev += value;
        if (s.payment === 'karte') card += value; else if (s.payment !== 'gratis') cash += value;
        continue;
      }
      if (isTicket.has(it.productId)) {
        const t = tickets.get(it.productId) || { productId: it.productId, name: name.get(it.productId) || it.productId, qty: 0, revenueCents: 0 };
        t.qty += it.qty; t.revenueCents += value; tickets.set(it.productId, t);
        ticketCount += it.qty; ticketRev += value;
        if (isEntry.has(it.productId)) entryCount += it.qty;
        const pr = prodById.get(it.productId);
        if (pr?.category === 'checkin') {
          // Check-in = bezahlt ueber die Plattform; erwartete Auszahlung zaehlt zum Umsatz, nicht zur Kasse
          const k = pr.platform || pr.name;
          const pl = platforms.get(k) || { platform: k, checkins: 0, abend: 0, workshop: 0, expectedCents: 0, payoutMissing: false };
          pl.checkins += it.qty; pl[pr.checkinFor === 'workshop' ? 'workshop' : 'abend'] += it.qty;
          if (pr.payoutCents == null) pl.payoutMissing = true; else pl.expectedCents += it.qty * pr.payoutCents;
          platforms.set(k, pl); platformCount += it.qty; platformRev += it.qty * (pr.payoutCents ?? 0);
        }
        if (s.payment === 'karte') card += value; else if (s.payment !== 'gratis') cash += value;
        continue;
      }
      r.qty += it.qty; r.revenueCents += value; sold.set(it.productId, r);
      if (s.payment === 'gratis') freeUnits += it.qty;
      else if (s.payment === 'karte') card += value; else cash += value;
    }
  }
  const start = session.stockStart || {};
  const end = session.stockEnd || null;
  const restock = session.restock || {};
  const ids = new Set([...Object.keys(start), ...sold.keys(), ...(end ? Object.keys(end) : [])].filter((id) => !isTicket.has(id) && !isCourse.has(id)));
  const items = [...ids].map((id) => {
    const qtySold = sold.get(id)?.qty || 0;
    const expectedEnd = (start[id] ?? 0) + (restock[id] || 0) - qtySold;
    const countedEnd = end ? end[id] ?? null : null;
    return {
      productId: id, name: name.get(id) || id,
      start: start[id] ?? null, restock: restock[id] || 0, sold: qtySold, revenueCents: sold.get(id)?.revenueCents || 0,
      expectedEnd, countedEnd, diff: countedEnd == null ? null : countedEnd - expectedEnd,
    };
  }).sort((a, b) => b.revenueCents - a.revenueCents || a.name.localeCompare(b.name));

  const helpers = session.helpers || [];
  const helperCash = helpers.filter((x) => x.payout === 'bar').reduce((a, x) => a + x.payCents, 0);
  // Wareneinsatz zum Einkaufspreis (netto): verkauft + gratis, dazu Fehlmenge separat
  const costOf = new Map(products.map((p) => [p.id, p.costCents]));
  const cogs = items.reduce((a, i) => a + (costOf.get(i.productId) ?? 0) * i.sold, 0);
  const missingCogs = items.reduce((a, i) => a + (i.diff != null && i.diff < 0 ? -i.diff * (costOf.get(i.productId) ?? 0) : 0), 0);
  const noCostItems = items.filter((i) => i.sold > 0 && costOf.get(i.productId) == null).map((i) => i.name);
  const cashExpected = (session.cashStartCents || 0) + cash - (session.cashOutCents || 0) - helperCash;
  const cashCounted = session.cashEndCents ?? null;
  const missingUnits = items.reduce((a, i) => a + (i.diff != null && i.diff < 0 ? -i.diff : 0), 0);
  return {
    sessionId: session.id, date: session.date, location: session.location, station: stationOf(session), status: session.closedAt ? 'closed' : 'open',
    salesCount: count, revenueCents: cash + card, cashSalesCents: cash, cardSalesCents: card,
    drinksRevenueCents: cash + card - ticketRev - courseRev, ticketRevenueCents: ticketRev, ticketCount, ticketCostCents: [...tickets.values()].reduce((a, t) => a + t.qty * (costOf.get(t.productId) ?? 0), 0),
    courseFeeCents: courseRev, courseFees: [...fees.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    tickets: [...tickets.values()].sort((a, b) => b.qty - a.qty),
    cashStartCents: session.cashStartCents || 0, cashOutCents: session.cashOutCents || 0, helpers, helperCashCents: helperCash,
    cashExpectedCents: cashExpected, cashCountedCents: cashCounted, cashDiffCents: cashCounted == null ? null : cashCounted - cashExpected,
    items, missingUnits, freeUnits, cogsCents: cogs, missingCogsCents: missingCogs, noCostItems,
    // Warenwert der Fehlmenge zum Verkaufspreis (zeigt, was der Schwund an Umsatz kostet)
    missingValueCents: items.reduce((a, i) => a + (i.diff != null && i.diff < 0 ? -i.diff * (products.find((p) => p.id === i.productId)?.priceCents || 0) : 0), 0),
    // Gaeste: gezaehlte Tickets; sonst die beim Schliessen geschaetzte Zahl
    // Gaeste = Eintritte zum Uebungsabend (Workshop-Tickets zaehlen nicht doppelt)
    guests: entryCount > 0 ? entryCount : ticketCount > 0 ? null : session.guests ?? null,
    workshopCount: ticketCount - entryCount,
    platformCheckins: platformCount, platformRevenueCents: platformRev, platforms: [...platforms.values()],
  };
}

/**
 * Kassenplaetze: Tuer (Eingang) kassiert nur Eintritt und Workshops, ohne Inventar.
 * Theke (Bar) verkauft Getraenke und Kursgebuehren, mit Inventar.
 */
const STATIONS = ['tuer', 'theke', 'kombi'];
const stationOf = (session) => (STATIONS.includes(session.station) ? session.station : 'theke');
/** Kombi = eine Person macht Tuer und Theke: alles erlaubt, mit Inventar. */
const allowedAtStation = (station, category) => (station === 'kombi' ? true : station === 'tuer' ? TICKET_CATEGORIES.includes(category) : !TICKET_CATEGORIES.includes(category));
/** Kassenplatz aus der Taetigkeit der Schicht */
const stationForKind = (kind) => (kind === 'empfang' ? 'tuer' : kind === 'kombi' ? 'kombi' : 'theke');

module.exports = { computeSettlement, billedHours, buildHelpers, helperShift, TICKET_CATEGORIES, COURSE_CATEGORIES, STATIONS, stationOf, allowedAtStation, stationForKind };
