// A locality marker provides geographic context without inventing subscriber addresses.
(() => {
  const data = JSON.parse(document.querySelector('#subscriber-city-data').textContent);
  const el = document.querySelector('#subscriber-city-map');
  if (!Number.isFinite(data.lat) || !Number.isFinite(data.lon)) { el.textContent = 'This source locality has not yet been located on the map.'; return; }
  const map = L.map(el, {scrollWheelZoom: false, maxZoom: data.tiles.maxZoom || 18}).setView([data.lat,data.lon],13);
  L.tileLayer(data.tiles.url,{maxZoom:data.tiles.maxZoom||18,maxNativeZoom:data.tiles.maxNativeZoom||18,attribution:data.tiles.attribution,className:'street-tiles'}).addTo(map);
  KhTerrain(map, data.terrain);
  L.circleMarker([data.lat,data.lon],{radius:7,color:'#8a2d1c',weight:2,fillOpacity:0.25})
    .bindTooltip('Recorded locality center; subscriber addresses unknown',{permanent:true,direction:'top'}).addTo(map);
  L.control.scale({imperial:true,metric:false}).addTo(map);
})();
