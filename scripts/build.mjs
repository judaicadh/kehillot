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
import vm from 'node:vm';
import { createHash } from 'node:crypto';
// assets/js/symbols.js is a browser script; evaluate it in a sandbox so the build draws the same symbols as the maps.
const SYM = await (async () => { const sb = { module: { exports: {} } }; vm.runInNewContext(await readFile(new URL('../assets/js/symbols.js', import.meta.url), 'utf8'), sb); return sb.module.exports; })();

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
const TILES = JSON.stringify({ relief: cfg.basemap, street: cfg.streetmap, terrain: cfg.terrain });
const LOCATED = ['cemetery', 'site']; // types with their own coordinates inside a city
const population = await readJSON('data/population.json');
const wikidata = existsSync(path.join(ROOT, 'data/wikidata.json')) ? await readJSON('data/wikidata.json') : {};
const mediaConfig = existsSync(path.join(ROOT, 'data/media.json')) ? await readJSON('data/media.json') : { collections: [], items: [] };
const mediaCache = existsSync(path.join(ROOT, 'data/media-cache.json')) ? await readJSON('data/media-cache.json') : { items: {}, collections: {} };
const claimEvidence = await readJSON('data/evidence.json');
const occidentArchive = await readJSON('data/occident-articles.json');
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
      'matzah-bakery': ['Matzah bakery', 'A bakery producing matzah for Passover, often under rabbinic supervision.'],
      lodging: ['Hotel or boarding house', 'Lodging kept by or advertised to Jews, including kosher boarding houses.'],
      'kosher-restaurant': ['Kosher restaurant', 'An eating house advertised as kosher.'],
      bookstore: ['Bookstore', 'A seller of Hebrew and Jewish books, prayer books and religious goods.'],
      hospital: ['Hospital building', 'A building used by a Jewish hospital.'],
      school: ['School or educational institution', 'A day school, Sunday school, seminary or educational society, or the building it used.'],
      'meeting-place': ['Meeting place', 'A café, hall or house where an organization met or was founded.'],
      business: ['Jewish-owned business', 'A shop, market or firm owned by Jews.'],
      residence: ['Residence', 'A family home.'],
    },
  },
  precision: {
    label: 'Precision of location',
    concepts: {
      exact: ['Exact', 'The building or grounds survive or the address is documented; the point is on the site.'],
      approximate: ['Approximate', 'Placed on the right street or block from a documented description; may be off by up to a few hundred metres.'],
      city: ['City only', 'Placed at the city centre because the address has not yet been located.'],
    },
  },
  clergyTitle: {
    label: 'Clergy and religious functionaries',
    concepts: {
      rabbi: ['Rabbi', 'Ordained or so-styled rabbi.'],
      hazan: ['Hazan', 'Cantor and reader; often the congregation\'s chief religious officer in this period.'],
      minister: ['Minister', 'Title used by many American congregations for their hazan or preacher (often "Reverend").'],
      preacher: ['Preacher', 'Engaged to deliver sermons.'],
      chaplain: ['Chaplain', 'Military or hospital chaplain.'],
      shochet: ['Shochet', 'Ritual slaughterer.'],
      mohel: ['Mohel', 'Performs circumcisions.'],
      shammash: ['Shammash', 'Sexton.'],
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
    if (type === 'congregation' && (!r.rite || !r.orientation)) errors.push(`${at}: congregations need a rite and an orientation`);
    for (const c of r.contributors || []) { if (!c.name && !c.github) errors.push(`${at}: contributor needs a name or GitHub username`); if (c.orcid && !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(c.orcid)) errors.push(`${at}: ORCID "${c.orcid}" is not in 0000-0000-0000-0000 form`); }
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
    for (const k of ['opened', 'closed', 'built']) if (r[k] != null && type === 'site' && !Number.isInteger(r[k])) errors.push(`${at}: ${k} must be a year`);
    for (const p of r.proprietors || []) if (!index.person.has(p)) errors.push(`${at}: unknown proprietor "${p}"`);
    for (const x of r.supervisedBy || []) if (!(x.type === 'person' ? index.person.has(x.id) : index.congregation.has(x.id))) errors.push(`${at}: unknown supervisor ${x.type}/${x.id}`);
    for (const x of r.advertisedIn || []) { if (!index.periodical.has(x.periodical)) errors.push(`${at}: unknown periodical "${x.periodical}" in advertisedIn`); if (x.date && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(x.date)) errors.push(`${at}: advertisedIn date must be YYYY, YYYY-MM or YYYY-MM-DD`); }
    if (type === 'person') for (const t of r.clergyTitles || []) if (!VOCAB.clergyTitle.concepts[t]) errors.push(`${at}: clergy title "${t}" not in vocabulary`);
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
for (const [key, fields] of Object.entries(claimEvidence)) {
  const [type, id] = key.split('/'), record = index[type]?.get(id);
  if (!record) { errors.push(`Evidence: unknown record ${key}`); continue; }
  for (const [field, entries] of Object.entries(fields)) {
    if (!['founded','dissolved','established','built','opened','closed','ceased','date','location'].includes(field) || (field !== 'location' && record[field] == null)) errors.push(`Evidence: invalid field ${key}/${field}`);
    if (!Array.isArray(entries) || !entries.length) { errors.push(`Evidence: no passages for ${key}/${field}`); continue; }
    for (const e of entries) if (!record.sources?.includes(e.source) || !index.source.has(e.source) || !e.locator?.trim()) errors.push(`Evidence: source and precise locator required for ${key}/${field}`);
  }
}
const archiveIds = new Set();
for (const a of occidentArchive.articles) {
  if (!a.id || archiveIds.has(a.id) || !a.title || !/^http:\/\/www\.theoccident\.com\/Occident\/volume\d+\//.test(a.url) || !/^\d{4}-\d{2}$/.test(a.date)) errors.push(`Invalid Occident catalogue entry: ${a.id}`);
  archiveIds.add(a.id);
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
const clergyTitles = (p) => [...new Set([...(p.clergyTitles || []), ...(p.occupation || []).filter((o) => VOCAB.clergyTitle.concepts[o])])];
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
      title: untitled ? (col?.captionPrefix ? `${col.captionPrefix} ${(m.title.match(/[-_](\d+(?:_\d+)?)\.\w+$/)||[])[1] || ''}`.trim() : col?.untitled || 'Untitled item') : m.title,
      displayDate: col?.displayDate || null,
      photographer: col?.photographer || null,
      contextLabel: col?.contextLabel || null,
      identifier: untitled ? m.title.replace(/\.\w+$/, '') : (m.description.match(/\[([^\]]+)\]\s*$/) || [])[1] || m.identifier || null,
      description: (m.description || '').replace(/\s*\[[^\]]+\]\s*$/, ''),
      about, places, feature: !!own?.feature,
      holder: own?.holder || col?.holder || m.creator, holderUrl: own?.holderUrl || col?.holderUrl || m.creatorUrl,
      collection: col ? { id: col.id, title: colMeta.title, url: col.url, description: colMeta.description, identifier: col.identifier, cityGuides:col.cityGuides || [] } : null,
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
// Keep subscriber localities discoverable without promoting them to curated congregation records.
const READ_PLACE_MAP = new Map();
for (const paper of Object.keys(READERS)) for (const x of READERS[paper].places) {
  const k = x.qid || x.k;
  if (!READ_PLACE_MAP.has(k)) {
    const own = x.qid ? placeIdByQid.get(x.qid) || null : null;
    READ_PLACE_MAP.set(k, { k, name: x.name, state: x.state, country: x.country, qid: x.qid, lat: x.lat, lon: x.lon, own,
      cityId: own || `subscriber-${x.qid ? x.qid.toLowerCase() : createHash('sha256').update(String(k)).digest('hex').slice(0, 16)}`, keys: {}, y: {} });
  }
  const place = READ_PLACE_MAP.get(k);
  place.keys[paper] = x.k;
  const undated = x.n - Object.values(x.y).reduce((a,b)=>a+b,0);
  place.y[paper] = undated > 0 ? { ...x.y, 0: undated } : x.y;
}
const READ_PLACES = [...READ_PLACE_MAP.values()];
const subscriptionCount = p => Object.values(p.y).reduce((n, years) => n + Object.values(years).reduce((a,b)=>a+b,0),0);

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

const CITY_IDS = data.place.filter((p) => (siteByPlace.get(p.id) || []).length || (cemByPlace.get(p.id) || []).length || (mediaByPlace.get(p.id) || []).length || readersFor(p.id).length).map((p) => p.id);

const ALL_GUIDES = new Map([...data.place.map(p=>[p.id,p.name]),...READ_PLACES.filter(p=>!p.own).map(p=>[p.cityId,p.name])]);
for (const col of mediaConfig.collections || []) for(const id of col.cityGuides || []) if(!ALL_GUIDES.has(id)) throw new Error(`Unknown collection city guide: ${col.id}/${id}`);
const collectionUri = id => `${BASE}collections/${id}/#this`;
function cityCollections(id,rel) {
  const cols=(mediaConfig.collections || []).filter(c=>(c.cityGuides || []).includes(id));
  if(!cols.length)return '';
  return `<section class="city-collections"><h2>Pictures &amp; archival collections</h2><p class="small muted">Related source collections may contain later documentation. Collection dates do not establish dates for every item.</p><ul class="related">${cols.map(c=>`<li><a href="${rel}collections/${c.id}/">${esc(mediaCache.collections[c.id].title)}</a><br><span class="small muted">${esc(c.contextLabel || '')}</span></li>`).join('')}</ul></section>`;
}
const sourceName = (m) => (m.source === 'iiif' ? (m.holder || 'the holder') : 'Flickr');
const rightsLink = (m) => (m.licenseUrl ? `<a href="${esc(m.licenseUrl)}" rel="license">${esc(m.licenseLabel)}</a>` : esc(m.licenseLabel));
const thumbFig = (m, rel, cls = '') => `<li class="thumb ${cls}"><a href="${rel}media/${m.id}/"><img src="${esc(m.image.thumb)}" alt="${esc(m.title)}" loading="lazy" decoding="async"${m.image.width && m.image.height ? ` width="${Math.min(320, m.image.width)}" height="${Math.round(Math.min(320, m.image.width) * m.image.height / m.image.width)}"` : ''}><span class="thumb-cap">${esc(m.title)}${m.date || m.displayDate ? ` <span class="muted">${m.displayDate ? `Photographed ${esc(m.displayDate)}` : `Holder date: ${esc(String(m.date).slice(0, 4))}`}</span>` : ''}</span></a></li>`;
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
  contributor: { '@id': 'schema:contributor', '@container': '@set' },
  proprietor: { '@id': 'kh:proprietor', '@type': '@id', '@container': '@set' },
  supervisedBy: { '@id': 'kh:supervisedBy', '@type': '@id', '@container': '@set' },
  advertisedIn: { '@id': 'kh:advertisedIn', '@type': '@id', '@container': '@set' },
  clergyTitle: { '@id': 'kh:clergyTitle', '@type': '@id', '@container': '@set' },
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
  photographDate: {'@id':'schema:dateCreated','@type':'xsd:gYear'},
  photographer: 'schema:creator',
  iiifManifest: { '@id': 'kh:iiifManifest', '@type': '@id' },
  iiifService: { '@id': 'kh:iiifImageService', '@type': '@id' },
};
const dateValue = (d) => {
  const s = String(d);
  const t = s.length === 4 ? 'xsd:gYear' : s.length === 7 ? 'xsd:gYearMonth' : 'xsd:date';
  return { '@value': s, '@type': t };
};
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length)));

const SITE_TYPES = { synagogue: 'schema:Synagogue', hospital: 'schema:Hospital', school: 'schema:School', 'matzah-bakery': 'schema:Bakery', lodging: 'schema:LodgingBusiness', 'kosher-restaurant': 'schema:Restaurant', business: 'schema:LocalBusiness', bookstore: 'schema:BookStore', residence: 'schema:House', 'meeting-place': 'schema:Place' };
const INST_TYPES = { periodical: 'schema:Periodical', education: 'schema:EducationalOrganization', hospital: 'schema:Hospital' };

// Contributors (from accepted suggestions) are credited as schema:contributor on every record.
const contributorNodes = (r) => (r.contributors || []).map((c) => strip({ '@type': 'schema:Person', name: c.name || `@${c.github}`,
  sameAs: c.orcid ? `https://orcid.org/${c.orcid}` : undefined, url: c.github ? `https://github.com/${c.github}` : undefined }));
