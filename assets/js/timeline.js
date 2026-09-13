/**
 * @file timeline.js
 * @fileoverview This file is for playable timeline film. A playhead sweeps the period; events
 * fill in as it passes them and the detail panel narrates.
 * 
 * This mostly uses P5.js library and features provided by that library for e.g. scroll.
 * 
 * @see data/timeline.json
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';

  var SOURCE = 'data/timeline.json';
  var H = 420;
  var PAD = { top: 46, right: 24, bottom: 52, left: 24 };
  var RATE = 0.9; // speed of movement, one year runs in about a second, so around-ish 20 seconds
  var data = null;
  var events = [];
  var catById = {};
  var head = 0;
  var playing = false;
  var filter = null;
  var selectedId = null;
  var hoverId = null;
  var pulses = [];
  var reduced = false;

  /**
   * @param {string} id Element id.
   * @returns {HTMLElement} Element or null when absent.
   */
  function $(id) { return document.getElementById(id); }

  /**
   * @param {string} id Id of a <script type="text/html"> template element.
   * @returns {string} Template's raw markup ready for Mustache.render().
   */
  function tpl(id) { return $(id).innerHTML; }

  /**
   * @param {string} s Date as "YYYY" or "YYYY-MM".
   * @returns {number} Date as fractional year, e.g. "2018-05" ---> 2018.33.

   */
  function toYear(s) {
    var bits = String(s).split('-');
    return Number(bits[0]) + ((bits.length > 1 ? Number(bits[1]) : 1) - 1) / 12;
  }

  /**
   * @param {string} s Date as "YYYY" or "YYYY-MM".
   * @returns {string} "YYYY" unchanged or "Month YYYY" for a "YYYY-MM" input.
   */
  function pretty(s) {
    var names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var bits = String(s).split('-');
    return bits.length < 2 ? bits[0] : names[Number(bits[1]) - 1] + ' ' + bits[0];
  }

  /**
   * Show validation failure box instead of erroneous diagram, listing what Validate object found.
   * 
   * @param {string[]} lines Individual message per validation failure. 
   */
  function showError(lines) {
    var box = $('tl-error');
    box.hidden = false;
    box.innerHTML = '<p>The timeline data failed validation, so nothing was drawn.</p>';

    var ul = document.createElement('ul');
    lines.forEach(function(line) {
      var li = document.createElement('li');
      li.textContent = line;
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  /**
   * @returns {object[]} Every event when no category filter is set or otherwise only events in the currently selected category.
   */
  function shown() {
    return filter === null
        ? events
        : events.filter(function(e) { return e.category === filter; });
  }

  function updateCount() {
    var list = shown();
    var done = list.filter(function(e) { return e.year <= head; }).length;
    var y = Math.floor(head);
    var m = Math.min(12, Math.max(1, Math.round((head - y) * 12) + 1));

    $('tl-count').textContent = done + ' of ' + list.length + ' events';
    $('tl-year').textContent = pretty(y + '-' + (m < 10 ? '0' : '') + m);
  }

  /**
   * 
   * @param {?string} id Event id to select or null to clear selection.
   */
  function select(id) {
    selectedId = id;

    var rows = document.querySelectorAll('#tl-tbody tr');
    Array.prototype.forEach.call(rows, function(tr) {
      var on = tr.getAttribute('data-id') === id;
      tr.classList.toggle('is-on', on);
      tr.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    var box = $('tl-detail');

    if (id === null) {
      box.innerHTML = '<p class="tl-hint">Press play, or pick any event.</p>';
      return;
    }

    var e = events.filter(function(x) { return x.id === id; })[0];

    box.innerHTML = Mustache.render(tpl('tpl-tl-detail'), {
      title: e.title,
      when: pretty(e.date),
      category: catById[e.category].label,
      note: e.note || '',
      hasRef: !!e.ref,
      ref: e.ref
    });

    document.dispatchEvent(new CustomEvent('refs:refresh'));
  }

  /**
   * @param {object} e Event to jump to.
   */
  function goTo(e) {
    head = e.year;
    select(e.id);
    updateCount();
  }

  /**
   * @param {number} dir Direction to step: 1 for next, -1 for previous.
   */
  function step(dir) {
    var list = shown();
    if (list.length === 0) return;

    setPlaying(false);

    var i = list.findIndex(function(e) { return e.id === selectedId; });
    i = i === -1 ? (dir > 0 ? 0 : list.length - 1) : i + dir;
    if (i < 0) i = list.length - 1;
    if (i >= list.length) i = 0;

    goTo(list[i]);
  }

  /**
   * @param {boolean} on True if starting play, false for pausing.
   */
  function setPlaying(on) {
    playing = on;
    var btn = $('tl-play');
    btn.textContent = on ? 'Pause' : 'Play';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /**
   * Toggle category filter on different metrics.
   * @param {string} catId Category id to toggle.
   */
  function setFilter(catId) {
    filter = filter === catId ? null : catId;

    var items = document.querySelectorAll('#tl-key li');
    Array.prototype.forEach.call(items, function(li) {
      var on = filter === null || li.getAttribute('data-cat') === filter;
      li.classList.toggle('is-off', !on);
      li.setAttribute('aria-pressed', li.getAttribute('data-cat') === filter ? 'true' : 'false');
    });

    var rows = document.querySelectorAll('#tl-tbody tr');
    Array.prototype.forEach.call(rows, function(tr) {
      tr.hidden = filter !== null && tr.getAttribute('data-cat') !== filter;
    });

    if (selectedId !== null) {
      var still = shown().some(function(e) { return e.id === selectedId; });
      if (!still) select(null);
    }

    updateCount();
  }


  /**
   * P5 sketch instance. Every canvas related events are inside this.
   *
   * @param {object} p p5 instance supplied by `new p5(sketch)`.
   */
  function sketch(p) {
    var dragging = false;
    var from = 0;
    var to = 0;

    function xFor(year) {
      var w = p.width - PAD.left - PAD.right;
      return PAD.left + ((year - from) / (to - from)) * w;
    }

    function yearAt(px) {
      var w = p.width - PAD.left - PAD.right;
      return p.constrain(from + ((px - PAD.left) / w) * (to - from), from, to);
    }

    function laneY(catId) {
      var i = data.categories.findIndex(function(c) { return c.id === catId; });
      var span = H - PAD.top - PAD.bottom;
      return PAD.top + (span / (data.categories.length - 1 || 1)) * i;
    }

    function hit(mx, my) {
      var found = null;
      shown().forEach(function(e) { // Fires once on frame where playhead crosses an event.
        if (p.dist(mx, my, xFor(e.year), laneY(e.category)) < 15) found = e.id;
      });
      return found;
    }

    p.setup = function() {
      var box = $('tl-canvas');
      p.createCanvas(box.clientWidth, H).parent(box);
      p.textFont('ui-monospace, SFMono-Regular, Menlo, monospace');

      from = data.meta.yearFrom;
      to = data.meta.yearTo + 0.5;
      head = from;

      if (typeof p.describe === 'function') {
        p.describe('A playable timeline of ' + events.length + ' events between ' + data.meta.yearFrom + ' and ' + data.meta.yearTo + '. The same events are listed in the table below the canvas.');
      }
    };

    p.windowResized = function() {
      p.resizeCanvas($('tl-canvas').clientWidth, H);
    };

    p.draw = function() {
      p.clear();

      if (playing) {
        var before = head;
        head += RATE * (p.deltaTime / 1000);

        shown().forEach(function(e) {
          if (e.year > before && e.year <= head) {
            if (!reduced) {
              pulses.push({ x: xFor(e.year), y: laneY(e.category), r: 8, col: catById[e.category].color });
            }
            select(e.id);
          }
        });

        if (head >= to) {
          head = to;
          setPlaying(false);
        }
        updateCount();
      }

      var baseY = H - PAD.bottom + 16;

      p.textAlign(p.CENTER, p.TOP);
      p.textSize(10);
      for (var y = Math.ceil(from); y <= Math.floor(to); y++) {
        var gx = xFor(y);
        var major = y % 5 === 0;

        p.stroke(36, 56, 44, major ? 40 : 18);
        p.line(gx, PAD.top - 26, gx, baseY);

        if (major) {
          p.noStroke();
          p.fill(31, 41, 36, 140);
          p.text(y, gx, baseY + 8);
        }
      }

      data.categories.forEach(function(c) {
        var ly = laneY(c.id);
        var dim = filter !== null && filter !== c.id;

        p.stroke(36, 56, 44, dim ? 10 : 22);
        p.strokeWeight(1);
        p.line(PAD.left, ly, p.width - PAD.right, ly);

        p.noStroke();
        p.fill(31, 41, 36, dim ? 40 : 95);
        p.textAlign(p.LEFT, p.BOTTOM);
        p.textSize(9);
        p.text(c.label.toUpperCase(), PAD.left, ly - 12);
      });

      for (var i = pulses.length - 1; i >= 0; i--) {
        var pu = pulses[i];
        pu.r += 1.8;

        var a = p.map(pu.r, 8, 64, 150, 0);
        if (a <= 0) { pulses.splice(i, 1); continue; }

        var pc = p.color(pu.col);
        p.noFill();
        p.stroke(p.red(pc), p.green(pc), p.blue(pc), a);
        p.strokeWeight(1.5);
        p.circle(pu.x, pu.y, pu.r * 2);
      }

      events.forEach(function(e) {
        var ex = xFor(e.year);
        var ey = laneY(e.category);
        var col = p.color(catById[e.category].color);
        var dim = filter !== null && filter !== e.category;
        var past = e.year <= head;
        var on = e.id === hoverId || e.id === selectedId;

        if (dim) {
          p.noStroke();
          p.fill(31, 41, 36, 22);
          p.circle(ex, ey, 6);
          return;
        }

        if (!past) {
          p.noFill();
          p.stroke(p.red(col), p.green(col), p.blue(col), 70);
          p.strokeWeight(1);
          p.circle(ex, ey, 9);
          return;
        }

        p.stroke(p.red(col), p.green(col), p.blue(col), 55);
        p.strokeWeight(1);
        p.line(ex, ey, ex, baseY);

        if (on) {
          p.noStroke();
          p.fill(p.red(col), p.green(col), p.blue(col), 45);
          p.circle(ex, ey, 30);
        }

        p.noStroke();
        p.fill(col);
        p.circle(ex, ey, on ? 15 : 11);

        if (e.id === selectedId) {
          p.noFill();
          p.stroke(31, 41, 36);
          p.strokeWeight(1.5);
          p.circle(ex, ey, 23);
        }
      });

      var hx = xFor(head);
      p.stroke(155, 34, 66, 220);
      p.strokeWeight(1.5);
      p.line(hx, PAD.top - 30, hx, baseY);

      p.noStroke();
      p.fill(155, 34, 66);
      p.triangle(hx - 5, PAD.top - 30, hx + 5, PAD.top - 30, hx, PAD.top - 22);

      if (hoverId !== null) {
        var he = events.filter(function(x) { return x.id === hoverId; })[0];
        var tx = xFor(he.year);
        var ty = laneY(he.category);

        p.textSize(11);
        var label = pretty(he.date) + '   ' + he.title;
        var w = p.textWidth(label) + 20;
        var bx = p.constrain(tx - w / 2, 4, p.width - w - 4);

        p.noStroke();
        p.fill(31, 41, 36, 240);
        p.rect(bx, ty - 42, w, 25, 2);

        p.fill(255);
        p.textAlign(p.LEFT, p.CENTER);
        p.text(label, bx + 10, ty - 29);
      }
    };

    p.mouseMoved = function() {
      var inside = p.mouseX >= 0 && p.mouseX <= p.width && p.mouseY >= 0 && p.mouseY <= H;
      hoverId = inside ? hit(p.mouseX, p.mouseY) : null;
      $('tl-canvas').style.cursor = hoverId ? 'pointer' : 'default';
    };

    p.mousePressed = function() {
      if (p.mouseY < 0 || p.mouseY > H) return;

      var id = hit(p.mouseX, p.mouseY);
      if (id !== null) {
        setPlaying(false);
        goTo(events.filter(function(x) { return x.id === id; })[0]);
        return;
      }

      setPlaying(false);
      dragging = true;
      head = yearAt(p.mouseX);
      updateCount();
    };

    p.mouseDragged = function() {
      if (!dragging) return;
      head = yearAt(p.mouseX);
      updateCount();
    };

    p.mouseReleased = function() { dragging = false; };
  }

  /**
   * Build sorted event list which renders table and category key, wiring every control key.
   *
   * @param {object} d Validated contents of timeline.json.
   */
  function start(d) {
    data = d;
    d.categories.forEach(function(c) { catById[c.id] = c; });

    events = d.events
        .map(function(e) {
          var c = Object.assign({}, e);
          c.year = toYear(e.date);
          return c;
        })
        .sort(function(a, b) { return a.year - b.year; });

    $('tl-tbody').innerHTML = Mustache.render(tpl('tpl-tl-rows'), {
      rows: events.map(function(e) {
        return {
          id: e.id,
          cat: e.category,
          when: pretty(e.date),
          title: e.title,
          category: catById[e.category].label,
          note: e.note || ''
        };
      })
    });

    $('tl-key').innerHTML = Mustache.render(tpl('tpl-tl-key'), { cats: d.categories });

    $('tl-key').addEventListener('click', function(ev) {
      var li = ev.target.closest('li[data-cat]');
      if (li !== null) setFilter(li.getAttribute('data-cat'));
    });

    $('tl-key').addEventListener('keydown', function(ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var li = ev.target.closest('li[data-cat]');
      if (li === null) return;
      ev.preventDefault();
      setFilter(li.getAttribute('data-cat'));
    });

    $('tl-tbody').addEventListener('click', function(ev) {
      var tr = ev.target.closest('tr[data-id]');
      if (tr === null) return;
      setPlaying(false);
      goTo(events.filter(function(x) { return x.id === tr.getAttribute('data-id'); })[0]);
    });

    $('tl-tbody').addEventListener('keydown', function(ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var tr = ev.target.closest('tr[data-id]');
      if (tr === null) return;
      ev.preventDefault();
      setPlaying(false);
      goTo(events.filter(function(x) { return x.id === tr.getAttribute('data-id'); })[0]);
    });

    $('tl-play').addEventListener('click', function() {
      if (!playing && head >= data.meta.yearTo + 0.5) head = data.meta.yearFrom;
      setPlaying(!playing);
    });

    $('tl-prev').addEventListener('click', function() { step(-1); });
    $('tl-next').addEventListener('click', function() { step(1); });

    $('tl-reset').addEventListener('click', function() { // Passing current filter toggles it off
      setPlaying(false);
      setFilter(filter);
      head = data.meta.yearFrom;
      pulses = [];
      select(null);
      updateCount();
    });

    document.addEventListener('keydown', function(ev) {
      if (/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
      if (ev.key === 'ArrowRight') { ev.preventDefault(); step(1); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); step(-1); }
    });
    var refs = [];
    events.forEach(function(e) {
      if (e.ref && refs.indexOf(e.ref) === -1) refs.push(e.ref);
    });

    $('tl-sources').innerHTML = Mustache.render(tpl('tpl-tl-sources'), { refs: refs });
    new p5(sketch);
    select(null);
    updateCount();
    document.dispatchEvent(new CustomEvent('refs:refresh'));
  }

  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  fetch(SOURCE)
      .then(function(res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + SOURCE);
        return res.json();
      })
      .then(function(d) {
        var errors = Validate.timeline(d);
        if (errors.length > 0) { showError(errors); return; }
        start(d);
      })
      .catch(function(err) { showError([err.message]); });
}());
