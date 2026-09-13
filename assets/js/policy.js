/**
 * @file policy.js
 * @fileoverview This file runs SQLite in browser through WebAssembly protocol. This file
 * generates data/policy.db from every JSON data on this site at build time using build file assets/build/make-db.js
 * 
 * Preset queries are hard-coded here so user gets some templated presets to support evidence on policy page
 * alongside requiring no prerequisition knownledge on basic SQL queries.
 * 
 * @see data/policy.json
 * @see vendor/sql-wasm.js
 * @see data/policy.db
 * @author Aitzaz Imtiaz (明澈)
 */
import { EditorView, basicSetup } from 'codemirror';
import { sql, SQLite } from '@codemirror/lang-sql';

// These presets are loaded template to check SQL database.
const PRESETS = [
  {
    label: 'Every law, newest first',
    sql: 'SELECT name, enacted, ended, status\nFROM laws\nORDER BY enacted DESC;'
  },
  {
    label: 'Laws that were struck down or repealed',
    sql: "SELECT name, enacted, ended, status\nFROM laws\nWHERE status IN ('struck down', 'repealed');"
  },
  {
    label: 'Rulings joined to the law they concerned',
    sql: 'SELECT r.date, r.court, r.case_no, r.outcome, l.name AS law\nFROM rulings r\nLEFT JOIN laws l ON l.id = r.law_id\nORDER BY r.date;'
  },
  {
    label: 'How long each law lasted, in years',
    sql: "SELECT name,\n       CAST(substr(COALESCE(ended, '2026-09'), 1, 4) AS INTEGER)\n     - CAST(substr(enacted, 1, 4) AS INTEGER) AS years\nFROM laws\nORDER BY years DESC;"
  },
  {
    label: 'Accounts exposed, largest first',
    sql: 'SELECT service, date, accounts, summary\nFROM breaches\nORDER BY accounts DESC;'
  },
  {
    label: 'Timeline events per thread',
    sql: 'SELECT category, COUNT(*) AS events,\n       MIN(year) AS first_year, MAX(year) AS last_year\nFROM events\nGROUP BY category\nORDER BY events DESC;'
  },
  {
    label: 'What happened in 2021',
    sql: "SELECT date, category, title\nFROM events\nWHERE year = 2021\nORDER BY date;"
  },
  {
    label: 'Which organisations are best connected',
    sql: 'SELECT o.label, o.type, COUNT(l.id) AS connections\nFROM orgs o\nLEFT JOIN links l ON l.from_id = o.id OR l.to_id = o.id\nGROUP BY o.id\nORDER BY connections DESC;'
  },
  {
    label: 'PC bang decline against the timeline',
    sql: 'SELECT v.year, v.count AS venues,\n       (SELECT COUNT(*) FROM events e WHERE e.year = v.year) AS events\nFROM venues v\nORDER BY v.year;'
  },
  {
    label: 'Every source, and how often it is cited',
    sql: 'SELECT f.author, f.year, f.title,\n       (SELECT COUNT(*) FROM events e WHERE e.ref = f.id)\n     + (SELECT COUNT(*) FROM laws  x WHERE x.ref = f.id)\n     + (SELECT COUNT(*) FROM rulings r WHERE r.ref = f.id)\n     + (SELECT COUNT(*) FROM breaches b WHERE b.ref = f.id) AS uses\nFROM refs f\nORDER BY uses DESC, f.year;'
  },
  {
    label: 'Uncited events still needing a source',
    sql: 'SELECT date, category, title\nFROM events\nWHERE ref IS NULL\nORDER BY date;'
  },
  {
    label: 'Netflix traffic growth',
    sql: 'SELECT date, gbps,\n       gbps * 100 / (SELECT MIN(gbps) FROM traffic) AS pct_of_first\nFROM traffic\nORDER BY date;'
  }
];

let db = null;
let editor = null;

/**
 * @param {string} id Element id.
 * @returns {HTMLElement} Element or null when absent.
 */
function $(id) { return document.getElementById(id); }

