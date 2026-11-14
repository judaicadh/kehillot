// Visualizations page: hover/focus tooltips for every chart mark, and the d3-force network.
(function () {
  'use strict';
  var root = document.body.dataset.root || './';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var css = function (v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); };

  // ── tooltips: any element with data-tip (charts are keyboard-focusable too) ──
  var tipEl = document.getElementById('viz-tip');
  function showTip(el, x, y) { tipEl.textContent = el.getAttribute('data-tip'); tipEl.hidden = false; place(x, y); el.classList.add('is-hot'); }
  function place(x, y) { var w = tipEl.offsetWidth; tipEl.style.left = Math.min(window.innerWidth - w - 8, x + 14) + 'px'; tipEl.style.top = (y + 16) + 'px'; }
  function hideTip(el) { tipEl.hidden = true; if (el) el.classList.remove('is-hot'); }
  document.addEventListener('pointerover', function (e) { var el = e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); });
  document.addEventListener('pointermove', function (e) { if (!tipEl.hidden) place(e.clientX, e.clientY); });
  document.addEventListener('pointerout', function (e) { var el = e.target.closest('[data-tip]'); if (el) hideTip(el); });
  document.addEventListener('focusin', function (e) { var el = e.target.closest('[data-tip]'); if (el) { var r = el.getBoundingClientRect(); showTip(el, r.right, r.top); } });
  document.addEventListener('focusout', function (e) { var el = e.target.closest('[data-tip]'); if (el) hideTip(el); });

  // ── network ──
  var svgEl = document.getElementById('net');
  if (!svgEl || !window.d3) return;
  var TYPE_COLOR = { person: '--viz-1', congregation: '--viz-2', institution: '--viz-3', periodical: '--viz-4' };
  fetch(root + 'data/network.json').then(function (r) { return r.json(); }).then(function (G) {
    var W = svgEl.clientWidth || 900, H = svgEl.clientHeight || 620;
    var svg = d3.select(svgEl).attr('viewBox', [-W / 2, -H / 2, W, H]);
    var g = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.3, 5]).on('zoom', function (ev) { g.attr('transform', ev.transform); }));
    var nodes = G.nodes.map(function (n) { return Object.assign({}, n); });
    var links = G.links.map(function (l) { return Object.assign({}, l); });
    var r = function (n) { return 4 + Math.sqrt(n.degree) * 2.6; };
    var sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(function (d) { return d.id; }).distance(function (l) { return l.kind === 'split' ? 40 : 55; }).strength(0.6))
      .force('charge', d3.forceManyBody().strength(-120))
      .force('x', d3.forceX().strength(0.06)).force('y', d3.forceY().strength(0.08))
      .force('collide', d3.forceCollide().radius(function (d) { return r(d) + 2; }));
    var link = g.append('g').attr('class', 'net-links').selectAll('line').data(links).join('line')
      .attr('class', function (l) { return 'net-link net-' + l.kind; });
    var node = g.append('g').selectAll('g').data(nodes).join('g').attr('class', 'net-node').attr('tabindex', 0)
      .attr('role', 'button').attr('aria-label', function (d) { return d.name + ', ' + d.type + ', ' + d.degree + ' connections'; });
    node.append('circle').attr('r', r).style('fill', function (d) { return css(TYPE_COLOR[d.type]); });
    node.append('text').attr('class', 'net-label').attr('x', function (d) { return r(d) + 3; }).attr('y', 4).text(function (d) { return d.name; })
      .classed('always', function (d) { return d.degree >= 4; });
    node.call(d3.drag()
      .on('start', function (ev, d) { if (!ev.active) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag', function (ev, d) { d.fx = ev.x; d.fy = ev.y; })
      .on('end', function (ev, d) { if (!ev.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
    sim.on('tick', function () {
      link.attr('x1', function (d) { return d.source.x; }).attr('y1', function (d) { return d.source.y; }).attr('x2', function (d) { return d.target.x; }).attr('y2', function (d) { return d.target.y; });
      node.attr('transform', function (d) { return 'translate(' + d.x + ',' + d.y + ')'; });
    });

    // neighbourhood highlight + info panel
    var adj = {};
    links.forEach(function (l) { var a = l.source.id || l.source, b = l.target.id || l.target; (adj[a] = adj[a] || []).push({ other: b, l: l }); (adj[b] = adj[b] || []).push({ other: a, l: l }); });
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var info = document.getElementById('net-info');
    function select(d) {
      if (!d) { node.classed('dim', false).classed('sel', false); link.classed('dim', false).classed('hot', false); info.innerHTML = '<p class="gaz-note">Select a circle.</p>'; return; }
      var near = {}; near[d.id] = true; (adj[d.id] || []).forEach(function (a) { near[a.other] = true; });
      node.classed('dim', function (n) { return !near[n.id]; }).classed('sel', function (n) { return n.id === d.id; });
      link.classed('dim', function (l) { return l.source.id !== d.id && l.target.id !== d.id; }).classed('hot', function (l) { return l.source.id === d.id || l.target.id === d.id; });
      var rows = (adj[d.id] || []).map(function (a) {
        var o = byId[a.other], k = a.l.kind;
        var how = k === 'role' ? a.l.label : k === 'split' ? a.l.label : 'both in ' + a.l.label;
        return '<li><a href="' + root + o.href + '">' + esc(o.name) + '</a> <span class="muted">' + esc(how) + '</span></li>';
      });
      info.innerHTML = '<h3><a href="' + root + d.href + '">' + esc(d.name) + '</a></h3><p class="pop-addr">' + esc(d.type) + (d.place ? ' · ' + esc(d.place) : '') + '</p><ul>' + rows.join('') + '</ul>';
    }
    node.on('click', function (ev, d) { ev.stopPropagation(); select(d); })
      .on('keydown', function (ev, d) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); select(d); } });
    svg.on('click', function () { select(null); });
    document.getElementById('net-labels').addEventListener('change', function (e) { svgEl.classList.toggle('all-labels', e.target.checked); });
    document.getElementById('net-q').addEventListener('change', function (e) {
      var q = e.target.value.replace(/\s*\(.*\)$/, '').toLowerCase();
      var d = nodes.find(function (n) { return n.name.toLowerCase() === q; }) || nodes.find(function (n) { return n.name.toLowerCase().indexOf(q) > -1; });
      if (d) select(d);
    });
  });
})();
