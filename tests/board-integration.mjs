import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const json=async p=>JSON.parse(await readFile(new URL('../'+p,import.meta.url),'utf8'));
const surveys=await json('data/congregation-surveys.json');
const congregations=await json('data/congregations.json'), institutions=await json('data/organizations.json');
const site=await json('dist/data/site.json'), features=await json('dist/data/features.json');
const graph=(await json('dist/data/kehillot.jsonld'))['@graph'];
const geo=(await json('dist/data/atlas.geojson')).features;
for(const sv of surveys){
 const observation=graph.find(n=>n['@id']?.endsWith(`/surveys/${sv.id}/`));
 assert(observation,`Missing source node ${sv.id}`);
 assert.equal(observation.temporalCoverage,sv.date);
 assert(features.items.some(x=>x.id===sv.id && x.documentedYears.includes(Number(sv.date.slice(0,4)))),`Missing mapped observation ${sv.id}`);
 if(sv.form!=='statistics-1880')continue;
 assert.equal(observation.datePublished,'1880');
 if(sv.integrationStatus==='grouped-or-unnamed'){
  assert(!sv.congregation && !sv.institution,'Grouped rows must not become single organizations');continue;
 }
 const type=sv.congregation?'congregation':'institution', id=sv.congregation||sv.institution;
 const record=(type==='congregation'?congregations:institutions).find(r=>r.id===id);
 assert(record,`Missing target ${sv.id}`);
 assert(record.sources.includes(sv.source));
 assert(geo.some(f=>f.properties.id===id),`Missing GeoJSON ${id}`);
 assert(features.items.some(f=>f.id===id),`Missing feature map ${id}`);
 assert(graph.some(n=>n['@id']?.endsWith(`/${type}/${id}/#this`)),`Missing linked entity ${id}`);
 if(record.founded==null)assert(record.documentedYears.includes(1878));
}
assert.equal(site.yearRange[1],1880);
const atlas=await readFile(new URL('../dist/atlas/index.html',import.meta.url),'utf8');
assert.match(atlas,/id="year"[^>]*max="1880"/);
const map=await readFile(new URL('../dist/maps/board-sources/index.html',import.meta.url),'utf8');
assert.match(map,/id="fm-end-year"[^>]*value="1880"/);
console.log(`Verified ${surveys.length} source nodes and map observations, linked entity exports, aggregate exclusions, and extended timeline.`);
