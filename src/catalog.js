'use strict';
/**
 * Salsamás-Getraenkekarte (Verkaufspreise laut Karte an der Theke)
 * mit Einkaufspreisen netto pro Stueck/Glas aus den METRO-Rechnungen vom 23.10. und 31.10.2026
 * (nach Mengenrabatt, ohne Pfand). Fehlende Einkaufspreise = null, bitte in der App ergaenzen.
 * plus METRO-App (Sprite Zero, Villa Antinori, Ca' Ernesto Merlot), Stand 05.11.2026.
 * Annahmen pro Glas: Wein 0,2 l, Sekt 0,1 l, Cuba Libre 4 cl Rum + 0,2 l Cola + 1/4 Limette, Hugo = 1 Flasche City Hugo 0,2 l.
 */
const CATALOG = [
  // Softdrinks
  { name: 'Wasser', color: '#5aaee0', priceCents: 350, category: 'softdrinks', costCents: 43, source: 'Adelholzener Classic/Naturell 0,5 l' },
  { name: 'Coca-Cola', color: '#e41e2b', priceCents: 400, category: 'softdrinks', costCents: 52, source: 'Coca-Cola 0,33 l Dose' },
  { name: 'Cola-Mix', color: '#b4561c', priceCents: 400, category: 'softdrinks', costCents: 52, source: 'Annahme: Coca-Cola/Fanta 0,33 l Dose (je 0,52 €)' },
  { name: 'Sprite', color: '#00a651', priceCents: 400, category: 'softdrinks', costCents: 58, source: 'Sprite Zero 0,33 l Dose, METRO-App: 0,58 € ab 24 Stück (0,52 € ab 48)' },
  { name: 'Apfelschorle', color: '#e0a526', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Apfelschorle 0,5 l' },
  { name: 'Johannisbeerschorle', color: '#7b1e4b', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Johannisbeere 0,5 l' },
  { name: 'Red Bull', color: '#1f3f8f', priceCents: 500, category: 'softdrinks', costCents: 125, source: 'Red Bull 0,25 l Dose' },
  // Alkohol
  { name: 'Helles', color: '#f2c230', priceCents: 450, category: 'bier', costCents: 71, source: 'Augustiner Lagerbier Hell 0,5 l' },
  { name: 'Sekt', color: '#e3cf8f', priceCents: 500, category: 'wein', costCents: 56, source: 'Rotkäppchen 0,75 l (4,19 €) ÷ 7,5 Gläser à 0,1 l' },
  { name: 'Weißwein', color: '#d6df8a', priceCents: 500, category: 'wein', costCents: 146, source: 'Villa Antinori Bianco Toscana 0,75 l, Angebot 5,49 € bis 31.12.2026 (sonst 8,49 € = 2,26 €/Glas) ÷ 3,75 Gläser à 0,2 l' },
  { name: 'Rotwein', color: '#7b1e2b', priceCents: 500, category: 'wein', costCents: 101, source: "Ca' Ernesto Merlot 0,75 l, METRO-App 3,79 € ab 6 Flaschen (3,39 € ab 12 = 0,90 €/Glas) ÷ 3,75 Gläser à 0,2 l" },
  { name: 'Hugo', color: '#8cc63f', priceCents: 800, category: 'cocktails', costCents: 60, source: 'City Hugo 0,2 l Flasche' },
  { name: 'Aperol Spritz', color: '#f26b21', priceCents: 800, category: 'cocktails', costCents: 210, source: 'Aperol Spritz 0,2 l (3er-Pack 6,29 €)' },
  { name: 'Cuba Libre', color: '#4a2c1a', priceCents: 800, category: 'longdrinks', costCents: 110, source: 'Havana Club 3 Años 0,7 l (12,99 €) 4 cl = 0,74 € + Cola 1,25 l PET 0,2 l = 0,23 € + 1/4 Limette 0,13 €' },
];

/**
 * Tuer: Eintritt und Workshops (Preise laut Pablo, 05.11.2026). Partnerpreise gelten pro Person
 * (ein Paar = 2x tippen). Eventband 0,06 € nur beim Eintritt zum Uebungsabend.
 */
const TICKETS = [
  { name: 'Eintritt Übungsabend', priceCents: 1000, category: 'eintritt', costCents: 6, source: 'inkl. 1 Eventband (100er-Pack 5,99 €)' },
  { name: 'Workshop-Teilnehmer bleibt (inkl.)', priceCents: 0, category: 'eintritt', costCents: 6, source: 'Workshop-Teilnehmer zum Übungsabend, inkl. 1 Eventband' },
  { name: 'Workshop Einzel', priceCents: 2000, category: 'workshop', costCents: 0 },
  { name: 'Workshop mit Partner (p. P.)', priceCents: 1500, category: 'workshop', costCents: 0, source: 'pro Person – Paar = 2× tippen' },
  { name: '2 Workshops Einzel', priceCents: 3500, category: 'workshop', costCents: 0 },
  { name: '2 Workshops mit Partner (p. P.)', priceCents: 3000, category: 'workshop', costCents: 0, source: 'pro Person – Paar = 2× tippen' },
  // Pass-Plattformen: Check-in gilt als Zahlung (0 € an der Tuer). Auszahlung pro Check-in geschaetzt.
  { name: 'Übungsabend nach Workshop-Check-in', priceCents: 500, category: 'eintritt', costCents: 6, source: 'Aufzahlung, wer per Pass zum Workshop eingecheckt hat' },
  { name: 'Wellpass · Übungsabend', priceCents: 0, category: 'checkin', platform: 'Wellpass', checkinFor: 'abend', payoutCents: 1300, costCents: 6, color: '#0e9aa7', source: 'Check-in = bezahlt · ca. 13 € Auszahlung' },
  { name: 'Wellpass · Workshop', priceCents: 0, category: 'checkin', platform: 'Wellpass', checkinFor: 'workshop', payoutCents: 1300, costCents: 0, color: '#0e9aa7', source: 'Check-in = bezahlt · danach Übungsabend +5 €' },
  { name: 'Urban Sports Club · Übungsabend', priceCents: 0, category: 'checkin', platform: 'Urban Sports Club', checkinFor: 'abend', payoutCents: 1000, costCents: 6, color: '#2341e0', source: 'Check-in = bezahlt · ca. 10 € Auszahlung' },
  { name: 'Urban Sports Club · Workshop', priceCents: 0, category: 'checkin', platform: 'Urban Sports Club', checkinFor: 'workshop', payoutCents: 1000, costCents: 0, color: '#2341e0', source: 'Check-in = bezahlt · danach Übungsabend +5 €' },
  { name: 'Wellhub · Übungsabend', priceCents: 0, category: 'checkin', platform: 'Wellhub', checkinFor: 'abend', payoutCents: 1500, costCents: 6, color: '#e2336b', source: 'Check-in = bezahlt · ca. 15 € Auszahlung' },
  { name: 'Wellhub · Workshop', priceCents: 0, category: 'checkin', platform: 'Wellhub', checkinFor: 'workshop', payoutCents: 1500, costCents: 0, color: '#e2336b', source: 'Check-in = bezahlt · danach Übungsabend +5 €' },
];

/**
 * Kursgebuehren vor Ort (Preise laut salsamas.de / salsamas-pasing.de und Pablo, Stand 11/2026).
 * Mit Partner 10 € guenstiger pro Person; Probestunde 25 €, Privatstunde 100 € pro Person.
 * Preise gelten pro Person und Monat; 10er-Karte 3 Monate gueltig.
 */
const COURSE_FEES = [
  { name: 'Probestunde', priceCents: 2500, category: 'kursgebuehr', costCents: 0, source: 'pro Person' },
  { name: 'Kurs 4 × 75 Min.', priceCents: 8900, category: 'kursgebuehr', costCents: 0, source: 'Beginner/Mittelstufe, Einzelanmeldung' },
  { name: 'Kurs 4 × 75 Min. mit Partner (p. P.)', priceCents: 7900, category: 'kursgebuehr', costCents: 0, source: '10 € günstiger pro Person – Paar = 2× tippen' },
  { name: 'Kurs 4 × 75 Min. Studierende', priceCents: 7900, category: 'kursgebuehr', costCents: 0 },
  { name: 'Kurs 4 × 60 Min.', priceCents: 7900, category: 'kursgebuehr', costCents: 0, source: 'z. B. Fortgeschrittene Pasing' },
  { name: 'Kurs 4 × 60 Min. mit Partner (p. P.)', priceCents: 6900, category: 'kursgebuehr', costCents: 0, source: '10 € günstiger pro Person – Paar = 2× tippen' },
  { name: 'Kurs 4 × 60 Min. Studierende', priceCents: 6900, category: 'kursgebuehr', costCents: 0 },
  { name: 'Kurs 2 × 120 Min.', priceCents: 10000, category: 'kursgebuehr', costCents: 0, source: 'z. B. Mittelstufe 1 Pasing' },
  { name: 'Kurs 2 × 120 Min. mit Partner (p. P.)', priceCents: 9000, category: 'kursgebuehr', costCents: 0, source: '10 € günstiger pro Person – Paar = 2× tippen' },
  { name: '10er-Karte', priceCents: 24900, category: 'kursgebuehr', costCents: 0, source: '3 Monate gültig' },
  { name: '10er-Karte Studierende', priceCents: 21900, category: 'kursgebuehr', costCents: 0, source: '3 Monate gültig' },
  { name: 'Privatstunde', priceCents: 10000, category: 'kursgebuehr', costCents: 0, source: 'mit einem Lehrer, pro Person' },
];

/** Farben fuer Eintritt/Workshops/Kursgebuehren und als Rueckfall nach Namen (Kassen-Buttons) */
const CATEGORY_COLORS = { checkin: '#5b6b7f', eintritt: '#14161b', workshop: '#c2185b', kursgebuehr: '#2b6cb0', softdrinks: '#5aaee0', bier: '#f2c230', wein: '#d6df8a', cocktails: '#f26b21', longdrinks: '#4a2c1a', shots: '#8d6e63', heiss: '#795548', snacks: '#a1887f', sonstiges: '#8a93a3' };
/** Eventbaender (METRO, Tyvek neongelb): 1 Band pro Gast, Annahme 100er-Pack 5,99 € -> 0,06 € */
const WRISTBAND_CENTS = 6;

module.exports = { CATALOG, TICKETS, COURSE_FEES, CATEGORY_COLORS, WRISTBAND_CENTS };
