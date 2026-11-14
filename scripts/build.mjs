// Kehillot static site + linked-data build. No dependencies; Node 18+.
//
//   node scripts/build.mjs                 # builds into dist/
//   BASE_URL=https://you.github.io/kehillot/ node scripts/build.mjs
//
// 1. Loads the curated source data in data/*.json
// 2. Validates it (references, required fields, value vocabularies) — fails on error
// 3. Emits one HTML page per entity (with embedded JSON-LD) + a .jsonld file
// 4. Emits dataset downloads: JSON-LD, N-Triples, CSV + CSVW, GeoJSON, Linked Places
// 5. Emits DCAT/VoID catalog, a SKOS vocabulary, sitemap and robots.txt

import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const readJSON = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));

const cfg = await readJSON('site.config.json');
const BASE = (process.env.BASE_URL || cfg.baseUrl).replace(/\/?$/, '/');
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const [Y0, Y1] = cfg.yearRange;

const data = {
  place: await readJSON('data/places.json'),
  congregation: await readJSON('data/congregations.json'),
  person: await readJSON('data/people.json'),
  institution: await readJSON('data/organizations.json'),
  periodical: await readJSON('data/periodicals.json'),
  cemetery: await readJSON('data/cemeteries.json'),
  site: await readJSON('data/sites.json'),
  event: await readJSON('data/events.json'),
  source: await readJSON('data/sources.json'),
};
const TILES = JSON.stringify({ relief: cfg.basemap, street: cfg.streetmap });
const LOCATED = ['cemetery', 'site']; // types with their own coordinates inside a city
const population = await readJSON('data/population.json');
const wikidata = existsSync(path.join(ROOT, 'data/wikidata.json')) ? await readJSON('data/wikidata.json') : {};
const mediaConfig = existsSync(path.join(ROOT, 'data/media.json')) ? await readJSON('data/media.json') : { collections: [], items: [] };
const mediaCache = existsSync(path.join(ROOT, 'data/media-cache.json')) ? await readJSON('data/media-cache.json') : { items: {}, collections: {} };
const cityConfig = existsSync(path.join(ROOT, 'data/cities.json')) ? await readJSON('data/cities.json') : {};
const readership = {};
if (existsSync(path.join(ROOT, 'data/readership'))) {
  const { readdir } = await import('node:fs/promises');
  for (const f of await readdir(path.join(ROOT, 'data/readership'))) if (f.endsWith('.json')) readership[f.replace(/\.json$/, '')] = await readJSON(`data/readership/${f}`);
}

// ───────────────────────── controlled vocabularies ─────────────────────────
const VOCAB = {
  rite: {
    label: 'Rite (minhag) at founding',
    concepts: {
      sephardic: ['Sephardic', 'Western Sephardic ("Portuguese") rite of the colonial-era congregations.'],
      ashkenazic: ['Ashkenazic', 'Central and Eastern European rites (German, Polish, Dutch, English).'],
      reform: ['Reform', 'Founded explicitly as a Reform society or congregation.'],
    },
  },
  orientation: {
    label: 'Religious orientation by c. 1870',
    concepts: {
      traditional: ['Traditional', 'Retained the traditional liturgy and practice.'],
      moderate: ['Moderate reform', 'Adopted selected reforms (e.g. sermons, choir, decorum) while keeping much of the traditional liturgy.'],
      reform: ['Reform', 'Adopted a Reform prayer book, mixed seating, organ or similar changes.'],
    },
  },
  certainty: {
    label: 'Certainty of dating',
    concepts: {
      high: ['High', 'Date agrees across the standard secondary sources.'],
      medium: ['Medium', 'Date reported in one source or varies by a few years between sources; verify before citing.'],
      low: ['Low', 'Date is an estimate.'],
    },
  },
  category: {
    label: 'Institution or event category',
    concepts: {
      periodical: ['Periodical', 'Newspapers and journals.'],
      fraternal: ['Fraternal order', 'Lodges and mutual-aid orders.'],
      philanthropy: ['Philanthropy', 'Benevolent societies, orphanages, relief.'],
      education: ['Education', 'Schools, seminaries, educational societies.'],
      hospital: ['Hospital', 'Medical institutions.'],
      communal: ['Communal representation', 'National or civic representative bodies.'],
      civic: ['Civic action', 'Protests, petitions and public appearances.'],
      religious: ['Religious life', 'Conflicts, reforms and conferences.'],
      institutional: ['Institution founding', 'The creation of an institution.'],
      publication: ['Publication', 'Landmark books and prayer books.'],
      migration: ['Migration', 'Arrivals and settlement.'],
      philanthropyEvent: ['Philanthropy', 'Gifts and bequests.'],
      'civil-war': ['Civil War', 'Events of the war years, 1861–1865.'],
      family: ['Family', 'Marriages and other family events.'],
    },
  },
  siteKind: {
    label: 'Kind of site',
    concepts: {
      synagogue: ['Synagogue building', 'A building used for worship by a congregation.'],
      hospital: ['Hospital building', 'A building used by a Jewish hospital.'],
      school: ['School building', 'A building used by a school or educational society.'],
      'meeting-place': ['Meeting place', 'A café, hall or house where an organization met or was founded.'],
      business: ['Business', 'A shop, market or firm.'],
      residence: ['Residence', 'A family home.'],
    },
  },
  precision: {
    label: 'Precision of location',
    concepts: {
      exact: ['Exact', 'The building or grounds survive or the address is documented; the point is on the site.'],
      approximate: ['Approximate', 'Placed on the right street or block from a documented description; may be off by up to a few hundred metres.'],
    },
  },
  frequency: {
    label: 'Publication frequency',
    concepts: { weekly: ['Weekly', 'Published every week.'], monthly: ['Monthly', 'Published every month.'] },
  },
};
const LANGS = { en: 'English', de: 'German', he: 'Hebrew', yi: 'Yiddish', fr: 'French' };
const conceptUri = (scheme, key) => `${BASE}vocab/#${scheme}-${key}`;
const conceptLabel = (scheme, key) => VOCAB[scheme].concepts[key]?.[0] ?? key;

// ───────────────────────── validation ─────────────────────────
const errors = [];
const index = Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, new Map(rows.map((r) => [r.id, r]))]));
const orgLike = (id) => index.congregation.get(id) || index.institution.get(id) || index.periodical.get(id);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

for (const [type, rows] of Object.entries(data)) {
  const seen = new Set();
  for (const r of rows) {
    const at = `${type}/${r.id}`;
    if (!r.id || !ID_RE.test(r.id)) errors.push(`${at}: id must be lower-case kebab-case`);
    if (seen.has(r.id)) errors.push(`${at}: duplicate id`);
    seen.add(r.id);
    if (type !== 'source' && !r.name) errors.push(`${at}: missing name`);
    if (type !== 'source' && r.place && !index.place.has(r.place)) errors.push(`${at}: unknown place "${r.place}"`);
    for (const p of r.places || []) if (!index.place.has(p)) errors.push(`${at}: unknown place "${p}"`);
    for (const p of r.alsoAt || []) if (!index.place.has(p)) errors.push(`${at}: unknown place "${p}"`);
    for (const s of r.sources || []) if (!index.source.has(s)) errors.push(`${at}: unknown source "${s}"`);
    for (const p of r.people || []) if (!index.person.has(p)) errors.push(`${at}: unknown person "${p}"`);
    for (const o of r.orgs || []) if (!orgLike(o)) errors.push(`${at}: unknown organization "${o}"`);
    for (const role of r.roles || []) if (!orgLike(role.org)) errors.push(`${at}: role points to unknown organization "${role.org}"`);
    if (r.splitFrom && !index.congregation.has(r.splitFrom)) errors.push(`${at}: unknown splitFrom "${r.splitFrom}"`);
    if (r.rite && !VOCAB.rite.concepts[r.rite]) errors.push(`${at}: rite "${r.rite}" not in vocabulary`);
    if (r.orientation && !VOCAB.orientation.concepts[r.orientation]) errors.push(`${at}: orientation "${r.orientation}" not in vocabulary`);
    if (r.certainty && !VOCAB.certainty.concepts[r.certainty]) errors.push(`${at}: certainty "${r.certainty}" not in vocabulary`);
    if (r.category && !VOCAB.category.concepts[r.category]) errors.push(`${at}: category "${r.category}" not in vocabulary`);
    if (['congregation', 'institution', 'periodical', 'cemetery', 'site', 'event'].includes(type) && !r.place) errors.push(`${at}: missing place`);
    if (!['place', 'source'].includes(type) && !(r.sources || []).length) errors.push(`${at}: at least one source is required`);
    if (['place', ...LOCATED].includes(type) && (typeof r.lat !== 'number' || typeof r.lon !== 'number')) errors.push(`${at}: lat/lon required`);
    if (LOCATED.includes(type)) {
      if (!VOCAB.precision.concepts[r.precision]) errors.push(`${at}: precision must be one of ${Object.keys(VOCAB.precision.concepts).join(', ')}`);
      const city = index.place.get(r.place);
      if (city && Math.hypot(city.lat - r.lat, city.lon - r.lon) > 0.35) errors.push(`${at}: coordinates are more than ~35 km from ${city.name}; check lat/lon`);
    }
    for (const o of r.owners || []) if (!index.congregation.has(o)) errors.push(`${at}: unknown owner congregation "${o}"`);
    for (const occ of r.occupants || []) if (!orgLike(occ.org)) errors.push(`${at}: unknown occupant "${occ.org}"`);
    if (r.site && !index.site.has(r.site)) errors.push(`${at}: unknown site "${r.site}"`);
    if (r.kind && !VOCAB.siteKind.concepts[r.kind]) errors.push(`${at}: kind "${r.kind}" not in vocabulary`);
    if (r.frequency && !VOCAB.frequency.concepts[r.frequency]) errors.push(`${at}: frequency "${r.frequency}" not in vocabulary`);
    for (const l of r.language || []) if (!LANGS[l]) errors.push(`${at}: language "${l}" unknown`);
    if (type === 'person' && r.born && r.died && r.born > r.died) errors.push(`${at}: born after died`);
    if (r.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(r.date)) errors.push(`${at}: date must be YYYY, YYYY-MM or YYYY-MM-DD`);
  }
}
for (const [type, map] of Object.entries(wikidata)) {
  for (const [id, qid] of Object.entries(map)) {
    if (!index[type]?.has(id)) errors.push(`wikidata.json: ${type}/${id} does not exist`);
    if (!/^Q\d+$/.test(qid)) errors.push(`wikidata.json: ${type}/${id} has malformed QID "${qid}"`);
  }
}
if (errors.length) {
  console.error(`✗ ${errors.length} validation error(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}

// ───────────────────────── derived relationships ─────────────────────────
const by = (rows, key) => {
  const m = new Map();
  for (const r of rows) for (const k of [].concat(r[key] ?? [])) m.set(k, [...(m.get(k) || []), r]);
  return m;
};
const congByPlace = by(data.congregation, 'place');
const instByPlace = by(data.institution, 'place');
const eventByPlace = by(data.event, 'place');
const eventAlsoByPlace = by(data.event, 'alsoAt');
const peopleByPlace = by(data.person, 'places');
const eventsByPerson = by(data.event, 'people');
const eventsByOrg = by(data.event, 'orgs');
const splits = by(data.congregation, 'splitFrom');
const perByPlace = by(data.periodical, 'place');
const cemByPlace = by(data.cemetery, 'place');
const siteByPlace = by(data.site, 'place');
const cemByOwner = by(data.cemetery, 'owners');
const eventsBySite = by(data.event, 'site');
const sitesByOrg = new Map();
for (const s of data.site) for (const o of s.occupants || []) sitesByOrg.set(o.org, [...(sitesByOrg.get(o.org) || []), { site: s, ...o }]);
const rolesByOrg = new Map();
for (const p of data.person) for (const r of p.roles) rolesByOrg.set(r.org, [...(rolesByOrg.get(r.org) || []), { person: p, ...r }]);
const citedBy = new Map();
for (const t of ['congregation', 'institution', 'periodical', 'cemetery', 'site', 'event', 'person'])
  for (const r of data[t]) for (const s of r.sources) citedBy.set(s, [...(citedBy.get(s) || []), { type: t, r }]);

const yearOf = (d) => Number(String(d).slice(0, 4));
const activeIn = (c, y) => c.founded <= y && !(c.dissolved && c.dissolved <= y);
const dormantIn = (c, y) => !!c.dormant && y >= c.dormant[0] && y < c.dormant[1];

// ───────────────────────── URIs ─────────────────────────
const TYPE_INFO = {
  place: { path: 'place', label: 'Place', plural: 'Places' },
  congregation: { path: 'congregation', label: 'Congregation', plural: 'Congregations' },
  person: { path: 'person', label: 'Person', plural: 'People' },
  institution: { path: 'institution', label: 'Institution', plural: 'Institutions' },
  periodical: { path: 'periodical', label: 'Periodical', plural: 'Periodicals' },
  cemetery: { path: 'cemetery', label: 'Cemetery', plural: 'Cemeteries' },
  site: { path: 'site', label: 'Site', plural: 'Sites within cities' },
  event: { path: 'event', label: 'Event', plural: 'Events' },
  source: { path: 'source', label: 'Source', plural: 'Sources' },
  media: { path: 'media', label: 'Picture or document', plural: 'Pictures and documents' },
};
const typeOfOrg = (id) => (index.congregation.has(id) ? 'congregation' : index.periodical.has(id) ? 'periodical' : 'institution');
const docPath = (type, id) => `${TYPE_INFO[type].path}/${id}/`;
const docUri = (type, id) => BASE + docPath(type, id);
const uri = (type, id) => docUri(type, id) + '#this'; // hash URI: the thing, not the page
const wd = (type, id) => (wikidata[type]?.[id] ? `http://www.wikidata.org/entity/${wikidata[type][id]}` : null);

// ───────────────────────── media (linked pictures and documents) ─────────────────────────
// media.json says what to link and what each item is about; media-cache.json (written by
// scripts/fetch-media.mjs) holds the holder's metadata. Images stay on the holder's server.
const placeOfRecord = (type, id) => {
  const r = index[type]?.get(id);
  if (!r) return [];
  if (type === 'place') return [id];
  if (type === 'person') return r.places;
  return r.place ? [r.place] : [];
};
const nearestPlace = (lat, lon) => {
  let best = null, bestD = 0.35;
  for (const p of data.place) { const d = Math.hypot(p.lat - lat, p.lon - lon); if (d < bestD) { best = p.id; bestD = d; } }
  return best;
};
const MEDIA = [];
{
  const mErrors = [];
  for (const [key, m] of Object.entries(mediaCache.items || {})) {
    const col = (mediaConfig.collections || []).find((c) => (mediaCache.collections?.[c.id]?.photos || []).includes(m.requestedUrl));
    const own = (mediaConfig.items || []).find((i) => i.url === m.requestedUrl);
    if (!col && !own) continue; // no longer listed in media.json
    const about = [...(col?.about || []), ...(own?.about || [])].filter((a, i, all) => all.findIndex((b) => b.type === a.type && b.id === a.id) === i);
    for (const a of about) if (!index[a.type]?.has(a.id)) mErrors.push(`media ${key}: about points to unknown ${a.type}/${a.id}`);
    if (!m.license) mErrors.push(`media ${key}: no license or rights statement`);
    const untitled = /\.(tiff?|jpe?g|png)$/i.test(m.title || '');
    const geoPlace = m.geo ? nearestPlace(m.geo.lat, m.geo.lon) : null;
    const nonPerson = about.filter((a) => a.type !== 'person').flatMap((a) => placeOfRecord(a.type, a.id));
    const places = geoPlace ? [geoPlace] : nonPerson.length ? [...new Set(nonPerson)] : [...new Set(about.flatMap((a) => placeOfRecord(a.type, a.id)))];
    const colMeta = col ? mediaCache.collections[col.id] : null;
    MEDIA.push({
      ...m, id: key,
      title: untitled ? col?.untitled || 'Untitled item' : m.title,
      identifier: untitled ? m.title.replace(/\.\w+$/, '') : (m.description.match(/\[([^\]]+)\]\s*$/) || [])[1] || m.identifier || null,
      description: (m.description || '').replace(/\s*\[[^\]]+\]\s*$/, ''),
      about, places, feature: !!own?.feature,
      holder: own?.holder || col?.holder || m.creator, holderUrl: own?.holderUrl || col?.holderUrl || m.creatorUrl,
      collection: col ? { id: col.id, title: colMeta.title, url: col.url, description: colMeta.description, identifier: col.identifier } : null,
      dateNote: col?.dateNote || null,
      licenseLabel: /rightsstatements\.org\/vocab\/NoC-US/.test(m.license) ? 'No Copyright – United States' : /rightsstatements\.org\/vocab\/InC/.test(m.license) ? 'In Copyright' : m.license,
    });
  }
  if (mErrors.length) { console.error(`✗ ${mErrors.length} media error(s):\n  ` + mErrors.join('\n  ')); process.exit(1); }
  MEDIA.sort((a, b) => Number(b.feature) - Number(a.feature) || (a.collection?.id || '').localeCompare(b.collection?.id || '') || a.id.localeCompare(b.id));
}
const mediaByRecord = new Map();
const mediaByPlace = new Map();
for (const m of MEDIA) {
  for (const a of m.about) mediaByRecord.set(`${a.type}/${a.id}`, [...(mediaByRecord.get(`${a.type}/${a.id}`) || []), m]);
  for (const p of m.places) mediaByPlace.set(p, [...(mediaByPlace.get(p) || []), m]);
}

