// Feature maps: one script for every per-feature map and the comprehensive map.
// Reads data/features.json; the page's #fm-config says which features to show.
(function () {
  'use strict';
  var root = document.body.dataset.root || './';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };
  var CFG = JSON.parse($('#fm-config').textContent);
  var mapEl = $('#fmap'), fromIn = $('#fm-from'), toIn = $('#fm-to'), qIn = $('#fm-q');
  var STREET_Z = (CFG.tiles.street && CFG.tiles.street.minZoom) || 11;
  var cityNav;
  var D, FEAT = {}, markers = {};

  var map = L.map(mapEl, { center: [38.5, -92], zoom: 4, minZoom: 3, maxZoom: CFG.tiles.street.maxZoom || 18, zoomSnap: 0.25, scrollWheelZoom: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  var relief = L.tileLayer(CFG.tiles.relief.url, { maxZoom: 18, maxNativeZoom: CFG.tiles.relief.maxZoom || 13, attribution: CFG.tiles.relief.attribution });
  var street = L.tileLayer(CFG.tiles.street.url, { maxZoom: CFG.tiles.street.maxZoom || 18, maxNativeZoom:CFG.tiles.street.maxNativeZoom || CFG.tiles.street.maxZoom || 18, attribution: CFG.tiles.street.attribution, className: 'street-tiles' });
  var grat = L.layerGroup();
  for (var lat = 25; lat <= 50; lat += 5) L.polyline([[lat, -130], [lat, -60]], { className: 'graticule', interactive: false }).addTo(grat);
  for (var lon = -125; lon <= -65; lon += 5) L.polyline([[20, lon], [55, lon]], { className: 'graticule', interactive: false }).addTo(grat);
  function syncBase() {
    var st = map.getZoom() >= STREET_Z || !!(cityNav && cityNav.selected() && map.getZoom() >= 9);
    mapEl.parentElement.classList.toggle('plate-street', st);
    mapEl.classList.toggle('z-street', st);
    var want = st ? street : relief, other = st ? relief : street;
    if (map.hasLayer(other)) map.removeLayer(other);
    if (!map.hasLayer(want)) want.addTo(map);
    if (st) map.removeLayer(grat); else if (!map.hasLayer(grat)) grat.addTo(map);
  }
  map.on('zoomend', syncBase);

  // Clusters drawn as small engraved roundels with a count.
  var cluster = L.markerClusterGroup({
    showCoverageOnHover: false, maxClusterRadius: 38, spiderfyOnMaxZoom: true, spiderLegPolylineOptions: { weight: 0.8, color: css('--plate-ink') || '#2a2118', opacity: 0.6 },
    iconCreateFunction: function (c) {
      var n = c.getChildCount(), s = n < 10 ? 26 : n < 50 ? 32 : n < 200 ? 38 : 44;
      return L.divIcon({ className: 'fm-cluster', html: '<span style="width:' + s + 'px;height:' + s + 'px">' + n + '</span>', iconSize: [s, s] });
    }
  }).addTo(map);

  function state() {
    var a = +fromIn.value, b = +toIn.value;
    var feats = CFG.features.length > 1 ? $$('input[name=feature]:checked').map(function (i) { return i.value; }) : CFG.features;
    return { feats: feats, from: Math.min(a, b), to: Math.max(a, b), q: (qIn.value || '').toLowerCase().trim() };
  }
  function visible(it, s) {
    if (s.feats.indexOf(it.f) < 0) return false;
    if (it.from && it.from > s.to) return false;
    if (it.to && it.to < s.from) return false;
    if (s.q && (it.name + ' ' + (it.sub || '') + ' ' + (it.placeName || '')).toLowerCase().indexOf(s.q) < 0) return false;
    return true;
  }
  var years = function (it) { return it.from ? (it.from === it.to ? it.from : it.from + '–' + (it.to || '')) : ''; };
  function popup(it) {
    var F = FEAT[it.f];
    return '<h3><a href="' + root + it.href + '">' + esc(it.name) + '</a></h3>' +
      '<p class="pop-addr">' + esc(F.label) + (years(it) ? ' · ' + years(it) : '') + '</p>' +
      (it.sub ? '<p class="pop-addr">' + esc(it.sub) + '</p>' : '') +
      (it.thumb ? '<p><a href="' + root + it.href + '"><img src="' + esc(it.thumb) + '" alt="" width="96" height="96" style="object-fit:cover;border:1px solid var(--plate-ink)"></a></p>' : '') +
      '<p class="pop-addr">' + esc(it.address || it.placeName || '') + (it.precision === 'city' ? ' <span class="muted">(placed at the city)</span>' : it.precision === 'approximate' ? ' <span class="muted">(approximate)</span>' : it.precision === 'geotag' ? ' <span class="muted">(holder’s geotag)</span>' : '') + '</p>' + (it.place && (D.cityGuides||[]).indexOf(it.place)>-1 ? '<p><a href="' + root + 'city/' + it.place + '/">Open city guide →</a></p>' : '');
  }

  function render() {
    var s = state();
    $('#fm-from-out').textContent = s.from; $('#fm-to-out').textContent = s.to;
    cluster.clearLayers();
    var shown = D.items.filter(function (it) { return visible(it, s); });
    cluster.addLayers(shown.map(function (it) { return markers[it.f + '/' + it.id]; }));
    var perF = {};
    shown.forEach(function (it) { perF[it.f] = (perF[it.f] || 0) + 1; });
    $('#fm-summary').textContent = shown.length ? shown.length.toLocaleString('en-US') + ' matching record' + (shown.length===1?'':'s') + ' · ' + s.from + '–' + s.to : 'No records match these filters. Open the filters to widen the dates or clear the search.';
    document.querySelector('.fmap .map-filter-panel>summary').textContent='Layers & filters · '+s.from+'–'+s.to;
    // list, grouped by place
    var byPlace = {};
    shown.forEach(function (it) { var k = it.placeName || 'Elsewhere'; (byPlace[k] = byPlace[k] || []).push(it); });
    var places = Object.keys(byPlace).sort();
    var list = $('#fm-list');
    list.innerHTML = places.length ? places.map(function (p) {
      return '<li><h3 class="fm-place">' + esc(p) + ' <span class="muted">' + byPlace[p].length + '</span></h3><ul>' + byPlace[p].sort(function (a, b) { return (a.from || 9999) - (b.from || 9999); }).map(function (it) {
        return '<li><button type="button" class="fm-item" data-k="' + esc(it.f + '/' + it.id) + '"><span class="f-sym">' + KhSymbols.svg(FEAT[it.f].symbol, { size: 14 }) + '</span>' + esc(it.name) + ' <span class="muted">' + esc(years(it)) + (it.sub && CFG.features.length === 1 && it.f === 'clergy' ? ' · ' + esc(it.sub) : '') + '</span></button></li>';
      }).join('') + '</ul></li>';
    }).join('') : '<li class="muted">Nothing to show for these choices.</li>';
    try {
      var params = new URLSearchParams(location.hash.slice(1));
      params.set('from', s.from); params.set('to', s.to);
      if(qIn.value.trim())params.set('q',qIn.value.trim());else params.delete('q');
      if (CFG.features.length > 1) params.set('f', s.feats.join(',')); else params.delete('f');
      history.replaceState(null, '', '#' + params.toString());
    } catch (e) { /* file preview */ }
  }

  // ── clergy journeys: curved arrows from pulpit to pulpit, in date order ──
  var jrLayer = L.layerGroup().addTo(map);
  function arcPoints(a, b) {
    var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1];
    var cx = mx - dy * 0.22, cy = my + dx * 0.22, pts = [];
    for (var i = 0; i <= 24; i++) { var t = i / 24, u = 1 - t; pts.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]); }
    return pts;
  }
  function arrowAt(pts, color) {
    var i = 14, p1 = map.latLngToLayerPoint(pts[i - 1]), p2 = map.latLngToLayerPoint(pts[i + 1]);
    var ang = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI;
    return L.marker(pts[i], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'jr-arrow', html: '<svg width="12" height="12" viewBox="0 0 12 12" style="transform:rotate(' + ang + 'deg)"><path d="M1 1 L11 6 L1 11 Z" fill="' + color + '"/></svg>', iconSize: [12, 12], iconAnchor: [6, 6] }) });
  }
  var yrs = function (s) { return s.start ? s.start + '–' + (s.end || '') : 'dates not recorded'; };
  function drawJourneys(fit) {
    var box = $('#fm-jr'); if (!box) return;
    jrLayer.clearLayers();
    var it = $('#fm-itinerary');
    if (!box.checked) { it.innerHTML = ''; return; }
    var who = $('#fm-jr-who').value, color = css('--accent') || '#8a2d1c';
    var list = D.journeys.filter(function (j) { return !who || j.id === who; });
    var bounds = [];
    list.forEach(function (j) {
      var sel = !!who;
      for (var i = 1; i < j.stops.length; i++) {
        var a = [j.stops[i - 1].lat, j.stops[i - 1].lon], b = [j.stops[i].lat, j.stops[i].lon];
        if (a[0] === b[0] && a[1] === b[1]) continue; // a move within one city
        var pts = arcPoints(a, b);
        L.polyline(pts, { color: color, weight: sel ? 3 : 1.6, opacity: sel ? 0.95 : 0.55, interactive: true })
          .bindTooltip(j.name + ': ' + j.stops[i - 1].place + ' → ' + j.stops[i].place + (j.stops[i].start ? ' (' + j.stops[i].start + ')' : ''), { sticky: true })
          .on('click', (function (id) { return function () { $('#fm-jr-who').value = id; drawJourneys(true); }; })(j.id))
          .addTo(jrLayer);
        arrowAt(pts, color).addTo(jrLayer);
      }
      if (sel) {
        var seen = {};
        j.stops.forEach(function (s, n) {
          var k = s.lat + ',' + s.lon;
          seen[k] = (seen[k] ? seen[k] + ', ' : '') + (n + 1);
          bounds.push([s.lat, s.lon]);
        });
        Object.keys(seen).forEach(function (k) {
          var ll = k.split(',').map(Number);
          L.marker(ll, { interactive: false, keyboard: false, zIndexOffset: 1000, icon: L.divIcon({ className: 'jr-stop', html: '<span>' + seen[k] + '</span>', iconSize: [18, 18], iconAnchor: [9, 26] }) }).addTo(jrLayer);
        });
      }
    });
    if (who) {
      var j = list[0];
      it.innerHTML = '<h3 class="fm-place"><a href="' + root + j.href + '">' + esc(j.name) + '</a> <span class="muted">' + esc(j.titles.join(', ')) + '</span></h3><ol>' +
        j.stops.map(function (s) { return '<li>' + esc(s.role) + ', <a href="' + root + s.congHref + '">' + esc(s.cong) + '</a>, ' + esc(s.place) + ' <span class="muted">' + yrs(s) + '</span></li>'; }).join('') + '</ol>';
      if (fit && bounds.length) { if (bounds.length > 1 && !bounds.every(function (b) { return b[0] === bounds[0][0] && b[1] === bounds[0][1]; })) map.fitBounds(L.latLngBounds(bounds).pad(0.3), { maxZoom: 8 }); else map.setView(bounds[0], 9); }
    } else {
      it.innerHTML = '<p class="gaz-note">' + list.length + ' clergy served more than one pulpit. Choose a name, or click a line, to follow one journey.</p>';
    }
  }
  map.on('zoomend', function () { drawJourneys(false); });
  if ($('#fm-jr')) {
    $('#fm-jr').addEventListener('change', function () { drawJourneys(true); });
    $('#fm-jr-who').addEventListener('change', function () { if (!$('#fm-jr').checked) $('#fm-jr').checked = true; drawJourneys(true); });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.fm-item');
    if (!b) return;
    var m = markers[b.dataset.k];
    mapEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    cluster.zoomToShowLayer(m, function () { m.openPopup(); });
  });
  [fromIn, toIn].forEach(function (i) { i.addEventListener('input',function(){if(+fromIn.value>+toIn.value){if(i===fromIn)toIn.value=fromIn.value;else fromIn.value=toIn.value;}render();}); });
  $('#fm-reset').addEventListener('click',function(){fromIn.value=fromIn.defaultValue;toIn.value=toIn.defaultValue;qIn.value='';$$('input[name=feature]').forEach(function(i){i.checked=i.defaultChecked;});render();});
  var t; qIn.addEventListener('input', function () { clearTimeout(t); t = setTimeout(render, 150); });
  $$('input[name=feature]').forEach(function (i) { i.addEventListener('change', render); });

  fetch(root + 'data/features.json').then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    d.features.forEach(function (f) { FEAT[f.id] = f; });
    d.items = d.items.filter(function (it) { return CFG.features.indexOf(it.f) > -1; });
    d.items.forEach(function (it) {
      var F = FEAT[it.f];
      markers[it.f + '/' + it.id] = L.marker([it.lat, it.lon], {
        icon: L.divIcon({ className: 'kh-mark', html: KhSymbols.svg(F.symbol, { size: 22, approx: it.precision === 'approximate' }), iconSize: [22, 22], iconAnchor: [11, 11] }),
        title: it.name, alt: it.name, riseOnHover: true
      }).bindPopup(function () { return popup(it); }, { maxWidth: 300, className: 'kh-popup' });
    });
    var h = new URLSearchParams(location.hash.slice(1));
    if(h.get('q'))qIn.value=h.get('q');
    if (h.get('from')) fromIn.value = h.get('from');
    if (h.get('to')) toIn.value = h.get('to');
    if (h.get('f')) { var want = h.get('f').split(','); $$('input[name=feature]').forEach(function (i) { i.checked = want.indexOf(i.value) > -1; }); }
    var pts = d.items.filter(function (it) { return it.lon > -130 && it.lon < -60; }).map(function (it) { return [it.lat, it.lon]; });
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { animate: false, paddingTopLeft: [30, 30], paddingBottomRight: [CFG.features.length > 1 ? 230 : 30, 30], maxZoom: 13 });
    else if (pts.length === 1) map.setView(pts[0], 13);
    else map.setView([38.5, -92], 4);
    syncBase();
    render();
    cityNav = KhCityNavigation(map, {
      onChange: function () { syncBase(); render(); },
      national: function () {
        if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 8, animate: false });
        else map.setView([38.5, -92], 4, { animate: false });
      }
    });
    cityNav.restore();
  }).catch(function () { $('#fm-summary').textContent = 'The data could not be loaded. Serve the site over HTTP (see README).'; });
})();
