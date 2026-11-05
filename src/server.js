'use strict';
const path = require('node:path');
const { createApp } = require('./app');
const crypto = require('node:crypto');
const { parseKeys } = require('./auth');
const { makeSessions } = require('./session');

const keys = parseKeys(process.env.API_KEYS);
if (keys.length === 0) { console.error('API_KEYS fehlt - Start abgebrochen (kein offener Zugang).'); process.exit(1); }

let store;
if (process.env.STORE === 'firestore') store = new (require('./store/firestore').FirestoreStore)();
else {
  if (process.env.NODE_ENV === 'production') { console.error('In Produktion STORE=firestore setzen (Dateisystem ist fluechtig).'); process.exit(1); }
  store = new (require('./store/memory').FileStore)(path.join(__dirname, '..', 'data', 'db.json'));
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
let secret = process.env.SESSION_SECRET;
if (!secret) {
  if (process.env.NODE_ENV === 'production') { console.error('SESSION_SECRET fehlt - Start abgebrochen.'); process.exit(1); }
  secret = crypto.randomBytes(32).toString('hex');
  console.warn('SESSION_SECRET nicht gesetzt: zufaelliger Wert, Anmeldungen gelten nur bis zum Neustart.');
}
const app = createApp({ store, keys, allowedOrigins, sessions: makeSessions(secret) });
const server = app.listen(Number(process.env.PORT) || 8080, () => console.log('Salsamas-API laeuft'));
process.on('SIGTERM', () => server.close());
