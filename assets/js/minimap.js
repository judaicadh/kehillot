// Small maps on record pages, in the atlas style. City-level points use the relief base;
// synagogues, sites and cemeteries switch to the street base so they can be seen inside the city.
(function () {
  if (!window.L) return;
  function symbol(p) {
    return L.divIcon({ className: 'kh-mark', html: KhSymbols.svg(p.kind, { approx: p.precision === 'approximate', size: 22 }), iconSize: [22, 22], iconAnchor: [11, 11] });
  }
  document.querySelectorAll('.minimap[data-points]').forEach(function (el) {
    var pts = JSON.parse(el.dataset.points || '[]');
    var T = JSON.parse(el.dataset.tiles || '{}');
    if (!pts.length) return;
    var local = pts.every(function (p) { return p.kind !== 'city'; });
    var base = local && T.street ? T.street : T.relief;
    var map = L.map(el, { scrollWheelZoom: false, attributionControl: true, zoomControl: true, maxZoom: base.maxZoom || 13 });
    L.tileLayer(base.url, { maxZoom: base.maxZoom || 13, maxNativeZoom:base.maxNativeZoom || base.maxZoom || 13, attribution: base.attribution, className: local ? 'street-tiles' : '' }).addTo(map);
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
