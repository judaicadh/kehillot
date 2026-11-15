(() => {
  const input=document.querySelector('#archive-search'), volumes=[...document.querySelectorAll('.archive-volume')];
  const rows=[...document.querySelectorAll('[data-article-title]')];
  input.value=new URLSearchParams(location.search).get('q') || '';
  function filter() {
    const words=input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let count=0;
    rows.forEach(row=>{row.hidden=!words.every(w=>row.dataset.articleTitle.includes(w)); if(!row.hidden) count++;});
    volumes.forEach(v=>{v.hidden=![...v.querySelectorAll('li')].some(r=>!r.hidden);v.open=words.length>0 && !v.hidden;});
    document.querySelector('#archive-status').textContent=count.toLocaleString()+' article links'+(words.length ? ' matching these words.' : '. Open a volume to browse.');
    const url=new URL(location.href); if(input.value.trim()) url.searchParams.set('q',input.value.trim()); else url.searchParams.delete('q');
    history.replaceState(null,'',url.pathname+url.search+url.hash);
  }
  input.addEventListener('input',filter);filter();
  function anchor() {const row=document.getElementById(location.hash.slice(1));if(row?.matches('[data-article-title]')) {row.hidden=false;row.closest('details').hidden=false;row.closest('details').open=true;row.scrollIntoView();}}
  anchor();window.addEventListener('hashchange',anchor);
})();
