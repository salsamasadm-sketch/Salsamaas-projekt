# Salsamás API

Abgesicherte Schnittstelle für salsamas.de (Maxvorstadt) und salsamas-pasing.de (Pasing).
Sie liest und ändert **Kurse, Teilnehmerzahlen und Zahlungsstatus**. Läuft auf Google Cloud Run, Daten liegen in Firestore.

## Endpunkte

| Methode | Pfad | Zugriff | Zweck |
|---|---|---|---|
| GET | `/public/courses?location=pasing` | offen | Veröffentlichte Kurse mit freien Plätzen (für die Webseiten) |
| GET | `/api/v1/courses`, `/courses/:id` | read | Alle Kurse inkl. Teilnehmerzahl |
| POST/PATCH/DELETE | `/api/v1/courses[/:id]` | write | Kurs anlegen, ändern, löschen |
| GET/POST | `/api/v1/courses/:id/enrollments` | read / write | Anmeldungen lesen, hinzufügen |
| PATCH/DELETE | `/api/v1/enrollments/:id` | write | Zahlungsstatus ändern, Anmeldung entfernen |
| GET | `/api/v1/stats` | read | Teilnehmer und Zahlungen je Kurs |

Geschützte Aufrufe: Header `Authorization: Bearer <Schlüssel>`.
Änderungen brauchen das Feld `version` (aus der letzten Abfrage). Hat zwischendurch jemand anderes geändert, kommt `409`, und nichts wird still überschrieben.

## Sicherheit

- Schlüssel nur als SHA-256-Hash gespeichert, konstant-zeitlicher Vergleich, Rollen `read` / `write`
- Brute-Force-Sperre (10 Fehlversuche / 15 Min), allgemeines Limit 120 Anfragen/Min
- Strikte Eingabeprüfung: unbekannte Felder, HTML-Zeichen, falsche Typen und ungültige IDs werden abgelehnt
- CORS nur für die eigenen Domains, Security-Header (HSTS, CSP, nosniff), Body max. 16 KB
- Keine Klarnamen: Teilnehmer nur als neutrale Referenz (z. B. Bsport-ID), das hält den DSGVO-Aufwand klein
- Überbuchung und Doppelanmeldung werden in einer Transaktion verhindert
- Audit-Log (JSON, ohne Schlüssel und Inhalte) landet in Cloud Logging
- Start bricht ab, wenn keine Schlüssel konfiguriert sind; Fehlermeldungen verraten keine Interna
- Container läuft als Nicht-Root-Nutzer

## Einrichtung auf Google Cloud

```bash
npm run gen-key -- website read     # für die Webseiten (nur lesen)
npm run gen-key -- admin write      # für dich (ändern)
```

Die ausgegebenen Einträge kommen kommagetrennt als Secret `API_KEYS` in den Secret Manager. Die Klartext-Schlüssel nirgends ins Repo legen.

```bash
gcloud run deploy salsamas-api --source . --region europe-west3 \
  --set-env-vars STORE=firestore,NODE_ENV=production,ALLOWED_ORIGINS=https://salsamas.de,https://salsamas-pasing.de \
  --set-secrets API_KEYS=salsamas-api-keys:latest,SESSION_SECRET=salsamas-session-secret:latest
```

Das Cloud-Run-Dienstkonto braucht die Rolle „Cloud Datastore User“, Firestore im Native-Modus muss aktiviert sein.

## Cockpit-App (Prototyp) – `/app/`

Handy-Webseite für Team und Chef, läuft im selben Dienst. Auf dem Handy über „Zum Home-Bildschirm“ wie eine App ablegen.

**Team (Bar, Tür, Tanzlehrer, Minijobber)** – Anmeldung mit Kürzel + PIN (6–8 Ziffern)
- Arbeitszeit: Schicht starten/beenden oder „von – bis“ nachtragen (letzte 3 Tage, ohne Überschneidung)
- Kasse: öffnen mit Kassenbestand (Wechselgeld) und Inventar-Anfangsbestand → Buttons für Eintritt, Workshops und Getränke antippen → Bar / Karte / Gratis → Storno möglich
- Eintritt: „Eintritt Übungsabend“, „Workshop + Party“, „Workshop-Teilnehmer inkl.“ (0 €) – jeder Gast wird gezählt, Eintritt hat kein Inventar
- Kasse schließen: Bargeld zählen, Entnahmen, Nachgefülltes, Endbestand → automatische Abrechnung mit Kassen- und Inventardifferenz
- Das Team sieht keine Löhne und keine Monatszahlen

