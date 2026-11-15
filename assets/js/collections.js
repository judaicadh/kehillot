(() => {
  const input=document.querySelector('#collection-search'), rows=[...document.querySelectorAll('[data-collection-search]')];
  input.value=new URLSearchParams(location.search).get('q') || '';
  function filter(){const words=input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);let count=0;rows.forEach(row=>{row.hidden=!words.every(w=>row.dataset.collectionSearch.includes(w));if(!row.hidden)count++;});document.querySelector('#collection-count').textContent=count+(count===1 ? ' collection' : ' collections');const url=new URL(location.href);if(input.value.trim())url.searchParams.set('q',input.value.trim());else url.searchParams.delete('q');history.replaceState(null,'',url.pathname+url.search+url.hash);}
  input.addEventListener('input',filter);filter();
})();