function node(type, r) {
  const n = nodeBase(type, r);
  if (r.contributors?.length) n.contributor = contributorNodes(r);
  return n;
}
function nodeBase(type, r) {
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
      return strip({ ...base, '@type': SITE_TYPES[r.kind] || 'schema:Place', name: r.name, description: r.note,
        foundingDate: r.opened ? String(r.opened) : undefined, dissolutionDate: r.closed ? String(r.closed) : undefined,
        proprietor: (r.proprietors || r.people || []).length && !['synagogue', 'school', 'hospital'].includes(r.kind) ? (r.proprietors || r.people).map((p) => uri('person', p)) : undefined,
        supervisedBy: (r.supervisedBy || []).map((x) => uri(x.type, x.id)), advertisedIn: [...new Set((r.advertisedIn || []).map((x) => uri('periodical', x.periodical)))],
        additionalType: conceptUri('siteKind', r.kind), containedInPlace: uri('place', r.place),
        address: { '@type': 'schema:PostalAddress', streetAddress: r.address, addressLocality: index.place.get(r.place).name, addressRegion: index.place.get(r.place).state, addressCountry: 'US' },
        geo: { '@type': 'schema:GeoCoordinates', latitude: String(r.lat), longitude: String(r.lon) }, precision: conceptUri('precision', r.precision),
        built: r.built ? String(r.built) : undefined,
        occupancy: (r.occupants || []).map((o) => strip({ '@type': 'kh:Occupancy', occupant: uri(typeOfOrg(o.org), o.org),
          startDate: o.from ? dateValue(o.from) : undefined, endDate: o.to ? dateValue(o.to) : undefined })),
        certainty: conceptUri('certainty', r.certainty), citation: r.sources.map((s) => uri('source', s)) });
    case 'person':
      return strip({ ...base, '@type': 'schema:Person', name: r.name, description: r.description,
        birthDate: r.born ? String(r.born) : undefined, deathDate: r.died ? String(r.died) : undefined, clergyTitle: clergyTitles(r).map((t) => conceptUri('clergyTitle', t)), birthPlaceLabel: r.birthPlace, occupation: r.occupation,
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
      return strip({ ...base, '@type': `schema:${r.type === 'WebSite' ? 'WebSite' : r.type === 'Periodical' ? 'Periodical' : r.type === 'Dataset' ? 'Dataset' : r.type === 'Collection' ? 'Collection' : r.type === 'CreativeWork' ? 'CreativeWork' : 'Book'}`,
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
  ['maps/all/', 'Map'], ['cities/', 'City guides'], ['database/', 'Find a record'], ['datasets/', 'Data'], ['about/', 'About'], ['contribute/', 'Contribute'],
];
function layout({ rel, title, description, canonical, body, jsonld, scripts = [], styles = [], current = '', alternate }) {
  if (scripts.includes('assets/vendor/leaflet/leaflet.js')) scripts = scripts.flatMap(s => s === 'assets/vendor/leaflet/leaflet.js' ? [s, 'assets/js/terrain.js'] : [s]);
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
<body data-root="${rel}" data-section="${esc(current)}">
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${rel}"><span><strong>${esc(cfg.title)}</strong><small>${esc(cfg.subtitle)}</small></span></a>
    <button id="nav-toggle" class="nav-toggle" type="button" aria-controls="primary-nav" aria-expanded="false" hidden>Menu</button><nav id="primary-nav" aria-label="Primary"><ul>
      ${NAV.map(([href, label]) => `<li><a href="${rel}${href}"${(current === href || (href === 'maps/all/' && ['maps/','subscribers/','visualizations/'].includes(current))) ? ' aria-current="page"' : ''}>${label}</a></li>`).join('')}
    </ul></nav>
  </div>
</header>
${['maps/','subscribers/','visualizations/'].includes(current) ? `<nav class="section-nav wrap" aria-label="Explore"><a href="${rel}maps/all/"${canonical.endsWith('/maps/all/')?' aria-current="page"':''}>All features</a><a href="${rel}atlas/"${canonical.endsWith('/atlas/')?' aria-current="page"':''}>Congregations over time</a><a href="${rel}subscribers/"${current==='subscribers/'?' aria-current="page"':''}>Newspaper subscribers</a><a href="${rel}visualizations/"${current==='visualizations/'?' aria-current="page"':''}>Connections &amp; charts</a><a href="${rel}maps/">Map directory</a></nav>` : ''}
<main id="main" tabindex="-1">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-inner">
    <p><strong>${esc(cfg.title)}</strong> v${esc(cfg.version)} · Data released under <a href="${cfg.license.url}" rel="license">${esc(cfg.license.name)}</a> · Built ${BUILD_DATE}</p>
    <p><a href="${rel}contribute/">Contribute</a> · <a href="${rel}contributors/">Contributors</a> · <a href="${rel}sources/occident/">Read the Occident</a> · <a href="${rel}browse/">Browse all records</a> · <a href="${rel}datasets/">Download the data</a> · <a href="${rel}vocab/">Vocabulary</a> · <a href="${rel}about/#cite">How to cite</a></p>
  </div>
</footer>
${['assets/js/site.js',...scripts].map((s) => `<script src="${rel}${s}" defer></script>`).join('\n')}
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
const citationText = (s) => `${s.author ? `${esc(s.author)}, ` : ''}<cite>${esc(s.title)}</cite>${s.place || s.publisher ? ` (${[s.place, s.publisher].filter(Boolean).map(esc).join(': ')}${s.year ? `, ${s.year}` : ''})` : ''}`;
function sourcesSection(rel, ids) {
  return `<section aria-labelledby="h-sources"><h2 id="h-sources">Sources</h2><ol class="sources">${ids
    .map((id) => `<li>${citationText(index.source.get(id))} — <a href="${rel}${docPath('source', id)}">record</a></li>`).join('')}</ol></section>`;
}
// All suggestion links lead to the public contribution desk, preserving record context.
const suggestUrl = (template, params = {}) => {
  const u = new URL('contribute/', BASE);
  u.searchParams.set('type', template);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
};
// Location proposals stay in the public review workflow; coordinates are never applied directly.
function locateUrl(rel, type, record) {
  const place = type === 'place' ? record : index.place.get(record.place);
  const params = new URLSearchParams({ type: 'location', record: docUri(type, record.id), title: record.name,
    place: place ? `${place.name}, ${place.state}` : '' });
  if (Number.isFinite(record.lat) && Number.isFinite(record.lon)) { params.set('lat', record.lat); params.set('lon', record.lon); }
  return `${rel}contribute/?${esc(params.toString())}`;
}
const SITE_FORM = { synagogue: 'add-site', school: 'add-site', 'matzah-bakery': 'add-site', lodging: 'add-site', 'kosher-restaurant': 'add-site', business: 'add-site', bookstore: 'add-site', cemetery: 'add-cemetery' };
const contributedBy = (r) => (r.contributors?.length ? `<p class="contributed">Contributed by ${r.contributors.map((c) => `${c.github ? `<a href="https://github.com/${esc(c.github)}">` : ''}${esc(c.name || '@' + c.github)}${c.github ? '</a>' : ''}${c.orcid ? ` <a class="orcid" href="https://orcid.org/${esc(c.orcid)}" title="ORCID iD">iD</a>` : ''}`).join(', ')}.</p>` : '');
function citeBox(type, r) {
  const label = TYPE_INFO[type].label;
  return `<section class="cite" aria-labelledby="h-cite"><h2 id="h-cite">Cite this record</h2>
  <p class="cite-text">“${esc(type === 'source' ? r.title : r.name).replace(/&amp;/g, '&amp;')}.” ${label} record in <cite>${esc(cfg.title)}: ${esc(cfg.subtitle)}</cite>, version ${cfg.version}. <span class="uri">${esc(uri(type, r.id))}</span> (accessed ${BUILD_DATE}).</p>
  ${contributedBy(r)}
  ${['site', 'cemetery', 'place'].includes(type) ? `<p><a class="suggest" href="${locateUrl('../'.repeat(docPath(type,r.id).split('/').filter(Boolean).length), type, r)}">Help locate this place ↗</a> <span class="small muted">Propose a point with a source and location precision.</span></p>` : ''}
  <p class="data-links"><a class="suggest" href="${esc(suggestUrl('correction', { record: docUri(type, r.id), title: `[Correction] ${type === 'source' ? r.title : r.name}` }))}">Suggest a correction</a> · Machine-readable: <a href="index.jsonld" type="application/ld+json">JSON-LD</a>${wd(type, r.id) ? ` · Same as <a href="https://www.wikidata.org/wiki/${wikidata[type][r.id]}">Wikidata ${wikidata[type][r.id]}</a>` : ''}</p></section>`;
}
function evidenceSection(type, r, rel) {
  const fields = [['founded','Founded'],['established','Established'],['built','Built or acquired'],['opened','Opened'],['closed','Closed'],['ceased','Ceased'],['dissolved','Dissolved'],['date','Date']].filter(([f])=>r[f] != null);
  if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) fields.push(['location','Location']);
  if (!fields.length || type === 'source') return '';
  return `<section class="claim-evidence"><h2>Evidence for dates &amp; locations</h2><p class="small muted">A record citation and a passage linked to a particular claim are shown separately.</p>${fields.map(([field,label])=>{
    const entries=claimEvidence[`${type}/${r.id}`]?.[field] || [];
    const value=field==='location' ? `${r.lat}, ${r.lon}${r.precision ? ` · ${r.precision}` : ' · locality center'}` : String(r[field]);
    return `<details id="claim-${field}"><summary>${esc(label)}: ${esc(value)} <span class="small muted">· ${entries.length ? 'passage linked' : 'passage needed'}</span></summary>${entries.length ? entries.map(e=>{const s=index.source.get(e.source);return `<p>${link(rel,'source',s.id,s.title)} — ${esc(e.locator)}${s.url ? ` · <a href="${esc(s.url)}">Read original report ↗</a>` : ''}</p>${e.note ? `<p class="small">${esc(e.note)}</p>` : ''}`;}).join('') : `<p class="small">${(r.sources || []).length ? `Record-level references: ${(r.sources || []).map(id=>link(rel,'source',id,index.source.get(id).title)).join('; ')}. A specific page or passage has not yet been linked to this claim.` : 'No source passage is recorded for these locality coordinates.'}</p>`}<a class="small" href="${esc(suggestUrl('evidence',{record:docUri(type,r.id),title:r.name,claim:field,value}))}">Add or challenge the evidence →</a></details>`;
  }).join('')}</section>`;
}
const dl = (rows) => `<dl class="facts">${rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`;
const ul = (items, empty = '') => (items.length ? `<ul class="related">${items.map((i) => `<li>${i}</li>`).join('')}</ul>` : empty);
const mapKey = (pts) => {
  const kinds = [...new Set(pts.map((p) => p.kind).filter((k) => k !== 'city'))];
  if (kinds.length) return `<p class="map-caption">${kinds.map((k) => `<span class="mk-sym">${SYM.svg(k, { size: 14 })}</span> ${esc(SYM.label(k).toLowerCase())}`).join(' · ')}${pts.some((p) => p.precision === 'approximate') ? ` · <span class="mk-sym">${SYM.svg('meeting-place', { size: 14, approx: true })}</span> dashed: approximate location` : ''}</p>`;
  return '';
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
  const facts = rows => dl(rows.map(([label,value])=>{
    const field=({'Founded':'founded','Established':'established','Built or acquired':'built','Date':'date','Dissolved / merged':'dissolved','Ceased':'dissolved','Closed to burials':'closed','Location':'location','Coordinates':'location','Address':'location'})[label];
    const available=field==='location' ? Number.isFinite(r.lat) && Number.isFinite(r.lon) : field && r[field]!=null;
    return [label,available && value!=null && value!=='' ? `${value} <a class="fact-evidence-link" href="#claim-${field}">Evidence</a>` : value];
  }));
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
    ${facts([['State', esc(r.state)], ['Region', esc(r.region)], ['Coordinates', `${r.lat.toFixed(4)}, ${r.lon.toFixed(4)}`],
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
    aside = `<p><a class="btn btn-ghost" href="${rel}atlas/#city=${r.id}">Zoom to ${esc(r.name)} streets ↗</a></p>` + (CITY_IDS.includes(r.id) ? `<p class="guide-link"><a class="btn" href="${rel}city/${r.id}/">Explore Jewish ${esc(r.name)} →</a></p>` : '') + minimap(inner.length ? inner : [ptFor(r.id)]);
  } else if (type === 'congregation') {
    const roles = rolesByOrg.get(r.id) || [];
    const kids = splits.get(r.id) || [];
    const evs = eventsByOrg.get(r.id) || [];
    const sites = (sitesByOrg.get(r.id) || []).sort((a, b) => (a.from || 0) - (b.from || 0));
    const cems = cemByOwner.get(r.id) || [];
    main = `${r.translation ? `<p class="translation">“${esc(r.translation)}”</p>` : ''}${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${facts([['Place', link(rel, 'place', r.place, placeLabel(r.place))], ['Founded', `${r.founded} ${badge('certainty', r.certainty)}`],
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
    ${facts([['Type', badge('category', r.category)], ['Place', link(rel, 'place', r.place, placeLabel(r.place))], ['Founded', `${r.founded} ${badge('certainty', r.certainty)}`], ['Ceased', r.dissolved]])}
    ${sites.length ? `<section><h2>Buildings and meeting places</h2>${buildingsList(rel, sites)}</section>` : ''}
    <section><h2>People</h2>${peopleList(rel, roles)}</section>
    ${eventList(rel, eventsByOrg.get(r.id) || [])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap(sites.length ? sites.map((x) => locPt('site', x.site, rel)) : [ptFor(r.place)]);
  } else if (type === 'periodical') {
    main = `<p class="lede">${esc(r.description)}</p>
    ${facts([['Published at', link(rel, 'place', r.place, placeLabel(r.place))], ['Years', `${span(r.founded, r.ceased)} ${badge('certainty', r.certainty)}`],
      ['Language', esc(r.language.map((l) => LANGS[l]).join(', '))], ['Frequency', badge('frequency', r.frequency)], ['Religious orientation', badge('orientation', r.orientation)]])}
    ${r.id === 'occident' ? `<p><a class="btn btn-small" href="${rel}sources/occident/">Search original Occident article titles →</a></p>` : ''}
    ${periodicalReadership(rel, r.id)}
    <section><h2>Editors and staff</h2>${peopleList(rel, rolesByOrg.get(r.id) || [])}</section>
    ${eventList(rel, eventsByOrg.get(r.id) || [])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([ptFor(r.place)]);
  } else if (type === 'cemetery') {
    main = `${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${facts([['City', link(rel, 'place', r.place, placeLabel(r.place))], ['Address', esc(r.address)], ['Established', `${r.established} ${badge('certainty', r.certainty)}`],
      ['Closed to burials', r.closed], ['Maintained by', (r.owners || []).map((o) => link(rel, 'congregation', o, nameOf('congregation', o))).join(' · ')],
      ['Location', coords(r)]])}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([locPt('cemetery', r, rel)]);
  } else if (type === 'site') {
    const evs = eventsBySite.get(r.id) || [];
    main = `${r.note ? `<p class="lede">${esc(r.note)}</p>` : ''}
    ${facts([['Kind', badge('siteKind', r.kind)], ['City', link(rel, 'place', r.place, placeLabel(r.place))], ['Address', esc(r.address)],
      ['Built or acquired', r.built ? `${r.built} ${badge('certainty', r.certainty)}` : ''],
      ['In business', r.opened || r.closed ? span(r.opened || '?', r.closed) : ''],
      ['Proprietors', (r.proprietors || (!['synagogue', 'school', 'hospital'].includes(r.kind) ? r.people : null) || []).map((p) => link(rel, 'person', p, nameOf('person', p))).join(', ')],
      ['Kosher supervision', (r.supervisedBy || []).map((x) => link(rel, x.type, x.id, nameOf(x.type, x.id))).join(', ')],
      ['Advertised in', (r.advertisedIn || []).map((x) => `<i>${link(rel, 'periodical', x.periodical, nameOf('periodical', x.periodical))}</i>${x.date ? ` <span class="muted">${esc(x.date)}</span>` : ''}`).join('; ')],
      ['Location', coords(r)]])}
    <section><h2>Used by</h2>${ul((r.occupants || []).map((o) => `${link(rel, typeOfOrg(o.org), o.org, nameOf(typeOfOrg(o.org), o.org))}${o.from ? ` <span class="muted">${span(o.from, o.to)}</span>` : ''}`), '<p class="muted">None recorded.</p>')}</section>
    ${eventList(rel, evs)}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap([locPt('site', r, rel)]);
  } else if (type === 'person') {
    const evs = eventsByPerson.get(r.id) || [];
    main = `<p class="lede">${esc(r.description)}</p>
    ${facts([['Lived', lifespan(r)], ['Clergy', clergyTitles(r).map((t) => badge('clergyTitle', t)).join(' ')], ['Born', esc(r.birthPlace)], ['Occupation', esc(r.occupation.join(', '))],
      ['Places', r.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(' · ')], ['Certainty', r.certainty ? badge('certainty', r.certainty) : '']])}
    <section><h2>Affiliations</h2>${ul(r.roles.map((x) => `${esc(x.role)}, ${link(rel, typeOfOrg(x.org), x.org, nameOf(typeOfOrg(x.org), x.org))}${x.start ? ` <span class="muted">${span(x.start, x.end)}</span>` : ''}`), '<p class="muted">None recorded.</p>')}</section>
    ${eventList(rel, evs)}
    ${sourcesSection(rel, r.sources)}`;
    aside = minimap(r.places.map(ptFor));
  } else if (type === 'event') {
    const site = r.site ? index.site.get(r.site) : null;
    main = `<p class="lede">${esc(r.description)}</p>
    ${facts([['Date', `<time datetime="${esc(r.date)}">${formatDate(r.date)}</time> ${badge('certainty', r.certainty)}`], ['Category', badge('category', r.category)],
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
  const guidePlace = type === 'place' ? r.id : r.place;
  const heading = esc(type === 'source' ? r.title : r.name);
  return `<div class="wrap">${crumbs}
  <article class="record record-${type}">
    <header class="record-head"><p class="kicker">${TYPE_INFO[type].label}</p><h1>${heading}</h1>${guidePlace && CITY_IDS.includes(guidePlace) ? `<p class="record-actions"><a class="btn btn-small" href="${rel}city/${guidePlace}/">Open ${esc(index.place.get(guidePlace).name)} city guide ↗</a><a href="${rel}database/">Find another record →</a></p>` : `<p class="record-actions"><a href="${rel}database/">Find another record →</a></p>`}</header>
    <div class="record-grid"><div class="record-main">${main}${evidenceSection(type,r,rel)}${gallery(rel, type === 'place' ? (mediaByPlace.get(r.id) || []) : (mediaByRecord.get(`${type}/${r.id}`) || []))}${citeBox(type, r)}</div>${aside ? `<aside class="record-aside">${aside}</aside>` : ''}</div>
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
  source: (r) => `${r.author ? r.author + ", " : ""}${r.title}.`,
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
      scripts: type === 'source' ? [] : ['assets/vendor/leaflet/leaflet.js', 'assets/js/symbols.js', 'assets/js/minimap.js'],
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
  const mapData = { range: [yMin, yMax], papers: papers.map((p) => ({ id: p, name: nameOf('periodical', p), total: READERS[p].total, years: READERS[p].years, place: index.place.get(index.periodical.get(p).place).name })), places: READ_PLACES };
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
    styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/city-navigation.js', 'assets/js/readers.js'],
    body: `<div class="atlas wrap readers-page"><header class="page-head"><h1>Newspaper subscribers</h1><p>Choose a city to see its recorded subscribers, or compare the papers and years on the map.</p></header>
  ${cityNavigator('../','Show subscribers')}
  <details class="map-filter-panel"><summary>Newspapers &amp; years</summary>    <fieldset class="map-key">
      <legend>Explanation</legend>
      ${papers.map((p) => `<label><input type="checkbox" name="paper" value="${p}" checked><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="5" class="sym" style="fill:${PAPER_TINT[p]};fill-opacity:.75"/></svg><i>${esc(nameOf('periodical', p).replace(/ and American Jewish Advocate$/, ''))}</i> <span class="muted key-n" data-n="${p}"></span></label>`).join('')}
      <p class="key-street">Circle area shows the number of subscriptions.</p>
    </fieldset>
  <div class="timeline readers-time">
    <label class="r-yr">From <input type="range" id="r-from" min="${yMin}" max="${yMax}" value="${yMin}"> <output id="r-from-out">${yMin}</output></label>
    <label class="r-yr">to <input type="range" id="r-to" min="${yMin}" max="${yMax}" value="${yMax}"> <output id="r-to-out">${yMax}</output></label>
  </div>
</details>
  <div class="plate"><div id="readers-map" class="atlas-map" role="region" aria-label="Map of subscribers to the Jewish press" data-tiles="${esc(TILES)}"></div></div>
  <p class="map-summary"><output id="r-range">${yMin}–${yMax}</output> · <span id="r-summary" aria-live="polite"></span></p>
  <div class="readers-cols">
    <details class="gazetteer ranked-places"><summary id="r-top-h">Browse places by subscription count</summary>

      <p class="gaz-note">The places with the most subscriptions for the papers and years chosen. Select one to see it on the map and list its subscribers.</p>
      <ol id="r-top" class="place-list"></ol>
    </details>
    <section class="r-detail" aria-live="polite" aria-labelledby="r-detail-h">
      <h2 id="r-detail-h">Subscribers</h2>
      <div id="r-detail"><p class="gaz-note">Choose a place on the map or in the list.</p></div>
    </section>
  </div>
  <details class="prose-wide r-about"><summary>Sources and methods</summary>
    <p>Each 19th-century Jewish periodical printed lists of subscribers and agents who had paid. These lists were transcribed, with subscribers' names, the date of the issue, and the place, reconciled to Wikidata, GeoNames and the Library of Congress. Kehillot maps them by place and links them to its own places through their Wikidata identifiers. Subscriptions without a recorded place are counted but not mapped.</p>
    <ul class="sources">${DATASETS.filter((d) => d.use === 'subscriptions').map((d) => `<li>${dsCitation(d)}. License: ${esc(d.license?.toUpperCase().replace(/-/g, ' ') || 'see record')}.</li>`).join('')}</ul>
    <p class="small">Download the mapped counts: <a href="../data/subscriptions-by-place.csv">subscriptions-by-place.csv</a> (one row per periodical, place and year). Full subscriber lists are in the Zenodo deposits above.</p>
  </details>
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
  baseUrl: BASE,
  media: MEDIA.map(m=>({id:m.id,name:m.title,title:m.title,holder:m.holder,description:m.description,date:m.date,places:m.places})),
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
  ...[['rite', 'Rite at founding'], ['orientation', 'Orientation by c. 1870'], ['certainty', 'Certainty of dating'], ['splitFrom', 'Formed by secession from'], ['dormantFrom', 'Without resident congregation from'], ['dormantUntil', 'Without resident congregation until'], ['nameTranslation', 'English translation of the Hebrew name'], ['birthPlaceLabel', 'Birthplace as recorded (text)'], ['occupation', 'Occupation (text)'], ['involves', 'Person or organization involved in an event'], ['alsoAt', 'Additional place where the event occurred'], ['frequency', 'Publication frequency'], ['established', 'Year a cemetery was established'], ['closed', 'Year a cemetery closed to burials'], ['built', 'Year a building was built or acquired'], ['maintainedBy', 'Congregation that owned or maintained a cemetery'], ['occupancy', 'A period during which an organization used a site'], ['occupant', 'The organization in an occupancy'], ['locationPrecision', 'How precisely the coordinates locate the site'], ['atSite', 'Site within a city where an event took place'], ['proprietor', 'Person who owned or kept a business, hotel or boarding house'], ['supervisedBy', 'Person or congregation that certified a bakery or restaurant as kosher'], ['advertisedIn', 'Periodical in which a business advertised'], ['clergyTitle', 'Religious office a person held']]
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

function homeMap() {
  const points = data.place.filter(p => p.lon >= -126 && p.lon <= -66 && p.lat >= 24 && p.lat <= 50);
  const x = lon => 30 + (lon + 126) / 60 * 520;
  const y = lat => 300 - (lat - 24) / 26 * 230;
  const labels = new Map([['New York', [9, -13]], ['Cincinnati', [-15, -20]], ['Charleston', [-65, 24]], ['New Orleans', [-30, 27]], ['San Francisco', [12, 25]]]);
  return `<svg viewBox="0 0 600 380" class="home-map" role="img" aria-labelledby="home-map-title home-map-desc"><title id="home-map-title">Cities in the collection</title><desc id="home-map-desc">Cities positioned by their recorded coordinates. This schematic shows places in the collection in the contiguous United States; open the atlas for the full interactive map.</desc>
  <defs><pattern id="atlas-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="currentColor" stroke-width=".5" opacity=".18"/></pattern></defs><rect width="600" height="380" fill="url(#atlas-grid)"/>
  <text x="28" y="32" class="map-overline">RECORDED CITIES / CONTIGUOUS UNITED STATES</text>

  ${points.map(p => { const n=data.congregation.filter(c=>c.place===p.id).length; return `<circle cx="${x(p.lon)}" cy="${y(p.lat)}" r="${3+Math.sqrt(n)*1.6}" class="map-place"/>`; }).join('')}
  ${points.filter(p=>labels.has(p.name)).map(p=>{const [dx,dy]=labels.get(p.name);return `<text x="${x(p.lon)+dx}" y="${y(p.lat)+dy}" class="map-city">${esc(p.name)}</text>`;}).join('')}
  <g transform="translate(545 300)" aria-hidden="true"><path d="M0 -22L5 0 0 -4 -5 0Z" fill="currentColor"/><path d="M0 0V17M-12 0H12" stroke="currentColor"/><text x="0" y="-29" text-anchor="middle" class="map-overline">N</text></g>
  <text x="28" y="351" class="map-overline">1840 — 1870</text><text x="28" y="368" class="map-overline">CITY POSITIONS FROM THE PROJECT GAZETTEER</text></svg>`;
}

await out('index.html', layout({ rel: '', title: '', canonical: BASE, current: '',
  description: `${cfg.subtitle}. An open, source-cited atlas and linked-data database of Jewish congregations, institutions, people and events.`,
  jsonld: websiteLD,
  body: `<section class="hero"><div class="wrap hero-inner">
    <div class="hero-copy"><p class="kicker"><span class="kicker-line"></span> Jewish communal life · ${Y0}–${Y1}</p>
    <h1>Jewish America.<br><em>1840–1870.</em></h1>
    <p class="hero-subtitle">A research atlas of people, places, and institutions.</p>
    <p class="lede">Explore congregations, people, institutions, businesses, and newspapers across the United States. Each record links back to its historical sources.</p>
    <p class="cta"><a class="btn" href="cities/">Explore city guides</a> <a class="btn btn-ghost" href="maps/all/">Explore the map</a> <a class="hero-data-link" href="database/">Search records →</a></p>
    <p class="hero-footnote">Source-cited records · Maps · Open research data</p></div>
    <figure class="hero-plate"><div class="plate-heading"><span>KEHILLOT / LOCATIONS</span><span>FIG. 01</span></div>${homeMap()}<figcaption><span>Recorded cities</span><a href="atlas/">Explore the interactive atlas ↗</a></figcaption></figure>
  </div></section>
  <div class="wrap discovery"><p class="kicker">Explore the collection</p><div class="discovery-grid">
    <a href="cities/"><span class="discovery-number">01 / GEOGRAPHY</span><strong>Maps &amp; city guides <span>↗</span></strong><span>Explore maps, streets, and the spaces of communal life.</span></a>
    <a href="visualizations/"><span class="discovery-number">02 / CONNECTIONS</span><strong>People &amp; networks <span>↗</span></strong><span>Trace the people, journeys, and ideas connecting communities.</span></a>
    <a href="contribute/"><span class="discovery-number">03 / COLLECTIVE HISTORY</span><strong>Contribute research <span>↗</span></strong><span>Help fill in the picture with a source or a correction.</span></a>
  </div></div>
  <div class="wrap">
    <details class="collection-totals"><summary>${counts.congregation} congregations · ${counts.person} people · ${READ_TOTAL.toLocaleString('en-US')} subscriptions. View collection totals</summary><ul class="stats" aria-label="Dataset contents">
      <li><a href="browse/#congregation"><strong>${counts.congregation}</strong> congregations</a></li>
      <li><a href="browse/#place"><strong>${counts.place}</strong> places</a></li>
      <li><a href="browse/#person"><strong>${counts.person}</strong> people</a></li>
      <li><a href="browse/#cemetery"><strong>${counts.cemetery}</strong> cemeteries</a></li>
      <li><a href="browse/#site"><strong>${counts.site}</strong> sites in cities</a></li>
      <li><a href="browse/#periodical"><strong>${counts.periodical}</strong> periodicals</a></li>
      <li><a href="subscribers/"><strong>${READ_TOTAL.toLocaleString('en-US')}</strong> subscriptions recorded</a></li>
      <li><a href="browse/#institution"><strong>${counts.institution}</strong> institutions</a></li>
      <li><a href="browse/#event"><strong>${counts.event}</strong> events</a></li>
      <li><a href="datasets/"><strong>${triples.length.toLocaleString('en-US')}</strong> RDF triples</a></li>
    </ul></details>
    <section class="split">
      <figure class="chart-fig">${growthChart()}<figcaption>Congregations active in each year, by region. Counts reflect the records in this dataset, not a complete census. Newport's Touro Synagogue, without a resident congregation for most of the period, is excluded while dormant.</figcaption>${chartTable}</figure>
      <div class="prose">
        <p class="kicker">A growing, connected collection</p><h2>The collection in numbers</h2>
        <p>Every record has a stable URI, a human-readable page and a machine-readable JSON-LD description using <a href="https://schema.org/">schema.org</a> and a small <a href="vocab/">project vocabulary</a>. People, places and organizations are reconciled to <a href="https://www.wikidata.org/">Wikidata</a> where a match has been checked.</p>
        <p>Each claim is cited. Dates whose sources disagree are flagged as <em>medium</em> certainty so you know what to verify before citing.</p>
        <h3>National population estimates</h3>
        <table class="mini"><caption class="visually-hidden">Estimated U.S. Jewish population</caption><thead><tr><th scope="col">Year</th><th scope="col">Estimate</th></tr></thead><tbody>${population.series.map((p) => `<tr><th scope="row">${p.year}</th><td>c. ${p.estimate.toLocaleString('en-US')}</td></tr>`).join('')}</tbody></table>
        <p class="muted small">${esc(population.note)}</p>
      </div>
    </section>
    <section class="explore"><p class="kicker">From the collection</p><h2>Selected records</h2><div class="cards">
      ${['emanu-el-ny', 'beth-elohim-chs', 'bnai-yeshurun-cin', 'emanu-el-sf'].map((id) => { const c = index.congregation.get(id); return `<a class="card" href="${docPath('congregation', id)}"><span class="kicker">${esc(index.place.get(c.place).name)} · ${c.founded}</span><strong>${esc(c.name)}</strong><span>${esc(c.note || '')}</span></a>`; }).join('')}
      ${['general-orders-11', 'cleveland-conference-1855'].map((id) => { const e = index.event.get(id); return `<a class="card" href="${docPath('event', id)}"><span class="kicker">${formatDate(e.date)}</span><strong>${esc(e.name)}</strong><span>${esc(e.description)}</span></a>`; }).join('')}
    </div></section>
  </div>` }));

// Shared city finder: built from curated places and address-level records, never geocoded guesses.
function cityNavigator(rel, action = 'Zoom to streets') {
  const cities = data.place.map(p => {
    const sites = [...data.site, ...data.cemetery].filter(x => x.place === p.id && x.precision !== 'city');
    const readership = READ_PLACES.find(x => x.own === p.id);
    return { id: p.id, name: p.name, state: p.state, lat: p.lat, lon: p.lon, aliases: readership && readership.name !== p.name ? [readership.name] : [], subscriptions: readership ? subscriptionCount(readership) : 0, points: sites.map(x => [x.lat, x.lon]), guide: CITY_IDS.includes(p.id) ? `${rel}city/${p.id}/` : null };
  }).concat(READ_PLACES.filter(p => !p.own).map(p => ({ id: p.cityId, name: p.name, state: p.state || p.country || '', lat: p.lat, lon: p.lon, subscriptions: subscriptionCount(p), points: [], guide: `${rel}city/${p.cityId}/` }))).sort((a,b)=>a.name.localeCompare(b.name));
  return `<section class="city-navigator" aria-labelledby="city-nav-title"><h2 id="city-nav-title" class="visually-hidden">Find a city or open its guide</h2>
  <form id="city-jump-form" class="city-jump-form"><label for="city-jump">Find a city</label><div class="city-jump-fields"><input id="city-jump" type="search" list="city-choices" placeholder="Try New York or Cincinnati" autocomplete="off" required disabled aria-describedby="city-jump-status"><datalist id="city-choices">${cities.map(p=>`<option value="${esc(p.name)}, ${esc(p.state)}"></option>`).join('')}</datalist><a class="btn city-guide-link" id="city-guide-link" href="${rel}cities/" data-directory="${rel}cities/">Open city guide ↗</a><button class="btn btn-ghost" type="submit" disabled>${esc(action)}</button><button class="btn btn-ghost" id="city-reset" type="button" disabled>National view</button></div></form>
  <details class="city-shortcuts"><summary>Map help &amp; quick cities</summary>${['new-york','philadelphia','cincinnati','san-francisco'].filter(id=>index.place.has(id)).map(id=>`<button type="button" data-city-jump="${id}" disabled>${esc(index.place.get(id).name)}</button>`).join('')}<p>Modern streets provide context. Dashed symbols are approximate; city-level records are not street addresses.</p></details>
  <p id="city-jump-status" class="city-jump-status" role="status" aria-live="polite">Loading city navigation…</p>

  <script type="application/json" id="city-navigation-data">${jsonForScript(cities)}</script></section>`;
}

await out('atlas/index.html', layout({ rel: '../', title: 'Atlas', canonical: `${BASE}atlas/`, current: 'maps/',
  description: `Interactive map of Jewish congregations, institutions and events in the United States, ${Y0}–${Y1}, with a year slider.`,
  styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/symbols.js', 'assets/js/city-navigation.js', 'assets/js/atlas.js'],
  body: `<div class="atlas wrap">
<header class="page-head"><h1>Congregations over time</h1><p>Choose a year to compare congregations, or enter a city to explore its streets.</p></header>
  ${cityNavigator('../')}
  <p class="map-summary"><output id="year-out" for="year" aria-live="polite">1850</output> · <span id="atlas-summary" aria-live="polite"></span></p>
  <div class="timeline">
    <button type="button" id="play" aria-pressed="false">Play</button>
    <div class="timeline-track">
      <label for="year" class="visually-hidden">Year</label>
      <input type="range" id="year" min="${Y0}" max="${Y1}" step="1" value="1850">
      <ol class="ticks" aria-hidden="true">${[1840, 1845, 1850, 1855, 1860, 1865, 1870].map((y) => `<li class="${y % 10 ? 'minor' : 'major'}" style="left:${((y - Y0) / (Y1 - Y0)) * 100}%"><span>${y % 10 ? '' : y}</span></li>`).join('')}</ol>
    </div>
  </div>
  <div class="plate">
    <div id="map" class="atlas-map" role="region" aria-label="Map of Jewish congregations in the United States" data-tiles="${esc(TILES)}"></div>
    <details class="map-filter-panel atlas-layers"><summary>Rites &amp; layers</summary><fieldset class="map-key">
      <legend>Explanation</legend>
      ${Object.entries(VOCAB.rite.concepts).map(([k, [l]]) => `<label><input type="checkbox" name="rite" value="${k}" checked><svg width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" class="sym sym-${k}"/></svg>${l} congregation</label>`).join('')}
      <label><input type="checkbox" name="layer" value="institution" checked><svg width="14" height="14" aria-hidden="true"><rect x="3" y="3" width="8" height="8" class="sym sym-inst"/></svg>Society or school</label>
      <label><input type="checkbox" name="layer" value="periodical" checked><svg width="14" height="14" aria-hidden="true"><path d="M3.5 3h7v8h-7z M5 5.5h4 M5 7.5h4" class="sym sym-press"/></svg>Periodical</label>
      <label><input type="checkbox" name="layer" value="event" checked><svg width="14" height="14" aria-hidden="true"><path d="M7 2.5 L12 11.5 L2 11.5Z" class="sym sym-event"/></svg>Event, to the year shown</label>
      <p class="key-street">When zoomed into a city:</p>
      <label><input type="checkbox" name="layer" value="site" checked><span class="f-sym">${SYM.svg('synagogue', { size: 14 })}</span>Synagogues, shops, schools and other sites</label>
      <label><input type="checkbox" name="layer" value="cemetery" checked><span class="f-sym">${SYM.svg('cemetery', { size: 14 })}</span>Cemetery</label>
      <p class="key-kinds">${SYM.GROUPS.filter((g) => !['Synagogues', 'Cemeteries', 'Other sites'].includes(g[0])).map((g) => `<span title="${esc(g[0])}">${SYM.svg(g[1][0], { size: 13 })} ${esc(g[0].toLowerCase())}</span>`).join(' ')}</p>
      <input type="checkbox" name="layer" value="congregation" checked hidden>
    </fieldset></details>
  </div>
  <details class="gazetteer map-record-list"><summary id="gaz-h">Browse cities on this map</summary>
    <p class="gaz-note">With the number of congregations active in the year shown. Select a city name to zoom directly to its streets and recorded sites.</p>
    <ol id="place-list" class="place-list"></ol>
    <p class="gaz-note">Congregations are marked at the city; each small circle is one congregation, tinted by its rite at founding, and a dashed ring marks a synagogue without a resident congregation. Zoom into a city, or use the city finder above, to see synagogue buildings and cemeteries at their own addresses; dashed outlines there mean the location is approximate.</p>
  </details>
</div>
<noscript><div class="wrap"><p>The interactive atlas needs JavaScript. Every record is also available as a plain page from <a href="../browse/">Browse</a>.</p></div></noscript>` }));

await out('database/index.html', layout({ rel: '../', title: 'Find a record', canonical: `${BASE}database/`, current: 'database/',
  description: 'Search and filter every congregation, person, cemetery, synagogue site, periodical, institution, event and place in the Kehillot dataset.',
  scripts: ['assets/js/database.js'],
  body: `<div class="wrap">
  <h1>Find a record</h1>
  <p class="lede">Search across record types, or narrow to a specific kind. Open a result for its sources and related places.</p>
  <p class="small"><a href="../collections/">Browse pictures &amp; archival collections →</a> · <a href="../sources/occident/">Read the Occident →</a></p>
  <div class="db" id="db">
    <div class="record-type-control"><label for="record-type">Record type</label><select id="record-type" disabled><option value="all">All record types</option><option value="congregations">Congregations</option><option value="people">People</option><option value="clergy">Clergy</option><option value="cemeteries">Cemeteries</option><option value="sites">Sites and buildings</option><option value="periodicals">Periodicals</option><option value="events">Events</option><option value="institutions">Institutions</option><option value="places">Places</option><option value="sources">Sources</option><option value="media">Pictures and documents</option></select></div>
    <div id="db-panel" role="region" aria-label="Search results">
      <form class="db-controls" role="search" onsubmit="return false">
        <label class="db-search">Search <input type="search" id="q" disabled autocomplete="off" placeholder="Name, place, note…"></label>
        <details class="search-filters"><summary>Refine results</summary><div id="facets" class="facets"></div><button class="btn btn-small btn-ghost" id="db-reset" type="button">Reset refinements</button></details>
        <button type="button" id="export" disabled class="btn btn-small btn-ghost">Download these results (CSV)</button>
      </form>
      <p id="db-count" class="db-count" aria-live="polite">Loading records…</p><p class="search-help small">For subscriber names and towns, open <a href="../cities/">City guides</a> or the <a href="../subscribers/">subscriber map</a>. You can also <a href="../browse/">browse every record</a>.</p>
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
  <section id="media" aria-labelledby="h-media"><h2 id="h-media"><a href="../collections/">Pictures and documents</a> <span class="muted">(${MEDIA.length})</span></h2><ul class="browse-list">${MEDIA.map((m) => `<li><a href="../media/${m.id}/">${esc(m.title)}</a> <span class="muted">${esc(m.holder)}${m.identifier ? ` · ${esc(m.identifier)}` : ''}</span></li>`).join('')}</ul></section>
  ${browseSection('source', [...data.source].sort((a, b) => (a.author || a.title).localeCompare(b.author || b.title)), (r) => r.author || 'Unsigned / institutional')}
  </div>` }));

const fileSize = (s) => (s > 1024 * 1024 ? `${(s / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(s / 1024))} KB`);
const { stat } = await import('node:fs/promises');
const distRows = [];
for (const [f, mt, title] of DISTS) distRows.push(`<tr><td><a href="../data/${f}" download>${f}</a></td><td>${esc(title)}</td><td><code>${mt}</code></td><td>${fileSize((await stat(path.join(DIST, 'data', f))).size)}</td></tr>`);

await out('datasets/index.html', layout({ rel: '../', title: 'Datasets', canonical: `${BASE}datasets/`, current: 'datasets/',
  description: 'Download the Kehillot data as JSON-LD, N-Triples, CSV with CSVW metadata, GeoJSON and Linked Places Format.',
  jsonld: catalog,
  body: `<div class="wrap prose-wide">
  <h1>Download data</h1>
  <p class="lede">All data is free to reuse under <a href="${cfg.license.url}" rel="license">${esc(cfg.license.name)}</a>. Version ${cfg.version}, built ${BUILD_DATE}: ${graph.length} entities, ${triples.length.toLocaleString('en-US')} triples.</p>
  <dl class="download-choices"><div><dt>Work in a spreadsheet</dt><dd><a href="#download-files">Choose a CSV table →</a><span>Separate tables for people, places, congregations, and other record types.</span></dd></div><div><dt>Use the map data</dt><dd><a href="../data/atlas.geojson" download>Download GeoJSON ↓</a><span>Geographic features for GIS and web maps.</span></dd></div><div><dt>Use linked data</dt><dd><a href="../data/kehillot.jsonld" download>Download JSON-LD ↓</a><span>Permanent identifiers and relationships between records.</span></dd></div></dl>
  <h2 id="download-files">All files and formats</h2><div class="table-wrap"><table class="files"><thead><tr><th scope="col">File</th><th scope="col">Contents</th><th scope="col">Media type</th><th scope="col">Size</th></tr></thead><tbody>${distRows.join('')}</tbody></table></div>
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
  <p><a href="../sources/occident/">Occident article catalogue (1843–1853)</a> · <a href="../data/evidence.json">Claim evidence (JSON)</a> · <a href="../data/evidence.jsonld">Claim evidence (JSON-LD)</a></p>
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

const contributionEndpoint = cfg.contribute.endpoint || '';
if (contributionEndpoint && !/^https:\/\//.test(contributionEndpoint)) throw new Error('contribute.endpoint must be an HTTPS form submission endpoint');
await out('contribute/index.html', layout({ rel: '../', title: 'Contribution desk', canonical: `${BASE}contribute/`, current: 'contribute/',
  description: 'Help document Jewish America with a sourced discovery or correction. Prepare a contribution without a GitHub account.', styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/location-picker.js', 'assets/js/contribute.js'],
  body: `<div class="wrap contribution-page"><header class="contribution-intro"><p class="kicker">Research contributions</p><h1>Contribute to<br><em>Kehillot.</em></h1><p class="lede">Suggest an addition, correct a record, or help locate a historical address. Include a source so an editor can check the evidence.</p></header>
  <div class="contribution-grid"><form id="contribution-form" class="contribution-form" ${contributionEndpoint ? `action="${esc(contributionEndpoint)}" method="POST"` : ''} data-delivery="${contributionEndpoint ? 'online' : 'download'}">
        <p class="delivery-note">${contributionEndpoint ? 'Your suggestion will be sent to the project’s configured form inbox for editorial review. It will not be published automatically.' : 'Online delivery is not connected yet. You can download your suggestion as a text file to share with an editor. Downloading does not send it to the project.'}</p>
    <p class="kicker">The contribution desk · No GitHub account needed</p><h2>What have you found?</h2>
    <label for="contribution-type">I would like to</label><select id="contribution-type" name="type" required><option value="add-site">Add another place or building</option><option value="synagogue">Add a synagogue building</option><option value="education">Add a school or educational institution</option><option value="matzah-bakery">Add a matzah bakery</option><option value="lodging">Add a hotel or boarding house</option><option value="kosher-restaurant">Add a kosher restaurant</option><option value="business">Add a Jewish-owned business</option><option value="bookstore">Add a bookstore</option><option value="add-institution">Add another institution or society</option><option value="add-periodical">Add a periodical</option><option value="add-event">Add an event</option><option value="add-cemetery">Add a cemetery</option><option value="add-person">Add a person</option><option value="add-congregation">Add a congregation</option><option value="evidence">Add evidence for a date or location</option><option value="correction">Correct a record</option><option value="location">Locate a historical place</option></select>
    <label for="record">Page or record <span class="muted">(for corrections or evidence)</span></label><input id="record" name="record" type="url" placeholder="https://…">
    <label for="subject">Name or subject</label><input id="subject" name="subject" maxlength="250" required>
    <label for="place">City, state, and dates <span class="muted">(if known)</span></label><input id="place" name="place" maxlength="500" placeholder="Philadelphia, Pennsylvania · about 1855">
    <fieldset id="location-fields" class="location-fields" hidden disabled><legend>Propose a historical location</legend>
      <p>Use a period map or directory to identify the place, then click the map or enter coordinates. A pin is a proposal for review; the source and precision explain what it means.</p>
      <div id="location-map" class="location-map" role="region" aria-label="Map for proposing a historical location" data-tiles="${esc(JSON.stringify({...cfg.streetmap,terrain:cfg.terrain}))}"></div>
      <p id="location-map-status" class="small" role="status" aria-live="polite">Choose a point to propose a location.</p>
      <div class="coordinate-fields"><div><label for="proposed-lat">Proposed latitude</label><input id="proposed-lat" name="proposed_latitude" type="number" step="any" min="-90" max="90" required></div><div><label for="proposed-lon">Proposed longitude</label><input id="proposed-lon" name="proposed_longitude" type="number" step="any" min="-180" max="180" required></div></div><button class="btn btn-small btn-ghost" id="location-recenter" type="button">Show entered coordinates</button>
      <label for="location-precision">What does the evidence locate?</label><select id="location-precision" name="location_precision" required><option value="">Choose the supported precision</option><option value="building">A building or parcel</option><option value="block">A block or intersection</option><option value="street">A street, without a known building</option><option value="city">The city or town only</option></select>
      <label for="historical-address">Address as written in the source</label><input id="historical-address" name="historical_address" maxlength="1000" placeholder="Keep the historical street name and numbering">
      <label for="map-date">Date of the map, directory, or other location source</label><input id="map-date" name="location_source_date" maxlength="100" required placeholder="e.g. 1855, or undated">
      <label for="location-reason">How did you identify this location?</label><textarea id="location-reason" name="location_reason" rows="3" maxlength="5000" required placeholder="Describe the matching streets, landmarks, address changes, or other evidence."></textarea>
      <p class="small muted">The map shows modern streets. Six decimal places describe the selected point, not the certainty of the historical location. Cite the map or directory in Source citation below.</p>
      <details><summary>Find historical map evidence</summary><ul><li><a href="https://www.davidrumsey.com/view/georeferencer" target="_blank" rel="noopener">David Rumsey: compare historical and modern maps</a></li><li><a href="https://atlascope.leventhalmap.org/" target="_blank" rel="noopener">Atlascope: Boston and Massachusetts</a></li><li><a href="https://www.loc.gov/collections/sanborn-maps/" target="_blank" rel="noopener">Library of Congress: Sanborn maps (1867 onward)</a></li></ul></details>
    </fieldset>
    <label for="details">Your discovery or proposed correction</label><textarea id="details" name="details" rows="5" maxlength="10000" required></textarea>
    <label for="source">Source citation</label><textarea id="source" name="source" rows="3" maxlength="5000" required placeholder="Author, title, date, page, archive, or a link someone else can check"></textarea>
    <fieldset id="evidence-fields" hidden disabled><legend>Evidence for a specific claim</legend><label for="evidence-claim">Claim or field</label><input id="evidence-claim" name="claim" required maxlength="100"><label for="evidence-value">Value currently recorded</label><input id="evidence-value" name="claim_value" maxlength="500"><label for="evidence-locator">Page, issue, entry or passage</label><input id="evidence-locator" name="locator" required maxlength="1000" placeholder="Volume VIII, no. 4, p. 202, opening paragraph"><p class="small muted">Use the details above to explain whether this source supports or challenges the recorded claim.</p></fieldset>
    <label for="source-url">Source link <span class="muted">(if online)</span></label><input id="source-url" name="source_url" type="url" placeholder="https://…">
    <label for="certainty">How certain is the information?</label><select id="certainty" name="certainty" required><option value="">Choose one</option><option>High — clearly stated in the source</option><option>Medium — approximate or conflicting sources</option><option>Low — a lead that needs checking</option></select>
    <label for="credit">Your name for the credit line <span class="muted">(optional)</span></label><input id="credit" name="credit" autocomplete="name" maxlength="200"><p class="small muted">Leave blank to contribute anonymously.</p>
    <label for="orcid">ORCID iD <span class="muted">(optional)</span></label><input id="orcid" name="orcid" maxlength="19" pattern="[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]" placeholder="0000-0000-0000-0000">
    <div class="form-trap" aria-hidden="true"><label>Leave this blank<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <label class="consent"><input type="checkbox" name="consent" value="CC BY 4.0; no private information about living people" required><span>I agree that my contribution may be published under CC BY 4.0, and it contains no private information about living people.</span></label>

    <button class="btn" type="submit"${contributionEndpoint ? '' : ' disabled'}>${contributionEndpoint ? 'Send for review ↗' : 'Download your suggestion ↓'}</button><p id="contribution-status" role="status" aria-live="polite"></p><noscript><p>${contributionEndpoint ? 'This form works without JavaScript.' : 'Downloading requires JavaScript. You can instead use one of the GitHub forms listed here.'}</p></noscript>
  </form><aside class="contribution-aside"><p class="kicker">From discovery to record</p><ol class="review-steps"><li><strong>You share a lead.</strong><p>Tell us what you found and where you found it. You do not need to know the data format.</p></li><li><strong>An editor checks the source.</strong><p>We review the evidence, dates, location, and any existing records.</p></li><li><strong>The atlas grows.</strong><p>Accepted discoveries become cited records, with your chosen credit.</p></li></ol><div class="desk-note"><h2>Document the uncertainty</h2><p>Conflicting dates and incomplete information are part of historical research. Tell us what is uncertain; we can work from there.</p></div><details><summary>Prefer contributing on GitHub?</summary><ul>${[['add-site','Place, school, bakery, hotel, restaurant, business or bookstore'],['add-cemetery','Cemetery'],['add-person','Person'],['add-congregation','Congregation'],['correction','Correction']].map(([id,label])=>`<li><a href="https://github.com/${esc(cfg.contribute.repo)}/issues/new?template=${id}.yml">${label} issue form</a></li>`).join('')}</ul><p class="small">GitHub forms require a GitHub account and are public.</p></details></aside></div></div>` }));

await out('about/index.html', layout({ rel: '../', title: 'About', canonical: `${BASE}about/`, current: 'about/',
  description: 'Scope, methods, data model, sources and how to cite or contribute to Kehillot.',
  body: `<div class="wrap prose-wide">
  <h1>About the project</h1>
  <p class="lede">${esc(cfg.title)} is a static, open digital atlas and database of Jewish communal life in the United States between ${Y0} and ${Y1}, the era of mass Central European immigration, westward expansion, the first American Reform congregations, and the Civil War.</p>
  <h2 id="contribute">Contribute</h2>
  <p>Anyone can suggest additions and corrections. Start at the <a href="../contribute/">contribution desk</a>; you do not need a GitHub account to prepare a suggestion. GitHub issue forms remain available for contributors who prefer them. An editor checks it against its source; once accepted, it becomes a record that the site validates automatically, and it is published when an editor approves it. Contributors are credited on the record and on the <a href="../contributors/">Contributors</a> page, with an ORCID iD if you give one.</p>
  <ul class="suggest-buttons">
    <li><a class="btn btn-small" href="${esc(suggestUrl('add-site'))}">Suggest a place</a> <span class="small muted">synagogue, school, bakery, hotel, restaurant, business, bookstore</span></li>
    <li><a class="btn btn-small" href="${esc(suggestUrl('add-cemetery'))}">Suggest a cemetery</a></li>
    <li><a class="btn btn-small" href="${esc(suggestUrl('add-person'))}">Suggest a person or clergy member</a></li>
    <li><a class="btn btn-small" href="${esc(suggestUrl('add-congregation'))}">Suggest a congregation</a></li>
    <li><a class="btn btn-small btn-ghost" href="${esc(suggestUrl('correction'))}">Suggest a correction</a> <span class="small muted">or use the link at the foot of any record</span></li>
  </ul>
  <h3>What makes a good suggestion</h3>
  <ul>
    <li><strong>Cite a source</strong> that someone else could check: a book, newspaper, directory, census, synagogue record or archive, with date and page. Family memory is welcome as a lead but needs a documentary source to be published.</li>
    <li><strong>Say how sure you are.</strong> Use “medium” certainty when sources disagree or a date is approximate, and give an approximate location rather than none.</li>
    <li><strong>Stay in the period.</strong> Kehillot covers about 1840 to 1870; earlier or later places are welcome when they explain something in that period.</li>
    <li><strong>No private information about living people.</strong> Approved contributions are public; choose the name you want used for credit. GitHub submissions and usernames are public.</li>
    <li><strong>Licensing.</strong> Contributions are published under CC BY 4.0, like the rest of the data. Don't paste long passages from copyrighted works; summarise and cite.</li>
  </ul>
  <p class="small">Working with a large list, such as a city directory or a run of advertisements? Get in touch through a <a href="${esc(suggestUrl('correction', { title: '[Bulk contribution] ' }))}">suggestion</a>: a spreadsheet can be imported in one go.</p>
  <h2 id="collecting">What we're collecting</h2>
  <p>Kehillot is built to grow. Each category below has a place in the data model, a map symbol and a filter, even where nothing has been recorded yet. Copy a template from <code>data/templates/</code> in the source repository, fill it in from a cited source, and add it to the matching data file.</p>
  <div class="table-wrap"><table class="files collecting"><thead><tr><th scope="col"></th><th scope="col">Category</th><th scope="col">Recorded</th><th scope="col">Where it goes</th><th scope="col">Useful fields</th></tr></thead><tbody>
  ${[
    ['synagogue', 'Synagogues', data.site.filter((x) => x.kind === 'synagogue').length, 'sites.json', 'address, built, occupants (congregations, with years)'],
    ['cemetery', 'Cemeteries', data.cemetery.length, 'cemeteries.json', 'address, established, closed, owners (congregations)'],
    ['school', 'Educational institutions', data.site.filter((x) => x.kind === 'school').length + data.institution.filter((x) => x.category === 'education').length, 'sites.json (kind "school") or organizations.json (category "education")', 'founded, address, teachers and founders (people roles)'],
    ['matzah-bakery', 'Matzah bakeries', data.site.filter((x) => x.kind === 'matzah-bakery').length, 'sites.json (kind "matzah-bakery")', 'opened, closed, proprietors, supervisedBy, advertisedIn'],
    ['lodging', 'Jewish hotels and boarding houses', data.site.filter((x) => x.kind === 'lodging').length, 'sites.json (kind "lodging")', 'opened, closed, proprietors, supervisedBy, advertisedIn'],
    ['kosher-restaurant', 'Kosher restaurants', data.site.filter((x) => x.kind === 'kosher-restaurant').length, 'sites.json (kind "kosher-restaurant")', 'opened, closed, proprietors, supervisedBy, advertisedIn'],
    ['business', 'Jewish-owned businesses', data.site.filter((x) => x.kind === 'business').length, 'sites.json (kind "business")', 'opened, closed, proprietors, advertisedIn'],
    ['bookstore', 'Bookstores', data.site.filter((x) => x.kind === 'bookstore').length, 'sites.json (kind "bookstore")', 'opened, closed, proprietors, advertisedIn'],
    ['city', 'Clergy', data.person.filter((x) => clergyTitles(x).length).length, 'people.json', 'clergyTitles (rabbi, hazan, minister, preacher, chaplain, shochet, mohel, shammash), roles with congregations and years'],
  ].map(([k, label, n, where, fields]) => `<tr><td>${k === 'city' ? '' : SYM.svg(k, { size: 18 })}</td><th scope="row">${label}</th><td>${n || '<span class="muted">none yet</span>'}</td><td><code>${esc(where)}</code></td><td class="small">${esc(fields)}</td></tr>`).join('')}
  </tbody></table></div>
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
  <h2 id="editing">Editing the data directly</h2>
  <p>The data lives in plain JSON files in the <code>data/</code> folder of the <a href="https://github.com/${cfg.contribute.repo}">source repository</a>, with templates in <code>data/templates/</code>. Edit a record, add a source, and run <code>npm run build</code>: the build validates every reference before publishing. To suggest changes without editing files, use the <a href="#contribute">suggestion forms</a>.</p>
  <h2 id="principles">Principles</h2>
  <ul>
    <li><a href="https://www.go-fair.org/fair-principles/">FAIR</a>: findable (stable URIs, DCAT, sitemap), accessible (static files, no login), interoperable (RDF, CSVW, GeoJSON, LPF), reusable (CC BY, provenance on every record).</li>
    <li>Minimal computing: no server, database or framework. The site is plain HTML, CSS and JavaScript that any host, or a USB stick, can serve, and the whole thing can be archived as-is.</li>
    <li>Accessible: semantic HTML, keyboard navigation, a text list alongside the map, and a data table behind every chart.</li>
  </ul>
  <h2 id="sources">Principal sources</h2>
  <ol class="sources">${[...data.source].sort((a, b) => (a.author || a.title).localeCompare(b.author || b.title)).map((s) => `<li>${citationText(s)}</li>`).join('')}</ol>
  <h2>Credits</h2>
  <p>Basemap © <a href="https://www.esri.com/">Esri</a> and contributors. Mapping with <a href="https://leafletjs.com/">Leaflet</a>.</p>
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
  ${Object.entries(VOCAB).map(([scheme, v]) => `<h2 id="scheme-${scheme}">Concept scheme: ${esc(v.label)}</h2><dl class="vocab-props">${Object.entries(v.concepts).map(([k, [l, d]]) => `<div id="${scheme}-${k}"><dt><code>kh:${scheme}-${k}</code> — ${esc(l)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>`).join('')}
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
    photographDate: m.displayDate || undefined,
    photographer: m.photographer ? {'@type':'schema:Person',name:m.photographer} : undefined,
    about: m.about.map((a) => uri(a.type, a.id)),
    isPartOf: m.collection ? collectionUri(m.collection.id) : undefined,
    iiifManifest: m.manifest || undefined, iiifService: m.image.service || undefined,
    contentLocation: m.geo ? { '@type': 'schema:Place', geo: { '@type': 'schema:GeoCoordinates', latitude: String(m.geo.lat), longitude: String(m.geo.lon) } } : undefined,
  });
}

const collections=(mediaConfig.collections || []).filter(c=>mediaCache.collections[c.id]).map(c=>({...c,metadata:mediaCache.collections[c.id],items:MEDIA.filter(m=>(mediaCache.collections[c.id].photos || []).includes(m.requestedUrl))}));
for (const c of collections) {
  const rel='../../', page=`${BASE}collections/${c.id}/`;
  if(c.expectedPhotoCount && c.items.length !== c.expectedPhotoCount) throw new Error(`Incomplete collection ${c.id}: ${c.items.length} of ${c.expectedPhotoCount} photos cached`);
  const ld={'@context':'https://schema.org','@graph':[
    {'@id':page,'@type':'CollectionPage',name:c.metadata.title,url:page,mainEntity:{'@id':collectionUri(c.id)}},
    {'@id':collectionUri(c.id),'@type':'Collection',name:c.metadata.title,url:c.url,description:c.summary || c.dateNote || 'Linked photographs and documents from the source collection.',provider:{'@type':'Organization',name:c.holder,url:c.holderUrl},hasPart:c.items.map(m=>({'@id':uri('media',m.id)})),about:(c.about||[]).map(a=>({'@id':uri(a.type,a.id)}))}
  ]};
  await out(`collections/${c.id}/index.jsonld`,JSON.stringify(ld,null,2));
  await out(`collections/${c.id}/index.html`,layout({rel,title:c.metadata.title,description:c.summary || c.metadata.title,canonical:page,alternate:'index.jsonld',jsonld:ld,current:'database/',body:`<div class="wrap"><nav class="crumbs"><a href="../">Pictures &amp; archives</a> / Collection</nav><header class="record-head"><p class="kicker">${esc(c.holder)}</p><h1>${esc(c.metadata.title)}</h1>${c.contextLabel ? `<p class="collection-context">${esc(c.contextLabel)}</p>` : ''}<p class="lede">${esc(c.summary || c.dateNote || '')}</p><p>${c.items.length} linked ${c.items.length === 1 ? 'item' : 'items'} · <a href="${esc(c.url)}">View original album on Flickr ↗</a></p>${c.dateNote ? `<details><summary>How to read these dates</summary><p class="small">${esc(c.dateNote)}</p></details>` : ''}<p class="small">Each item retains its source caption and rights statement. Images are shown from the source image service.</p>${(c.cityGuides||[]).length ? `<p>${c.cityGuides.map(id=>`<a class="btn btn-small btn-ghost" href="${rel}city/${id}/">Open ${esc(ALL_GUIDES.get(id))} guide →</a>`).join(' ')}</p>` : ''}</header>${gallery(rel,c.items,{heading:'Items in this collection',limit:c.items.length})}<p class="data-links"><a href="index.jsonld">Collection linked data (JSON-LD)</a></p></div>`}));
}
const collectionListLD={'@context':'https://schema.org','@type':'CollectionPage','@id':`${BASE}collections/`,name:'Pictures & archives',hasPart:collections.map(c=>({'@id':collectionUri(c.id)}))};
await out('collections/index.jsonld',JSON.stringify(collectionListLD,null,2));
await out('collections/index.html',layout({rel:'../',title:'Pictures & archives',description:'Browse photographs, family papers, synagogue records and business documents, with original captions and rights information.',canonical:`${BASE}collections/`,alternate:'index.jsonld',jsonld:collectionListLD,current:'database/',scripts:['assets/js/collections.js'],body:`<div class="wrap"><header class="page-head"><p class="kicker">Source collections</p><h1>Pictures &amp; archives</h1><p class="lede">Photographs, synagogue records, family papers and business documents from the Magnes Collection.</p><p>Some objects date from 1840–1870; others are later records or photographs that help document these communities. Check the date and rights on each item.</p></header><label for="collection-search">Find a collection, city or subject</label><input id="collection-search" type="search" placeholder="Try Nevada City, invoices, or synagogue"><p id="collection-count" class="small" role="status">${collections.length} collections</p><ul class="collection-grid">${collections.map(c=>`<li class="collection-card" data-collection-search="${esc([c.metadata.title,c.summary,c.contextLabel,...(c.cityGuides||[]).map(id=>ALL_GUIDES.get(id))].join(' ').toLowerCase())}">${c.items[0] ? `<a href="${c.id}/" tabindex="-1" aria-hidden="true"><img src="${esc(c.items[0].image.thumb)}" alt="" loading="lazy" width="110" height="100"></a>` : ''}<div><h2><a href="${c.id}/">${esc(c.metadata.title)}</a></h2><p class="small">${esc(c.contextLabel || 'Source photographs and documents')} · ${c.items.length} ${c.items.length === 1 ? 'item' : 'items'}</p></div></li>`).join('')}</ul><p class="small"><a href="../database/?type=media">Search individual pictures and documents →</a></p></div>`}));

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
  <nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${rel}">Home</a></li><li><a href="${rel}collections/">Pictures &amp; archives</a></li><li aria-current="page">${esc(m.title)}</li></ol></nav>
  <article class="record record-media">
    <header class="record-head"><p class="kicker">${m.source === 'iiif' ? 'Document or artwork' : 'Picture or document'}</p><h1>${esc(m.title)}</h1></header>
    <div class="media-grid">
      <figure class="media-figure">${viewer}
        <figcaption>${m.description ? `${esc(m.description)} ` : ''}<span class="credit">${esc(m.holder)}${m.attribution && !m.attribution.includes(m.holder) ? `. ${esc(m.attribution)}` : ''}. ${rightsLink(m)}.</span></figcaption>
      </figure>
      <div class="media-meta">
        ${dl([
          ['Depicts / about', depicted.join('<br>')],
          ['Photographer', esc(m.photographer || '')],
          ['Photograph date', m.displayDate ? `${esc(m.displayDate)}<br><span class="small muted">As dated in the Magnes collection description.</span>` : ''],
          ['Holder’s item date', m.date ? `${esc(m.date)}${m.dateNote ? `<br><span class="muted small">${esc(m.dateNote)}</span>` : '<br><span class="muted small">As given by the holder.</span>'}` : ''],
          ['Holder', m.holderUrl ? `<a href="${esc(m.holderUrl)}">${esc(m.holder)}</a>` : esc(m.holder)],
          ['Collection', m.collection ? `<a href="${rel}collections/${m.collection.id}/">${esc(m.collection.title)}</a>${m.collection.identifier ? ` <span class="muted">(${esc(m.collection.identifier)})</span>` : ''}` : esc(m.collection || '')],
          ['Identifier', esc(m.identifier || '')],
          ['Rights', rightsLink(m)],
          ['Where', m.geo ? `${m.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(', ')} <span class="muted small">(${m.geo.lat.toFixed(5)}, ${m.geo.lon.toFixed(5)}, geotag by holder)</span>` : m.places.map((p) => link(rel, 'place', p, placeLabel(p))).join(', ')],
          ['Original', `<a href="${esc(m.page)}">View at ${esc(sourceName(m))}</a>${m.manifest ? ` · <a href="${esc(m.manifest)}" type="application/ld+json">IIIF manifest</a>` : ''}`],
        ])}
        ${(m.collection?.cityGuides || []).filter(id=>!m.places.includes(id)).map(id=>`<p><a class="btn btn-small btn-ghost" href="${rel}city/${id}/">Open ${esc(ALL_GUIDES.get(id))} city guide →</a></p>`).join('')}
        ${m.places.filter((p) => CITY_IDS.includes(p)).map((p) => `<p><a class="btn btn-small btn-ghost" href="${rel}city/${p}/">Explore ${esc(index.place.get(p).name)} →</a></p>`).join('')}
      </div>
    </div>
    ${m.collection ? `<p><a href="${rel}collections/${m.collection.id}/">Browse the full collection in Kehillot →</a></p>` : ''}
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
const GROUP_NAMES = SYM.GROUPS.map((g) => g[0]);
const KIND_GROUP = (k) => SYM.groupOf(k);
const KIND_ORDER = (k) => GROUP_NAMES.indexOf(SYM.groupOf(k));
const PROPRIETOR_KINDS = ['matzah-bakery', 'lodging', 'kosher-restaurant', 'business', 'bookstore'];
function cityEntries(placeId, rel) {
  const sites = (siteByPlace.get(placeId) || []).map((s) => ({ type: 'site', r: s, kind: s.kind, from: s.built || s.opened || (s.occupants || []).map((o) => o.from).filter(Boolean).sort()[0] || null, to: s.closed || null }));
  const cems = (cemByPlace.get(placeId) || []).map((c) => ({ type: 'cemetery', r: c, kind: 'cemetery', from: c.established, to: c.closed || null }));
  return [...sites, ...cems].sort((a, b) => (KIND_ORDER(a.kind) - KIND_ORDER(b.kind)) || ((a.from || 9999) - (b.from || 9999))).map((e) => {
    const s = e.r;
    const pics = mediaByRecord.get(`${e.type}/${s.id}`) || [];
    const users = e.type === 'site'
      ? (s.occupants || []).map((o) => `${link(rel, typeOfOrg(o.org), o.org, nameOf(typeOfOrg(o.org), o.org))}${o.from ? ` <span class="muted">${span(o.from, o.to)}</span>` : ''}`)
        .concat((s.proprietors || s.people || []).map((p) => link(rel, 'person', p, nameOf('person', p))))
      : (s.owners || []).map((o) => link(rel, 'congregation', o, nameOf('congregation', o)));
    const evs = e.type === 'site' ? eventsBySite.get(s.id) || [] : [];
    return { ...e, pics, html: `<li class="entry" id="e-${s.id}" data-id="${s.id}" data-type="${e.type}" data-entity-uri="${esc(uri(e.type,s.id))}" data-record-url="${esc(docUri(e.type,s.id))}" data-kind="${e.kind}" data-group="${KIND_GROUP(e.kind)}" data-lat="${s.lat}" data-lon="${s.lon}" data-from="${e.from || ''}" data-to="${e.type === 'cemetery' ? '' : e.to || ''}" data-precision="${s.precision}" data-pics="${pics.length}">
      <span id="stop-${e.type}-${s.id}" class="stop-anchor" aria-hidden="true"></span><button type="button" class="entry-head" aria-expanded="false"><span class="entry-sym" title="${esc(SYM.label(e.kind))}">${SYM.svg(e.kind, { size: 18, approx: s.precision === 'approximate' })}</span><span class="entry-name">${esc(s.name)}</span><span class="entry-years">${e.from ? span(e.from, e.to) : ''}</span></button>
      <div class="entry-body">
        <p class="entry-addr">${esc(s.address)}${s.precision === 'approximate' ? ' <span class="muted">(location approximate)</span>' : ''}</p>
        ${s.note ? `<p>${esc(s.note)}</p>` : ''}
        ${users.length ? `<p><span class="entry-label">${e.type === 'cemetery' ? 'Maintained by' : PROPRIETOR_KINDS.includes(e.kind) ? 'Proprietors' : 'Used by'}</span> ${users.join(', ')}</p>` : ''}
        ${(s.advertisedIn || []).length ? `<p><span class="entry-label">Advertised in</span> ${s.advertisedIn.map((x) => `<i>${link(rel, 'periodical', x.periodical, nameOf('periodical', x.periodical))}</i>${x.date ? ` ${esc(x.date)}` : ''}`).join('; ')}</p>` : ''}
        ${evs.length ? `<p><span class="entry-label">Here</span> ${evs.map((x) => `${link(rel, 'event', x.id, x.name)} <span class="muted">${formatDate(x.date)}</span>`).join('; ')}</p>` : ''}
        ${pics.length ? `<ul class="entry-thumbs">${pics.slice(0, 6).map((m) => `<li><a href="${rel}media/${m.id}/"><img src="${esc(m.image.square || m.image.thumb)}" alt="${esc(m.title)}" loading="lazy" width="64" height="64"></a></li>`).join('')}${pics.length > 6 ? `<li class="entry-more"><a href="${rel}${docPath(e.type, s.id)}#h-gal-${pics[0].id}">+${pics.length - 6}</a></li>` : ''}</ul>` : ''}
        <p class="small"><a href="${rel}${docPath(e.type,s.id)}#claim-location">Check date &amp; location evidence →</a></p>
        <p class="entry-sources"><span class="entry-label">Sources</span> ${s.sources.map(id => link(rel, 'source', id, index.source.get(id).title.split(':')[0])).join('; ')}</p>
        <p><a href="${rel}${docPath(e.type, s.id)}">Full record →</a> · <a href="${locateUrl(rel,e.type,s)}">Help locate this place ↗</a></p>
      </div></li>` };
  });
}
function clergySection(placeId, rel) {
  const p = index.place.get(placeId);
  const local = new Set([...(congByPlace.get(placeId) || [])].map((c) => c.id));
  const rows = data.person.filter((x) => clergyTitles(x).length && (x.roles.some((r) => local.has(r.org)) || x.places.includes(placeId)));
  return `<section class="clergy" aria-labelledby="h-clergy"><h2 id="h-clergy">Clergy</h2>
  ${rows.length ? `<ul class="related">${rows.sort((a, b) => (a.roles.find((r) => local.has(r.org))?.start || 9999) - (b.roles.find((r) => local.has(r.org))?.start || 9999)).map((x) => `<li>${link(rel, 'person', x.id, x.name)} ${clergyTitles(x).map((t) => badge('clergyTitle', t)).join(' ')}
    ${x.roles.filter((r) => local.has(r.org)).map((r) => `<br><span class="muted small">${esc(r.role)}, ${nameOf('congregation', r.org)}${r.start ? ` ${span(r.start, r.end)}` : ''}</span>`).join('')}</li>`).join('')}</ul>` : ''}
  <p class="section-note">${rows.length ? 'Recorded so far. ' : `No clergy recorded yet for ${esc(p.name)}. `}Rabbis, hazanim, ministers, shochtim, mohalim and shamashim can be added; see <a href="${rel}about/#collecting">what we're collecting</a>.</p></section>`;
}
function educationSection(placeId, rel) {
  const insts = (instByPlace.get(placeId) || []).filter((o) => o.category === 'education');
  const schools = (siteByPlace.get(placeId) || []).filter((s) => s.kind === 'school');
  const p = index.place.get(placeId);
  return `<section class="education" aria-labelledby="h-edu"><h2 id="h-edu">Educational institutions</h2>
  ${insts.length || schools.length ? ul([...insts.map((o) => `${link(rel, 'institution', o.id, o.name)} <span class="muted">${span(o.founded, o.dissolved)}</span>`), ...schools.map((s) => `<a href="#e-${s.id}" data-goto="${s.id}">${esc(s.name)}</a> <span class="muted">${esc(s.address)}</span>`)]) : ''}
  <p class="section-note">${insts.length || schools.length ? 'Recorded so far. ' : `No schools recorded yet for ${esc(p.name)}. `}Day schools, Sunday schools, Hebrew classes, seminaries and educational societies can be added; see <a href="${rel}about/#collecting">what we're collecting</a>.</p></section>`;
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
function archiveMatches(name) {
  const token = name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return occidentArchive.articles.filter(a=>new RegExp(`(^|[^a-z])${token}([^a-z]|$)`,'i').test(a.title));
}
function researchProfile(placeId, rel) {
  const p=index.place.get(placeId), sites=siteByPlace.get(placeId)||[], cems=cemByPlace.get(placeId)||[], congs=congByPlace.get(placeId)||[], insts=instByPlace.get(placeId)||[];
  const records=[...congs,...insts,...sites,...cems,...(perByPlace.get(placeId)||[]),...(eventByPlace.get(placeId)||[])];
  const sources=[...new Set(records.flatMap(r=>r.sources||[]))], readers=readersFor(placeId), leads=archiveMatches(p.name);
  const approximate=[...sites,...cems].filter(r=>r.precision!=='exact').length;
  const missing=['school','matzah-bakery','lodging','kosher-restaurant'].filter(kind=>!sites.some(r=>r.kind===kind) && !(kind==='school' && insts.some(r=>r.category==='education'))).map(kind=>SYM.label(kind).toLowerCase());
  return `<details class="research-profile"><summary>Research profile <span class="small muted">· records, evidence &amp; gaps</span></summary><div class="profile-content"><h2>What is recorded here</h2><p>${congs.length} congregations · ${insts.length} institutions · ${sites.length} sites · ${cems.length} ${cems.length === 1 ? 'cemetery' : 'cemeteries'}. These counts describe Kehillot’s current coverage.</p>${readers.length ? `<p>${readers.reduce((n,r)=>n+r.n,0).toLocaleString('en-US')} subscription entries in ${readers.length} newspapers; entries may refer to the same person more than once. <a href="#h-readers">Inspect subscriber records below</a>.</p>` : '<p>Subscriber records are not yet linked to this city.</p>'}<p>${approximate ? `${approximate} mapped locations have approximate precision. ` : ''}Open a full record to check evidence for its dates and coordinates. A linked bibliography alone does not establish every claim.</p>${sources.length ? `<details><summary>Sources behind the local records (${sources.length})</summary><ul>${sources.map(id=>`<li>${link(rel,'source',id,index.source.get(id).title)}</li>`).join('')}</ul></details>` : ''}<h3>Open research questions</h3><p>${missing.length ? `${esc(missing.join(', '))} are not yet recorded here. ` : ''}Which historical addresses can be supported by a directory, advertisement or period map? Missing records do not establish historical absence.</p><p><a href="${esc(suggestUrl('add-site',{place:p.name,title:`Research in ${p.name}`}))}">Contribute a sourced discovery →</a></p>${leads.length ? `<h3>In the Occident archive</h3><p class="small">${leads.length} index links mention this city name. These are reading leads; similarly named places and the contents of each article still need checking.</p><ul>${leads.slice(0,4).map(a=>`<li><a href="${esc(a.url)}">${esc(a.title)}</a> <span class="small muted">${a.date}</span></li>`).join('')}</ul><a href="${rel}sources/occident/?q=${encodeURIComponent(p.name)}">Search all matching article titles →</a>` : `<p><a href="${rel}sources/occident/?q=${encodeURIComponent(p.name)}">Look for this city in the Occident article index →</a></p>`}</div></details>`;
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
  const groups = GROUP_NAMES;
  const counts = Object.fromEntries(groups.map((g) => [g, entries.filter((e) => KIND_GROUP(e.kind) === g).length]));
  const groupIcon = (g) => SYM.svg(SYM.GROUPS.find((x) => x[0] === g)[1][0], { size: 16 });
  if (C.historicalMap && (!/^https:\/\//.test(C.historicalMap.url || '') || !['{z}','{x}','{y}'].every(token=>C.historicalMap.url.includes(token)) || !C.historicalMap.label || !C.historicalMap.attribution || !/^https:\/\//.test(C.historicalMap.sourceUrl || ''))) throw new Error(`City ${placeId}: historicalMap needs an HTTPS XYZ tile URL, dated label, attribution and HTTPS sourceUrl`);
  const cityData = {
    name: p.name, tiles: { relief: cfg.basemap, street: cfg.streetmap, terrain: cfg.terrain }, center: [p.lat, p.lon], range: [yMin, yMax],
    historicalMap: C.historicalMap || null,
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
    <h1>${esc(p.name)}</h1>
    <p class="city-counts">${[...groups.filter((g) => counts[g]).map((g) => `${counts[g]} ${counts[g] === 1 ? SYM.label(SYM.GROUPS.find((x) => x[0] === g)[1][0]).toLowerCase() : g.toLowerCase()}`), pics.length && `${pics.length} picture${pics.length === 1 ? '' : 's'} and documents`].filter(Boolean).join(' · ')}</p>
    <details class="city-background"><summary>About this city &amp; sources</summary>
    ${(C.intro || []).map((t) => `<p class="city-intro">${esc(t)}</p>`).join('')}
    ${C.sources?.length ? `<p class="small muted">Sources: ${C.sources.map((s) => `<i>${link(rel, 'source', s, index.source.get(s).title.split(/[:(]/)[0].trim())}</i>`).join('; ')}. Full records: <a href="${rel}place/${placeId}/">${esc(p.name)}</a>.</p>` : `<p class="small"><a href="${rel}place/${placeId}/">All records for ${esc(p.name)} →</a></p>`}
  <div class="historical-research"><h3>Historical maps</h3><p>Compare period maps and directories before placing a historical address. Street names, numbering, and shorelines may have changed.</p><ul>${(C.historicalMap ? [{title:C.historicalMap.label,url:C.historicalMap.sourceUrl}] : []).concat(C.mapSources || []).map(m=>`<li><a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title)}</a>${m.date ? ` · ${esc(m.date)}` : ''}</li>`).join('')}<li><a href="https://www.davidrumsey.com/view/georeferencer" target="_blank" rel="noopener">Find and compare georeferenced maps at David Rumsey</a></li><li><a href="https://atlascope.leventhalmap.org/" target="_blank" rel="noopener">Atlascope: Boston and Massachusetts city atlases</a></li></ul></div>
    </details>
  </header>
  ${researchProfile(placeId,rel)}
  <div class="city-map-actions"><button class="btn btn-small" type="button" id="tour-launch" disabled>Take a city journey</button><button class="btn btn-small btn-ghost" type="button" id="city-fit">See the whole city</button></div>
  <div class="explorer">
    <div class="plate explorer-map"><div id="tour-map-controls" class="tour-map-controls" hidden><button type="button" data-tour-action="prev" aria-label="Previous stop on map">←</button><span id="tour-map-progress"></span><button type="button" data-tour-action="next" aria-label="Next stop on map">→</button><button type="button" data-tour-action="end" aria-label="End city journey on map">×</button></div><div id="tour-map-caption" class="tour-map-caption" hidden></div><div id="city-map" class="city-map" role="region" aria-label="Map of Jewish sites in ${esc(p.name)}"></div></div>
    <section class="explorer-panel" aria-labelledby="h-places">
      <h2 id="h-places" class="visually-hidden">Places on the map</h2>
      <details class="explorer-controls"><summary>Year &amp; map filters</summary>
        ${yMin < yMax ? `<label class="yr"><span>Map year</span> <output id="city-year-out" for="city-year">${yMax}</output><input type="range" id="city-year" min="${yMin}" max="${yMax}" value="${yMax}" step="1"></label>` : ''}
        <fieldset class="filters"><legend class="visually-hidden">Show</legend>
          ${groups.filter((g) => counts[g]).map((g) => `<label><input type="checkbox" name="group" value="${g}" checked> <span class="f-sym">${groupIcon(g)}</span>${g} <span class="muted">${counts[g]}</span></label>`).join('')}
          ${geoPics.length ? `<label><input type="checkbox" name="group" value="Pictures" checked> Pictures <span class="muted">${geoPics.length}</span></label>` : ''}
        </fieldset>
        <p id="city-count" class="city-count" aria-live="polite"></p>
        ${groups.some((g) => !counts[g]) ? `<p class="not-yet-recorded">Not yet recorded here: ${groups.filter((g) => !counts[g]).map((g) => `<span class="nyr"><span class="f-sym">${groupIcon(g)}</span>${g.toLowerCase()}</span>`).join(', ')}. <a href="${esc(suggestUrl('add-site', { title: `[Place] … in ${p.name}` }))}">Suggest one</a> · <a href="${rel}about/#contribute">how to contribute</a>.</p>` : ''}
        <button class="btn btn-small btn-ghost" id="city-center" type="button">City center</button>
      </details>
      <section class="city-tour" id="journey" aria-labelledby="tour-heading">
        <p class="kicker">City journey</p><h2 id="tour-heading">${esc(p.name)} · selected stops</h2>
        <p class="tour-intro">Explore the recorded places in date order. Adjust the year and categories under Map filters.</p>
        <div class="tour-controls"><button class="btn btn-small" id="tour-start" type="button" disabled>Start city journey</button></div>
        <p class="tour-progress" id="tour-progress" role="status" aria-live="polite">${entries.length ? 'Loading the city journey…' : 'No address-level stops recorded yet. Explore the subscribers below or help locate a site.'}</p>
        <div id="tour-active" hidden><h3 id="tour-title"></h3><div class="tour-story" id="tour-story" aria-labelledby="tour-title"></div>
          <div class="tour-controls"><button class="btn btn-small btn-ghost" id="tour-prev" type="button">← Previous</button><button class="btn btn-small" id="tour-next" type="button">Next stop →</button></div>
          <div class="tour-share"><button type="button" id="tour-share">Share this stop ↗</button><button id="tour-show-map" type="button">View on map ↑</button><button id="tour-end" type="button" hidden>Exit journey</button><label class="visually-hidden" for="tour-share-url">Link to this stop</label><input id="tour-share-url" type="url" readonly hidden><p id="tour-share-status" class="small" role="status" aria-live="polite"></p></div>
          <details><summary>All stops</summary><ol class="tour-stop-list" id="tour-stops"></ol></details><details class="tour-data"><summary>Linked data</summary><p><a id="tour-entity-link">Permanent place identifier</a> · <a id="tour-jsonld-link">JSON-LD record</a> · <a href="index.jsonld">Journey metadata</a></p></details>
        </div>
      </section>
      <details class="city-records" id="city-records"><summary>Browse all ${entries.length} mapped places</summary>
      <ol class="entries" id="city-list">${entries.map((e) => e.html).join('')}</ol>
      ${!entries.length ? '<p class="muted">No buildings or cemeteries mapped yet; the pictures below are placed where their holders geotagged them.</p>' : ''}
      </details>
    </section>
  </div>
  <p class="map-context">Modern streets · historical locations. Hover over a marker for its name.</p>
  <script type="application/json" id="city-data">${JSON.stringify(cityData).replace(/</g, '\\u003c')}</script>
  <details class="city-research-sections"><summary>People, subscribers, pictures &amp; city history</summary>
  ${congregationMoves(placeId, rel)}
  ${clergySection(placeId, rel)}
  ${educationSection(placeId, rel)}
  ${readersSection(rel, placeId, { names: true })}
  ${cityCollections(placeId,rel)}
  ${gallery(rel, pics, { heading: 'Pictures and documents', limit: 48 })}
  <div class="city-cols">
    ${cityTimeline(placeId, rel)}
    <div>
      ${others.length ? `<section><h2>Institutions and periodicals</h2>${ul(others)}</section>` : ''}
      ${ps.length ? `<section><h2>People</h2>${ul(ps.map((x) => `${link(rel, 'person', x.id, x.name)} <span class="muted">${lifespan(x)}</span>`))}</section>` : ''}
    </div>
  </div>
</details>
</div>`;
  const cityPage = `${BASE}city/${placeId}/`;
  const journeyId = `${cityPage}#journey`;
  const journeyEntries = entries.filter(e => e.r.precision !== 'city').sort((a,b)=>(a.from || Infinity)-(b.from || Infinity)||a.r.name.localeCompare(b.r.name));
  const ld = { '@context':'https://schema.org', '@graph': [
    { '@id':cityPage, '@type':'WebPage', name:title, url:cityPage, about:{'@id':uri('place',placeId)}, mainEntity:{'@id':journeyId} },
    { '@id':journeyId, '@type':'ItemList', name:`Recorded places in ${p.name}, in date order`, mainEntityOfPage:{'@id':cityPage},
      description:'Address-level records in date order. The interactive journey can filter these records by year and category.',
      itemListOrder:'https://schema.org/ItemListOrderAscending', numberOfItems:journeyEntries.length,
      itemListElement:journeyEntries.map((e,i)=>({ '@id':`${cityPage}#stop-${e.type}-${e.r.id}`, '@type':'ListItem', position:i+1,
        item:{'@id':uri(e.type,e.r.id)}, name:e.r.name,
        url:`${cityPage}?${new URLSearchParams({year:String(Math.max(Y1,e.from || Y1)),tour:'1',stop:e.r.id})}#journey` })) }
  ] };
  await out(`city/${placeId}/index.jsonld`,JSON.stringify(ld,null,2));
  await out(`city/${placeId}/index.html`, layout({ rel, title, description: `${title}: synagogues, cemeteries, pictures and documents on a map${C.intro ? '. ' + C.intro[0] : ''}`.slice(0, 300),
    canonical: cityPage, alternate:`${cityPage}index.jsonld`, jsonld: ld, body, current: 'cities/',
    styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/symbols.js', 'assets/js/city.js'] }));
}

for (const place of READ_PLACES.filter(p => !p.own)) {
  const rel = '../../';
  const papers = Object.keys(place.keys);
  const label = [place.name, place.state || place.country].filter(Boolean).join(', ');
  const rows = papers.map(paper => {
    const R = READERS[paper], key = place.keys[paper];
    const sourcePlace = R.places.find(p => p.k === key);
    const subs = R.subs.filter(s => s[1] === key).sort((a,b)=>(a[2]||0)-(b[2]||0) || String(a[0]).localeCompare(String(b[0])));
    return `<section><h2>${link(rel, 'periodical', paper, nameOf('periodical',paper))}</h2><p>${sourcePlace.n.toLocaleString('en-US')} subscriptions recorded in this locality. Counts represent entries in the source lists, not necessarily distinct people.</p><details class="subs"><summary>List the subscribers (${subs.length})</summary><ol class="subs-list">${subs.map(s=>`<li>${esc(s[0] || 'Unnamed')} <span class="muted">${s[2] || 'undated'}${s[3] && s[3] !== 'I' ? ` · ${esc(TYPE_LABEL[s[3]] || s[3])}` : ''}</span></li>`).join('')}</ol></details>${datasetFor(paper) ? `<p class="small">Source: ${dsCitation(datasetFor(paper))}</p>` : ''}</section>`;
  }).join('');
  const cityPage = `${BASE}city/${place.cityId}/`;
  const localityLD = { '@context':'https://schema.org', '@graph': [
    {'@id':cityPage,'@type':'WebPage',name:label,url:cityPage,about:{'@id':`${cityPage}#locality`},citation:papers.map(p=>datasetFor(p)?.doiUrl).filter(Boolean)},
    {'@id':`${cityPage}#locality`,'@type':'Place',name:place.name,description:'Locality identified in the source subscriber lists; coordinates identify the locality, not subscriber addresses.',
      address:[place.state,place.country].filter(Boolean).join(', '),geo:{'@type':'GeoCoordinates',latitude:place.lat,longitude:place.lon},
      identifier:{'@type':'PropertyValue',propertyID:'Locality key in the source datasets',value:place.k} }
  ] };
  await out(`city/${place.cityId}/index.jsonld`,JSON.stringify(localityLD,null,2));
  await out(`city/${place.cityId}/index.html`, layout({ rel, title: label, alternate:`${cityPage}index.jsonld`, jsonld:localityLD, canonical: `${BASE}city/${place.cityId}/`, current: 'cities/',
    description: `Jewish newspaper subscribers recorded in ${label}, with names, dates and source datasets.`,
    styles: ['assets/vendor/leaflet/leaflet.css'], scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/js/subscriber-city.js'],
    body: `<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><ol><li><a href="${rel}cities/">Cities and towns</a></li><li aria-current="page">${esc(place.name)}</li></ol></nav><header class="city-head" id="locality"><p class="kicker">Subscriber locality</p><h1>${esc(place.name)}</h1><p class="lede">${esc(place.state || '')}${place.state && place.country ? ' · ' : ''}${esc(place.country || '')}</p><p>${subscriptionCount(place).toLocaleString('en-US')} subscriptions across ${papers.length} newspaper${papers.length === 1 ? '' : 's'}.</p></header>
    <div class="plate"><div id="subscriber-city-map" class="city-map subscriber-city-map" role="region" aria-label="Street map of ${esc(label)}"></div></div><p class="section-note">The marker identifies the locality recorded in the source, not a subscriber’s home or business address. Modern streets and optional terrain relief show today’s geography. No congregation or institution is inferred from a subscription.</p>
    <p class="cta"><a class="btn btn-small btn-ghost" href="${rel}contribute/?type=location&amp;record=${encodeURIComponent(`${BASE}city/${place.cityId}/`)}&amp;title=${encodeURIComponent(place.name)}&amp;place=${encodeURIComponent(label)}&amp;lat=${place.lat}&amp;lon=${place.lon}">Help locate a historical address ↗</a><a class="btn btn-small" href="${rel}subscribers/#place=${encodeURIComponent(place.k)}">See this place on the subscriber map ↗</a><a class="btn btn-small btn-ghost" href="${esc(suggestUrl('add-site',{title:`[Place] ${place.name}`}))}">Add a sourced local site</a></p>
    <details class="research-profile"><summary>Research profile · evidence &amp; gaps</summary><div class="profile-content"><p>This locality is documented by the subscriber lists cited below. Subscription years identify entries in those lists, not a person’s complete residence history.</p><p>Congregations, institutions and specific subscriber addresses are not yet linked to this locality in Kehillot. The map point identifies a locality center; it is not evidence for a home or business location.</p><a href="${rel}sources/occident/?q=${encodeURIComponent(place.name)}">Find reading leads in the Occident archive →</a></div></details>${cityCollections(place.cityId,rel)}${rows}${place.qid ? `<p class="small">Source locality identifier: <a href="https://www.wikidata.org/wiki/${esc(place.qid)}">${esc(place.qid)}</a>.</p>` : ''}</div>
    <script type="application/json" id="subscriber-city-data">${jsonForScript({lat:place.lat,lon:place.lon,tiles:cfg.streetmap,terrain:cfg.terrain})}</script>` }));
}

// Original-source article catalogue: metadata only, independently identifiable entries.
const archivePage=`${BASE}sources/occident/`;
const archiveLD={'@context':'https://schema.org','@graph':[
  {'@id':archivePage,'@type':'CollectionPage',name:occidentArchive.title,url:archivePage,description:occidentArchive.coverage,isBasedOn:occidentArchive.source},
  ...occidentArchive.articles.map(a=>({'@id':`${archivePage}#article-${a.id}`,'@type':'Article',name:a.title,url:a.url,datePublished:a.date,isPartOf:{'@id':uri('periodical','occident')},isBasedOn:a.indexUrl}))
]};
await out('sources/occident/index.jsonld',JSON.stringify(archiveLD,null,2));
await out('data/occident-articles.json',JSON.stringify(occidentArchive,null,2));
await out('data/evidence.json',JSON.stringify(claimEvidence,null,2));
const evidenceLD={'@context':'https://schema.org','@graph':Object.entries(claimEvidence).flatMap(([key,fields])=>{
  const [type,id]=key.split('/'), record=index[type].get(id);
  return Object.entries(fields).map(([field,entries])=>({'@id':`${docUri(type,id)}#claim-${field}`,'@type':'Claim',text:`${record.name}: ${field} = ${field==='location' ? `${record.lat}, ${record.lon}` : record[field]}`,about:{'@id':uri(type,id)},citation:entries.map(e=>({'@type':'CreativeWork',name:e.locator,isPartOf:{'@id':uri('source',e.source)},url:index.source.get(e.source).url,description:e.note}))}));
})};
await out('data/evidence.jsonld',JSON.stringify(evidenceLD,null,2));
await out('sources/occident/index.html',layout({rel:'../../',title:'Read the Occident',description:'Search article titles from ten Occident volume indexes, 1843–1853, with links to original reports.',canonical:archivePage,alternate:'index.jsonld',jsonld:archiveLD,scripts:['assets/js/occident-archive.js'],body:`<div class="wrap archive-page"><nav class="crumbs"><a href="../../database/">Find a record</a> / Source archive</nav><header><p class="kicker">Primary sources · article index</p><h1>Read the Occident</h1><p class="lede">Explore ${occidentArchive.articles.length.toLocaleString('en-US')} article links from the ten volume indexes linked by <a href="${esc(occidentArchive.source)}">TheOccident.com</a>.</p><p>Coverage: April 1843–March 1853. This catalogue imports article links and their labels, not full text or the complete 1843–1868 run. Issue months come from archive paths; publication dates may differ from the events described.</p></header><label for="archive-search">Find a city, person, institution or subject in article titles</label><input type="search" id="archive-search" placeholder="Try Philadelphia, school, or Buffalo"><p id="archive-status" class="small" role="status" aria-live="polite"></p>${Array.from({length:10},(_,i)=>i+1).map(v=>`<details class="archive-volume"><summary>Volume ${v} · ${1842+v}–${1843+v}</summary><ul>${occidentArchive.articles.filter(a=>a.volume===v).map(a=>`<li id="article-${a.id}" data-article-title="${esc(a.title.toLowerCase())}"><a href="${esc(a.url)}">${esc(a.title)}</a> <span class="small muted">${a.date}</span></li>`).join('')}</ul></details>`).join('')}<p class="small">Titles follow the archive’s link labels, including abbreviated headings. Imported ${esc(occidentArchive.imported)}. Transcriptions remain with the Jewish-American History Documentation Foundation. Some archive links use HTTP because its HTTPS certificate could not be verified during import.</p><p><a href="../../data/occident-articles.json">Download article metadata (JSON)</a> · <a href="index.jsonld">Linked data (JSON-LD)</a></p></div>`}));

// Cities index
const cityCards = CITY_IDS.map((id) => {
  const p = index.place.get(id);
  const n = (siteByPlace.get(id) || []).length + (cemByPlace.get(id) || []).length;
  const pics = mediaByPlace.get(id) || [];
  const cover = pics.find((m) => m.feature) || pics[0];
  return { id, p, n, pics, cover, score: n * 3 + pics.length };
}).filter(c => c.n || c.pics.length).sort((a, b) => b.score - a.score);
await out('cities/index.html', layout({ rel: '../', title: 'City guides', canonical: `${BASE}cities/`, current: 'cities/',
  description: 'Explore Jewish sites city by city: synagogues, cemeteries and other places on street maps, with pictures and documents from libraries and museums.',
  scripts: ['assets/js/city-directory.js'],
  body: `<div class="wrap"><h1>City guides</h1>
  <p class="lede">Search for a city to open its guide, or choose a mapped city below.</p>
  <form id="guide-open-form" class="guide-open-form"><label for="guide-city">Which city?</label><div><input id="guide-city" type="search" list="guide-city-choices" placeholder="New York, Cincinnati, San Francisco…" required autocomplete="off" disabled><datalist id="guide-city-choices"></datalist><button class="btn" type="submit" disabled>Open city guide ↗</button></div><p id="guide-open-status" class="small" role="status" aria-live="polite">Choose from all recorded cities and subscriber localities.</p><ul id="guide-matches" class="guide-matches" hidden></ul></form>


  <h2>Explore the city guides</h2>
  <ul class="city-cards">${cityCards.map((c) => `<li><a class="city-card" href="../city/${c.id}/">
    ${c.cover ? `<img src="${esc(c.cover.image.thumb)}" alt="" loading="lazy">` : '<span class="city-card-blank" aria-hidden="true">'+c.n+'<small>mapped places</small></span>'}
    <span class="city-card-body"><strong>${esc(c.p.name)}</strong><span class="muted">${esc(c.p.state)}</span>
    <span class="small">${[c.n && `${c.n} mapped site${c.n === 1 ? '' : 's'}`, c.pics.length && `${c.pics.length} picture${c.pics.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || `${readersFor(c.id).reduce((n,x)=>n+x.n,0)} subscriptions recorded`}</span><span class="guide-open-label">Open city guide ↗</span></span></a></li>`).join('')}</ul>
  <details class="locality-directory"><summary>Browse all recorded cities and subscriber localities</summary><h2>All recorded places</h2><label for="locality-search">Find a city, town, state, or country</label><input id="locality-search" type="search" placeholder="Search all recorded places…" autocomplete="off"><p id="locality-count" role="status">${data.place.length + READ_PLACES.filter(p=>!p.own).length} places</p>
  <div class="table-wrap"><table id="locality-table"><thead><tr><th scope="col">Place</th><th scope="col">State or country</th><th scope="col">Evidence recorded</th></tr></thead><tbody>
  ${[...data.place.map(p=>({id:p.id,name:p.name,region:p.state,sites:(siteByPlace.get(p.id)||[]).length+(cemByPlace.get(p.id)||[]).length, subscriptions:readersFor(p.id).reduce((n,x)=>n+x.n,0),guide:CITY_IDS.includes(p.id)})),...READ_PLACES.filter(p=>!p.own).map(p=>({id:p.cityId,name:p.name,region:[p.state,p.country].filter(Boolean).join(' · '),sites:0,subscriptions:subscriptionCount(p),guide:true}))].sort((a,b)=>a.name.localeCompare(b.name)||a.region.localeCompare(b.region)).map(p=>`<tr><th scope="row"><a href="../${p.guide?'city':'place'}/${p.id}/">${esc(p.name)}</a></th><td>${esc(p.region)}</td><td>${[p.sites ? `${p.sites} mapped sites` : '',p.subscriptions ? `${p.subscriptions.toLocaleString('en-US')} subscriptions` : ''].filter(Boolean).join(' · ') || 'Curated place record'}</td></tr>`).join('')}
  </tbody></table></div><button class="btn btn-small btn-ghost" id="locality-more" type="button" hidden>Show more places</button></details>
</div>` }));



// ───────────────────────── feature maps (one per feature + one comprehensive) ─────────────────────────
// Every mappable record becomes one item in data/features.json. To add a feature, add a line to
// FEATURES with a symbol from assets/js/symbols.js and a function that returns its items.
{
  const cityPt = (placeId) => { const p = index.place.get(placeId); return { lat: p.lat, lon: p.lon, precision: 'city', place: placeId }; };
  const sitePt = (s) => ({ lat: s.lat, lon: s.lon, precision: s.precision, place: s.place, address: s.address });
  const R = '../../';
  const siteItems = (kinds) => data.site.filter((s) => kinds.includes(s.kind)).map((s) => ({ ...sitePt(s), id: s.id, name: s.name, href: docPath('site', s.id),
    from: s.built || s.opened || null, to: s.closed || (s.occupants || []).map((o) => o.to).filter(Boolean).sort().at(-1) || null,
    sub: (s.occupants || []).map((o) => nameOf(typeOfOrg(o.org), o.org)).concat((s.proprietors || s.people || []).map((p) => nameOf('person', p))).join(', ') }));
  const FEATURES = [
    { id: 'congregations', symbol: 'congregation', label: 'Congregations', blurb: 'Every congregation, placed at its city, from its founding to its dissolution or 1870.',
      items: () => data.congregation.map((c) => ({ ...cityPt(c.place), id: c.id, name: c.name, href: docPath('congregation', c.id), from: c.founded, to: c.dissolved || null, sub: `${conceptLabel('rite', c.rite)} rite` })) },
    { id: 'synagogues', symbol: 'synagogue', label: 'Synagogue buildings', blurb: 'Buildings congregations worshipped in, at their addresses.', items: () => siteItems(['synagogue']) },
    { id: 'cemeteries', symbol: 'cemetery', label: 'Cemeteries', blurb: 'Jewish burial grounds and the congregations that kept them.',
      items: () => data.cemetery.map((c) => ({ ...sitePt(c), id: c.id, name: c.name, href: docPath('cemetery', c.id), from: c.established, to: null, sub: (c.owners || []).map((o) => nameOf('congregation', o)).join(', ') })) },
    { id: 'clergy', symbol: 'clergy', label: 'Clergy', blurb: 'Rabbis, hazanim, ministers and other religious functionaries, placed where they served, with their years of service.',
      items: () => data.person.filter((p) => clergyTitles(p).length).flatMap((p) => {
        const served = p.roles.filter((r) => index.congregation.has(r.org));
        const title = clergyTitles(p).map((t) => conceptLabel('clergyTitle', t)).join(', ');
        return served.length
          ? served.map((r, i) => ({ ...cityPt(index.congregation.get(r.org).place), id: `${p.id}-${i}`, name: p.name, href: docPath('person', p.id), from: r.start || null, to: r.end || null, sub: `${r.role}, ${nameOf('congregation', r.org)}` }))
          : p.places.slice(0, 1).map((pl) => ({ ...cityPt(pl), id: p.id, name: p.name, href: docPath('person', p.id), from: null, to: null, sub: title }));
      }) },
    { id: 'education', symbol: 'school', label: 'Educational institutions', blurb: 'Schools, Sunday schools, seminaries and educational societies.',
      items: () => [...siteItems(['school']), ...data.institution.filter((o) => o.category === 'education').map((o) => ({ ...cityPt(o.place), id: o.id, name: o.name, href: docPath('institution', o.id), from: o.founded, to: o.dissolved || null, sub: 'Educational institution' }))] },
    { id: 'matzah-bakeries', symbol: 'matzah-bakery', label: 'Matzah bakeries', blurb: 'Bakeries producing matzah for Passover.', items: () => siteItems(['matzah-bakery']) },
    { id: 'lodging', symbol: 'lodging', label: 'Hotels and boarding houses', blurb: 'Jewish hotels and kosher boarding houses.', items: () => siteItems(['lodging']) },
    { id: 'kosher-restaurants', symbol: 'kosher-restaurant', label: 'Kosher restaurants', blurb: 'Eating houses advertised as kosher.', items: () => siteItems(['kosher-restaurant']) },
    { id: 'businesses', symbol: 'business', label: 'Jewish-owned businesses', blurb: 'Shops, markets and firms owned by Jews.', items: () => siteItems(['business']) },
    { id: 'bookstores', symbol: 'bookstore', label: 'Bookstores', blurb: 'Sellers of Hebrew and Jewish books and religious goods.', items: () => siteItems(['bookstore']) },
    { id: 'societies', symbol: 'society', label: 'Societies and institutions', blurb: 'Benevolent societies, fraternal orders, hospitals and communal bodies.',
      items: () => [...data.institution.filter((o) => o.category !== 'education').map((o) => ({ ...cityPt(o.place), id: o.id, name: o.name, href: docPath('institution', o.id), from: o.founded, to: o.dissolved || null, sub: conceptLabel('category', o.category) })),
        ...siteItems(['hospital', 'meeting-place'])] },
    { id: 'periodicals', symbol: 'periodical', label: 'Periodicals', blurb: 'Jewish newspapers and journals, at their place of publication.',
      items: () => data.periodical.map((o) => ({ ...cityPt(o.place), id: o.id, name: o.name, href: docPath('periodical', o.id), from: o.founded, to: o.ceased || null, sub: `${o.language.map((l) => LANGS[l]).join('/')} ${o.frequency}` })) },
    { id: 'events', symbol: 'event', label: 'Events', blurb: 'Protests, conferences, dedications and other events, at their site or city.',
      items: () => data.event.map((e) => { const s = e.site && index.site.get(e.site); return { ...(s ? sitePt(s) : cityPt(e.place)), id: e.id, name: e.name, href: docPath('event', e.id), from: yearOf(e.date), to: yearOf(e.date), sub: formatDate(e.date) }; }) },
    { id: 'pictures', symbol: 'picture', label: 'Pictures and documents', blurb: 'Photographs and documents from libraries and museums, where their holders placed them.',
      items: () => MEDIA.filter((m) => m.geo).map((m) => ({ lat: m.geo.lat, lon: m.geo.lon, precision: 'geotag', place: m.places[0] || null, id: m.id, name: m.title, href: `media/${m.id}/`, from: null, to: null, sub: m.holder, thumb: m.image.square || m.image.thumb })) },
  ];
  const items = [];
  const counts = {};
  for (const F of FEATURES) { const its = F.items(); counts[F.id] = its.length; for (const it of its) items.push({ f: F.id, ...it, placeName: it.place ? placeLabel(it.place) : null }); }
  const years = items.flatMap((i) => [i.from, i.to]).filter(Boolean);
  // Slider spans 1820 to the last dated record before 1910; earlier records still show while they stand.
  const range = [Y0 - 20, Math.max(Y1, ...years.filter((y) => y <= 1910))];
  // Clergy journeys: each clergy member's pulpits (congregation roles) in date order.
  const journeys = data.person.filter((p) => clergyTitles(p).length).map((p) => {
    const stops = p.roles.filter((r) => index.congregation.has(r.org)).sort((a, b) => (a.start || 9999) - (b.start || 9999)).map((r) => {
      const c = index.congregation.get(r.org), pl = index.place.get(c.place);
      return { cong: c.name, congHref: docPath('congregation', c.id), place: placeLabel(c.place), lat: pl.lat, lon: pl.lon, start: r.start || null, end: r.end || null, role: r.role };
    });
    return { id: p.id, name: p.name, href: docPath('person', p.id), titles: clergyTitles(p).map((t) => conceptLabel('clergyTitle', t)), stops };
  }).filter((j) => j.stops.length >= 2);
  await out('data/features.json', JSON.stringify({ range, cityGuides: CITY_IDS, features: FEATURES.map(({ id, symbol, label, blurb }) => ({ id, symbol, label, blurb, count: counts[id] })), items, journeys }));

  const mapPage = async (slug, title, featureIds, intro, opts = {}) => {
    const rel = slug === 'all' ? '../../' : '../../';
    const multi = featureIds.length > 1;
    const F0 = FEATURES.find((f) => f.id === featureIds[0]);
    const n = featureIds.reduce((a, id) => a + counts[id], 0);
    const body = `<div class="atlas wrap fmap">
  <header class="page-head"><h1>${esc(multi ? 'Explore the map' : F0.label)}</h1><p>${esc(intro)}</p></header>
  <div class="map-switcher"><label for="map-view">Show</label> <select id="map-view" data-map-switch><option value="${rel}maps/all/"${multi?' selected':''}>All features</option>${FEATURES.map(F=>`<option value="${rel}maps/${F.id}/"${!multi&&F.id===F0.id?' selected':''}>${esc(F.label)}${counts[F.id] ? '' : ' (none recorded yet)'}</option>`).join('')}</select></div>
  ${cityNavigator(rel)}
  <details class="map-filter-panel"><summary>Layers, dates &amp; filters</summary>
    ${multi ? `<fieldset class="map-key fm-key"><legend>Show on the map</legend>${featureIds.map(id=>{const F=FEATURES.find(f=>f.id===id);return `<label${counts[id]?'':' class="fm-empty"'}><input type="checkbox" name="feature" value="${id}"${counts[id]?' checked':''}><span class="f-sym">${SYM.svg(F.symbol,{size:14})}</span>${esc(F.label)} <span class="muted">${counts[id]||'none yet'}</span></label>`;}).join('')}</fieldset>` : ''}
    <div class="timeline readers-time"><label class="r-yr">From <input type="range" id="fm-from" min="${range[0]}" max="${range[1]}" value="${Y0}"> <output id="fm-from-out">${Y0}</output></label><label class="r-yr">to <input type="range" id="fm-to" min="${range[0]}" max="${range[1]}" value="${Y1}"> <output id="fm-to-out">${Y1}</output></label></div>
    <label class="fm-search">Find a record on this map <input type="search" id="fm-q" placeholder="Name or place…" autocomplete="off"></label><button class="btn btn-small btn-ghost" id="fm-reset" type="button">Reset map filters</button>
  </details>
  ${opts.journeys ? `<details class="map-filter-panel"><summary>Follow clergy journeys</summary><div class="fm-journeys"><label><input type="checkbox" id="fm-jr"> Show journeys between pulpits</label><label class="fm-jr-who">for <select id="fm-jr-who"><option value="">everyone who moved (${journeys.length})</option>${journeys.map(j=>`<option value="${j.id}">${esc(j.name)} (${j.stops.length} pulpits)</option>`).join('')}</select></label><div id="fm-itinerary" class="fm-itinerary" aria-live="polite"></div></div></details>` : ''}
  ${!n?`<p class="empty-state">No ${esc(F0.label.toLowerCase())} recorded yet. <a href="${esc(suggestUrl(({education:'education','matzah-bakeries':'matzah-bakery',lodging:'lodging','kosher-restaurants':'kosher-restaurant',businesses:'business',bookstores:'bookstore',synagogues:'synagogue',cemeteries:'add-cemetery',clergy:'add-person',congregations:'add-congregation',societies:'add-institution',periodicals:'add-periodical',events:'add-event'}[F0.id]||'add-site'),{title:F0.label}))}">Suggest a sourced addition →</a></p>`:''}
  <div class="plate"><div id="fmap" class="atlas-map" role="region" aria-label="Map: ${esc(title)}"></div></div>
  <p id="fm-summary" class="map-summary" aria-live="polite"></p><p class="map-context">Modern street context. Records without an address are placed at the city center; approximate locations are marked with dashed symbols.</p>
  <details class="map-record-list"><summary id="fm-list-h">Browse the records on this map</summary><ol id="fm-list" class="fm-list"></ol></details>
</div>
<script type="application/json" id="fm-config">${JSON.stringify({features:featureIds,journeys:!!opts.journeys,tiles:{relief:cfg.basemap,street:cfg.streetmap,terrain:cfg.terrain}}).replace(/</g,'\\u003c')}</script>
<noscript><div class="wrap"><p>The map needs JavaScript. Every record is also listed in <a href="${rel}browse/">Browse</a>.</p></div></noscript>`;
    await out(`maps/${slug}/index.html`, layout({ rel, title, description: `${title}: ${intro}`.slice(0, 300), canonical: `${BASE}maps/${slug}/`, current: 'maps/', body,
      styles: ['assets/vendor/leaflet/leaflet.css', 'assets/vendor/markercluster/MarkerCluster.css'],
      scripts: ['assets/vendor/leaflet/leaflet.js', 'assets/vendor/markercluster/leaflet.markercluster.js', 'assets/js/symbols.js', 'assets/js/city-navigation.js', 'assets/js/featuremap.js'] }));
  };
  await mapPage('all', 'Jewish America, All Features', FEATURES.map((f) => f.id), 'Explore recorded places and people. Choose a map view or open the filters to narrow the results.');
  for (const F of FEATURES) await mapPage(F.id, F.label, [F.id], F.blurb, { journeys: F.id === 'clergy' });

  // Maps index
  const card = (href, symbol, title, blurb, count) => `<li><a class="map-card${count === 0 ? ' is-empty' : ''}" href="${href}"><span class="map-card-sym">${SYM.svg(symbol, { size: 34 })}</span><span class="map-card-body"><strong>${esc(title)}</strong><span>${esc(blurb)}</span><span class="small muted">${count === null ? '' : count ? `${count.toLocaleString('en-US')} on the map` : 'None recorded yet'}</span></span></a></li>`;
  await out('maps/index.html', layout({ rel: '../', title: 'Maps', canonical: `${BASE}maps/`, current: 'maps/',
    description: 'Maps of Jewish America, 1840–1870: a comprehensive map, one map for each kind of feature, the congregations atlas and the map of newspaper subscribers.',
    body: `<div class="wrap"><h1>Maps</h1>
  <p class="lede">Start with the comprehensive map, or open a map for a single kind of feature. Use City guides to explore one place; use the map controls to compare locations and dates.</p>
  <h2>Choose a starting point</h2>
  <ul class="map-cards">${card('all/', 'city', 'All features', 'Every mapped record, with each kind of feature as a layer you can switch on and off.', items.length)}
  ${card('../atlas/', 'congregation', 'Congregations over time', 'See congregations year by year and compare their founding rites.', null)}
  ${card('../subscribers/', 'periodical', 'Subscribers', 'Where subscribers to the Jewish press lived, from the papers\' own lists.', READ_TOTAL)}</ul>
  <details class="map-directory-more"><summary>Browse maps by record type</summary>
  <ul class="map-cards">${FEATURES.map((F) => card(`${F.id}/`, F.symbol, F.label, F.blurb, counts[F.id])).join('')}</ul></details>
  <p class="small"><a href="../cities/">City guides</a> show the same features street by street for a single city.</p></div>` }));
}


// ───────────────────────── visualizations ─────────────────────────
// Charts are drawn as SVG at build time (they work without JavaScript and carry a table view);
// the network is laid out in the browser with d3-force. Colors use the validated --viz-1..4 tokens.
{
  const VIZ = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)'];
  const tip = (t) => ` data-tip="${esc(t)}" tabindex="0"`;
  const tableView = (caption, head, rows) => `<details class="chart-data"><summary>Show the data as a table</summary><table><caption class="visually-hidden">${esc(caption)}</caption><thead><tr>${head.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></details>`;
  const legend = (items) => `<ul class="viz-legend">${items.map(([label, color]) => `<li><span class="viz-swatch" style="background:${color}"></span>${esc(label)}</li>`).join('')}</ul>`;

  // 1. Network: people ↔ congregations / institutions / periodicals (roles), congregation ↔ congregation (secession)
  const NODE_TYPES = [['person', 'Person'], ['congregation', 'Congregation'], ['institution', 'Institution'], ['periodical', 'Periodical']];
  const nodes = new Map(), links = [];
  const addNode = (type, id) => { const k = `${type}/${id}`; if (!nodes.has(k)) { const r = index[type].get(id); nodes.set(k, { id: k, type, name: r.name, href: docPath(type, id), place: r.place ? index.place.get(r.place).name : (r.places || []).map((p) => index.place.get(p).name).join(', ') }); } return k; };
  for (const p of data.person) for (const r of p.roles) {
    const t = typeOfOrg(r.org);
    links.push({ source: addNode('person', p.id), target: addNode(t, r.org), kind: 'role', label: `${r.role}${r.start ? `, ${span(r.start, r.end)}` : ''}` });
  }
  for (const c of data.congregation) if (c.splitFrom) links.push({ source: addNode('congregation', c.id), target: addNode('congregation', c.splitFrom), kind: 'split', label: `formed from, ${c.founded}` });
  for (const e of data.event) {
    const parts = [...(e.people || []).map((p) => ['person', p]), ...(e.orgs || []).map((o) => [typeOfOrg(o), o])];
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++)
      if (parts[i][0] === 'person' && parts[j][0] === 'person') links.push({ source: addNode(...parts[i]), target: addNode(...parts[j]), kind: 'event', label: e.name });
  }
  const degree = {};
  for (const l of links) { degree[l.source] = (degree[l.source] || 0) + 1; degree[l.target] = (degree[l.target] || 0) + 1; }
  const netData = { types: NODE_TYPES, nodes: [...nodes.values()].map((n) => ({ ...n, degree: degree[n.id] || 0 })), links };
  await out('data/network.json', JSON.stringify(netData));

  // 2. Rite at founding → orientation by 1870 (two-column flow)
  const rites = Object.keys(VOCAB.rite.concepts), ors = Object.keys(VOCAB.orientation.concepts);
  const flow = rites.flatMap((r) => ors.map((o) => ({ r, o, n: data.congregation.filter((c) => c.rite === r && c.orientation === o).length }))).filter((x) => x.n);
  const total = data.congregation.length;
  const FW = 640, FH = 300, FT = 26, colW = 14, gap = 10, x0 = 150, x1 = FW - 170;
  const scale = (FH - gap * 2) / total;
  const leftY = {}, rightY = {};
  let y = 0; for (const r of rites) { const n = data.congregation.filter((c) => c.rite === r).length; leftY[r] = { y, n }; y += n * scale + gap; }
  y = 0; for (const o of ors) { const n = data.congregation.filter((c) => c.orientation === o).length; rightY[o] = { y, n }; y += n * scale + gap; }
  const lOff = Object.fromEntries(rites.map((r) => [r, 0])), rOff = Object.fromEntries(ors.map((o) => [o, 0]));
  const ribbons = flow.map((f) => {
    const h = f.n * scale, ya = leftY[f.r].y + lOff[f.r], yb = rightY[f.o].y + rOff[f.o];
    lOff[f.r] += h; rOff[f.o] += h;
    const xa = x0 + colW, xb = x1, mx = (xa + xb) / 2;
    const d = `M${xa},${ya} C${mx},${ya} ${mx},${yb} ${xb},${yb} L${xb},${yb + h} C${mx},${yb + h} ${mx},${ya + h} ${xa},${ya + h} Z`;
    return `<path d="${d.replace(/(\d+\.\d{2})\d+/g, '$1')}" class="flow-ribbon" style="fill:${VIZ[rites.indexOf(f.r)]}"${tip(`${f.n} congregation${f.n === 1 ? '' : 's'}: founded ${conceptLabel('rite', f.r)}, ${conceptLabel('orientation', f.o)} by c. 1870`)}/>`;
  }).join('');
  const flowSvg = `<svg viewBox="0 -${FT} ${FW} ${FH + FT + 4}" class="viz-svg" role="img" aria-labelledby="flow-t flow-d"><title id="flow-t">Rite at founding and orientation by about 1870</title>
    <desc id="flow-d">${flow.map((f) => `${f.n} ${conceptLabel('rite', f.r)} to ${conceptLabel('orientation', f.o)}`).join('; ')}.</desc>
    ${ribbons}
    ${rites.map((r, i) => `<rect x="${x0}" y="${leftY[r].y}" width="${colW}" height="${leftY[r].n * scale}" style="fill:${VIZ[i]}" class="flow-node"/><text x="${x0 - 8}" y="${leftY[r].y + leftY[r].n * scale / 2 + 4}" text-anchor="end" class="viz-label">${conceptLabel('rite', r)} <tspan class="viz-num">${leftY[r].n}</tspan></text>`).join('')}
    ${ors.map((o) => `<rect x="${x1}" y="${rightY[o].y}" width="${colW}" height="${rightY[o].n * scale}" class="flow-node flow-node-r"/><text x="${x1 + colW + 8}" y="${rightY[o].y + rightY[o].n * scale / 2 + 4}" class="viz-label">${conceptLabel('orientation', o)} <tspan class="viz-num">${rightY[o].n}</tspan></text>`).join('')}
    <text x="${x0 + colW / 2}" y="-10" text-anchor="middle" class="viz-axis">At founding</text><text x="${x1 + colW / 2}" y="-10" text-anchor="middle" class="viz-axis">By c. 1870</text></svg>`;

  // 3. Congregations founded per decade, by region (stacked bars)
  const REG = ['Northeast', 'South', 'Midwest', 'West'];
  const decades = ['before 1820', ...[1820, 1830, 1840, 1850, 1860].map((d) => `${d}s`)];
  const decOf = (y) => (y < 1820 ? 'before 1820' : `${Math.floor(y / 10) * 10}s`);
  const dec = decades.map((d) => ({ d, by: Object.fromEntries(REG.map((r) => [r, data.congregation.filter((c) => decOf(c.founded) === d && index.place.get(c.place).region === r).length])) }));
  const maxDec = Math.max(...dec.map((x) => REG.reduce((a, r) => a + x.by[r], 0)));
  const BW = 640, BH = 260, bm = { l: 36, r: 10, t: 10, b: 30 }, bw = (BW - bm.l - bm.r) / decades.length;
  const yMax = Math.ceil(maxDec / 5) * 5, by = (v) => BH - bm.b - (v / yMax) * (BH - bm.t - bm.b);
  const bars = dec.map((x, i) => {
    let acc = 0;
    return REG.map((r, k) => {
      const v = x.by[r]; if (!v) return '';
      const y1 = by(acc + v), y0 = by(acc); acc += v;
      return `<rect x="${(bm.l + i * bw + bw * 0.22).toFixed(1)}" y="${(y1 + 1).toFixed(1)}" width="${(bw * 0.56).toFixed(1)}" height="${Math.max(0, y0 - y1 - 2).toFixed(1)}" rx="2" style="fill:${VIZ[k]}"${tip(`${x.d}: ${v} in the ${r}`)}/>`;
    }).join('') + `<text x="${(bm.l + i * bw + bw / 2).toFixed(1)}" y="${BH - 10}" text-anchor="middle" class="viz-axis">${x.d}</text><text x="${(bm.l + i * bw + bw / 2).toFixed(1)}" y="${(by(acc) - 5).toFixed(1)}" text-anchor="middle" class="viz-num">${acc}</text>`;
  }).join('');
  const grid = Array.from({ length: yMax / 5 + 1 }, (_, i) => i * 5).map((v) => `<line x1="${bm.l}" x2="${BW - bm.r}" y1="${by(v)}" y2="${by(v)}" class="viz-grid"/><text x="${bm.l - 6}" y="${by(v) + 4}" text-anchor="end" class="viz-axis">${v}</text>`).join('');
  const decSvg = `<svg viewBox="0 0 ${BW} ${BH}" class="viz-svg" role="img" aria-labelledby="dec-t"><title id="dec-t">Congregations founded per decade, by region</title>${grid}${bars}</svg>`;

  // 4. Clergy tenures (timeline of bars), grouped by congregation
  const tenures = data.person.filter((p) => clergyTitles(p).length).flatMap((p) => p.roles.filter((r) => index.congregation.has(r.org) && r.start).map((r) => ({ p, r, c: index.congregation.get(r.org) })))
    .sort((a, b) => a.c.name.localeCompare(b.c.name) || a.r.start - b.r.start);
  const TX0 = 1820, TX1 = 1900, TW = 700, rowH = 20, tl = 330, TH = tenures.length * rowH + 34;
  const tx = (y) => tl + ((Math.min(Math.max(y, TX0), TX1) - TX0) / (TX1 - TX0)) * (TW - tl - 10);
  const tenSvg = `<svg viewBox="0 0 ${TW} ${TH}" class="viz-svg" role="img" aria-labelledby="ten-t"><title id="ten-t">Clergy tenures by congregation, ${TX0}–${TX1}</title>
    ${[1820, 1840, 1860, 1880, 1900].map((yv) => `<line x1="${tx(yv)}" x2="${tx(yv)}" y1="4" y2="${TH - 24}" class="viz-grid"/><text x="${tx(yv)}" y="${TH - 8}" text-anchor="middle" class="viz-axis">${yv}</text>`).join('')}
    <rect x="${tx(Y0)}" y="4" width="${tx(Y1) - tx(Y0)}" height="${TH - 28}" class="viz-period"/>
    ${tenures.map((t, i) => { const yy = 6 + i * rowH, end = t.r.end || Math.min((t.p.died || TX1), TX1); const open = !t.r.end;
      return `<text x="${tl - 8}" y="${yy + 12}" text-anchor="end" class="viz-label viz-small">${esc(t.p.name)}, <tspan class="viz-muted">${esc(t.c.name.replace(/\s*\(.*\)/, '').replace(/^Kahal Kadosh /, ''))} (${esc(index.place.get(t.c.place).name)})</tspan></text>
      <rect x="${tx(t.r.start)}" y="${yy + 3}" width="${Math.max(3, tx(end) - tx(t.r.start))}" height="11" rx="2" class="ten-bar${open ? ' ten-open' : ''}"${tip(`${t.p.name}: ${t.r.role}, ${t.c.name}, ${t.r.start}–${t.r.end || (t.p.died ? `until death in ${t.p.died}?` : 'end not recorded')}`)}/>`; }).join('')}</svg>`;

  // 5. Subscriptions recorded per year, by paper (lines, shared axis)
  const papers = Object.keys(READERS);
  const sYears = papers.flatMap((p) => READERS[p].subs.map((x) => x[2]).filter(Boolean));
  const SY0 = Math.min(...sYears), SY1 = Math.max(...sYears);
  const perYear = Object.fromEntries(papers.map((p) => { const m = {}; for (const x of READERS[p].subs) if (x[2]) m[x[2]] = (m[x[2]] || 0) + 1; return [p, m]; }));
  const sMax = Math.ceil(Math.max(...papers.flatMap((p) => Object.values(perYear[p]))) / 250) * 250;
  const LW = 640, LH = 280, lm = { l: 44, r: 120, t: 12, b: 28 };
  const lx = (yv) => lm.l + ((yv - SY0) / (SY1 - SY0)) * (LW - lm.l - lm.r), ly = (v) => LH - lm.b - (v / sMax) * (LH - lm.t - lm.b);
  // End labels: place at each line's last point, then push apart so none overlap (min 14px).
  const ends = papers.map((p) => { const ys = Object.keys(perYear[p]).map(Number).sort((a, b) => a - b); const last = ys.at(-1); return { p, x: lx(last) + 8, y: ly(perYear[p][last]) + 4 }; }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (let i = ends.length - 1; i >= 0; i--) if (ends[i].y > LH - lm.b + 2) { ends[i].y = LH - lm.b + 2; for (let j = i - 1; j >= 0; j--) if (ends[j + 1].y - ends[j].y < 14) ends[j].y = ends[j + 1].y - 14; }
  const endAt = Object.fromEntries(ends.map((e) => [e.p, e]));
  const lines = papers.map((p, k) => {
    const ys = Object.keys(perYear[p]).map(Number).sort((a, b) => a - b);
    // break the line across gaps in the record rather than drawing through missing years
    let d = '', prev = null;
    for (const yv of ys) { d += `${prev !== null && yv === prev + 1 ? 'L' : 'M'}${lx(yv).toFixed(1)},${ly(perYear[p][yv]).toFixed(1)}`; prev = yv; }
    const last = ys.at(-1);
    return `<path d="${d}" class="viz-line" style="stroke:${VIZ[k]}"/>${ys.map((yv) => `<circle cx="${lx(yv).toFixed(1)}" cy="${ly(perYear[p][yv]).toFixed(1)}" r="4" class="viz-dot" style="fill:${VIZ[k]}"${tip(`${nameOf('periodical', p)}, ${yv}: ${perYear[p][yv]} subscriptions`)}/>`).join('')}
      <text x="${endAt[p].x.toFixed(1)}" y="${endAt[p].y.toFixed(1)}" class="viz-label viz-small">${esc(nameOf('periodical', p).replace(/^The /, '').replace(/ and American Jewish Advocate$/, ''))}</text>`;
  }).join('');
  const sGrid = Array.from({ length: sMax / 250 + 1 }, (_, i) => i * 250).map((v) => `<line x1="${lm.l}" x2="${LW - lm.r}" y1="${ly(v)}" y2="${ly(v)}" class="viz-grid"/><text x="${lm.l - 6}" y="${ly(v) + 4}" text-anchor="end" class="viz-axis">${v}</text>`).join('');
  const sTicks = Array.from({ length: Math.floor((SY1 - SY0) / 5) + 1 }, (_, i) => SY0 + i * 5).map((yv) => `<text x="${lx(yv)}" y="${LH - 8}" text-anchor="middle" class="viz-axis">${yv}</text>`).join('');
  const subSvg = `<svg viewBox="0 0 ${LW} ${LH}" class="viz-svg" role="img" aria-labelledby="sub-t"><title id="sub-t">Subscriptions recorded per year, by paper, ${SY0}–${SY1}</title>${sGrid}${sTicks}${lines}</svg>`;

  const body = `<div class="wrap viz-page">
  <h1>Connections &amp; charts</h1>
  <p class="lede">Choose a view of the collection. Each chart includes a table of its underlying data.</p>
  <nav class="toc viz-view-tabs" aria-label="Chart view"><ul><li><a href="#network">Network</a></li><li><a href="#rites">Rites and reform</a></li><li><a href="#decades">Foundings by decade</a></li><li><a href="#tenures">Clergy tenures</a></li><li><a href="#subs">Subscriptions</a></li></ul></nav>

  <section id="network" class="viz-block" aria-labelledby="net-h">
    <h2 id="net-h">Network of people and institutions</h2>
    <p class="section-note">Lines join people to the congregations, institutions and periodicals they served (roles), congregations to the congregations they broke away from, and people who took part in the same event. Larger circles have more connections. Drag to rearrange, scroll or pinch to zoom, and select a circle to see its connections.</p>
    <div class="net-controls">${legend(NODE_TYPES.map(([, label], i) => [label, VIZ[i]]))}
      <label class="net-search">Find <input type="search" id="net-q" list="net-names" placeholder="A name…" autocomplete="off"><datalist id="net-names">${netData.nodes.map((n) => `<option value="${esc(n.name)}${n.place ? ` (${esc(n.place)})` : ''}"></option>`).join('')}</datalist></label>
      <label><input type="checkbox" id="net-labels"> Show all names</label></div>
    <div class="plate net-plate"><svg id="net" class="net-svg" role="img" aria-labelledby="net-h"></svg><div id="net-info" class="net-info" aria-live="polite"><p class="gaz-note">Select a circle.</p></div></div>
    ${tableView('Network connections', ['From', 'Connection', 'To'], links.map((l) => [esc(nodes.get(l.source).name), esc(l.kind === 'role' ? l.label : l.kind === 'split' ? `formed from (${l.label.replace('formed from, ', '')})` : `both in: ${l.label}`), esc(nodes.get(l.target).name)]))}
  </section>

  <section id="rites" class="viz-block" aria-labelledby="rites-h">
    <h2 id="rites-h">From rite at founding to orientation by about 1870</h2>
    <p class="section-note">Each band is a group of congregations, from the rite they were founded in (left) to where they stood by about 1870 (right). ${(() => { const ash = data.congregation.filter((c) => c.rite === 'ashkenazic'); const ashR = ash.filter((c) => c.orientation !== 'traditional').length; const seph = data.congregation.filter((c) => c.rite === 'sephardic'); const sephR = seph.filter((c) => c.orientation !== 'traditional').length; return `${ashR} of ${ash.length} congregations founded in an Ashkenazic rite, and ${sephR} of ${seph.length} founded in the Sephardic rite, had adopted Reform or moderate reform.`; })()}</p>
    ${legend(rites.map((r, i) => [conceptLabel('rite', r), VIZ[i]]))}
    <figure class="viz-fig">${flowSvg}</figure>
    ${tableView('Rite at founding by orientation by 1870', ['Rite at founding', ...ors.map((o) => conceptLabel('orientation', o)), 'Total'], rites.map((r) => [conceptLabel('rite', r), ...ors.map((o) => String(data.congregation.filter((c) => c.rite === r && c.orientation === o).length)), String(data.congregation.filter((c) => c.rite === r).length)]))}
  </section>

  <section id="decades" class="viz-block" aria-labelledby="dec-h">
    <h2 id="dec-h">Congregations founded per decade</h2>
    <p class="section-note">Foundings recorded in Kehillot, by region. ${(() => { const n4050 = dec.filter((x) => x.d === '1840s' || x.d === '1850s').reduce((a, x) => a + REG.reduce((b, r) => b + x.by[r], 0), 0); return `${n4050} of the ${data.congregation.length} congregations were founded in the 1840s and 1850s, the decades of heaviest Central European immigration.`; })()}</p>
    ${legend(REG.map((r, i) => [r, VIZ[i]]))}
    <figure class="viz-fig">${decSvg}</figure>
    ${tableView('Congregations founded per decade by region', ['Decade', ...REG, 'Total'], dec.map((x) => [x.d, ...REG.map((r) => String(x.by[r])), String(REG.reduce((a, r) => a + x.by[r], 0))]))}
  </section>

  <section id="tenures" class="viz-block" aria-labelledby="ten-h">
    <h2 id="ten-h">Clergy tenures</h2>
    <p class="section-note">Each bar is one clergyman's service at one congregation, grouped by congregation. Pale dashed bars have no recorded end date and run to the person's death or to 1900. The shaded band marks ${Y0}–${Y1}. <a href="../maps/clergy/">Map their journeys between pulpits →</a></p>
    <figure class="viz-fig">${tenSvg}</figure>
    ${tableView('Clergy tenures', ['Person', 'Role', 'Congregation', 'Years'], tenures.map((t) => [esc(t.p.name), esc(t.r.role), esc(`${t.c.name}, ${index.place.get(t.c.place).name}`), `${t.r.start}–${t.r.end || ''}`]))}
  </section>

  <section id="subs" class="viz-block" aria-labelledby="subs-h">
    <h2 id="subs-h">Subscriptions recorded per year</h2>
    <p class="section-note">Counts of subscriptions in each paper's printed lists, from the deposited datasets. They show how often lists were printed and transcribed as much as how many people subscribed; gaps are years with no list. <a href="../subscribers/">Map the subscribers →</a></p>
    ${legend(papers.map((p, i) => [nameOf('periodical', p), VIZ[i]]))}
    <figure class="viz-fig">${subSvg}</figure>
    ${tableView('Subscriptions per year', ['Year', ...papers.map((p) => nameOf('periodical', p))], Array.from({ length: SY1 - SY0 + 1 }, (_, i) => SY0 + i).map((yv) => [String(yv), ...papers.map((p) => String(perYear[p][yv] || ''))]))}
  </section>
  <div id="viz-tip" class="viz-tip" role="tooltip" hidden></div>
</div>`;
  await out('visualizations/index.html', layout({ rel: '../', title: 'Visualizations', canonical: `${BASE}visualizations/`, current: 'visualizations/',
    description: 'Network diagram of people and institutions, and charts of congregational change, clergy tenures and newspaper subscriptions in Jewish America, 1840–1870.',
    body, scripts: ['assets/vendor/d3/d3.min.js', 'assets/js/viz.js'] }));
}


// ───────────────────────── contributors ─────────────────────────
{
  const people = new Map();
  for (const [type, rows] of Object.entries(data)) for (const r of rows) for (const c of r.contributors || []) {
    const k = c.github || c.name;
    if (!people.has(k)) people.set(k, { ...c, records: [] });
    const p = people.get(k);
    if (!p.name && c.name) p.name = c.name;
    if (!p.orcid && c.orcid) p.orcid = c.orcid;
    p.records.push({ type, r });
  }
  const list = [...people.values()].sort((a, b) => b.records.length - a.records.length || String(a.name || a.github).localeCompare(String(b.name || b.github)));
  await out('contributors/index.html', layout({ rel: '../', title: 'Contributors', canonical: `${BASE}contributors/`, current: '',
    description: 'People who have contributed records to Kehillot.',
    jsonld: list.length ? { '@context': 'https://schema.org', '@type': 'ItemList', name: 'Kehillot contributors', itemListElement: list.map((c, i) => ({ '@type': 'ListItem', position: i + 1, item: strip({ '@type': 'Person', name: c.name || `@${c.github}`, sameAs: c.orcid ? `https://orcid.org/${c.orcid}` : undefined, url: c.github ? `https://github.com/${c.github}` : undefined }) })) } : undefined,
    body: `<div class="wrap prose-wide"><h1>Contributors</h1>
  <p class="lede">Kehillot grows through suggestions from researchers, librarians, genealogists, students and descendants. Everyone whose suggestion becomes a record is credited here and on the record itself.</p>
  ${list.length ? `<ul class="contributors">${list.map((c) => `<li><h2>${c.github ? `<a href="https://github.com/${esc(c.github)}">` : ''}${esc(c.name || '@' + c.github)}${c.github ? '</a>' : ''}${c.orcid ? ` <a class="orcid" href="https://orcid.org/${esc(c.orcid)}" title="ORCID iD">iD</a>` : ''} <span class="muted">${c.records.length} record${c.records.length === 1 ? '' : 's'}</span></h2>
    ${ul(c.records.map(({ type, r }) => `${link('../', type, r.id, type === 'source' ? r.title : r.name)} <span class="muted">${TYPE_INFO[type].label}</span>`))}</li>`).join('')}</ul>`
    : '<p>No contributed records yet. The first could be yours.</p>'}
  <p><a class="btn" href="../about/#contribute">How to contribute</a></p></div>` }));
}

await out('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${BASE}sitemap.xml\n`);
const htmlPages = written.filter((f) => f.endsWith('index.html'));
await out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${htmlPages
  .map((f) => `  <url><loc>${BASE}${f.replace(/index\.html$/, '')}</loc><lastmod>${BUILD_DATE}</lastmod></url>`).join('\n')}\n</urlset>\n`);

console.log(`✓ Built ${written.length} files into dist/ (${graph.length} entities, ${triples.length} triples) with base ${BASE}`);
