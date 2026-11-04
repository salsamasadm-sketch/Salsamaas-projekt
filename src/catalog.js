'use strict';
/**
 * Salsamás-Getraenkekarte (Verkaufspreise laut Karte an der Theke)
 * mit Einkaufspreisen netto pro Stueck/Glas aus den METRO-Rechnungen vom 23.10. und 31.10.2026
 * (nach Mengenrabatt, ohne Pfand). Fehlende Einkaufspreise = null, bitte in der App ergaenzen.
 * Annahmen pro Glas: Sekt 0,1 l, Cuba Libre 4 cl Rum + 0,2 l Cola + 1/4 Limette, Hugo = 1 Flasche City Hugo 0,2 l.
 */
const CATALOG = [
  // Softdrinks
  { name: 'Wasser', priceCents: 350, category: 'softdrinks', costCents: 43, source: 'Adelholzener Classic/Naturell 0,5 l' },
  { name: 'Coca-Cola', priceCents: 400, category: 'softdrinks', costCents: 52, source: 'Coca-Cola 0,33 l Dose' },
  { name: 'Cola-Mix', priceCents: 400, category: 'softdrinks', costCents: 52, source: 'Annahme: Coca-Cola/Fanta 0,33 l Dose (je 0,52 €)' },
  { name: 'Sprite', priceCents: 400, category: 'softdrinks', costCents: null },
  { name: 'Apfelschorle', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Apfelschorle 0,5 l' },
  { name: 'Johannisbeerschorle', priceCents: 400, category: 'softdrinks', costCents: 54, source: 'Adelholzener Johannisbeere 0,5 l' },
  { name: 'Red Bull', priceCents: 500, category: 'softdrinks', costCents: 125, source: 'Red Bull 0,25 l Dose' },
  // Alkohol
  { name: 'Helles', priceCents: 450, category: 'bier', costCents: 71, source: 'Augustiner Lagerbier Hell 0,5 l' },
  { name: 'Sekt', priceCents: 500, category: 'wein', costCents: 56, source: 'Rotkäppchen 0,75 l (4,19 €) ÷ 7,5 Gläser à 0,1 l' },
  { name: 'Weißwein', priceCents: 500, category: 'wein', costCents: null },
  { name: 'Rotwein', priceCents: 500, category: 'wein', costCents: null },
  { name: 'Hugo', priceCents: 800, category: 'cocktails', costCents: 60, source: 'City Hugo 0,2 l Flasche' },
  { name: 'Aperol Spritz', priceCents: 800, category: 'cocktails', costCents: 210, source: 'Aperol Spritz 0,2 l (3er-Pack 6,29 €)' },
  { name: 'Cuba Libre', priceCents: 800, category: 'longdrinks', costCents: 110, source: 'Havana Club 3 Años 0,7 l (12,99 €) 4 cl = 0,74 € + Cola 1,25 l PET 0,2 l = 0,23 € + 1/4 Limette 0,13 €' },
];

module.exports = { CATALOG };
