/* A proposed historical point, kept separate from the existing record and its precision. */
(() => {
  const fields = document.querySelector('#location-fields');
  if (!fields) return;
  const params = new URLSearchParams(location.search);
  const lat = document.querySelector('#proposed-lat');
  const lon = document.querySelector('#proposed-lon');
  const status = document.querySelector('#location-map-status');
  const element = document.querySelector('#location-map');
  let map;
  let proposed;
  function valid(a,b) {return Number.isFinite(a) && Number.isFinite(b) && a >= -90 && a <= 90 && b >= -180 && b <= 180;}
  function propose(a,b) {
    if (!valid(a,b)) return;
    lat.value = a.toFixed(6); lon.value = b.toFixed(6);
    if (proposed) proposed.setLatLng([a,b]);
    else {
      proposed = L.marker([a,b],{draggable:true,alt:'Proposed historical location',title:'Drag to adjust the proposed location'}).addTo(map);
      proposed.on('dragend',() => {const point=proposed.getLatLng();propose(point.lat,point.lng);});
    }
    status.textContent = `Proposed point: ${a.toFixed(6)}, ${b.toFixed(6)}. Choose the precision supported by your source below. The published record has not changed.`;
  }
  function setup() {
    const provided = params.has('lat') && params.has('lon') && params.get('lat').trim() !== '' && params.get('lon').trim() !== '';
    const a=Number(params.get('lat')), b=Number(params.get('lon'));
    const reference = provided && valid(a,b);
    map = L.map(element,{scrollWheelZoom:false}).setView(reference ? [a,b] : [38.5,-92],reference ? 15 : 4);
    const tiles=JSON.parse(element.dataset.tiles);
    KhTerrain(map, tiles.terrain);
    L.tileLayer(tiles.url,{maxZoom:tiles.maxZoom||18,maxNativeZoom:tiles.maxNativeZoom||18,attribution:tiles.attribution,className:'street-tiles'}).addTo(map);
    L.control.scale({imperial:true,metric:false}).addTo(map);
    if (reference) {
      L.circleMarker([a,b],{radius:7,color:'#627066',weight:2,fillOpacity:0.15})
        .bindTooltip('Reference point from this record; verify against a historical source').addTo(map);
      status.textContent='The grey circle is the reference point from the linked record. Click to propose a point, or enter coordinates. Cite evidence for the precision you choose.';
    }
    map.on('click',event => propose(event.latlng.lat,event.latlng.lng));
  }
  function updateCoordinates(recenter) {
    if (lat.value.trim() === '' || lon.value.trim() === '' || !lat.checkValidity() || !lon.checkValidity()) {
      status.textContent='Enter a latitude from −90 to 90 and a longitude from −180 to 180.';
      return;
    }
    const a=Number(lat.value), b=Number(lon.value);
    propose(a,b);
    if (recenter) map.setView([a,b],Math.max(map.getZoom(),15));
  }
  lat.addEventListener('change',() => updateCoordinates(false));
  lon.addEventListener('change',() => updateCoordinates(false));
  document.querySelector('#location-recenter').addEventListener('click',() => updateCoordinates(true));
  window.KhLocationPicker = {
    setEnabled(enabled) {
      fields.hidden=!enabled;
      fields.disabled=!enabled;
      if (!enabled) return;
      if (!map) setup();
      requestAnimationFrame(() => map.invalidateSize());
    }
  };
})();