// ───────────────────────── readership (subscriber lists from deposited datasets) ─────────────────────────
// data/readership/{periodical}.json is derived by scripts/fetch-media.mjs from subscriber lists
// deposited on Zenodo; places are joined to Kehillot places through their Wikidata QIDs.
const PAPER_ORDER = ['occident', 'israelite', 'jewish-messenger', 'weekly-gleaner'];
const PAPER_TINT = { occident: 'var(--paper-occident)', israelite: 'var(--paper-israelite)', 'jewish-messenger': 'var(--paper-messenger)', 'weekly-gleaner': 'var(--paper-gleaner)' };
const DATASETS = Object.values(mediaCache.datasets || {}).map((d) => {
  const cfgD = (mediaConfig.datasets || []).find((x) => x.url === d.requestedUrl) || {};
  return { ...d, about: cfgD.about || [], use: cfgD.use || null };
}).filter((d) => d.about.length);
for (const d of DATASETS) for (const a of d.about) if (!index[a.type]?.has(a.id)) { console.error(`✗ dataset ${d.key}: about points to unknown ${a.type}/${a.id}`); process.exit(1); }
const READERS = Object.fromEntries(Object.entries(readership).filter(([p]) => index.periodical.has(p)).sort((a, b) => PAPER_ORDER.indexOf(a[0]) - PAPER_ORDER.indexOf(b[0])));
const datasetFor = (paper) => DATASETS.find((d) => d.key === READERS[paper]?.dataset);
const qidOfPlace = (placeId) => wikidata.place?.[placeId] || null;
const placeIdByQid = new Map(Object.entries(wikidata.place || {}).map(([id, q]) => [q, id]));
function readersFor(placeId) {
  const q = qidOfPlace(placeId);
  if (!q) return [];
  return Object.entries(READERS).map(([paper, R]) => {
    const pl = R.places.find((x) => x.qid === q);
    if (!pl) return null;
    const ys = Object.keys(pl.y).map(Number);
    return { paper, R, place: pl, n: pl.n, from: ys.length ? Math.min(...ys) : null, to: ys.length ? Math.max(...ys) : null,
      subs: R.subs.filter((s) => s[1] === pl.k) };
  }).filter(Boolean);
}
const READ_TOTAL = Object.values(READERS).reduce((a, R) => a + R.total, 0);
const dsCitation = (d) => `${d.creators.map((c) => esc(c.name)).join('; ')} (${esc(String(d.published).slice(0, 4))}). <cite>${esc(d.title)}</cite> [Data set]. Zenodo. <a href="${esc(d.doiUrl)}">${esc(d.doiUrl)}</a>`;
function datasetNode(d) {
  return strip({ '@id': d.doiUrl || d.page, '@type': 'schema:Dataset', name: d.title, author: d.creators.map((c) => c.name).join('; '),
    published: { '@value': d.published, '@type': 'xsd:date' }, license: d.license ? `https://creativecommons.org/licenses/${d.license.replace(/^cc-/, '').replace(/-(\d)/, '/$1')}/` : undefined,
    identifier: d.doi, url: d.page, about: d.about.map((a) => uri(a.type, a.id)) });
}
const TYPE_LABEL = { I: 'individual', B: 'business', S: 'synagogue', O: 'organization' };
function readersSection(rel, placeId, { names = false } = {}) {
  const rs = readersFor(placeId);
  if (!rs.length) return '';
  const p = index.place.get(placeId);
  return `<section class="readers" aria-labelledby="h-readers"><h2 id="h-readers">Subscribers in ${esc(p.name)}</h2>
  <p class="section-note">Subscriptions recorded in the papers' own subscriber lists, joined to ${esc(p.name)} by its Wikidata identifier (${esc(qidOfPlace(placeId))}).</p>
  <ul class="readers-list">${rs.map((x) => `<li><span class="paper-swatch" style="background:${PAPER_TINT[x.paper]}" aria-hidden="true"></span>
    <i>${link(rel, 'periodical', x.paper, nameOf('periodical', x.paper))}</i>: <strong>${x.n.toLocaleString('en-US')}</strong> subscription${x.n === 1 ? '' : 's'}${x.from ? ` <span class="muted">${x.from === x.to ? x.from : `${x.from}–${x.to}`}</span>` : ''}
    ${names ? `<details class="subs"><summary>List the subscribers</summary><ol class="subs-list">${x.subs.slice().sort((a, b) => (a[2] || 0) - (b[2] || 0) || String(a[0]).localeCompare(String(b[0]))).map((s) => `<li>${esc(s[0] || 'Unnamed')} <span class="muted">${s[2] || ''}${s[3] && s[3] !== 'I' ? ` · ${TYPE_LABEL[s[3]]}` : ''}</span></li>`).join('')}</ol></details>` : ''}</li>`).join('')}</ul>
  <p class="small"><a href="${rel}subscribers/#place=${encodeURIComponent(qidOfPlace(placeId))}">See ${esc(p.name)} on the subscriber map →</a></p></section>`;
}
function periodicalReadership(rel, paper) {
  const R = READERS[paper];
  if (!R) return '';
  const d = datasetFor(paper);
  const us = R.places.filter((x) => /United States/.test(x.country || '') || !x.country);
  const abroad = R.places.filter((x) => x.country && !/United States/.test(x.country));
  const states = new Set(us.map((x) => x.state).filter(Boolean));
  const byYear = {};
  for (const s of R.subs) if (s[2]) byYear[s[2]] = (byYear[s[2]] || 0) + 1;
  const ys = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  const maxY = Math.max(...Object.values(byYear));
  const bars = ys.length ? `<figure class="spark"><svg viewBox="0 0 ${ys.length * 14} 60" role="img" aria-labelledby="sp-t-${paper}"><title id="sp-t-${paper}">Subscriptions recorded per year, ${ys[0]}–${ys.at(-1)}</title>${ys.map((y, i) => `<rect x="${i * 14 + 2}" y="${60 - (byYear[y] / maxY) * 56}" width="10" height="${(byYear[y] / maxY) * 56}" class="spark-bar" style="fill:${PAPER_TINT[paper]}"><title>${y}: ${byYear[y]}</title></rect>`).join('')}</svg>
    <figcaption><span>${ys[0]}</span><span>Subscriptions recorded per year</span><span>${ys.at(-1)}</span></figcaption></figure>` : '';
  return `<section class="readers" aria-labelledby="h-read-${paper}"><h2 id="h-read-${paper}">Subscribers</h2>
  <p class="lede">${R.total.toLocaleString('en-US')} subscriptions recorded between ${R.years[0]} and ${R.years[1]}, in ${R.places.length.toLocaleString('en-US')} places across ${states.size} states and territories${abroad.length ? ` and ${abroad.length} places abroad` : ''}.</p>
  ${bars}
  <table class="mini readers-top"><caption>Where subscribers lived (top 12)</caption><thead><tr><th scope="col">Place</th><th scope="col">Subscriptions</th></tr></thead><tbody>${R.places.slice(0, 12).map((x) => {
    const own = x.qid && placeIdByQid.get(x.qid);
    return `<tr><th scope="row">${own ? link(rel, 'place', own, `${x.name}${x.state ? `, ${x.state}` : ''}`) : esc(`${x.name}${x.state ? `, ${x.state}` : ''}`)}</th><td>${x.n.toLocaleString('en-US')}</td></tr>`;
  }).join('')}</tbody></table>
  <p><a class="btn btn-small" href="${rel}subscribers/#papers=${paper}">Map this paper's subscribers →</a></p>
  ${d ? `<p class="small">Source: ${dsCitation(d)}. ${R.unlocated ? `${R.unlocated.toLocaleString('en-US')} subscriptions have no recorded place and are not mapped.` : ''}</p>` : ''}</section>`;
}

const CITY_IDS = data.place.filter((p) => (siteByPlace.get(p.id) || []).length || (cemByPlace.get(p.id) || []).length || (mediaByPlace.get(p.id) || []).length).map((p) => p.id);

