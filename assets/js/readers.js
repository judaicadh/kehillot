// Readers of the Jewish press: subscriptions by place, filterable by paper and years.
// Places come from data/readership-places.json; names load per paper on demand.
(function () {
  'use strict';
  var root = document.body.dataset.root || './';
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };
  var TINT = { occident: '--paper-occident', israelite: '--paper-israelite', 'jewish-messenger': '--paper-messenger', 'weekly-gleaner': '--paper-gleaner' };
  var TYPE = { I: '', B: 'business', S: 'synagogue', O: 'organization' };
  var mapEl = $('#readers-map');
  var fromIn = $('#r-from'), toIn = $('#r-to');
  var D, names = {}, layer, selectedKey = null;

  var map = L.map(mapEl, { preferCanvas: true, center: [38.5, -92], zoom: 4, minZoom: 2, maxZoom: 12, zoomSnap: 0.25, scrollWheelZoom: false, worldCopyJump: true });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', { maxZoom: 13, attribution: 'Relief &copy; Esri' }).addTo(map);
  // Graticule: styled inline, because this map draws to canvas (CSS classes don't apply there).
  var gratStyle = { color: css('--plate-ink') || '#2a2118', weight: 0.6, opacity: 0.28, dashArray: '1 3', interactive: false };
  for (var lat = 25; lat <= 50; lat += 5) L.polyline([[lat, -130], [lat, -60]], gratStyle).addTo(map);
  for (var lon = -125; lon <= -65; lon += 5) L.polyline([[20, lon], [55, lon]], gratStyle).addTo(map);
  layer = L.layerGroup().addTo(map);

  function state() {
    var a = +fromIn.value, b = +toIn.value;
    return { papers: $$('input[name=paper]:checked').map(function (i) { return i.value; }), from: Math.min(a, b), to: Math.max(a, b) };
  }
  // count for one place & paper within the year range (undated subscriptions, key 0, count only when the full range is chosen)
  function count(pl, paper, s) {
    var y = pl.y[paper]; if (!y) return 0;
    var n = 0, full = s.from === D.range[0] && s.to === D.range[1];
    for (var k in y) { var yr = +k; if ((yr >= s.from && yr <= s.to) || (yr === 0 && full)) n += y[k]; }
    return n;
  }
  function paperName(id) { for (var i = 0; i < D.papers.length; i++) if (D.papers[i].id === id) return D.papers[i].name; return id; }
  function placeLabel(pl) { return pl.name + (pl.state ? ', ' + pl.state : pl.country && !/United States/.test(pl.country) ? ', ' + pl.country : ''); }

  function popupHtml(pl, s) {
    var rows = s.papers.map(function (p) { var n = count(pl, p, s); return n ? '<li><span class="paper-swatch" style="background:' + css(TINT[p]) + '"></span><i>' + esc(paperName(p)) + '</i>: ' + n + '</li>' : ''; }).join('');
    return '<h3>' + (pl.own ? '<a href="' + root + 'place/' + pl.own + '/">' + esc(pl.name) + '</a>' : esc(pl.name)) + ' <span class="pop-state">' + esc(pl.state || pl.country || '') + '</span></h3>' +
      '<p class="pop-sub">Subscriptions, ' + s.from + '–' + s.to + '</p><ul>' + rows + '</ul>' +
      '<p class="pop-more"><button type="button" class="linkish" data-subs="' + esc(pl.k) + '">List the subscribers</button>' + (pl.own ? ' · <a href="' + root + 'place/' + pl.own + '/">Kehillot record</a>' : '') + '</p>';
  }

  function render() {
    var s = state();
    $('#r-from-out').textContent = s.from; $('#r-to-out').textContent = s.to;
    $('#r-range').textContent = s.from === s.to ? s.from : s.from + '–' + s.to;
    layer.clearLayers();
    var marks = [], totals = {}, placesN = 0, abroad = 0;
    D.places.forEach(function (pl) {
      var any = false;
      s.papers.forEach(function (p) {
        var n = count(pl, p, s);
        if (!n) return;
        any = true;
        totals[p] = (totals[p] || 0) + n;
        marks.push({ pl: pl, p: p, n: n });
      });
      if (any) { placesN++; if (pl.country && !/United States/.test(pl.country)) abroad++; }
    });
    marks.sort(function (a, b) { return b.n - a.n; });
    // Area-true circles, scaled so the largest single value is about 30px in radius.
    var maxN = marks.length ? marks[0].n : 1;
    marks.forEach(function (m) {
      L.circleMarker([m.pl.lat, m.pl.lon], { radius: 2 + 28 * Math.sqrt(m.n / maxN), color: css('--plate-ink'), weight: 0.6, opacity: 0.8, fillColor: css(TINT[m.p]), fillOpacity: 0.55 })
        .bindPopup(function () { return popupHtml(m.pl, state()); }, { maxWidth: 300, className: 'kh-popup' })
        .on('click', function () { selectedKey = m.pl.k; })
        .addTo(layer);
    });
    $$('.key-n').forEach(function (el) { var n = totals[el.dataset.n] || 0; el.textContent = n ? n.toLocaleString('en-US') : ''; });
    var total = Object.keys(totals).reduce(function (a, k) { return a + totals[k]; }, 0);
    $('#r-summary').textContent = total.toLocaleString('en-US') + ' subscriptions in ' + placesN.toLocaleString('en-US') + ' places' + (abroad ? ', ' + abroad + ' of them outside the United States' : '') + '.';

    // ranked list
    var ranked = D.places.map(function (pl) {
      var n = 0; s.papers.forEach(function (p) { n += count(pl, p, s); }); return { pl: pl, n: n };
    }).filter(function (r) { return r.n; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 40);
    $('#r-top').innerHTML = ranked.map(function (r) {
      return '<li><button type="button" data-k="' + esc(r.pl.k) + '"><span class="gaz-name">' + esc(r.pl.name) + '<span class="gaz-state">, ' + esc(r.pl.state || r.pl.country || '') + '</span></span><span class="gaz-lead" aria-hidden="true"></span><span class="gaz-n">' + r.n.toLocaleString('en-US') + '</span></button></li>';
    }).join('');
    try { history.replaceState(null, '', '#papers=' + s.papers.join(',') + '&from=' + s.from + '&to=' + s.to); } catch (e) { /* ignore */ }
    if (selectedKey) showSubscribers(selectedKey, true);
  }

  function byKey(k) { for (var i = 0; i < D.places.length; i++) if (D.places[i].k === k || D.places[i].qid === k) return D.places[i]; return null; }
  function loadNames(paper) {
    if (names[paper]) return Promise.resolve(names[paper]);
    return fetch(root + 'data/readership/' + paper + '.json').then(function (r) { return r.json(); }).then(function (j) { names[paper] = j; return j; });
  }
  function showSubscribers(k, quiet) {
    var pl = byKey(k); if (!pl) return;
    selectedKey = pl.k;
    var s = state();
    var box = $('#r-detail');
    if (!quiet) box.innerHTML = '<p class="gaz-note">Loading…</p>';
    Promise.all(s.papers.filter(function (p) { return pl.keys[p]; }).map(function (p) {
      return loadNames(p).then(function (j) {
        var full = s.from === D.range[0] && s.to === D.range[1];
        var rows = j.subs.filter(function (x) { return x[1] === pl.keys[p] && ((x[2] && x[2] >= s.from && x[2] <= s.to) || (!x[2] && full)); })
          .sort(function (a, b) { return (a[2] || 0) - (b[2] || 0) || String(a[0]).localeCompare(String(b[0])); });
        return { p: p, rows: rows };
      });
    })).then(function (groups) {
      groups = groups.filter(function (g) { return g.rows.length; });
      box.innerHTML = '<h3 class="r-place">' + (pl.own ? '<a href="' + root + 'place/' + pl.own + '/">' + esc(placeLabel(pl)) + '</a>' : esc(placeLabel(pl))) + '</h3>' +
        (pl.qid ? '<p class="gaz-note"><a href="https://www.wikidata.org/wiki/' + esc(pl.qid) + '">Wikidata ' + esc(pl.qid) + '</a>' + (pl.own ? ' · <a href="' + root + 'city/' + pl.own + '/">City guide</a>' : '') + '</p>' : '') +
        (groups.length ? groups.map(function (g) {
          return '<h4><span class="paper-swatch" style="background:' + css(TINT[g.p]) + '"></span><i>' + esc(paperName(g.p)) + '</i> <span class="muted">' + g.rows.length + '</span></h4><ol class="subs-list">' +
            g.rows.map(function (x) { return '<li>' + esc(x[0] || 'Unnamed') + ' <span class="muted">' + (x[2] || 'undated') + (TYPE[x[3]] ? ' · ' + TYPE[x[3]] : '') + '</span></li>'; }).join('') + '</ol>';
        }).join('') : '<p class="gaz-note">No subscriptions for the papers and years chosen.</p>');
    });
  }

  fromIn.addEventListener('input', render);
  toIn.addEventListener('input', render);
  $$('input[name=paper]').forEach(function (i) { i.addEventListener('change', render); });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-subs]');
    if (b) { showSubscribers(b.dataset.subs); $('#r-detail-h').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    var li = e.target.closest('#r-top button[data-k]');
    if (li) {
      var pl = byKey(li.dataset.k);
      map.setView([pl.lat, pl.lon], Math.max(map.getZoom(), 6));
      L.popup({ maxWidth: 300, className: 'kh-popup' }).setLatLng([pl.lat, pl.lon]).setContent(popupHtml(pl, state())).openOn(map);
      showSubscribers(pl.k);
    }
  });

  fetch(root + 'data/readership-places.json').then(function (r) { return r.json(); }).then(function (d) {
    D = d;
    var h = new URLSearchParams(location.hash.slice(1));
    if (h.get('papers')) { var want = h.get('papers').split(','); $$('input[name=paper]').forEach(function (i) { i.checked = want.indexOf(i.value) > -1; }); }
    if (h.get('from')) fromIn.value = h.get('from');
    if (h.get('to')) toIn.value = h.get('to');
    var us = D.places.filter(function (p) { return /United States/.test(p.country || '') && p.lon < -60 && p.lon > -130; });
    map.fitBounds(L.latLngBounds(us.map(function (p) { return [p.lat, p.lon]; })), { paddingTopLeft: [30, 30], paddingBottomRight: [110, 30] });
    render();
    if (h.get('place')) { var pl = byKey(h.get('place')); if (pl) { map.setView([pl.lat, pl.lon], 8); showSubscribers(pl.k); } }
  }).catch(function () { $('#r-summary').textContent = 'The data could not be loaded. Serve the site over HTTP (see README).'; });
})();
