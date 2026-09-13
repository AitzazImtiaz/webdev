// Build script so no jsdocs required
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const Validate = require('../js/validate.js');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.join(ROOT, 'data', 'policy.db');

const problems = [];

function read(name) {
  const at = path.join(ROOT, 'data', name);
  if (!fs.existsSync(at)) {
    problems.push('missing (skipped): data/' + name);
    return null;
  }
  return JSON.parse(fs.readFileSync(at, 'utf8'));
}

function main() {
  const policy = read('policy.json');
  const refs = read('references.json');
  const network = read('network.json');
  const timeline = read('timeline.json');
  const pcbang = read('pcbang.json');
  const peering = read('peering.json');

  if (refs === null) {
    console.error('data/references.json is required.');
    process.exitCode = 1;
    return;
  }
  // Schema-check every file and stop before writing a single row.
  const loaded = {
    policy: policy, references: refs, network: network,
    timeline: timeline, pcbang: pcbang, peering: peering,
    stats: read('stats.json')
  };

  Object.keys(loaded).forEach(function(name) {
    if (loaded[name] === null) return;
    Validate.check(name, loaded[name]).forEach(function(msg) {
      problems.push(name + '.json ' + msg);
    });
  });

  Validate.integrity(loaded).forEach(function(msg) { problems.push(msg); });

  const schemaFailures = problems.filter(function(p) {
    return p.indexOf('missing (skipped)') !== 0;
  });
  if (schemaFailures.length > 0) {
    schemaFailures.forEach(function(p) { console.error('  ' + p); });
    console.error('Build failed: ' + schemaFailures.length + ' schema problem(s). No database written.');
    process.exitCode = 1;
    return;
  }

  Validate.orphans(loaded).forEach(function(id) {
    console.warn('  note: references.json "' + id + '" is never cited');
  });
  if (fs.existsSync(OUT)) fs.unlinkSync(OUT);

  const db = new DatabaseSync(OUT);

  db.exec(`
    CREATE TABLE refs (
      id        TEXT PRIMARY KEY,
      author    TEXT NOT NULL,
      year      INTEGER NOT NULL,
      title     TEXT NOT NULL,
      publisher TEXT,
      url       TEXT
    );

    CREATE TABLE laws (
      id      TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      enacted TEXT NOT NULL,
      ended   TEXT,
      status  TEXT NOT NULL,
      summary TEXT NOT NULL,
      ref     TEXT REFERENCES refs (id)
    );

    CREATE TABLE rulings (
      id      TEXT PRIMARY KEY,
      date    TEXT NOT NULL,
      court   TEXT NOT NULL,
      case_no TEXT NOT NULL,
      law_id  TEXT REFERENCES laws (id),
      outcome TEXT NOT NULL,
      summary TEXT NOT NULL,
      ref     TEXT REFERENCES refs (id)
    );

    CREATE TABLE breaches (
      id       TEXT PRIMARY KEY,
      date     TEXT NOT NULL,
      service  TEXT NOT NULL,
      accounts INTEGER NOT NULL,
      summary  TEXT NOT NULL,
      ref      TEXT REFERENCES refs (id)
    );

    CREATE TABLE events (
      id       TEXT PRIMARY KEY,
      date     TEXT NOT NULL,
      year     INTEGER NOT NULL,
      category TEXT NOT NULL,
      title    TEXT NOT NULL,
      note     TEXT,
      ref      TEXT REFERENCES refs (id)
    );

    CREATE TABLE orgs (
      id    TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type  TEXT NOT NULL,
      note  TEXT
    );

    CREATE TABLE links (
      id      INTEGER PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES orgs (id),
      to_id   TEXT NOT NULL REFERENCES orgs (id),
      year    INTEGER NOT NULL,
      kind    TEXT NOT NULL
    );

    CREATE TABLE venues (
      year  INTEGER PRIMARY KEY,
      count INTEGER NOT NULL,
      note  TEXT
    );

    CREATE TABLE traffic (
      date TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      gbps INTEGER NOT NULL
    );
  `);

  const known = new Set(Object.keys(refs));

  function checkRef(id, where) {
    if (id !== null && id !== undefined && !known.has(id)) {
      problems.push(where + ': unknown ref "' + id + '"');
    }
  }

  function toYear(s) {
    return Number(String(s).slice(0, 4));
  }

  const insRef = db.prepare('INSERT INTO refs VALUES (?, ?, ?, ?, ?, ?)');
  Object.keys(refs).forEach(function(id) {
    const r = refs[id];
    insRef.run(id, r.author, r.year, r.title, r.publisher || null, r.url || null);
  });

  const counts = { refs: Object.keys(refs).length };

  if (policy !== null) {
    const insLaw = db.prepare('INSERT INTO laws VALUES (?, ?, ?, ?, ?, ?, ?)');
    policy.laws.forEach(function(l) {
      checkRef(l.ref, 'laws.' + l.id);
      insLaw.run(l.id, l.name, l.enacted, l.ended, l.status, l.summary, l.ref);
    });

    const lawIds = new Set(policy.laws.map(function(l) { return l.id; }));

    const insRuling = db.prepare('INSERT INTO rulings VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    policy.rulings.forEach(function(r) {
      checkRef(r.ref, 'rulings.' + r.id);
      if (r.law_id !== null && r.law_id !== undefined && !lawIds.has(r.law_id)) {
        problems.push('rulings.' + r.id + ': law_id "' + r.law_id + '" matches no law');
      }
      insRuling.run(r.id, r.date, r.court, r.case_no, r.law_id, r.outcome, r.summary, r.ref);
    });

    const insBreach = db.prepare('INSERT INTO breaches VALUES (?, ?, ?, ?, ?, ?)');
    policy.breaches.forEach(function(b) {
      checkRef(b.ref, 'breaches.' + b.id);
      insBreach.run(b.id, b.date, b.service, b.accounts, b.summary, b.ref);
    });

    counts.laws = policy.laws.length;
    counts.rulings = policy.rulings.length;
    counts.breaches = policy.breaches.length;
  }

  if (timeline !== null) {
    const cats = new Set(timeline.categories.map(function(c) { return c.id; }));
    const insEvent = db.prepare('INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?)');

    timeline.events.forEach(function(e) {
      checkRef(e.ref, 'events.' + e.id);
      if (!cats.has(e.category)) {
        problems.push('events.' + e.id + ': category "' + e.category + '" is not defined');
      }
      insEvent.run(e.id, e.date, toYear(e.date), e.category, e.title, e.note || null, e.ref);
    });

    counts.events = timeline.events.length;
  }

  if (network !== null) {
    const insOrg = db.prepare('INSERT INTO orgs VALUES (?, ?, ?, ?)');
    network.nodes.forEach(function(n) {
      insOrg.run(n.id, n.label, n.type, n.note || null);
    });

    const orgIds = new Set(network.nodes.map(function(n) { return n.id; }));

    const insLink = db.prepare('INSERT INTO links VALUES (?, ?, ?, ?, ?)');
    network.edges.forEach(function(e, i) {
      if (!orgIds.has(e.from)) {
        problems.push('links[' + i + ']: from "' + e.from + '" matches no org');
      }
      if (!orgIds.has(e.to)) {
        problems.push('links[' + i + ']: to "' + e.to + '" matches no org');
      }
      insLink.run(i + 1, e.from, e.to, e.year, e.kind);
    });

    counts.orgs = network.nodes.length;
    counts.links = network.edges.length;
  }

  if (pcbang !== null) {
    const insVenue = db.prepare('INSERT INTO venues VALUES (?, ?, ?)');
    pcbang.counts.forEach(function(c) {
      insVenue.run(c.year, c.value, c.source || null);
    });
    counts.venues = pcbang.counts.length;
  }

  if (peering !== null) {
    const insTraffic = db.prepare('INSERT INTO traffic VALUES (?, ?, ?)');
    peering.traffic.forEach(function(t) {
      insTraffic.run(t.date, toYear(t.date), t.gbps);
    });
    counts.traffic = peering.traffic.length;
  }

  db.close();

  const hard = problems.filter(function(p) {
    return p.indexOf('missing (skipped)') !== 0;
  });

  problems.forEach(function(p) { console.warn('  ' + p); });

  if (hard.length > 0) {
    console.error('Build failed: ' + hard.length + ' referential problem(s).');
    fs.unlinkSync(OUT);
    process.exitCode = 1;
    return;
  }

  const total = Object.keys(counts).reduce(function(n, k) { return n + counts[k]; }, 0);
  const size = fs.statSync(OUT).size;

  console.log('Wrote data/policy.db (' + size + ' bytes), ' + total + ' rows:');
  Object.keys(counts).forEach(function(k) {
    console.log('  ' + k + ': ' + counts[k]);
  });
}

main();
