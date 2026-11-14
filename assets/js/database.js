// Kehillot database: faceted search over site.json, state kept in the URL hash.
(function () {
  'use strict';
  var root = document.body.dataset.root || './';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var D, P = {}, V;
  var a = function (type, id, label) { return '<a href="' + root + type + '/' + id + '/">' + esc(label) + '</a>'; };
  var placeName = function (id) { var p = P[id]; return p ? p.name + ', ' + p.state : id; };
  var O = {};
  var orgLabel = function (id) { return O[id] ? O[id].name : id; };
  var orgType = function (id) { return O[id] ? O[id].type : 'institution'; };
  var editors = function (id) { return D.people.filter(function (p) { return p.roles.some(function (x) { return x.org === id; }); }).map(function (p) { return p.name; }).join(', '); };
  var fold = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };

  var TYPES = {
    congregations: {
      rows: function () { return D.congregations; },
      text: function (r) { return [r.name, r.translation, r.note, placeName(r.place)].join(' '); },
      facets: {
        region: { label: 'Region', get: function (r) { return P[r.place].region; } },
        state: { label: 'State', get: function (r) { return P[r.place].state; } },
        rite: { label: 'Rite', get: function (r) { return r.rite; }, show: function (v) { return V.rite[v]; } },
        orientation: { label: 'By c. 1870', get: function (r) { return r.orientation; }, show: function (v) { return V.orientation[v]; } },
        certainty: { label: 'Certainty', get: function (r) { return r.certainty; }, show: function (v) { return V.certainty[v]; } }
      },
      cols: [
        { key: 'name', label: 'Name', html: function (r) { return a('congregation', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'place', label: 'Place', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'founded', label: 'Founded', val: function (r) { return r.founded; }, num: true },
        { key: 'rite', label: 'Rite', val: function (r) { return V.rite[r.rite]; } },
        { key: 'orientation', label: 'By c. 1870', val: function (r) { return V.orientation[r.orientation]; } },
        { key: 'certainty', label: 'Certainty', val: function (r) { return V.certainty[r.certainty]; } }
      ],
      sort: 'founded'
    },
    people: {
      rows: function () { return D.people; },
      text: function (r) { return [r.name, r.description, r.birthPlace, r.occupation.join(' '), r.places.map(placeName).join(' ')].join(' '); },
      facets: {
        occupation: { label: 'Occupation', get: function (r) { return r.occupation; } },
        place: { label: 'Place', get: function (r) { return r.places.map(placeName); } },
        org: { label: 'Affiliated with', get: function (r) { return r.roles.map(function (x) { return orgLabel(x.org) + (O[x.org] && O[x.org].place ? ' (' + P[O[x.org].place].name + ')' : ''); }); } }
      },
      cols: [
        { key: 'name', label: 'Name', html: function (r) { return a('person', r.id, r.name); }, val: function (r) { return r.name.split(' ').slice(-1)[0] + ' ' + r.name; }, out: function (r) { return r.name; } },
        { key: 'born', label: 'Born', val: function (r) { return r.born || ''; }, num: true },
        { key: 'died', label: 'Died', val: function (r) { return r.died || ''; }, num: true },
        { key: 'birthPlace', label: 'Birthplace', val: function (r) { return r.birthPlace || ''; } },
        { key: 'occupation', label: 'Occupation', val: function (r) { return r.occupation.join(', '); } },
        { key: 'roles', label: 'Affiliations', html: function (r) { return r.roles.map(function (x) { return esc(x.role) + ', ' + a(orgType(x.org), x.org, orgLabel(x.org)) + (x.start ? ' <span class="muted">' + x.start + '–' + (x.end || '') + '</span>' : ''); }).join('<br>'); },
          val: function (r) { return r.roles.map(function (x) { return x.role + ', ' + orgLabel(x.org) + (x.start ? ' (' + x.start + '–' + (x.end || '') + ')' : ''); }).join('; '); }, cls: 'desc' }
      ],
      sort: 'born'
    },
    cemeteries: {
      rows: function () { return D.cemeteries; },
      text: function (r) { return [r.name, r.address, r.note, placeName(r.place), (r.owners || []).map(orgLabel).join(' ')].join(' '); },
      facets: {
        state: { label: 'State', get: function (r) { return P[r.place].state; } },
        precision: { label: 'Location', get: function (r) { return r.precision; }, show: function (v) { return V.precision[v]; } },
        certainty: { label: 'Certainty', get: function (r) { return r.certainty; }, show: function (v) { return V.certainty[v]; } }
      },
      cols: [
        { key: 'name', label: 'Cemetery', html: function (r) { return a('cemetery', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'place', label: 'City', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'address', label: 'Address', val: function (r) { return r.address; }, cls: 'desc' },
        { key: 'established', label: 'Est.', val: function (r) { return r.established; }, num: true },
        { key: 'closed', label: 'Closed', val: function (r) { return r.closed || ''; }, num: true },
        { key: 'owners', label: 'Maintained by', html: function (r) { return (r.owners || []).map(function (o) { return a('congregation', o, orgLabel(o)); }).join(', '); }, val: function (r) { return (r.owners || []).map(orgLabel).join('; '); } },
        { key: 'precision', label: 'Location', val: function (r) { return V.precision[r.precision]; } }
      ],
      sort: 'established'
    },
    sites: {
      rows: function () { return D.sites; },
      text: function (r) { return [r.name, r.address, r.note, placeName(r.place), (r.occupants || []).map(function (o) { return orgLabel(o.org); }).join(' ')].join(' '); },
      facets: {
        kind: { label: 'Kind', get: function (r) { return r.kind; }, show: function (v) { return V.siteKind[v]; } },
        state: { label: 'State', get: function (r) { return P[r.place].state; } },
        precision: { label: 'Location', get: function (r) { return r.precision; }, show: function (v) { return V.precision[v]; } }
      },
      cols: [
        { key: 'name', label: 'Site', html: function (r) { return a('site', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'kind', label: 'Kind', val: function (r) { return V.siteKind[r.kind]; } },
        { key: 'place', label: 'City', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'address', label: 'Address', val: function (r) { return r.address; }, cls: 'desc' },
        { key: 'built', label: 'Built', val: function (r) { return r.built || ''; }, num: true },
        { key: 'occupants', label: 'Used by', html: function (r) { return (r.occupants || []).map(function (o) { return a(orgType(o.org), o.org, orgLabel(o.org)) + (o.from ? ' <span class="muted">' + o.from + '–' + (o.to || '') + '</span>' : ''); }).join('<br>'); },
          val: function (r) { return (r.occupants || []).map(function (o) { return orgLabel(o.org) + (o.from ? ' (' + o.from + '–' + (o.to || '') + ')' : ''); }).join('; '); } },
        { key: 'precision', label: 'Location', val: function (r) { return V.precision[r.precision]; } }
      ],
      sort: 'built'
    },
    periodicals: {
      rows: function () { return D.periodicals; },
      text: function (r) { return [r.name, r.description, placeName(r.place), editors(r.id)].join(' '); },
      facets: {
        language: { label: 'Language', get: function (r) { return r.language.map(function (l) { return D.langs[l]; }); } },
        frequency: { label: 'Frequency', get: function (r) { return r.frequency; }, show: function (v) { return V.frequency[v]; } },
        orientation: { label: 'Orientation', get: function (r) { return r.orientation; }, show: function (v) { return V.orientation[v]; } }
      },
      cols: [
        { key: 'name', label: 'Title', html: function (r) { return '<i>' + a('periodical', r.id, r.name) + '</i>'; }, val: function (r) { return r.name.replace(/^The /, ''); }, out: function (r) { return r.name; } },
        { key: 'place', label: 'Published at', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'founded', label: 'From', val: function (r) { return r.founded; }, num: true },
        { key: 'ceased', label: 'To', val: function (r) { return r.ceased || ''; }, num: true },
        { key: 'language', label: 'Language', val: function (r) { return r.language.map(function (l) { return D.langs[l]; }).join(', '); } },
        { key: 'frequency', label: 'Frequency', val: function (r) { return V.frequency[r.frequency]; } },
        { key: 'editors', label: 'Editors', val: function (r) { return editors(r.id); } }
      ],
      sort: 'founded'
    },
    institutions: {
      rows: function () { return D.institutions; },
      text: function (r) { return [r.name, r.description, placeName(r.place)].join(' '); },
      facets: {
        category: { label: 'Type', get: function (r) { return r.category; }, show: function (v) { return V.category[v]; } },
        region: { label: 'Region', get: function (r) { return P[r.place].region; } }
      },
      cols: [
        { key: 'name', label: 'Name', html: function (r) { return a('institution', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'category', label: 'Type', val: function (r) { return V.category[r.category]; } },
        { key: 'place', label: 'Place', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'founded', label: 'Founded', val: function (r) { return r.founded; }, num: true },
        { key: 'dissolved', label: 'Ceased', val: function (r) { return r.dissolved || ''; }, num: true }
      ],
      sort: 'founded'
    },
    events: {
      rows: function () { return D.events; },
      text: function (r) { return [r.name, r.description, placeName(r.place)].join(' '); },
      facets: {
        category: { label: 'Category', get: function (r) { return r.category; }, show: function (v) { return V.category[v]; } }
      },
      cols: [
        { key: 'date', label: 'Date', val: function (r) { return r.date; } },
        { key: 'name', label: 'Event', html: function (r) { return a('event', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'place', label: 'Place', html: function (r) { return a('place', r.place, placeName(r.place)); }, val: function (r) { return placeName(r.place); } },
        { key: 'category', label: 'Category', val: function (r) { return V.category[r.category]; } }
      ],
      sort: 'date'
    },
    places: {
      rows: function () { return D.places; },
      text: function (r) { return [r.name, r.state, r.region].join(' '); },
      facets: { region: { label: 'Region', get: function (r) { return r.region; } }, state: { label: 'State', get: function (r) { return r.state; } } },
      cols: [
        { key: 'name', label: 'Place', html: function (r) { return a('place', r.id, r.name); }, val: function (r) { return r.name; } },
        { key: 'state', label: 'State', val: function (r) { return r.state; } },
        { key: 'region', label: 'Region', val: function (r) { return r.region; } },
        { key: 'congs', label: 'Congregations', val: function (r) { return D.congregations.filter(function (c) { return c.place === r.id; }).length; }, num: true },
        { key: 'first', label: 'Earliest', val: function (r) { var f = D.congregations.filter(function (c) { return c.place === r.id; }).map(function (c) { return c.founded; }); return f.length ? Math.min.apply(null, f) : ''; }, num: true }
      ],
      sort: 'first'
    }
  };

  var S = { type: 'congregations', q: '', f: {}, sort: null, dir: 1 };
  function readHash() {
    var h = new URLSearchParams(location.hash.slice(1));
    S.type = TYPES[h.get('type')] ? h.get('type') : 'congregations';
    S.q = h.get('q') || '';
    S.sort = h.get('sort'); S.dir = h.get('dir') === 'desc' ? -1 : 1;
    S.f = {};
    Object.keys(TYPES[S.type].facets).forEach(function (k) { if (h.get(k)) S.f[k] = h.get(k); });
  }
  function writeHash() {
    var h = new URLSearchParams();
    h.set('type', S.type);
    if (S.q) h.set('q', S.q);
    Object.keys(S.f).forEach(function (k) { if (S.f[k]) h.set(k, S.f[k]); });
    if (S.sort) { h.set('sort', S.sort); if (S.dir < 0) h.set('dir', 'desc'); }
    try { history.replaceState(null, '', '#' + h.toString()); } catch (e) { /* ignore */ }
  }

  function filtered() {
    var T = TYPES[S.type], words = fold(S.q).split(/\s+/).filter(Boolean);
    var rows = T.rows().filter(function (r) {
      var t = fold(T.text(r));
      if (!words.every(function (w) { return t.indexOf(w) > -1; })) return false;
      return Object.keys(S.f).every(function (k) { return !S.f[k] || [].concat(T.facets[k].get(r)).indexOf(S.f[k]) > -1; });
    });
    var col = T.cols.filter(function (c) { return c.key === (S.sort || T.sort); })[0];
    if (col) rows = rows.slice().sort(function (x, y) {
      var a1 = col.val(x), b1 = col.val(y);
      if (a1 === '' || a1 == null) return 1; if (b1 === '' || b1 == null) return -1;
      return (col.num ? a1 - b1 : String(a1).localeCompare(String(b1))) * S.dir;
    });
    return rows;
  }

  function renderFacets() {
    var T = TYPES[S.type];
    $('#facets').innerHTML = Object.keys(T.facets).map(function (k) {
      var F = T.facets[k], vals = {};
      T.rows().forEach(function (r) { [].concat(F.get(r)).forEach(function (v) { vals[v] = (vals[v] || 0) + 1; }); });
      var opts = Object.keys(vals).sort(function (x, y) { return String(F.show ? F.show(x) : x).localeCompare(String(F.show ? F.show(y) : y)); });
      return '<label>' + esc(F.label) + '<select data-facet="' + k + '"><option value="">All</option>' + opts.map(function (v) {
        return '<option value="' + esc(v) + '"' + (S.f[k] === v ? ' selected' : '') + '>' + esc(F.show ? F.show(v) : v) + ' (' + vals[v] + ')</option>';
      }).join('') + '</select></label>';
    }).join('');
  }

  function renderTable() {
    var T = TYPES[S.type], rows = filtered(), sortKey = S.sort || T.sort;
    var head = '<thead><tr>' + T.cols.map(function (c) {
      var sorted = c.key === sortKey;
      return '<th scope="col" aria-sort="' + (sorted ? (S.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-sort="' + c.key + '">' + esc(c.label) + (sorted ? (S.dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>';
    }).join('') + '</tr></thead>';
    var body = '<tbody>' + rows.map(function (r) {
      return '<tr>' + T.cols.map(function (c) { return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (c.html ? c.html(r) : esc(c.val(r))) + '</td>'; }).join('') + '</tr>';
    }).join('') + '</tbody>';
    $('#db-table').innerHTML = '<caption class="visually-hidden">' + esc(S.type) + ' matching the current filters</caption>' + head + body;
    $('#db-count').textContent = rows.length + ' of ' + T.rows().length + ' ' + S.type + (S.q || Object.keys(S.f).some(function (k) { return S.f[k]; }) ? ' match' : '');
  }

  function renderTabs() {
    document.querySelectorAll('[role=tab]').forEach(function (t) {
      var on = t.dataset.type === S.type;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      if (on) $('#db-panel').setAttribute('aria-labelledby', t.id);
    });
  }
  function renderAll() { renderTabs(); $('#q').value = S.q; renderFacets(); renderTable(); writeHash(); }

  function exportCsv() {
    var T = TYPES[S.type], rows = filtered();
    var cell = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [['uri'].concat(T.cols.map(function (c) { return c.label; })).join(',')];
    var typePath = { congregations: 'congregation', people: 'person', institutions: 'institution', events: 'event', places: 'place', cemeteries: 'cemetery', sites: 'site', periodicals: 'periodical' }[S.type];
    rows.forEach(function (r) {
      lines.push([new URL(root + typePath + '/' + r.id + '/', location.href).href].concat(T.cols.map(function (c) { return c.out ? c.out(r) : c.val(r); })).map(cell).join(','));
    });
    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob); link.download = 'kehillot-' + S.type + '.csv';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  var debounce;
  $('#q').addEventListener('input', function (e) { clearTimeout(debounce); debounce = setTimeout(function () { S.q = e.target.value; renderTable(); writeHash(); }, 120); });
  $('#facets').addEventListener('change', function (e) { var k = e.target.dataset.facet; if (!k) return; S.f[k] = e.target.value; renderTable(); writeHash(); });
  $('#db-table').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-sort]'); if (!b) return;
    var cur = S.sort || TYPES[S.type].sort;
    if (cur === b.dataset.sort) S.dir = -S.dir; else { S.sort = b.dataset.sort; S.dir = 1; }
    renderTable(); writeHash();
    var again = document.querySelector('button[data-sort="' + b.dataset.sort + '"]'); if (again) again.focus();
  });
  $('#export').addEventListener('click', exportCsv);
  var tablist = document.querySelector('[role=tablist]');
  tablist.addEventListener('click', function (e) {
    var t = e.target.closest('[role=tab]'); if (!t) return;
    S = { type: t.dataset.type, q: '', f: {}, sort: null, dir: 1 }; renderAll();
  });
  tablist.addEventListener('keydown', function (e) {
    var tabs = Array.from(tablist.querySelectorAll('[role=tab]')), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    var n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (n < 0) return;
    e.preventDefault(); tabs[n].focus(); tabs[n].click();
  });
  window.addEventListener('hashchange', function () { readHash(); renderAll(); });

  fetch(root + 'data/site.json').then(function (r) { return r.json(); }).then(function (d) {
    D = d; V = d.vocab; d.places.forEach(function (p) { P[p.id] = p; });
    [['congregations', 'congregation'], ['institutions', 'institution'], ['periodicals', 'periodical']].forEach(function (t) {
      d[t[0]].forEach(function (o) { O[o.id] = { name: o.name, type: t[1], place: o.place }; });
    });
    readHash(); renderAll();
  }).catch(function () { $('#db-count').textContent = 'Could not load the data. Serve the site over HTTP (see README).'; });
})();