const sourceName = (m) => (m.source === 'iiif' ? (m.holder || 'the holder') : 'Flickr');
const rightsLink = (m) => (m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" rel="license">${esc(m.licenseLabel)}</a>` : esc(m.licenseLabel));
const thumbFig = (m, rel, cls = '') => `<li class="thumb ${cls}"><a href="${rel}media/${m.id}/"><img src="${esc(m.image.thumb)}" alt="${esc(m.title)}" loading="lazy" decoding="async"${m.image.width && m.image.height ? ` width="${Math.min(320, m.image.width)}" height="${Math.round(Math.min(320, m.image.width) * m.image.height / m.image.width)}"` : ''}><span class="thumb-cap">${esc(m.title)}${m.date ? ` <span class="muted">${esc(String(m.date).slice(0, 4))}</span>` : ''}</span></a></li>`;
function gallery(rel, items, { heading = 'Pictures and documents', limit = 24, more = '' } = {}) {
  if (!items.length) return '';
  const holders = [...new Set(items.map((m) => m.holder))];
  return `<section class="gallery" aria-labelledby="h-gal-${items[0].id}"><h2 id="h-gal-${items[0].id}">${heading} <span class="muted">(${items.length})</span></h2>
  <ul class="thumbs">${items.slice(0, limit).map((m) => thumbFig(m, rel)).join('')}</ul>
  ${items.length > limit ? `<p class="small">${items.length - limit} more ${more}</p>` : ''}
  <p class="credit-note">Images courtesy of ${holders.map(esc).join(' and ')}. Each is shown from its holder's server and keeps its own license, which this site's CC BY license does not cover.</p></section>`;
}


// ───────────────────────── JSON-LD ─────────────────────────
const XSD = 'http://www.w3.org/2001/XMLSchema#';
const CONTEXT = {
  '@version': 1.1,
  schema: 'https://schema.org/',
  kh: `${BASE}vocab/#`,
  xsd: XSD,
  skos: 'http://www.w3.org/2004/02/skos/core#',
  dcterms: 'http://purl.org/dc/terms/',
  dcat: 'http://www.w3.org/ns/dcat#',
  void: 'http://rdfs.org/ns/void#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  name: 'schema:name',
  alternateName: 'schema:alternateName',
  description: 'schema:description',
  disambiguatingDescription: 'schema:disambiguatingDescription',
  address: 'schema:address',
  addressLocality: 'schema:addressLocality',
  addressRegion: 'schema:addressRegion',
  addressCountry: 'schema:addressCountry',
  geo: 'schema:geo',
  latitude: { '@id': 'schema:latitude', '@type': 'xsd:decimal' },
  longitude: { '@id': 'schema:longitude', '@type': 'xsd:decimal' },
  location: { '@id': 'schema:location', '@type': '@id' },
  foundingDate: { '@id': 'schema:foundingDate', '@type': 'xsd:gYear' },
  dissolutionDate: { '@id': 'schema:dissolutionDate', '@type': 'xsd:gYear' },
  birthDate: { '@id': 'schema:birthDate', '@type': 'xsd:gYear' },
  deathDate: { '@id': 'schema:deathDate', '@type': 'xsd:gYear' },
  startDate: { '@id': 'schema:startDate' },
  endDate: { '@id': 'schema:endDate' },
  homeLocation: { '@id': 'schema:homeLocation', '@type': '@id', '@container': '@set' },
  memberOf: { '@id': 'schema:memberOf' },
  roleName: 'schema:roleName',
  citation: { '@id': 'schema:citation', '@type': '@id', '@container': '@set' },
  sameAs: { '@id': 'schema:sameAs', '@type': '@id' },
  mainEntityOfPage: { '@id': 'schema:mainEntityOfPage', '@type': '@id' },
  author: 'schema:author',
  publisher: 'schema:publisher',
  datePublished: { '@id': 'schema:datePublished', '@type': 'xsd:gYear' },
  url: { '@id': 'schema:url', '@type': '@id' },
  additionalType: { '@id': 'schema:additionalType', '@type': '@id' },
  rite: { '@id': 'kh:rite', '@type': '@id' },
  orientation: { '@id': 'kh:orientation', '@type': '@id' },
  certainty: { '@id': 'kh:certainty', '@type': '@id' },
  splitFrom: { '@id': 'kh:splitFrom', '@type': '@id' },
  dormantFrom: { '@id': 'kh:dormantFrom', '@type': 'xsd:gYear' },
  dormantUntil: { '@id': 'kh:dormantUntil', '@type': 'xsd:gYear' },
  translation: { '@id': 'kh:nameTranslation', '@language': 'en' },
  birthPlaceLabel: 'kh:birthPlaceLabel',
  occupation: { '@id': 'kh:occupation', '@container': '@set' },
  involves: { '@id': 'kh:involves', '@type': '@id', '@container': '@set' },
  alsoAt: { '@id': 'kh:alsoAt', '@type': '@id', '@container': '@set' },
  containedInPlace: { '@id': 'schema:containedInPlace', '@type': '@id' },
  locationCreated: { '@id': 'schema:locationCreated', '@type': '@id' },
  inLanguage: { '@id': 'schema:inLanguage', '@container': '@set' },
  streetAddress: 'schema:streetAddress',
  frequency: { '@id': 'kh:frequency', '@type': '@id' },
  established: { '@id': 'kh:established', '@type': 'xsd:gYear' },
  closed: { '@id': 'kh:closed', '@type': 'xsd:gYear' },
  built: { '@id': 'kh:built', '@type': 'xsd:gYear' },
  maintainedBy: { '@id': 'kh:maintainedBy', '@type': '@id', '@container': '@set' },
  occupancy: { '@id': 'kh:occupancy', '@container': '@set' },
  occupant: { '@id': 'kh:occupant', '@type': '@id' },
  precision: { '@id': 'kh:locationPrecision', '@type': '@id' },
  atSite: { '@id': 'kh:atSite', '@type': '@id' },
  subjectOf: { '@id': 'schema:subjectOf', '@type': '@id', '@container': '@set' },
  published: { '@id': 'schema:datePublished' },
  contentUrl: { '@id': 'schema:contentUrl', '@type': '@id' },
  thumbnailUrl: { '@id': 'schema:thumbnailUrl', '@type': '@id' },
  license: { '@id': 'schema:license', '@type': '@id' },
  creditText: 'schema:creditText',
  identifier: 'schema:identifier',
  about: { '@id': 'schema:about', '@type': '@id', '@container': '@set' },
  isPartOf: { '@id': 'schema:isPartOf', '@type': '@id' },
  contentLocation: 'schema:contentLocation',
  holderDate: 'kh:holderDate',
  iiifManifest: { '@id': 'kh:iiifManifest', '@type': '@id' },
  iiifService: { '@id': 'kh:iiifImageService', '@type': '@id' },
};
const dateValue = (d) => {
  const s = String(d);
  const t = s.length === 4 ? 'xsd:gYear' : s.length === 7 ? 'xsd:gYearMonth' : 'xsd:date';
  return { '@value': s, '@type': t };
};
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

const INST_TYPES = { periodical: 'schema:Periodical', education: 'schema:EducationalOrganization', hospital: 'schema:Hospital' };

function node(type, r) {
  const base = { '@id': uri(type, r.id), mainEntityOfPage: docUri(type, r.id), sameAs: wd(type, r.id) || undefined };
  switch (type) {
    case 'place':
      return strip({ ...base, '@type': ['schema:City'], name: r.name,
        address: { '@type': 'schema:PostalAddress', addressLocality: r.name, addressRegion: r.state, addressCountry: 'US' },
        geo: { '@type': 'schema:GeoCoordinates', latitude: String(r.lat), longitude: String(r.lon) },
        additionalType: undefined, disambiguatingDescription: `${r.region} region` });
    case 'congregation':
      return strip({ ...base, '@type': ['schema:Organization', 'kh:Congregation'], name: r.name, translation: r.translation,
        description: r.note, location: uri('place', r.place), foundingDate: String(r.founded),
        dissolutionDate: r.dissolved ? String(r.dissolved) : undefined,
        dormantFrom: r.dormant ? String(r.dormant[0]) : undefined, dormantUntil: r.dormant ? String(r.dormant[1]) : undefined,
        rite: conceptUri('rite', r.rite), orientation: conceptUri('orientation', r.orientation), certainty: conceptUri('certainty', r.certainty),
        splitFrom: r.splitFrom ? uri('congregation', r.splitFrom) : undefined,
        citation: r.sources.map((s) => uri('source', s)) });
    case 'institution':
      return strip({ ...base, '@type': [INST_TYPES[r.category] || 'schema:NGO'], name: r.name, description: r.description,
        location: uri('place', r.place), foundingDate: String(r.founded), dissolutionDate: r.dissolved ? String(r.dissolved) : undefined,
        additionalType: conceptUri('category', r.category), certainty: conceptUri('certainty', r.certainty),
        citation: r.sources.map((s) => uri('source', s)) });
    case 'periodical':
      return strip({ ...base, '@type': 'schema:Periodical', name: r.name, description: r.description,
        locationCreated: uri('place', r.place), startDate: dateValue(r.founded), endDate: r.ceased ? dateValue(r.ceased) : undefined,
        inLanguage: r.language, frequency: conceptUri('frequency', r.frequency), orientation: conceptUri('orientation', r.orientation),
        certainty: conceptUri('certainty', r.certainty), citation: r.sources.map((s) => uri('source', s)),
        subjectOf: DATASETS.filter((d) => d.about.some((a) => a.type === 'periodical' && a.id === r.id)).map((d) => d.doiUrl || d.page) });
    case 'cemetery':
      return strip({ ...base, '@type': 'schema:Cemetery', name: r.name, description: r.note,
        containedInPlace: uri('place', r.place),
        address: { '@type': 'schema:PostalAddress', streetAddress: r.address, addressLocality: index.place.get(r.place).name, addressRegion: index.place.get(r.place).state, addressCountry: 'US' },
        geo: { '@type': 'schema:GeoCoordinates', latitude: String(r.lat), longitude: String(r.lon) }, precision: conceptUri('precision', r.precision),
        established: String(r.established), closed: r.closed ? String(r.closed) : undefined,
        maintainedBy: (r.owners || []).map((o) => uri('congregation', o)),
        certainty: conceptUri('certainty', r.certainty), citation: r.sources.map((s) => uri('source', s)) });
    case 'site':
      return strip({ ...base, '@type': r.kind === 'synagogue' ? 'schema:Synagogue' : r.kind === 'hospital' ? 'schema:Hospital' : 'schema:Place', name: r.name, description: r.note,
        additionalType: conceptUri('siteKind', r.kind), containedInPlace: uri('place', r.place),
        address: { '@type': 'schema:PostalAddress', streetAddress: r.address, addressLocality: index.place.get(r.place).name, addressRegion: index.place.get(r.place).state, addressCountry: 'US' },
        geo: { '@type': 'schema:GeoCoordinates', latitude: String(r.lat), longitude: String(r.lon) }, precision: conceptUri('precision', r.precision),
        built: r.built ? String(r.built) : undefined,
        occupancy: (r.occupants || []).map((o) => strip({ '@type': 'kh:Occupancy', occupant: uri(typeOfOrg(o.org), o.org),
          startDate: o.from ? dateValue(o.from) : undefined, endDate: o.to ? dateValue(o.to) : undefined })),
        certainty: conceptUri('certainty', r.certainty), citation: r.sources.map((s) => uri('source', s)) });
    case 'person':
      return strip({ ...base, '@type': 'schema:Person', name: r.name, description: r.description,
        birthDate: r.born ? String(r.born) : undefined, deathDate: r.died ? String(r.died) : undefined, birthPlaceLabel: r.birthPlace, occupation: r.occupation,
        homeLocation: r.places.map((p) => uri('place', p)),
        memberOf: r.roles.map((role) => strip({ '@type': 'schema:Role', roleName: role.role,
          startDate: role.start ? dateValue(role.start) : undefined, endDate: role.end ? dateValue(role.end) : undefined,
          memberOf: { '@id': uri(typeOfOrg(role.org), role.org) } })),
        citation: r.sources.map((s) => uri('source', s)) });
    case 'event':
      return strip({ ...base, '@type': 'schema:Event', name: r.name, description: r.description, startDate: dateValue(r.date),
        location: uri('place', r.place), atSite: r.site ? uri('site', r.site) : undefined, alsoAt: (r.alsoAt || []).map((p) => uri('place', p)),
        additionalType: conceptUri('category', r.category), certainty: conceptUri('certainty', r.certainty),
        involves: [...(r.people || []).map((p) => uri('person', p)), ...(r.orgs || []).map((o) => uri(typeOfOrg(o), o))],
        citation: r.sources.map((s) => uri('source', s)) });
    case 'source':
      return strip({ ...base, '@type': `schema:${r.type === 'WebSite' ? 'WebSite' : r.type === 'Periodical' ? 'Periodical' : r.type === 'Dataset' ? 'Dataset' : r.type === 'Collection' ? 'Collection' : 'Book'}`,
        name: r.title, author: r.author, publisher: r.publisher, datePublished: r.year ? String(r.year) : undefined,
        url: r.url, description: r.note });
  }
}
const graph = [...Object.entries(data).flatMap(([t, rows]) => rows.map((r) => node(t, r))), ...MEDIA.map(mediaNode), ...DATASETS.map(datasetNode)];

// ───────────── N-Triples (minimal JSON-LD → RDF for our own context) ─────────────
function expandTerm(t) {
  if (/^https?:\/\//.test(t)) return t;
  const [pfx, local] = t.split(':');
  const ns = typeof CONTEXT[pfx] === 'string' ? CONTEXT[pfx] : null;
  if (ns && local !== undefined) return ns + local;
  throw new Error(`Cannot expand term ${t}`);
}
const ntEsc = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
let bnodeCount = 0;
function toTriples(n, out) {
  const subj = n['@id'] ? `<${n['@id']}>` : `_:b${++bnodeCount}`;
  for (const [k, v] of Object.entries(n)) {
    if (k === '@id') continue;
    if (k === '@type') {
      for (const t of [].concat(v)) out.push(`${subj} <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <${expandTerm(t)}> .`);
      continue;
    }
    const def = CONTEXT[k];
    const pred = expandTerm(typeof def === 'string' ? def : def['@id']);
    for (const val of [].concat(v)) {
      if (val && typeof val === 'object' && '@value' in val) {
        out.push(`${subj} <${pred}> "${ntEsc(val['@value'])}"^^<${expandTerm(val['@type'])}> .`);
      } else if (val && typeof val === 'object') {
        if (val['@id'] && Object.keys(val).length === 1) out.push(`${subj} <${pred}> <${val['@id']}> .`);
        else { const o = toTriples(val, out); out.push(`${subj} <${pred}> ${o} .`); }
      } else if (def?.['@type'] === '@id') {
        out.push(`${subj} <${pred}> <${val}> .`);
      } else if (def?.['@type']) {
        out.push(`${subj} <${pred}> "${ntEsc(String(val))}"^^<${expandTerm(def['@type'])}> .`);
      } else if (def?.['@language']) {
        out.push(`${subj} <${pred}> "${ntEsc(String(val))}"@${def['@language']} .`);
      } else {
        out.push(`${subj} <${pred}> "${ntEsc(String(val))}" .`);
      }
    }
  }
  return subj;
}

// ───────────────────────── HTML helpers ─────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsonForScript = (o) => JSON.stringify(o, null, 2).replace(/</g, '\\u003c');
const NAV = [
  ['', 'Home'], ['atlas/', 'Atlas'], ['cities/', 'Cities'], ['subscribers/', 'Subscribers'], ['database/', 'Database'], ['browse/', 'Browse'], ['datasets/', 'Datasets'], ['about/', 'About'],
];
function layout({ rel, title, description, canonical, body, jsonld, scripts = [], styles = [], current = '', alternate }) {
  const fullTitle = title ? `${title} · ${cfg.title}` : `${cfg.title}: ${cfg.subtitle}`;
  return `<!doctype html>
<html lang="${cfg.language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
${alternate ? `<link rel="alternate" type="application/ld+json" href="${esc(alternate)}">` : ''}
<meta property="og:title" content="${esc(fullTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<meta name="color-scheme" content="light dark">
<link rel="icon" href="${rel}assets/img/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${rel}assets/css/site.css">
${styles.map((s) => `<link rel="stylesheet" href="${rel}${s}">`).join('\n')}
${jsonld ? `<script type="application/ld+json">\n${jsonForScript(jsonld)}\n</script>` : ''}
</head>
<body data-root="${rel}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${rel}"><span class="brand-mark" aria-hidden="true">ק</span><span><strong>${esc(cfg.title)}</strong><small>${esc(cfg.subtitle)}</small></span></a>
    <nav aria-label="Primary"><ul>
      ${NAV.map(([href, label]) => `<li><a href="${rel}${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}
    </ul></nav>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p><strong>${esc(cfg.title)}</strong> v${esc(cfg.version)} · Data released under <a href="${cfg.license.url}" rel="license">${esc(cfg.license.name)}</a> · Built ${BUILD_DATE}</p>
    <p><a href="${rel}datasets/">Download the data</a> · <a href="${rel}vocab/">Vocabulary</a> · <a href="${rel}about/#cite">How to cite</a></p>
  </div>
</footer>
${scripts.map((s) => `<script src="${rel}${s}" defer></script>`).join('\n')}
</body>
</html>
`;
}
const link = (rel, type, id, label) => `<a href="${rel}${docPath(type, id)}">${esc(label)}</a>`;
const nameOf = (type, id) => (type === 'source' ? index.source.get(id).title : index[type].get(id).name);
const placeLabel = (id) => { const p = index.place.get(id); return `${p.name}, ${p.state}`; };
const badge = (scheme, key) => `<span class="badge badge-${scheme}-${esc(key)}" title="${esc(VOCAB[scheme].label)}">${esc(conceptLabel(scheme, key))}</span>`;
const formatDate = (d) => {
  const s = String(d); const [y, m, day] = s.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return day ? `${Number(day)} ${months[m - 1]} ${y}` : m ? `${months[m - 1]} ${y}` : y;
};
const citationText = (s) => `${s.author}, <cite>${esc(s.title)}</cite>${s.place || s.publisher ? ` (${[s.place, s.publisher].filter(Boolean).map(esc).join(': ')}${s.year ? `, ${s.year}` : ''})` : ''}`;
function sourcesSection(rel, ids) {
  return `<section aria-labelledby="h-sources"><h2 id="h-sources">Sources</h2><ol class="sources">${ids
    .map((id) => `<li>${citationText(index.source.get(id))} — <a href="${rel}${docPath('source', id)}">record</a></li>`).join('')}</ol></section>`;
}
function citeBox(type, r) {
  const label = TYPE_INFO[type].label;
  return `<section class="cite" aria-labelledby="h-cite"><h2 id="h-cite">Cite this record</h2>
  <p class="cite-text">“${esc(type === 'source' ? r.title : r.name).replace(/&amp;/g, '&amp;')}.” ${label} record in <cite>${esc(cfg.title)}: ${esc(cfg.subtitle)}</cite>, version ${cfg.version}. <span class="uri">${esc(uri(type, r.id))}</span> (accessed ${BUILD_DATE}).</p>
  <p class="data-links">Machine-readable: <a href="index.jsonld" type="application/ld+json">JSON-LD</a>${wd(type, r.id) ? ` · Same as <a href="https://www.wikidata.org/wiki/${wikidata[type][r.id]}">Wikidata ${wikidata[type][r.id]}</a>` : ''}</p></section>`;
}
const dl = (rows) => `<dl class="facts">${rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const ul = (items, empty = '') => (items.length ? `<ul class="related">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : empty);
const mapKey = (pts) => {
  const kinds = new Set(pts.map((p) => p.kind));
  const bits = [];
  if (kinds.has('synagogue')) bits.push('<span class="mk mk-synagogue" aria-hidden="true"></span> synagogue');
  if ([...kinds].some((k) => ['hospital', 'school', 'meeting-place'].includes(k))) bits.push('<span class="mk mk-building" aria-hidden="true"></span> other site');
  if (kinds.has('cemetery')) bits.push('<span class="mk mk-cemetery" aria-hidden="true"></span> cemetery');
  if (pts.some((p) => p.precision === 'approximate')) bits.push('<span class="mk mk-approx" aria-hidden="true"></span> approximate location');
  return bits.length ? `<p class="map-caption">${bits.join(' · ')}</p>` : '';
};
const minimap = (pts) => `<figure class="minimap-fig"><div class="minimap" role="img" aria-label="Map showing ${esc(pts.map((p) => p.name).join(', '))}" data-points="${esc(JSON.stringify(pts))}" data-tiles="${esc(TILES)}"></div>${mapKey(pts)}</figure>`;
const ptFor = (placeId) => { const p = index.place.get(placeId); return { name: placeLabel(placeId), lat: p.lat, lon: p.lon, kind: 'city' }; };
const locPt = (type, s, rel) => ({ name: s.name, lat: s.lat, lon: s.lon, kind: type === 'cemetery' ? 'cemetery' : s.kind, precision: s.precision, href: rel + docPath(type, s.id) });
const lifespan = (r) => (r.born || r.died ? `${r.born || '?'}–${r.died || '?'}` : 'dates unknown');
const span = (a, b) => (a ? `${a}${b ? `–${b}` : '–'}` : '');
const precisionNote = (s) => (s.precision === 'approximate' ? ' <span class="muted">(approximate location)</span>' : '');
const coords = (s) => `${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} ${badge('precision', s.precision)}`;
const peopleList = (rel, roles, empty = 'None recorded yet.') => ul(roles.map((x) => `${link(rel, 'person', x.person.id, x.person.name)} — ${esc(x.role)}${x.start ? ` <span class="muted">${span(x.start, x.end)}</span>` : ''}`), `<p class="muted">${empty}</p>`);
const eventList = (rel, evs) => (evs.length ? `<section><h2>Events</h2>${ul(evs.map((e) => `${link(rel, 'event', e.id, e.name)} <span class="muted">${formatDate(e.date)}</span>`))}</section>` : '');
const buildingsList = (rel, rows) => ul(rows.map((x) => `${link(rel, 'site', x.site.id, x.site.name)} <span class="muted">${esc(x.site.address)}${x.from ? `, ${span(x.from, x.to)}` : ''}</span>${precisionNote(x.site)}`));
const cemList = (rel, rows) => ul(rows.map((c) => `${link(rel, 'cemetery', c.id, c.name)} <span class="muted">est. ${c.established}${c.closed ? `, closed ${c.closed}` : ''}</span>${precisionNote(c)}`));

// ───────────────────────── entity pages ─────────────────────────
function entityBody(type, r, rel) {
  const crumbs = `<nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${rel}">Home</a></li><li><a href="${rel}browse/#${type}">${TYPE_INFO[type].plural}</a></li><li aria-current="page">${esc(type === 'source' ? r.title : r.name)}</li></ol></nav>`;
  let main = '', aside = '';
  if (type === 'place') {
    const cs = (congByPlace.get(r.id) || []).sort((a, b) => a.founded - b.founded);
    const is = (instByPlace.get(r.id) || []).sort((a, b) => a.founded - b.founded);
    const pers = (perByPlace.get(r.id) || []).sort((a, b) => a.founded - b.founded);
    const sites = (siteByPlace.get(r.id) || []).sort((a, b) => (a.built || 0) - (b.built || 0));
    const cems = (cemByPlace.get(r.id) || []).sort((a, b) => a.established - b.established);
    const es = [...(eventByPlace.get(r.id) || []), ...(eventAlsoByPlace.get(r.id) || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const ps = peopleByPlace.get(r.id) || [];
    const count = (y) => cs.filter((c) => activeIn(c, y) && !dormantIn(c, y)).length;
    const none = '<p class="muted">None recorded.</p>';
    main = `<p class="lede">${cs.length} congregation${cs.length === 1 ? '' : 's'}, ${sites.length} site${sites.length === 1 ? '' : 's'} and ${cems.length} cemeter${cems.length === 1 ? 'y' : 'ies'} recorded in ${esc(r.name)}.</p>
    ${dl([['State', esc(r.state)], ['Region', esc(r.region)], ['Coordinates', `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`],
      ['Active congregations', `${Y0}: ${count(Y0)} · 1850: ${count(1850)} · 1860: ${count(1860)} · ${Y1}: ${count(Y1)}`]])}
    <section><h2>Congregations</h2>${ul(cs.map((c) => `${link(rel, 'congregation', c.id, c.name)} <span class="muted">est. ${c.founded}</span> ${badge('rite', c.rite)}`), none)}</section>
    ${readersSection(rel, r.id)}
    <section><h2>Synagogues and other sites</h2>${ul(sites.map((s) => `${link(rel, 'site', s.id, s.name)} <span class="muted">${esc(s.address)}${s.built ? `, ${s.built}` : ''}</span>${precisionNote(s)}`), none)}</section>
    <section><h2>Cemeteries</h2>${cemList(rel, cems) || none}</section>
    <section><h2>Institutions</h2>${ul(is.map((o) => `${link(rel, 'institution', o.id, o.name)} <span class="muted">${o.founded}</span>`), none)}</section>
    <section><h2>Periodicals</h2>${ul(pers.map((o) => `${link(rel, 'periodical', o.id, o.name)} <span class="muted">${span(o.founded, o.ceased)}</span>`), none)}</section>
    <section><h2>Events</h2>${ul(es.map((e) => `${link(rel, 'event', e.id, e.name)} <span class="muted">${formatDate(e.date)}</span>`), none)}</section>
    <section><h2>People</h2>${ul(ps.map((p) => `${link(rel, 'person', p.id, p.name)} <span class="muted">${lifespan(p)}</span>`), none)}</section>`;
    const inner = [...sites.map((s) => locPt('site', s, rel)), ...cems.map((c) => locPt('cemetery', c, rel))];
    aside = (CITY_IDS.includes(r.id) ? `<p class="guide-link"><a class="btn" href="${rel}city/${r.id}/">Explore Jewish ${esc(r.name)} →</a></p>` : '') + minimap(inner.length ? inner : [ptFor(r.id)]);
  } else if (type === 'congregation') {
    const roles = rolesByOrg.get(r.id) || [];
    const kids = splits.get(r.id) || [];
    const evs = eventsByOrg.get(r.id) || [];
    const sites = (sitesByOrg.get(r.id) || []).sort((a, b) => (a.from || 0) - (b.from || 0));
    const cems = cemByOwner.get(r.id) || [];
    main = `${r.translation ? `<p class="translation">“${esc(r.translation)}”</p>` : ''}${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${dl([['Place', link(rel, 'place', r.place, placeLabel(r.place))], ['Founded', `${r.founded} ${badge('certainty', r.certainty)}`],
      ['Dissolved / merged', r.dissolved], ['Without resident congregation', r.dormant ? `${r.dormant[0]}–${r.dormant[1]}` : ''],
      ['Rite at founding', badge('rite', r.rite)], ['Orientation by c. 1870', badge('orientation', r.orientation)],
      ['Formed from', r.splitFrom ? link(rel, 'congregation', r.splitFrom, nameOf('congregation', r.splitFrom)) : ''],
      ['Gave rise to', kids.map((k) => link(rel, 'congregation', k.id, k.name)).join(', ')]])}
    ${sites.length ? `<section><h2>Buildings</h2>${buildingsList(rel, sites)}</section>` : ''}
    ${cems.length ? `<section><h2>Cemeteries</h2>${cemList(rel, cems)}</section>` : ''}
    <section><h2>Clergy and members</h2>${peopleList(rel, roles)}</section>
    ${eventList(rel, evs)}
    ${sourcesSection(rel, r.sources)}`;
    const inner = [...sites.map((x) => locPt('site', x.site, rel)), ...cems.map((c) => locPt('cemetery', c, rel))];
    aside = minimap(inner.length ? inner : [{ ...ptFor(r.place), name: `${r.name}, ${placeLabel(r.place)}` }]);
  } else if (type === 'institution') {
    const roles = rolesByOrg.get(r.id) || [];
    const sites = sitesByOrg.get(r.id) || [];
    main = `<p class="lede">${esc(r.description)}</p>
    ${dl([['Type', badge('category', r.category)], ['Place', link(rel, 'place', r.place, placeLabel(r.place))], ['Founded', `${r.founded} ${badge('certainty', r.certainty)}`], ['Ceased', r.dissolved]])}
    ${sites.length ? `<section><h2>Buildings and meeting places</h2>${buildingsList(rel, sites)}</section>` : ''}
    <section><h2>People</h2>${peopleList(rel, roles)}</section>
    ${eventList(rel, eventsByOrg.get(r.id) || [])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap(sites.length ? sites.map((x) => locPt('site', x.site, rel)) : [ptFor(r.place)]);
  } else if (type === 'periodical') {
    main = `<p class="lede">${esc(r.description)}</p>
    ${dl([['Published at', link(rel, 'place', r.place, placeLabel(r.place))], ['Years', `${span(r.founded, r.ceased)} ${badge('certainty', r.certainty)}`],
      ['Language', esc(r.language.map((l) => LANGS[l]).join(', '))], ['Frequency', badge('frequency', r.frequency)], ['Religious orientation', badge('orientation', r.orientation)]])}
    ${periodicalReadership(rel, r.id)}
    <section><h2>Editors and staff</h2>${peopleList(rel, rolesByOrg.get(r.id) || [])}</section>
    ${eventList(rel, eventsByOrg.get(r.id) || [])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([ptFor(r.place)]);
  } else if (type === 'cemetery') {
    main = `${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${dl([['City', link(rel, 'place', r.place, placeLabel(r.place))], ['Address', esc(r.address)], ['Established', `${r.established} ${badge('certainty', r.certainty)}`],
      ['Closed to burials', r.closed], ['Maintained by', (r.owners || []).map((o) => link(rel, 'congregation', o, nameOf('congregation', o))).join(' · ')],
      ['Location', coords(r)]])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([locPt('cemetery', r, rel)]);
  } else if (type === 'site') {
    const evs = eventsBySite.get(r.id) || [];
    main = `${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${dl([['Kind', badge('siteKind', r.kind)], ['City', link(rel, 'place', r.place, placeLabel(r.place))], ['Address', esc(r.address)],
      ['Built or acquired', r.built ? `${r.built} ${badge('certainty', r.certainty)}` : ''], ['Location', coords(r)]])}
    <section><h2>Used by</h2>${ul((r.occupants || []).map((o) => `${link(rel, typeOfOrg(o.org), o.org, nameOf(typeOfOrg(o.org), o.org))}${o.from ? ` <span class="muted">${span(o.from, o.to)}</span>` : ''}`), '<p class="muted">None recorded.</p>')}</section>
    ${eventList(rel, evs)}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([locPt('site', r, rel)]);
  } else if (type === 'person') {
    const evs = eventsByPerson.get(r.id) || [];
    main = `<p class="lede">${esc(r.description)}</p>
    ${dl([['Lived', lifespan(r)], ['Born', esc(r.birthPlace)], ['Occupation', esc(r.occupation.join(', '))],
      ['Places', r.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(' · ')], ['Certainty', r.certainty ? badge('certainty', r.certainty) : '']])}
    <section><h2>Affiliations</h2>${ul(r.roles.map((x) => `${esc(x.role)}, ${link(rel, typeOfOrg(x.org), x.org, nameOf(typeOfOrg(x.org), x.org))}${x.start ? ` <span class="muted">${span(x.start, x.end)}</span>` : ''}`), '<p class="muted">None recorded.</p>')}</section>
    ${eventList(rel, evs)}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap(r.places.map(ptFor));
  } else if (type === 'event') {
    const site = r.site ? index.site.get(r.site) : null;
    main = `<p class="lede">${esc(r.description)}</p>
    ${dl([['Date', `<time datetime="${esc(r.date)}">${formatDate(r.date)}</time> ${badge('certainty', r.certainty)}`], ['Category', badge('category', r.category)],
      ['Place', link(rel, 'place', r.place, placeLabel(r.place))], ['Site', site ? `${link(rel, 'site', site.id, site.name)} <span class="muted">${esc(site.address)}</span>` : ''],
      ['Also at', (r.alsoAt || []).map((p) => link(rel, 'place', p, placeLabel(p))).join(' · ')],
      ['People', (r.people || []).map((p) => link(rel, 'person', p, nameOf('person', p))).join(' · ')],
      ['Organizations', (r.orgs || []).map((o) => link(rel, typeOfOrg(o), o, nameOf(typeOfOrg(o), o))).join(' · ')]])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap(site ? [locPt('site', site, rel)] : [r.place, ...(r.alsoAt || [])].map(ptFor));
  } else if (type === 'source') {
    const cites = citedBy.get(r.id) || [];
    main = `<p class="lede">${citationText(r)}</p>${r.note ? `<p>${esc(r.note)}</p>` : ''}${r.url ? `<p><a href="${esc(r.url)}">${esc(r.url)}</a></p>` : ''}
    <section><h2>Cited by ${cites.length} record${cites.length === 1 ? '' : 's'}</h2>${ul(cites.map(({ type: t, r: x }) => `${link(rel, t, x.id, x.name)} <span class="muted">${TYPE_INFO[t].label}</span>`))}</section>`;
  }
  const heading = esc(type === 'source' ? r.title : r.name);
  return `<div class="wrap">${crumbs}
  <article class="record record-${type}">
    <header class="record-head"><p class="kicker">${TYPE_INFO[type].label}</p><h1>${heading}</h1></header>
    <div class="record-grid"><div class="record-main">${main}${gallery(rel, type === 'place' ? (mediaByPlace.get(r.id) || []) : (mediaByRecord.get(`${type}/${r.id}`) || []))}${citeBox(type, r)}</div>${aside ? `<aside class="record-aside">${aside}</aside>` : ''}</div>
  </article></div>`;
}

// ───────────────────────── write helpers ─────────────────────────
const written = [];
async function out(rel, content) {
  const p = path.join(DIST, rel);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, content);
  written.push(rel);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
await out('.nojekyll', '');

// JSON-LD context (published so others can reuse it)
await out('context.jsonld', JSON.stringify({ '@context': CONTEXT }, null, 2));

// entity pages
const SUMMARY = {
  place: (r) => `${r.name}, ${r.state}: Jewish congregations, institutions, people and events, ${Y0}–${Y1}.`,
  congregation: (r) => `${r.name} (${index.place.get(r.place).name}, founded ${r.founded}). ${r.note || ''}`.trim(),
  person: (r) => `${r.name} (${lifespan(r)}). ${r.description}`,
  periodical: (r) => `${r.name}, ${r.language.map((l) => LANGS[l]).join('/')} ${r.frequency} published in ${index.place.get(r.place).name}, ${span(r.founded, r.ceased)}. ${r.description}`,
  cemetery: (r) => `${r.name}, ${r.address}, ${index.place.get(r.place).name} (est. ${r.established}). ${r.note || ''}`.trim(),
  site: (r) => `${r.name}, ${r.address}, ${index.place.get(r.place).name}. ${r.note || ''}`.trim(),
  institution: (r) => `${r.name} (${index.place.get(r.place).name}, ${r.founded}). ${r.description}`,
  event: (r) => `${r.name}, ${formatDate(r.date)}. ${r.description}`,
  source: (r) => `${r.author}, ${r.title}.`,
};
for (const [type, rows] of Object.entries(data)) {
  for (const r of rows) {
    const rel = '../../';
    const n = node(type, r);
    const doc = { '@context': `${BASE}context.jsonld`, ...n };
    const inline = { '@context': CONTEXT, ...n };
    await out(`${docPath(type, r.id)}index.jsonld`, JSON.stringify(doc, null, 2));
    await out(`${docPath(type, r.id)}index.html`, layout({
      rel, title: type === 'source' ? r.title : r.name, description: SUMMARY[type](r).slice(0, 300), canonical: docUri(type, r.id),
      alternate: 'index.jsonld', jsonld: inline, body: entityBody(type, r, rel),
      scripts: type === 'source' ? [] : ['assets/vendor/leaflet/leaflet.js', 'assets/js/minimap.js'],
      styles: type === 'source' ? [] : ['assets/vendor/leaflet/leaflet.css'], current: 'browse/',
    }));
  }
}

// ───────────────────────── dataset files ─────────────────────────
const fullGraph = { '@context': CONTEXT, '@graph': graph };
await out('data/kehillot.jsonld', JSON.stringify(fullGraph, null, 2));
const triples = []; bnodeCount = 0;
for (const n of graph) toTriples(n, triples);
await out('data/kehillot.nt', triples.join('\n') + '\n');

// CSV + CSVW
const csvCell = (v) => { const s = Array.isArray(v) ? v.join('|') : v == null ? '' : String(v); return /[",\n|]/.test(s) && !Array.isArray(v) ? `"${s.replace(/"/g, '""')}"` : /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const TABLES = {
  places: { rows: data.place, cols: [['id', 'string'], ['name', 'string'], ['state', 'string'], ['region', 'string'], ['lat', 'decimal'], ['lon', 'decimal'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.place?.[r.id] : r[c]), about: 'place', titles: { lat: 'latitude', lon: 'longitude' } },
  congregations: { rows: data.congregation, cols: [['id', 'string'], ['name', 'string'], ['translation', 'string'], ['place', 'string'], ['founded', 'gYear'], ['dissolved', 'gYear'], ['rite', 'string'], ['orientation', 'string'], ['certainty', 'string'], ['splitFrom', 'string'], ['note', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.congregation?.[r.id] : r[c]), about: 'congregation' },
  people: { rows: data.person, cols: [['id', 'string'], ['name', 'string'], ['born', 'gYear'], ['died', 'gYear'], ['birthPlace', 'string'], ['occupation', 'string'], ['places', 'string'], ['description', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.person?.[r.id] : r[c]), about: 'person' },
  roles: { rows: data.person.flatMap((p) => p.roles.map((x) => ({ person: p.id, organization: x.org, organizationType: typeOfOrg(x.org), role: x.role, start: x.start, end: x.end }))),
    cols: [['person', 'string'], ['organization', 'string'], ['organizationType', 'string'], ['role', 'string'], ['start', 'gYear'], ['end', 'gYear']], get: (r, c) => r[c] },
  institutions: { rows: data.institution, cols: [['id', 'string'], ['name', 'string'], ['category', 'string'], ['place', 'string'], ['founded', 'gYear'], ['dissolved', 'gYear'], ['certainty', 'string'], ['description', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.institution?.[r.id] : r[c]), about: 'institution' },
  periodicals: { rows: data.periodical, cols: [['id', 'string'], ['name', 'string'], ['place', 'string'], ['founded', 'gYear'], ['ceased', 'gYear'], ['language', 'string'], ['frequency', 'string'], ['orientation', 'string'], ['certainty', 'string'], ['description', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.periodical?.[r.id] : r[c]), about: 'periodical' },
  cemeteries: { rows: data.cemetery, cols: [['id', 'string'], ['name', 'string'], ['place', 'string'], ['address', 'string'], ['lat', 'decimal'], ['lon', 'decimal'], ['precision', 'string'], ['established', 'gYear'], ['closed', 'gYear'], ['owners', 'string'], ['certainty', 'string'], ['note', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.cemetery?.[r.id] : r[c]), about: 'cemetery', titles: { lat: 'latitude', lon: 'longitude' } },
  sites: { rows: data.site, cols: [['id', 'string'], ['name', 'string'], ['kind', 'string'], ['place', 'string'], ['address', 'string'], ['lat', 'decimal'], ['lon', 'decimal'], ['precision', 'string'], ['built', 'gYear'], ['certainty', 'string'], ['note', 'string'], ['sources', 'string'], ['wikidata', 'string']],
    get: (r, c) => (c === 'wikidata' ? wikidata.site?.[r.id] : r[c]), about: 'site', titles: { lat: 'latitude', lon: 'longitude' } },
  occupancy: { rows: data.site.flatMap((st) => (st.occupants || []).map((o) => ({ site: st.id, organization: o.org, organizationType: typeOfOrg(o.org), from: o.from, to: o.to }))),
    cols: [['site', 'string'], ['organization', 'string'], ['organizationType', 'string'], ['from', 'gYear'], ['to', 'gYear']], get: (r, c) => r[c] },
  events: { rows: data.event, cols: [['id', 'string'], ['name', 'string'], ['date', 'string'], ['place', 'string'], ['site', 'string'], ['alsoAt', 'string'], ['category', 'string'], ['certainty', 'string'], ['people', 'string'], ['orgs', 'string'], ['description', 'string'], ['sources', 'string']],
    get: (r, c) => r[c], about: 'event' },
  sources: { rows: data.source, cols: [['id', 'string'], ['type', 'string'], ['author', 'string'], ['title', 'string'], ['publisher', 'string'], ['place', 'string'], ['year', 'gYear'], ['url', 'anyURI'], ['note', 'string']],
    get: (r, c) => r[c], about: 'source' },
};
const csvw = { '@context': ['http://www.w3.org/ns/csvw', { '@language': 'en' }], 'dc:title': `${cfg.title} tabular data`, 'dc:license': { '@id': cfg.license.url }, tables: [] };
for (const [name, t] of Object.entries(TABLES)) {
  const lines = [t.cols.map(([c]) => c).join(',')];
  for (const r of t.rows) lines.push(t.cols.map(([c]) => csvCell(t.get(r, c))).join(','));
  await out(`data/${name}.csv`, lines.join('\r\n') + '\r\n');
  csvw.tables.push(strip({
    url: `${name}.csv`,
    tableSchema: strip({
      columns: t.cols.map(([c, dt]) => strip({ name: c, titles: t.titles?.[c] || c, datatype: dt,
        separator: ['sources', 'places', 'alsoAt', 'people', 'orgs', 'occupation', 'owners', 'language'].includes(c) ? '|' : undefined,
        required: c === 'id' ? true : undefined })),
      primaryKey: t.about ? 'id' : undefined,
      aboutUrl: t.about ? `${BASE}${TYPE_INFO[t.about].path}/{id}/#this` : undefined,
    }),
  }));
}
await out('data/csv-metadata.json', JSON.stringify(csvw, null, 2));
// media table
{
  const cols = ['id', 'title', 'source', 'page', 'holder', 'collection', 'identifier', 'date', 'license', 'about', 'places', 'lat', 'lon', 'image', 'manifest'];
  const rows = MEDIA.map((m) => ({ id: m.id, title: m.title, source: m.source, page: m.page, holder: m.holder, collection: m.collection?.title, identifier: m.identifier, date: m.date,
    license: m.licenseUrl || m.license, about: m.about.map((a) => `${a.type}/${a.id}`), places: m.places, lat: m.geo?.lat, lon: m.geo?.lon, image: m.image.full, manifest: m.manifest }));
  await out('data/media.csv', [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n');
}

// ───────────────────────── readers map ─────────────────────────
{
  const papers = Object.keys(READERS);
  const allYears = papers.flatMap((p) => READERS[p].years);
  const yMin = Math.min(...allYears), yMax = Math.max(...allYears);
  // compact place table for the map: one row per place, counts per paper per year
  const merged = new Map();
  for (const p of papers) for (const x of READERS[p].places) {
    const k = x.qid || x.k;
    if (!merged.has(k)) merged.set(k, { k, name: x.name, state: x.state, country: x.country, qid: x.qid, lat: x.lat, lon: x.lon, own: x.qid ? placeIdByQid.get(x.qid) || null : null, keys: {}, y: {} });
    const m = merged.get(k);
    m.keys[p] = x.k; m.y[p] = x.y;
    if (x.n - Object.values(x.y).reduce((a, b) => a + b, 0) > 0) m.y[p] = { ...x.y, 0: x.n - Object.values(x.y).reduce((a, b) => a + b, 0) }; // undated
  }
  const mapData = { range: [yMin, yMax], papers: papers.map((p) => ({ id: p, name: nameOf('periodical', p), total: READERS[p].total, years: READERS[p].years, place: index.place.get(index.periodical.get(p).place).name })), places: [...merged.values()] };
  await out('data/readership-places.json', JSON.stringify(mapData));
  for (const p of papers) await out(`data/readership/${p}.json`, JSON.stringify(READERS[p]));
  {
    const cols = ['periodical', 'place_key', 'place', 'state', 'country', 'wikidata', 'geonames', 'lcnaf', 'kehillot_place', 'latitude', 'longitude', 'year', 'subscriptions'];
    const lines = [cols.join(',')];
    for (const p of papers) for (const x of READERS[p].places) for (const [y, n] of Object.entries(x.y).concat(x.n - Object.values(x.y).reduce((a, b) => a + b, 0) > 0 ? [['', x.n - Object.values(x.y).reduce((a, b) => a + b, 0)]] : []))
      lines.push([p, x.k, x.name, x.state, x.country, x.qid, x.geonames, x.lcnaf, x.qid ? placeIdByQid.get(x.qid) : '', x.lat, x.lon, y, n].map(csvCell).join(','));
    await out('data/subscriptions-by-place.csv', lines.join('\r\n') + '\r\n');
  }

  await out('subscribers/index.html', layout({ rel: '../', title: 'Subscribers', canonical: `${BASE}subscribers/`, current: 'subscribers/',
    description: `Where the subscribers to the American Jewish press lived: ${READ_TOTAL.toLocaleString('en-US')} subscriptions to ${papers.length} periodicals, ${yMin}–${yMax}, mapped from their subscriber lists.`,
    jsonld: { '@context': CONTEXT, '@graph': DATASETS.map(datasetNode) },
    styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/readers.js'],
    body: `<div class="atlas wrap readers-page">
  <div class="plate">
    <div id="readers-map" class="atlas-map" role="region" aria-label="Map of subscribers to the Jewish press"></div>
    <div class="cartouche">
      <p class="c-small">A Map of the</p>
      <h1>Subscribers to the Jewish Press</h1>
      <p class="c-small">in the United States and abroad</p>
      <p class="c-year"><span>subscriptions,</span> <output id="r-range">${yMin}–${yMax}</output></p>
      <p id="r-summary" class="c-sum" aria-live="polite"></p>
    </div>
    <fieldset class="map-key">
      <legend>Explanation</legend>
      ${papers.map((p) => `<label><input type="checkbox" name="paper" value="${p}" checked><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="sym" style="fill:${PAPER_TINT[p]};fill-opacity:.75"/></svg><i>${esc(nameOf('periodical', p).replace(/ and American Jewish Advocate$/, ''))}</i> <span class="muted key-n" data-n="${p}"></span></label>`).join('')}
      <p class="key-street">Circle area shows the number of subscriptions.</p>
    </fieldset>
  </div>
  <div class="timeline readers-time">
    <label class="r-yr">From <input type="range" id="r-from" min="${yMin}" max="${yMax}" value="${yMin}"> <output id="r-from-out">${yMin}</output></label>
    <label class="r-yr">to <input type="range" id="r-to" min="${yMin}" max="${yMax}" value="${yMax}"> <output id="r-to-out">${yMax}</output></label>
  </div>
  <div class="readers-cols">
    <section class="gazetteer" aria-labelledby="r-top-h">
      <h2 id="r-top-h">Where the Subscribers Lived</h2>
      <p class="gaz-note">The places with the most subscriptions for the papers and years chosen. Select one to see it on the map and list its subscribers.</p>
      <ol id="r-top" class="place-list"></ol>
    </section>
    <section class="r-detail" aria-live="polite" aria-labelledby="r-detail-h">
      <h2 id="r-detail-h">Subscribers</h2>
      <div id="r-detail"><p class="gaz-note">Choose a place on the map or in the list.</p></div>
    </section>
  </div>
  <section class="prose-wide r-about">
    <h2>About these data</h2>
    <p>Each 19th-century Jewish periodical printed lists of subscribers and agents who had paid. These lists were transcribed, with subscribers' names, the date of the issue, and the place, reconciled to Wikidata, GeoNames and the Library of Congress. Kehillot maps them by place and links them to its own places through their Wikidata identifiers. Subscriptions without a recorded place are counted but not mapped.</p>
    <ul class="sources">${DATASETS.filter((d) => d.use === 'subscriptions').map((d) => `<li>${dsCitation(d)}. License: ${esc(d.license?.toUpperCase().replace(/-/g, ' ') || 'see record')}.</li>`).join('')}</ul>
    <p class="small">Download the mapped counts: <a href="../data/subscriptions-by-place.csv">subscriptions-by-place.csv</a> (one row per periodical, place and year). Full subscriber lists are in the Zenodo deposits above.</p>
  </section>
</div>
<noscript><div class="wrap"><p>The subscriber map needs JavaScript. Each periodical's page lists where its subscribers lived, and the data can be downloaded from the Datasets page.</p></div></noscript>` }));
}


// GeoJSON of everything with a location (used by the atlas)
const feature = (type, r, placeId) => { const p = index.place.get(placeId);
  return { type: 'Feature', id: uri(type, r.id), geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: strip({ type, id: r.id, name: r.name, place: placeId, founded: r.founded, dissolved: r.dissolved, date: r.date, rite: r.rite, orientation: r.orientation, category: r.category, certainty: r.certainty, uri: uri(type, r.id) }) }; };
await out('data/atlas.geojson', JSON.stringify({ type: 'FeatureCollection',
  features: [...data.congregation.map((r) => feature('congregation', r, r.place)), ...data.institution.map((r) => feature('institution', r, r.place)),
    ...data.periodical.map((r) => feature('periodical', r, r.place)), ...data.event.map((r) => feature('event', r, r.place)),
    ...LOCATED.flatMap((t) => data[t].map((r) => ({ type: 'Feature', id: uri(t, r.id), geometry: { type: 'Point', coordinates: [r.lon, r.lat] },
      properties: strip({ type: t, id: r.id, name: r.name, kind: r.kind, place: r.place, address: r.address, precision: r.precision, established: r.established, built: r.built, closed: r.closed, uri: uri(t, r.id) }) })))] }, null, 1));

// Linked Places Format (World Historical Gazetteer interchange)
await out('data/places.lpf.json', JSON.stringify({
  type: 'FeatureCollection', '@context': 'https://raw.githubusercontent.com/LinkedPasts/linked-places/master/linkedplaces-context-v1.1.jsonld',
  features: data.place.map((p) => ({
    '@id': uri('place', p.id), type: 'Feature',
    properties: { title: p.name, ccodes: ['US'] },
    when: { timespans: [{ start: { in: String(Y0) }, end: { in: String(Y1) } }] },
    names: [{ toponym: p.name, lang: 'en', citations: [{ label: 'Kehillot gazetteer', '@id': docUri('place', p.id) }] }],
    types: [{ identifier: 'aat:300008389', label: 'cities' }],
    geometry: { type: 'Point', coordinates: [p.lon, p.lat], certainty: 'certain' },
    links: wikidata.place?.[p.id] ? [{ type: 'closeMatch', identifier: `wd:${wikidata.place[p.id]}` }] : [],
    descriptions: [{ value: `${p.name}, ${p.state} (${p.region})`, lang: 'en' }],
  })),
}, null, 1));

// Compact JSON for the browser apps
const compact = {
  yearRange: cfg.yearRange,
  places: data.place.map((p) => ({ ...p, wikidata: wikidata.place?.[p.id] })),
  congregations: data.congregation.map((c) => ({ ...c, wikidata: wikidata.congregation?.[c.id] })),
  people: data.person.map((p) => ({ ...p, wikidata: wikidata.person?.[p.id] })),
  institutions: data.institution.map((o) => ({ ...o, wikidata: wikidata.institution?.[o.id] })),
  periodicals: data.periodical.map((o) => ({ ...o, wikidata: wikidata.periodical?.[o.id] })),
  cemeteries: data.cemetery.map((o) => ({ ...o, wikidata: wikidata.cemetery?.[o.id] })),
  sites: data.site.map((o) => ({ ...o, wikidata: wikidata.site?.[o.id] })),
  langs: LANGS,
  cityGuides: CITY_IDS,
  events: data.event,
  sources: data.source,
  vocab: Object.fromEntries(Object.entries(VOCAB).map(([k, v]) => [k, Object.fromEntries(Object.entries(v.concepts).map(([c, [l]]) => [c, l]))])),
};
await out('data/site.json', JSON.stringify(compact));

// SKOS vocabulary + ontology terms
const vocabGraph = [
  { '@id': `${BASE}vocab/`, '@type': 'http://www.w3.org/2002/07/owl#Ontology', 'dcterms:title': `${cfg.title} vocabulary`, 'dcterms:license': { '@id': cfg.license.url } },
  { '@id': 'kh:Occupancy', '@type': 'rdfs:Class', 'rdfs:label': 'Occupancy', 'rdfs:comment': 'The use of a site by an organization over a period, with schema:startDate and schema:endDate.' },
  { '@id': 'kh:Congregation', '@type': 'rdfs:Class', 'rdfs:label': 'Congregation', 'rdfs:subClassOf': { '@id': 'schema:Organization' }, 'rdfs:comment': 'A Jewish religious congregation (kahal), distinct from the building in which it worshipped.' },
  ...[['rite', 'Rite at founding'], ['orientation', 'Orientation by c. 1870'], ['certainty', 'Certainty of dating'], ['splitFrom', 'Formed by secession from'], ['dormantFrom', 'Without resident congregation from'], ['dormantUntil', 'Without resident congregation until'], ['nameTranslation', 'English translation of the Hebrew name'], ['birthPlaceLabel', 'Birthplace as recorded (text)'], ['occupation', 'Occupation (text)'], ['involves', 'Person or organization involved in an event'], ['alsoAt', 'Additional place where the event occurred'], ['frequency', 'Publication frequency'], ['established', 'Year a cemetery was established'], ['closed', 'Year a cemetery closed to burials'], ['built', 'Year a building was built or acquired'], ['maintainedBy', 'Congregation that owned or maintained a cemetery'], ['occupancy', 'A period during which an organization used a site'], ['occupant', 'The organization in an occupancy'], ['locationPrecision', 'How precisely the coordinates locate the site'], ['atSite', 'Site within a city where an event took place']]
    .map(([t, l]) => ({ '@id': `kh:${t}`, '@type': 'rdf:Property', 'rdfs:label': l })),
  ...Object.entries(VOCAB).flatMap(([scheme, v]) => [
    { '@id': `${BASE}vocab/#${scheme}`, '@type': 'skos:ConceptScheme', 'skos:prefLabel': v.label },
    ...Object.entries(v.concepts).map(([k, [l, d]]) => ({ '@id': conceptUri(scheme, k), '@type': 'skos:Concept', 'skos:prefLabel': l, 'skos:definition': d, 'skos:inScheme': { '@id': `${BASE}vocab/#${scheme}` } })),
  ]),
];
const vocabDoc = { '@context': { ...CONTEXT, rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' }, '@graph': vocabGraph };
await out('vocab/index.jsonld', JSON.stringify(vocabDoc, null, 2));

// DCAT + VoID catalog
const DISTS = [
  ['subscriptions-by-place.csv', 'text/csv', 'Periodical subscriptions by place and year, derived from the deposited subscriber lists (CSV)'],
  ['media.csv', 'text/csv', 'Linked pictures and documents, with holders, rights and the records they depict (CSV)'],
  ['kehillot.jsonld', 'application/ld+json', 'Full knowledge graph (JSON-LD)'],
  ['kehillot.nt', 'application/n-triples', 'Full knowledge graph (N-Triples)'],
  ['atlas.geojson', 'application/geo+json', 'Mapped records (GeoJSON)'],
  ['places.lpf.json', 'application/ld+json', 'Gazetteer in Linked Places Format (for World Historical Gazetteer)'],
  ['csv-metadata.json', 'application/csvm+json', 'CSVW metadata describing the CSV tables'],
  ...Object.keys(TABLES).map((t) => [`${t}.csv`, 'text/csv', `${t[0].toUpperCase()}${t.slice(1)} table (CSV)`]),
];
const catalog = {
  '@context': CONTEXT,
  '@id': `${BASE}datasets/#dataset`,
  '@type': ['dcat:Dataset', 'void:Dataset', 'schema:Dataset'],
  'dcterms:title': `${cfg.title}: ${cfg.subtitle}`,
  name: `${cfg.title}: ${cfg.subtitle}`,
  description: 'A curated, source-cited dataset of Jewish congregations, institutions, people, events and places in the United States, c. 1840–1870, published as linked open data.',
  'dcterms:license': { '@id': cfg.license.url },
  'schema:license': { '@id': cfg.license.url },
  'dcterms:publisher': cfg.publisher,
  'schema:version': cfg.version,
  'dcterms:modified': { '@value': BUILD_DATE, '@type': 'xsd:date' },
  'dcterms:temporal': cfg.temporalCoverage,
  'schema:temporalCoverage': cfg.temporalCoverage,
  'schema:spatialCoverage': cfg.spatialCoverage,
  'schema:keywords': ['American Jewish history', 'synagogues', 'congregations', 'nineteenth century', 'immigration', 'linked open data', 'digital atlas'],
  'schema:isAccessibleForFree': true,
  'void:triples': triples.length,
  'void:entities': graph.length,
  'void:uriSpace': BASE,
  'void:vocabulary': [{ '@id': 'https://schema.org/' }, { '@id': `${BASE}vocab/` }, { '@id': 'http://www.w3.org/2004/02/skos/core#' }],
  'void:dataDump': { '@id': `${BASE}data/kehillot.nt` },
  'void:exampleResource': { '@id': uri('congregation', 'emanu-el-ny') },
  'dcat:distribution': DISTS.map(([f, mt, title]) => ({ '@type': 'dcat:Distribution', 'dcterms:title': title, 'dcat:downloadURL': { '@id': `${BASE}data/${f}` }, 'dcat:mediaType': mt })),
  'schema:distribution': DISTS.map(([f, mt]) => ({ '@type': 'schema:DataDownload', 'schema:contentUrl': { '@id': `${BASE}data/${f}` }, 'schema:encodingFormat': mt })),
};
await out('data/catalog.jsonld', JSON.stringify(catalog, null, 2));

// ───────────────────────── chart (build-time SVG) ─────────────────────────
const REGIONS = ['Northeast', 'South', 'Midwest', 'West'];
const placeRegion = (id) => index.place.get(id).region;
const years = Array.from({ length: Y1 - Y0 + 1 }, (_, i) => Y0 + i);
const series = years.map((y) => Object.fromEntries(REGIONS.map((rg) => [rg, data.congregation.filter((c) => placeRegion(c.place) === rg && activeIn(c, y) && !dormantIn(c, y)).length])));
function growthChart() {
  const W = 720, H = 300, m = { t: 16, r: 110, b: 32, l: 40 };
  const max = Math.max(...series.map((s) => REGIONS.reduce((a, rg) => a + s[rg], 0)));
  const yMax = Math.ceil(max / 10) * 10;
  const x = (y) => m.l + ((y - Y0) / (Y1 - Y0)) * (W - m.l - m.r);
  const yy = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
  let lower = years.map(() => 0);
  const areas = REGIONS.map((rg) => {
    const upper = lower.map((l, i) => l + series[i][rg]);
    const d = `M${years.map((y, i) => `${x(y).toFixed(1)},${yy(upper[i]).toFixed(1)}`).join('L')}L${years.slice().reverse().map((y, i) => `${x(y).toFixed(1)},${yy(lower[years.length - 1 - i]).toFixed(1)}`).join('L')}Z`;
    const mid = (upper.at(-1) + lower.at(-1)) / 2;
    const res = { rg, d, labelY: yy(mid), total: series.at(-1)[rg] };
    lower = upper; return res;
  });
  const grid = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10).map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${yy(v)}" y2="${yy(v)}" class="grid"/><text x="${m.l - 8}" y="${yy(v) + 4}" class="tick" text-anchor="end">${v}</text>`).join('');
  const xt = [1840, 1845, 1850, 1855, 1860, 1865, 1870].map((y) => `<text x="${x(y)}" y="${H - m.b + 20}" class="tick" text-anchor="middle">${y}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-labelledby="chart-title chart-desc">
  <title id="chart-title">Active congregations recorded in Kehillot, by region, ${Y0}–${Y1}</title>
  <desc id="chart-desc">Stacked area chart. In ${Y0}, ${REGIONS.reduce((a, rg) => a + series[0][rg], 0)} congregations were active; by ${Y1}, ${REGIONS.reduce((a, rg) => a + series.at(-1)[rg], 0)}.</desc>
  ${grid}${areas.map((a, i) => `<path d="${a.d}" class="area area-${i}"/>`).join('')}
  ${areas.map((a, i) => `<text x="${W - m.r + 8}" y="${a.labelY + 4}" class="series-label sl-${i}">${a.rg} · ${a.total}</text>`).join('')}
  ${xt}</svg>`;
}
const chartTable = `<details class="chart-data"><summary>Show chart data as a table</summary><table><thead><tr><th scope="col">Year</th>${REGIONS.map((r) => `<th scope="col">${r}</th>`).join('')}<th scope="col">Total</th></tr></thead><tbody>${years.filter((y) => y % 5 === 0).map((y) => { const s = series[y - Y0]; return `<tr><th scope="row">${y}</th>${REGIONS.map((r) => `<td>${s[r]}</td>`).join('')}<td>${REGIONS.reduce((a, r) => a + s[r], 0)}</td></tr>`; }).join('')}</tbody></table></details>`;

// ───────────────────────── top-level pages ─────────────────────────
const websiteLD = { '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.title, alternateName: cfg.subtitle, url: BASE, inLanguage: cfg.language, license: cfg.license.url,
  potentialAction: { '@type': 'SearchAction', target: `${BASE}database/#q={search_term_string}`, 'query-input': 'required name=search_term_string' } };
const counts = Object.fromEntries(Object.entries(data).map(([t, r]) => [t, r.length]));

await out('index.html', layout({ rel: '', title: '', canonical: BASE, current: '',
  description: `${cfg.subtitle}. An open, source-cited atlas and linked-data database of Jewish congregations, institutions, people and events.`,
  jsonld: websiteLD,
  body: `<section class="hero"><div class="wrap hero-inner">
    <p class="kicker">Digital atlas &amp; linked open database</p>
    <h1>Jewish America at mid-century, ${Y0}–${Y1}</h1>
    <p class="lede">Between 1840 and 1870, the American Jewish population grew roughly tenfold, from perhaps 15,000 to some 200,000 people, and congregations spread from a handful of Atlantic ports to the Mississippi valley and the Pacific coast. ${esc(cfg.title)} maps that growth and links it, record by record, to its sources.</p>
    <p class="cta"><a class="btn" href="atlas/">Open the atlas</a> <a class="btn btn-ghost" href="database/">Search the database</a></p>
  </div></section>
  <div class="wrap">
    <ul class="stats" aria-label="Dataset contents">
      <li><a href="browse/#congregation"><strong>${counts.congregation}</strong> congregations</a></li>
      <li><a href="browse/#place"><strong>${counts.place}</strong> places</a></li>
      <li><a href="browse/#person"><strong>${counts.person}</strong> people</a></li>
      <li><a href="browse/#cemetery"><strong>${counts.cemetery}</strong> cemeteries</a></li>
      <li><a href="browse/#site"><strong>${counts.site}</strong> sites in cities</a></li>
      <li><a href="browse/#periodical"><strong>${counts.periodical}</strong> periodicals</a></li>
      <li><a href="subscribers/"><strong>${READ_TOTAL.toLocaleString('en-US')}</strong> subscriptions mapped</a></li>
      <li><a href="browse/#institution"><strong>${counts.institution}</strong> institutions</a></li>
      <li><a href="browse/#event"><strong>${counts.event}</strong> events</a></li>
      <li><a href="datasets/"><strong>${triples.length.toLocaleString('en-US')}</strong> RDF triples</a></li>
    </ul>
    <section class="split">
      <figure class="chart-fig">${growthChart()}<figcaption>Congregations active in each year, by region. Counts reflect the records in this dataset, not a complete census. Newport's Touro Synagogue, without a resident congregation for most of the period, is excluded while dormant.</figcaption>${chartTable}</figure>
      <div class="prose">
        <h2>What's here</h2>
        <p>Every record has a stable URI, a human-readable page and a machine-readable JSON-LD description using <a href="https://schema.org/">schema.org</a> and a small <a href="vocab/">project vocabulary</a>. People, places and organizations are reconciled to <a href="https://www.wikidata.org/">Wikidata</a> where a match has been checked.</p>
        <p>Each claim is cited. Dates whose sources disagree are flagged as <em>medium</em> certainty so you know what to verify before citing.</p>
        <h3>National population estimates</h3>
        <table class="mini"><caption class="visually-hidden">Estimated U.S. Jewish population</caption><thead><tr><th scope="col">Year</th><th scope="col">Estimate</th></tr></thead><tbody>${population.series.map((p) => `<tr><th scope="row">${p.year}</th><td>c. ${p.estimate.toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">${esc(population.note)}</p>
      </div>
    </section>
    <section class="explore"><h2>Start exploring</h2><div class="cards">
      ${['emanu-el-ny', 'beth-elohim-chs', 'bnai-yeshurun-cin', 'emanu-el-sf'].map((id) => { const c = index.congregation.get(id); return `<a class="card" href="${docPath('congregation', id)}"><span class="kicker">${esc(index.place.get(c.place).name)} · ${c.founded}</span><strong>${esc(c.name)}</strong><span>${esc(c.note || '')}</span></a>`; }).join('')}
      ${['general-orders-11', 'cleveland-conference-1855'].map((id) => { const e = index.event.get(id); return `<a class="card" href="${docPath('event', id)}"><span class="kicker">${formatDate(e.date)}</span><strong>${esc(e.name)}</strong><span>${esc(e.description)}</span></a>`; }).join('')}
    </div></section>
  </div>` }));

await out('atlas/index.html', layout({ rel: '../', title: 'Atlas', canonical: `${BASE}atlas/`, current: 'atlas/',
  description: `Interactive map of Jewish congregations, institutions and events in the United States, ${Y0}–${Y1}, with a year slider.`,
  styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/atlas.js'],
  body: `<div class="atlas wrap">
  <div class="plate">
    <div id="map" class="atlas-map" role="region" aria-label="Map of Jewish congregations in the United States" data-tiles="${esc(TILES)}"></div>
    <div class="cartouche">
      <p class="c-small">A Map of the</p>
      <h1 id="atlas-h">Jewish Congregations</h1>
      <p class="c-small">of the United States</p>
      <p class="c-year"><span>in the year</span> <output id="year-out" for="year" aria-live="polite">1850</output></p>
      <p id="atlas-summary" class="c-sum" aria-live="polite"></p>
    </div>
    <fieldset class="map-key">
      <legend>Explanation</legend>
      ${Object.entries(VOCAB.rite.concepts).map(([k, [l]]) => `<label><input type="checkbox" name="rite" value="${k}" checked><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" class="sym sym-${k}"/></svg>${l} congregation</label>`).join('')}
      <label><input type="checkbox" name="layer" value="institution" checked><svg width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" class="sym sym-inst"/></svg>Society or school</label>
      <label><input type="checkbox" name="layer" value="periodical" checked><svg width="14" height="14" aria-hidden="true"><path d="M3.5 3h7v8h-7z M5 5.5h4 M5 7.5h4" class="sym sym-press"/></svg>Periodical</label>
      <label><input type="checkbox" name="layer" value="event" checked><svg width="14" height="14" aria-hidden="true"><path d="M7 2.5 L12 11.5 L2 11.5Z" class="sym sym-event"/></svg>Event, to the year shown</label>
      <p class="key-street">When zoomed into a city:</p>
      <label><input type="checkbox" name="layer" value="site" checked><svg width="14" height="14" aria-hidden="true"><path d="M2.5 7 L7 3 L11.5 7 V11.5 H2.5Z" class="sym sym-synagogue"/></svg>Synagogue or other site</label>
      <label><input type="checkbox" name="layer" value="cemetery" checked><svg width="14" height="14" aria-hidden="true"><path d="M4 12 V6 a3 3 0 0 1 6 0 V12Z" class="sym sym-cemetery"/></svg>Cemetery</label>
      <input type="checkbox" name="layer" value="congregation" checked hidden>
    </fieldset>
  </div>
  <div class="timeline">
    <button type="button" id="play" aria-pressed="false">Play</button>
    <div class="timeline-track">
      <label for="year" class="visually-hidden">Year</label>
      <input type="range" id="year" min="${Y0}" max="${Y1}" step="1" value="1850">
      <ol class="ticks" aria-hidden="true">${[1840, 1845, 1850, 1855, 1860, 1865, 1870].map((y) => `<li class="${y % 10 ? 'minor' : 'major'}" style="left:${((y - Y0) / (Y1 - Y0)) * 100}%"><span>${y % 10 ? '' : y}</span></li>`).join('')}</ol>
    </div>
  </div>
  <section class="gazetteer" aria-labelledby="gaz-h">
    <h2 id="gaz-h">Index of Places</h2>
    <p class="gaz-note">With the number of congregations active in the year shown. Select a name to find it on the map.</p>
    <ol id="place-list" class="place-list"></ol>
    <p class="gaz-note">Congregations are marked at the city; each small circle is one congregation, tinted by its rite at founding, and a dashed ring marks a synagogue without a resident congregation. Zoom into a city, or choose “inside the city” in its entry, to see synagogue buildings and cemeteries at their own addresses; dashed outlines there mean the location is approximate.</p>
  </section>
</div>
<noscript><div class="wrap"><p>The interactive atlas needs JavaScript. Every record is also available as a plain page from <a href="../browse/">Browse</a>.</p></div></noscript>` }));

await out('database/index.html', layout({ rel: '../', title: 'Database', canonical: `${BASE}database/`, current: 'database/',
  description: 'Search and filter every congregation, person, cemetery, synagogue site, periodical, institution, event and place in the Kehillot dataset.',
  scripts: ['assets/js/database.js'],
  body: `<div class="wrap">
  <h1>Database</h1>
  <p class="lede">Search and filter all records. Your query is kept in the address bar, so you can bookmark or share it.</p>
  <div class="db" id="db">
    <div class="tabs" role="tablist" aria-label="Record type">
      ${[['congregations', 'Congregations'], ['people', 'People'], ['cemeteries', 'Cemeteries'], ['sites', 'Sites'], ['periodicals', 'Periodicals'], ['events', 'Events'], ['institutions', 'Institutions'], ['places', 'Places']].map(([t, l], i) => `<button role="tab" type="button" id="tab-${t}" aria-controls="db-panel" aria-selected="${i === 0}" data-type="${t}" tabindex="${i === 0 ? 0 : -1}">${l}</button>`).join('')}
    </div>
    <div id="db-panel" role="tabpanel" aria-labelledby="tab-congregations">
      <form class="db-controls" role="search" onsubmit="return false">
        <label class="db-search">Search <input type="search" id="q" autocomplete="off" placeholder="Name, place, note…"></label>
        <div id="facets" class="facets"></div>
        <button type="button" id="export" class="btn btn-small btn-ghost">Download these results (CSV)</button>
      </form>
      <p id="db-count" class="db-count" aria-live="polite"></p>
      <div class="table-wrap"><table id="db-table" class="db-table"></table></div>
    </div>
  </div>
  <noscript><p>The search interface needs JavaScript. All records are listed on <a href="../browse/">Browse</a> and downloadable from <a href="../datasets/">Datasets</a>.</p></noscript>
</div>` }));

// Browse (no-JS, crawlable list of everything)
const browseSection = (type, rows, fmt) => `<section id="${type}" aria-labelledby="h-${type}"><h2 id="h-${type}">${TYPE_INFO[type].plural} <span class="muted">(${rows.length})</span></h2><ul class="browse-list">${rows.map((r) => `<li>${link('../', type, r.id, type === 'source' ? r.title : r.name)} <span class="muted">${fmt(r)}</span></li>`).join('')}</ul></section>`;
const sortName = (a, b) => (a.name || a.title).localeCompare(b.name || b.title);
await out('browse/index.html', layout({ rel: '../', title: 'Browse', canonical: `${BASE}browse/`, current: 'browse/',
  description: 'Every record in the Kehillot dataset, listed by type.',
  body: `<div class="wrap"><h1>Browse</h1><nav class="toc" aria-label="Record types"><ul>${['congregation', 'person', 'cemetery', 'site', 'periodical', 'event', 'institution', 'place', 'media', 'source'].map((t) => `<li><a href="#${t}">${TYPE_INFO[t].plural}</a></li>`).join('')}</ul></nav>
  ${browseSection('congregation', [...data.congregation].sort(sortName), (r) => `${index.place.get(r.place).name} · ${r.founded}`)}
  ${browseSection('place', [...data.place].sort(sortName), (r) => r.state)}
  ${browseSection('person', [...data.person].sort((a, b) => a.name.split(' ').at(-1).localeCompare(b.name.split(' ').at(-1))), (r) => lifespan(r))}
  ${browseSection('institution', [...data.institution].sort(sortName), (r) => `${index.place.get(r.place).name} · ${r.founded}`)}
  ${browseSection('cemetery', [...data.cemetery].sort(sortName), (r) => `${index.place.get(r.place).name} · est. ${r.established}`)}
  ${browseSection('site', [...data.site].sort(sortName), (r) => `${index.place.get(r.place).name} · ${r.address}`)}
  ${browseSection('periodical', [...data.periodical].sort(sortName), (r) => `${index.place.get(r.place).name} · ${span(r.founded, r.ceased)}`)}
  ${browseSection('event', [...data.event].sort((a, b) => String(a.date).localeCompare(String(b.date))), (r) => formatDate(r.date))}
  <section id="media" aria-labelledby="h-media"><h2 id="h-media">Pictures and documents <span class="muted">(${MEDIA.length})</span></h2><ul class="browse-list">${MEDIA.map((m) => `<li><a href="../media/${m.id}/">${esc(m.title)}</a> <span class="muted">${esc(m.holder)}${m.identifier ? ` · ${esc(m.identifier)}` : ''}</span></li>`).join('')}</ul></section>
  ${browseSection('source', [...data.source].sort((a, b) => a.author.localeCompare(b.author)), (r) => r.author)}
  </div>` }));

const fileSize = (s) => (s > 1024 * 1024 ? `${(s / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(s / 1024))} KB`);
const { stat } = await import('node:fs/promises');
const distRows = [];
for (const [f, mt, title] of DISTS) distRows.push(`<tr><td><a href="../data/${f}" download>${f}</a></td><td>${esc(title)}</td><td><code>${mt}</code></td><td>${fileSize((await stat(path.join(DIST, 'data', f))).size)}</td></tr>`);

await out('datasets/index.html', layout({ rel: '../', title: 'Datasets', canonical: `${BASE}datasets/`, current: 'datasets/',
  description: 'Download the Kehillot data as JSON-LD, N-Triples, CSV with CSVW metadata, GeoJSON and Linked Places Format.',
  jsonld: catalog,
  body: `<div class="wrap prose-wide">
  <h1>Datasets</h1>
  <p class="lede">All data is free to reuse under <a href="${cfg.license.url}" rel="license">${esc(cfg.license.name)}</a>. Version ${cfg.version}, built ${BUILD_DATE}: ${graph.length} entities, ${triples.length.toLocaleString('en-US')} triples.</p>
  <div class="table-wrap"><table class="files"><thead><tr><th scope="col">File</th><th scope="col">Contents</th><th scope="col">Media type</th><th scope="col">Size</th></tr></thead><tbody>${distRows.join('')}</tbody></table></div>
  <h2>Linked data</h2>
  <ul>
    <li><strong>URIs.</strong> Each entity has a hash URI, e.g. <code>${esc(uri('congregation', 'emanu-el-ny'))}</code>. The part before <code>#this</code> is the page that describes it; <code>#this</code> names the congregation itself, following the <a href="https://www.w3.org/TR/cooluris/">Cool URIs for the Semantic Web</a> hash pattern, which works on any static host.</li>
    <li><strong>Per-record data.</strong> Every page embeds its JSON-LD and links to an <code>index.jsonld</code> file with <code>&lt;link rel="alternate"&gt;</code>.</li>
    <li><strong>Vocabularies.</strong> <a href="https://schema.org/">schema.org</a> for core description, <a href="https://www.w3.org/TR/skos-reference/">SKOS</a> for the controlled vocabularies, and a small <a href="../vocab/">project vocabulary</a> for concepts schema.org lacks (rite, orientation, certainty, secessions). The JSON-LD context is published at <a href="../context.jsonld"><code>context.jsonld</code></a>.</li>
    <li><strong>Links out.</strong> <code>schema:sameAs</code> to Wikidata where a match has been reviewed by hand (see <code>data/wikidata.json</code> in the source).</li>
    <li><strong>Related datasets.</strong> The subscriber layer is derived from subscriber lists deposited on Zenodo, each cited by DOI and linked as a <code>schema:Dataset</code> that is <code>about</code> its periodical:<ul>${DATASETS.map((d) => `<li>${dsCitation(d)}</li>`).join('')}</ul></li>
    <li><strong>Catalog.</strong> This page embeds a <a href="https://www.w3.org/TR/vocab-dcat-3/">DCAT</a> / <a href="https://www.w3.org/TR/void/">VoID</a> / schema.org <code>Dataset</code> description (also at <a href="../data/catalog.jsonld">catalog.jsonld</a>), so the dataset can be found by Google Dataset Search and data portals.</li>
    <li><strong>Tabular data.</strong> CSV files are described by <a href="https://www.w3.org/TR/tabular-data-primer/">CSV on the Web</a> metadata; multi-valued cells use <code>|</code> as the separator.</li>
    <li><strong>Gazetteer.</strong> Places are also published in <a href="https://github.com/LinkedPasts/linked-places-format">Linked Places Format</a> for contribution to the World Historical Gazetteer.</li>
  </ul>
  <h2>Example: load into Python</h2>
<pre><code>import pandas as pd
base = "${esc(BASE)}data/"
congs = pd.read_csv(base + "congregations.csv")
places = pd.read_csv(base + "places.csv")
congs.merge(places, left_on="place", right_on="id", suffixes=("", "_place")) \\
     .groupby("region").size()</code></pre>
  <h2>Example: SPARQL over the dump</h2>
  <p>Load <code>kehillot.nt</code> into any triple store (e.g. Apache Jena, Oxigraph, GraphDB) and run:</p>
<pre><code>PREFIX schema: &lt;https://schema.org/&gt;
PREFIX kh: &lt;${esc(BASE)}vocab/#&gt;
SELECT ?name ?founded ?city WHERE {
  ?c a kh:Congregation ; schema:name ?name ; schema:foundingDate ?founded ;
     kh:rite kh:rite-reform ; schema:location/schema:name ?city .
} ORDER BY ?founded</code></pre>
</div>` }));

await out('about/index.html', layout({ rel: '../', title: 'About', canonical: `${BASE}about/`, current: 'about/',
  description: 'Scope, methods, data model, sources and how to cite or contribute to Kehillot.',
  body: `<div class="wrap prose-wide">
  <h1>About the project</h1>
  <p class="lede">${esc(cfg.title)} is a static, open digital atlas and database of Jewish communal life in the United States between ${Y0} and ${Y1}, the era of mass Central European immigration, westward expansion, the first American Reform congregations, and the Civil War.</p>
  <h2 id="scope">Scope</h2>
  <p>The dataset records congregations active at any point in ${Y0}–${Y1} (including colonial-era congregations still active), their synagogue buildings and cemeteries, the periodicals that connected them, the institutions that grew up beside them (benevolent societies, schools, fraternal orders, hospitals), people with documented communal roles, and events that shaped communal life.</p>
  <p>Places are recorded at two scales. Congregations, periodicals, institutions and events are placed at the <strong>city</strong>. Synagogue buildings, other sites and cemeteries are placed at their own <strong>address within the city</strong>, each with a stated precision: <em>exact</em> where the building or grounds survive or the address is documented, <em>approximate</em> where only the street or block is known. Buildings are linked to the congregations that used them, with dates, so a congregation's moves across a city can be traced.</p>
  <p>This is a <strong>seed dataset</strong>: it covers the major communities documented in the standard secondary literature, not the hundreds of small congregations and burial societies that also existed. It is designed to grow.</p>
  <h2 id="method">Method and certainty</h2>
  <ul>
    <li>Every congregation, institution, person and event cites at least one source. The build fails if a citation is missing or points nowhere.</li>
    <li>Founding dates are notoriously slippery: a congregation may date itself from its first minyan, its charter, or its first building. Records whose dates vary between sources carry <em>medium</em> certainty. Check the cited sources before relying on them.</li>
    <li>Rite records the minhag at founding; orientation records where a congregation stood by about 1870. Both are simplifications of contested, gradual change.</li>
    <li>Wikidata matches are proposed by a script (<code>scripts/reconcile.mjs</code>) and accepted by hand; unmatched records carry no <code>sameAs</code> rather than a guessed one.</li>
  </ul>
  <h2 id="model">Data model</h2>
  <figure class="model">${modelDiagram()}<figcaption>Entities and the properties that link them.</figcaption></figure>
  <h2 id="cite">How to cite</h2>
  <p class="cite-text">${esc(cfg.title)}: ${esc(cfg.subtitle)}. Version ${cfg.version}. ${esc(cfg.publisher)}, ${BUILD_DATE.slice(0, 4)}. ${esc(BASE)}</p>
  <p>Each record page has its own citation with a permanent URI.</p>
  <h2 id="contribute">Contributing corrections</h2>
  <p>The data lives in plain JSON files in the <code>data/</code> folder of the source repository. Edit a record, add a source, run <code>node scripts/build.mjs</code>; the build validates every reference before publishing.</p>
  <h2 id="principles">Principles</h2>
  <ul>
    <li><a href="https://www.go-fair.org/fair-principles/">FAIR</a>: findable (stable URIs, DCAT, sitemap), accessible (static files, no login), interoperable (RDF, CSVW, GeoJSON, LPF), reusable (CC BY, provenance on every record).</li>
    <li>Minimal computing: no server, database or framework. The site is plain HTML, CSS and JavaScript that any host, or a USB stick, can serve, and the whole thing can be archived as-is.</li>
    <li>Accessible: semantic HTML, keyboard navigation, a text list alongside the map, and a data table behind every chart.</li>
  </ul>
  <h2 id="sources">Principal sources</h2>
  <ol class="sources">${[...data.source].sort((a, b) => a.author.localeCompare(b.author)).map((s) => `<li>${citationText(s)}</li>`).join('')}</ol>
  <h2>Credits</h2>
  <p>Basemap © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>. Mapping with <a href="https://leafletjs.com/">Leaflet</a>.</p>
</div>` }));

function modelDiagram() {
  const box = (x, y, label, sub) => `<g><rect x="${x}" y="${y}" width="150" height="54" rx="6" class="m-box"/><text x="${x + 75}" y="${y + 24}" text-anchor="middle" class="m-label">${label}</text><text x="${x + 75}" y="${y + 42}" text-anchor="middle" class="m-sub">${sub}</text></g>`;
  const edge = (x1, y1, x2, y2, label, lx, ly) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="m-edge" marker-end="url(#arr)"/><text x="${lx}" y="${ly}" class="m-elabel" text-anchor="middle">${label}</text>`;
  return `<svg viewBox="0 0 720 330" class="model-svg" role="img" aria-labelledby="mt md"><title id="mt">Kehillot data model</title>
  <desc id="md">Person is linked to Congregation and Institution through schema:memberOf Role nodes. Congregation, Institution and Event have schema:location pointing to Place. Event has kh:involves pointing to Person and organizations. All link to Source through schema:citation.</desc>
  <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" class="m-arrow"/></marker></defs>
  ${edge(160, 57, 285, 57, 'memberOf → Role', 222, 47)}
  ${edge(160, 75, 285, 162, 'memberOf → Role', 205, 130)}
  ${edge(435, 57, 560, 150, 'location', 520, 92)}
  ${edge(435, 175, 560, 175, 'location', 497, 167)}
  ${edge(435, 270, 560, 195, 'location', 512, 250)}
  ${edge(285, 262, 160, 75, 'involves', 205, 200)}
  ${edge(360, 84, 360, 148, 'splitFrom (self)', 398, 120)}
  ${box(10, 30, 'Person', 'schema:Person')}
  ${box(285, 30, 'Congregation', 'kh:Congregation')}
  ${box(285, 148, 'Institution', 'schema:NGO …')}
  ${box(285, 248, 'Event', 'schema:Event')}
  ${box(560, 148, 'Place', 'schema:City')}
  ${box(10, 248, 'Source', 'schema:Book …')}
  ${box(560, 30, 'Site', 'schema:Synagogue …')}
  ${box(560, 248, 'Cemetery', 'schema:Cemetery')}
  ${edge(435, 45, 560, 50, 'occupancy ←', 497, 38)}
  ${edge(635, 84, 635, 148, 'containedInPlace', 690, 120)}
  ${edge(635, 248, 635, 202, 'containedInPlace', 690, 230)}
  ${edge(435, 75, 560, 262, 'maintainedBy ←', 470, 215)}
  <text x="85" y="320" text-anchor="middle" class="m-elabel">← citation (from every record)</text>
  </svg>`;
}

await out('vocab/index.html', layout({ rel: '../', title: 'Vocabulary', canonical: `${BASE}vocab/`, current: '',
  description: 'Classes, properties and SKOS concept schemes used in the Kehillot dataset.', alternate: 'index.jsonld',
  body: `<div class="wrap prose-wide"><h1>Vocabulary</h1>
  <p class="lede">Namespace <code>${esc(BASE)}vocab/#</code> (prefix <code>kh:</code>). Machine-readable: <a href="index.jsonld">index.jsonld</a>.</p>
  <h2 id="Congregation">Class: kh:Congregation</h2><p>A Jewish religious congregation (<i>kahal</i>), distinct from the building in which it worshipped. Subclass of <code>schema:Organization</code>.</p>
  <h2>Properties</h2><dl class="vocab-props">${vocabGraph.filter((n) => n['@type'] === 'rdf:Property').map((n) => `<div id="${n['@id'].slice(3)}"><dt><code>${n['@id']}</code></dt><dd>${esc(n['rdfs:label'])}</dd></div>`).join('')}</dl>
  ${Object.entries(VOCAB).map(([scheme, v]) => `<h2 id="${scheme}">Concept scheme: ${esc(v.label)}</h2><dl class="vocab-props">${Object.entries(v.concepts).map(([k, [l, d]]) => `<div id="${scheme}-${k}"><dt><code>kh:${scheme}-${k}</code> — ${esc(l)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>`).join('')}
  </div>` }));

await out('404.html', layout({ rel: BASE, title: 'Not found', canonical: `${BASE}404.html`, description: 'Page not found.',
  body: `<div class="wrap prose-wide"><h1>Page not found</h1><p>Try the <a href="${BASE}browse/">list of all records</a> or the <a href="${BASE}database/">database search</a>.</p></div>` }));


// ───────────────────────── media pages ─────────────────────────
function mediaNode(m) {
  return strip({
    '@id': uri('media', m.id), '@type': 'schema:ImageObject', mainEntityOfPage: docUri('media', m.id),
    name: m.title, description: m.description || undefined, identifier: m.identifier || undefined,
    url: m.page, contentUrl: m.image.full, thumbnailUrl: m.image.thumb,
    license: m.licenseUrl || undefined, creditText: [m.holder, m.attribution].filter(Boolean).join('. '),
    holderDate: m.date ? String(m.date) : undefined,
    about: m.about.map((a) => uri(a.type, a.id)),
    isPartOf: m.collection ? m.collection.url : undefined,
    iiifManifest: m.manifest || undefined, iiifService: m.image.service || undefined,
    contentLocation: m.geo ? { '@type': 'schema:Place', geo: { '@type': 'schema:GeoCoordinates', latitude: String(m.geo.lat), longitude: String(m.geo.lon) } } : undefined,
  });
}

for (const m of MEDIA) {
  const rel = '../../';
  const n = mediaNode(m);
  const depicted = m.about.map((a) => `${link(rel, a.type, a.id, nameOf(a.type, a.id))} <span class="muted">${TYPE_INFO[a.type].label}</span>`);
  const viewer = m.source === 'iiif' && m.image.service
    ? `<div class="viewer" id="osd" data-services="${esc(JSON.stringify(m.pages.map((p) => p.service).filter(Boolean)))}" role="img" aria-label="${esc(m.title)}, zoomable"><noscript><img src="${esc(m.image.medium)}" alt="${esc(m.title)}"></noscript></div>
       <p class="viewer-help small">Scroll or pinch to zoom; drag to pan.${m.pages.length > 1 ? ` ${m.pages.length} images: use the arrows to turn pages.` : ''}</p>`
    : `<a class="viewer-img" href="${esc(m.page)}"><img src="${esc(m.image.full)}" alt="${esc(m.title)}"${m.image.width ? ` width="${m.image.width}" height="${m.image.height}"` : ''}></a>`;
  const others = m.collection ? MEDIA.filter((x) => x.collection?.id === m.collection.id && x.id !== m.id) : [];
  const body = `<div class="wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${rel}">Home</a></li><li><a href="${rel}browse/#media">Pictures and documents</a></li><li aria-current="page">${esc(m.title)}</li></ol></nav>
  <article class="record record-media">
    <header class="record-head"><p class="kicker">${m.source === 'iiif' ? 'Document or artwork' : 'Photograph'}</p><h1>${esc(m.title)}</h1></header>
    <div class="media-grid">
      <figure class="media-figure">${viewer}
        <figcaption>${m.description ? `${esc(m.description)} ` : ''}<span class="credit">${esc(m.holder)}${m.attribution && !m.attribution.includes(m.holder) ? `. ${esc(m.attribution)}` : ''}. ${rightsLink(m)}.</span></figcaption>
      </figure>
      <div class="media-meta">
        ${dl([
          ['Depicts / about', depicted.join('<br>')],
          ['Date', m.date ? `${esc(m.date)}${m.dateNote ? `<br><span class="muted small">${esc(m.dateNote)}</span>` : '<br><span class="muted small">As given by the holder.</span>'}` : ''],
          ['Holder', m.holderUrl ? `<a href="${esc(m.holderUrl)}">${esc(m.holder)}</a>` : esc(m.holder)],
          ['Collection', m.collection ? `<a href="${esc(m.collection.url)}">${esc(m.collection.title)}</a>${m.collection.identifier ? ` <span class="muted">(${esc(m.collection.identifier)})</span>` : ''}` : esc(m.collection || '')],
          ['Identifier', esc(m.identifier || '')],
          ['Rights', rightsLink(m)],
          ['Where', m.geo ? `${m.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(', ')} <span class="muted small">(${m.geo.lat.toFixed(5)}, ${m.geo.lon.toFixed(5)}, geotag by holder)</span>` : m.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(', ')],
          ['Original', `<a href="${esc(m.page)}">View at ${esc(sourceName(m))}</a>${m.manifest ? ` · <a href="${esc(m.manifest)}" type="application/ld+json">IIIF manifest</a>` : ''}`],
        ])}
        ${m.places.filter((p) => CITY_IDS.includes(p)).map((p) => `<p><a class="btn btn-small btn-ghost" href="${rel}city/${p}/">Explore ${esc(index.place.get(p).name)} →</a></p>`).join('')}
      </div>
    </div>
    ${others.length ? gallery(rel, others, { heading: `More from “${esc(m.collection.title)}”`, limit: 12, more: `in <a href="${esc(m.collection.url)}">the album</a>` }) : ''}
    <section class="cite"><h2>Cite this item</h2><p class="cite-text">“${esc(m.title)}.” ${esc(m.holder)}${m.identifier ? `, ${esc(m.identifier)}` : ''}. ${esc(m.page)}. Linked in <cite>${esc(cfg.title)}</cite>, <span class="uri">${esc(uri('media', m.id))}</span>.</p>
    <p class="data-links">Machine-readable: <a href="index.jsonld">JSON-LD</a></p></section>
  </article></div>`;
  await out(`media/${m.id}/index.jsonld`, JSON.stringify({ '@context': `${BASE}context.jsonld`, ...n }, null, 2));
  await out(`media/${m.id}/index.html`, layout({ rel, title: m.title, description: (m.description || `${m.title}, ${m.holder}`).slice(0, 300), canonical: docUri('media', m.id),
    alternate: 'index.jsonld', jsonld: { '@context': CONTEXT, ...n }, body, current: 'browse/',
    scripts: m.source === 'iiif' && m.image.service ? ['assets/vendor/openseadragon/openseadragon.min.js', 'assets/js/viewer.js'] : [] }));
}

// ───────────────────────── city guides ─────────────────────────
const KIND_ORDER = { synagogue: 0, cemetery: 1, hospital: 2, school: 2, 'meeting-place': 3, business: 4, residence: 5 };
const KIND_GROUP = { synagogue: 'Synagogues', cemetery: 'Cemeteries', hospital: 'Other sites', school: 'Other sites', 'meeting-place': 'Other sites', business: 'Other sites', residence: 'Other sites' };
function cityEntries(placeId, rel) {
  const sites = (siteByPlace.get(placeId) || []).map((s) => ({ type: 'site', r: s, kind: s.kind, from: s.built || (s.occupants || []).map((o) => o.from).filter(Boolean).sort()[0] || null, to: null }));
  const cems = (cemByPlace.get(placeId) || []).map((c) => ({ type: 'cemetery', r: c, kind: 'cemetery', from: c.established, to: c.closed || null }));
  return [...sites, ...cems].sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || ((a.from || 9999) - (b.from || 9999))).map((e) => {
    const s = e.r;
    const pics = mediaByRecord.get(`${e.type}/${s.id}`) || [];
    const users = e.type === 'site'
      ? (s.occupants || []).map((o) => `${link(rel, typeOfOrg(o.org), o.org, nameOf(typeOfOrg(o.org), o.org))}${o.from ? ` <span class="muted">${span(o.from, o.to)}</span>` : ''}`)
        .concat((s.people || []).map((p) => link(rel, 'person', p, nameOf('person', p))))
      : (s.owners || []).map((o) => link(rel, 'congregation', o, nameOf('congregation', o)));
    const evs = e.type === 'site' ? eventsBySite.get(s.id) || [] : [];
    return { ...e, pics, html: `<li class="entry" id="e-${s.id}" data-id="${s.id}" data-kind="${e.kind}" data-group="${KIND_GROUP[e.kind]}" data-lat="${s.lat}" data-lon="${s.lon}" data-from="${e.from || ''}" data-to="${e.type === 'cemetery' ? '' : e.to || ''}" data-precision="${s.precision}" data-pics="${pics.length}">
      <button type="button" class="entry-head" aria-expanded="false"><span class="entry-sym sym-${e.kind === 'cemetery' ? 'cemetery' : e.kind === 'synagogue' ? 'synagogue' : 'building'}${s.precision === 'approximate' ? ' approx' : ''}" aria-hidden="true"></span><span class="entry-name">${esc(s.name)}</span><span class="entry-years">${e.from ? span(e.from, e.to) : ''}</span></button>
      <div class="entry-body">
        <p class="entry-addr">${esc(s.address)}${s.precision === 'approximate' ? ' <span class="muted">(location approximate)</span>' : ''}</p>
        ${s.note ? `<p>${esc(s.note)}</p>` : ''}
        ${users.length ? `<p><span class="entry-label">${e.type === 'site' ? 'Used by' : 'Maintained by'}</span> ${users.join(', ')}</p>` : ''}
        ${evs.length ? `<p><span class="entry-label">Here</span> ${evs.map((x) => `${link(rel, 'event', x.id, x.name)} <span class="muted">${formatDate(x.date)}</span>`).join('; ')}</p>` : ''}
        ${pics.length ? `<ul class="entry-thumbs">${pics.slice(0, 6).map((m) => `<li><a href="${rel}media/${m.id}/"><img src="${esc(m.image.square || m.image.thumb)}" alt="${esc(m.title)}" loading="lazy" width="64" height="64"></a></li>`).join('')}${pics.length > 6 ? `<li class="entry-more"><a href="${rel}${docPath(e.type, s.id)}#h-gal-${pics[0].id}">+${pics.length - 6}</a></li>` : ''}</ul>` : ''}
        <p><a href="${rel}${docPath(e.type, s.id)}">Full record →</a></p>
      </div></li>` };
  });
}
function congregationMoves(placeId, rel) {
  const cs = (congByPlace.get(placeId) || []).sort((a, b) => a.founded - b.founded);
  if (!cs.length) return '';
  return `<section class="moves" aria-labelledby="h-moves"><h2 id="h-moves">Where the congregations worshipped</h2>
  <p class="section-note">Each congregation's recorded buildings in order, with its burial grounds. Many congregations met in rented rooms that are not yet mapped.</p>
  <ol class="moves-list">${cs.map((c) => {
    const sites = (sitesByOrg.get(c.id) || []).sort((a, b) => (a.from || 0) - (b.from || 0));
    const cems = cemByOwner.get(c.id) || [];
    return `<li><div class="moves-head">${link(rel, 'congregation', c.id, c.name)} <span class="muted">est. ${c.founded}</span> ${badge('rite', c.rite)}</div>
      ${sites.length ? `<ol class="moves-path">${sites.map((x) => `<li><a href="#e-${x.site.id}" data-goto="${x.site.id}">${esc(x.site.name.replace(/^.*?,\s*/, '') || x.site.name)}</a> <span class="muted">${span(x.from, x.to)}</span></li>`).join('')}</ol>` : '<p class="muted small">No building mapped yet.</p>'}
      ${cems.length ? `<p class="moves-cem small">Burials: ${cems.map((x) => `<a href="#e-${x.id}" data-goto="${x.id}">${esc(x.name.replace(/\s*\(.*\)/, ''))}</a>`).join(', ')}</p>` : ''}</li>`;
  }).join('')}</ol></section>`;
}
function cityTimeline(placeId, rel) {
  const rows = [];
  for (const c of congByPlace.get(placeId) || []) rows.push([c.founded, `${link(rel, 'congregation', c.id, c.name)} founded`]);
  for (const s of siteByPlace.get(placeId) || []) if (s.built) rows.push([s.built, `${link(rel, 'site', s.id, s.name)} built or acquired`]);
  for (const c of cemByPlace.get(placeId) || []) rows.push([c.established, `${link(rel, 'cemetery', c.id, c.name)} established`]);
  for (const o of instByPlace.get(placeId) || []) rows.push([o.founded, `${link(rel, 'institution', o.id, o.name)} founded`]);
  for (const o of perByPlace.get(placeId) || []) rows.push([o.founded, `<i>${link(rel, 'periodical', o.id, o.name)}</i> begins publication`]);
  for (const e of [...(eventByPlace.get(placeId) || []), ...(eventAlsoByPlace.get(placeId) || [])]) rows.push([yearOf(e.date), link(rel, 'event', e.id, e.name)]);
  if (!rows.length) return '';
  rows.sort((a, b) => a[0] - b[0]);
  const byYear = rows.reduce((m, [y, h]) => m.set(y, [...(m.get(y) || []), h]), new Map());
  return `<section class="city-timeline" aria-labelledby="h-tl"><h2 id="h-tl">Chronology</h2><dl class="tl">${[...byYear].map(([y, hs]) => `<div><dt>${y}</dt><dd>${hs.join('<br>')}</dd></div>`).join('')}</dl></section>`;
}
for (const placeId of CITY_IDS) {
  const p = index.place.get(placeId);
  const rel = '../../';
  const C = cityConfig[placeId] || {};
  const entries = cityEntries(placeId, rel);
  const pics = mediaByPlace.get(placeId) || [];
  // On the street map, only pictures geotagged inside the city itself (≈12 km); others stay in the gallery.
  const geoPics = pics.filter((m) => m.geo && nearestPlace(m.geo.lat, m.geo.lon) === placeId && Math.hypot(m.geo.lat - p.lat, m.geo.lon - p.lon) < 0.12);
  const years = entries.map((e) => e.from).filter(Boolean);
  const yMin = Math.min(Y0, ...years), yMax = Math.max(Y1, ...years);
  const groups = ['Synagogues', 'Cemeteries', 'Other sites'];
  const counts = Object.fromEntries(groups.map((g) => [g, entries.filter((e) => KIND_GROUP[e.kind] === g).length]));
  const cityData = {
    tiles: { relief: cfg.basemap, street: cfg.streetmap }, center: [p.lat, p.lon], range: [yMin, yMax],
    photos: geoPics.map((m) => ({ id: m.id, title: m.title, lat: m.geo.lat, lon: m.geo.lon, thumb: m.image.square || m.image.thumb, href: `${rel}media/${m.id}/`, date: m.date ? String(m.date).slice(0, 4) : null })),
  };
  const others = [
    ...(instByPlace.get(placeId) || []).map((o) => `${link(rel, 'institution', o.id, o.name)} <span class="muted">${o.founded}</span>`),
    ...(perByPlace.get(placeId) || []).map((o) => `<i>${link(rel, 'periodical', o.id, o.name)}</i> <span class="muted">${span(o.founded, o.ceased)}</span>`),
  ];
  const ps = peopleByPlace.get(placeId) || [];
  const title = C.title || `Jewish ${p.name}`;
  const body = `<div class="city wrap">
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${rel}">Home</a></li><li><a href="${rel}cities/">City guides</a></li><li aria-current="page">${esc(p.name)}</li></ol></nav>
  <header class="city-head">
    <p class="kicker">City guide · ${esc(p.state)}</p>
    <h1>${esc(title)}</h1>
    <p class="city-counts">${[counts.Synagogues && `${counts.Synagogues} synagogue${counts.Synagogues === 1 ? '' : 's'}`, counts.Cemeteries && `${counts.Cemeteries} cemeter${counts.Cemeteries === 1 ? 'y' : 'ies'}`, counts['Other sites'] && `${counts['Other sites']} other site${counts['Other sites'] === 1 ? '' : 's'}`, pics.length && `${pics.length} picture${pics.length === 1 ? '' : 's'} and documents`].filter(Boolean).join(' · ')}</p>
    ${(C.intro || []).map((t) => `<p class="city-intro">${esc(t)}</p>`).join('')}
    ${C.sources?.length ? `<p class="small muted">Sources: ${C.sources.map((s) => `<i>${link(rel, 'source', s, index.source.get(s).title.split(/[:(]/)[0].trim())}</i>`).join('; ')}. Full records: <a href="${rel}place/${placeId}/">${esc(p.name)}</a>.</p>` : `<p class="small"><a href="${rel}place/${placeId}/">All records for ${esc(p.name)} →</a></p>`}
  </header>
  <div class="explorer">
    <div class="plate explorer-map"><div id="city-map" class="city-map" role="region" aria-label="Map of Jewish sites in ${esc(p.name)}"></div></div>
    <section class="explorer-panel" aria-labelledby="h-places">
      <h2 id="h-places" class="visually-hidden">Places on the map</h2>
      <div class="explorer-controls">
        ${yMin < yMax ? `<label class="yr"><span>Standing in</span> <output id="city-year-out" for="city-year">${yMax}</output><input type="range" id="city-year" min="${yMin}" max="${yMax}" value="${yMax}" step="1"></label>` : ''}
        <fieldset class="filters"><legend class="visually-hidden">Show</legend>
          ${groups.filter((g) => counts[g]).map((g) => `<label><input type="checkbox" name="group" value="${g}" checked> ${g} <span class="muted">${counts[g]}</span></label>`).join('')}
          ${geoPics.length ? `<label><input type="checkbox" name="group" value="Pictures" checked> Pictures <span class="muted">${geoPics.length}</span></label>` : ''}
        </fieldset>
        <p id="city-count" class="city-count" aria-live="polite"></p>
      </div>
      <ol class="entries" id="city-list">${entries.map((e) => e.html).join('')}</ol>
      ${!entries.length ? '<p class="muted">No buildings or cemeteries mapped yet; the pictures below are placed where their holders geotagged them.</p>' : ''}
    </section>
  </div>
  <script type="application/json" id="city-data">${JSON.stringify(cityData).replace(/</g, '\\u003c')}</script>
  ${congregationMoves(placeId, rel)}
  ${readersSection(rel, placeId, { names: true })}
  ${gallery(rel, pics, { heading: 'Pictures and documents', limit: 48 })}
  <div class="city-cols">
    ${cityTimeline(placeId, rel)}
    <div>
      ${others.length ? `<section><h2>Institutions and periodicals</h2>${ul(others)}</section>` : ''}
      ${ps.length ? `<section><h2>People</h2>${ul(ps.map((x) => `${link(rel, 'person', x.id, x.name)} <span class="muted">${lifespan(x)}</span>`))}</section>` : ''}
    </div>
  </div>
</div>`;
  const ld = { '@context': 'https://schema.org', '@type': 'TouristDestination', name: title, url: `${BASE}city/${placeId}/`, about: { '@id': uri('place', placeId) },
    includesAttraction: entries.map((e) => ({ '@id': uri(e.type, e.r.id), name: e.r.name })) };
  await out(`city/${placeId}/index.html`, layout({ rel, title, description: `${title}: synagogues, cemeteries, pictures and documents on a map${C.intro ? '. ' + C.intro[0] : ''}`.slice(0, 300),
    canonical: `${BASE}city/${placeId}/`, jsonld: ld, body, current: 'cities/',
    styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/city.js'] }));
}

// Cities index
const cityCards = CITY_IDS.map((id) => {
  const p = index.place.get(id);
  const n = (siteByPlace.get(id) || []).length + (cemByPlace.get(id) || []).length;
  const pics = mediaByPlace.get(id) || [];
  const cover = pics.find((m) => m.feature) || pics[0];
  return { id, p, n, pics, cover, score: n * 3 + pics.length };
}).sort((a, b) => b.score - a.score);
await out('cities/index.html', layout({ rel: '../', title: 'City guides', canonical: `${BASE}cities/`, current: 'cities/',
  description: 'Explore Jewish sites city by city: synagogues, cemeteries and other places on street maps, with pictures and documents from libraries and museums.',
  body: `<div class="wrap"><h1>City guides</h1>
  <p class="lede">Walk through a city's Jewish places: synagogue buildings, cemeteries, shops and homes on a street map, with pictures and documents from libraries and museums.</p>
  <ul class="city-cards">${cityCards.map((c) => `<li><a class="city-card" href="../city/${c.id}/">
    ${c.cover ? `<img src="${esc(c.cover.image.thumb)}" alt="" loading="lazy">` : '<span class="city-card-blank" aria-hidden="true"></span>'}
    <span class="city-card-body"><strong>${esc(cityConfig[c.id]?.title || `Jewish ${c.p.name}`)}</strong><span class="muted">${esc(c.p.state)}</span>
    <span class="small">${[c.n && `${c.n} mapped site${c.n === 1 ? '' : 's'}`, c.pics.length && `${c.pics.length} picture${c.pics.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span></span></a></li>`).join('')}</ul></div>` }));


await out('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
const htmlPages = written.filter((f) => f.endsWith('index.html'));
await out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${htmlPages
  .map((f) => `  <url><loc>${BASE}${f.replace(/index\.html$/, '')}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join('\n')}\n</urlset>\n`);

console.log(`✓ Built ${written.length} files into dist/ (${graph.length} entities, ${triples.length} triples) with base ${BASE}`);