/**
 * Set status line below editor, with row counts and timings, or throw error for failed rendering.
 * @param {string} text Message.
 * @param {boolean} bad If true, style it as error.
 */
function note(text, bad) {
  const el = $('pol-note');
  el.textContent = text;
  el.className = bad ? 'pol-note is-bad' : 'pol-note';
}

/**
 * Render every result in its tanle and report total row count with how long query ran.
 * @param {Array} results Resut sets returned from sql.js's db.exec(), 
 * @param {number} ms Time taken by query to run.
 * @returns 
 */
function render(results, ms) {
  const box = $('pol-out');
  box.innerHTML = '';

  if (results.length === 0) {
    note(`Query ran in ${ms.toFixed(1)} ms and returned no rows.`, false);
    return;
  }

  let rows = 0;

  results.forEach((res) => {
    const table = document.createElement('table');
    table.className = 'pol-table';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    res.columns.forEach((c) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    res.values.forEach((row) => {
      rows++;
      const tr = document.createElement('tr');
      row.forEach((v) => {
        const td = document.createElement('td');
        td.textContent = v === null ? '—' : String(v);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    box.appendChild(table);
  });

  note(`${rows} row${rows === 1 ? '' : 's'} in ${ms.toFixed(1)} ms.`, false);
}

/**
 * Run what is currently in editor and render the result, or throw an error message.
 */
function run() {
  if (db === null) { note('The database is still loading.', true); return; }

  const text = editor.state.doc.toString().trim();
  if (text === '') { note('Nothing to run.', true); return; }

  try {
    const t0 = performance.now();
    const results = db.exec(text);
    render(results, performance.now() - t0);
  } catch (err) {
    $('pol-out').innerHTML = '';
    note(err.message, true);
  }
}

// Read schema back from sqlite_master over manual hard coding so adding table to make-db.js updates and populates
// the panel automatically.
function showSchema() {
  const res = db.exec("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name;");
  if (res.length === 0) return;

  const dl = $('pol-schema');
  dl.innerHTML = '';

  // Maintaining and avoiding complex technique hassle, this is a weaker implementation stripping off first bracket, taking first word of
  // each comma seperated part. This is a bypass which will acts as cheap parsing. 
  res[0].values.forEach(([name, ddl]) => {
    const cols = String(ddl).replace(/^[^(]*\(/, '').replace(/\)\s*$/, '')
        .split(',').map((s) => s.trim().split(/\s+/)[0])
        .filter((s) => s && !/^(FOREIGN|PRIMARY|UNIQUE)$/i.test(s));

    const dt = document.createElement('dt');
    dt.textContent = name;
    dl.appendChild(dt);

    const dd = document.createElement('dd');
    dd.textContent = cols.join(', ');
    dl.appendChild(dd);
  });
}

// Self-obvious, build presets to be interacted with.
function buildPresets() {
  const box = $('pol-presets');

  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'linkish';
    b.textContent = p.label;
    b.addEventListener('click', () => {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: p.sql }
      });
      run();
    });
    box.appendChild(b);
  });
}

/**
 * Entry point which creates CodeMirror editor, loads first presets, provisions run button, preset buttons,
 * loading sql.js and policy.db in background.
 */
function boot() {
  editor = new EditorView({
    doc: PRESETS[0].sql,
    extensions: [basicSetup, sql({ dialect: SQLite })],
    parent: $('pol-editor')
  });

  buildPresets();
  $('pol-run').addEventListener('click', run);

  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') { ev.preventDefault(); run(); }
  });

  note('Loading SQLite…', false);

  initSqlJs({ locateFile: (f) => 'vendor/' + f })
      .then((SQL) => fetch('data/policy.db')
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status} fetching data/policy.db`);
            return res.arrayBuffer();
          })
          .then((buf) => {
            db = new SQL.Database(new Uint8Array(buf));
            showSchema();
            note('SQLite ready. Run a query.', false);
            run();
          }))
      .catch((err) => note(err.message, true));
}

boot();