'use strict';
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const S = require('./schemas');
const { makeAuth } = require('./auth');

function createApp({ store, keys, allowedOrigins = [], logger = (l) => console.log(JSON.stringify(l)) }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Cloud Run: ein Proxy davor -> echte Client-IP fuer Rate-Limits
  app.use(helmet({ hsts: { maxAge: 63072000, includeSubDomains: true }, contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } }));

  // CORS nur fuer die eigenen Webseiten (Allowlist), nie "*".
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && allowedOrigins.includes(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        Vary: 'Origin',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        'Access-Control-Max-Age': '600',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Audit-Log: wer hat wann was getan (ohne Request-Bodies und ohne Schluessel).
  app.use((req, res, next) => {
    const t0 = Date.now();
    req.log = (event) => logger({ ts: new Date().toISOString(), event, ip: req.ip, method: req.method, path: req.path });
    res.on('finish', () => {
      if (req.path === '/health') return;
      logger({ ts: new Date().toISOString(), event: 'request', principal: req.principal?.name, ip: req.ip, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t0 });
    });
    next();
  });

  app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
  // Brute-Force-Schutz: nur fehlgeschlagene Anmeldungen zaehlen, 10 pro 15 Min pro IP.
  const authFailLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false, message: { error: 'too_many_requests' } });

  app.use(express.json({ limit: '16kb', type: 'application/json' }));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const parse = (schema, data, res) => {
    const r = schema.safeParse(data);
    if (!r.success) { res.status(400).json({ error: 'validation_failed', details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) }); return null; }
    return r.data;
  };
  const validId = (req, res, next) => (S.id.safeParse(req.params.id).success ? next() : res.status(400).json({ error: 'invalid_id' }));
  const sendResult = (res, r) => {
    if (r.status === 'notfound') return res.status(404).json({ error: 'not_found' });
    if (r.status === 'conflict') return res.status(409).json({ error: 'version_conflict', current: r.current });
    if (r.status === 'duplicate') return res.status(409).json({ error: 'already_enrolled' });
    if (r.status === 'full') return res.status(409).json({ error: 'course_full' });
    return null;
  };

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // --- Oeffentlich (ohne Schluessel): nur veroeffentlichte Kurse, keine internen Daten ---
  app.get('/public/courses', wrap(async (req, res) => {
    const location = S.LOCATIONS.includes(req.query.location) ? req.query.location : undefined;
    const courses = await store.listCourses({ location, publishedOnly: true });
    const out = await Promise.all(courses.map(async (c) => {
      const n = await store.countEnrollments(c.id);
      const { id, title, titleEn, location, style, level, weekday, startTime, durationMin, startDate, priceCents, capacity } = c;
      return { id, title, titleEn, location, style, level, weekday, startTime, durationMin, startDate, priceCents, spotsLeft: Math.max(0, capacity - n) };
    }));
    res.set('Cache-Control', 'public, max-age=60').json(out);
  }));

  // --- Geschuetzt ---
  const { authenticate, requireRole } = makeAuth(keys);
  const api = express.Router();
  api.use(authFailLimiter, authenticate);
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PATCH'].includes(req.method) && !req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    next();
  });
  const write = requireRole('write');

  api.get('/courses', wrap(async (req, res) => {
    const location = S.LOCATIONS.includes(req.query.location) ? req.query.location : undefined;
    const courses = await store.listCourses({ location });
    res.json(await Promise.all(courses.map(async (c) => ({ ...c, participants: await store.countEnrollments(c.id) }))));
  }));
  api.get('/courses/:id', validId, wrap(async (req, res) => {
    const c = await store.getCourse(req.params.id);
    if (!c) return res.status(404).json({ error: 'not_found' });
    res.json({ ...c, participants: await store.countEnrollments(c.id) });
  }));
  api.post('/courses', write, wrap(async (req, res) => {
    const data = parse(S.courseCreate, req.body, res); if (!data) return;
    const c = await store.createCourse(data);
    req.log('course_created'); res.status(201).json(c);
  }));
  api.patch('/courses/:id', write, validId, wrap(async (req, res) => {
    const data = parse(S.coursePatch, req.body, res); if (!data) return;
    const r = await store.updateCourse(req.params.id, data);
    if (sendResult(res, r)) return;
    req.log('course_updated'); res.json(r.value);
  }));
  api.delete('/courses/:id', write, validId, wrap(async (req, res) => {
    if (!(await store.deleteCourse(req.params.id))) return res.status(404).json({ error: 'not_found' });
    req.log('course_deleted'); res.sendStatus(204);
  }));

  api.get('/courses/:id/enrollments', validId, wrap(async (req, res) => {
    if (!(await store.getCourse(req.params.id))) return res.status(404).json({ error: 'not_found' });
    res.json(await store.listEnrollments(req.params.id));
  }));
  api.post('/courses/:id/enrollments', write, validId, wrap(async (req, res) => {
    const data = parse(S.enrollmentCreate, req.body, res); if (!data) return;
    const r = await store.createEnrollment(req.params.id, data);
    if (sendResult(res, r)) return;
    req.log('enrollment_created'); res.status(201).json(r.value);
  }));
  api.patch('/enrollments/:id', write, validId, wrap(async (req, res) => {
    const data = parse(S.enrollmentPatch, req.body, res); if (!data) return;
    const r = await store.updateEnrollment(req.params.id, data);
    if (sendResult(res, r)) return;
    req.log(data.paymentStatus ? 'payment_changed' : 'enrollment_updated'); res.json(r.value);
  }));
  api.delete('/enrollments/:id', write, validId, wrap(async (req, res) => {
    if (!(await store.deleteEnrollment(req.params.id))) return res.status(404).json({ error: 'not_found' });
    req.log('enrollment_deleted'); res.sendStatus(204);
  }));

  // Uebersicht: Teilnehmerzahlen und Zahlungsstand je Kurs
  api.get('/stats', wrap(async (req, res) => {
    const courses = await store.listCourses({});
    res.json(await Promise.all(courses.map(async (c) => {
      const es = await store.listEnrollments(c.id);
      const by = (s) => es.filter((e) => e.paymentStatus === s).length;
      return { courseId: c.id, title: c.title, location: c.location, capacity: c.capacity, participants: es.length, spotsLeft: Math.max(0, c.capacity - es.length), paid: by('paid'), open: by('open'), partial: by('partial'), failed: by('failed'), refunded: by('refunded') };
    })));
  }));
  app.use('/api/v1', api);

  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // Fehler nie mit Details nach aussen geben.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    logger({ ts: new Date().toISOString(), event: 'error', message: String(err.message).slice(0, 200), path: req.path });
    res.status(500).json({ error: 'internal_error' });
  });
  return app;
}
module.exports = { createApp };
