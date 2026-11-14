// Small maps on record pages, in the atlas style. City-level points use the relief base;
// synagogues, sites and cemeteries switch to the street base so they can be seen inside the city.
(function () {
  if (!window.L) return;
  function symbol(p) {
    var cls = 'sym ' + (p.precision === 'approximate' ? 'approx ' : '');
    var shape = p.kind === 'cemetery' ? '<path d="M6 17 V9 a5 5 0 0 1 10 0 V17Z" class="' + cls + 'sym-cemetery"/><path d="M11 9.5v4 M9.3 11.2h3.4" class="sym-glyph"/>'
      : p.kind === 'synagogue' ? '<path d="M3 10 L11 3 L19 10 V18 H3Z" class="' + cls + 'sym-synagogue"/>'
      : p.kind === 'city' ? '<circle cx="11" cy="11" r="4" class="sym sym-ink"/>'
      : '<rect x="4" y="5" width="13" height="12" class="' + cls + 'sym-building"/>';
    return L.divIcon({ className: 'kh-mark', html: '<svg width="22" height="22">' + shape + '</svg>', iconSize: [22, 22], iconAnchor: [11, 11] });
  }
  document.querySelectorAll('.minimap[data-points]').forEach(function (el) {
    var pts = JSON.parse(el.dataset.points || '[]');
    var T = JSON.parse(el.dataset.tiles || '{}');
    if (!pts.length) return;
    var local = pts.every(function (p) { return p.kind !== 'city'; });
    var base = local && T.street ? T.street : T.relief;
    var map = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomControl: true, maxZoom: base.maxZoom || 13 });
    L.tileLayer(base.url, { maxZoom: base.maxZoom || 13, attribution: base.attribution, className: local ? 'street-tiles' : '' }).addTo(map);
    map.attributionControl.setPrefix(false);
    var group = L.featureGroup(pts.map(function (p) {
      var m = L.marker([p.lat, p.lon], { icon: symbol(p), title: p.name, keyboard: !!p.href });
      if (pts.length <= 4 || !local) m.bindTooltip(p.name.split(',')[0], { permanent: true, direction: 'right', offset: [10, 0], className: 'kh-label' + (local ? ' kh-local' : '') });
      else m.bindTooltip(p.name, { direction: 'top', className: 'kh-label kh-local' });
      if (p.href) m.on('click', function () { location.href = p.href; });
      return m;
    })).addTo(map);
    if (pts.length === 1) map.setView([pts[0].lat, pts[0].lon], local ? 15 : 6);
    else map.fitBounds(group.getBounds().pad(local ? 0.15 : 0.3), { maxZoom: local ? 16 : 6 });
  });
})();
