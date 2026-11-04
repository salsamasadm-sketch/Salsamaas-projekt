'use strict';
// Erzeugt einen neuen API-Schluessel. Der Klartext wird nur EINMAL angezeigt.
const crypto = require('node:crypto');
const [name = 'website', role = 'read'] = process.argv.slice(2);
if (!/^[a-z0-9-]{1,32}$/.test(name) || !['read', 'write'].includes(role)) {
  console.error('Aufruf: npm run gen-key -- <name> <read|write>');
  process.exit(1);
}
const key = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(key).digest('hex');
console.log(`Schluessel (sicher aufbewahren, wird nicht gespeichert):\n  ${key}\n`);
console.log(`Eintrag fuer API_KEYS (Secret Manager), mit Komma anhaengen:\n  ${name}:${role}:${hash}`);
