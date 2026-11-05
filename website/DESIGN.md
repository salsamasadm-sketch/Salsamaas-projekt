# Salsamás Design-System „Noche“

Gilt für `website/index.html`. Alle Werte stehen als CSS-Variablen im `<style>` (Blöcke „Design v2“ und „Runde 4“). Seiten verwenden die Namen, keine festen Werte.

- **Für wen:** Erwachsene in München, die mit Salsa, Bachata oder Kizomba anfangen oder weitertanzen wollen.
- **Wirkung:** hochwertig, warm, abendlich. Nicht verspielt, nicht kitschig.
- **Hauptaufgabe:** Studio wählen und einen Kurs buchen.

> Die Richtung beruht auf Logo, Standortfarben und den Regeln des web-design-system-Skills, nicht auf Vergleichsseiten aus UXKIN (der Dienst war in dieser Sitzung nicht erreichbar).

## Farbe

| Token | Wert | Rolle |
|---|---|---|
| `--noche` | `#1E1420` | Haupttext, dunkle Flächen (Hero, Footer, Hauptkarten) |
| `--niebla` | `#F7F2F4` | Seitenhintergrund |
| `--surface` | `#FFFFFF` | Karten und Panels |
| `--bg-alt` | `#EFE6EA` | abgesetzte Abschnitte |
| `--humo` | `#6B5F68` | Nebentext (5,5:1 auf Hintergrund) |
| `--line` | `#E6DCE1` | Trennlinien |
| `--oro` / `--accent` | `#F5A300` | Primär Maxvorstadt: Buttons mit dunkler Schrift (8,6:1), Akzent auf Dunkel |
| `--oro-text` | `#9A5B00` | Gold als Schrift auf Hell (5,4:1). Reines Gold nie als Schrift auf Hell (2,1:1) |
| `--vino` | `#7B2334` | Primär Pasing: Buttons mit weißer Schrift (9,9:1), Schrift auf Hell |
| `--accent-on-dark` | Gold / `#EE8FA3` | Akzent auf dunklem Grund je Standort (≥ 7,7:1) |

Je Standort wird nur `--accent*` getauscht (`body.theme-pasing`). Kein Dark Mode: Die Seite hat bewusst dunkle und helle Zonen.

## Typografie

- **Bodoni Moda** (variabel, aufrecht und kursiv) für H1/H2, Preise, Jahreszahlen und Studio-Namen; kursiv für die Takt-Wörter im Hero (wie ein Tanzplakat).
- **Geist** (variabel) für Text, Navigation, Buttons und kleine Überschriften (H3, Team-Namen).
- Beide Schriften sind in der Datei eingebettet. Keine Aufrufe an Google-Server.

| Token | Größe | Einsatz |
|---|---|---|
| `--fs-xs` | 0,82rem | Meta, Team-Rollen |
| `--fs-sm` | 0,9rem | Labels, Navigation |
| `--fs-base` | 1rem (17px) | Fließtext, Zeilenhöhe 1,6 |
| `--fs-lg` | 1,25rem | Einleitung im Hero |
| `--fs-xl` | 1,6rem | Karten-Titel |
| `--fs-2xl` | 2–3,2rem | Abschnitts-Überschriften |
| `--fs-display` | 3,6–10,5rem | nur die Takt-Wörter im Hero |

Satzschreibung, keine Versalien-Labels, keine einzeln hervorgehobenen Wörter in Überschriften, Zeilen höchstens ca. 60–70 Zeichen.

## Abstände

8er-Raster: `--sp-1` 8 · `--sp-2` 16 · `--sp-3` 24 · `--sp-4` 32 · `--sp-6` 48 · `--sp-8` 64 · `--sp-12` 96 (zwischen Abschnitten). Inhaltsbreite 1180px.

## Form und Tiefe

- Radien: `--r-sm` 12px (Buttons, Pillen), `--r-md` 16px (kleine Karten), `--r-lg` 26px (große Karten, Panels).
- Zwei Schatten, violett getönt: `--shadow-rest` (Karten in Ruhe) und `--shadow-lift` (Studio-Karten, Paar-Paket, Quiz, Buchung).

## Komponenten

- **Buttons:** Primär in Akzentfarbe, beim Hovern 14 % dunkler. Sekundär weiß mit Linie, beim Hovern Nachtviolett. Fokus mit 3px-Rahmen. Kein „→“ im Text.
- **Navigation:** ohne eigenen Balken direkt auf dem Dunkel, helles Logo; beim Scrollen dunkles Glas. Aktive Seite mit Akzent-Unterstrich.
- **Seitenanfang:** jede Unterseite beginnt mit einem dunklen Intro-Band und ihrer H1.
- **Handy-Leiste unten:** dunkel, „Anrufen“ und „Jetzt buchen“.
- **Studio-Karte:** weiß, `--shadow-lift`, 6px-Farbkante (Gold oder Weinrot).
- **Kursangebot:** zweispaltige Liste mit Trennlinien, keine Kachelwand.
- **Hauptkarte:** dunkle Karte für das empfohlene Angebot.
- **Footer:** Nachtviolett, Logo in Weiß.

## Bewegung

Nur ein inszenierter Moment: Takt-Wörter im Hero (1-2-3 / 5-6-7), nach sechs Takten Stillstand. Sonst nur Reaktion auf Interaktion. Bei „Bewegung reduzieren“ alles statisch.

## Bilder und Icons

- Fotos: echte Aufnahmen aus Kursen und von Partys, warm und abendlich, mit Bewegung. Keine Stockfotos, keine Fremdgesichter. Bis dahin typografisch, Team mit Initialen.
- Icons: schlichte Linien-Icons (1,6px), keine Emojis.
