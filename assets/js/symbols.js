// Kehillot map symbols: one definition shared by the build (Node) and every map (browser).
// Each kind is drawn as a small engraved-style SVG on a 24×24 grid. No religious symbols other
// than Jewish ones are used; cemeteries are plain headstones.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KhSymbols = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // kind → [label, plural, svg body]. Fill classes are styled in site.css.
  var KINDS = {
    synagogue: ['Synagogue', 'Synagogues',
      '<path d="M3 11 L12 3 L21 11 V21 H3Z" class="{c} sym-synagogue"/><path d="M10 21v-5h4v5" class="sym-line"/>'],
    cemetery: ['Cemetery', 'Cemeteries',
      '<path d="M6 21 V10 a6 6 0 0 1 12 0 V21Z" class="{c} sym-cemetery"/><path d="M9 12.5h6 M9 15.5h6" class="sym-line"/><path d="M4 21h16" class="sym-line"/>'],
    'matzah-bakery': ['Matzah bakery', 'Matzah bakeries',
      '<rect x="4" y="4" width="16" height="16" rx="3" class="{c} sym-matzah"/><path d="M8 8h.01M12 8h.01M16 8h.01M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h.01" class="sym-dots"/>'],
    lodging: ['Hotel or boarding house', 'Hotels and boarding houses',
      '<path d="M4 21 V8 L12 3 L20 8 V21Z" class="{c} sym-lodging"/><path d="M8 11h2M14 11h2M8 15h2M14 15h2" class="sym-line"/><path d="M11 21v-3h2v3" class="sym-line"/>'],
    'kosher-restaurant': ['Kosher restaurant', 'Kosher restaurants',
      '<circle cx="12" cy="12" r="8.5" class="{c} sym-restaurant"/><circle cx="12" cy="12" r="5" class="sym-line"/>'],
    business: ['Jewish-owned business', 'Jewish-owned businesses',
      '<path d="M3 9 L5 4 H19 L21 9Z" class="{c} sym-business-awning"/><rect x="4" y="9" width="16" height="12" class="{c} sym-business"/><path d="M9 21v-6h6v6" class="sym-line"/>'],
    bookstore: ['Bookstore', 'Bookstores',
      '<path d="M12 6 C9 4 6 4 3 5 V19 C6 18 9 18 12 20 C15 18 18 18 21 19 V5 C18 4 15 4 12 6Z" class="{c} sym-book"/><path d="M12 6 V20" class="sym-line"/>'],
    hospital: ['Hospital', 'Other sites', '<rect x="4" y="5" width="16" height="16" class="{c} sym-building"/><path d="M9 9v8M15 9v8M9 13h6" class="sym-line"/>'],
    school: ['School or educational institution', 'Educational institutions',
      '<path d="M3 21 V10 H21 V21Z" class="{c} sym-school"/><path d="M2 10 L12 5 L22 10" class="sym-line"/><path d="M10 5 V2.5 H14 V5" class="sym-line"/><path d="M7 13h3M14 13h3M10.5 21v-4h3v4" class="sym-line"/>'],
    'meeting-place': ['Meeting place', 'Other sites', '<rect x="4" y="6" width="16" height="15" class="{c} sym-building"/>'],
    residence: ['Residence', 'Other sites', '<path d="M4 11 L12 4 L20 11 V21 H4Z" class="{c} sym-building"/>'],
    city: ['City', 'Cities', '<circle cx="12" cy="12" r="4.5" class="sym sym-ink"/>'],
  };
  // Groups used for filters, in display order. Each kind belongs to exactly one group.
  var GROUPS = [
    ['Synagogues', ['synagogue']],
    ['Cemeteries', ['cemetery']],
    ['Matzah bakeries', ['matzah-bakery']],
    ['Hotels and boarding houses', ['lodging']],
    ['Kosher restaurants', ['kosher-restaurant']],
    ['Jewish-owned businesses', ['business']],
    ['Bookstores', ['bookstore']],
    ['Educational institutions', ['school']],
    ['Other sites', ['hospital', 'meeting-place', 'residence']],
  ];
  function groupOf(kind) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i][1].indexOf(kind) > -1) return GROUPS[i][0];
    return 'Other sites';
  }
  // svg(kind, {approx, faded, size}) → '<svg …>…</svg>'
  function svg(kind, o) {
    o = o || {};
    var k = KINDS[kind] || KINDS['meeting-place'];
    var c = 'sym' + (o.approx ? ' approx' : '') + (o.faded ? ' faded' : '');
    var size = o.size || 22;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + k[2].replace(/\{c\}/g, c) + '</svg>';
  }
  return { KINDS: KINDS, GROUPS: GROUPS, groupOf: groupOf, svg: svg, label: function (k) { return (KINDS[k] || [k])[0]; } };
});
