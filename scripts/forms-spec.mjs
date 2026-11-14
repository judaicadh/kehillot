// Shared definition of the contribution forms.
// scripts/forms.mjs turns these into GitHub issue forms (.github/ISSUE_TEMPLATE/*.yml);
// scripts/issue-to-record.mjs reads a submitted form back into a data record.
// Option lists come from the built site's vocabulary (dist/data/site.json), so the
// dropdowns always match the data. Field labels are what GitHub prints in the issue
// body, so change a label here and both sides follow.

export const NONE = '_No response_';
export const OTHER_CITY = 'Another place (describe it in the address or notes)';

// Shared tail: source, certainty, contributor, consent.
const tail = (V) => [
  { id: 'source', label: 'Source citation', type: 'textarea', required: true,
    description: 'Where this information comes from: author, title, date, page, archive or URL. Every record must cite a source.' },
  { id: 'source_url', label: 'Source link (if online)', type: 'input', placeholder: 'https://' },
  { id: 'certainty', label: 'How certain is the information?', type: 'dropdown', options: Object.values(V.certainty), required: true },
  { id: 'contributor', label: 'Your name for the credit line (optional)', type: 'input',
    description: 'Shown on the record and on the Contributors page. Leave blank to be credited by your GitHub username only.' },
  { id: 'orcid', label: 'ORCID iD (optional)', type: 'input', placeholder: '0000-0000-0000-0000' },
  { id: 'consent', label: 'Before you submit', type: 'checkboxes', options: [
    { label: 'I understand this suggestion and my GitHub username are public.', required: true },
    { label: 'This contains no private information about living people.', required: true },
    { label: 'I am happy for this contribution to be published under CC BY 4.0.', required: true },
  ] },
];

