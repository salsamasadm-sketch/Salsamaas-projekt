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
  --set-secrets API_KEYS=salsamas-api-keys:latest
```

Das Cloud-Run-Dienstkonto braucht die Rolle „Cloud Datastore User“, Firestore im Native-Modus muss aktiviert sein.

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
