// City guide: a street map of a city's Jewish sites, kept in step with the list beside it.
// The list is plain HTML (works without JavaScript); this script adds the map, the year
// slider, the filters, and the link between list entries and map markers.
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var C = JSON.parse($('#city-data').textContent);
  var mapEl = $('#city-map');
  var list = $('#city-list');
  var yearInput = $('#city-year'), yearOut = $('#city-year-out');

  var map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.5, maxZoom: C.tiles.street.maxZoom || 18 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(C.tiles.street.url, { maxZoom: C.tiles.street.maxZoom || 18, attribution: C.tiles.street.attribution, className: 'street-tiles' }).addTo(map);

  function symbol(kind, approx, active) {
    return L.divIcon({ className: 'kh-mark' + (active ? ' is-active' : ''), html: KhSymbols.svg(kind, { approx: approx, size: 26 }), iconSize: [26, 26], iconAnchor: [13, 13] });
  }
  function photoIcon(n) {
    return L.divIcon({ className: 'kh-mark kh-photo', html: '<span class="photo-pin" aria-hidden="true"><svg width="22" height="18" viewBox="0 0 22 18"><rect x="1" y="3" width="20" height="14" rx="1.5" class="sym sym-camera"/><circle cx="11" cy="10" r="4" class="sym-lens"/><rect x="7" y="1" width="8" height="3" class="sym sym-camera"/></svg>' + (n > 1 ? '<b>' + n + '</b>' : '') + '</span>', iconSize: [26, 22], iconAnchor: [13, 11] });
  }

  // ── markers for list entries ──
  var markers = {};
  var entries = $$('li.entry', list);
  entries.forEach(function (li) {
    var d = li.dataset;
    var name = $('.entry-name', li).textContent;
    var m = L.marker([+d.lat, +d.lon], { icon: symbol(d.kind, d.precision === 'approximate'), title: name, alt: name, riseOnHover: true })
      .bindTooltip(name, { permanent: true, direction: 'right', offset: [12, 0], className: 'kh-label kh-local' })
      .bindPopup(function () {
        var body = $('.entry-body', li).cloneNode(true);
        return '<h3>' + esc(name) + '</h3>' + body.innerHTML;
      }, { maxWidth: 300, className: 'kh-popup' });
    m.on('click', function () { select(d.id, false); });
    markers[d.id] = m;
  });

  // ── pictures, grouped where several share one geotag ──
  var photoLayer = L.layerGroup();
  var byPoint = {};
  (C.photos || []).forEach(function (p) {
    var k = p.lat.toFixed(4) + ',' + p.lon.toFixed(4);
    (byPoint[k] = byPoint[k] || []).push(p);
  });
  Object.keys(byPoint).forEach(function (k) {
    var ps = byPoint[k];
    var html = '<h3>' + (ps.length === 1 ? esc(ps[0].title) : ps.length + ' pictures here') + '</h3><ul class="pop-thumbs">' +
      ps.slice(0, 12).map(function (p) { return '<li><a href="' + p.href + '" title="' + esc(p.title) + '"><img src="' + esc(p.thumb) + '" alt="' + esc(p.title) + '" width="64" height="64" loading="lazy"></a></li>'; }).join('') + '</ul>' +
      (ps.length > 12 ? '<p class="pop-addr">and ' + (ps.length - 12) + ' more in the gallery below</p>' : '') + '<p class="pop-addr">Placed at the holder’s geotag.</p>';
    L.marker([ps[0].lat, ps[0].lon], { icon: photoIcon(ps.length), title: ps.length + ' picture' + (ps.length === 1 ? '' : 's'), riseOnHover: true, zIndexOffset: -100 })
      .bindPopup(html, { maxWidth: 320, className: 'kh-popup' }).addTo(photoLayer);
  });

  // ── fit to everything ──
  var pts = entries.map(function (li) { return [+li.dataset.lat, +li.dataset.lon]; }).concat((C.photos || []).map(function (p) { return [p.lat, p.lon]; }));
  function fitCity() {
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 16 });
    else map.setView(pts[0] || C.center, 15);
  }
  fitCity();
  $('#city-fit').addEventListener('click', fitCity);
  $('#city-center').addEventListener('click', function () { map.setView(C.center, 14); });
  L.control.scale({ imperial: true, metric: false }).addTo(map);

  // ── selection: list ⇄ map ──
  var selected = null;
  function select(id, fromList) {
    entries.forEach(function (li) {
      var on = li.dataset.id === id;
      li.classList.toggle('is-selected', on);
      $('.entry-head', li).setAttribute('aria-expanded', String(on));
    });
    selected = id;
    var li = $('#e-' + id);
    var m = markers[id];
    if (!li || !m) return;
    if (fromList) {
      map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: reduceMotion ? 0 : 0.6 });
      m.openPopup();
    } else {
      var panel = list.closest('.explorer-panel');
      var top = li.offsetTop - panel.offsetTop - 8;
      panel.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
  }
  list.addEventListener('click', function (e) {
    var head = e.target.closest('.entry-head');
    if (!head) return;
    var id = head.closest('li.entry').dataset.id;
    if (selected === id) { select(null); map.closePopup(); return; }
    select(id, true);
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-goto]');
    if (!a) return;
    e.preventDefault();
    mapEl.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    select(a.dataset.goto, true);
  });

  // ── filters and year ──
  function render() {
    var y = yearInput ? +yearInput.value : Infinity;
    if (yearOut) yearOut.textContent = y;
    var groups = $$('input[name=group]:checked').map(function (i) { return i.value; });
    var shown = 0;
    entries.forEach(function (li) {
      var d = li.dataset;
      var inGroup = groups.indexOf(d.group) > -1;
      var standing = !d.from || +d.from <= y;
      var gone = d.to && +d.to <= y;
      li.hidden = !inGroup;
      li.classList.toggle('not-yet', inGroup && !standing);
      li.classList.toggle('gone', inGroup && standing && !!gone);
      var m = markers[d.id];
      var visible = inGroup && standing;
      if (visible && !map.hasLayer(m)) m.addTo(map);
      if (!visible && map.hasLayer(m)) map.removeLayer(m);
      if (visible) { shown++; m.setOpacity(gone ? 0.45 : 1); }
    });
    var showPics = groups.indexOf('Pictures') > -1;
    if (showPics && !map.hasLayer(photoLayer)) photoLayer.addTo(map);
    if (!showPics && map.hasLayer(photoLayer)) map.removeLayer(photoLayer);
    var total = entries.filter(function (li) { return !li.hidden; }).length;
    $('#city-count').textContent = isFinite(y)
      ? shown + ' of ' + total + ' places standing by ' + y + (shown < total ? '; later ones are greyed in the list.' : '.')
      : shown + ' places.';
  }
  // ── label decluttering: show labels in list order (synagogues first); hide any that would overlap one already shown ──
  function declutter() {
    var placed = [];
    entries.forEach(function (li) {
      var m = markers[li.dataset.id];
      var tip = m && map.hasLayer(m) && m.getTooltip();
      var el = tip && tip.getElement();
      if (!el) return;
      el.style.visibility = 'visible';
      var r = el.getBoundingClientRect();
      var box = { l: r.left - 3, r: r.right + 3, t: r.top - 2, b: r.bottom + 2 };
      var frame = mapEl.getBoundingClientRect();
      var hit = box.r > frame.right || box.l < frame.left || placed.some(function (p) { return !(box.r < p.l || box.l > p.r || box.b < p.t || box.t > p.b); });
      if (hit) el.style.visibility = 'hidden'; else placed.push(box);
    });
  }
  map.on('zoomend moveend', declutter);

  if (yearInput) yearInput.addEventListener('input', function () { render(); declutter(); });
  $$('input[name=group]').forEach(function (i) { i.addEventListener('change', function () { render(); declutter(); }); });
  render();
  setTimeout(declutter, 0);
  if (location.hash && /^#e-/.test(location.hash)) select(location.hash.slice(3), true);
})();
