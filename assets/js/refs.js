/**
 * @file refs.js
 * @fileoverview This is main citation registry where each element becomes a numbered
 * marker ordered with first appearance as they arrive, with each page's footer list derived
 * from markers being present on the page.
 * 
 * @see vendor/mustache.min.js
 * @see js/validate.js
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';

  var SOURCE = 'data/references.json';
  var LINK_LABEL = 'View source';

  /**
   * Define mustache templates.
   */
  var TPL = {
    marker:
        '<a href="references.html#ref-{{id}}">[{{n}}]</a>',

    citation:
        '{{author}} ({{year}}) <em>{{title}}</em>' +
        '{{#publisher}}. {{publisher}}{{/publisher}}.' +
        '{{#url}} <a href="{{url}}">{{linkLabel}}</a>' +
        '{{#accessed}} (accessed {{accessed}}){{/accessed}}.{{/url}}',

    footer:
        '{{#items}}<li id="cite-{{id}}">{{> citation}}</li>{{/items}}' +
        '{{^items}}<li>No sources cited on this page yet.</li>{{/items}}',

    fullList:
        '<ol class="ref-full">' +
        '{{#items}}<li id="ref-{{id}}">{{> citation}}</li>{{/items}}' +
        '</ol>',

    missing:
        'Unknown reference {{noun}}: {{list}}. ' +
        'Add {{pronoun}} to data/references.json.'
  };

  var PARTIALS = { citation: TPL.citation };

  /**
   * @param {string} id Reference key being used for the anchor target.
   * @param {object} entry Raw entry from references.json.
   * @returns {object} Flat view object with no nested lookups.
   */
  function toView(id, entry) {
    return {
      id: id,
      author: entry.author,
      year: entry.year,
      title: entry.title,
      publisher: entry.publisher || '',
      url: entry.url || '',
      linkLabel: entry.linkText || LINK_LABEL,
      accessed: entry.accessed || ''
    };
  }

  /**
   * Number every marker in document order and rewrites it as a link.
   *
   * @param {object} store Validated contents of references.json.
   * @returns {{order: string[], missing: string[]}} Ids in first-appearance
   *   order and ids with no matching entry.
   */
  function mark(store) {
    var nodes = document.querySelectorAll('[data-ref]');
    var order = [];
    var missing = [];

    Array.prototype.forEach.call(nodes, function(el) {
      var id = el.getAttribute('data-ref');

      // Like BibTeX, an unknown citation shows [?] rather than vanishing.
      if (!Object.prototype.hasOwnProperty.call(store, id)) {
        if (missing.indexOf(id) === -1) missing.push(id);
        el.textContent = '[?]';
        el.className = 'ref ref-bad';
        el.title = 'Unknown reference id: ' + id;
        return;
      }

      if (order.indexOf(id) === -1) order.push(id);

      el.className = 'ref';
      el.innerHTML = Mustache.render(TPL.marker, {
        id: id,
        n: order.indexOf(id) + 1
      });
    });

    return { order: order, missing: missing };
  }

  /**
   * Fill references uniquely for each specific footer.
   *
   * @param {object} store Validated contents of references.json.
   * @param {string[]} order Reference ids in order of first appearing.
   */
  function fillFooter(store, order) {
    var ol = document.getElementById('page-cites');
    if (ol === null) return;

    ol.innerHTML = Mustache.render(TPL.footer, {
      items: order.map(function(id) { return toView(id, store[id]); })
    }, PARTIALS);
  }

  /**
   * Fill reference list on references.html which is sorted by author and
   * then year. 
   *
   * @param {object} store Validated contents of references.json.
   */
  function fillFullList(store) {
    var box = document.getElementById('ref-list');
    if (box === null) return;

    var ids = Object.keys(store).sort(function(a, b) {
      return store[a].author.localeCompare(store[b].author) ||
          store[a].year - store[b].year;
    });

    box.innerHTML = Mustache.render(TPL.fullList, {
      items: ids.map(function(id) { return toView(id, store[id]); })
    }, PARTIALS);
  }

  /**
   * Shows an alert above the article naming any ids that are not in
   * references.json so that a typo is visible on page and not only in the console.
   *
   * @param {string[]} missing Unresolved reference ids.
   */
  function reportMissing(missing) {
    if (missing.length === 0) return;

    var one = missing.length === 1;
    var box = document.createElement('div');
    box.className = 'ref-error';
    box.setAttribute('role', 'alert');
    box.textContent = Mustache.render(TPL.missing, {
      noun: one ? 'id' : 'ids',
      list: missing.join(', '),
      pronoun: one ? 'it' : 'them'
    });

    var main = document.getElementById('main');
    if (main !== null) main.insertBefore(box, main.firstChild);
  }

  var store = null;

  /** Rebuild every marker and list from scratch. */
  function run() {
    if (store === null) return;

    var stale = document.querySelector('.ref-error');
    if (stale !== null) stale.remove();

    var result = mark(store);
    fillFooter(store, result.order);
    fillFullList(store);
    reportMissing(result.missing);
  }

  document.addEventListener('refs:refresh', run);

  if (typeof Mustache === 'undefined') {
    console.error('refs.js needs vendor/mustache.min.js to load first.');
    return;
  }
  if (typeof Validate === 'undefined') {
    console.error('refs.js needs assets/js/validate.js to load first.');
    return;
  }

  Mustache.escape = function(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
  };

  // Pre-compile once rather than on every render
  Object.keys(TPL).forEach(function(name) { Mustache.parse(TPL[name]); });

  fetch(SOURCE)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + SOURCE);
        return res.json();
      })
      .then(function(data) {
        var errors = Validate.references(data);
        if (errors.length > 0) {
          console.error('references.json failed validation:', errors);
          return;
        }
        store = data;
        run();
      })
      .catch(function(err) {
        console.error(err);
      });
}());