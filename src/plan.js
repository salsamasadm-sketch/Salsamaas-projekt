'use strict';
/**
 * Wochenplan (Chef): wer arbeitet wo, wann, was – mit Kosten, Konflikten,
 * Minijob-Prognose und Abgleich Plan gegen gestempelte Zeit. Reine Funktionen.
 */
const { billedHours } = require('./bar');

const KINDS = {
  kurs: 'Unterricht', workshop: 'Workshop', uebungsabend: 'Übungsabend', party: 'Party',
  bar: 'Theke', empfang: 'Tür', kombi: 'Tür + Theke', sonstiges: 'Sonstiges',
};
const EMPLOYMENT = { minijob: 'Minijob', rechnung: 'Auf Rechnung', angestellt: 'Angestellt' };
const LOC_LABEL = { maxvorstadt: 'Maxvorstadt', pasing: 'Pasing' };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WD_LONG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Montag der Woche zu einem Datum */
const mondayOf = (d) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7));
/** ISO-Kalenderwoche */
function isoWeek(d) {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7));
  const w1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((t - w1) / 86_400_000 - 3 + ((w1.getUTCDay() + 6) % 7)) / 7);
}
const eur = (c) => `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dm = (d) => `${d.slice(8)}.${d.slice(5, 7)}.`;
/** Uhrzeit "HH:MM" am Datum in Berliner Zeit -> Date (Winter/Sommer automatisch) */
function berlinTime(date, hhmm) {
  for (const off of ['+01:00', '+02:00']) {
    const t = new Date(`${date}T${hhmm}:00${off}`);
    const back = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
    if (back === hhmm) return t;
  }
  return new Date(`${date}T${hhmm}:00+01:00`);
}
function slotTimes(slot) {
  const a = berlinTime(slot.date, slot.start);
  let b = berlinTime(slot.date, slot.end);
  if (b <= a) b = new Date(b.getTime() + 86_400_000); // bis nach Mitternacht
  return { a, b };
}
const berlinDate = (d) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));

/** Kosten eines Einsatzes: Pauschale (z. B. Gasttrainer) oder Stunden x Stundenlohn */
function slotCost(slot, person) {
  const { a, b } = slotTimes(slot);
  const hours = billedHours(a, b);
  if (slot.feeCents != null) return { hours, costCents: slot.feeCents, basis: 'Pauschale' };
  return { hours, costCents: Math.round(hours * (person?.hourlyRateCents || 0)), basis: person ? `${eur(person.hourlyRateCents)}/Std.` : '–' };
}

function computeWeek({ week, plan = [], staff = [], shifts = [], settings = {}, now = new Date() }) {
  const from = mondayOf(week);
  const to = addDays(from, 6);
  const byRef = new Map(staff.map((p) => [p.ref.toLowerCase(), p]));
  const limit = settings?.minijobLimitCents ?? 60300;
  const nowDate = berlinDate(now);

  const slots = plan.filter((s) => s.date >= from && s.date <= to).map((s) => {
    const person = s.staffRef ? byRef.get(s.staffRef.toLowerCase()) : null;
    const { a, b } = slotTimes(s);
    const c = slotCost(s, person);
    // Plan gegen Ist: passende Stempelzeit derselben Person am selben Tag (Ueberlappung)
    let actual = null;
    if (person && b < now) {
      const sh = shifts.find((x) => x.staffRef === person.ref && !x.helper && x.end && new Date(x.start) < new Date(b.getTime() + 3 * 3_600_000) && new Date(x.end) > new Date(a.getTime() - 3 * 3_600_000));
      actual = sh ? { hours: billedHours(sh.start, sh.end), start: sh.start, end: sh.end } : { missing: true };
    }
    return {
      ...s, kindLabel: KINDS[s.kind] || s.kind, who: person ? person.ref : s.guestName || 'offen',
      employment: person ? person.employment || 'minijob' : s.guestName ? 'rechnung' : null,
      unassigned: !person && !s.guestName,
      hours: c.hours, costCents: c.costCents, basis: c.basis, past: b < now, today: s.date === nowDate,
      startsAt: a.toISOString(), endsAt: b.toISOString(), actual,
    };
  }).sort((x, y) => x.startsAt.localeCompare(y.startsAt));

  // Konflikte: Person doppelt verplant (Ueberschneidung), Einsatz ohne Person, Standortwechsel am selben Abend
  const conflicts = [];
  const byWho = new Map();
  for (const s of slots) { if (s.unassigned) continue; const l = byWho.get(s.who) || []; l.push(s); byWho.set(s.who, l); }
  for (const [who, list] of byWho) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const x = list[i], y = list[j];
      if (x.startsAt < y.endsAt && y.startsAt < x.endsAt) conflicts.push({ level: 'bad', slotIds: [x.id, y.id], text: `${who} ist ${WD_LONG[(new Date(`${x.date}T12:00:00Z`).getUTCDay() + 6) % 7]} doppelt verplant: ${x.kindLabel} ${x.start}–${x.end} (${LOC_LABEL[x.location]}) und ${y.kindLabel} ${y.start}–${y.end} (${LOC_LABEL[y.location]}).` });
      else if (x.date === y.date && x.location !== y.location && Math.abs(new Date(y.startsAt) - new Date(x.endsAt)) < 45 * 60_000) conflicts.push({ level: 'warn', slotIds: [x.id, y.id], text: `${who} muss am ${dm(x.date)} in unter 45 Min. von ${LOC_LABEL[x.location]} nach ${LOC_LABEL[y.location]}.` });
    }
  }
  for (const s of slots.filter((x) => x.unassigned)) conflicts.push({ level: 'warn', slotIds: [s.id], text: `${WD[(new Date(`${s.date}T12:00:00Z`).getUTCDay() + 6) % 7]} ${dm(s.date)} ${s.start}: ${s.title || s.kindLabel} (${LOC_LABEL[s.location]}) hat noch niemanden.` });
  for (const s of slots.filter((x) => x.actual?.missing)) conflicts.push({ level: 'info', slotIds: [s.id], text: `${s.who} war für ${s.kindLabel} am ${dm(s.date)} geplant, hat aber nicht gestempelt.` });

  // Pro Person: geplante Stunden/Kosten der Woche, Minijob-Prognose fuer den Monat
  const people = [];
  for (const [who, list] of byWho) {
    const person = byRef.get(who.toLowerCase());
    const employment = person ? person.employment || 'minijob' : 'rechnung';
    const row = { who, employment, employmentLabel: EMPLOYMENT[employment], guest: !person, slots: list.length, hours: list.reduce((a, s) => a + s.hours, 0), costCents: list.reduce((a, s) => a + s.costCents, 0) };
    if (person && employment === 'minijob') {
      const month = to.slice(0, 7);
      const earned = shifts.filter((x) => x.staffRef === person.ref && !x.helper && x.end && berlinDate(x.start).slice(0, 7) === month).reduce((a, x) => a + (x.fixedCents != null ? x.fixedCents : Math.round(billedHours(x.start, x.end) * (x.rateCents || 0))), 0);
      const plannedOpen = plan.filter((s) => s.staffRef && s.staffRef.toLowerCase() === who.toLowerCase() && s.date.slice(0, 7) === month && s.date >= nowDate)
        .reduce((a, s) => a + slotCost(s, person).costCents, 0);
      row.minijob = { month, earnedCents: earned, plannedCents: plannedOpen, forecastCents: earned + plannedOpen, limitCents: limit, pct: Math.round(((earned + plannedOpen) / limit) * 100) };
      if (row.minijob.pct > 100) conflicts.push({ level: 'bad', slotIds: list.map((s) => s.id), text: `${who}: Mit dem Plan kommt der Monat auf ${eur(row.minijob.forecastCents)} – über der Minijob-Grenze von ${eur(limit)}.` });
      else if (row.minijob.pct >= 90) conflicts.push({ level: 'warn', slotIds: [], text: `${who}: Prognose ${row.minijob.pct} % der Minijob-Grenze in diesem Monat.` });
    }
    people.push(row);
  }
  people.sort((a, b) => b.hours - a.hours);
  const order = { bad: 0, warn: 1, info: 2 };
  conflicts.sort((a, b) => order[a.level] - order[b.level]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(from, i);
    return { date, label: WD[i], long: WD_LONG[i], today: date === nowDate, slots: slots.filter((s) => s.date === date) };
  });

  // Text fuer die WhatsApp-Gruppe
  const lines = [`*Salsamás Wochenplan KW ${isoWeek(from)}* (${dm(from)}–${dm(to)})`];
  for (const d of days) {
    if (!d.slots.length) continue;
    lines.push('', `*${d.long}, ${dm(d.date)}*`);
    for (const s of d.slots) lines.push(`${s.start}–${s.end} · ${s.title || s.kindLabel} · ${LOC_LABEL[s.location]} · ${s.unassigned ? '❗ noch offen' : s.who}`);
  }
  lines.push('', 'Bitte kurz bestätigen 👍 Änderungen an Pablo.');

  return {
    week: from, to, kw: isoWeek(from), days, slots, conflicts, people,
    totals: { slots: slots.length, hours: slots.reduce((a, s) => a + s.hours, 0), costCents: slots.reduce((a, s) => a + s.costCents, 0), workshops: slots.filter((s) => s.kind === 'workshop').length, open: slots.filter((s) => s.unassigned).length },
    whatsappText: lines.join('\n'),
  };
}

/** Rechnungen der Trainer auf Rechnung fuer einen Monat (Betrag aus den gestempelten Zeiten) */
function computeInvoices({ month, staff = [], shifts = [], invoices = [] }) {
  return staff.filter((p) => (p.employment || 'minijob') === 'rechnung').map((p) => {
    const mine = shifts.filter((x) => x.staffRef === p.ref && !x.helper && x.end && berlinDate(x.start).slice(0, 7) === month);
    const hours = mine.reduce((a, x) => a + billedHours(x.start, x.end), 0);
    const amountCents = mine.reduce((a, x) => a + (x.fixedCents != null ? x.fixedCents : Math.round(billedHours(x.start, x.end) * (x.rateCents || 0))), 0);
    const inv = invoices.find((i) => i.id === `${p.id}_${month}`);
    return { id: `${p.id}_${month}`, staffId: p.id, ref: p.ref, month, hours: Math.round(hours * 100) / 100, amountCents, status: inv?.status || 'offen', updatedAt: inv?.updatedAt || null };
  });
}

module.exports = { computeWeek, computeInvoices, mondayOf, addDays, isoWeek, KINDS, EMPLOYMENT };
