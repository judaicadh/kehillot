import {createHash} from 'node:crypto';
export async function buildNetwork({triples,graph,BASE,out,layout}) {
  const records=new Map(graph.map(n=>[n['@id'],n]));
  const nodes=new Map();
  const short=id=>id.startsWith('_:')?'Relationship '+id.slice(2):decodeURIComponent(id.split(/[/#]/).filter(Boolean).at(-1));
  function add(id){if(!nodes.has(id)){const r=records.get(id);nodes.set(id,{id,label:r?.name||r?.title||short(id),type:r?String([].concat(r['@type'])[0]).replace(/^.*:/,''):id.startsWith('_:')?'Relationship':'External',url:r?id.replace(BASE,'../'):null});}}
  const statements=triples.map(line=>{
    const m=line.match(/^(<[^>]+>|_:[^ ]+) <([^>]+)> (.*) \.$/);
    if(!m)throw Error('Cannot parse generated triple');
    const s=m[1].replace(/^<|>$/g,''),p=m[2],raw=m[3];
    const resource=raw.startsWith('<')||raw.startsWith('_:');
    const o=resource?raw.replace(/^<|>$/g,''):raw;
    add(s);if(resource)add(o);
    return [s,p,o,resource?1:0];
  });
  const version=createHash('sha256').update(triples.join('\n')).digest('hex').slice(0,16);
  await out('data/triple-network.json',JSON.stringify({version,updated:new Date().toISOString(),nodes:[...nodes.values()],triples:statements}));
  await out('network/index.html',layout({rel:'../',title:'The knowledge network',canonical:BASE+'network/',current:'visualizations/',styles:['assets/css/network.css'],scripts:['assets/vendor/d3/d3.min.js','assets/js/network.js'],body:`<div class="network-page"><header class="network-head"><div><p class="kicker">Explore the linked data</p><h1>The knowledge network</h1><p>People, places and the evidence connecting them.</p></div><a href="../visualizations/">More charts ↗</a></header><form class="network-tools" id="graph-controls"><label>Find a record<input id="graph-search" type="search" placeholder="Name, city or identifier…" autocomplete="off"></label><label>Connection<select id="graph-predicate"><option value="">All relationships</option></select></label><label class="network-check"><input id="graph-external" type="checkbox"> External references</label><button type="button" id="graph-fit">Fit network</button><button type="button" id="graph-pause">Pause motion</button></form><p id="graph-status" role="status">Loading triples…</p><div class="network-workspace"><div class="network-stage"><canvas id="triple-network" tabindex="0" aria-label="Interactive network. Drag to pan, scroll to zoom; use search and the record list to select nodes."></canvas><p class="network-hint">Drag to move · Scroll to zoom · Select a node to explore</p></div><aside class="network-inspector"><h2 id="graph-heading">Follow a connection</h2><p id="graph-detail">Select a node, or find a record above. Each line is a statement in the dataset; it does not imply a causal relationship.</p><div id="graph-record"></div><div id="graph-statements"></div></aside></div><details class="network-list"><summary>Find records without the graph</summary><div id="graph-results"></div></details><p class="network-foot">Updated from the same triples as the dataset. This view checks for a new build every minute while open. <a href="../data/kehillot.nt" download>Download all triples ↓</a> · <a href="../data/triple-network.json" download>Network data ↓</a> · <a href="../datasets/">About the data</a></p></div>`}));
}
