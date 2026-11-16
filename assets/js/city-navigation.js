// Shared, account-free city navigation for the atlas and feature maps.
// Coordinates and bounds come from curated local records, not a geocoding service.
window.KhCityNavigation = function (map, options) {
  'use strict';
  var form = document.querySelector('#city-jump-form');
  if (!form) return null;
  var cities = JSON.parse(document.querySelector('#city-navigation-data').textContent);
  var input = document.querySelector('#city-jump');
  var status = document.querySelector('#city-jump-status');
  var context=document.querySelector('#city-guide-context'), contextName=document.querySelector('#map-city-name');
  var guide = document.querySelector('#city-guide-link');
  var reset = document.querySelector('#city-reset');
  var current = null;
  var mapEl = map.getContainer();
  var nationalLabel = mapEl.getAttribute('aria-label');
  var initial = new URLSearchParams(location.hash.slice(1)).get('city');
  var normalize = function (value) { return value.toLowerCase().trim(); };
  var label = function (city) { return city.name + ', ' + city.state; };
  function saveCity() {
    var params = new URLSearchParams(location.hash.slice(1));
    if (current) params.set('city', current.id); else params.delete('city');
    try { history.replaceState(null, '', '#' + params.toString()); } catch (e) { /* file preview */ }
  }
  function overview() {
    current = null;reset.hidden=true;
    input.value = '';
    guide.hidden = true;guide.href=guide.dataset.directory;
    if(context)context.hidden=true;
    mapEl.setAttribute('aria-label', nationalLabel);
    mapEl.parentElement.classList.remove('plate-street');
    status.textContent = '';
    saveCity();
    options.onChange(null);
    options.national();
  }
  function goTo(id) {
    var city = cities.find(function (p) { return p.id === id; });
    if (!city) return false;
    current = city;reset.hidden=false;
    input.value = label(city);
    input.removeAttribute('aria-invalid');
    status.textContent = label(city) + (city.subscriptions ? ' — ' + city.subscriptions.toLocaleString('en-US') + ' subscriptions recorded' : '') + ' — ' + (city.points.length
      ? city.points.length + ' address-level locations recorded across all years. Date and layer filters still apply.'
      : 'No address-level locations recorded yet. Showing the city’s streets; city-level records are placed at its center.');
    guide.hidden = false;
    guide.href=city.guide || guide.dataset.directory;guide.textContent=city.guide ? 'Read the ' + city.name + ' guide →' : 'Browse city guides →';
    if(context){context.hidden=false;contextName.textContent=label(city);}
    mapEl.setAttribute('aria-label', 'Street map of ' + label(city));
    map.stop();
    map.closePopup();
    // Move the legends outside the map before fitting, so they cannot obscure local streets.
    mapEl.parentElement.classList.add('plate-street');
    saveCity();
    options.onChange(city.id);
    if (city.points.length > 1) map.fitBounds(L.latLngBounds(city.points), { padding: [45, 45], maxZoom: 16, animate: false });
    else map.setView(city.points[0] || [city.lat, city.lon], city.points.length ? 15 : 13, { animate: false });
    options.onChange(city.id);
    return true;
  }
  function guideURL(city) {
    var target=new URL(city.guide,location.href), params=new URLSearchParams(location.hash.slice(1));
    var year=params.get('year') || params.get('to');
    if(year && /^\d{4}$/.test(year) && !city.id.startsWith('subscriber-'))target.searchParams.set('year',year);
    return target.href;
  }
  guide.addEventListener('click',function(event){
    var query=normalize(input.value);
    if(!query)return;
    var exact=cities.filter(function(city){return normalize(label(city))===query || city.id===query;});
    var names=cities.filter(function(city){return normalize(city.name)===query || (city.aliases||[]).some(function(name){return normalize(name)===query;});});
    var matches=exact.length ? exact : names;
    if(matches.length===1 && matches[0].guide){event.preventDefault();location.assign(guideURL(matches[0]));}
    else {event.preventDefault();status.textContent='Choose a full city name from the suggestions, or use City guides in the navigation.';input.focus();}
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var query = normalize(input.value);
    var exact = cities.filter(function (p) { return normalize(label(p)) === query || p.id === query; });
    var names = cities.filter(function (p) { return normalize(p.name) === query || (p.aliases||[]).some(function(name){return normalize(name)===query;}); });
    var matches = exact.length ? exact : names.length ? names : cities.filter(function (p) { return normalize(label(p)).indexOf(query) > -1; });
    if (query && matches.length === 1) { input.removeAttribute('aria-invalid'); goTo(matches[0].id); }
    else { input.setAttribute('aria-invalid', 'true'); status.textContent = matches.length > 1 ? 'Several cities match. Choose a full city name from the suggestions.' : 'Choose a city from the suggestions. Only cities in the collection are listed.'; input.focus(); }
  });
  input.addEventListener('input', function () { input.removeAttribute('aria-invalid'); });
  reset.addEventListener('click', overview);
  document.querySelectorAll('[data-city-jump]').forEach(function (button) {
    button.disabled = false;
    button.addEventListener('click', function () { goTo(button.dataset.cityJump); });
  });
  input.disabled = false;
  form.querySelector('[type=submit]').disabled = false;
  reset.disabled = false;reset.hidden=true;
  var nationalZoom=map.getZoom();map.on('zoomend',function(){reset.hidden=!current && map.getZoom()<=nationalZoom+0.25;});
  status.textContent = '';
  // Delay restoration until the caller has received this controller.
  return { goTo: goTo, selected: function () { return current && current.id; }, restore: function () { if (initial) goTo(initial); } };
};
