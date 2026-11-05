# Salsamás Webseite (überarbeitete Fassung)

`index.html` ist eine komplette Seite in einer Datei mit sieben Unterseiten, umgeschaltet per JavaScript. Grundlage ist `salsamas-webseite_36.html` aus dem Obsidian-Ordner.

## Was geändert wurde
- **Hero:** Das fehlende Bild `hero-placeholder.jpg` (bisher ein schwarzer Block) ist ersetzt durch animierte Wellen. Sie färben sich je nach Standort (Gold für Maxvorstadt, Weinrot für Pasing).
- **Fremdfotos entfernt:** Die Bilder von randomuser.me (Hero, Aktuelles, Team) sind raus. Das Team erscheint jetzt mit Initialen, bis echte Fotos da sind.
- **Aktuelles ohne „Platzhalter“:** Inhalte stehen im Script unter `const NEWS = {...}`. Solange dort nichts eingetragen ist, bleibt der Bereich unsichtbar.
- **Tanzstil-Finder** auf der Kurse-Seite: 3 Fragen führen zu einer Empfehlung, und der passende Stil wird im Kursangebot markiert.
- **Navigation:** echte Links (`<a href="/kurse">`), was gut für Google ist. „Standorte“ ist jetzt im Menü. Der Login-Platzhalter ohne Funktion ist entfernt.
- **Handy:** Das Menü überdeckt das Logo nicht mehr. Unten gibt es eine feste Leiste „Anrufen / Jetzt buchen“.
- **Layout-Fehler:** Das „Kursangebot“ lag außerhalb des Seitenrahmens und war randlos. Behoben.
- **Recht und SEO:** Das Impressum nennt jetzt § 5 DDG statt TMG, das seit 2024 nicht mehr gilt. E-Mail-Adressen sind klickbar. Postleitzahlen stehen in den strukturierten Daten. Im Footer sind Instagram und E-Mail verlinkt.
- **Barrierefreiheit:** Skip-Link, sichtbarer Tastatur-Fokus, `aria`-Attribute und reduzierte Animation, wenn das im System so eingestellt ist.

## Design v2 „Noche“
- Schriften: **Bricolage Grotesque** für Überschriften und **Manrope** für Text, beide direkt in der Datei. Google Fonts wird nicht mehr geladen.
- Farben: Nachtviolett `#1E1420`, Gold `#F5A300`, Weinrot `#7B2334`, Rosé-Weiß `#F7F2F4`. Die Schatten sind violett getönt und haben drei Stufen.
- Hero: Salsa, Bachata und Kizomba erscheinen im Salsa-Takt 1-2-3 / 5-6-7. Nach sechs Takten bleiben sie stehen. Ist im System „Bewegung reduzieren“ eingestellt, bleiben sie von Anfang an still.
- Schwebende Navigation, Studio-Karten mit Farbkante, Kursangebot als ruhige Liste, das Paar-Paket als dunkle Hauptkarte, Team-Karten, dunkler Footer.

## Noch offen (braucht Entscheidung oder Material)
- **Datenschutzerklärung fehlt.** Sie ist Pflicht und muss Google Fonts, das bSport-Widget und den Chat abdecken.
- Die **Bewertungen** in den strukturierten Daten (5.0/36, 4.8/38) sind fest eingetragen. Sie sollten regelmäßig geprüft werden.
- `og-image.jpg` für die Social-Vorschau muss beim Hosting vorhanden sein.
- **Pasing-Adresse** auf der Seite: „an den Pasing Arcaden“ ohne Straße. Im Impressum steht „Am Schützeneck 3“.
- Unterseiten wie `/kurse` brauchen beim Hosting eine Weiterleitung auf `index.html`.
