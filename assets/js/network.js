/* Network and inspector generated from the site's actual RDF statements. */
(async()=>{
  'use strict';
  const $=id=>document.getElementById(id),canvas=$('triple-network'),ctx=canvas.getContext('2d');
  const search=$('graph-search'),predicate=$('graph-predicate'),external=$('graph-external'),status=$('graph-status');
  const state=new URLSearchParams(location.hash.slice(1));
  search.value=state.get('q')||'';external.checked=state.get('external')==='1';
  let dataset,byId,visible=[],edges=[],simulation,selected=state.get('node'),width=800,height=600,transform=d3.zoomIdentity,paused=false,neighbors=new Set(),refreshing=false;
  const short=id=>id.split(/[/#]/).filter(Boolean).at(-1),colors=d3.scaleOrdinal(d3.schemeTableau10);
  const label=id=>byId.get(id)?.label||short(id);
  function save(){const p=new URLSearchParams();if(selected)p.set('node',selected);if(search.value)p.set('q',search.value);if(predicate.value)p.set('predicate',predicate.value);if(external.checked)p.set('external','1');history.replaceState(null,'',location.pathname+(p.size?'#'+p:''));}
  function button(text,action){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=action;return b;}
  function showResults(){const q=search.value.toLowerCase().trim(),box=$('graph-results');box.replaceChildren();const rows=dataset.nodes.filter(n=>n.type!=='Relationship'&&(external.checked||n.type!=='External')&&(!q||(n.label+' '+n.id).toLowerCase().includes(q)));for(const n of rows.slice(0,150))box.append(button(n.label,()=>choose(n.id,true)));if(rows.length>150){const p=document.createElement('p');p.textContent=`Showing 150 of ${rows.length} records. Refine your search.`;box.append(p);}if(q)box.parentElement.open=true;}
  function inspect(){
    neighbors=new Set(selected?[selected]:[]);$('graph-record').replaceChildren();$('graph-statements').replaceChildren();
    if(!selected||!byId.has(selected)){$('graph-heading').textContent='Follow a connection';$('graph-detail').textContent='Select a node, or find a record above. Each line is a statement in the dataset.';return;}
    const n=byId.get(selected);$('graph-heading').textContent=n.label;
    const rows=dataset.triples.filter(t=>t[0]===selected||(t[3]&&t[2]===selected));
    $('graph-detail').textContent=`${n.type} · ${rows.length} statements. Arrows run from subject to object.`;
    const code=document.createElement('code');code.textContent=n.id;$('graph-record').append(code);
    if(n.url){const a=document.createElement('a');a.href=n.url;a.textContent='Open full record ↗';const p=document.createElement('p');p.append(a);$('graph-record').append(p);}
    for(const [s,p,o,resource]of rows){neighbors.add(s);if(resource)neighbors.add(o);const row=document.createElement('div');row.className='network-statement';const rel=document.createElement('small');rel.textContent=(s===selected?'→ ':'← ')+short(p);rel.title=p;row.append(rel);const target=s===selected?o:s;if(resource||s!==selected)row.append(button(label(target),()=>choose(target,true)));else{const span=document.createElement('span');span.textContent=o;row.append(span);}$('graph-statements').append(row);}
  }
  function choose(id,center=false){selected=id;inspect();save();const n=visible.find(n=>n.id===id);if(center&&n){d3.select(canvas).call(zoom.transform,d3.zoomIdentity.translate(width/2,height/2).scale(1.6).translate(-n.x,-n.y));}draw();}
  function draw(){
    const ratio=devicePixelRatio||1;ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);ctx.save();ctx.translate(transform.x,transform.y);ctx.scale(transform.k,transform.k);
    ctx.lineWidth=.6/transform.k;for(const e of edges){const active=selected&&(e.source.id===selected||e.target.id===selected);ctx.strokeStyle=active?'#2b7257':selected?'#dce5de':'#b6cbbd';ctx.globalAlpha=active?1:.45;ctx.beginPath();ctx.moveTo(e.source.x,e.source.y);ctx.lineTo(e.target.x,e.target.y);ctx.stroke();if(active){const angle=Math.atan2(e.target.y-e.source.y,e.target.x-e.source.x),x=(e.source.x+e.target.x)/2,y=(e.source.y+e.target.y)/2;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-6*Math.cos(angle-.5),y-6*Math.sin(angle-.5));ctx.lineTo(x-6*Math.cos(angle+.5),y-6*Math.sin(angle+.5));ctx.closePath();ctx.fillStyle='#2b7257';ctx.fill();}}
    const q=search.value.toLowerCase().trim();for(const n of visible){const active=n.id===selected,match=q&&(n.label+' '+n.id).toLowerCase().includes(q);ctx.globalAlpha=selected&&!neighbors.has(n.id)&&!match ? .17 : 1;ctx.fillStyle=active?'#123d2e':match?'#c58a2a':n.type==='Relationship'?'#9aafa2':colors(n.type);ctx.beginPath();ctx.arc(n.x,n.y,active?7:n.radius,0,Math.PI*2);ctx.fill();if(active||match||(transform.k>2.5&&n.type!=='Relationship')){ctx.font=`${12/transform.k}px system-ui`;ctx.fillStyle='#173e33';ctx.fillText(n.label.slice(0,65),n.x+9/transform.k,n.y+3/transform.k);}}
    ctx.restore();ctx.globalAlpha=1;
  }
  function fit(){if(!visible.length)return;const xs=visible.map(n=>n.x||0),ys=visible.map(n=>n.y||0),minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);const k=Math.min(2,(width-60)/Math.max(1,maxX-minX),(height-60)/Math.max(1,maxY-minY));d3.select(canvas).call(zoom.transform,d3.zoomIdentity.translate(width/2,height/2).scale(k).translate(-(minX+maxX)/2,-(minY+maxY)/2));}
  function rebuild(first=false){
    simulation?.stop();const previous=new Map(visible.map(n=>[n.id,n]));
    const allowed=new Set(dataset.nodes.filter(n=>external.checked||n.type!=='External').map(n=>n.id));
    const links=dataset.triples.filter(t=>t[3]&&allowed.has(t[0])&&allowed.has(t[2])&&(!predicate.value||t[1]===predicate.value));
    const degree=new Map();for(const t of links){degree.set(t[0],(degree.get(t[0])||0)+1);degree.set(t[2],(degree.get(t[2])||0)+1);}
    visible=dataset.nodes.filter(n=>allowed.has(n.id)&&(!predicate.value||degree.has(n.id))).map(n=>({...n,x:previous.get(n.id)?.x,y:previous.get(n.id)?.y,vx:previous.get(n.id)?.vx,vy:previous.get(n.id)?.vy,radius:n.type==='Relationship'?1.6:Math.min(8,2+Math.sqrt(degree.get(n.id)||0))}));
    edges=links.map(t=>({source:t[0],target:t[2],predicate:t[1]}));
    simulation=d3.forceSimulation(visible).force('link',d3.forceLink(edges).id(n=>n.id).distance(30).strength(.3)).force('charge',d3.forceManyBody().strength(-18).theta(1)).force('x',d3.forceX().strength(.025)).force('y',d3.forceY().strength(.025)).alphaDecay(.045).on('tick',draw).on('end',()=>{if(first&&!selected)fit();});
    if(paused){simulation.tick(50);simulation.stop();}if(first){simulation.tick(35);fit();}inspect();showResults();save();draw();status.textContent=`${visible.length.toLocaleString()} nodes · ${edges.length.toLocaleString()} visible links · ${dataset.triples.length.toLocaleString()} total triples · Updated ${new Date(dataset.updated).toLocaleString()}`;
  }
  const zoom=d3.zoom().scaleExtent([.04,12]).on('zoom',e=>{transform=e.transform;draw();});d3.select(canvas).call(zoom).on('dblclick.zoom',null);
  let down;canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});canvas.addEventListener('click',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const rect=canvas.getBoundingClientRect(),[x,y]=transform.invert([e.clientX-rect.left,e.clientY-rect.top]);let best,dist=Infinity;for(const n of visible){const d=Math.hypot(n.x-x,n.y-y);if(d<Math.max(n.radius,9/transform.k)&&d<dist){best=n;dist=d;}}if(best)choose(best.id);});
  new ResizeObserver(()=>{const rect=canvas.getBoundingClientRect();width=rect.width;height=rect.height;canvas.width=width*(devicePixelRatio||1);canvas.height=height*(devicePixelRatio||1);draw();}).observe(canvas);
  $('graph-controls').onsubmit=e=>{e.preventDefault();const q=search.value.toLowerCase().trim(),n=dataset.nodes.find(n=>n.type!=='Relationship'&&n.label.toLowerCase()===q)||dataset.nodes.find(n=>q&&n.label.toLowerCase().includes(q));if(n)choose(n.id,true);};
  search.oninput=()=>{if(dataset){showResults();save();draw();}};predicate.onchange=external.onchange=()=>rebuild();$('graph-fit').onclick=fit;$('graph-pause').onclick=()=>{paused=!paused;$('graph-pause').textContent=paused?'Resume motion':'Pause motion';if(paused)simulation?.stop();else simulation?.alpha(.3).restart();};
  async function load(){if(refreshing||(document.hidden&&dataset))return;refreshing=true;try{const response=await fetch('../data/triple-network.json',{cache:'no-store'});if(!response.ok)throw Error('HTTP '+response.status);const fresh=await response.json();if(dataset?.version===fresh.version)return;const first=!dataset;dataset=fresh;byId=new Map(dataset.nodes.map(n=>[n.id,n]));const value=first?state.get('predicate')||'':predicate.value;predicate.replaceChildren(new Option('All relationships',''));for(const p of [...new Set(dataset.triples.filter(t=>t[3]).map(t=>t[1]))].sort())predicate.add(new Option(short(p),p));predicate.value=value;if(predicate.selectedIndex<0)predicate.value='';rebuild(first);}catch(error){status.textContent=dataset?'Could not check for updates. The last loaded graph is still available.':'Could not load the network. Reload to try again.';}finally{refreshing=false;}}
  window.addEventListener('hashchange',()=>{const p=new URLSearchParams(location.hash.slice(1));selected=p.get('node');search.value=p.get('q')||'';predicate.value=p.get('predicate')||'';external.checked=p.get('external')==='1';if(dataset)rebuild();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});await load();setInterval(load,60000);
})();
