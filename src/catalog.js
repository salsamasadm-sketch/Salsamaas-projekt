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

/** Farben fuer Eintritt/Workshops/Kursgebuehren und als Rueckfall nach Namen (Kassen-Buttons) */
const CATEGORY_COLORS = { eintritt: '#14161b', workshop: '#c2185b', kursgebuehr: '#2b6cb0', softdrinks: '#5aaee0', bier: '#f2c230', wein: '#d6df8a', cocktails: '#f26b21', longdrinks: '#4a2c1a', shots: '#8d6e63', heiss: '#795548', snacks: '#a1887f', sonstiges: '#8a93a3' };
/** Eventbaender (METRO, Tyvek neongelb): 1 Band pro Gast, Annahme 100er-Pack 5,99 € -> 0,06 € */
const WRISTBAND_CENTS = 6;

module.exports = { CATALOG, CATEGORY_COLORS, WRISTBAND_CENTS };
