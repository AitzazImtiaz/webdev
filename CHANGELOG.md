# Changelog

A History of the Internet in South Korea — CM1040 Web Development.

Format follows Keep a Changelog and versions follow semantic versioning.

## [0.1 (Yulian)] — 2026-08-15

### Added

- Seven page with base structure linking each other
- Bilingual section navigation bar with Korean/English
- Full bleed hero banner
- Basic index write-up
- Created timeline film which uses `p5.js` to run some events
- Added playhead design, scrolling, and learnt building table and diagram out of single JSON with validation test
- Site footer with citation slots at bottom
- Custom CAPTCHA-like entry gate honeypot
- Skip link and landmark structure
- Multi-size favicon and touch icons, accessible for mac
- Responsive breakpoints

### Known Issues

 - Gate lockout does not block user after multiple failed tries (hard to implement)

## [0.2 (Ghani)] — 2026-08-21

### Added

- Network page with Cytoscape.js node link map
- Added preset and circle layouts, drag to pan, click a node for detail
- Accessible table rendering the same nodes and edges
- References page rendering full list from `references.json`
- PC Bang page with WebRTC p2p floor plan
- `lz-string` compresses session descriptions for copy-pasting
- Shared seat selections, live cursor and messages between peers
- Venue count chart drawn from `pcbang.json`

### Changed

- `#main` widened to two-column band grid
- Gate title demoted to `h2`; the hero `h1` is the document title
- Now in citation registry, `data-ref` markers numbered in document order

### Fixed

- `.lede` class collision between gate card and the intro grid
- `place-items` inherited from gate shrink-wrapped the footer
- `<label>` with no form control in gate's alternative challenge

### Known issues

- `pcbang.json` uses a `source` field that is not a reference id
- Cursor updates send on every mousemove as unthrottled
- Node colours duplicated between `graph.css` and `network.json` (partially ignored)

## [0.3Ait (Ming Che)] — 2026-09-05


### Added

- Culture page as a scroll telling on Netflix peering dispute
- `scrollama` drives seven steps against sticky d3 chart
- Traffic line drawn dashed to mark it as interpolation and NOT data
- Build step introduced: `esbuild` bundles `assets/js/` into `vendor/`
- Policy page run SQLite in the browser through WebAssembly!
- `sql.js` loads database compiled at build time from every JSON file
- CodeMirror editor with SQLite syntax highlighting
- Twelve preset queries so page works without typing SQL and having knowledge about it
- Schema panel read back from `sqlite_master` rather than hardcoded values
- Build fails and writes no database on a erroneous foreign key
- Six data protection laws added sourced from IAPP and DLA Piper

### Changed

- Validation moved from runtime to build time for Policy dataset
- Result tables given full grid lines with zebra rows and sticky headers for readability
- Assets reorganised into `assets/css`, `assets/js`, `assets/img` from root folder

### Fixed

- Two law entries written into `breaches` array instead of `laws`,
  which crashed build on missing `date`
- Reference list overflowing its column on long URLs was fixed in this version
- Stale `policy.db` served from cache ignoring rebuilt schema

### Known issues

- Colour values duplicated between CSS and JSON on two pages since
  canvas and WebAssembly cannot read a stylesheet (ignored)
- CodeMirror is `contenteditable` and so preset buttons are accessible path (could not fix)
- Only two traffic measurements exist for Culture chart (interpolation was easier than data)