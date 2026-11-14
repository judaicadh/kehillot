// Fetch metadata for the pictures and documents listed in data/media.json and
// cache it in data/media-cache.json, so the site build itself never needs the network.
//
//   node scripts/fetch-media.mjs            # fetch anything not yet cached
//   node scripts/fetch-media.mjs --refresh  # re-fetch everything
//
// Sources:
//   flickr        a single Flickr photo page   (oEmbed + the page's caption, date taken, geotag)
//   flickr-album  a Flickr album               (every photo in it, plus the album's title and description)
//   iiif          a IIIF Presentation manifest (v3 or v2): label, metadata, rights, attribution, image services
//
// Images are not downloaded: pages link to the holder's image server and credit it.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const DATA = new URL('../data/', import.meta.url);
const UA = 'kehillot-atlas-media/1.0 (static digital humanities site)';
const refresh = process.argv.includes('--refresh');
const config = JSON.parse(await readFile(new URL('media.json', DATA), 'utf8'));
const cachePath = new URL('media-cache.json', DATA);
const cache = !refresh && existsSync(cachePath) ? JSON.parse(await readFile(cachePath, 'utf8')) : { items: {}, collections: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, as = 'text') {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json, application/ld+json' : 'text/html' }, redirect: 'follow' });
    if (r.ok) return as === 'json' ? r.json() : r.text();
    if (r.status === 404) throw new Error(`404 ${url}`);
    await sleep(1500 * 2 ** attempt);
  }
  throw new Error(`Failed to fetch ${url}`);
}
const decode = (s) => String(s ?? '').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const meta = (html, prop) => decode((html.match(new RegExp(`<meta (?:property|name)="${prop}" content="([^"]*)"`)) || [])[1]);

