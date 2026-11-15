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
  function viewParams() {
    var params = new URLSearchParams(location.search), legacy = new URLSearchParams(location.hash.slice(1));
    ['year','groups','tour','stop'].forEach(function(key){if(!params.has(key) && legacy.has(key)) params.set(key,legacy.get(key));});
    return params;
  }
  var initialHash = location.hash, initial = viewParams();
  var tourRunning = false, tourStops = [], tourIndex = -1;
  var tourStart = $('#tour-start'), tourEnd = $('#tour-end'), tourActive = $('#tour-active');
  var tourProgress = $('#tour-progress'), tourTitle = $('#tour-title'), tourStory = $('#tour-story');
  var tourPrev = $('#tour-prev'), tourNext = $('#tour-next');

  var map = L.map(mapEl, { scrollWheelZoom: false, zoomSnap: 0.5, maxZoom: C.tiles.street.maxZoom || 18 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  var modernLayer = L.tileLayer(C.tiles.street.url, { maxZoom: C.tiles.street.maxZoom || 18, maxNativeZoom:C.tiles.street.maxNativeZoom || C.tiles.street.maxZoom || 18, attribution: C.tiles.street.attribution, className: 'street-tiles' }).addTo(map);
  KhTerrain(map, C.tiles.terrain, saveView);
  // A historical layer is offered only when an editor has supplied its source and tiles.
  if (C.historicalMap) {
    var historicalLayer = L.tileLayer(C.historicalMap.url, {maxZoom: C.historicalMap.maxZoom || 18, attribution: C.historicalMap.attribution, opacity: 0.75});
    var overlays = {}; overlays[C.historicalMap.label] = historicalLayer;
    L.control.layers(null, overlays, {collapsed:false}).addTo(map);
  }


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
      .bindTooltip(name, { permanent: false, direction: 'right', offset: [12, 0], className: 'kh-label kh-local' })
      .bindPopup(function () {
        var body = $('.entry-body', li).cloneNode(true);
        return '<h3>' + esc(name) + '</h3>' + body.innerHTML;
      }, { maxWidth: 300, className: 'kh-popup' });
    m.on('click', function () { if(tourStops.some(function(entry){return entry.dataset.id===d.id;}))startJourney(d.id);else select(d.id,false); });
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
    if (tourRunning) { var position = tourStops.findIndex(function (entry) {return entry.dataset.id === id;}); if (position >= 0) {tourIndex = position; paintTour();} else {tourRunning=false;refreshJourney();saveView();} }
    var li = $('#e-' + id);
    var m = markers[id];
    if (!li || !m) return;
    if (!tourRunning) $('#city-records').open=true;
    if(tourRunning)map.closePopup();
    if (fromList) {
      if (reduceMotion) map.setView(m.getLatLng(),Math.max(map.getZoom(),15));
      else map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 15), { duration: 0.6 });
      if (!tourRunning) m.openPopup(); else map.closePopup();
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
    $('.explorer-controls summary').textContent='Map year ' + (isFinite(y)?y:'all dates') + ' · filters';
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
      ? shown + ' of ' + total + ' places recorded by ' + y + (shown < total ? '; later ones are greyed in the list.' : '.')
      : shown + ' places.';
    refreshJourney();
    if (!tourRunning && selected && !map.hasLayer(markers[selected])) {select(null);map.closePopup();}
    saveView();
  }
  // Journeys are generated from the visible, dated records, never invented narrative.
  function saveView() {
    var params = new URLSearchParams();
    if (new URLSearchParams(location.search).get('terrain') === '1') params.set('terrain','1');
    if (yearInput) params.set('year',yearInput.value);
    var chosen=$$('input[name=group]:checked').map(function(input){return input.value;});
    if(chosen.length !== $$('input[name=group]').length) params.set('groups',chosen.join(','));
    if (tourRunning) {params.set('tour','1'); if (selected) params.set('stop',selected);}
    var fragment = tourRunning ? '#journey' : (location.hash && !location.hash.includes('=') && location.hash !== '#journey' ? location.hash : '');
    var view = location.pathname + '?' + params.toString() + fragment;
    try {history.replaceState(null,'',view);} catch(e) { /* file preview */ }
    $('#tour-share-url').value = new URL(view,location.href).href;
  }

  function refreshPins() {
    entries.forEach(function (entry) {
      var d = entry.dataset, number = tourStops.indexOf(entry) + 1;
      var active = selected === d.id;
      markers[d.id].setIcon(tourRunning && number ? L.divIcon({
        className:'kh-mark journey-marker' + (active ? ' is-current' : ''),
        html:'<span class="journey-pin" aria-hidden="true">' + number + '</span>',iconSize:[28,28],iconAnchor:[14,14]
      }) : symbol(d.kind,d.precision === 'approximate',active));
      markers[d.id].setZIndexOffset(active ? 200 : 0);
    });
  }
  function paintTour() {
    var entry = tourStops[tourIndex];
    if (!entry) return;
    tourTitle.textContent = $('.entry-name',entry).textContent;
    $('#tour-map-caption').textContent = tourTitle.textContent;
    $('#tour-map-caption').hidden=false;
    $('#tour-entity-link').href = entry.dataset.entityUri;
    $('#tour-jsonld-link').href = entry.dataset.recordUrl + 'index.jsonld';
    $('#tour-share-status').textContent = '';
    tourStory.innerHTML = $('.entry-body',entry).innerHTML;
    var date = entry.dataset.from || 'date unknown';
    var precision = entry.dataset.precision === 'exact' ? 'recorded at an exact location' : 'location approximate';
    tourProgress.textContent = (C.name ? C.name + ' · ' : '') + 'Stop ' + (tourIndex + 1) + ' of ' + tourStops.length + ' · ' + date + (entry.dataset.precision === 'exact' ? '' : ' · approximate') + (tourIndex === tourStops.length - 1 ? '. You have reached the last stop.' : '.');
    $('#tour-map-progress').textContent = (tourIndex + 1) + ' / ' + tourStops.length;
    tourPrev.disabled = tourIndex <= 0; tourNext.disabled = tourIndex >= tourStops.length - 1;
    $('[data-tour-action="prev"]').disabled = tourPrev.disabled;
    $('[data-tour-action="next"]').disabled = tourNext.disabled;
    $$('#tour-stops button').forEach(function(button){
      if(button.dataset.tourId === entry.dataset.id) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
    });
    refreshPins();
    saveView();
  }
  function showStop(position, move) {
    if (!tourRunning || !tourStops[position]) return;
    tourIndex = position;
    select(tourStops[position].dataset.id,move);
    if (move && window.innerWidth < 900) mapEl.scrollIntoView({behavior:reduceMotion ? 'auto':'smooth',block:'start'});
    declutter();
  }
  function refreshJourney() {
    var previousId = selected;
    tourStops = entries.filter(function(entry){
      return !entry.hidden && !entry.classList.contains('not-yet') && entry.dataset.precision !== 'city';
    }).sort(function(a,b){return (Number(a.dataset.from) || Infinity) - (Number(b.dataset.from) || Infinity) || $('.entry-name',a).textContent.localeCompare($('.entry-name',b).textContent);});
    tourStart.disabled = !tourStops.length;
    $('#tour-launch').disabled = !tourStops.length;
    tourStart.textContent = 'Explore' + (yearInput ? ' in ' + yearInput.value : '') + ' · ' + tourStops.length + ' stop' + (tourStops.length === 1 ? '' : 's');
    $('#tour-stops').innerHTML = tourStops.map(function(entry){return '<li><button type="button" data-tour-id="' + esc(entry.dataset.id) + '">' + esc($('.entry-name',entry).textContent) + '</button></li>';}).join('');
    if (!tourStops.length) {
      tourRunning = false; tourIndex = -1;
      tourProgress.textContent = 'No address-level stops match this year and these categories. Change the filters, explore the subscribers below, or help locate a site.';
    } else if (tourRunning) {
      var position = tourStops.findIndex(function(entry){return entry.dataset.id === previousId;});
      showStop(position < 0 ? 0 : position,position < 0);
    } else {
      tourProgress.textContent = tourStops.length + ' stops available. Choose Explore to begin a journey through the recorded places.';
    }
    document.body.classList.toggle('journey-running',tourRunning);
    $('#tour-map-caption').hidden=!tourRunning;
    tourStart.hidden = tourRunning;
    tourEnd.hidden = !tourRunning;
    tourActive.hidden = !tourRunning;
    $('#tour-map-controls').hidden = !tourRunning;
    refreshPins();
  }
  function startJourney(id) {
    if (!tourStops.length) return;
    if (id && !tourStops.some(function(entry){return entry.dataset.id === id;})) {
      tourRunning=false;refreshJourney();
      tourProgress.textContent='The linked stop is not available for this year and these categories. Change the filters to find it.';
      return;
    }
    tourRunning = true;
    document.body.classList.add('journey-running');
    tourStart.hidden = true; tourEnd.hidden = false; tourActive.hidden = false; $('#tour-map-controls').hidden = false;
    var position = tourStops.findIndex(function(entry){return entry.dataset.id === id;});
    showStop(position < 0 ? 0 : position,true);
    var nextControl = window.innerWidth < 900 ? $('[data-tour-action="next"]') : tourNext;
    (nextControl.disabled ? tourEnd : nextControl).focus({preventScroll:true});
  }
  $('#tour-share').addEventListener('click',function(){
    saveView();
    var field=$('#tour-share-url'), message=$('#tour-share-status');
    function manual() {field.hidden=false;field.focus();field.select();message.textContent='Copy the selected link. It includes the year, categories, and this stop.';}
    if (!navigator.clipboard || !navigator.clipboard.writeText) return manual();
    navigator.clipboard.writeText(field.value).then(function(){message.textContent='Link copied. Opening it restores this year, these categories, and this stop.';}).catch(manual);
  });
  $('#tour-show-map').addEventListener('click',function(){showStop(tourIndex,true);});
  tourStart.addEventListener('click',function(){startJourney();});
  function endJourney() {tourRunning=false;refreshJourney();map.closePopup();saveView();tourStart.focus({preventScroll:true});}
  tourEnd.addEventListener('click',endJourney);
  $('#tour-launch').addEventListener('click',function(){startJourney();});
  $('[data-tour-action="end"]').addEventListener('click',endJourney);
  tourPrev.addEventListener('click',function(){showStop(tourIndex-1,true);});
  tourNext.addEventListener('click',function(){showStop(tourIndex+1,true);});
  $('[data-tour-action="prev"]').addEventListener('click',function(){showStop(tourIndex-1,true);});
  $('[data-tour-action="next"]').addEventListener('click',function(){showStop(tourIndex+1,true);});
  $('#tour-stops').addEventListener('click',function(event){var button=event.target.closest('[data-tour-id]');if(button)startJourney(button.dataset.tourId);});

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
  var defaultYear = yearInput ? yearInput.value : null;
  function restoreView(params, fragment) {
    tourRunning=false;selected=null;
    if (yearInput) yearInput.value = params.has('year') && /^\d{4}$/.test(params.get('year')) ? Math.max(+yearInput.min,Math.min(+yearInput.max,+params.get('year'))) : defaultYear;
    var wanted=params.has('groups') ? params.get('groups').split(',') : null;
    $$('input[name=group]').forEach(function(input){input.checked=!wanted || wanted.indexOf(input.value)>-1;});
    entries.forEach(function(entry){entry.classList.remove('is-selected');$('.entry-head',entry).setAttribute('aria-expanded','false');});
    render();
    if (params.get('tour') === '1') startJourney(params.get('stop'));
    else if (/^#e-/.test(fragment)) select(fragment.slice(3),true);
    else if (/^#stop-/.test(fragment)) {
      var entry=entries.find(function(entry){return fragment === '#stop-' + entry.dataset.type + '-' + entry.dataset.id;});
      if(entry)select(entry.dataset.id,true);
    }
    setTimeout(declutter,0);
  }
  restoreView(initial,initialHash);
  window.addEventListener('hashchange',function(){restoreView(viewParams(),location.hash);});
  window.addEventListener('popstate',function(){restoreView(viewParams(),location.hash);});
})();