export function formSpecs(V, cities) {
  const cityOptions = [...cities, OTHER_CITY];
  const kindLabels = Object.entries(V.siteKind).filter(([k]) => k !== 'residence').map(([, l]) => l);
  return {
    'add-site': {
      name: 'Suggest a place in a city', type: 'site',
      description: 'A synagogue building, school, matzah bakery, hotel or boarding house, kosher restaurant, Jewish-owned business, bookstore or other site.',
      title: '[Place] ', labels: ['suggestion', 'type: site'],
      intro: 'Suggest a place for the maps and city guides. An editor reviews every suggestion before it is published.',
      fields: [
        { id: 'kind', label: 'Kind of place', type: 'dropdown', options: kindLabels, required: true },
        { id: 'name', label: 'Name', type: 'input', required: true, description: 'As it appears in the source, e.g. “Levy\'s Matzah Bakery”.' },
        { id: 'city', label: 'City', type: 'dropdown', options: cityOptions, required: true },
        { id: 'address', label: 'Street address', type: 'input', description: 'As recorded at the time, e.g. “96 Essex Street”.' },
        { id: 'coords', label: 'Latitude, longitude (optional)', type: 'input', placeholder: '40.7180, -73.9883',
          description: 'If you know where it stood. Leave blank and an editor will place it.' },
        { id: 'precision', label: 'How exact is that location?', type: 'dropdown', options: Object.values(V.precision) },
        { id: 'from', label: 'Year opened, built or first recorded', type: 'input', placeholder: '1855' },
        { id: 'to', label: 'Year closed or last recorded', type: 'input', placeholder: '1862' },
        { id: 'people', label: 'Proprietors or people connected with it', type: 'textarea', description: 'One per line. Names already in Kehillot are linked automatically.' },
        { id: 'congregations', label: 'Congregations that used it', type: 'textarea', description: 'For synagogue buildings and schools. One per line.' },
        { id: 'supervision', label: 'Kosher supervision', type: 'input', description: 'For bakeries and restaurants: the rabbi or congregation that certified it.' },
        { id: 'advertised', label: 'Advertised in', type: 'textarea', description: 'One per line: periodical and date, e.g. “The Occident, March 1855”.' },
        { id: 'note', label: 'Notes', type: 'textarea', description: 'One or two sentences on what the source says.' },
        ...tail(V),
      ],
    },
    'add-cemetery': {
      name: 'Suggest a cemetery', type: 'cemetery', title: '[Cemetery] ', labels: ['suggestion', 'type: cemetery'],
      description: 'A Jewish burial ground.',
      intro: 'Suggest a Jewish cemetery or burial ground. An editor reviews every suggestion before it is published.',
      fields: [
        { id: 'name', label: 'Name', type: 'input', required: true },
        { id: 'city', label: 'City', type: 'dropdown', options: cityOptions, required: true },
        { id: 'address', label: 'Street address or location', type: 'input' },
        { id: 'coords', label: 'Latitude, longitude (optional)', type: 'input', placeholder: '39.9457, -75.1560' },
        { id: 'precision', label: 'How exact is that location?', type: 'dropdown', options: Object.values(V.precision) },
        { id: 'from', label: 'Year established', type: 'input', placeholder: '1850' },
        { id: 'to', label: 'Year closed to burials (if any)', type: 'input' },
        { id: 'congregations', label: 'Congregations that maintained it', type: 'textarea', description: 'One per line.' },
        { id: 'note', label: 'Notes', type: 'textarea' },
        ...tail(V),
      ],
    },
    'add-person': {
      name: 'Suggest a person or clergy member', type: 'person', title: '[Person] ', labels: ['suggestion', 'type: person'],
      description: 'Rabbis, hazanim, shochtim, communal leaders, proprietors and others.',
      intro: 'Suggest a person with a documented role in Jewish communal life. An editor reviews every suggestion before it is published.',
      fields: [
        { id: 'name', label: 'Name', type: 'input', required: true },
        { id: 'born', label: 'Year born', type: 'input' },
        { id: 'died', label: 'Year died', type: 'input' },
        { id: 'birthplace', label: 'Birthplace', type: 'input' },
        { id: 'titles', label: 'Clergy titles (if any)', type: 'dropdown', multiple: true, options: Object.values(V.clergyTitle) },
        { id: 'occupation', label: 'Other occupations', type: 'input', placeholder: 'merchant, teacher' },
        { id: 'cities', label: 'Cities where they lived or served', type: 'dropdown', multiple: true, options: cityOptions },
        { id: 'roles', label: 'Positions held', type: 'textarea',
          description: 'One per line: role, congregation or institution, years. For example: “Hazan, Mikveh Israel, 1829–1850”.' },
        { id: 'description', label: 'Short description', type: 'textarea', required: true },
        ...tail(V),
      ],
    },
    'add-congregation': {
      name: 'Suggest a congregation', type: 'congregation', title: '[Congregation] ', labels: ['suggestion', 'type: congregation'],
      description: 'A Jewish congregation active between 1840 and 1870.',
      intro: 'Suggest a congregation. An editor reviews every suggestion before it is published.',
      fields: [
        { id: 'name', label: 'Name', type: 'input', required: true },
        { id: 'translation', label: 'English meaning of the name', type: 'input' },
        { id: 'city', label: 'City', type: 'dropdown', options: cityOptions, required: true },
        { id: 'from', label: 'Year founded', type: 'input', required: true },
        { id: 'to', label: 'Year dissolved or merged (if any)', type: 'input' },
        { id: 'rite', label: 'Rite at founding', type: 'dropdown', options: Object.values(V.rite) },
        { id: 'orientation', label: 'Orientation by about 1870', type: 'dropdown', options: Object.values(V.orientation) },
        { id: 'note', label: 'Notes', type: 'textarea' },
        ...tail(V),
      ],
    },
    'correction': {
      name: 'Suggest a correction', type: 'correction', title: '[Correction] ', labels: ['correction'],
      description: 'Something on an existing page is wrong or missing.',
      intro: 'Tell us what is wrong and what the source says. Corrections are reviewed and applied by an editor.',
      fields: [
        { id: 'record', label: 'Page or record', type: 'input', required: true, description: 'The address of the page, e.g. https://judaicadh.github.io/kehillot/congregation/emanu-el-ny/' },
        { id: 'problem', label: 'What is wrong or missing?', type: 'textarea', required: true },
        { id: 'fix', label: 'What should it say?', type: 'textarea', required: true },
        ...tail(V),
      ],
    },
  };
}

// Parse a GitHub issue-form body ("### Label\n\nvalue") into { fieldId: value }.
export function parseIssueBody(body, spec) {
  const byLabel = Object.fromEntries(spec.fields.map((f) => [f.label, f]));
  const out = {};
  const parts = String(body || '').replace(/\r/g, '').split(/^### /m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl).trim();
    let value = part.slice(nl + 1).trim();
    const f = byLabel[label];
    if (!f) continue;
    if (value === NONE) value = '';
    if (f.type === 'checkboxes') out[f.id] = [...value.matchAll(/^- \[[xX]\] (.+)$/gm)].map((m) => m[1].trim());
    else if (f.type === 'dropdown' && f.multiple) out[f.id] = value ? value.split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [];
    else out[f.id] = value;
  }
  return out;
}
