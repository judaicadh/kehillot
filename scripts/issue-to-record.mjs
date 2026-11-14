// Turn an accepted suggestion (a GitHub issue-form submission) into a Kehillot record.
//
// In GitHub Actions it reads the issue from $GITHUB_EVENT_PATH. Locally, for testing:
//   node scripts/issue-to-record.mjs --issue path/to/issue.json
// where issue.json looks like { "number": 12, "title": "...", "body": "...", "user": { "login": "..." },
// "labels": [{ "name": "type: site" }] }.
//
// It appends the record (and a source record for its citation) to the data files and writes
// .cache/suggestion.json: { ok, branch, title, summary, needsEditing } for the workflow to use.
// It never deletes or overwrites existing records. Anything it cannot match (a person, a
// congregation, a city not yet in Kehillot) is listed for the editor instead of being guessed.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { formSpecs, parseIssueBody, OTHER_CITY } from './forms-spec.mjs';

const ROOT = new URL('../', import.meta.url);
const readJSON = async (p) => JSON.parse(await readFile(new URL(p, ROOT), 'utf8'));
const writeJSON = (p, d) => writeFile(new URL(p, ROOT), JSON.stringify(d, null, 2) + '\n');

const argIssue = process.argv.indexOf('--issue');
const issue = argIssue > -1 ? await readJSON(process.argv[argIssue + 1]) : (await readJSON(process.env.GITHUB_EVENT_PATH)).issue;
const site = await readJSON('dist/data/site.json'); // built first: provides vocabulary and places
const V = site.vocab;
const cityLabel = (p) => `${p.name} (${p.state})`;
const specs = formSpecs(V, site.places.map(cityLabel));

const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name));
const typeLabel = labels.find((l) => l.startsWith('type: '));
const slug = Object.keys(specs).find((k) => specs[k].labels.includes(typeLabel)) || Object.keys(specs).find((k) => (issue.title || '').startsWith(specs[k].title.trim()));
const result = { ok: false, branch: `suggestion/${issue.number}`, title: '', summary: '', needsEditing: [] };
const done = async () => { await mkdir(new URL('.cache/', ROOT), { recursive: true }); await writeFile(new URL('.cache/suggestion.json', ROOT), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2)); };

if (!slug || slug === 'correction') {
  result.summary = slug === 'correction' ? 'Corrections are applied by hand: edit the record in a pull request.' : 'Could not tell which form this issue came from (no "type: …" label).';
  await done(); process.exit(0);
}
const spec = specs[slug];
const F = parseIssueBody(issue.body, spec);
const login = issue.user?.login || 'unknown';

// ── consent is required ──
const consentNeeded = spec.fields.find((f) => f.id === 'consent').options.map((o) => o.label);
if (consentNeeded.some((c) => !(F.consent || []).includes(c))) {
  result.summary = 'The consent boxes were not all ticked, so this suggestion cannot be imported.';
  await done(); process.exit(0);
}

