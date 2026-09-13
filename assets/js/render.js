/**
 * @file render.js
 * @fileoverview This file loads JSON, validating  and rendering it in overview index page
 * for network diagram. It does not use Cytoscape and is not interactive, but provisions the 
 * diagram, data table and statistics.
 * 
 * Uses Mustache.js which has no prior logic configuration.
 * 
 * @see vendor/mustache.min.js
 * @see data/network.json
 * @related network.json
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';
  var SOURCE = 'data/network.json';
  var TYPE_LABELS = {
    isp: 'Internet provider',
    ix: 'Exchange point',
    academic: 'Research network',
    cable: 'Submarine cable'
  };

  /**
   * @param {string} id Element id.
   * @returns {HTMLElement} Element or null when absent.
   */
  function $(id) { return document.getElementById(id); }

  /**
   * @param {string} id Id of any <script type="text/html"> template element.
   * @returns {string} Template's raw markup which is ready for Mustache.render().
   */
  function tpl(id) { return $(id).innerHTML; }

  /**
   * Show validation failure box instead of erroneous diagram, listing what Validate object found.
   * 
   * @param {string[]} lines Individual message per validation failure. 
   */
  function showError(lines) {
    var box = $('graph-error');
    box.hidden = false;
    box.innerHTML = '';

    var h = document.createElement('p');
    h.textContent = 'The network data failed validation, so the diagram was not drawn.';
    box.appendChild(h);

    var ul = document.createElement('ul');
    lines.forEach(function(line) {
      var li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /**
   * @param {object[]} nodes Node records from network.json.
   * @returns {Object<string, object>} Same node records organized by id.
   */
  function indexNodes(nodes) {
    var byId = {};
    nodes.forEach(function(n) { byId[n.id] = n; });
    return byId;
  }

  /**
   * @param {object[]} edges Edge records from network.json
   * @param {Object<string, object>} byId Node records keyed by id.
   * @returns {{x1: number, y1: number, x2: number y2: number, kind: string, year: number}[]} One drawable line per edge.
   */
  function edgeGeometry(edges, byId) {
    return edges.map(function(e) {
      var a = byId[e.from];
      var b = byId[e.to];
      return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, kind: e.kind, year: e.year };
    });
  }

  /**
   * Build one table row per node.
   * 
   * @param {object[]} nodes Node records from network.json.
   * @param {object[]} edges Edge records from network.json.
   * @param {Object<string, object>} byId Node records keyed by id for lookup.
   * @returns {object[]} One view object per node.
   */
  function tableRows(nodes, edges, byId) {
    return nodes.map(function(n) {
      var links = [];
      var since = null;

      edges.forEach(function(e) {
        var other = null;
        if (e.from === n.id) other = byId[e.to];
        if (e.to === n.id) other = byId[e.from];
        if (other === null) return;
        if (links.indexOf(other.label) === -1) links.push(other.label);
        if (since === null || e.year < since) since = e.year;
      });

      return {
        label: n.label,
        typeLabel: TYPE_LABELS[n.type],
        connects: links.length ? links.join(', ') : 'No connections shown',
        since: since === null ? '\u2014' : String(since)
      };
    });
  }

  /**
   * Redraw a diagram after year value is changed from slider.
   * 
   * @param {{nodes: object[], edges: object[]}} state Precomputed node and edge view data
   * @param {number} year Year to draw the network of.
   */
  function paint(state, year) {
    var visible = state.edges.filter(function(e) { return e.year <= year; });

    $('graph-edges').innerHTML = Mustache.render(tpl('tpl-edges'), { edges: visible });
    $('graph-nodes').innerHTML = Mustache.render(tpl('tpl-nodes'), { nodes: state.nodes });
    $('year-out').textContent = String(year);
  }

  /**
   * Builds diagram's node/edge view data, renders table, wires the
   * year slider and draws the initial year.
   * 
   * It runs after validation.js passes it.
   *
   * @param {object} data Validated contents of network.json.
   */
  function startGraph(data) {
    var byId = indexNodes(data.nodes);

    var state = {
      nodes: data.nodes.map(function(n) {
        return { id: n.id, label: n.label, type: n.type, x: n.x, y: n.y, labelY: n.y + 42 };  // Mustache can't do arithmetic so the label gets precomputed
      }),
      edges: edgeGeometry(data.edges, byId)
    };

    $('graph-title').textContent = data.meta.title;
    $('graph-desc').textContent = data.meta.title + '. ' + data.nodes.length + ' organisations and ' + data.edges.length + ' connections. The same data appears as a table below.'; // SVG is not readable to assistive tech, so this info is needed

    $('graph-tbody').innerHTML = Mustache.render(tpl('tpl-rows'), { rows: tableRows(data.nodes, data.edges, byId) });

    var slider = $('year');
    slider.min = data.meta.yearFrom;
    slider.max = data.meta.yearTo;
    slider.value = data.meta.yearTo;
    slider.disabled = false;
    slider.addEventListener('input', function() { paint(state, Number(slider.value)); });

    paint(state, data.meta.yearTo);
  }

  /**
   * @param {{stats: object[]}} data Contents of stats.json.
   * @throws {Error} Raise error if `data.stats` is missing, not an array, or empty.
   */
  function startStats(data) {
    if (!Array.isArray(data.stats) || data.stats.length === 0) {
      throw new Error('stats.json: stats must be a non-empty array.');
    }

    $('stats-list').innerHTML = Mustache.render(tpl('tpl-stats'), data);
    document.dispatchEvent(new CustomEvent('refs:refresh'));
  }

  /**
   * @param {string} url URL to fetch and parse as JSON.
   * @returns {Promise<object>} Resolves with parsed JSON or rejects with
   *   an Error.
   */
  function load(url) {
    return fetch(url).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
      return res.json();
    });
  }

  if ($('graph-svg') !== null) {
    load(SOURCE)
        .then(function(data) {
          var errors = Validate.network(data);
          if (errors.length > 0) {
            showError(errors);
            return;
          }
          startGraph(data);
        })
        .catch(function(err) { showError([err.message]); });
  }

  if ($('stats-list') !== null) {
    load('data/stats.json')
        .then(startStats)
        .catch(function(err) {
          var aside = $('stats-list').closest('.band-side');
          if (aside !== null) aside.hidden = true;
          console.error(err);
        });
  }
}());