// ── Flickr ──
const flickrId = (url) => (url.match(/\/photos\/[^/]+\/(\d{6,})/) || [])[1];
async function flickrPhoto(url) {
  const id = flickrId(url);
  if (!id) throw new Error(`Not a Flickr photo URL: ${url}`);
  const page = `https://www.flickr.com/photos/${url.match(/\/photos\/([^/]+)\//)[1]}/${id}/`;
  const o = await get(`https://www.flickr.com/services/oembed/?format=json&url=${encodeURIComponent(page)}`, 'json');
  await sleep(600);
  const html = await get(page);
  const lat = Number((html.match(/"latitude":(-?[0-9.]+)/) || [])[1]);
  const lon = Number((html.match(/"longitude":(-?[0-9.]+)/) || [])[1]);
  const acc = Number((html.match(/"accuracy":(\d+)/) || [])[1]);
  const taken = (html.match(/"dateTaken":"([0-9-]{10})/) || [])[1];
  const takenGranularity = Number((html.match(/"dateTakenGranularity":"?(\d+)/) || [])[1] || 0); // 0 exact, 4 month, 6 year, 8 circa
  const description = meta(html, 'og:description');
  const img = o.url; // _b = 1024px
  return {
    key: `flickr-${id}`, source: 'flickr', sourceId: id, page: o.web_page || page,
    title: decode(o.title), description: description && description !== decode(o.title) ? description : '',
    date: taken ? (takenGranularity >= 6 ? taken.slice(0, 4) : takenGranularity >= 4 ? taken.slice(0, 7) : taken) : null,
    dateApproximate: takenGranularity >= 8,
    creator: o.author_name, creatorUrl: o.author_url,
    license: o.license || 'All rights reserved', licenseUrl: o.license_url || null,
    image: { full: img, medium: img.replace(/_b\.jpg$/, '_z.jpg'), thumb: img.replace(/_b\.jpg$/, '_n.jpg'), square: o.thumbnail_url, width: o.width, height: o.height },
    geo: Number.isFinite(lat) && lat !== 0 ? { lat, lon, accuracy: acc || null } : null,
    fetched: new Date().toISOString().slice(0, 10),
  };
}
async function flickrAlbum(url) {
  const html = await get(url);
  const user = url.match(/\/photos\/([^/]+)\//)[1];
  const albumId = url.match(/albums\/(\d+)/)[1];
  const ids = [...new Set([...html.matchAll(new RegExp(`/photos/${user}/(\\d{6,})/in/album-${albumId}`, 'g'))].map((m) => m[1]))];
  if (!ids.length) throw new Error(`No photos found in ${url} (Flickr may have changed its page; set FLICKR_API_KEY support or list photos as items)`);
  return { title: meta(html, 'og:title'), description: meta(html, 'og:description'), page: url, photos: ids.map((id) => `https://www.flickr.com/photos/${user}/${id}/`) };
}

// ── IIIF (Presentation 3, with v2 fallback) ──
const lang = (v) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(lang).join('; ') : v['@value'] ?? Object.values(v).flat().join('; '));
async function iiif(url) {
  const m = await get(url, 'json');
  const v3 = String(m['@context']).includes('/3/');
  const md = Object.fromEntries((m.metadata || []).map((x) => [lang(x.label).toLowerCase(), lang(x.value)]));
  const canvases = v3 ? m.items || [] : (m.sequences?.[0]?.canvases || []);
  const pages = canvases.map((c) => {
    const body = v3 ? c.items?.[0]?.items?.[0]?.body : c.images?.[0]?.resource;
    const svc = [].concat(body?.service || [])[0];
    const service = svc?.id || svc?.['@id'] || null;
    return { label: lang(c.label), width: c.width, height: c.height, service, image: service ? `${service}/full/!1600,1600/0/default.jpg` : body?.id || body?.['@id'] };
  });
  const rights = m.rights || md.rights || md.license || md['rights statement'] || null;
  const homepage = [].concat(m.homepage || [])[0]?.id || md['available online'] || null;
  const first = pages[0] || {};
  return {
    key: `iiif-${(homepage || url).replace(/[^a-z0-9]+/gi, '-').replace(/.*items-/, '').slice(0, 8).toLowerCase()}`,
    source: 'iiif', manifest: url, page: homepage || url,
    title: lang(m.label), description: md.description || lang(m.summary) || '',
    date: md.date || null, creator: md.creator || null, collection: md.collection || null,
    subjects: md.subject ? md.subject.split('; ') : [], locationText: md.location || null, identifier: md.identifier || null,
    license: rights, licenseUrl: /^https?:/.test(rights || '') ? rights : null,
    attribution: lang(m.requiredStatement?.value) || lang(m.attribution) || null,
    image: { full: first.image, medium: first.service ? `${first.service}/full/!800,800/0/default.jpg` : first.image, thumb: first.service ? `${first.service}/full/!400,400/0/default.jpg` : first.image, service: first.service, width: first.width, height: first.height },
    pages,
    fetched: new Date().toISOString().slice(0, 10),
  };
}

// ── run ──
let fetched = 0;
for (const col of config.collections || []) {
  if (!refresh && cache.collections[col.id]) continue;
  if (col.source !== 'flickr-album') throw new Error(`Unknown collection source ${col.source}`);
  console.log(`Album ${col.url}`);
  cache.collections[col.id] = { ...(await flickrAlbum(col.url)), fetched: new Date().toISOString().slice(0, 10) };
  await sleep(800);
}
const wanted = [
  ...(config.items || []).map((i) => ({ source: i.source, url: i.url })),
  ...Object.values(cache.collections).flatMap((c) => c.photos.map((url) => ({ source: 'flickr', url }))),
];
for (const w of wanted) {
  if (!refresh && Object.values(cache.items).some((x) => x.requestedUrl === w.url)) continue;
  process.stdout.write(`  ${w.source} ${w.url} … `);
  const rec = w.source === 'iiif' ? await iiif(w.url) : await flickrPhoto(w.url);
  cache.items[rec.key] = { ...rec, requestedUrl: w.url };
  console.log(rec.title);
  fetched++;
  await sleep(800);
}
// ── Zenodo datasets (subscriber lists → readership) ──
cache.datasets = cache.datasets || {};
for (const ds of config.datasets || []) {
  if (ds.source !== 'zenodo') throw new Error(`Unknown dataset source ${ds.source}`);
  const recId = (ds.url.match(/records\/(\d+)/) || [])[1];
  if (!recId) throw new Error(`Not a Zenodo record URL: ${ds.url}`);
  const key = `zenodo-${recId}`;
  if (refresh || !cache.datasets[key]) {
    console.log(`Zenodo ${recId}`);
    const r = await get(`https://zenodo.org/api/records/${recId}`, 'json');
    const m = r.metadata || {};
    cache.datasets[key] = {
      key, source: 'zenodo', recordId: recId, page: `https://zenodo.org/records/${recId}`,
      doi: r.doi, doiUrl: r.doi ? `https://doi.org/${r.doi}` : null,
      title: m.title, creators: (m.creators || []).map((c) => ({ name: c.name, orcid: c.orcid || null })),
      published: m.publication_date, version: m.version || null, license: m.license?.id || null,
      description: decode((m.description || '').replace(/<[^>]+>/g, ' ')),
      files: (r.files || []).map((f) => ({ key: f.key, size: f.size, checksum: f.checksum, url: f.links?.self || `https://zenodo.org/records/${recId}/files/${f.key}` })),
      requestedUrl: ds.url, fetched: new Date().toISOString().slice(0, 10),
    };
    await sleep(800);
  }
  if (ds.use === 'subscriptions') await deriveReadership(cache.datasets[key], ds);
}

await writeFile(cachePath, JSON.stringify(cache, null, 2) + '\n');
console.log(`Done: ${fetched} item(s) fetched, ${Object.keys(cache.items).length} cached, ${Object.keys(cache.datasets).length} dataset(s).`);

// ── subscriber list → data/readership/{periodical}.json ──
async function deriveReadership(meta, ds) {
  const { mkdir } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const periodical = ds.about.find((a) => a.type === 'periodical')?.id;
  if (!periodical) throw new Error(`${meta.key}: a subscriptions dataset must be "about" a periodical`);
  const file = meta.files.find((f) => /\.csv$/i.test(f.key));
  if (!file) throw new Error(`${meta.key}: no CSV file in the deposit`);
  const cacheDir = new URL(`../.cache/zenodo/${meta.recordId}/`, import.meta.url);
  await mkdir(cacheDir, { recursive: true });
  const local = new URL(file.key, cacheDir);
  let text = existsSync(local) ? await readFile(local, 'utf8') : null;
  const md5 = (s) => 'md5:' + createHash('md5').update(s).digest('hex');
  if (!text || (file.checksum && md5(text) !== file.checksum)) {
    console.log(`  downloading ${file.key} (${Math.round(file.size / 1024)} KB)`);
    const r = await fetch(file.url.replace(/\/content$/, '') + (file.url.endsWith('/content') ? '/content' : '?download=1'), { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`Download failed ${file.url}: ${r.status}`);
    text = await r.text();
    if (file.checksum && md5(text) !== file.checksum) console.warn(`  ! checksum mismatch for ${file.key}`);
    await writeFile(local, text);
  }
  const rows = parseCSV(text);
  const head = rows.shift().map((h) => h.replace(/^﻿/, '').trim());
  const col = (name) => head.indexOf(name);
  const C = Object.fromEntries(['Subscription_UUID', 'Subscriber Name', 'Subscriber name edited', 'Final_Classification', 'Datetime', 'Year', 'Subscriber Location', 'Place_edited', 'State', 'Country',
    'Latitude', 'Longitude', 'Subscription Place Qid', 'GeoNames ID', 'Library of Congress authority ID', 'Subscriber Cost'].map((n) => [n, col(n)]));
  const v = (r, n) => (C[n] >= 0 ? String(r[C[n]] ?? '').trim() : '');
  const clean = (s) => (/^null$/i.test(s) ? '' : s);

  // Group by Wikidata QID, but split a QID that is attached to different place names (data-entry conflicts).
  const namesByQid = new Map();
  for (const r of rows) {
    const q = v(r, 'Subscription Place Qid'), n = v(r, 'Place_edited');
    if (q && n) namesByQid.set(q, new Set([...(namesByQid.get(q) || []), `${n}|${clean(v(r, 'State'))}`]));
  }
  const conflicts = [...namesByQid].filter(([, s]) => new Set([...s].map((x) => x.split('|')[0])).size > 1).map(([q, s]) => ({ qid: q, names: [...s] }));
  const conflictQ = new Set(conflicts.map((c) => c.qid));
  const majority = new Map(conflicts.map((c) => {
    const counts = {};
    for (const r of rows) if (v(r, 'Subscription Place Qid') === c.qid) { const n = v(r, 'Place_edited'); if (n) counts[n] = (counts[n] || 0) + 1; }
    return [c.qid, Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]];
  }));

  const places = new Map();
  const subs = [];
  const TYPES = { Individual: 'I', Business: 'B', Synagogue: 'S', Organization: 'O' };
  let unlocated = 0;
  for (const r of rows) {
    if (!r.length || r.every((x) => !String(x).trim())) continue;
    const lat = parseFloat(v(r, 'Latitude')), lon = parseFloat(v(r, 'Longitude'));
    const qid = v(r, 'Subscription Place Qid');
    const pname = v(r, 'Place_edited') || v(r, 'Subscriber Location');
    const year = Number((v(r, 'Datetime') || '').slice(0, 4)) || Number(v(r, 'Year')) || null;
    const type = TYPES[v(r, 'Final_Classification')] || '';
    let k = null;
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      // A conflicting QID keeps its ID only for its majority name; other names get their own key without the ID.
      const qidOk = qid && (!conflictQ.has(qid) || !v(r, 'Place_edited') || majority.get(qid) === v(r, 'Place_edited'));
      k = qidOk ? qid : `${pname}|${clean(v(r, 'State'))}`.toLowerCase();
      if (!places.has(k)) places.set(k, { k, name: pname, state: clean(v(r, 'State')), country: v(r, 'Country'), qid: qidOk ? qid : null,
        geonames: v(r, 'GeoNames ID') || null, lcnaf: v(r, 'Library of Congress authority ID') || null, lat: +lat.toFixed(4), lon: +lon.toFixed(4), n: 0, y: {}, t: {} });
      const p = places.get(k);
      if (!p.name && pname) p.name = pname;
      if (!p.state && clean(v(r, 'State'))) p.state = clean(v(r, 'State'));
      p.n++; if (year) p.y[year] = (p.y[year] || 0) + 1; if (type) p.t[type] = (p.t[type] || 0) + 1;
    } else unlocated++;
    subs.push([v(r, 'Subscriber name edited') || v(r, 'Subscriber Name'), k, year, type, v(r, 'Subscription_UUID')]);
  }
  const years = subs.map((s) => s[2]).filter(Boolean);
  const outDir = new URL('readership/', DATA);
  await mkdir(outDir, { recursive: true });
  const out = {
    periodical, dataset: meta.key, doi: meta.doi, title: meta.title, total: subs.length, located: subs.length - unlocated, unlocated,
    years: [Math.min(...years), Math.max(...years)], derived: new Date().toISOString().slice(0, 10),
    conflicts, places: [...places.values()].sort((a, b) => b.n - a.n), subs,
  };
  await writeFile(new URL(`${periodical}.json`, outDir), JSON.stringify(out));
  console.log(`  ${periodical}: ${out.total} subscriptions, ${out.places.length} places, ${unlocated} without location, ${conflicts.length} QID conflict(s)`);
}

// RFC 4180 CSV parser (quoted fields may contain commas, quotes and newlines).
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
