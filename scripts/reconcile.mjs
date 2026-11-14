// Suggest Wikidata matches for records that don't have one yet.
// Writes data/wikidata-candidates.json for HUMAN REVIEW. Accepted matches go
// into data/wikidata.json, which is the only file the build reads.
//
//   node scripts/reconcile.mjs                      # all types
//   node scripts/reconcile.mjs cemetery periodical  # only these types
//
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const root = new URL('../data/', import.meta.url);
const load = async (f) => JSON.parse(await readFile(new URL(f, root), 'utf8'));
const UA = 'kehillot-atlas-reconcile/1.0 (static digital humanities site)';
const accepted = existsSync(new URL('wikidata.json', root)) ? await load('wikidata.json') : {};

async function search(q) {
  const u = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ action: 'wbsearchentities', search: q, language: 'en', limit: '5', format: 'json', type: 'item' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    const text = await r.text();
    if (r.ok && text.startsWith('{')) {
      const j = JSON.parse(text);
      return (j.search || []).map((s) => ({ qid: s.id, label: s.label, description: s.description || '' }));
    }
    await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); // rate limited: back off
  }
  throw new Error(`Wikidata search failed for "${q}"`);
}

const clean = (s) => s.replace(/\s*\(.*\)/, '').replace(/^The /, '');
const sets = {
  place: async () => (await load('places.json')).map((p) => ({ id: p.id, q: p.name, hint: p.state })),
  person: async () => (await load('people.json')).map((p) => ({ id: p.id, q: p.name, hint: p.born ? String(p.born) : '' })),
  congregation: async () => (await load('congregations.json')).map((c) => ({ id: c.id, q: clean(c.name), hint: '' })),
  institution: async () => (await load('organizations.json')).map((o) => ({ id: o.id, q: clean(o.name), hint: '' })),
  periodical: async () => (await load('periodicals.json')).map((o) => ({ id: o.id, q: clean(o.name), hint: '' })),
  cemetery: async () => (await load('cemeteries.json')).map((o) => ({ id: o.id, q: clean(o.name), hint: 'cemetery' })),
  site: async () => (await load('sites.json')).map((o) => ({ id: o.id, q: clean(o.name), hint: 'synagogue' })),
};
const only = process.argv.slice(2);
const out = {};
for (const [type, getRows] of Object.entries(sets)) {
  if (only.length && !only.includes(type)) continue;
  out[type] = {};
  for (const row of await getRows()) {
    if (accepted[type]?.[row.id]) continue; // already reviewed
    const hits = await search(row.q);
    hits.sort((a, b) => Number(b.description.includes(row.hint)) - Number(a.description.includes(row.hint)));
    out[type][row.id] = { query: row.q, hint: row.hint, candidates: hits };
    await new Promise((r) => setTimeout(r, 1000)); // be polite to the API
  }
}
await writeFile(new URL('wikidata-candidates.json', root), JSON.stringify(out, null, 2));
console.log('Wrote data/wikidata-candidates.json — review before copying QIDs into data/wikidata.json');
