/* Shareable collection filters; pagination affects cards, not comparison results. */
(() => {
  const form = document.getElementById('survey-filters');
  if (!form) return;
  const cards = [...document.querySelectorAll('[data-survey]')];
  const rows = [...document.querySelectorAll('[data-survey-row]')];
  const controls = Object.fromEntries(['query','year','form','place','collection'].map(key=>[key,document.getElementById('survey-'+key)]));
  const pager = document.getElementById('survey-pagination'), size=24;
  let page=1;
  const fold = s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  function readURL() {
    const params=new URLSearchParams(location.search);
    Object.entries(controls).forEach(([key,input])=>{input.value=params.get(key)||''; if(input.tagName==='SELECT' && input.selectedIndex<0)input.value='';});
    page=Math.max(1,parseInt(params.get('page'),10)||1);
  }
  function update(save=true) {
    const words=fold(controls.query.value).trim().split(/\s+/).filter(Boolean);
    const matches=cards.filter(card=>['year','form','place','collection'].every(key=>!controls[key].value || card.dataset[key]===controls[key].value) && words.every(word=>fold(card.dataset.search).includes(word)));
    const pages=Math.max(1,Math.ceil(matches.length/size)); page=Math.min(page,pages);
    const visible=new Set(matches.map(card=>card.dataset.survey));
    cards.forEach(card=>{card.hidden=true;});
    matches.slice((page-1)*size,page*size).forEach(card=>{card.hidden=false;});
    rows.forEach(row=>{row.hidden=!visible.has(row.dataset.surveyRow);});
    document.getElementById('survey-count').textContent=`${matches.length} of ${cards.length} source records${matches.length ? ` · showing ${(page-1)*size+1}–${Math.min(page*size,matches.length)}` : ''}. Comparison includes all matches.`;
    document.getElementById('survey-empty').hidden=matches.length!==0;
    pager.hidden=pages<=1;
    document.getElementById('survey-page').textContent=`Page ${page} of ${pages}`;
    document.getElementById('survey-prev').disabled=page===1;
    document.getElementById('survey-next').disabled=page===pages;
    if(save){const url=new URL(location.href); Object.entries(controls).forEach(([key,input])=>{if(input.value)url.searchParams.set(key,input.value);else url.searchParams.delete(key);});if(page>1)url.searchParams.set('page',page);else url.searchParams.delete('page');history.replaceState(null,'',url);}
  }
  form.addEventListener('input',()=>{page=1;update();});
  form.addEventListener('change',()=>{page=1;update();});
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('reset',()=>setTimeout(()=>{page=1;update();},0));
  ['prev','next'].forEach(key=>document.getElementById('survey-'+key).addEventListener('click',()=>{page+=key==='next'?1:-1;update();document.getElementById('survey-results').scrollIntoView({block:'start'});}));
  window.addEventListener('popstate',()=>{readURL();update(false);});
  // Preserve links to records on the original directory, including later result pages.
  function revealFragment(){const target=document.getElementById(location.hash.slice(1));if(!target?.dataset.survey)return;Object.values(controls).forEach(input=>{input.value='';});page=Math.floor(cards.indexOf(target)/size)+1;update();target.scrollIntoView();}
  readURL();update(false);revealFragment();window.addEventListener('hashchange',revealFragment);
  const measure=document.getElementById('survey-measures');
  if(measure){
    measure.closest('label').hidden=false;
    const groups={membership:[3,4,5,6,7,16],education:[8,9,10,11],community:[12,13,14,15,17]};
    function columns(){document.querySelectorAll('#survey-compare tr').forEach(row=>[...row.children].forEach((cell,i)=>{cell.hidden=i>=3 && measure.value!=='all' && !groups[measure.value].includes(i);}));}
    measure.addEventListener('change',columns);columns();
  }
})();
