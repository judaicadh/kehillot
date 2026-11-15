/* Shared navigation and lightweight view controls; ordinary links work without JS. */
(() => {
  document.body.classList.add('js-site');
  const toggle=document.querySelector('#nav-toggle');
  if(toggle){
    toggle.hidden=false;
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));document.querySelector('.site-header').classList.toggle('menu-open',open);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && toggle.getAttribute('aria-expanded')==='true'){toggle.click();toggle.focus();}});
  }
  document.querySelectorAll('[data-map-switch]').forEach(select=>select.addEventListener('change',()=>{
    const target=new URL(select.value,location.href), current=new URLSearchParams(location.hash.slice(1)), next=new URLSearchParams();
    ['city','from','to'].forEach(key=>{if(current.has(key))next.set(key,current.get(key));});
    target.hash=next.toString();location.assign(target.href);
  }));
  const views=[...document.querySelectorAll('.viz-block')];
  const tabs=[...document.querySelectorAll('.viz-view-tabs a')];
  if(views.length && tabs.length){
    function showView(){
      const id=location.hash.slice(1), target=document.getElementById(id), chosen=views.find(view=>view.id===id || (target && view.contains(target)))||views[0];
      views.forEach(view=>view.hidden=view!==chosen);
      tabs.forEach(tab=>{if(tab.getAttribute('href')==='#'+chosen.id)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');});
      window.dispatchEvent(new Event('resize'));
    }
    window.addEventListener('hashchange',showView);showView();
  }
})();
