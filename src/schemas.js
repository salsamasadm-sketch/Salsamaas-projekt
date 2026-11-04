'use strict';
const { z } = require('zod');

// Alle Schemas sind .strict(): unbekannte Felder werden abgelehnt (kein Mass-Assignment).
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'ungueltige ID');
const text = (max) => z.string().trim().min(1).max(max);
// Freitext darf kein HTML/Steuerzeichen enthalten (Schutz vor gespeichertem XSS auf den Webseiten).
const safeText = (max) =>
  text(max).refine((s) => !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(s), 'unerlaubte Zeichen');

const LOCATIONS = ['maxvorstadt', 'pasing'];
const STYLES = ['salsa', 'bachata', 'kizomba', 'other'];
const PAYMENT = ['open', 'paid', 'partial', 'refunded', 'failed'];

const courseBase = {
  title: safeText(120),
  titleEn: safeText(120).optional(),
  location: z.enum(LOCATIONS),
  style: z.enum(STYLES),
  level: safeText(40),
  weekday: z.number().int().min(0).max(6), // 0 = Sonntag
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  durationMin: z.number().int().min(15).max(480),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  capacity: z.number().int().min(0).max(500),
  priceCents: z.number().int().min(0).max(100000),
  published: z.boolean(),
  notes: safeText(500).optional(),
};

const courseCreate = z.object(courseBase).strict();
// PATCH: alle Felder optional, mindestens eines, plus Versionspruefung gegen Ueberschreiben.
const coursePatch = z
  .object({ ...Object.fromEntries(Object.entries(courseBase).map(([k, v]) => [k, v.optional()])), version: z.number().int().min(1) })
  .strict()
  .refine((o) => Object.keys(o).length > 1, 'mindestens ein Feld aendern');

// Keine Klarnamen noetig: participantRef ist eine neutrale Referenz (z. B. Bsport-ID) -> DSGVO-sparsam.
const enrollmentCreate = z
  .object({
    participantRef: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
    paymentStatus: z.enum(PAYMENT).default('open'),
    amountPaidCents: z.number().int().min(0).max(100000).default(0),
  })
  .strict();
const enrollmentPatch = z
  .object({
    paymentStatus: z.enum(PAYMENT).optional(),
    amountPaidCents: z.number().int().min(0).max(100000).optional(),
    version: z.number().int().min(1),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 1, 'mindestens ein Feld aendern');

module.exports = { id, courseCreate, coursePatch, enrollmentCreate, enrollmentPatch, LOCATIONS };
