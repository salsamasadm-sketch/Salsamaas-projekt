'use strict';
/** Kategorien ohne Inventar: Eintritt und Workshops (zaehlen als Gaeste). */
const TICKET_CATEGORIES = ['eintritt', 'workshop'];
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
  let ticketRev = 0, ticketCount = 0, courseRev = 0;
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

  const cashExpected = (session.cashStartCents || 0) + cash - (session.cashOutCents || 0);
  const cashCounted = session.cashEndCents ?? null;
  const missingUnits = items.reduce((a, i) => a + (i.diff != null && i.diff < 0 ? -i.diff : 0), 0);
  return {
    sessionId: session.id, date: session.date, location: session.location, status: session.closedAt ? 'closed' : 'open',
    salesCount: count, revenueCents: cash + card, cashSalesCents: cash, cardSalesCents: card,
    drinksRevenueCents: cash + card - ticketRev - courseRev, ticketRevenueCents: ticketRev, ticketCount,
    courseFeeCents: courseRev, courseFees: [...fees.values()].sort((a, b) => b.revenueCents - a.revenueCents),
    tickets: [...tickets.values()].sort((a, b) => b.qty - a.qty),
    cashStartCents: session.cashStartCents || 0, cashOutCents: session.cashOutCents || 0,
    cashExpectedCents: cashExpected, cashCountedCents: cashCounted, cashDiffCents: cashCounted == null ? null : cashCounted - cashExpected,
    items, missingUnits, freeUnits,
    // Warenwert der Fehlmenge zum Verkaufspreis (zeigt, was der Schwund an Umsatz kostet)
    missingValueCents: items.reduce((a, i) => a + (i.diff != null && i.diff < 0 ? -i.diff * (products.find((p) => p.id === i.productId)?.priceCents || 0) : 0), 0),
    // Gaeste: gezaehlte Tickets; sonst die beim Schliessen geschaetzte Zahl
    guests: ticketCount > 0 ? ticketCount : session.guests ?? null,
  };
}

module.exports = { computeSettlement, TICKET_CATEGORIES, COURSE_CATEGORIES };
