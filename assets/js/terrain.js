/* Optional modern relief, independent of automatic street/national basemap switching. */
window.KhTerrain = function (map, config, onChange) {
  if (!config) return;
  var pane = map.createPane('terrain-relief');
  pane.style.zIndex = 250;
  pane.style.pointerEvents = 'none';
  pane.style.mixBlendMode = 'multiply';
  var layer = L.tileLayer(config.url, {pane:'terrain-relief', opacity:0.65, maxZoom:config.maxZoom || 18,
    maxNativeZoom:config.maxNativeZoom || 16, attribution:config.attribution});
  var control = L.control({position:'topright'}), input;
  control.onAdd = function () {
    var box = L.DomUtil.create('div','terrain-control leaflet-bar');
    var label = document.createElement('label');
    input = document.createElement('input'); input.type = 'checkbox';
    label.append(input, document.createTextNode(' Terrain relief')); box.append(label);
    box.title = 'Modern elevation: show hills and valleys. Zoom out for surrounding terrain.';
    L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
    input.addEventListener('change', function () {
      if (input.checked) layer.addTo(map); else map.removeLayer(layer);
      var url = new URL(location.href);
      if (input.checked) url.searchParams.set('terrain','1'); else url.searchParams.delete('terrain');
      history.replaceState(null,'',url.pathname + url.search + url.hash);
      if (onChange) onChange();
    });
    return box;
  };
  control.addTo(map);
  function restore() {
    input.checked = new URLSearchParams(location.search).get('terrain') === '1';
    if (input.checked && !map.hasLayer(layer)) layer.addTo(map);
    if (!input.checked && map.hasLayer(layer)) map.removeLayer(layer);
  }
  restore(); window.addEventListener('popstate',restore);
};
