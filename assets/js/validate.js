/**
 * @file validate.js
 * @fileoverview Schema checks for every JSON file.
 * 
 * This is a small predicate library. Every check collects into error list so single pass
 * reporting shows every problem in file instead of showing first.
 * 
 * @author Aitzaz Imtiaz (明澈)
 */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Validate = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  'use strict';
  var RE = {
    hex6: /^#[0-9a-f]{6}$/i,
    ym: /^\d{4}-\d{2}$/,
    ymOrY: /^\d{4}(-\d{2})?$/,
    iso: /^\d{4}-\d{2}-\d{2}$/,
    url: /^https?:\/\/\S+$/
  };

  var TYPE = {};
  /**
   * @param {string} name Type name which is referenced from chema's field specs.
   * @param {string} want Description used in "key must be ..." messages.
   * @param {function(*): boolean} test Predicate returning true if value is valid.
   */
  function type(name, want, test) { TYPE[name] = { want: want, test: test }; }

  type('str', 'a non-empty string', function(v) {
    return typeof v === 'string' && v.length > 0;
  });
  type('num', 'a finite number', function(v) {
    return typeof v === 'number' && isFinite(v);
  });
  type('int', 'an integer', function(v) {
    return TYPE.num.test(v) && Math.floor(v) === v;
  });
  type('posInt', 'a positive integer', function(v) {
    return TYPE.int.test(v) && v > 0;
  });
  type('posNum', 'a positive number', function(v) {
    return TYPE.num.test(v) && v > 0;
  });
  type('hex6', 'a six-digit hex colour such as #24382c', function(v) {
    return RE.hex6.test(String(v));
  });
  type('ym', 'a YYYY-MM date', function(v) { return RE.ym.test(String(v)); });
  type('ymOrY', 'a YYYY or YYYY-MM date', function(v) {
    return RE.ymOrY.test(String(v));
  });
  type('iso', 'a YYYY-MM-DD date', function(v) { return RE.iso.test(String(v)); });
  type('url', 'an http(s) URL', function(v) { return RE.url.test(String(v)); });

  function Bag() { this.errors = []; }
  /**
   * @param {string} where Location of problem.
   * @param {string} message What was wrong.
   */
  Bag.prototype.at = function(where, message) {
    this.errors.push(where + ': ' + message);
  };


  /**
   * @param {*} v Value to test.
   * @returns {boolean} True if v is an array. 
   */
  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  /**
   * Check one field of one object against its spec.
   * @param {Bag} bag Error collector to report into.
   * @param {object} host The object the field lives on.
   * @param {string} where Location prefix for error messages.
   * @param {string} key Field name to check.
   * @param {string|Array} spec Type name optionally suffixed with `?` or pair via enum field.
   */
  function field(bag, host, where, key, spec) {
    var name = spec;
    var oneOf = null;
    var optional = false;

    if (isArray(spec)) {
      name = spec[0];
      oneOf = spec[1];
    }
    if (name.charAt(name.length - 1) === '?') {
      optional = true;
      name = name.slice(0, -1);
    }

    var value = host[key];

    if (value === null || value === undefined) {
      if (!optional) bag.at(where, key + ' is missing.');
      return;
    }
    if (!TYPE[name].test(value)) {
      bag.at(where, key + ' must be ' + TYPE[name].want +
          ' (got ' + JSON.stringify(value) + ').');
      return;
    }
    if (oneOf !== null && oneOf.indexOf(value) === -1) {
      bag.at(where, key + ' "' + value + '" is not one of ' + oneOf.join(', ') + '.');
    }
  }

  /**
   * Checks a single object against a spec. Returns false if unusable.
   * @param {Bag} bag Error collector to report into.
   * @param {*} host Value expected to be an object.
   * @param {string} where Location prefix for error messages.
   * @param {Object<string, string|Array>} spec Field name to type-spec map.
   * @returns {boolean} False if host is missing or not a usable object.
   */
  function shape(bag, host, where, spec) {
    if (host === null || typeof host !== 'object' || isArray(host)) {
      bag.at(where, 'missing or not an object.');
      return false;
    }
    Object.keys(spec).forEach(function(key) {
      field(bag, host, where, key, spec[key]);
    });
    return true;
  }

  /**
   * Checks array of records. Returns a map of the ids it saw so that callers
   * can use it to resolve cross-references, or null if the array is unusable.
   * 
   * @param {Bag} bag Error collector for reporting.
   * @param {*} rows Value expected to be an array of row objects.
   * @param {string} where Location prefix for error messages.
   * @param {Object<string, string|Array>} spec Field name to type-spec map applied to every row.
   * @param {object} [opts] Optional extras.
   * @param {number} [opts.min=1] Minimum number of rows required.
   * @param {string} [opts.idKey] Field to treat as a unique id.
   * @param {function(Bag, object, string, Object<string, boolean>)} [opts.row] Extra per-row check.
   * @returns {?Object<string, boolean>} A map of the ids seen.
   */
  function list(bag, rows, where, spec, opts) {
    opts = opts || {};
    var min = opts.min === undefined ? 1 : opts.min;

    if (!isArray(rows)) {
      bag.at(where, 'missing or not an array.');
      return null;
    }
    if (rows.length < min) {
      bag.at(where, 'needs at least ' + min + ' entr' + (min === 1 ? 'y' : 'ies') +
          ' (got ' + rows.length + ').');
      return null;
    }

    var ids = {};
    rows.forEach(function(row, i) {
      var at = where + '[' + i + ']';
      if (row === null || typeof row !== 'object') {
        bag.at(at, 'not an object.');
        return;
      }
      Object.keys(spec).forEach(function(key) {
        field(bag, row, at, key, spec[key]);
      });
      if (opts.idKey) {
        var id = row[opts.idKey];
        if (typeof id === 'string' && id.length > 0) {
          if (ids[id]) bag.at(at, 'duplicate ' + opts.idKey + ' "' + id + '".');
          else ids[id] = true;
        }
      }
      if (opts.row) opts.row(bag, row, at, ids);
    });
    return ids;
  }

  /**
   * Checks an object used as a map of id to record. e.g. in references.json where keys
   * by themselves are id and not an id field on each row.
   *
   * @param {Bag} bag Error collector.
   * @param {*} host Value expected to be an id-keyed object.
   * @param {string} where Location prefix for error messages.
   * @param {Object<string, string|Array>} spec Field name to type-spec map, applied to every value in host.
   * @returns {?Object<string, boolean>} A map ofids seen or null if host is unusable.
   */
  function table(bag, host, where, spec) {
    if (host === null || typeof host !== 'object' || isArray(host)) {
      bag.at(where, 'missing or not an object.');
      return null;
    }
    var keys = Object.keys(host);
    if (keys.length === 0) {
      bag.at(where, 'has no entries.');
      return null;
    }
    var ids = {};
    keys.forEach(function(key) {
      ids[key] = true;
      shape(bag, host[key], where + '.' + key, spec);
    });
    return ids;
  }

  /**
   * @param {string} value A "YYYY" or "YYYY-MM" date string.
   * @returns {number} The four digit year as a number.
   */
  function year(value) { return Number(String(value).slice(0, 4)); }

  // Shared dictionaries
  var NODE_TYPES = ['isp', 'ix', 'academic', 'cable'];
  var EDGE_KINDS = ['peering', 'backbone', 'submarine'];
  var LAW_STATUS = ['in force', 'pending', 'repealed', 'struck down', 'lapsed'];
  var SCHEMA = {};

  /**
   * @param {object} d Parsed pcbang.json.
   * @param {Bag} bag Error collector to report into.
   */
  SCHEMA.network = function(d, bag) {
    // Permissive bounds when meta is broken, so node and edge checks still
    // run and one pass reports everything.
    var meta = {
      yearFrom: -Infinity,
      yearTo: Infinity,
      viewBox: { w: Infinity, h: Infinity }
    };

    if (shape(bag, d.meta, 'meta', { yearFrom: 'int', yearTo: 'int' })) {
      if (TYPE.int.test(d.meta.yearFrom) && TYPE.int.test(d.meta.yearTo)) {
        if (d.meta.yearFrom >= d.meta.yearTo) {
          bag.at('meta', 'yearFrom (' + d.meta.yearFrom +
              ') must be less than yearTo (' + d.meta.yearTo + ').');
        } else {
          meta.yearFrom = d.meta.yearFrom;
          meta.yearTo = d.meta.yearTo;
        }
      }
      if (shape(bag, d.meta.viewBox, 'meta.viewBox', { w: 'posNum', h: 'posNum' }) &&
          TYPE.posNum.test(d.meta.viewBox.w) && TYPE.posNum.test(d.meta.viewBox.h)) {
        meta.viewBox = d.meta.viewBox;
      }
    }

    var nodes = list(bag, d.nodes, 'nodes', {
      id: 'str',
      label: 'str',
      type: ['str', NODE_TYPES],
      x: 'num',
      y: 'num'
    }, {
      idKey: 'id',
      row: function(b, n, at) {
        if (TYPE.num.test(n.x) && TYPE.num.test(n.y) &&
            (n.x < 0 || n.x > meta.viewBox.w || n.y < 0 || n.y > meta.viewBox.h)) {
          b.at(at, '(' + n.x + ',' + n.y + ') falls outside the viewBox.');
        }
      }
    });
    if (nodes === null) return;

    list(bag, d.edges, 'edges', {
      from: 'str',
      to: 'str',
      year: 'int',
      kind: ['str', EDGE_KINDS]
    }, {
      row: function(b, e, at) {
        // Catches typos in hand-written data.
        if (TYPE.str.test(e.from) && !nodes[e.from]) {
          b.at(at, 'from "' + e.from + '" matches no node id.');
        }
        if (TYPE.str.test(e.to) && !nodes[e.to]) {
          b.at(at, 'to "' + e.to + '" matches no node id.');
        }
        if (e.from === e.to) b.at(at, 'connects "' + e.from + '" to itself.');
        if (TYPE.int.test(e.year) &&
            (e.year < meta.yearFrom || e.year > meta.yearTo)) {
          b.at(at, 'year ' + e.year + ' is outside ' +
              meta.yearFrom + '-' + meta.yearTo + '.');
        }
      }
    });
  };

  SCHEMA.timeline = function(d, bag) {
    var from = -Infinity;
    var to = Infinity;

    if (shape(bag, d.meta, 'meta', { title: 'str', yearFrom: 'int', yearTo: 'int' }) &&
        TYPE.int.test(d.meta.yearFrom) && TYPE.int.test(d.meta.yearTo)) {
      if (d.meta.yearFrom >= d.meta.yearTo) {
        bag.at('meta', 'yearFrom must be less than yearTo.');
      } else {
        from = d.meta.yearFrom;
        to = d.meta.yearTo;
      }
    }

    var cats = list(bag, d.categories, 'categories', {
      id: 'str',
      label: 'str',
      color: 'hex6'
    }, { idKey: 'id' });
    if (cats === null) return;

    list(bag, d.events, 'events', {
      id: 'str',
      date: 'ymOrY',
      category: 'str',
      title: 'str',
      note: 'str',
      ref: 'str?'
    }, {
      idKey: 'id',
      row: function(b, e, at) {
        if (TYPE.ymOrY.test(e.date)) {
          var y = year(e.date);
          // yearTo + 1 because a late event in final year is still in range.
          if (y < from || y > to + 1) {
            b.at(at, 'date ' + e.date + ' falls outside ' + from + '-' + to + '.');
          }
        }
        if (TYPE.str.test(e.category) && !cats[e.category]) {
          b.at(at, 'category "' + e.category + '" is not defined in categories.');
        }
      }
    });
  };

  SCHEMA.pcbang = function(d, bag) {
    shape(bag, d.meta, 'meta', { title: 'str', unit: 'str', note: 'str' });

    var years = {};
    list(bag, d.counts, 'counts', {
      year: 'int',
      value: 'posInt',
      source: 'str',
      label: 'str'
    }, {
      min: 2,
      row: function(b, c, at) {
        if (TYPE.int.test(c.year)) {
          if (years[c.year]) b.at(at, 'duplicate year ' + c.year + '.');
          else years[c.year] = true;
          if (c.year < 1990 || c.year > 2100) {
            b.at(at, 'year ' + c.year + ' is implausible.');
          }
        }
      }
    });
  };

  SCHEMA.peering = function(d, bag) {
    shape(bag, d.meta, 'meta', { title: 'str', note: 'str' });

    // The chart interpolates between measurements, so it needs at least two.
    list(bag, d.traffic, 'traffic', { date: 'ym', gbps: 'posNum' }, { min: 2 });

    list(bag, d.steps, 'steps', {
      id: 'str',
      date: 'ym',
      title: 'str',
      body: 'str',
      ref: 'str?'
    }, { idKey: 'id' });
  };

  SCHEMA.references = function(d, bag) {
    table(bag, d, 'references', {
      author: 'str',
      year: 'int',
      title: 'str',
      publisher: 'str',
      url: 'url',
      accessed: 'iso'
    });
  };

  SCHEMA.stats = function(d, bag) {
    field(bag, d, 'root', 'asOf', 'int');

    list(bag, d.stats, 'stats', {
      label: 'str',
      now: 'str',
      nowNote: 'str',
      then: 'str',
      thenNote: 'str',
      refNow: 'str',
      refThen: 'str'
    });
  };

  SCHEMA.policy = function(d, bag) {
    var laws = list(bag, d.laws, 'laws', {
      id: 'str',
      name: 'str',
      enacted: 'ym',
      ended: 'ym?',
      status: ['str', LAW_STATUS],
      summary: 'str',
      ref: 'str?'
    }, {
      idKey: 'id',
      row: function(b, l, at) {
        if (TYPE.ym.test(l.enacted) && TYPE.ym.test(l.ended) && l.ended < l.enacted) {
          b.at(at, 'ended (' + l.ended + ') is before enacted (' + l.enacted + ').');
        }
      }
    });

    list(bag, d.rulings, 'rulings', {
      id: 'str',
      date: 'iso',
      court: 'str',
      case_no: 'str',
      law_id: 'str?',
      outcome: 'str',
      summary: 'str',
      ref: 'str?'
    }, {
      idKey: 'id',
      row: function(b, r, at) {
        if (laws !== null && TYPE.str.test(r.law_id) && !laws[r.law_id]) {
          b.at(at, 'law_id "' + r.law_id + '" matches no law id.');
        }
      }
    });

    list(bag, d.breaches, 'breaches', {
      id: 'str',
      date: 'ym',
      service: 'str',
      accounts: 'posInt',
      summary: 'str',
      ref: 'str?'
    }, { idKey: 'id' });
  };

  /**
   * Runs one named schema against parsed JSON data.
   *
   * @param {string} name Any one of keys in schema.
   * @param {*} data Parsed JSON to validate.
   * @returns {string[]} Every error found and empty when the data is valid.
   * @throws {Error} If name does not match a registered schema.
   */
  function check(name, data) {
    if (!SCHEMA[name]) throw new Error('No schema named "' + name + '".');
    if (data === null || typeof data !== 'object') return ['Root is not an object.'];
    var bag = new Bag();
    SCHEMA[name](data, bag);
    return bag.errors;
  }

  /**
   * This is cross file check which see every ref pointer in other files, which must resolve
   * to a key in refernces.json. 
   * 
   * @param {Object<string, object>} files Whichever of datasets are available keyed by name.
   * @returns {string[]} One message per ref that does not resolve.
   */
  function integrity(files) {
    var bag = new Bag();

    if (!files.references || typeof files.references !== 'object') {
      bag.at('integrity', 'references.json is required to resolve ref pointers.');
      return bag.errors;
    }
    var refs = files.references;

    /**
     * @param {?string} id A ref value to resolve or null if absent.
     * @param {string} where Location prefix for error messages.
     */
    function resolve(id, where) {
      if (id === null || id === undefined) return;
      if (!Object.prototype.hasOwnProperty.call(refs, id)) {
        bag.at(where, 'ref "' + id + '" is not in references.json.');
      }
    }

    /**
     * @param {*} rows Array of rows to scan or anything else to skip.
     * @param {string} where Location prefix for error messages.
     * @param {string[]} keys Field names on each row that may hold a ref id.
     */
    function walk(rows, where, keys) {
      if (!isArray(rows)) return;
      rows.forEach(function(row, i) {
        keys.forEach(function(key) {
          resolve(row[key], where + '[' + i + '].' + key);
        });
      });
    }

    if (files.timeline) walk(files.timeline.events, 'timeline.events', ['ref']);
    if (files.stats) walk(files.stats.stats, 'stats.stats', ['refNow', 'refThen']);
    if (files.peering) walk(files.peering.steps, 'peering.steps', ['ref']);
    if (files.policy) {
      walk(files.policy.laws, 'policy.laws', ['ref']);
      walk(files.policy.rulings, 'policy.rulings', ['ref']);
      walk(files.policy.breaches, 'policy.breaches', ['ref']);
    }

    return bag.errors;
  }

  /**
   * Reports references.json entries that are not cited by other files. This is advisory
   * over error as bibliography is allowed to carry ophan entries.
   *
   * @param {Object<string, object>} files Same shape as integrity()'s argument.
   * @returns {string[]} Ids present in references.json but never cited.
   */
  function orphans(files) {
    if (!files.references) return [];
    var cited = {};

    function note(rows, keys) {
      if (!isArray(rows)) return;
      rows.forEach(function(row) {
        keys.forEach(function(key) { if (row[key]) cited[row[key]] = true; });
      });
    }

    if (files.timeline) note(files.timeline.events, ['ref']);
    if (files.stats) note(files.stats.stats, ['refNow', 'refThen']);
    if (files.peering) note(files.peering.steps, ['ref']);
    if (files.policy) {
      note(files.policy.laws, ['ref']);
      note(files.policy.rulings, ['ref']);
      note(files.policy.breaches, ['ref']);
    }

    return Object.keys(files.references).filter(function(id) {
      return !cited[id];
    });
  }

  var api = {
    check: check,
    integrity: integrity,
    orphans: orphans,
    schemas: Object.keys(SCHEMA),
    NODE_TYPES: NODE_TYPES,
    EDGE_KINDS: EDGE_KINDS
  };

  // Named helpers, so callers read as Validate.timeline(data).
  Object.keys(SCHEMA).forEach(function(name) {
    api[name] = function(data) { return check(name, data); };
  });

  return api;
}));
