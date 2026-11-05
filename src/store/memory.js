'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DOC_COLLECTIONS = ['staff', 'shifts', 'settings', 'products', 'barsessions', 'sales', 'plan', 'invoices', 'purchases'];

/**
 * Einfacher Speicher (JSON-Datei, atomar geschrieben) fuer Entwicklung/Tests.
 * Auf Cloud Run ist das Dateisystem fluechtig -> dort Firestore nutzen (STORE=firestore).
 */
class FileStore {
  constructor(file) {
    this.file = file;
    this.db = { courses: {}, enrollments: {} };
    if (file && fs.existsSync(file)) this.db = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const n of DOC_COLLECTIONS) this.db[n] = this.db[n] || {};
  }
  _save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
  async listCourses({ location, publishedOnly } = {}) {
    return Object.values(this.db.courses).filter(
      (c) => (!location || c.location === location) && (!publishedOnly || c.published),
    );
  }
  async getCourse(id) { return this.db.courses[id] || null; }
  async createCourse(data) {
    const now = new Date().toISOString();
    const c = { id: crypto.randomUUID(), ...data, version: 1, createdAt: now, updatedAt: now };
    this.db.courses[c.id] = c; this._save(); return c;
  }
  async updateCourse(id, patch) {
    const cur = this.db.courses[id];
    if (!cur) return { status: 'notfound' };
    const { version, ...fields } = patch;
    if (version !== cur.version) return { status: 'conflict', current: cur };
    const next = { ...cur, ...fields, version: cur.version + 1, updatedAt: new Date().toISOString() };
    this.db.courses[id] = next; this._save(); return { status: 'ok', value: next };
  }
  async deleteCourse(id) {
    if (!this.db.courses[id]) return false;
    delete this.db.courses[id];
    for (const [k, e] of Object.entries(this.db.enrollments)) if (e.courseId === id) delete this.db.enrollments[k];
    this._save(); return true;
  }
  async listEnrollments(courseId) {
    return Object.values(this.db.enrollments).filter((e) => e.courseId === courseId);
  }
  async countEnrollments(courseId) { return (await this.listEnrollments(courseId)).length; }
  async createEnrollment(courseId, data) {
    const course = this.db.courses[courseId];
    if (!course) return { status: 'notfound' };
    const list = await this.listEnrollments(courseId);
    if (list.some((e) => e.participantRef === data.participantRef)) return { status: 'duplicate' };
    if (list.length >= course.capacity) return { status: 'full' };
    const now = new Date().toISOString();
    const e = { id: crypto.randomUUID(), courseId, ...data, version: 1, createdAt: now, updatedAt: now };
    this.db.enrollments[e.id] = e; this._save(); return { status: 'ok', value: e };
  }
  async updateEnrollment(id, patch) {
    const cur = this.db.enrollments[id];
    if (!cur) return { status: 'notfound' };
    const { version, ...fields } = patch;
    if (version !== cur.version) return { status: 'conflict', current: cur };
    const next = { ...cur, ...fields, version: cur.version + 1, updatedAt: new Date().toISOString() };
    this.db.enrollments[id] = next; this._save(); return { status: 'ok', value: next };
  }
  async deleteEnrollment(id) {
    if (!this.db.enrollments[id]) return false;
    delete this.db.enrollments[id]; this._save(); return true;
  }
  async listAllEnrollments() { return Object.values(this.db.enrollments); }

  // Einfache Dokument-Sammlungen (Team, Schichten, Bar-Abende, Einstellungen) fuer die Chef-/Team-App.
  _col(name) { if (!DOC_COLLECTIONS.includes(name)) throw new Error('unbekannte Sammlung'); return this.db[name]; }
  async listDocs(name) { return Object.values(this._col(name)); }
  async getDoc(name, id) { return this._col(name)[id] || null; }
  async putDoc(name, doc) { this._col(name)[doc.id] = doc; this._save(); return doc; }
  async removeDoc(name, id) {
    const c = this._col(name);
    if (!c[id]) return false;
    delete c[id]; this._save(); return true;
  }
}
module.exports = { FileStore };
