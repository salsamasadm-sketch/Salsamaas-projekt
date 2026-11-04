'use strict';
const crypto = require('node:crypto');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

/**
 * API_KEYS Format (Umgebungsvariable / Secret Manager):
 *   name:rolle:sha256hex[,name:rolle:sha256hex...]
 * Rollen: read (nur lesen), write (lesen + aendern).
 * Es werden nur Hashes gespeichert, nie die Schluessel selbst.
 */
function parseKeys(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, role, hash] = entry.split(':');
      if (!name || !['read', 'write'].includes(role) || !/^[0-9a-f]{64}$/i.test(hash || '')) {
        throw new Error(`API_KEYS: ungueltiger Eintrag "${name || '?'}"`);
      }
      return { name, role, hash: Buffer.from(hash, 'hex') };
    });
}

function makeAuth(keys) {
  const authenticate = (req, res, next) => {
    const m = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.get('authorization') || '');
    if (m) {
      const given = sha256(m[1]);
      // Alle Schluessel konstant-zeitlich pruefen, kein fruehes Abbrechen.
      let found = null;
      for (const k of keys) if (crypto.timingSafeEqual(given, k.hash)) found = k;
      if (found) {
        req.principal = { name: found.name, role: found.role };
        return next();
      }
    }
    req.log?.('auth_failed');
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'unauthorized' });
  };
  const requireRole = (role) => (req, res, next) => {
    if (role === 'write' && req.principal.role !== 'write') {
      req.log?.('forbidden');
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
  return { authenticate, requireRole };
}

module.exports = { parseKeys, makeAuth, sha256 };
