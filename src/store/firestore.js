'use strict';
const crypto = require('node:crypto');
const { Firestore } = require('@google-cloud/firestore');

const DOC_COLLECTIONS = ['staff', 'shifts', 'settings', 'products', 'barsessions', 'sales'];

/** Dauerhafter Speicher fuer Google Cloud (Cloud Run nutzt automatisch das Service-Konto). */
class FirestoreStore {
  constructor(db = new Firestore()) {
    this.db = db;
    this.courses = db.collection('courses');
    this.enrollments = db.collection('enrollments');
  }
  async listCourses({ location, publishedOnly } = {}) {
    let q = this.courses;
    if (location) q = q.where('location', '==', location);
    if (publishedOnly) q = q.where('published', '==', true);
    return (await q.limit(500).get()).docs.map((d) => d.data());
  }
  async getCourse(id) { const d = await this.courses.doc(id).get(); return d.exists ? d.data() : null; }
  async createCourse(data) {
    const now = new Date().toISOString();
    const c = { id: crypto.randomUUID(), ...data, version: 1, createdAt: now, updatedAt: now };
    await this.courses.doc(c.id).create(c); return c;
  }
  _update(col, id, patch) {
    return this.db.runTransaction(async (t) => {
      const ref = col.doc(id); const snap = await t.get(ref);
      if (!snap.exists) return { status: 'notfound' };
      const cur = snap.data(); const { version, ...fields } = patch;
      if (version !== cur.version) return { status: 'conflict', current: cur };
      const next = { ...cur, ...fields, version: cur.version + 1, updatedAt: new Date().toISOString() };
      t.set(ref, next); return { status: 'ok', value: next };
    });
  }
  updateCourse(id, patch) { return this._update(this.courses, id, patch); }
  async deleteCourse(id) {
    const ref = this.courses.doc(id);
    if (!(await ref.get()).exists) return false;
    const es = await this.enrollments.where('courseId', '==', id).get();
    const batch = this.db.batch(); es.docs.forEach((d) => batch.delete(d.ref)); batch.delete(ref);
    await batch.commit(); return true;
  }
  async listEnrollments(courseId) {
    return (await this.enrollments.where('courseId', '==', courseId).limit(1000).get()).docs.map((d) => d.data());
  }
  async countEnrollments(courseId) {
    return (await this.enrollments.where('courseId', '==', courseId).count().get()).data().count;
  }
  createEnrollment(courseId, data) {
    // Transaktion: Kapazitaet und Duplikate atomar pruefen (keine Ueberbuchung bei parallelen Anfragen).
    return this.db.runTransaction(async (t) => {
      const cs = await t.get(this.courses.doc(courseId));
      if (!cs.exists) return { status: 'notfound' };
      const existing = await t.get(this.enrollments.where('courseId', '==', courseId));
      if (existing.docs.some((d) => d.data().participantRef === data.participantRef)) return { status: 'duplicate' };
      if (existing.size >= cs.data().capacity) return { status: 'full' };
      const now = new Date().toISOString();
      const e = { id: crypto.randomUUID(), courseId, ...data, version: 1, createdAt: now, updatedAt: now };
      t.create(this.enrollments.doc(e.id), e); return { status: 'ok', value: e };
    });
  }
  updateEnrollment(id, patch) { return this._update(this.enrollments, id, patch); }
  async deleteEnrollment(id) {
    const ref = this.enrollments.doc(id);
    if (!(await ref.get()).exists) return false;
    await ref.delete(); return true;
  }
  async listAllEnrollments() { return (await this.enrollments.limit(20000).get()).docs.map((d) => d.data()); }

  // Einfache Dokument-Sammlungen (Team, Schichten, Bar-Abende, Einstellungen) fuer die Chef-/Team-App.
  _col(name) { if (!DOC_COLLECTIONS.includes(name)) throw new Error('unbekannte Sammlung'); return this.db.collection(name); }
  async listDocs(name) { return (await this._col(name).limit(20000).get()).docs.map((d) => d.data()); }
  async getDoc(name, id) { const d = await this._col(name).doc(id).get(); return d.exists ? d.data() : null; }
  async putDoc(name, doc) { await this._col(name).doc(doc.id).set(doc); return doc; }
  async removeDoc(name, id) {
    const ref = this._col(name).doc(id);
    if (!(await ref.get()).exists) return false;
    await ref.delete(); return true;
  }
}
module.exports = { FirestoreStore };