// ── helpers ──
const keyFor = (scheme, label) => Object.keys(V[scheme]).find((k) => V[scheme][k] === label) || null;
const year = (s) => { const m = String(s || '').match(/\b(1[5-9]\d\d)\b/); return m ? Number(m[1]) : null; };
const kebab = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const lines = (s) => String(s || '').split('\n').map((x) => x.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
const norm = (s) => String(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const placeFromLabel = (label) => site.places.find((p) => cityLabel(p) === label) || null;
const findPerson = (name) => site.people.find((p) => norm(p.name) === norm(name)) || null;
const findOrg = (name, placeId) => {
  const n = norm(name);
  const pools = [['congregation', site.congregations], ['institution', site.institutions], ['periodical', site.periodicals]];
  for (const [type, rows] of pools) {
    const hits = rows.filter((r) => norm(r.name) === n || norm(r.name).startsWith(n) || n.startsWith(norm(r.name)));
    const best = hits.find((r) => !placeId || r.place === placeId) || (hits.length === 1 ? hits[0] : null);
    if (best) return { type, id: best.id, name: best.name };
  }
  return null;
};
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dateFrom = (s) => {
  const y = year(s); if (!y) return null;
  const m = MONTHS.findIndex((mm) => new RegExp(`\\b${mm}`, 'i').test(s));
  return m > -1 ? `${y}-${String(m + 1).padStart(2, '0')}` : String(y);
};
const uniqueId = (base, rows) => { let id = base, i = 2; while (rows.some((r) => r.id === id)) id = `${base}-${i++}`; return id; };
const todo = (t) => result.needsEditing.push(t);

// ── source record for the citation ──
const sources = await readJSON('data/sources.json');
const sourceId = uniqueId(`contrib-${issue.number}`, sources);
const citation = String(F.source || '').trim();
sources.push({ id: sourceId, type: 'CreativeWork', author: '', title: citation.split('\n')[0].slice(0, 300), publisher: '', place: '', year: year(citation),
  url: /^https?:\/\//.test(F.source_url || '') ? F.source_url.trim() : undefined,
  note: `${citation.includes('\n') ? citation.split('\n').slice(1).join(' ').trim() + ' ' : ''}Cited in a suggestion by @${login} (issue #${issue.number}).`.trim() });

const contributors = [{ name: F.contributor || undefined, github: login, orcid: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(F.orcid || '') ? F.orcid : undefined, issue: issue.number }]
  .map((c) => JSON.parse(JSON.stringify(c)));
const certainty = keyFor('certainty', F.certainty) || 'medium';
const city = F.city ? placeFromLabel(F.city) : null;
if (F.city === OTHER_CITY) todo('The place is not yet in Kehillot: add it to `data/places.json` and set `place` on this record.');

let file, record, rows;
if (slug === 'add-site' || slug === 'add-cemetery') {
  const coords = String(F.coords || '').match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
  let lat = coords ? Number(coords[1]) : null, lon = coords ? Number(coords[2]) : null;
  let precision = keyFor('precision', F.precision);
  if (lat == null) {
    if (city) { lat = city.lat; lon = city.lon; } else { lat = 0; lon = 0; }
    precision = 'city';
    todo('No coordinates were given, so the record is placed at the city centre (`precision: "city"`). Locate the address and update `lat`, `lon` and `precision` if possible.');
  }
  if (!precision) precision = 'approximate';
  const linked = (txt, label) => lines(txt).map((n) => { const o = findOrg(n, city?.id); if (!o) todo(`${label} “${n}” is not yet in Kehillot; it is kept in the note.`); return { n, o }; });
  const congs = linked(F.congregations, 'Congregation');
  const common = { id: '', name: F.name.trim(), place: city?.id || 'REPLACE-place-id', address: F.address || '', lat, lon, precision, certainty };
  const noteBits = [F.note, ...congs.filter((c) => !c.o).map((c) => `Used by: ${c.n}.`)];
  if (slug === 'add-site') {
    file = 'data/sites.json';
    const kind = keyFor('siteKind', F.kind) || 'meeting-place';
    const people = lines(F.people).map((n) => { const p = findPerson(n); if (!p) { todo(`Person “${n}” is not yet in Kehillot; add them to \`data/people.json\` to link them, or leave them in the note.`); noteBits.push(`People: ${n}.`); } return p?.id; }).filter(Boolean);
    const sup = F.supervision ? (findPerson(F.supervision) ? { type: 'person', id: findPerson(F.supervision).id } : (findOrg(F.supervision, city?.id)?.type === 'congregation' ? { type: 'congregation', id: findOrg(F.supervision, city?.id).id } : null)) : null;
    if (F.supervision && !sup) { todo(`Kosher supervisor “${F.supervision}” is not yet in Kehillot; it is kept in the note.`); noteBits.push(`Supervision: ${F.supervision}.`); }
    // Match a periodical by its short title ("Occident" for "The Occident and American Jewish Advocate").
    const shortTitle = (n) => norm(n).split(' and ')[0];
    const ads = lines(F.advertised).map((l) => { const per = site.periodicals.find((p) => (' ' + norm(l) + ' ').includes(' ' + shortTitle(p.name) + ' ')); if (!per) { todo(`Periodical in “${l}” is not recognised; it is kept in the note.`); noteBits.push(`Advertised in ${l}.`); return null; } return { periodical: per.id, date: dateFrom(l) || undefined }; }).filter(Boolean);
    const from = year(F.from), to = year(F.to);
    const building = ['synagogue', 'school', 'hospital', 'meeting-place'].includes(kind);
    record = { ...common, kind,
      ...(building ? { built: from || undefined } : { opened: from || undefined, closed: to || undefined }),
      proprietors: !building && people.length ? people : undefined, people: building && people.length ? people : undefined,
      occupants: congs.filter((c) => c.o).map((c) => ({ org: c.o.id, from: from || undefined, to: building ? to || undefined : undefined })),
      supervisedBy: sup ? [sup] : undefined, advertisedIn: ads.length ? ads : undefined };
  } else {
    file = 'data/cemeteries.json';
    record = { ...common, established: year(F.from), closed: year(F.to) || undefined, owners: congs.filter((c) => c.o && c.o.type === 'congregation').map((c) => c.o.id) };
    if (!record.established) todo('No year established was given; `established` is required.');
  }
  record.note = noteBits.filter(Boolean).join(' ') || undefined;
} else if (slug === 'add-person') {
  file = 'data/people.json';
  const titles = (F.titles || []).map((l) => keyFor('clergyTitle', l)).filter(Boolean);
  const places = (F.cities || []).map(placeFromLabel).filter(Boolean).map((p) => p.id);
  if ((F.cities || []).includes(OTHER_CITY)) todo('A place is not yet in Kehillot; add it to `data/places.json` and to `places` here.');
  const notes = [];
  const roles = lines(F.roles).map((l) => {
    const parts = l.split(/\s*,\s*/);
    const yrs = l.match(/(1[5-9]\d\d)\s*[–-]\s*(1[5-9]\d\d)?/);
    const orgName = parts.length > 1 ? parts[1] : parts[0];
    const o = findOrg(orgName);
    if (!o) { todo(`Position “${l}”: “${orgName}” is not yet in Kehillot; it is kept in the description.`); notes.push(l); return null; }
    return { org: o.id, role: parts[0], start: yrs ? Number(yrs[1]) : year(l) || undefined, end: yrs && yrs[2] ? Number(yrs[2]) : undefined };
  }).filter(Boolean);
  record = { id: '', name: F.name.trim(), born: year(F.born), died: year(F.died), birthPlace: F.birthplace || '',
    occupation: [...titles, ...lines(String(F.occupation || '').replace(/,/g, '\n'))], clergyTitles: titles.length ? titles : undefined,
    description: [F.description, notes.length ? `Positions not yet linked: ${notes.join('; ')}.` : ''].filter(Boolean).join(' '),
    roles, places, certainty };
  if (!places.length) todo('No city was chosen; add at least one place id to `places`.');
} else if (slug === 'add-congregation') {
  file = 'data/congregations.json';
  record = { id: '', name: F.name.trim(), translation: F.translation || undefined, place: city?.id || 'REPLACE-place-id', founded: year(F.from), dissolved: year(F.to) || undefined,
    certainty, rite: keyFor('rite', F.rite) || undefined, orientation: keyFor('orientation', F.orientation) || undefined, note: F.note || undefined };
  if (!record.founded) todo('No founding year was given; `founded` is required.');
  if (!record.rite || !record.orientation) todo('Rite and orientation are required for congregations; fill them in if the source supports it.');
}
rows = await readJSON(file);
record.id = uniqueId([kebab(record.name), record.place && !record.place.startsWith('REPLACE') ? record.place : ''].filter(Boolean).join('-'), rows);
record.sources = [sourceId];
record.contributors = contributors;
record = JSON.parse(JSON.stringify(record)); // drop undefined fields
rows.push(record);
await writeJSON(file, rows);
await writeJSON('data/sources.json', JSON.parse(JSON.stringify(sources)));

result.ok = true;
result.title = `Add ${spec.type}: ${record.name} (from #${issue.number})`;
result.summary = [
  `Adds **${record.name}** to \`${file}\` (id \`${record.id}\`) and its citation to \`data/sources.json\` (id \`${sourceId}\`), from the suggestion in #${issue.number} by @${login}.`,
  '', '```json', JSON.stringify(record, null, 2), '```',
].join('\n');
await done();
