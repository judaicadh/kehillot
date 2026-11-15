/* Public contribution desk; native POST delivery or an explicit local download. */
(() => {
  const form = document.querySelector('#contribution-form');
  if (!form) return;
  const params = new URLSearchParams(location.search);
  const type = form.elements.namedItem('type');
  if ([...type.options].some(o => o.value === params.get('type'))) type.value = params.get('type');
  form.elements.namedItem('record').value = params.get('record') || '';
  form.elements.namedItem('place').value = (params.get('place') || '').slice(0,500);
  form.elements.namedItem('subject').value = (params.get('title') || '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 250);
  const update = () => {
    form.elements.namedItem('record').required = type.value === 'correction';
    window.KhLocationPicker?.setEnabled(type.value === 'location');
  };
  type.addEventListener('change', update);
  update();
  form.addEventListener('submit', event => {
    if (form.elements.namedItem('website').value) { event.preventDefault(); return; }
    if (form.dataset.delivery === 'online') return; // The inbox owns receipt confirmation.
    event.preventDefault();
    const values = new FormData(form);
    const text = [
      'KEHILLOT — CONTRIBUTION FOR EDITORIAL REVIEW',
      'Prepared locally. This file has not been sent to the project.', '',
      ...['type', 'record', 'subject', 'place', 'details', ...(type.value === 'location' ? ['proposed_latitude','proposed_longitude','location_precision','historical_address','location_source_date','location_reason'] : []), 'source', 'source_url', 'certainty', 'credit', 'orcid', 'consent']
        .map(key => `${key.toUpperCase()}\n${values.get(key) || '(not provided)'}\n`),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'kehillot-suggestion.txt';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.querySelector('#contribution-status').textContent = 'Your file is ready to share with an editor. It has not been sent to the project.';
  });
  form.querySelector('[type=submit]').disabled = false;
})();
