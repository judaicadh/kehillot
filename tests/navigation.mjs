import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('dist');
const read=p=>readFile(path.join(root,p),'utf8');
async function checkLinks(page,markup){
 for(const match of markup.matchAll(/href="([^"]+)"/g)){
  const href=match[1].replaceAll('&amp;','&');
  if(/^(https?:|mailto:|#)/.test(href))continue;
  const target=path.resolve(root,path.dirname(page),decodeURIComponent(href.split(/[?#]/)[0]));
  try {await stat(target);}catch {assert.fail(`${page} links to missing ${href}`);}
 }
}
const map=await read('maps/all/index.html');
assert.match(map,/value="board-sources"(?! checked)/);
assert.doesNotMatch(map,/value="board-sources" checked/);
assert.match(map,/Explore the sources|Board source observations are an optional evidence layer/);
const directory=await read('maps/index.html');
for(const label of ['Explore a city','Follow congregations over time','Map people and institutions','Explore the sources'])assert(directory.includes(label));
await checkLinks('maps/index.html',directory);
for(const type of ['congregation','institution','person','place','source']){
 for(const id of await readdir(path.join(root,type))){
  const page=`${type}/${id}/index.html`, html=await read(page);
  const nav=html.match(/<nav class="record-actions"[\s\S]*?<\/nav>/)?.[0];
  assert(nav,`No navigation: ${page}`);await checkLinks(page,nav);
  assert(nav.includes('Suggest a correction'));
 }
}
for(const id of await readdir(path.join(root,'surveys/collections'))){
 const page=`surveys/collections/${id}/index.html`;await checkLinks(page,await read(page));
}
console.log('Verified record navigation routes, collection hubs, map directory and default evidence separation.');
const places=JSON.parse(await readFile('data/places.json','utf8'));
const guides=await read('cities/index.html');
const site=JSON.parse(await read('data/site.json'));
for(const place of places){
 assert(site.cityGuides.includes(place.id),`No guide registered for ${place.id}`);
 await stat(path.join(root,'city',place.id,'index.html'));
 assert(guides.includes(`class="city-card" href="../city/${place.id}/"`),`No directory card for ${place.id}`);
}
console.log(`Verified guide pages and visible directory cards for all ${places.length} curated places.`);
const subscriberPlaces=JSON.parse(await read('data/readership-places.json')).places;
for(const place of subscriberPlaces.filter(p=>!p.own && !places.some(c=>c.subscriberLocality===p.k))){
 assert(guides.includes(`../city/${place.cityId}/`),`Missing subscriber locality ${place.cityId}`);
 await stat(path.join(root,'city',place.cityId,'index.html'));
}
const ads=JSON.parse(await readFile('data/advertisements.json','utf8'));
for(const ad of ads.filter(a=>!a.place && !a.locality)){
 assert(guides.includes(`../place-references/${ad.id}/`));
 await checkLinks(`place-references/${ad.id}/index.html`,await read(`place-references/${ad.id}/index.html`));
}
const mentions=JSON.parse(await readFile('data/community-mentions.json','utf8'));
for(const mention of mentions.filter(m=>m.guide))assert((await read(`city/${mention.guide}/index.html`)).includes(`surveys/${mention.survey}/`));
assert(guides.indexOf('id="all-places"')<guides.indexOf('class="city-cards"'));
console.log('Verified subscriber localities, unresolved references, and survey-to-guide links.');
