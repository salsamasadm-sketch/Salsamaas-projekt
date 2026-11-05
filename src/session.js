'use strict';
const crypto = require('node:crypto');

/** PIN-Hash mit scrypt (Salt pro Person). Format: scrypt$salt$hash (hex). */
function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPin(pin, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  // Auch bei unbekanntem Kuerzel gleich viel Rechenzeit verbrauchen (kein Rueckschluss auf vorhandene Kuerzel).
  const salt = Buffer.from(alg === 'scrypt' && saltHex ? saltHex : '00'.repeat(16), 'hex');
  const expected = Buffer.from(alg === 'scrypt' && hashHex ? hashHex : '00'.repeat(32), 'hex');
  const given = crypto.scryptSync(String(pin), salt, 32);
  return alg === 'scrypt' && expected.length === 32 && crypto.timingSafeEqual(given, expected);
}

/** Signierte, zeitlich begrenzte Sitzungs-Token (HMAC-SHA256), ohne Datenbank. */
function makeSessions(secret) {
  if (!secret || String(secret).length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen haben');
  const sign = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return {
    issue(payload, ttlSeconds) {
      const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
      return `${body}.${sign(body)}`;
    },
    verify(token) {
      const [body, sig] = String(token || '').split('.');
      if (!body || !sig) return null;
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
      try {
        const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        return p.exp > Math.floor(Date.now() / 1000) ? p : null;
      } catch { return null; }
    },
  };
}

module.exports = { hashPin, verifyPin, makeSessions };
