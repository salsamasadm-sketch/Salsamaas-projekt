'use strict';
/**
 * Salsamás-Getraenkekarte (Verkaufspreise laut Karte an der Theke)
 * mit Einkaufspreisen netto pro Stueck aus der METRO-Rechnung vom 31.10.2026
 * (nach Mengenrabatt, ohne Pfand). Fehlende Einkaufspreise = null, bitte in der App ergaenzen.
 */
const CATALOG = [
  // Softdrinks
  { name: 'Wasser', priceCents: 350, category: 'softdrinks', costCents: 43, source: 'Adelholzener Classic/Naturell 0,5 l' },
  { name: 'Coca-Cola', priceCents: 400, category: 'softdrinks', costCents: 52, source: 'Coca-Cola 0,33 l Dose' },
  { name: 'Cola-Mix', priceCents: 400, category: 'softdrinks', costCents: null },
  { name: 'Sprite', priceCents: 400, category: 'softdrinks', costCents: null },
  { name: 'Apfelschorle', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Apfelschorle 0,5 l' },
  { name: 'Johannisbeerschorle', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Johannisbeere 0,5 l' },
  { name: 'Red Bull', priceCents: 500, category: 'softdrinks', costCents: 125, source: 'Red Bull 0,25 l Dose' },
  // Alkohol
  { name: 'Helles', priceCents: 450, category: 'bier', costCents: 71, source: 'Augustiner Lagerbier Hell 0,5 l' },
  { name: 'Sekt', priceCents: 500, category: 'wein', costCents: null },
  { name: 'Weißwein', priceCents: 500, category: 'wein', costCents: null },
  { name: 'Rotwein', priceCents: 500, category: 'wein', costCents: null },
  { name: 'Hugo', priceCents: 800, category: 'cocktails', costCents: null },
  { name: 'Aperol Spritz', priceCents: 800, category: 'cocktails', costCents: 210, source: 'Aperol Spritz 0,2 l (3er-Pack 6,29 €)' },
  { name: 'Cuba Libre', priceCents: 800, category: 'longdrinks', costCents: null },
];

module.exports = { CATALOG };
