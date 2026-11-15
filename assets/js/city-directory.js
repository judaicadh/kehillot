// The full directory remains readable without JS; search and paging run locally.
(() => {
  const input = document.querySelector('#locality-search');
  const rows = [...document.querySelectorAll('#locality-table tbody tr')];
  const more = document.querySelector('#locality-more');
  if (!input) return;
  const guideForm=document.querySelector('#guide-open-form');
  if(guideForm){
    const cityInput=document.querySelector('#guide-city'), choices=document.querySelector('#guide-city-choices'), message=document.querySelector('#guide-open-status'), suggestions=document.querySelector('#guide-matches');
    const records=rows.map(row=>({name:row.cells[0].textContent.trim(),label:row.cells[0].textContent.trim()+', '+row.cells[1].textContent.trim(),href:row.querySelector('a').getAttribute('href')}));
    records.forEach(record=>{const option=document.createElement('option');option.value=record.label;choices.append(option);});
    cityInput.disabled=false;guideForm.querySelector('button').disabled=false;
    cityInput.addEventListener('input',()=>{suggestions.hidden=true;});
    guideForm.addEventListener('submit',event=>{
      event.preventDefault();const query=cityInput.value.trim().toLocaleLowerCase();
      const exact=records.filter(record=>record.label.toLocaleLowerCase()===query);
      const names=records.filter(record=>record.name.toLocaleLowerCase()===query);
      const matches=exact.length ? exact : names.length ? names : records.filter(record=>record.label.toLocaleLowerCase().includes(query));
      if(matches.length===1)location.assign(matches[0].href);
      else {
        message.textContent=matches.length ? 'Choose a city, or add a state to narrow the search:' : 'No matching city found. Try another name or state.';
        suggestions.replaceChildren();suggestions.hidden=!matches.length;
        matches.slice(0,10).forEach(record=>{const li=document.createElement('li'),link=document.createElement('a');link.href=record.href;link.textContent=record.label;li.append(link);suggestions.append(li);});
      }
    });
  }
  let limit = 50;
  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    let matches = 0;
    let shown = 0;
    rows.forEach(row => {
      const match = row.textContent.toLocaleLowerCase().includes(query);
      if (match) matches++;
      row.hidden = !match || matches > limit;
      if (!row.hidden) shown++;
    });
    document.querySelector('#locality-count').textContent = `${shown.toLocaleString('en-US')} of ${matches.toLocaleString('en-US')} matching places (${rows.length.toLocaleString('en-US')} total)`;
    more.hidden = shown >= matches;
  }
  input.addEventListener('input', () => {limit = 50; render();});
  more.addEventListener('click', () => {limit += 50; render();});
  render();
})();
