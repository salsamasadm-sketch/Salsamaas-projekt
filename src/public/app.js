'use strict';
/* Salsamás Cockpit – Team- und Chef-App. Kein Framework, keine Fremdskripte. */
(() => {
  const $ = (s) => document.querySelector(s);
  const LOC = { maxvorstadt: 'Maxvorstadt', pasing: 'Pasing' };
  const KIND = { bar: 'Bar / Theke', kurs: 'Unterricht', empfang: 'Empfang / Tür', sonstiges: 'Sonstiges' };
  const TICKET = ['eintritt', 'workshop', 'kursgebuehr']; // ohne Inventar
  const FEE = 'kursgebuehr';
  // Kassenplaetze: Tuer = nur Eintritt/Workshops (ohne Inventar), Theke = Getraenke + Kursgebuehren (mit Inventar)
  const STATION = { tuer: 'Tür · Eintritt', theke: 'Theke · Bar' };
  const STATION_SHORT = { tuer: 'Tür', theke: 'Theke' };
  const STATION_KASSE = { tuer: 'Tür-Kasse', theke: 'Theken-Kasse' };
  const DOOR_CATS = ['eintritt', 'workshop'];
  const allowedAt = (st, cat) => (st === 'tuer' ? DOOR_CATS.includes(cat) : !DOOR_CATS.includes(cat));
  const CAT = { eintritt: 'Eintritt', workshop: 'Workshops', kursgebuehr: 'Kursgebühren', softdrinks: 'Softdrinks', bier: 'Bier', wein: 'Wein & Sekt', cocktails: 'Cocktails', longdrinks: 'Longdrinks', shots: 'Shots', heiss: 'Heißgetränke', snacks: 'Snacks', sonstiges: 'Sonstiges' };
  const PAY = { bar: 'Bar', karte: 'Karte', gratis: 'Gratis/Personal' };

  // ---------- Hilfen ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const svg = (tag, attrs) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const eur = (c) => (c == null ? '–' : `${(c / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const signedEur = (c) => (c == null ? '–' : `${c > 0 ? '+' : ''}${eur(c)}`);
  const toCents = (s) => { const n = Number(String(s || '0').replace(/\s|€/g, '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
  const fromCents = (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
  const dmy = (d) => d.split('-').reverse().join('.');
  const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const dateTime = (iso) => new Date(iso).toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hours = (a, b) => ((new Date(b || Date.now()) - new Date(a)) / 3_600_000);
  const thisMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 7);
  const localInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };

  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = `toast${err ? ' err' : ''}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  // Rueckfrage/Eingabe direkt in der Seite (statt confirm/prompt, die in manchen App-Ansichten blockiert sind)
  function ask(message, input) {
    return new Promise((resolve) => {
      const field = input && h('input', { id: 'ask-input', value: input.value ?? '', inputmode: input.inputmode || 'text', autocomplete: 'off' });
      const close = (v) => { box.remove(); resolve(v); };
      const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
        h('form', { class: 'modal-card', onsubmit: (e) => { e.preventDefault(); close(field ? field.value : true); } },
          h('p', {}, message), field,
          h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, field ? 'Speichern' : 'Ja'), h('button', { class: 'btn secondary', type: 'button', onclick: () => close(field ? null : false) }, 'Abbrechen'))));
      document.body.append(box);
      (field || box.querySelector('button')).focus();
    });
  }
  const ERR = { no_shift: 'Bitte zuerst deine Schicht starten', wrong_station: 'Das ist nicht deine Kasse (anderer Kassenplatz oder Standort)', unauthorized: 'Anmeldung fehlgeschlagen', too_many_requests: 'Zu viele Versuche – bitte 15 Min. warten', shift_running: 'Es läuft schon eine Schicht', no_shift_running: 'Keine Schicht aktiv', session_open: 'An diesem Standort ist schon eine Kasse offen', session_closed: 'Kasse ist schon geschlossen', overlap: 'Überschneidet sich mit einer anderen Schicht', already_exists: 'Kürzel gibt es schon', forbidden: 'Keine Berechtigung' };

  // ---------- API ----------
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* privat */ } } };
  let auth = (() => { try { return JSON.parse(store.get('cockpit.auth')) || null; } catch { return null; } })();
  async function api(method, path, body) {
    const res = await fetch(`/app/api${path}`, { method, headers: { ...(auth && { Authorization: `Bearer ${auth.token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && auth) { logout(); throw new Error('Sitzung abgelaufen – bitte neu anmelden'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.details ? data.details.map((d) => d.message).join(', ') : ERR[data.error] || `Fehler (${data.error || res.status})`);
    return data;
  }
  const run = (fn) => async (ev) => { ev?.preventDefault?.(); try { await fn(ev); } catch (e) { toast(e.message, true); } };

  function logout() { auth = null; store.set('cockpit.auth', null); route('login'); }
  $('#logout').addEventListener('click', logout);

  // ---------- Navigation ----------
  const TABS_OWNER = [['heute', 'Heute'], ['jahr', 'Jahr'], ['kasse', 'Kasse'], ['bar', 'Abrechnungen'], ['einkauf', 'Einkauf'], ['personal', 'Personal'], ['kurse', 'Kurse'], ['artikel', 'Getränke'], ['ziele', 'Ziele & Kosten']];
  const TABS_STAFF = [['zeit', 'Meine Zeit'], ['kasse', 'Kasse']];
  let current = null;
  let timerHandle;
  function route(name, arg) {
    applyLoc(name === 'abrechnung' && arg ? arg.location : ['kasse', 'zeit'].includes(name) ? loc : null);
    clearInterval(timerHandle);
    current = name;
    const tabs = $('#tabs');
    tabs.replaceChildren();
    $('#logout').classList.toggle('hidden', !auth);
    if (!auth) { tabs.classList.add('hidden'); return show(viewLogin()); }
    tabs.classList.remove('hidden');
    for (const [id, label] of auth.role === 'owner' ? TABS_OWNER : TABS_STAFF) {
      tabs.append(h('button', { type: 'button', class: id === name ? 'active' : '', onclick: () => route(id) }, label));
    }
    const views = { jahr: viewJahr, einkauf: viewEinkauf, heute: viewHeute, kasse: viewKasse, bar: viewBar, personal: viewPersonal, kurse: viewKurse, artikel: viewArtikel, ziele: viewZiele, zeit: viewZeit, abrechnung: viewAbrechnung };
    show(h('p', { class: 'muted' }, 'Lädt …'));
    Promise.resolve(views[name](arg)).then((el) => { if (current === name) show(el); }).catch((e) => show(h('div', { class: 'card' }, h('p', {}, e.message))));
  }
  const show = (el) => { const v = $('#view'); v.replaceChildren(el); sortableTables(v); v.classList.remove('enter'); void v.offsetWidth; v.classList.add('enter'); };
  // Jede Tabelle mit Kopfzeile: Klick auf eine Spalte sortiert (Zahlen, Beträge, Daten)
  function sortKey(td) {
    const raw = td.dataset.sort ?? td.textContent.trim();
    const dm = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(raw); if (dm) return `${dm[3]}-${dm[2]}-${dm[1]}`;
    const n = raw.replace(/[€%▲▼+\s]|Pkt\./g, '').replace(/\./g, '').replace(',', '.').replace('−', '-');
    return n !== '' && !Number.isNaN(Number(n)) ? Number(n) : raw.toLowerCase();
  }
  function sortableTables(root) {
    for (const table of root.querySelectorAll('table:not(.nosort)')) {
      const head = table.querySelector('tr'); if (!head || !head.querySelector('th')) continue;
      [...head.children].forEach((th, col) => {
        th.classList.add('sortable'); th.tabIndex = 0;
        const sortBy = () => {
          const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
          head.querySelectorAll('th').forEach((x) => { delete x.dataset.dir; });
          th.dataset.dir = dir;
          const rows = [...table.querySelectorAll('tr')].slice(1).filter((r) => !r.classList.contains('total-row'));
          const total = table.querySelector('tr.total-row');
          rows.sort((a, b) => { const x = sortKey(a.children[col] || a), y = sortKey(b.children[col] || b); return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'asc' ? 1 : -1); });
          const parent = rows[0]?.parentNode || table; rows.forEach((r) => parent.append(r)); if (total) parent.append(total);
        };
        th.addEventListener('click', sortBy);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(); } });
      });
    }
  }
  const field = (label, input) => h('label', {}, label, input);
  const seg = (options, value, onChange) => h('div', { class: 'seg' }, Object.entries(options).map(([k, l]) => h('button', { type: 'button', class: k === value ? 'active' : '', onclick: () => onChange(k) }, l)));
  const select = (options, value, attrs = {}) => h('select', attrs, Object.entries(options).map(([k, l]) => h('option', { value: k, selected: k === value }, l)));
  let loc = store.get('cockpit.loc') || 'maxvorstadt';
  // Standortfarbe: Maxvorstadt = Orange, Pasing = eigene Farbe (siehe style.css, :root[data-loc])
  const applyLoc = (l) => { if (l) document.documentElement.dataset.loc = l; else delete document.documentElement.dataset.loc; };
  const setLoc = (l) => { loc = l; store.set('cockpit.loc', l); applyLoc(l); };

  // ---------- Login ----------
  function viewLogin() {
    let mode = 'team';
    const wrap = h('div', { class: 'login-card' });
    const shell = h('div', { class: 'login' },
      h('div', { class: 'login-hero' },
        h('p', { class: 'count', 'aria-hidden': 'true' }, '1 · 2 · 3 · ', h('span', {}, '4'), ' · 5 · 6 · 7 · ', h('span', {}, '8')),
        document.body.classList.contains('has-logo') ? h('h1', { class: 'logo-h1' }, h('img', { class: 'logo-xl logo-light', src: document.querySelector('.logo-img.logo-light').src, alt: 'Tanzschule Salsamás' }), h('img', { class: 'logo-xl logo-dark', src: (document.querySelector('.logo-img.logo-dark') || document.querySelector('.logo-img')).src, alt: '' })) : h('h1', { class: 'wordmark-xl' }, 'Salsamás'),
        h('p', { class: 'login-sub' }, 'Kasse, Stunden und Überblick für Maxvorstadt und Pasing.')),
      wrap);
    const render = () => {
      const ref = h('input', { autocomplete: 'username', autocapitalize: 'none', required: true, placeholder: 'z. B. lena' });
      const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'current-password', required: true, minlength: 6, maxlength: 8, placeholder: '6–8 Ziffern' });
      const key = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: 'Chef-Schlüssel' });
      wrap.replaceChildren(
        h('h2', { class: 'login-title' }, 'Anmelden'),
        seg({ team: 'Team', chef: 'Chef' }, mode, (m) => { mode = m; render(); }),
        h('form', { onsubmit: run(async () => {
          const r = await api('POST', '/login', mode === 'team' ? { ref: ref.value.trim(), pin: pin.value } : { apiKey: key.value.trim() });
          auth = r; store.set('cockpit.auth', JSON.stringify(r));
          route(r.role === 'owner' ? 'heute' : 'zeit');
        }) },
        mode === 'team' ? [field('Kürzel', ref), field('PIN', pin)] : field('Schlüssel (write)', key),
        h('button', { class: 'btn block', type: 'submit' }, 'Anmelden')),
        h('p', { class: 'muted small' }, mode === 'team' ? 'Kürzel und PIN bekommst du von Pablo.' : 'Den Chef-Schlüssel im Passwort-Manager speichern.'),
        window.COCKPIT_DEMO && h('div', { class: 'demo-login' },
          h('p', { class: 'small' }, h('b', {}, 'Demo: '), 'Einfach eine Rolle antippen.'),
          h('div', { class: 'row' },
            h('button', { class: 'btn', type: 'button', onclick: run(async () => { const r = await api('POST', '/login', { apiKey: 'demo-chef' }); auth = r; store.set('cockpit.auth', JSON.stringify(r)); route('heute'); }) }, 'Als Chef ansehen'),
            h('button', { class: 'btn secondary', type: 'button', onclick: run(async () => { const r = await api('POST', '/login', { ref: 'sofia', pin: '123456' }); auth = r; store.set('cockpit.auth', JSON.stringify(r)); route('zeit'); }) }, 'Als Team (Sofia)'))),
      );
    };
    render();
    return shell;
  }

  // ---------- Team: Meine Zeit ----------
  async function viewZeit() {
    const me = await api('GET', '/me');
    const root = h('div', {}, h('h1', {}, `Hallo ${me.ref}!`));
    const card = h('div', { class: 'card' });
    if (me.openShift) {
      const t = h('div', { class: 'timer' });
      const tick = () => { const s = Math.floor((Date.now() - new Date(me.openShift.start)) / 1000); t.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
      tick(); timerHandle = setInterval(tick, 1000);
      card.append(
        h('div', { class: 'row spread' }, h('span', { class: 'pill ok' }, 'Schicht läuft'), h('span', { class: 'muted small' }, `${KIND[me.openShift.kind]} · ${LOC[me.openShift.location]} · seit ${time(me.openShift.start)}`)),
        t,
        h('button', { class: 'btn big block stop', type: 'button', onclick: run(async () => { const k = await api('GET', `/bar/current?location=${loc}&station=${station}`).catch(() => null); if (k?.session && !await ask(`Deine ${STATION_KASSE[k.station]} ist noch offen. Nach dem Ausstempeln kannst du sie nicht mehr abschließen – trotzdem beenden?`)) return; await api('POST', '/shifts/stop'); toast('Schicht beendet'); route('zeit'); }) }, '■  Schicht beenden'),
      );
    } else {
      const kind = select(KIND, store.get('cockpit.kind') || 'bar');
      const where = select(LOC, loc, { onchange: (e) => setLoc(e.target.value) });
      card.append(
        h('div', { class: 'grid2' }, field('Was machst du?', kind), field('Wo?', where)),
        h('button', { class: 'btn big block', type: 'button', onclick: run(async () => { store.set('cockpit.kind', kind.value); setLoc(where.value); await api('POST', '/shifts/start', { kind: kind.value, location: where.value }); toast('Schicht gestartet'); route('zeit'); }) }, '▶  Schicht starten'),
      );
    }
    root.append(card);

    // Nachtragen von-bis
    const kind2 = select(KIND, 'kurs');
    const where2 = select(LOC, loc, { onchange: (e) => applyLoc(e.target.value) });
    const start = h('input', { type: 'datetime-local', required: true, value: localInput(Date.now() - 2 * 3_600_000) });
    const end = h('input', { type: 'datetime-local', required: true, value: localInput(Date.now()) });
    root.append(h('details', { class: 'card' }, h('summary', {}, 'Arbeitszeit nachtragen (von – bis)'),
      h('form', { onsubmit: run(async () => { await api('POST', '/shifts/own', { kind: kind2.value, location: where2.value, start: new Date(start.value).toISOString(), end: new Date(end.value).toISOString() }); toast('Eingetragen'); route('zeit'); }) },
        h('p', { class: 'muted small' }, 'Zum Beispiel nach dem Unterricht. Geht für die letzten 3 Tage.'),
        h('div', { class: 'grid2' }, field('Tätigkeit', kind2), field('Standort', where2), field('Von', start), field('Bis', end)),
        h('button', { class: 'btn block', type: 'submit' }, 'Speichern'))));

    root.append(h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('b', {}, 'Dieser Monat'), h('span', {}, `${me.monthHours.toLocaleString('de-DE')} Std.`)),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Wann'), h('th', {}, 'Was'), h('th', { class: 'num' }, 'Std.')),
        me.recent.map((s) => h('tr', {}, h('td', {}, `${dateTime(s.start)}–${s.end ? time(s.end) : 'läuft'}`), h('td', {}, `${KIND[s.kind]}, ${LOC[s.location]}`), h('td', { class: 'num' }, hours(s.start, s.end).toFixed(1).replace('.', ','))))))));
    return root;
  }

  // ---------- Kasse ----------
  let station = store.get('cockpit.station') || 'theke';
  let stationChosen = false;
  const setStation = (st) => { station = st; stationChosen = true; store.set('cockpit.station', st); };
  async function viewKasse() {
    // Team: fest an Kassenplatz und Standort der laufenden Schicht gebunden (kein Umschalten)
    let cur;
    try { cur = await api('GET', `/bar/current?location=${loc}&station=${station}`); } catch (e) {
      if (!/Schicht/.test(e.message)) throw e;
      return h('div', { class: 'card empty-state' }, h('h1', {}, 'Erst einstempeln'),
        h('p', {}, 'Die Kasse ist an deine Schicht gebunden: Wer als „Empfang / Tür" eingestempelt ist, kassiert an der Tür, wer als „Bar / Theke" eingestempelt ist, an der Theke.'),
        h('button', { class: 'btn', type: 'button', onclick: () => route('zeit') }, 'Zur Schicht'));
    }
    if (cur.locked) { station = cur.station; if (cur.location !== loc) setLoc(cur.location); else applyLoc(loc); }
    const all = await api('GET', '/products');
    const products = all.filter((p) => allowedAt(station, p.category));
    const root = cur.locked
      ? h('div', {}, h('div', { class: 'station-lock' }, h('span', { class: 'eyebrow' }, 'Deine Kasse'), h('b', {}, `${STATION[station]} · ${LOC[loc]}`), h('span', { class: 'muted small' }, 'aus deiner Schicht')))
      : h('div', {}, seg(LOC, loc, (l) => { setLoc(l); route('kasse'); }),
        h('div', { class: 'seg station' }, Object.entries(STATION).map(([k, l]) => h('button', { type: 'button', class: k === station ? 'active' : '', onclick: () => { setStation(k); route('kasse'); } }, l))));
    if (!products.length) return root.append(h('div', { class: 'card' }, h('p', {}, auth.role === 'owner' ? `Lege zuerst unter „Getränke" Artikel für ${STATION_SHORT[station] === 'Tür' ? 'Eintritt/Workshops' : 'die Theke'} an.` : 'Für diesen Kassenplatz sind noch keine Artikel angelegt – bitte Pablo Bescheid geben.'))), root;
    if (!cur.session) root.append(openForm(station === 'tuer' ? [] : products.filter((p) => !TICKET.includes(p.category)), cur.lastStock));
    else root.append(await posView(cur, products));
    return root;
  }

  function stockTable(products, values, extra) {
    const inputs = {};
    const tbl = h('table', {}, h('tr', {}, h('th', {}, 'Artikel'), extra && h('th', { class: 'num' }, extra.label), h('th', { class: 'num' }, 'Stück')));
    for (const p of products) {
      inputs[p.id] = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 10000, value: values[p.id] ?? '', required: true, class: 'num' });
      tbl.append(h('tr', {}, h('td', {}, p.name), extra && h('td', { class: 'num muted' }, extra.value(p)), h('td', { class: 'num' }, inputs[p.id])));
    }
    const read = () => Object.fromEntries(Object.entries(inputs).map(([id, i]) => [id, Math.max(0, Math.floor(Number(i.value) || 0))]));
    return { el: h('div', { class: 'table-wrap' }, tbl), read };
  }

  function openForm(products, lastStock) {
    const cash = h('input', { inputmode: 'decimal', required: true, placeholder: 'z. B. 150,00' });
    const st = stockTable(products, lastStock);
    return h('form', { class: 'card', onsubmit: run(async () => {
      const c = toCents(cash.value); if (c == null) throw new Error('Kassenbestand prüfen');
      await api('POST', '/bar/open', { location: loc, station, cashStartCents: c, stockStart: station === 'tuer' ? {} : st.read() });
      toast('Kasse geöffnet'); route('kasse');
    }) },
    h('h1', {}, `${STATION_KASSE[station]} öffnen – ${LOC[loc]}`),
    h('p', { class: 'muted small' }, station === 'tuer' ? 'Vor dem ersten Gast: Wechselgeld in der Tür-Kasse zählen. An der Tür gibt es kein Inventar.' : 'Vor dem ersten Verkauf: Wechselgeld in der Kasse zählen und den Bestand an der Bar zählen. Vorausgefüllt ist der Endbestand vom letzten Mal – bitte kontrollieren.'),
    field('Kassenbestand (Wechselgeld) in €', cash),
    station !== 'tuer' && h('h2', {}, 'Inventar – Anfangsbestand'), station !== 'tuer' && st.el,
    h('button', { class: 'btn block', type: 'submit' }, 'Kasse öffnen'));
  }

  async function posView(cur, products) {
    const ses = cur.session;
    const cart = new Map();
    const root = h('div', {});
    const head = h('div', { class: 'card' });
    const cartBox = h('div', { class: 'receipt cart' });
    const recentBox = h('div', { class: 'card' });
    let set = cur.settlement;
    const priceOf = new Map(products.map((p) => [p.id, p]));
    const prodButtons = new Map();
    let feeRef = '';
    let lastTotal = 0;

    const renderHead = () => head.replaceChildren(
      h('div', { class: 'row spread' }, h('b', {}, `${STATION_KASSE[station]} offen · ${LOC[ses.location]}`), h('span', { class: 'muted small' }, `seit ${time(ses.openedAt)} (${ses.openedBy})`)),
      h('div', { class: 'grid3 small' },
        h('div', {}, h('div', { class: 'muted' }, 'Umsatz heute'), h('b', {}, eur(set.revenueCents))),
        h('div', {}, h('div', { class: 'muted' }, set.courseFeeCents ? 'Eintritt / Kurs / Getränke' : 'Eintritt / Getränke'), h('b', {}, set.courseFeeCents ? `${eur(set.ticketRevenueCents)} / ${eur(set.courseFeeCents)} / ${eur(set.drinksRevenueCents)}` : `${eur(set.ticketRevenueCents)} / ${eur(set.drinksRevenueCents)}`)),
        h('div', {}, h('div', { class: 'muted' }, 'Gäste'), h('b', {}, set.ticketCount))),
    );
    const renderCart = () => {
      const total = [...cart.entries()].reduce((a, [id, q]) => a + q * priceOf.get(id).priceCents, 0);
      for (const [id, { btn, badge }] of prodButtons) { const q = cart.get(id) || 0; badge.textContent = q ? `${q}×` : ''; btn.classList.toggle('in-cart', q > 0); }
      const bump = total !== lastTotal; lastTotal = total;
      queueMicrotask(() => { const t = cartBox.querySelector('.total'); if (t && bump) { t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump'); } });
      const pay = (p) => run(async () => {
        if (!cart.size) return;
        const note = [...cart.keys()].some((id) => priceOf.get(id).category === FEE) ? feeRef.trim() : '';
        await api('POST', `/bar/${ses.id}/sales`, { payment: p, items: [...cart.entries()].map(([productId, qty]) => ({ productId, qty })), ...(note && { note }) });
        toast(p === 'gratis' ? 'Gratis gebucht' : `${eur(total)} ${PAY[p]} gebucht`);
        cart.clear(); feeRef = ''; await refresh();
      });
      cartBox.replaceChildren(
        h('div', { class: 'row spread receipt-head' }, h('span', { class: 'eyebrow' }, 'Bon'), h('span', { class: 'total' }, eur(total))),
        cart.size ? h('ul', { class: 'cartlist' }, [...cart.entries()].map(([id, q]) => h('li', {}, h('span', {}, `${q}× ${priceOf.get(id).name}`), h('span', { class: 'row' }, eur(q * priceOf.get(id).priceCents), h('button', { type: 'button', class: 'ghost', onclick: () => { q > 1 ? cart.set(id, q - 1) : cart.delete(id); renderCart(); } }, '−'))))) : h('p', { class: 'muted small' }, 'Getränk antippen, dann Zahlart wählen.'),
        [...cart.keys()].some((id) => priceOf.get(id).category === FEE) ? h('label', { class: 'fee-ref' }, 'Kursgebühr für wen? (Vorname oder Bsport-ID, optional)', h('input', { id: 'fee-ref', maxlength: 60, autocomplete: 'off', placeholder: 'z. B. Anna K. oder bs-1234', value: feeRef, oninput: (e) => { feeRef = e.target.value; } })) : '',
        h('div', { class: 'grid3' },
          h('button', { class: 'btn', type: 'button', disabled: !cart.size, onclick: pay('bar') }, 'Bar'),
          h('button', { class: 'btn', type: 'button', disabled: !cart.size, onclick: pay('karte') }, 'Karte'),
          h('button', { class: 'btn secondary', type: 'button', disabled: !cart.size, onclick: pay('gratis') }, 'Gratis')),
      );
    };
    const renderRecent = async () => {
      const list = await api('GET', `/bar/${ses.id}/sales`);
      recentBox.replaceChildren(h('b', {}, 'Letzte Buchungen'),
        list.length ? h('ul', { class: 'list' }, list.slice(0, 8).map((s) => {
          const sum = s.payment === 'gratis' ? 0 : s.items.reduce((a, i) => a + i.qty * i.priceCents, 0);
          return h('li', { class: s.voided ? 'info' : '' }, h('span', {}, h('span', { class: 'muted small' }, `${time(s.at)} · ${s.by} · ${PAY[s.payment]}${s.note ? ` · für ${s.note}` : ''}`), h('br'), `${s.items.map((i) => `${i.qty}× ${priceOf.get(i.productId)?.name || '?'}`).join(', ')} – ${s.voided ? 'storniert' : eur(sum)}`),
            !s.voided && h('button', { type: 'button', class: 'ghost', onclick: run(async () => { if (!await ask('Diese Buchung stornieren?')) return; await api('DELETE', `/bar/${ses.id}/sales/${s.id}`); toast('Storniert'); await refresh(); }) }, 'Storno'));
        })) : h('p', { class: 'muted small' }, 'Noch nichts verkauft.'));
    };
    const refresh = async () => { set = (await api('GET', `/bar/current?location=${ses.location}&station=${station}`)).settlement; renderHead(); renderCart(); await renderRecent(); };

    // Getraenke-Buttons nach Kategorie
    const grid = h('div', {});
    const byCat = new Map();
    for (const p of products) { const l = byCat.get(p.category) || []; l.push(p); byCat.set(p.category, l); }
    for (const [cat, list] of [...byCat].sort((a, b) => Object.keys(CAT).indexOf(a[0]) - Object.keys(CAT).indexOf(b[0]))) {
      grid.append(h('div', { class: 'catlabel' }, CAT[cat] || cat), h('div', { class: 'pos' }, list.map((p) => {
        const badge = h('b', { class: 'qty', 'aria-hidden': 'true' });
        const btn = h('button', { type: 'button', class: `prod${TICKET.includes(p.category) ? ' ticket' : ''}`, onclick: () => { cart.set(p.id, (cart.get(p.id) || 0) + 1); renderCart(); } }, h('span', {}, p.name), h('small', {}, eur(p.priceCents)), badge);
        prodButtons.set(p.id, { btn, badge });
        return btn;
      })));
    }
    renderHead(); renderCart(); await renderRecent();
    root.append(head, cartBox, h('div', { class: 'card' }, grid), recentBox,
      h('button', { class: 'btn block stop', type: 'button', onclick: () => show(closeForm(ses, station === 'tuer' ? [] : products.filter((p) => !TICKET.includes(p.category)), set)) }, `${STATION_KASSE[station]} schließen & abrechnen`));
    return root;
  }

  function closeForm(ses, products, set) {
    const cash = h('input', { inputmode: 'decimal', required: true, placeholder: 'gezähltes Bargeld' });
    const out = h('input', { inputmode: 'decimal', value: '0,00' });
    const guests = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: 'nur falls kein Eintritt gebucht' });
    const note = h('input', { maxlength: 200, placeholder: 'optional, z. B. Eis gekauft' });
    // Aushilfen (nicht registriert): von–bis, Stundenlohn, Auszahlung bar oder Ueberweisung
    const helperRows = [];
    const helperBox = h('div', { class: 'helpers' });
    const helperSum = h('p', { class: 'small muted helper-sum' });
    const quarterHours = (a, b) => Math.ceil(Math.max(0, b - a) / 900_000) / 4;
    const helperTimes = (r) => {
      if (!r.from.value || !r.to.value) return null;
      const a = new Date(`${ses.date}T${r.from.value}`); let b = new Date(`${ses.date}T${r.to.value}`);
      if (b <= a) b = new Date(b.getTime() + 86_400_000); // ueber Mitternacht
      return { a, b };
    };
    const updateHelpers = () => {
      let cashTotal = 0, transfer = 0;
      for (const r of helperRows) {
        const t = helperTimes(r); const rate = toCents(r.rate.value);
        if (!t || rate == null) { r.out.textContent = '–'; continue; }
        const hrs = quarterHours(t.a, t.b); const pay = Math.round(hrs * rate);
        r.out.textContent = `${hrs.toLocaleString('de-DE')} Std. = ${eur(pay)}`;
        if (r.payout.value === 'bar') cashTotal += pay; else transfer += pay;
      }
      helperSum.textContent = helperRows.length ? `Bar aus dieser Kasse: ${eur(cashTotal)} (wird vom Kassensoll abgezogen) · Überweisung: ${eur(transfer)}` : '';
    };
    const addHelper = () => {
      const r = {
        name: h('input', { maxlength: 40, required: true, placeholder: 'Vorname' }),
        from: h('input', { type: 'time', required: true }),
        to: h('input', { type: 'time', required: true }),
        rate: h('input', { inputmode: 'decimal', required: true, value: '13,90' }),
        payout: select({ bar: 'Bar ausgezahlt (aus dieser Kasse)', ueberweisung: 'Wird überwiesen (Minijob)' }, 'bar'),
        out: h('b', { class: 'helper-out' }, '–'),
      };
      const row = h('div', { class: 'helper-row', oninput: updateHelpers, onchange: updateHelpers },
        h('div', { class: 'grid2' }, field('Name', r.name), field('Stundenlohn €', r.rate), field('Von', r.from), field('Bis', r.to)),
        field('Auszahlung', r.payout),
        h('div', { class: 'row spread' }, r.out, h('button', { type: 'button', class: 'link', onclick: () => { helperRows.splice(helperRows.indexOf(r), 1); row.remove(); updateHelpers(); } }, 'entfernen')));
      helperRows.push(r); helperBox.append(row); updateHelpers(); r.name.focus();
    };
    const restock = stockTable(products, {}, { label: 'Nachgefüllt', value: () => '' });
    const restockInputs = restock.el.querySelectorAll('input'); restockInputs.forEach((i) => { i.required = false; i.value = '0'; });
    const soldMap = new Map(set.items.map((i) => [i.productId, i.sold]));
    const end = stockTable(products, {}, { label: 'Verkauft', value: (p) => soldMap.get(p.id) || 0 });
    return h('form', { class: 'card', onsubmit: run(async () => {
      const c = toCents(cash.value); const o = toCents(out.value);
      if (c == null || o == null) throw new Error('Beträge prüfen');
      if (!await ask('Kasse jetzt schließen? Danach kann nichts mehr gebucht werden.')) return;
      const door = station === 'tuer';
      const helpers = helperRows.map((r) => { const t = helperTimes(r); const rate = toCents(r.rate.value); if (!t || rate == null || r.name.value.trim().length < 2) throw new Error('Aushilfe: Name, Von, Bis und Stundenlohn ausfüllen'); return { name: r.name.value.trim(), start: t.a.toISOString(), end: t.b.toISOString(), rateCents: rate, payout: r.payout.value }; });
      const result = await api('POST', `/bar/${ses.id}/close`, { helpers, cashEndCents: c, cashOutCents: o, stockEnd: door ? {} : end.read(), restock: door ? {} : restock.read(), ...(guests.value && { guests: Number(guests.value) }), ...(note.value.trim() && { note: note.value.trim() }) });
      toast('Kasse abgeschlossen');
      route('abrechnung', result);
    }) },
    h('h1', {}, `${STATION_KASSE[station]} schließen – ${LOC[ses.location]}`),
    h('p', { class: 'muted small' }, station === 'tuer' ? 'Bargeld in der Tür-Kasse zählen (inklusive Wechselgeld). Die Gästezahl kommt automatisch aus den verkauften Tickets.' : 'Bargeld zählen (inklusive Wechselgeld) und den Bestand an der Bar zählen. Die App vergleicht danach automatisch mit den Verkäufen.'),
    h('div', { class: 'grid2' }, field('Bargeld gezählt in €', cash), field('Entnahmen in € (Belege)', out), station !== 'tuer' && field('Gäste (ca.)', guests), field('Notiz', note)),
    station !== 'tuer' && h('details', {}, h('summary', {}, 'Während des Abends nachgefüllt? (aus dem Lager)'), restock.el),
    h('h2', {}, 'Aushilfen (nicht registriert)'),
    h('div', { class: 'card inset' }, h('p', { class: 'small muted' }, 'Arbeitszeit wird automatisch auf die Viertelstunde aufgerundet. Bar ausgezahlter Lohn wird vom Kassensoll abgezogen, Überweisungen landen beim Chef als To-do.'), helperBox, helperSum,
      h('button', { type: 'button', class: 'btn secondary', onclick: addHelper }, '+ Aushilfe hinzufügen')),
    station !== 'tuer' && h('h2', {}, 'Inventar – Endbestand (gezählt)'), station !== 'tuer' && end.el,
    h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, 'Abschließen'), h('button', { class: 'btn secondary', type: 'button', onclick: () => route('kasse') }, 'Zurück zur Kasse')));
  }

  // ---------- Abrechnung ----------
  function diffCell(v, money) {
    if (v == null) return h('td', { class: 'num muted' }, '–');
    const cls = v === 0 ? 'ok' : v < 0 ? 'bad' : 'warn';
    return h('td', { class: `num ${cls}txt` }, money ? signedEur(v) : `${v > 0 ? '+' : ''}${v}`);
  }
  function settlementCard(s) {
    const cashLevel = s.cashDiffCents == null ? 'none' : Math.abs(s.cashDiffCents) <= 500 ? 'ok' : Math.abs(s.cashDiffCents) <= 2000 ? 'warn' : 'bad';
    const invLevel = s.status !== 'closed' ? 'none' : s.missingUnits === 0 ? 'ok' : s.missingUnits <= 3 ? 'warn' : 'bad';
    return h('div', {},
      h('div', { class: 'kpis' },
        kpiTile('Umsatz gesamt', eur(s.revenueCents), `bar ${eur(s.cashSalesCents)} · Karte ${eur(s.cardSalesCents)}`, 'none'),
        (s.station === 'tuer' || s.ticketRevenueCents > 0) && kpiTile('Eintritt & Workshops', eur(s.ticketRevenueCents), `${s.guests ?? 0} Gäste`, 'none'),
        s.station !== 'tuer' && s.courseFeeCents > 0 && kpiTile('Kursgebühren vor Ort', eur(s.courseFeeCents), `${s.courseFees.reduce((a, f) => a + f.qty, 0)} Zahlungen`, 'none'),
        s.station !== 'tuer' && kpiTile('Getränke', eur(s.drinksRevenueCents), `${s.salesCount} Buchungen${s.voidedCount ? `, ${s.voidedCount} Storno` : ''}`, 'none'),
        kpiTile('Kassendifferenz', signedEur(s.cashDiffCents), `Soll ${eur(s.cashExpectedCents)}, gezählt ${eur(s.cashCountedCents)}`, cashLevel),
        s.station !== 'tuer' && kpiTile('Inventar', s.status !== 'closed' ? '–' : s.missingUnits === 0 ? 'passt' : `${s.missingUnits} fehlen`, s.missingUnits ? `≈ ${eur(s.missingValueCents)} Umsatz` : `${s.freeUnits || 0} gratis gebucht`, invLevel)),
      s.courseFees?.length > 0 && h('div', { class: 'card table-wrap' }, h('b', {}, 'Kursgebühren vor Ort'), h('table', {},
        h('tr', {}, h('th', {}, 'Art'), h('th', { class: 'num' }, 'Anzahl'), h('th', { class: 'num' }, 'Betrag'), h('th', {}, 'Für')),
        s.courseFees.map((f) => h('tr', {}, h('td', {}, f.name), h('td', { class: 'num' }, f.qty), h('td', { class: 'num' }, eur(f.revenueCents)), h('td', { class: 'small' }, f.refs.join(', ') || '–'))))),
      s.helpers?.length > 0 && h('div', { class: 'card table-wrap' }, h('b', {}, 'Aushilfen'), h('table', {},
        h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Zeit'), h('th', { class: 'num' }, 'Std.'), h('th', { class: 'num' }, 'Lohn'), h('th', {}, 'Auszahlung')),
        s.helpers.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, `${time(x.start)}–${time(x.end)}`), h('td', { class: 'num' }, x.hours.toLocaleString('de-DE')), h('td', { class: 'num' }, eur(x.payCents)), h('td', {}, x.payout === 'bar' ? 'bar ausgezahlt' : 'Überweisung'))))),
      s.tickets.length > 0 && h('div', { class: 'card table-wrap' }, h('b', {}, 'Gäste nach Ticket'), h('table', {},
        h('tr', {}, h('th', {}, 'Ticket'), h('th', { class: 'num' }, 'Personen'), h('th', { class: 'num' }, 'Umsatz')),
        s.tickets.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'num' }, t.qty), h('td', { class: 'num' }, eur(t.revenueCents)))))),
      h('div', { class: 'card' },
        h('p', { class: 'small muted' }, `Kasse: Anfang ${eur(s.cashStartCents)} + Bareinnahmen ${eur(s.cashSalesCents)} − Entnahmen ${eur(s.cashOutCents)}${s.helperCashCents ? ` − Aushilfen bar ${eur(s.helperCashCents)}` : ''} = Soll ${eur(s.cashExpectedCents)}`),
        s.station !== 'tuer' && h('div', { class: 'table-wrap' }, h('table', {},
          h('tr', {}, h('th', {}, 'Artikel'), h('th', { class: 'num' }, 'Anfang'), h('th', { class: 'num' }, '+Nachf.'), h('th', { class: 'num' }, 'Verkauft'), h('th', { class: 'num' }, 'Soll'), h('th', { class: 'num' }, 'Gezählt'), h('th', { class: 'num' }, 'Diff.'), h('th', { class: 'num' }, 'Umsatz')),
          s.items.map((i) => h('tr', {}, h('td', {}, i.name), h('td', { class: 'num' }, i.start ?? '–'), h('td', { class: 'num' }, i.restock || ''), h('td', { class: 'num' }, i.sold), h('td', { class: 'num' }, i.expectedEnd), h('td', { class: 'num' }, i.countedEnd ?? '–'), diffCell(i.diff), h('td', { class: 'num' }, eur(i.revenueCents)))))),
        s.note && h('p', { class: 'small' }, `Notiz: ${s.note}`),
        h('p', { class: 'small muted' }, `Geöffnet von ${s.openedBy} um ${time(s.openedAt)}${s.closedAt ? `, geschlossen von ${s.closedBy} um ${time(s.closedAt)}` : ''}.`)));
  }
  function viewAbrechnung(s) {
    return h('div', {}, h('h1', {}, `Abrechnung ${STATION_SHORT[s.station] || ''} ${dmy(s.date)} – ${LOC[s.location]}`), settlementCard(s),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => route(auth.role === 'owner' ? 'bar' : 'kasse') }, 'Fertig'));
  }

  // ---------- Chef: Heute ----------
  const STATUS = { ok: 'im Ziel', warn: 'knapp', bad: 'daneben' };
  function kpiTile(label, value, sub, status, deltaEl) {
    return h('div', { class: `kpi ${status}` },
      h('div', { class: 'kpi-head' }, h('span', { class: 'label' }, label), STATUS[status] && h('span', { class: `chip ${status}` }, STATUS[status])),
      h('div', { class: 'value' }, value), deltaEl, sub && h('div', { class: 'sub' }, sub));
  }
  // Veraenderung zur Vorperiode; Farbe danach, ob mehr hier gut oder schlecht ist
  const HIGHER_IS_BETTER = { profit: true, ticketRevenue: true, barRevenue: true, barPerGuest: true, utilizationPct: true, courseRevenue: true, missing: false, barPersonnelPct: false, personnelCost: false, openPaymentsPct: false };
  function delta(k, prevLabel, inline) {
    if (k.prev == null || k.value == null || !(k.id in HIGHER_IS_BETTER)) return null;
    const diff = k.value - k.prev;
    if (Math.abs(diff) < 1e-9) return h('span', { class: 'delta flat' }, `= ${prevLabel}`);
    const pct = k.unit === 'pct' ? `${diff > 0 ? '+' : ''}${Math.round(diff)} Pkt.` : k.prev !== 0 ? `${diff > 0 ? '+' : ''}${Math.round((diff / Math.abs(k.prev)) * 100)} %` : k.unit === 'eur' ? signedEur(Math.round(diff)) : `${diff > 0 ? '+' : ''}${diff}`;
    const good = (diff > 0) === HIGHER_IS_BETTER[k.id];
    return h('span', { class: `delta ${good ? 'up' : 'down'}${inline ? ' inline' : ''}`, title: `${prevLabel}: ${fmtKpi({ ...k, value: k.prev })}` }, `${diff > 0 ? '▲' : '▼'} ${pct} ggü. ${prevLabel}`);
  }
  const fmtKpi = (k) => (k.value == null ? '–' : k.unit === 'eur' ? eur(Math.round(k.value)) : k.unit === 'pct' ? `${Math.round(k.value)} %` : String(k.value));
  const fmtTarget = (k) => (k.target == null ? null : `Ziel ${k.unit === 'eur' ? eur(k.target) : `${k.target} %`}`);
  // ---------- Zeitraum: Monat, Jahr oder von–bis ----------
  const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  const addDays = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const shiftMonth = (m, n) => { const [y, mm] = m.split('-').map(Number); const t = new Date(Date.UTC(y, mm - 1 + n, 1)); return t.toISOString().slice(0, 7); };
  const startMonth = window.COCKPIT_DEFAULT_MONTH || thisMonth();
  const period = (() => { try { const p = JSON.parse(store.get('cockpit.period')); if (p && p.mode) return p; } catch { /* */ } return { mode: 'monat', month: startMonth, year: Number(startMonth.slice(0, 4)), from: addDays(todayStr(), -6), to: todayStr() }; })();
  const savePeriod = () => store.set('cockpit.period', JSON.stringify(period));
  const pq = () => (period.mode === 'monat' ? `month=${period.month}` : period.mode === 'jahr' ? `from=${period.year}-01-01&to=${period.year}-12-31` : `from=${period.from}&to=${period.to}`);
  const monthLabel = (m) => new Date(`${m}-15T12:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const periodLabel = () => (period.mode === 'monat' ? monthLabel(period.month) : period.mode === 'jahr' ? `Jahr ${period.year}` : `${dmy(period.from)} – ${dmy(period.to)}`);
  const month = { toString: () => (period.mode === 'monat' ? period.month : period.mode === 'jahr' ? `${period.year}` : `${period.from}_${period.to}`) };
  function periodPicker(onChange, opts = {}) {
    const go = () => { savePeriod(); onChange(); };
    const box = h('div', { class: `period${opts.dark ? ' on-night' : ''}` });
    const step = (n) => () => { if (period.mode === 'monat') period.month = shiftMonth(period.month, n); else if (period.mode === 'jahr') period.year += n; else { const len = Math.round((Date.parse(period.to) - Date.parse(period.from)) / 86_400_000) + 1; period.from = addDays(period.from, n * len); period.to = addDays(period.to, n * len); } go(); };
    const modes = h('div', { class: 'period-modes', role: 'tablist' }, [['monat', 'Monat'], ['jahr', 'Jahr'], ['zeitraum', 'Von – bis']].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(period.mode === k), class: period.mode === k ? 'active' : '', onclick: () => { period.mode = k; go(); } }, l)));
    let inputs;
    if (period.mode === 'monat') inputs = h('input', { type: 'month', id: 'p-month', value: period.month, onchange: (e) => { if (e.target.value) { period.month = e.target.value; go(); } } });
    else if (period.mode === 'jahr') inputs = h('select', { id: 'p-year', onchange: (e) => { period.year = Number(e.target.value); go(); } }, Array.from({ length: 6 }, (_, i) => Number(todayStr().slice(0, 4)) - 4 + i).map((y) => h('option', { value: y, selected: y === period.year }, y)));
    else {
      const f = h('input', { type: 'date', id: 'p-from', value: period.from, max: period.to });
      const t = h('input', { type: 'date', id: 'p-to', value: period.to, min: period.from });
      const apply = () => { if (f.value && t.value && f.value <= t.value) { period.from = f.value; period.to = t.value; go(); } };
      f.addEventListener('change', apply); t.addEventListener('change', apply);
      const preset = (label, from, to) => h('button', { type: 'button', class: 'preset', onclick: () => { period.from = from; period.to = to; go(); } }, label);
      const td = todayStr(); const wd = (new Date(`${td}T12:00:00Z`).getUTCDay() + 6) % 7;
      inputs = h('div', { class: 'period-range' }, f, h('span', { class: 'muted' }, '–'), t,
        h('div', { class: 'presets' }, preset('Diese Woche', addDays(td, -wd), td), preset('Letztes Wochenende', addDays(td, -wd - 3), addDays(td, -wd - 1)), preset('Letzte 7 Tage', addDays(td, -6), td), preset('Letzte 30 Tage', addDays(td, -29), td)));
    }
    box.append(modes, h('div', { class: 'period-row' }, h('button', { type: 'button', class: 'nav-step', 'aria-label': 'Zurück', onclick: step(-1) }, '‹'), inputs, h('button', { type: 'button', class: 'nav-step', 'aria-label': 'Weiter', onclick: step(1) }, '›')));
    return box;
  }
  const monthPicker = (onChange) => periodPicker(onChange);

  async function viewHeute() {
    const d = await api('GET', `/dashboard?${pq()}`);
    const go = { einkauf: 'einkauf', bar: 'bar', personal: 'personal', kurse: 'kurse', ziele: 'ziele', kasse: 'kasse' };
    const SEV = { bad: 'Dringend', warn: 'Bald', info: 'Hinweis', ok: 'Gut' };
    const items = (list) => (list.length ? h('ul', { class: 'list' }, list.map((t) => h('li', { class: t.level }, h('span', { class: `sev ${t.level}` }, SEV[t.level] || ''), h('span', { class: 'list-text' }, t.text), t.tab && go[t.tab] && h('button', { type: 'button', class: 'link', onclick: () => route(go[t.tab]) }, 'öffnen')))) : h('p', { class: 'muted' }, 'Nichts offen.'));
    const profit = d.kpis.find((k) => k.id === 'profit');
    const urgent = d.todos.filter((t) => t.level === 'bad').length;
    const monthName = periodLabel();
    const prevLabel = period.mode === 'monat' ? 'Vormonat' : period.mode === 'jahr' ? 'Vorjahr' : 'Vorzeitraum';
    return h('div', {},
      h('section', { class: 'hero' },
        h('div', { class: 'hero-top' }, h('span', { class: 'eyebrow' }, `Wo stehe ich? · ${monthName}`), periodPicker(() => route('heute'), { dark: true })),
        h('div', { class: 'hero-grid' },
          h('p', { class: 'hero-figure' }, countUp(h('span', { class: `fig${profit.value < 0 ? ' neg' : ''}` }, eur(Math.round(profit.value))), profit.value), h('small', {}, period.mode === 'monat' ? 'Ergebnis im Monat' : 'Ergebnis im Zeitraum', delta(profit, prevLabel, true))),
          sparkline(d.bar.daily)),
        h('p', { class: 'hero-line' }, urgent ? `${urgent} ${urgent === 1 ? 'Sache braucht' : 'Sachen brauchen'} dich jetzt, ${d.todos.length - urgent} weitere stehen an.` : d.todos.length ? `Nichts Dringendes. ${d.todos.length} Punkte stehen an.` : 'Alles im grünen Bereich.')),
      h('div', { class: 'kpis' }, d.kpis.filter((k) => k.id !== 'profit').map((k) => kpiTile(k.label, fmtKpi(k), [fmtTarget(k), k.hint].filter(Boolean).join(' · '), k.status, delta(k, prevLabel)))),
      h('h2', {}, 'Was jetzt zu tun ist'), h('div', { class: 'card' }, items(d.todos)),
      h('h2', {}, 'Was verbessert werden sollte'), h('div', { class: 'card' }, items(d.insights)),
      h('h2', {}, 'Umsatz pro Abend'), h('div', { class: 'card' }, barChart(d.bar.daily), h('p', { class: 'small muted legend' }, h('span', { class: 'sw drinks' }), 'Getränke  ', h('span', { class: 'sw tickets' }), 'Eintritt & Workshops')),
      d.bar.ticketMix.length > 0 && h('div', {}, h('h2', {}, 'Gäste-Mix'), h('div', { class: 'card table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Ticket'), h('th', { class: 'num' }, 'Personen'), h('th', { class: 'num' }, 'Umsatz')), d.bar.ticketMix.map((t) => h('tr', {}, h('td', {}, t.name), h('td', { class: 'num' }, t.qty), h('td', { class: 'num' }, eur(t.revenueCents))))))),
      d.bar.topProducts.length > 0 && h('div', {}, h('h2', {}, 'Bestseller'), h('div', { class: 'card table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Artikel'), h('th', { class: 'num' }, 'Stück'), h('th', { class: 'num' }, 'Umsatz')), d.bar.topProducts.slice(0, 8).map((p) => h('tr', {}, h('td', {}, p.name), h('td', { class: 'num' }, p.qty), h('td', { class: 'num' }, eur(p.revenueCents))))))),
      h('h2', {}, 'Monat in Zahlen'), h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, h('td', {}, 'Kurseinnahmen'), h('td', { class: 'num' }, eur(d.totals.incomeCents - d.bar.revenueCents - d.bar.ticketRevenueCents))),
        h('tr', {}, h('td', {}, 'Eintritt & Workshops'), h('td', { class: 'num' }, eur(d.bar.ticketRevenueCents))),
        h('tr', {}, h('td', {}, 'Getränke'), h('td', { class: 'num' }, eur(d.bar.revenueCents))),
        h('tr', {}, h('td', {}, 'Personalkosten'), h('td', { class: 'num' }, `− ${eur(d.personnel.totalCents)}`)),
        h('tr', {}, h('td', {}, 'Fixkosten'), h('td', { class: 'num' }, `− ${eur(d.totals.fixedCents)}`)),
        h('tr', {}, h('th', {}, 'Ergebnis'), h('th', { class: 'num' }, eur(d.totals.profitCents))))),
      h('p', { class: 'muted small' }, 'Prototyp: Wareneinkauf ist noch nicht abgezogen. Kurseinnahmen zählen im Monat der Anmeldung.'));
  }

  // Grosse Zahl zaehlt beim Oeffnen kurz hoch (ohne Bewegung, wenn reduziert gewuenscht)
  function countUp(el, cents) {
    if (!Number.isFinite(cents) || matchMedia('(prefers-reduced-motion: reduce)').matches) return el;
    const t0 = performance.now(), dur = 700;
    const step = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - (1 - k) ** 3; el.textContent = eur(Math.round((cents * e) / 100) * 100); if (k < 1) requestAnimationFrame(step); else el.textContent = eur(Math.round(cents)); };
    requestAnimationFrame(step);
    return el;
  }
  function sparkline(daily) {
    if (daily.length < 2) return null;
    const W = 260, H = 64, max = Math.max(...daily.map((x) => x.revenueCents), 1);
    const pts = daily.map((x, i) => [(i / (daily.length - 1)) * (W - 8) + 4, H - 6 - ((H - 14) * x.revenueCents) / max]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'spark', role: 'img', 'aria-label': 'Umsatz pro Abend im Verlauf' });
    s.append(svg('path', { d: `${line} L${pts.at(-1)[0]},${H} L${pts[0][0]},${H} Z`, class: 'spark-area' }), svg('path', { d: line, class: 'spark-line', pathLength: 1 }));
    const [ex, ey] = pts.at(-1); s.append(svg('circle', { cx: ex, cy: ey, r: 4, class: 'spark-dot' }));
    const wrap = h('figure', { class: 'spark-wrap' }, s, h('figcaption', {}, `Umsatz pro Abend · ${daily.length} Abende`));
    return wrap;
  }

  function barChart(daily) {
    if (!daily.length) return h('p', { class: 'muted' }, 'Noch keine Kassen in diesem Monat.');
    const W = 600, H = 160, pad = 22, max = Math.max(...daily.map((x) => x.revenueCents), 1);
    const bw = Math.min(40, (W - pad) / daily.length - 4);
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Bar-Umsatz pro Abend' });
    daily.forEach((x, i) => {
      const bh = ((H - pad - 14) * x.revenueCents) / max; const xx = pad + i * ((W - pad) / daily.length) + 2;
      const dh = ((H - pad - 14) * x.drinksCents) / max;
      const g = svg('g', {});
      g.append(svg('rect', { x: xx, y: H - pad - bh, width: bw, height: bh - dh, class: 'bar tickets' }), svg('rect', { x: xx, y: H - pad - dh, width: bw, height: dh, class: x.revenueCents === max ? 'bar peak' : 'bar' }));
      const title = svg('title', {}); title.textContent = `${dmy(x.date)}: ${eur(x.revenueCents)} (Getränke ${eur(x.drinksCents)}, Eintritt ${eur(x.ticketCents)}, ${x.guests} Gäste)`; g.append(title); s.append(g);
      const lbl = svg('text', { x: xx + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis' }); lbl.textContent = x.date.slice(8); s.append(lbl);
      const v = svg('text', { x: xx + bw / 2, y: H - pad - bh - 4, 'text-anchor': 'middle', class: 'axis' }); v.textContent = Math.round(x.revenueCents / 100); s.append(v);
    });
    return s;
  }

  // ---------- Chef: Jahresuebersicht & Monatsvergleich ----------
  let cmp = null;
  async function viewJahr() {
    const year = period.year || Number(todayStr().slice(0, 4));
    const y = await api('GET', `/year?year=${year}`);
    const MN = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
    const active = y.months.filter((m) => m.nights || m.incomeCents);
    if (!cmp || !cmp.a.startsWith(String(year))) { const l = active.slice(-2); cmp = { a: (l[0] || y.months[0]).month, b: (l[1] || l[0] || y.months[1]).month }; }
    const yearSel = h('div', { class: 'period-row' },
      h('button', { type: 'button', class: 'nav-step', 'aria-label': 'Vorjahr', onclick: () => { period.year = year - 1; savePeriod(); route('jahr'); } }, '‹'),
      h('b', { class: 'year-label' }, String(year)),
      h('button', { type: 'button', class: 'nav-step', 'aria-label': 'Folgejahr', onclick: () => { period.year = year + 1; savePeriod(); route('jahr'); } }, '›'));
    const openMonth = (m) => () => { period.mode = 'monat'; period.month = m; savePeriod(); route('heute'); };
    const best = [...active].sort((a, b) => b.profitCents - a.profitCents)[0];

    // Diagramm: Einnahmen gestapelt (Kurse, Eintritt, Getraenke) und Kosten als Linie
    const W = 640, H = 230, pl = 44, pb = 24, pt = 12;
    const max = Math.max(1, ...y.months.map((m) => Math.max(m.incomeCents, m.costsCents)));
    const colW = (W - pl - 8) / 12, bw = colW - 12;
    const sx = (i) => pl + i * colW + 6;
    const sy = (v) => H - pb - ((H - pb - pt) * v) / max;
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart yearchart', role: 'img', 'aria-label': 'Einnahmen und Kosten pro Monat' });
    for (let g = 0; g <= 4; g++) {
      const v = (max * g) / 4, yy = sy(v);
      chart.append(svg('line', { x1: pl, x2: W - 8, y1: yy, y2: yy, class: 'grid' }));
      const t = svg('text', { x: pl - 6, y: yy + 3, 'text-anchor': 'end', class: 'axis' }); t.textContent = `${Math.round(v / 100000)}k`; chart.append(t);
    }
    y.months.forEach((m, i) => {
      const g = svg('g', { class: 'mbar' });
      let base = 0;
      for (const [val, cls] of [[m.courseCents, 'seg-course'], [m.ticketCents, 'seg-ticket'], [m.drinksCents, 'seg-drinks']]) {
        if (val > 0) g.append(svg('rect', { x: sx(i), y: sy(base + val), width: bw, height: sy(base) - sy(base + val), class: cls }));
        base += val;
      }
      const hit = svg('rect', { x: sx(i) - 6, y: pt, width: colW, height: H - pb - pt, class: 'hit' });
      const ttl = svg('title', {}); ttl.textContent = `${MN[i]}: Einnahmen ${eur(m.incomeCents)}, Kosten ${eur(m.costsCents)}, Ergebnis ${eur(m.profitCents)}`; hit.append(ttl);
      hit.addEventListener('click', openMonth(m.month));
      g.append(hit); chart.append(g);
      const t = svg('text', { x: sx(i) + bw / 2, y: H - 8, 'text-anchor': 'middle', class: m.empty ? 'axis empty' : 'axis' }); t.textContent = MN[i]; chart.append(t);
    });
    chart.append(svg('path', { d: y.months.map((m, i) => `${i ? 'L' : 'M'}${(sx(i) + bw / 2).toFixed(1)},${sy(m.costsCents).toFixed(1)}`).join(' '), class: 'cost-line', pathLength: 1 }));
    y.months.forEach((m, i) => chart.append(svg('circle', { cx: sx(i) + bw / 2, cy: sy(m.costsCents), r: 3, class: 'cost-dot' })));

    // Monatsvergleich A gegen B
    const mA = y.months.find((m) => m.month === cmp.a) || y.months[0];
    const mB = y.months.find((m) => m.month === cmp.b) || y.months[1];
    const ROWS = [['Kassenabende', 'nights', 'n', true], ['Gäste', 'guests', 'n', true], ['Eintritt & Workshops', 'ticketCents', 'eur', true], ['Getränke', 'drinksCents', 'eur', true], ['Kurseinnahmen', 'courseCents', 'eur', true], ['Einnahmen gesamt', 'incomeCents', 'eur', true], ['Personalkosten', 'personnelCents', 'eur', false], ['Fixkosten', 'fixedCents', 'eur', false], ['Ergebnis', 'profitCents', 'eur', true], ['Getränke pro Gast', 'perGuestCents', 'eur', true], ['Fehlmenge Inventar', 'missingUnits', 'n', false]];
    const fmt = (v, u) => (v == null ? '–' : u === 'eur' ? eur(Math.round(v)) : String(v));
    const monthSel = (id, key) => h('select', { id, onchange: (e) => { cmp[key] = e.target.value; route('jahr'); } }, y.months.map((m, i) => h('option', { value: m.month, selected: m.month === cmp[key] }, `${MN[i]} ${year}`)));
    const compare = h('div', { class: 'card' },
      h('div', { class: 'cmp-pick' }, field('Monat A', monthSel('cmp-a', 'a')), h('span', { class: 'vs' }, 'vs.'), field('Monat B', monthSel('cmp-b', 'b'))),
      h('div', { class: 'table-wrap' }, h('table', { class: 'nosort' },
        h('tr', {}, h('th', {}, 'Kennzahl'), h('th', { class: 'num' }, MN[Number(cmp.a.slice(5)) - 1]), h('th', { class: 'num' }, MN[Number(cmp.b.slice(5)) - 1]), h('th', { class: 'num' }, 'Veränderung')),
        ROWS.map(([label, key, u, hib]) => {
          const a = mA[key], b = mB[key];
          let dcell = h('td', { class: 'num muted' }, '–');
          if (a != null && b != null && a !== b) {
            const diff = b - a, good = (diff > 0) === hib;
            dcell = h('td', { class: `num ${good ? 'oktxt' : 'badtxt'}` }, `${diff > 0 ? '▲' : '▼'} ${a ? `${diff > 0 ? '+' : ''}${Math.round((diff / Math.abs(a)) * 100)} %` : fmt(diff, u)}`);
          }
          return h('tr', { class: key === 'profitCents' ? 'strong' : '' }, h('td', {}, label), h('td', { class: 'num' }, fmt(a, u)), h('td', { class: 'num' }, fmt(b, u)), dcell);
        }))));

    const cell = (v, extra = '') => h('td', { class: `num ${extra}` }, v);
    return h('div', {},
      h('div', { class: 'row spread' }, h('h1', {}, 'Jahresübersicht'), yearSel),
      h('div', { class: 'kpis' },
        kpiTile('Einnahmen', eur(y.totals.incomeCents), `${y.totals.nights} Kassenabende · ${y.totals.guests} Gäste`, 'none'),
        kpiTile('Kosten', eur(y.totals.costsCents), `Personal ${eur(y.totals.personnelCents)} · Fix ${eur(y.totals.fixedCents)}`, 'none'),
        kpiTile('Ergebnis', eur(y.totals.profitCents), `${active.length} Monate mit Daten`, y.totals.profitCents >= 0 ? 'ok' : 'bad'),
        kpiTile('Bester Monat', best ? MN[Number(best.month.slice(5)) - 1] : '–', best ? `Ergebnis ${eur(best.profitCents)}` : '', 'none')),
      h('h2', {}, 'Einnahmen und Kosten pro Monat'),
      h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, chart),
        h('p', { class: 'small muted legend' }, h('span', { class: 'sw course' }), 'Kurse', h('span', { class: 'sw tickets' }), 'Eintritt & Workshops', h('span', { class: 'sw drinks' }), 'Getränke', h('span', { class: 'sw costline' }), 'Kosten'),
        h('p', { class: 'small muted' }, 'Auf einen Monat tippen, um ihn auf „Heute" im Detail zu öffnen. Monate ohne Daten zählen keine Fixkosten.')),
      h('h2', {}, 'Monate vergleichen'), compare,
      h('h2', {}, 'Alle Monate · Spalte antippen zum Sortieren'),
      h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, h('th', {}, 'Monat'), h('th', { class: 'num' }, 'Abende'), h('th', { class: 'num' }, 'Gäste'), h('th', { class: 'num' }, 'Eintritt'), h('th', { class: 'num' }, 'Getränke'), h('th', { class: 'num' }, 'Kurse'), h('th', { class: 'num' }, 'Personal'), h('th', { class: 'num' }, 'Fixkosten'), h('th', { class: 'num' }, 'Ergebnis')),
        y.months.map((m, i) => h('tr', { class: 'clickable', onclick: openMonth(m.month) }, h('td', { 'data-sort': m.month }, `${MN[i]} ${year}`), cell(m.nights), cell(m.guests), cell(eur(m.ticketCents)), cell(eur(m.drinksCents)), cell(eur(m.courseCents)), cell(eur(m.personnelCents)), cell(eur(m.fixedCents)), cell(eur(m.profitCents), m.profitCents < 0 ? 'badtxt' : ''))),
        h('tr', { class: 'total-row' }, h('td', {}, 'Summe'), cell(y.totals.nights), cell(y.totals.guests), cell(eur(y.totals.ticketCents)), cell(eur(y.totals.drinksCents)), cell(eur(y.totals.courseCents)), cell(eur(y.totals.personnelCents)), cell(eur(y.totals.fixedCents)), cell(eur(y.totals.profitCents))))));
  }

  // ---------- Chef: Abrechnungen ----------
  async function viewBar() {
    const list = await api('GET', `/bar/sessions?${pq()}`);
    return h('div', {},
      h('div', { class: 'row spread' }, h('h1', {}, 'Abrechnungen'), monthPicker(() => route('bar'))),
      list.length ? h('div', { class: 'card table-wrap' }, h('table', {},
        h('tr', {}, h('th', {}, 'Datum'), h('th', {}, 'Standort'), h('th', {}, 'Kasse'), h('th', { class: 'num' }, 'Umsatz'), h('th', { class: 'num' }, 'Kasse ±'), h('th', { class: 'num' }, 'Fehlt'), h('th', {}, '')),
        list.map((s) => h('tr', {}, h('td', {}, dmy(s.date)), h('td', {}, LOC[s.location]), h('td', {}, h('span', { class: `stn ${s.station}` }, STATION_SHORT[s.station])), h('td', { class: 'num' }, eur(s.revenueCents)), s.status === 'open' ? h('td', { class: 'num muted' }, 'offen') : diffCell(s.cashDiffCents, true), h('td', { class: 'num' }, s.status === 'open' || s.station === 'tuer' ? '–' : s.missingUnits), h('td', {}, h('button', { type: 'button', class: 'link', onclick: () => route('abrechnung', s) }, 'Details')))))) : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'Keine Kassen in diesem Monat.')));
  }

  // ---------- Chef: Einkaufsliste & Export ----------
  async function download(kind) {
    if (window.COCKPIT_DEMO) { toast('In der Demo nicht verfügbar – in der echten App lädt hier die Excel-Datei.'); return; }
    const res = await fetch(`/app/api/export/${kind}?${pq()}`, { headers: { Authorization: `Bearer ${auth.token}` } });
    if (!res.ok) throw new Error('Export fehlgeschlagen');
    const url = URL.createObjectURL(await res.blob());
    const a = h('a', { href: url, download: `salsamas-${kind}-${month}.csv` }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function viewEinkauf() {
    const d = await api('GET', `/dashboard?${pq()}`);
    const text = Object.keys(LOC).map((l) => { const x = d.shopping.filter((i) => i.location === l); return x.length ? `Einkauf ${LOC[l]}:\n${x.map((i) => `- ${i.need}× ${i.name}`).join('\n')}` : ''; }).filter(Boolean).join('\n\n');
    return h('div', {}, h('h1', {}, 'Einkaufsliste'),
      h('p', { class: 'muted small' }, 'Aus dem letzten gezählten Endbestand und dem Ø-Verbrauch der letzten 4 Abende (mit 50 % Puffer).'),
      Object.keys(LOC).map((l) => { const x = d.shopping.filter((i) => i.location === l); return h('div', { class: 'card' }, h('b', {}, LOC[l]), x.length ? h('table', {}, h('tr', {}, h('th', {}, 'Artikel'), h('th', { class: 'num' }, 'Bestand'), h('th', { class: 'num' }, 'Ø/Abend'), h('th', { class: 'num' }, 'Kaufen')), x.map((i) => h('tr', {}, h('td', {}, i.name), h('td', { class: 'num' }, i.stock), h('td', { class: 'num' }, String(i.avgPerNight).replace('.', ',')), h('td', { class: 'num' }, h('b', {}, i.need))))) : h('p', { class: 'muted' }, 'Alles ausreichend da.')); }),
      text && h('button', { class: 'btn', type: 'button', onclick: run(async () => { await navigator.clipboard.writeText(text); toast('Liste kopiert – z. B. in WhatsApp einfügen'); }) }, 'Liste kopieren (für WhatsApp)'),
      h('h2', {}, 'Export für Buchhaltung'),
      h('div', { class: 'card' }, h('div', { class: 'row spread' }, h('span', {}, 'Monat'), monthPicker(() => route('einkauf'))),
        h('p', { class: 'muted small' }, 'CSV-Dateien, öffnen sich direkt in Excel oder Numbers.'),
        h('div', { class: 'row' }, h('button', { class: 'btn secondary', type: 'button', onclick: run(() => download('abende')) }, 'Kassenabende'), h('button', { class: 'btn secondary', type: 'button', onclick: run(() => download('schichten')) }, 'Stunden & Löhne'))));
  }

  // ---------- Chef: Personal ----------
  async function viewPersonal() {
    const [staff, shifts, d] = await Promise.all([api('GET', '/staff'), api('GET', `/shifts?${pq()}`), api('GET', `/dashboard?${pq()}`)]);
    const by = new Map(d.personnel.byStaff.map((x) => [x.ref, x]));
    const limit = d.settings.minijobLimitCents;
    const ref = h('input', { required: true, placeholder: 'Kürzel, z. B. lena' });
    const pin = h('input', { required: true, inputmode: 'numeric', minlength: 6, maxlength: 8, placeholder: '6–8 Ziffern' });
    const rate = h('input', { required: true, inputmode: 'decimal', placeholder: 'z. B. 13,90' });
    const ms = { staffRef: select(Object.fromEntries(staff.map((p) => [p.ref, p.ref])), staff[0]?.ref), kind: select(KIND, 'bar'), location: select(LOC, loc), start: h('input', { type: 'datetime-local', required: true }), end: h('input', { type: 'datetime-local', required: true }) };
    return h('div', {},
      h('div', { class: 'row spread' }, h('h1', {}, 'Personal'), monthPicker(() => route('personal'))),
      h('div', { class: 'kpis' }, kpiTile('Personalkosten', eur(d.personnel.totalCents), `davon Bar ${eur(d.personnel.barCents)}`, 'none'), kpiTile('Personalquote Bar', d.kpis.find((k) => k.id === 'barPersonnelPct').value == null ? '–' : `${Math.round(d.kpis.find((k) => k.id === 'barPersonnelPct').value)} %`, `Ziel ${d.settings.targets.barPersonnelPct} %`, d.kpis.find((k) => k.id === 'barPersonnelPct').status)),
      h('h2', {}, 'Team & Minijob-Grenze'),
      h('div', { class: 'card' }, staff.length ? staff.map((p) => {
        const x = by.get(p.ref) || { hours: 0, earnedCents: 0, minijobPct: 0 };
        const m = h('div', { class: `meter ${x.minijobPct >= 100 ? 'bad' : x.minijobPct >= 85 ? 'warn' : ''}` }, h('span', {}));
        m.firstChild.style.width = `${Math.min(100, x.minijobPct || 0)}%`;
        return h('div', { class: 'staffrow' },
          h('div', { class: 'row spread' }, h('b', {}, p.ref, p.active ? '' : ' (inaktiv)'), h('span', { class: 'small' }, `${x.hours.toLocaleString('de-DE')} Std. · ${eur(x.earnedCents)} von ${eur(limit)} · ${eur(p.hourlyRateCents)}/Std.`)), m,
          h('div', { class: 'row small' },
            h('button', { type: 'button', class: 'link', onclick: run(async () => { const v = await ask(`Neuer Stundenlohn für ${p.ref} in €`, { value: fromCents(p.hourlyRateCents), inputmode: 'decimal' }); if (v == null) return; const c = toCents(v); if (c == null) throw new Error('Betrag prüfen'); await api('PATCH', `/staff/${p.id}`, { hourlyRateCents: c }); route('personal'); }) }, 'Lohn ändern'),
            h('button', { type: 'button', class: 'link', onclick: run(async () => { const v = await ask(`Neue PIN für ${p.ref} (6–8 Ziffern)`, { value: '', inputmode: 'numeric' }); if (!v) return; await api('PATCH', `/staff/${p.id}`, { pin: v.trim() }); toast('PIN geändert'); }) }, 'PIN ändern'),
            h('button', { type: 'button', class: 'link', onclick: run(async () => { await api('PATCH', `/staff/${p.id}`, { active: !p.active }); route('personal'); }) }, p.active ? 'Deaktivieren' : 'Aktivieren')));
      }) : h('p', { class: 'muted' }, 'Noch niemand angelegt.')),
      h('details', { class: 'card' }, h('summary', {}, '+ Person anlegen'),
        h('form', { onsubmit: run(async () => { const c = toCents(rate.value); if (c == null) throw new Error('Stundenlohn prüfen'); await api('POST', '/staff', { ref: ref.value.trim(), pin: pin.value.trim(), hourlyRateCents: c }); toast('Angelegt – Kürzel und PIN weitergeben'); route('personal'); }) },
          h('div', { class: 'grid3' }, field('Kürzel', ref), field('PIN', pin), field('Stundenlohn €', rate)),
          h('p', { class: 'muted small' }, 'Nur Kürzel oder Vorname, keine vollen Namen. Die PIN gibst du der Person persönlich.'),
          h('button', { class: 'btn', type: 'submit' }, 'Anlegen'))),
      d.personnel.helpers.length > 0 && h('div', {}, h('h2', {}, 'Aushilfen'),
        h('div', { class: 'card table-wrap' }, h('table', {},
          h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'Datum'), h('th', {}, 'Standort'), h('th', { class: 'num' }, 'Std.'), h('th', { class: 'num' }, 'Lohn'), h('th', {}, 'Auszahlung'), h('th', {}, '')),
          d.personnel.helpers.map((x) => h('tr', {}, h('td', {}, x.name), h('td', {}, dmy(x.date)), h('td', {}, LOC[x.location]), h('td', { class: 'num' }, x.hours.toLocaleString('de-DE')), h('td', { class: 'num' }, eur(x.payCents)),
            h('td', {}, x.payout === 'bar' ? h('span', { class: 'chip ok' }, 'bar bezahlt') : x.paid ? h('span', { class: 'chip ok' }, 'überwiesen') : h('span', { class: 'chip warn' }, 'überweisen')),
            h('td', {}, x.payout === 'ueberweisung' && h('button', { type: 'button', class: 'link', onclick: run(async () => { await api('PATCH', `/shifts/${x.id}`, { paid: !x.paid }); toast(x.paid ? 'Wieder offen' : 'Als überwiesen markiert'); route('personal'); }) }, x.paid ? 'zurücksetzen' : 'als überwiesen markieren'))))))),
      h('h2', {}, 'Schichten'),
      h('div', { class: 'card table-wrap' }, shifts.length ? h('table', {}, h('tr', {}, h('th', {}, 'Wer'), h('th', {}, 'Wann'), h('th', {}, 'Was'), h('th', { class: 'num' }, 'Std.'), h('th', { class: 'num' }, 'Kosten'), h('th', {}, '')),
        shifts.map((s) => h('tr', {}, h('td', {}, s.helper ? `${s.staffRef} (Aushilfe)` : s.staffRef), h('td', {}, `${dateTime(s.start)}–${s.end ? time(s.end) : 'läuft'}`), h('td', {}, `${KIND[s.kind]}, ${LOC[s.location]}`), h('td', { class: 'num' }, hours(s.start, s.end).toFixed(1).replace('.', ',')), h('td', { class: 'num' }, eur(Math.round(hours(s.start, s.end) * s.rateCents))),
          h('td', {}, h('button', { type: 'button', class: 'link', onclick: run(async () => { if (!await ask('Schicht löschen?')) return; await api('DELETE', `/shifts/${s.id}`); route('personal'); }) }, 'löschen'))))) : h('p', { class: 'muted' }, 'Keine Schichten in diesem Monat.')),
      staff.length > 0 && h('details', { class: 'card' }, h('summary', {}, '+ Schicht nachtragen / korrigieren'),
        h('form', { onsubmit: run(async () => { await api('POST', '/shifts', { staffRef: ms.staffRef.value, kind: ms.kind.value, location: ms.location.value, start: new Date(ms.start.value).toISOString(), end: new Date(ms.end.value).toISOString() }); toast('Gespeichert'); route('personal'); }) },
          h('div', { class: 'grid2' }, field('Wer', ms.staffRef), field('Tätigkeit', ms.kind), field('Standort', ms.location), h('span'), field('Von', ms.start), field('Bis', ms.end)),
          h('button', { class: 'btn', type: 'submit' }, 'Speichern'))));
  }

  // ---------- Chef: Kurse ----------
  async function viewKurse() {
    const d = await api('GET', `/dashboard?${pq()}`);
    const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
    const rows = d.courses.rows.filter((c) => c.published);
    return h('div', {}, h('h1', {}, 'Kurse'),
      h('div', { class: 'kpis' }, ['utilizationPct', 'openPaymentsPct', 'courseRevenue'].map((id) => { const k = d.kpis.find((x) => x.id === id); return kpiTile(k.label, fmtKpi(k), [fmtTarget(k), k.hint].filter(Boolean).join(' · '), k.status); })),
      h('div', { class: 'card table-wrap' }, rows.length ? h('table', {}, h('tr', {}, h('th', {}, 'Kurs'), h('th', {}, 'Wann'), h('th', {}, 'Standort'), h('th', { class: 'num' }, 'Belegt'), h('th', {}, 'Auslastung'), h('th', { class: 'num' }, 'offen')),
        rows.map((c) => { const m = h('div', { class: `meter ${c.utilizationPct < 50 ? 'bad' : c.utilizationPct < d.settings.targets.utilizationPct ? 'warn' : ''}` }, h('span', {})); m.firstChild.style.width = `${Math.min(100, c.utilizationPct || 0)}%`; return h('tr', {}, h('td', {}, c.title), h('td', {}, `${WD[c.weekday]} ${c.startTime}`), h('td', {}, LOC[c.location]), h('td', { class: 'num' }, `${c.participants}/${c.capacity}`), h('td', { class: 'meter-cell' }, m), h('td', { class: 'num' }, c.open)); })) : h('p', { class: 'muted' }, 'Keine veröffentlichten Kurse.')),
      h('p', { class: 'muted small' }, 'Kurse und Anmeldungen kommen aus der bestehenden Salsamás-API (später automatisch aus Bsport).'));
  }

  // ---------- Chef: Getraenke ----------
  async function viewArtikel() {
    const list = await api('GET', '/products');
    const name = h('input', { required: true, maxlength: 40, placeholder: 'z. B. Mojito oder Eintritt Übungsabend' });
    const price = h('input', { required: true, inputmode: 'decimal', placeholder: '8,50' });
    const cat = select(CAT, 'eintritt');
    return h('div', {}, h('h1', {}, 'Getränke & Preise'),
      h('form', { class: 'card', onsubmit: run(async () => { const c = toCents(price.value); if (c == null) throw new Error('Preis prüfen'); await api('POST', '/products', { name: name.value.trim(), priceCents: c, category: cat.value }); toast('Angelegt'); route('artikel'); }) },
        h('div', { class: 'grid3' }, field('Name', name), field('Preis €', price), field('Kategorie', cat)), h('button', { class: 'btn', type: 'submit' }, '+ Hinzufügen')),
      h('div', { class: 'card table-wrap' }, list.length ? h('table', {}, h('tr', {}, h('th', {}, 'Artikel'), h('th', {}, 'Kategorie'), h('th', { class: 'num' }, 'Preis'), h('th', {}, '')),
        list.map((p) => h('tr', { class: p.active ? '' : 'muted' }, h('td', {}, p.name), h('td', {}, CAT[p.category]), h('td', { class: 'num' }, eur(p.priceCents)),
          h('td', { class: 'row' },
            h('button', { type: 'button', class: 'link', onclick: run(async () => { const v = await ask(`Neuer Preis für ${p.name} in €`, { value: fromCents(p.priceCents), inputmode: 'decimal' }); if (v == null) return; const c = toCents(v); if (c == null) throw new Error('Preis prüfen'); await api('PATCH', `/products/${p.id}`, { priceCents: c }); route('artikel'); }) }, 'Preis'),
            h('button', { type: 'button', class: 'link', onclick: run(async () => { await api('PATCH', `/products/${p.id}`, { active: !p.active }); route('artikel'); }) }, p.active ? 'ausblenden' : 'einblenden'))))) : h('p', { class: 'muted' }, 'Noch keine Getränke.')),
      h('p', { class: 'muted small' }, 'Eintritt und Workshops zählen jeden Gast, haben aber kein Inventar. Kursgebühren (z. B. „Kurs 4 Wochen", „Einzelstunde") laufen ohne Inventar in die Kurseinnahmen. Für Workshop-Teilnehmer, die zum Übungsabend bleiben, ein Ticket mit 0 € anlegen (z. B. „Workshop-Teilnehmer inkl."). Ausgeblendete Artikel erscheinen nicht mehr an der Kasse, alte Abrechnungen bleiben erhalten. Preisänderungen gelten ab dem nächsten Verkauf.'));
  }

  // ---------- Chef: Ziele & Kosten ----------
  async function viewZiele() {
    const s = await api('GET', '/settings');
    const t = s.targets;
    const f = {
      util: h('input', { type: 'number', min: 0, max: 100, value: t.utilizationPct }), open: h('input', { type: 'number', min: 0, max: 100, value: t.openPaymentsPct }),
      perGuest: h('input', { inputmode: 'decimal', value: fromCents(t.barPerGuestCents) }), pers: h('input', { type: 'number', min: 0, max: 200, value: t.barPersonnelPct }),
      fixM: h('input', { inputmode: 'decimal', value: fromCents(s.fixedCostsCents.maxvorstadt) }), fixP: h('input', { inputmode: 'decimal', value: fromCents(s.fixedCostsCents.pasing) }),
      mini: h('input', { inputmode: 'decimal', value: fromCents(s.minijobLimitCents) }),
    };
    return h('form', { onsubmit: run(async () => {
      const c = [f.perGuest, f.fixM, f.fixP, f.mini].map((i) => toCents(i.value));
      if (c.some((x) => x == null)) throw new Error('Beträge prüfen');
      await api('PUT', '/settings', { targets: { utilizationPct: Number(f.util.value), openPaymentsPct: Number(f.open.value), barPerGuestCents: c[0], barPersonnelPct: Number(f.pers.value) }, fixedCostsCents: { maxvorstadt: c[1], pasing: c[2] }, minijobLimitCents: c[3] });
      toast('Gespeichert');
    }) },
    h('h1', {}, 'Ziele & Kosten'),
    h('div', { class: 'card' }, h('h2', {}, 'Ziele'), h('div', { class: 'grid2' }, field('Kurs-Auslastung mind. %', f.util), field('Offene Zahlungen max. %', f.open), field('Bar-Umsatz pro Gast mind. €', f.perGuest), field('Personalquote Bar max. %', f.pers))),
    h('div', { class: 'card' }, h('h2', {}, 'Fixkosten pro Monat'), h('p', { class: 'muted small' }, 'Miete, Nebenkosten, Versicherungen, GEMA, Software usw. zusammengerechnet.'), h('div', { class: 'grid2' }, field('Maxvorstadt €', f.fixM), field('Pasing €', f.fixP))),
    h('div', { class: 'card' }, h('h2', {}, 'Minijob'), field('Monatsgrenze €', f.mini), h('p', { class: 'muted small' }, 'Die App warnt ab 85 % der Grenze.')),
    h('button', { class: 'btn block', type: 'submit' }, 'Speichern'));
  }

  // Echtes Logo verwenden, sobald logo.svg / logo.png vorhanden ist (sonst Schriftzug)
  const logoImg = document.querySelector('.logo-img.logo-light');
  const useLogo = () => { if (logoImg && logoImg.naturalWidth) document.body.classList.add('has-logo'); };
  if (logoImg) { if (logoImg.complete) useLogo(); else logoImg.addEventListener('load', () => { useLogo(); if (current === 'login') route('login'); }); }

  route(auth ? (auth.role === 'owner' ? 'heute' : 'zeit') : 'login');
})();
