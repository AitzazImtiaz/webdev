/**
 * @file culture.js
 * @fileoverview This script enables scrolling on culture page animation
 * for Netflix dispute. Sticky chart moves as we scroll down.
 *
 * This is bundled with esbuild, so you can rebuild using `npm run build:culture`.
 * Since two traffic measurements are reported, to not present it as data, I am using dashed lines.
 * 
 * @see data/peering.json
 * @see js/validate.js
 * @author Aitzaz Imtiaz (明澈)
 */

import scrollama from 'scrollama';
import { scaleLinear } from 'd3-scale';
import { line, curveMonotoneX } from 'd3-shape';
import { select } from 'd3-selection';

const Validate = require('./validate.js');

const W = 800;
const H = 460;
const PAD = { top: 40, right: 34, bottom: 46, left: 62 };

const FROM = 2016;
const TO = 2024;

/**
 * Months are fractional so use this to place events between year ticks 
 * 
 * @param {string} s Date as "YYYY" or "YYYY-MM."
 * @returns {number} Date as a fractional year, e.g. "2018-05" ---> 2018.33.
 */
function toYear(s) {
  const [y, m] = String(s).split('-');
  return Number(y) + ((m ? Number(m) : 1) - 1) / 12;
}

/** 
 * Show validation failure box instead of chart, listing the issues validation found.
 * 
 * @param {string[]} lines Message per validation failure.
 */
function showError(lines) {
  const box = document.getElementById('cu-error');
  box.hidden = false;
  box.innerHTML = '<p>The peering data failed validation, so the chart was not drawn.</p>';

  const ul = document.createElement('ul');
  lines.forEach((l) => {
    const li = document.createElement('li');
    li.textContent = l;
    ul.appendChild(li);
  });
  box.appendChild(ul);
}
/**
 * Build chart and wire it to scrollama, only run after validation is passed.
 * 
 * @param {object} data Validated contents of peering.json 
 */
function start(data) {
  const traffic = data.traffic.map((t) => ({ ...t, year: toYear(t.date) }));
  const steps = data.steps.map((s) => ({ ...s, year: toYear(s.date) }));

  const x = scaleLinear().domain([FROM, TO]).range([PAD.left, W - PAD.right]);
  const y = scaleLinear().domain([0, 1300]).range([H - PAD.bottom, PAD.top]);

  const svg = select('#cu-chart')
      .attr('viewBox', `0 0 ${W} ${H}`)
      .attr('role', 'img')
      .attr('aria-label', 'Netflix traffic to SK Broadband, rising from 50 gigabits per second in May 2018 to 1,200 in September 2021. The same figures appear in the text beside the chart.');

  [0, 300, 600, 900, 1200].forEach((v) => {
    svg.append('line')
        .attr('x1', PAD.left).attr('x2', W - PAD.right)
        .attr('y1', y(v)).attr('y2', y(v))
        .attr('class', 'cu-grid');

    svg.append('text')
        .attr('x', PAD.left - 10).attr('y', y(v) + 4)
        .attr('class', 'cu-ylab')
        .attr('text-anchor', 'end')
        .text(v === 0 ? '0' : `${v} Gbps`);
  });

  for (let yr = FROM; yr <= TO; yr += 2) {
    svg.append('text')
        .attr('x', x(yr)).attr('y', H - PAD.bottom + 20)
        .attr('class', 'cu-xlab')
        .attr('text-anchor', 'middle')
        .text(yr);
  }

  const path = svg.append('path')
      .datum(traffic)
      .attr('class', 'cu-line')
      .attr('d', line().x((d) => x(d.year)).y((d) => y(d.gbps)).curve(curveMonotoneX));

  const len = path.node().getTotalLength();
  path.attr('stroke-dasharray', `6 5`).attr('stroke-dashoffset', 0); // offset will be reused below to reveal line as reader keeps scrolling

  const dots = svg.append('g');
  traffic.forEach((t) => {
    dots.append('circle')
        .attr('cx', x(t.year)).attr('cy', y(t.gbps))
        .attr('r', 0)
        .attr('class', 'cu-dot')
        .attr('data-year', t.year);

    dots.append('text')
        .attr('x', x(t.year) + 10).attr('y', y(t.gbps) - 10)
        .attr('class', 'cu-dotlab')
        .attr('data-year', t.year)
        .attr('opacity', 0)
        .text(`${t.gbps} Gbps`);
  });

  const marks = svg.append('g');
  steps.forEach((s) => {
    marks.append('line')
        .attr('x1', x(s.year)).attr('x2', x(s.year))
        .attr('y1', PAD.top - 14).attr('y2', H - PAD.bottom)
        .attr('class', 'cu-mark')
        .attr('data-step', s.id);

    marks.append('text')
        .attr('x', x(s.year)).attr('y', PAD.top - 20)
        .attr('class', 'cu-marklab')
        .attr('data-step', s.id)
        .attr('text-anchor', 'middle')
        .text(s.title);
  });

  /**
   * Update chart for step inside view, highling its marker and revealing every data dotted up that year.
   * @param {number} i Index 
   */
  function activate(i) {
    const cur = steps[i];

    select('#cu-chart').selectAll('.cu-mark')
        .classed('is-on', function() {
          return this.getAttribute('data-step') === cur.id;
        });

    select('#cu-chart').selectAll('.cu-marklab')
        .classed('is-on', function() {
          return this.getAttribute('data-step') === cur.id;
        });

    select('#cu-chart').selectAll('.cu-dot')
        .attr('r', function() {
          return Number(this.getAttribute('data-year')) <= cur.year ? 6 : 0;
        });

    select('#cu-chart').selectAll('.cu-dotlab')
        .attr('opacity', function() {
          return Number(this.getAttribute('data-year')) <= cur.year ? 1 : 0;
        });

    // Fraction of distance in between two measured points
    const shown = Math.max(0, Math.min(1, (cur.year - traffic[0].year) / (traffic[1].year - traffic[0].year)));
    path.attr('stroke-dashoffset', len * (1 - shown));

    document.querySelectorAll('.cu-step').forEach((el) => {
      el.classList.toggle('is-on', el.getAttribute('data-step') === cur.id);
    });
  }

  const scroller = scrollama();

  scroller
      .setup({ step: '.cu-step', offset: 0.6 })
      .onStepEnter((res) => activate(res.index));

  window.addEventListener('resize', scroller.resize);

  activate(0);
}

// Error handling, do not draw chart but dump error
fetch('data/peering.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching data/peering.json`);
      return res.json();
    })
    .then((d) => {
      const errors = Validate.peering(d);
      if (errors.length > 0) { showError(errors); return; }
      start(d);
    })
    .catch((err) => showError([err.message]));
