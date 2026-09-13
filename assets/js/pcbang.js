/**
 * @file pcbang.js
 * @fileoverview Provisions a floor plan which is shared over any two browsers
 * using WebRTC protocol.
 * 
 * The following will enable a text-communication based session after each side
 * creates a description blob. Lz-string squeezes it into a short encoding that two 
 * people exchange between them without the need of signalling. (Hence works offline)
 * 
 * For online usage, it connects to public STUN server, see 
 * {@link https://stackoverflow.com/questions/20067739/what-is-stun-stun-l-google-com19302-used-for}.
 * 
 * @see data/pcbang.json – Bottom page implementation for chart
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';

  /** Define seating plan for  floor.*/
  var COLS = 8;
  var ROWS = 3;
  var SEAT_W = 76;
  var SEAT_H = 62;

  /**
   * Define STUN server. If offline: unreachable so default to local network.
   */
  var ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

  /**
   * Assign wait time, if exceeded, server was not reached.
   */
  var GATHER_MS = 3000;

  /** Timeout between showing cursor update. */
  var MOVE_MS = 33;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var pc = null;
  var ch = null;
  var mySeat = null;
  var theirSeat = null;
  var lastMove = 0;

  /**
   * @param {string} id Element id.
   * @returns {HTMLElement} Store the element or assign null.
   */
  function $(id) { return document.getElementById(id); }

  /**
   * Append line to log ("console-like") screen, provisioning to 
   * be scrolled at bottom.
   *
   * @param {string} text Line to show.
   * @param {string} [cls] Optional class: 'me' or 'sys.'
   */
  function say(text, cls) {
    var p = document.createElement('p');
    p.className = cls || '';
    p.textContent = text;
    $('log').appendChild(p);
    $('log').scrollTop = $('log').scrollHeight;
  }

  /**
   * @param {object} obj Session description.
   * @returns {string} Base64 blob encoding of obj.
   */
  function pack(obj) {
    return LZString.compressToBase64(JSON.stringify(obj));
  }

  /**
   * @param {string} text Base64 blob from other party.
   * @returns {object} Decodes it back to original session description to be processed.
   */
  function unpack(text) {
    return JSON.parse(LZString.decompressFromBase64(text.trim()));
  }

  /**
   * Summarize and define candidate in session description by their type
   * so log shows which connection is available.
   *
   * @param {RTCSessionDescription} desc Local description to inspect.
   * @returns {{total: number, host: number, srflx: number, mdns: number}} Counts.
   */
  function summarise(desc) {
    if (desc === null) return { total: 0, host: 0, srflx: 0, mdns: 0 };

    var lines = desc.sdp.match(/a=candidate:.*/g) || [];
    var count = function(re) {
      return lines.filter(function(l) { return re.test(l); }).length;
    };

    return {
      total: lines.length,
      host: count(/ typ host/), // Machine own address
      srflx: count(/ typ srflx/), // Public Address reported by STUN
      mdns: count(/\.local /) // Host candidate's mDNS host name
    };
  }

  /**
   * Push result from above to show on the log screen.
   * 
   * @see summarise(desc)
   * @param {object} c Result of summarise().
   * @returns {string} String reporting the message of c.
   */
  function describe(c) {
    if (c.total === 0) {
      return 'No network candidates found. Check that a WiFi or LAN ' +
          'interface is up, then press Reset and try again.';
    }

    var parts = [];
    if (c.host > 0) parts.push(c.host + ' local');
    if (c.srflx > 0) parts.push(c.srflx + ' via STUN');

    var note = c.srflx > 0
        ? ' Both networks reachable.'
        : ' Local only, so other browser must be on this machine or ' +
          'this network.';

    if (c.srflx === 0 && c.mdns > 0) {
      note += ' A VPN will block these.';
    }

    return 'Gathered ' + c.total + ' candidate' + (c.total === 1 ? '' : 's') +
        ' (' + parts.join(', ') + ').' + note;
  }

  /**
   * Draw seats as SVG definition; render them as a table for accessibility.
   */
  function drawSeats() {
    var g = $('seats');
    var rows = [];

    for (var i = 0; i < COLS * ROWS; i++) {
      var col = i % COLS;
      var row = Math.floor(i / COLS);
      var x = 24 + col * SEAT_W;
      var y = 30 + row * SEAT_H;

      var r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('class', 'seat');
      r.setAttribute('x', x);
      r.setAttribute('y', y);
      r.setAttribute('width', 58);
      r.setAttribute('height', 44);
      r.setAttribute('data-seat', i + 1);
      g.appendChild(r);

      var t = document.createElementNS(SVG_NS, 'text');
      t.setAttribute('class', 'seat-n');
      t.setAttribute('x', x + 4);
      t.setAttribute('y', y + 56);
      t.textContent = i + 1;
      g.appendChild(t);
      rows.push({ n: i + 1, row: row + 1 });
    }

    $('seat-tbody').innerHTML =
        Mustache.render($('tpl-seats').innerHTML, { seats: rows });
  }

  /** Color the seat selected by user. */
  function paint() {
    var seats = document.querySelectorAll('#seats .seat');
    Array.prototype.forEach.call(seats, function(r) {
      var n = Number(r.getAttribute('data-seat'));
      r.classList.toggle('mine', n === mySeat);
      r.classList.toggle('theirs', n === theirSeat);
    });
  }

  /**
   * Send message if connection is established.
   *
   * @param {object} msg Message to be send.
   */
  function send(msg) {
    if (ch !== null && ch.readyState === 'open') ch.send(JSON.stringify(msg));
  }

  /**
   * Claim a seat locally and report to other side.
   * Caveat: Two users can sit on a same seat.

   * @param {number} n Seat numbers. (1-24)
   */
  function takeSeat(n) {
    mySeat = n;
    paint();
    send({ t: 'seat', n: n });
    say('You took seat ' + n + '.', 'me');
  }

  /**
   * Draw other person's cursor to screen. Delete old position
   * and update with new one.
   *
   * @param {number} x Coordinate in viewBox units.
   * @param {number} y Coordinate in viewBox units.
   */
  function ghost(x, y) {
    var g = $('ghosts');
    g.innerHTML = '';
    var c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('class', 'ghost');
    c.setAttribute('cx', x);
    c.setAttribute('cy', y);
    c.setAttribute('r', 5);
    g.appendChild(c);
  }

  /**
   * Attach handlers to data channel where host passes channel it made
   * and guest passes the one it generates after getting blob.
   *
   * @param {RTCDataChannel} channel Channel used to operate room
   */
  function wire(channel) {
    ch = channel;

    ch.onopen = function() {
      say('Channel open. You are talking directly to the other browser.', 'sys');
      $('say').disabled = false;
      $('send').disabled = false;
      // Announce again in case a seat was picked before the channel opened.
      if (mySeat !== null) send({ t: 'seat', n: mySeat });
    };

    ch.onclose = function() {
      say('Channel closed.', 'sys');
      $('say').disabled = true;
      $('send').disabled = true;
    };

    ch.onmessage = function(ev) {
      var msg = JSON.parse(ev.data);
      if (msg.t === 'seat') {
        theirSeat = msg.n;
        paint();
        say('They took seat ' + msg.n + '.');
      }
      if (msg.t === 'move') ghost(msg.x, msg.y);
      if (msg.t === 'say') say('them: ' + msg.text);
    };
  }

  /**
   * Resolve once ICE gathers adresses or certain time has passed. 
   *
   * @returns {Promise<void>} Settles when local description is ready to send.
   */
  function gathered() {
    var conn = pc;

    return new Promise(function(resolve) {
      var settled = false;

      var finish = function() {
        if (settled) return;
        settled = true;
        say(describe(summarise(conn.localDescription)), 'sys');
        resolve();
      };

      if (conn.iceGatheringState === 'complete') { finish(); return; }

      conn.onicegatheringstatechange = function() {
        if (conn.iceGatheringState === 'complete') finish();
      };

      window.setTimeout(finish, GATHER_MS);
    });
  }

  /** Refresh and open new instance in case if its intention/dealing an error. */
  function fresh() {
    if (pc !== null) pc.close();

    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onconnectionstatechange = function() {
      say('Connection: ' + pc.connectionState + '.', 'sys');
    };

    pc.oniceconnectionstatechange = function() {
      say('ICE: ' + pc.iceConnectionState + '.', 'sys');
      if (pc.iceConnectionState === 'failed') {
        say('No route between two browsers. Both must be on the same ' +
            'network, and a firewall or VPN might be blocking this.', 'sys');
      }
    };
  }

  // Define other cases where connection is established or mishaps

  $('host').addEventListener('click', function() {
    fresh();
    wire(pc.createDataChannel('pcbang'));

    pc.createOffer()
        .then(function(o) { return pc.setLocalDescription(o); })
        .then(gathered)
        .then(function() {
          $('mine').value = pack(pc.localDescription);
          say('Offer ready. Send your code to other seat.', 'sys');
        })
        .catch(function(err) { say('Could not build an offer: ' + err.message, 'sys'); });
  });

  $('join').addEventListener('click', function() {
    fresh();
    pc.ondatachannel = function(ev) { wire(ev.channel); };
    say('Ready. Paste their code into box 3, then press Connect.', 'sys');
  });

  $('connect').addEventListener('click', function() {
    if (pc === null) { say('Press Host or Join first.', 'sys'); return; }

    var desc;
    try {
      desc = unpack($('theirs').value);
    } catch (e) {
      say('That code could not be read.', 'sys');
      return;
    }

    pc.setRemoteDescription(desc)
        .then(function() {
          if (desc.type !== 'offer') { say('Answer accepted.', 'sys'); return null; }

          return pc.createAnswer()
              .then(function(a) { return pc.setLocalDescription(a); })
              .then(gathered)
              .then(function() {
                $('mine').value = pack(pc.localDescription);
                say('Answer ready. Send your code back.', 'sys');
              });
        })
        .catch(function(err) { say('Failed: ' + err.message, 'sys'); });
  });

  $('drop').addEventListener('click', function() {
    if (pc !== null) pc.close();
    pc = null;
    ch = null;
    mySeat = null;
    theirSeat = null;
    lastMove = 0;
    $('mine').value = '';
    $('theirs').value = '';
    $('log').innerHTML = '';
    $('ghosts').innerHTML = '';
    $('say').disabled = true;
    $('send').disabled = true;
    paint();
    say('Reset.', 'sys');
  });

  $('send').addEventListener('click', function() {
    var text = $('say').value.trim();
    if (text === '') return;
    send({ t: 'say', text: text });
    say('you: ' + text, 'me');
    $('say').value = '';
  });

  $('say').addEventListener('keydown', function(ev) {
    if (ev.key === 'Enter') $('send').click();
  });

  $('seats').addEventListener('click', function(ev) {
    var n = ev.target.getAttribute('data-seat');
    if (n !== null) takeSeat(Number(n));
  });

  $('seat-tbody').addEventListener('click', function(ev) {
    var n = ev.target.getAttribute('data-seat');
    if (n !== null) takeSeat(Number(n));
  });

  // Cursor positions are sent in viewBox units rather than pixels so
  // browsers need not to be at same size window.
  $('room').addEventListener('mousemove', function(ev) {
    var now = Date.now();
    if (now - lastMove < MOVE_MS) return;
    lastMove = now;

    var box = $('room').getBoundingClientRect();
    var x = ((ev.clientX - box.left) / box.width) * 800;
    var y = ((ev.clientY - box.top) / box.height) * 300;
    send({ t: 'move', x: Math.round(x), y: Math.round(y) });
  });

  drawSeats();

  /**
   * Venue count chart. Not related to anything above. This dumps bar chart for
   * statistics.
   * 
   * @see data/pcbang.json
   */
  fetch('data/pcbang.json')
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching data/pcbang.json');
        return r.json();
      })
      .then(function(d) {
        var errors = Validate.pcbang(d);
        if (errors.length > 0) {
          var box = $('pc-error');
          box.hidden = false;
          box.textContent = 'Venue data failed validation: ' + errors.join(' ');
          return;
        }

        var svg = $('chart');
        var max = Math.max.apply(null, d.counts.map(function(c) { return c.value; }));
        var w = 800 / d.counts.length;

        d.counts.forEach(function(c, i) {
          var h = (c.value / max) * 230;
          var x = i * w + 18;
          var y = 260 - h;

          var r = document.createElementNS(SVG_NS, 'rect');
          r.setAttribute('class', 'bar');
          r.setAttribute('x', x);
          r.setAttribute('y', y);
          r.setAttribute('width', w - 36);
          r.setAttribute('height', h);
          svg.appendChild(r);

          var l = document.createElementNS(SVG_NS, 'text');
          l.setAttribute('class', 'bar-l');
          l.setAttribute('x', x);
          l.setAttribute('y', y - 8);
          l.textContent = c.label;
          svg.appendChild(l);

          var yr = document.createElementNS(SVG_NS, 'text');
          yr.setAttribute('class', 'bar-y');
          yr.setAttribute('x', x);
          yr.setAttribute('y', 280);
          yr.textContent = c.year;
          svg.appendChild(yr);
        });
      })
      .catch(function(err) { console.error(err); });
}());