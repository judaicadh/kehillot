// Deep-zoom viewer for IIIF images.
// Reads each image's info.json. Where the server lists pre-sized renderings ("sizes"),
// the viewer builds its zoom pyramid from those full-image sizes, which every IIIF server
// that lists them must serve. That avoids depending on how a server describes its tiling,
// which varies between implementations. Otherwise it falls back to standard IIIF tiling.
(function () {
  var el = document.getElementById('osd');
  if (!el || !window.OpenSeadragon) return;
  var services = JSON.parse(el.dataset.services || '[]');
  if (!services.length) return;
  var MAX = 4800; // largest rendering to request (px wide)

  function tileSourceFor(service) {
    var base = service.replace(/\/$/, '');
    return fetch(base + '/info.json').then(function (r) { return r.json(); }).then(function (info) {
      var sizes = (info.sizes || []).filter(function (s) { return s.width <= MAX; }).sort(function (a, b) { return a.width - b.width; });
      if (sizes.length >= 2) {
        return { type: 'legacy-image-pyramid', levels: sizes.map(function (s) {
          return { url: base + '/full/' + s.width + ',' + s.height + '/0/default.jpg', width: s.width, height: s.height };
        }) };
      }
      return base + '/info.json';
    }).catch(function () {
      return { type: 'image', url: base + '/full/!2000,2000/0/default.jpg' };
    });
  }

  Promise.all(services.map(tileSourceFor)).then(function (sources) {
    OpenSeadragon({
      element: el,
      prefixUrl: 'https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/',
      tileSources: sources,
      sequenceMode: sources.length > 1,
      showReferenceStrip: sources.length > 1,
      referenceStripScroll: 'vertical',
      showRotationControl: true,
      crossOriginPolicy: 'Anonymous',
      visibilityRatio: 0.8,
      minZoomImageRatio: 0.8,
      maxZoomPixelRatio: 1.5,
    });
  });
})();