**Chef** – Anmeldung mit dem `write`-API-Schlüssel
- *Heute*: Ampel-Kennzahlen (Ergebnis, Eintritt, Getränke, Kassendifferenz, Inventar, Personalquote, Auslastung, offene Zahlungen), „Was jetzt zu tun ist“, „Was verbessert werden sollte“, Umsatz pro Abend, Gäste-Mix, Bestseller
- *Abrechnungen* jedes Abends, *Einkaufsliste* aus Inventar und Verbrauch (kopierbar für WhatsApp), CSV-Export für Buchhaltung (Kassenabende, Stunden & Löhne)
- *Personal*: Team anlegen (nur Kürzel), Stundenlohn, PIN, Minijob-Grenze mit Warnung ab 85 %, Schichten korrigieren
- *Kurse* (aus der API), *Getränke & Preise*, *Ziele & Kosten* (Zielwerte, Fixkosten je Standort, Minijob-Grenze)

Sicherheit: PINs mit scrypt gehasht, Sperre nach 5 Fehlversuchen pro Kürzel und 10 pro IP, signierte Sitzungen (`SESSION_SECRET`), deaktivierte Personen verlieren sofort den Zugang, Preise kommen immer vom Server, Storno wird markiert statt gelöscht, strenge CSP ohne Fremdskripte.

> **Wichtig – Kassenrecht:** Ein elektronisches Kassensystem braucht in Deutschland eine zertifizierte TSE (KassenSichV) und muss beim Finanzamt gemeldet werden. Dieser Prototyp hat **keine** TSE. Bis das geklärt ist (z. B. Anbindung einer Cloud-TSE oder Freigabe durch den Steuerberater), nur zur internen Kontrolle parallel zur bisherigen Kasse nutzen.

**Ausprobieren mit Beispieldaten:**

```bash
npm run demo
```

Dann `http://localhost:8080/app/` öffnen. Team: `lena`, `marco`, `sofia`, `diego` mit PIN `123456`. Der Chef-Schlüssel steht in der Konsole. `npm run demo -- --reset` setzt die Beispieldaten zurück.

## Lokal testen

```bash
npm install
npm test
API_KEYS=<Eintrag> npm start
```

## Nicht enthalten / nächste Schritte

- Die Webseiten müssen noch an die API angebunden werden (Code der Seiten liegt nicht in diesem Repo).
- Abgleich mit Bsport/Bank ist nicht eingebaut; Zahlungsstatus wird per API gesetzt.
- Firestore-Anbindung ist nicht gegen eine echte Datenbank getestet (nur die Logik per Datei-Speicher).
- Cockpit: keine TSE (siehe oben), kein Offline-Modus (Kasse braucht Internet), Wareneinkauf noch nicht im Ergebnis, Kurseinnahmen zählen im Monat der Anmeldung.

## Betrieb (live seit 05.11.2026)

- Google-Cloud-Projekt `salsamas`, Region `europe-west3` (Frankfurt)
- Cloud Run `salsamas-cockpit` (Dienstkonto `cockpit-run`, nur Firestore + 2 Secrets), max. 3 Instanzen
- Firestore (native, Frankfurt), Sicherheitsregeln `firestore.rules`: kein direkter Zugriff, nur über den App-Server
- Secret Manager: `cockpit-api-keys` (Chef-Schlüssel als SHA-256), `cockpit-session-secret`
- Tägliche Firestore-Sicherung (7 Tage), Budget-Alarm 10 €/Monat
- Nicht in Suchmaschinen: `robots.txt` + `X-Robots-Tag: noindex`

**Automatisch live stellen:** `.github/workflows/deploy.yml` testet jede Änderung und stellt jeden Push auf `main`
live – ohne gespeicherte Schlüssel (Workload Identity Federation). Einmalige Einrichtung durch den Projekt-Inhaber:
`scripts/setup-github-deploy.sh` in der Google Cloud Shell ausführen.

**Alle Geräte abmelden:** neue Version von `cockpit-session-secret` anlegen und neu deployen.
**Neuer Chef-Schlüssel:** `npm run gen-key -- chef write`, Eintrag als neue Version von `cockpit-api-keys`.
