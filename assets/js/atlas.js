// Kehillot atlas, drawn as a period atlas plate.
// National scale: one symbol per city (congregations by rite, institutions, periodicals, events).
// City scale (zoom ≥ street.minZoom): synagogue buildings, other sites and cemeteries at their own addresses.
(function () {
  'use strict';
  var root = document.body.dataset.root || './';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var mapEl = $('#map');
  var T = JSON.parse(mapEl.dataset.tiles || '{}');
  var STREET_Z = (T.street && T.street.minZoom) || 11;

  var map = L.map(mapEl, { center: [38.5, -92], zoom: 4, minZoom: 3, maxZoom: (T.street && T.street.maxZoom) || 18, zoomSnap: 0.25, scrollWheelZoom: false });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  var relief = L.tileLayer(T.relief.url, { maxZoom: T.relief.maxZoom || 13, maxNativeZoom: T.relief.maxZoom || 13, attribution: T.relief.attribution });
  var street = T.street ? L.tileLayer(T.street.url, { maxZoom: T.street.maxZoom || 18, maxNativeZoom:T.street.maxNativeZoom || T.street.maxZoom || 18, attribution: T.street.attribution, className: 'street-tiles' }) : null;

  KhTerrain(map, T.terrain);
  // Graticule every 5°, as on an engraved plate (national scale only).
  var grat = L.layerGroup();
  for (var lat = 25; lat <= 50; lat += 5) L.polyline([[lat, -130], [lat, -60]], { className: 'graticule', interactive: false }).addTo(grat);
  for (var lon = -125; lon <= -65; lon += 5) L.polyline([[20, lon], [55, lon]], { className: 'graticule', interactive: false }).addTo(grat);

  var layers = { town: L.layerGroup().addTo(map), local: L.layerGroup().addTo(map) };
  var yearInput = $('#year'), yearOut = $('#year-out'), playBtn = $('#play');
  var cityNav;
  var D, placeIndex = {}, markersByPlace = {}, timer = null, orgName = {};

  function isStreet() { return map.getZoom() >= STREET_Z || !!(cityNav && cityNav.selected() && map.getZoom() >= 9); }
  function syncBase() {
    var want = isStreet() && street ? street : relief;
    [relief, street].forEach(function (l) { if (l && l !== want && map.hasLayer(l)) map.removeLayer(l); });
    if (!map.hasLayer(want)) want.addTo(map);
    if (isStreet()) map.removeLayer(grat); else if (!map.hasLayer(grat)) grat.addTo(map);
    mapEl.classList.toggle('z-street', isStreet());
    mapEl.parentElement.classList.toggle('plate-street', isStreet());
    mapEl.classList.toggle('z-low', map.getZoom() < 5.5);
    mapEl.classList.toggle('z-min', map.getZoom() < 4.5);
  }

  function state() {
    return {
      year: Number(yearInput.value),
      layers: Array.from(document.querySelectorAll('input[name=layer]:checked')).map(function (i) { return i.value; }),
      rites: Array.from(document.querySelectorAll('input[name=rite]:checked')).map(function (i) { return i.value; })
    };
  }
  var active = function (c, y) { return c.founded <= y && !(c.dissolved && c.dissolved <= y); };
  var dormant = function (c, y) { return c.dormant && y >= c.dormant[0] && y < c.dormant[1]; };
  var runs = function (o, y) { return o.founded <= y && !((o.dissolved || o.ceased) && (o.dissolved || o.ceased) <= y); };
  var href = function (type, id) { return root + type + '/' + id + '/'; };
  var plural = function (n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); };
  var WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
  var word = function (n) { return WORDS[n] || String(n); };
  var orgType = function (id) { return orgName[id] ? orgName[id].type : 'institution'; };

  // ── national-scale town symbol: one tinted circle per congregation in a ring ──
  function townSymbol(cs, nDormant, nInst, nPer, nEvent) {
    var n = cs.length, dots = [], ring = n <= 1 ? 0 : 4 + n * 0.9, R = 3.6;
    var size = Math.ceil((ring + R + 2) * 2) + 26, c = size / 2;
    cs.forEach(function (cong, i) {
      var a = -Math.PI / 2 + (i / Math.max(n, 1)) * Math.PI * 2;
      dots.push('<circle cx="' + (c + Math.cos(a) * ring).toFixed(1) + '" cy="' + (c + Math.sin(a) * ring).toFixed(1) + '" r="' + (n === 1 ? 4.5 : R) + '" class="sym sym-' + cong.rite + '"/>');
    });
    if (!n && nDormant) dots.push('<circle cx="' + c + '" cy="' + c + '" r="5" class="sym sym-dormant"/>');
    if (!n && !nDormant) dots.push('<circle cx="' + c + '" cy="' + c + '" r="2" class="sym sym-ink"/>');
    var off = ring + R + 4;
    if (nInst) dots.push('<rect x="' + (c - off - 5).toFixed(1) + '" y="' + (c - 9).toFixed(1) + '" width="7" height="7" class="sym sym-inst"/>');
    if (nPer) dots.push('<path d="M' + (c - 3).toFixed(1) + ' ' + (c - off - 8).toFixed(1) + 'h6v7.5h-6z" class="sym sym-press"/>');
    if (nEvent) dots.push('<path d="M' + (c - off - 3).toFixed(1) + ' ' + (c + 2).toFixed(1) + ' l4 7 h-8z" class="sym sym-event"/>');
    return { icon: L.divIcon({ className: 'kh-mark', html: '<svg width="' + size + '" height="' + size + '">' + dots.join('') + '</svg>', iconSize: [size, size], iconAnchor: [c, c] }), radius: off };
  }

  // ── city-scale symbols ──
  function localSymbol(kind, precision, faded) {
    return L.divIcon({ className: 'kh-mark', html: KhSymbols.svg(kind, { approx: precision === 'approximate', faded: faded, size: 22 }), iconSize: [22, 22], iconAnchor: [11, 11] });
  }

  function popupHtml(p, y, cs, ds, is, ps, es, nLocal) {
    var h = '<h3><a href="' + href('place', p.id) + '">' + esc(p.name) + '</a> <span class="pop-state">' + esc(p.state) + '</span></h3>';
    if (cs.length || ds.length) {
      h += '<p class="pop-sub">Congregations, ' + y + '</p><ul>';
      cs.forEach(function (c) { h += '<li><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" class="sym sym-' + c.rite + '"/></svg> <a href="' + href('congregation', c.id) + '">' + esc(c.name) + '</a>, est. ' + c.founded + '</li>'; });
      ds.forEach(function (c) { h += '<li class="dormant"><a href="' + href('congregation', c.id) + '">' + esc(c.name) + '</a>, without a resident congregation</li>'; });
      h += '</ul>';
    }
    if (is.length) { h += '<p class="pop-sub">Societies &amp; schools</p><ul>'; is.forEach(function (o) { h += '<li><a href="' + href('institution', o.id) + '">' + esc(o.name) + '</a>, ' + o.founded + '</li>'; }); h += '</ul>'; }
    if (ps.length) { h += '<p class="pop-sub">Periodicals</p><ul>'; ps.forEach(function (o) { h += '<li><a href="' + href('periodical', o.id) + '"><i>' + esc(o.name) + '</i></a>, ' + o.founded + '</li>'; }); h += '</ul>'; }
    if (es.length) { h += '<p class="pop-sub">Events</p><ul>'; es.forEach(function (e) { h += '<li><a href="' + href('event', e.id) + '">' + esc(e.name) + '</a>, ' + String(e.date).slice(0, 4) + '</li>'; }); h += '</ul>'; }
    if (nLocal || (D.cityGuides || []).indexOf(p.id) > -1) {
      h += '<p class="pop-more">';
      if (nLocal) h += '<button type="button" class="linkish" data-inside="' + p.id + '">Show ' + plural(nLocal, 'site') + ' on this map</button>';
      if ((D.cityGuides || []).indexOf(p.id) > -1) h += (nLocal ? ' · ' : '') + '<a href="' + root + 'city/' + p.id + '/">City guide →</a>';
      h += '</p>';
    }
    return h;
  }
  function sitePopup(s, y) {
    var h = '<h3><a href="' + href('site', s.id) + '">' + esc(s.name) + '</a></h3><p class="pop-addr">' + esc(s.address) + (s.precision === 'approximate' ? ' <span class="muted">(approximate)</span>' : '') + '</p>';
    if (s.built) h += '<p class="pop-addr">Built or acquired ' + s.built + '</p>';
    if ((s.occupants || []).length) {
      h += '<p class="pop-sub">Used by</p><ul>';
      s.occupants.forEach(function (o) {
        var now = (!o.from || o.from <= y) && (!o.to || o.to > y);
        var n = orgName[o.org] || { name: o.org };
        h += '<li' + (now ? ' class="now"' : '') + '><a href="' + href(n.type, o.org) + '">' + esc(n.name) + '</a>' + (o.from ? ', ' + o.from + '–' + (o.to || '') : '') + (now ? ' <span class="muted">(in ' + y + ')</span>' : '') + '</li>';
      });
      h += '</ul>';
    }
    return h;
  }
  function cemPopup(c, y) {
    var h = '<h3><a href="' + href('cemetery', c.id) + '">' + esc(c.name) + '</a></h3><p class="pop-addr">' + esc(c.address) + (c.precision === 'approximate' ? ' <span class="muted">(approximate)</span>' : '') + '</p>';
    h += '<p class="pop-addr">Established ' + c.established + (c.closed ? (c.closed <= y ? '; closed to burials ' + c.closed : '; in use until ' + c.closed) : '') + '</p>';
    if ((c.owners || []).length) h += '<p class="pop-sub">Maintained by</p><ul>' + c.owners.map(function (o) { return '<li><a href="' + href('congregation', o) + '">' + esc((orgName[o] || {}).name || o) + '</a></li>'; }).join('') + '</ul>';
    return h;
  }

  function localFor(placeId, y, s) {
    var out = [];
    if (s.layers.indexOf('site') > -1) D.sites.forEach(function (x) { if (x.place === placeId && (!x.built || x.built <= y)) out.push({ type: 'site', r: x }); });
    if (s.layers.indexOf('cemetery') > -1) D.cemeteries.forEach(function (x) { if (x.place === placeId && x.established <= y) out.push({ type: 'cemetery', r: x }); });
    return out;
  }

  function render() {
    var s = state(), y = s.year;
    yearOut.textContent = y;
    layers.town.clearLayers(); layers.local.clearLayers();
    markersByPlace = {};
    var rows = [], totalC = 0, places = 0, totalLocal = 0;
    var showI = s.layers.indexOf('institution') > -1, showP = s.layers.indexOf('periodical') > -1, showE = s.layers.indexOf('event') > -1;

    D.places.forEach(function (p) {
      var all = D.congregations.filter(function (c) { return c.place === p.id && s.rites.indexOf(c.rite) > -1 && active(c, y); });
      var cs = all.filter(function (c) { return !dormant(c, y); }).sort(function (a, b) { return a.founded - b.founded; });
      var ds = all.filter(function (c) { return dormant(c, y); });
      var is = showI ? D.institutions.filter(function (o) { return o.place === p.id && runs(o, y); }) : [];
      var ps = showP ? D.periodicals.filter(function (o) { return o.place === p.id && runs(o, y); }) : [];
      var es = showE ? D.events.filter(function (e) { return (e.place === p.id || (e.alsoAt || []).indexOf(p.id) > -1) && Number(String(e.date).slice(0, 4)) <= y; }) : [];
      var local = localFor(p.id, y, s);

      if (isStreet()) local.forEach(function (it) {
        var x = it.r, faded = it.type === 'site' && (x.occupants || []).length && !x.occupants.some(function (o) { return (!o.from || o.from <= y) && (!o.to || o.to > y); });
        L.marker([x.lat, x.lon], { icon: localSymbol(it.type === 'cemetery' ? 'cemetery' : x.kind, x.precision, faded), title: x.name, alt: x.name, riseOnHover: true })
          .bindPopup(it.type === 'cemetery' ? cemPopup(x, y) : sitePopup(x, y), { maxWidth: 300, className: 'kh-popup' })
          .bindTooltip(x.name, { permanent: true, direction: 'right', offset: [10, 0], className: 'kh-label kh-local' })
          .addTo(layers.local);
      });
      totalLocal += local.length;

      if (!cs.length && !ds.length && !is.length && !ps.length && !es.length) return;
      var sym = townSymbol(cs, ds.length, is.length, ps.length, es.length);
      var label = cs.length ? plural(cs.length, 'congregation') : ds.length ? 'synagogue, no resident congregation' : '';
      var m = L.marker([p.lat, p.lon], { icon: sym.icon, title: p.name + (label ? ': ' + label : ''), alt: p.name, riseOnHover: true })
        .bindPopup(popupHtml(p, y, cs, ds, is, ps, es, local.length), { maxWidth: 320, className: 'kh-popup' })
        .bindTooltip(p.name, { permanent: true, direction: 'right', offset: [sym.radius - 2, 0], className: 'kh-label kh-town' + (cs.length >= 2 ? '' : ' minor') + (cs.length >= 4 ? ' major' : '') })
        .addTo(layers.town);
      markersByPlace[p.id] = m;
      totalC += cs.length;
      if (cs.length) places++;
      rows.push({ p: p, c: cs.length, d: ds.length, local: local.length });
    });

    rows.sort(function (a, b) { return a.p.name.localeCompare(b.p.name); });
    $('#place-list').innerHTML = rows.map(function (r) {
      return '<li><button type="button" data-place="' + r.p.id + '"><span class="gaz-name">' + esc(r.p.name) + '<span class="gaz-state">, ' + esc(r.p.state) + '</span></span><span class="gaz-lead" aria-hidden="true"></span><span class="gaz-n">' + (r.c || (r.d ? '○' : '–')) + '</span></button>' +
        (r.local ? '<button type="button" class="gaz-inside" data-inside="' + r.p.id + '">Zoom to city streets · ' + plural(r.local, 'site') + '</button>' : '') + '</li>';
    }).join('');
    var sum = word(totalC).replace(/^./, function (ch) { return ch.toUpperCase(); }) + ' congregation' + (totalC === 1 ? '' : 's') + ' in ' + word(places) + ' town' + (places === 1 ? '' : 's') + (places === 1 ? '' : ' and cities') + '.';
    if (isStreet()) sum += ' Synagogues and cemeteries are shown at their addresses.';
    $('#atlas-summary').textContent = sum;
    try { var params = new URLSearchParams(location.hash.slice(1)); params.set('year', y); history.replaceState(null, '', '#' + params.toString()); } catch (e) { /* ignore */ }
  }

  function goInside(placeId) {
    if (cityNav && cityNav.goTo(placeId)) {
      document.querySelector('.city-navigator').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    }
  }

  map.on('zoomend', function () { syncBase(); render(); });

  function stop() { clearInterval(timer); timer = null; playBtn.textContent = 'Play'; playBtn.setAttribute('aria-pressed', 'false'); }
  playBtn.addEventListener('click', function () {
    if (timer) return stop();
    if (Number(yearInput.value) >= Number(yearInput.max)) yearInput.value = yearInput.min;
    playBtn.textContent = 'Pause'; playBtn.setAttribute('aria-pressed', 'true');
    timer = setInterval(function () {
      var v = Number(yearInput.value) + 1;
      if (v > Number(yearInput.max)) return stop();
      yearInput.value = v; render();
    }, reduceMotion ? 1200 : 550);
  });
  yearInput.addEventListener('input', function () { stop(); render(); });
  document.querySelectorAll('input[name=layer], input[name=rite]').forEach(function (i) { i.addEventListener('change', render); });
  document.addEventListener('click', function (e) {
    var inside = e.target.closest('[data-inside]');
    if (inside) { goInside(inside.dataset.inside); return; }
    var b = e.target.closest('#place-list button[data-place]'); if (!b) return;
    goInside(b.dataset.place);
  });

  fetch(root + 'data/site.json').then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    D.places.forEach(function (p) { placeIndex[p.id] = p; });
    D.congregations.forEach(function (c) { orgName[c.id] = { name: c.name, type: 'congregation' }; });
    D.institutions.forEach(function (c) { orgName[c.id] = { name: c.name, type: 'institution' }; });
    D.periodicals.forEach(function (c) { orgName[c.id] = { name: c.name, type: 'periodical' }; });
    var m = /year=(\d{4})/.exec(location.hash);
    if (m) yearInput.value = Math.min(Math.max(Number(m[1]), Number(yearInput.min)), Number(yearInput.max));
    map.fitBounds(L.latLngBounds(D.places.map(function (p) { return [p.lat, p.lon]; })), { animate: false, paddingTopLeft: [30, 30], paddingBottomRight: [110, 30] });
    syncBase();
    render();
    cityNav = KhCityNavigation(map, {
      onChange: function () { syncBase(); render(); },
      national: function () { map.fitBounds(L.latLngBounds(D.places.map(function (p) { return [p.lat, p.lon]; })), { padding: [30, 30], animate: false }); }
    });
    cityNav.restore();
  }).catch(function () {
    $('#atlas-summary').textContent = 'The data could not be loaded. Serve the site over HTTP (see README).';
  });
})();
