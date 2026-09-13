/**
 * @file network.js
 * @fileoverview This file renders graph network via Cytoscapes and handles assistive table with it.
 * 
 * It uses the object at validate.js but extends it further with more comprehensive validation checks
 * over a different library. Colors live here and not in CSS because the node module library Cytoscapes is unable to
 * read CSS files.
 * 
 * @see data/network.json
 * @see js/validate.js
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';

  var TYPE_LABELS = {
    isp: 'Internet provider',
    ix: 'Exchange point',
    academic: 'Research network',
    cable: 'Submarine cable'
  };

  //  Mirrors .graph-key in graph.css values
  var TYPE_COLORS = {
    isp: '#24382c',
    ix: '#9b2242',
    academic: '#4a6b57',
    cable: '#7a8b80'
  };

  /**
   * @param {string} id Element id.
   * @returns {HTMLElement} Element or null when absent.
   */
  function $(id) { return document.getElementById(id); }

  /**
   * Remove the map area, getting it replaced with a box reporting the
   * failure to not implement the box. 
   *
   * @see js/validate.js
   * @param {string[]} lines One message per validation failure.
   */
  function showError(lines) {
    var box = $('graph-error');
    box.hidden = false;
    box.innerHTML = '<p>The network data failed validation, so the map was not drawn.</p>';

    var ul = document.createElement('ul');
    lines.forEach(function(line) {
      var li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /**
   * Fill detail pannel with node last tapped in map.
   *
   * @param {object} node Node record from network.json.
   */
  function detail(node) {
    $('net-detail').innerHTML = Mustache.render($('tpl-net-detail').innerHTML, {
      label: node.label,
      typeLabel: TYPE_LABELS[node.type],
      note: node.note || 'No description recorded for this node yet.'
    });
  }


  /**
   * Build one table row per node recieved.
   *
   * @param {object[]} nodes Node records from network.json.
   * @param {object[]} edges Edge records from network.json.
   * @param {Object<string, object>} byId Node records by id, for lookup.
   * @returns {object[]} One object from combined nodes.
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
   * Build in the following order:
   * Table ----> Cytoscape map ----> Edges and wires, with handler adjusted
   * 
   * @param {object} data Validated content of network.json. 
   */
  function start(data) {
    var byId = {};
    data.nodes.forEach(function(n) { byId[n.id] = n; });

    $('net-tbody').innerHTML = Mustache.render($('tpl-net-rows').innerHTML, {
      rows: tableRows(data.nodes, data.edges, byId)
    });

    var elements = [];

    data.nodes.forEach(function(n) {
      elements.push({
        data: { id: n.id, label: n.label, type: n.type },
        position: { x: n.x, y: n.y }
      });
    });

    data.edges.forEach(function(e, i) {
      elements.push({
        data: { id: 'e' + i, source: e.from, target: e.to, kind: e.kind, year: e.year }
      });
    });

    var cy = cytoscape({
      container: $('cy'),
      elements: elements,
      layout: { name: 'preset', fit: true, padding: 40 }, // mimic values of JSON so map matches hard-coded SVG on index page
      minZoom: 0.4,
      maxZoom: 2.5,
      wheelSensitivity: 0.15,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': function(el) { return TYPE_COLORS[el.data('type')]; },
            'label': 'data(label)',
            'width': 34,
            'height': 34,
            'border-width': 2,
            'border-color': '#e6e5e1',
            'font-family': 'ui-monospace, SFMono-Regular, Menlo, monospace',
            'font-size': 11,
            'color': '#1f2924',
            'text-valign': 'bottom',
            'text-margin-y': 7
          }
        },
        {
          selector: 'node:selected',
          style: { 'border-color': '#1f2924', 'border-width': 3 }
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': 'rgba(36, 56, 44, 0.35)',
            'curve-style': 'straight'
          }
        },
        { selector: 'edge[kind = "backbone"]', style: { 'width': 3 } },
        { selector: 'edge[kind = "submarine"]', style: { 'line-style': 'dashed' } },
        {
          selector: 'edge:selected',
          style: { 'line-color': '#9b2242', 'width': 3 }
        }
      ]
    });

    // ev.target === cy is strong equivalnce on background, not node
    cy.on('tap', 'node', function(ev) { detail(byId[ev.target.id()]); });

    cy.on('tap', function(ev) {
      if (ev.target === cy) {
        $('net-detail').innerHTML =
            '<p class="tl-hint">Select any node to read what it is. :D</p>';
      }
    });

    $('net-preset').addEventListener('click', function() {
      cy.layout({ name: 'preset', fit: true, padding: 40, animate: true }).run();
    });

    $('net-circle').addEventListener('click', function() {
      cy.layout({ name: 'circle', fit: true, padding: 50, animate: true }).run();
    });

    $('net-fit').addEventListener('click', function() { cy.fit(undefined, 40); });

    $('net-detail').innerHTML =
        '<p class="tl-hint">Select any node to read what it is.</p>';
  }

  fetch('data/network.json')
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching data/network.json');
        return res.json();
      })
      .then(function(data) {
        var errors = Validate.network(data);
        if (errors.length > 0) { showError(errors); return; }
        start(data);
      })
      .catch(function(err) { showError([err.message]); });
}());