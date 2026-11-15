// The full directory remains readable without JS; search and paging run locally.
(() => {
  const input = document.querySelector('#locality-search');
  const rows = [...document.querySelectorAll('#locality-table tbody tr')];
  const more = document.querySelector('#locality-more');
  if (!input) return;
  let limit = 50;
  function render() {
    const query = input.value.trim().toLocaleLowerCase();
    let matches = 0;
    let shown = 0;
    rows.forEach(row => {
      const match = row.textContent.toLocaleLowerCase().includes(query);
      if (match) matches++;
      row.hidden = !match || matches > limit;
      if (!row.hidden) shown++;
    });
    document.querySelector('#locality-count').textContent = `${shown.toLocaleString('en-US')} of ${matches.toLocaleString('en-US')} matching places (${rows.length.toLocaleString('en-US')} total)`;
    more.hidden = shown >= matches;
  }
  input.addEventListener('input', () => {limit = 50; render();});
  more.addEventListener('click', () => {limit += 50; render();});
  render();
})();
