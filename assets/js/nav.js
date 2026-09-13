/**
 * @file nav.js
 * @fileoverview This file centres current section in navigation bar.
 * 
 * @author Aitzaz Imtiaz (明澈)
 */
(function() {
  'use strict';
  var current = document.querySelector('.topbar a[aria-current="page"]');
  if (!current) return;
  current.scrollIntoView({ inline: 'center', block: 'nearest' }); // to avoid dragging hero out of view
}());

