/**
 * @file gate.js
 * @fileoverview This is a honey pot algorithm based Client-side verification gate.
 * 
 * Its aim is to draw distortion based five-character "plate" on screen for index page holding 
 * the site behind it until the image is verified or an alternative 'Quick Maths' is solved. Has
 * stuff like timeout, and protection against bot typing answer fast.
 * 
 * Issue:
 *   - No timeout permanent block on multiple retries, could be good feature but harder
 * 
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';
  var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var length = 5;
  var min_resp = 900;
  var max_try = 5;
  var lock_ms = 15000;
  var pass_key = "gate.passed";
  var code = "";
  var altAnswer = "";
  var usingAlt = false;
  var shownAt = 0;
  var tries = 0;
  var humanInput = false;
  var lockedUntil = 0;
  var plateNo = 0;
  var $ = function(id) { return document.getElementById(id); };
  var gate;
  var cv;
  var ctx;

  ["pointermove", "pointerdown", "keydown", "touchstart", "wheel"].forEach(function(t) {
    window.addEventListener(t, function(e) {
      if (e.isTrusted) { humanInput = true; } // isTrusted is false for artificial bot-ish event to seperate pointer and keyboard movements against scripts like Python selenium
    }, {passive: true});
  });

  /**
   * @param {number} min Inclusive lower bound.
   * @param {numer} max Exclusive lower bound.
   * @returns {number} A value in [min, max).
   */
  function rand(min, max) {
    if (window.crypto && window.crypto.getRandomValues) {
      var b = new Uint32Array(1);
      window.crypto.getRandomValues(b);
      return min + (b[0] / 4294967296) * (max - min);
    }
    return min + Math.random() * (max - min);
  }

  /**
   * @param {string} str Source string to sample from.
   * @returns {string} Random character from str.
   */
  function pick(str) { return str.charAt(Math.floor(rand(0, str.length))); }

  /**
   * @returns {string} A fresh random plate code.
   */
  function makeCode() {
    var out = "";
    for (var i = 0; i < length; i++) { out += pick(chars); }
    return out;
  }

  /**
   * Render current plate code to canvas. Draw first to offscreen canvas and then
   * copy to canvas on screen.
   */
  function draw() {
    var dpr = window.devicePixelRatio || 1;
    var w = cv.clientWidth || 300, h = cv.clientHeight || 92;

    cv.width  = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);

    // draw characters on offscreen canvas first
    var off = document.createElement("canvas");
    off.width  = cv.width;
    off.height = cv.height;

    var octx = off.getContext("2d");
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.fillStyle = "#ffffff";
    octx.fillRect(0, 0, w, h);

    var inks = ["#14202e", "#2f5d8c", "#4a3d63", "#3f5d4a"];
    var slot = w / (length + 1);

    for (var i = 0; i < length; i++) {
      var size = rand(32, 44);
      octx.save();
      octx.translate(slot * (i + 1) + rand(-6, 6), h / 2 + rand(-7, 7));
      octx.rotate(rand(-0.38, 0.38));
      octx.transform(1, rand(-0.15, 0.15), rand(-0.22, 0.22), 1, 0, 0);
      octx.font = (rand(0, 1) > 0.5 ? "700 " : "500 ") + size + "px ui-monospace, Menlo, Consolas, monospace";
      octx.fillStyle = inks[Math.floor(rand(0, inks.length))];
      octx.textAlign = "center";
      octx.textBaseline = "middle";
      octx.fillText(code.charAt(i), 0, 0);
      octx.restore();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    var amp = rand(3, 6), per = rand(16, 30), phase = rand(0, 6.28);
    for (var x = 0; x < w; x++) { // One pixel column for a phase time, driven by sine to generate background image noise
      ctx.drawImage(off, x * dpr, 0, dpr, h * dpr, x, Math.sin(x / per + phase) * amp, 1, h);
    }

    ctx.lineWidth = 1.4;
    for (var s = 0; s < 4; s++) {
      ctx.strokeStyle = "rgba(20,32,46," + rand(0.18, 0.4).toFixed(2) + ")";
      ctx.beginPath();
      ctx.moveTo(0, rand(0, h));
      ctx.bezierCurveTo(rand(0, w), rand(0, h), rand(0, w), rand(0, h), w, rand(0, h));
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(20,32,46,.35)";
    for (var d = 0; d < 260; d++) {
      ctx.fillRect(rand(0, w), rand(0, h), 1.4, 1.4);
    }
  }

  // Spell out so sum can't be read from DOM, protection against dumb crawler bots (sophisticated one's can bypass whatsoever...)
  var WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen"];

  /**
   * Pick two small numbers with operator, set answer to result and write it as question into Quick Maths.
   */
  function newAlt() {
    var a = Math.floor(rand(2, 9)), b = Math.floor(rand(2, 9));
    var plus = rand(0, 1) > 0.5;
    // Do not turn subtraction to get negative result
    if (!plus && b > a) { var t = a; a = b; b = t; }
    altAnswer = String(plus ? a + b : a - b);
    $("alt-q").textContent = "What is " + WORDS[a] + (plus ? " plus " : " minus ") + WORDS[b] + "? Answer in digits.";
  }

  /**
   * Start new place code or question, re-drawn, ignored if a lock out, or when viewer refreshes the page.
   */
  function newChallenge() {
    plateNo++;
    $("plate-id").textContent = "plate " + String(plateNo).padStart(3, "0");
    code = makeCode();
    draw();
    newAlt();
    shownAt = Date.now();
    $("answer").value = "";
  }

  /**
   * @param {HTMLElement} el Status element to update.
   * @param {string} text Message to show.
   * @param {string} [tone] Internal referential signal defaulted to "mute."
   */
  function say(el, text, tone) {
    el.textContent = text;
    el.setAttribute("data-tone", tone || "mute");
  }

  function lockOut() {
    // No need for JSdocs. Self explanatory.
    lockedUntil = Date.now() + lock_ms;
    var btn = $("verify");
    btn.disabled = true;

    (function tick() {
      var left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left > 0) {
        say($("gate-msg"), "Too many attempts. Wait " + left + "s.", "bad");
        setTimeout(tick, 250);
      } else {
        btn.disabled = false;
        tries = 0;
        newChallenge();
        say($("gate-msg"), "Try again.", "mute");
      }
    })();
  }

  function passed() {
    // No need for JSdocs. 
    try {
      return sessionStorage.getItem(pass_key) === "1";
    } catch (e) {
      return false;
    }
  }

  /**
   * Record pass in browser memory, hide gate and reveal main site. 
   */
  function enter() {
    try { sessionStorage.setItem(pass_key, "1"); } catch (e) {}
    gate.classList.add("hidden");
    var app = $("app");
    if (app === null) {
      window.location.href = "index.html";
      return;
    }
    app.classList.remove("hidden");
    app.focus();
  }

  /**
   * Check visitor answer and check based on different conditions how to react. See internal comments.
   * @returns {null}
   */
  function verify() {
    if (Date.now() < lockedUntil) { return; }

    var msg = $("gate-msg");
    var given = $("answer").value.trim();

    if ($("hp-city").value !== "") { lockOut(); return; }

    // It is real fast to type below 900 ms but a user might do it ocassionally, time still feels natural for pause
    if (Date.now() - shownAt < min_resp) {
      say(msg, "That was too fast to be read. :o", "bad");
      newChallenge();
      return;
    }

    if (!humanInput) {
      say(msg, "No pointer or keyboard activity detected.", "bad");
      return;
    }

    if (!given) { say(msg, "Pfft. Please write something silly!", "bad"); return; }

    var ok = usingAlt ? given === altAnswer : given.toUpperCase() === code;

    if (!ok) {
      tries++;
      if (tries >= max_try) { lockOut(); return; }
      var left = max_try - tries;
      say(msg, "Not a match. " + left + " attempt" + (left === 1 ? "" : "s") + " left." + (tries >= 3 ? " Sighs. :(" : ""), "bad");
      newChallenge();
      return;
    }

    say(msg, "Verified. Let's gooo!", "good");
    setTimeout(enter, 320);
  }

  /**
   * Entry point.
   */
  function init() {
    gate = $("stage-gate");

    if (passed()) { enter(); return; }

    cv = $("plate");
    ctx = cv.getContext("2d");

    $("refresh").addEventListener("click", function() {
      newChallenge();
      say($("gate-msg"), "", "mute");
      $("answer").focus();
    });

    $("toggle-alt").addEventListener("click", function() {
      usingAlt = !usingAlt;
      $("plate-wrap").classList.toggle("hidden", usingAlt);
      $("alt-box").classList.toggle("hidden", !usingAlt);
      this.textContent = usingAlt ? "Use the plate" : "Use a text challenge";
      shownAt = Date.now();
      $("answer").value = "";
      $("answer").focus();
    });

    $("verify").addEventListener("click", verify);
    $("answer").addEventListener("keydown", function(e) {
      if (e.key === "Enter") { verify(); }
    });

    var resizeTimer;
    window.addEventListener("resize", function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() { if (!usingAlt) { draw(); } }, 120);
    });

    newChallenge();
  }

  init();
})();