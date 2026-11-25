/* Filter the readable directory and comparison table together. */
(() => {
  const form = document.getElementById('survey-filters');
  if (!form) return;
  const cards = [...document.querySelectorAll('[data-survey]')];
  const rows = [...document.querySelectorAll('[data-survey-row]')];
  function update() {
    const words = document.getElementById('survey-query').value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const year = document.getElementById('survey-year').value;
    const type = document.getElementById('survey-form').value;
    const visible = new Set();
    cards.forEach(card => {
      card.hidden = !((!year || card.dataset.year === year) && (!type || card.dataset.form === type) && words.every(word => card.dataset.search.includes(word)));
      if (!card.hidden) visible.add(card.dataset.survey);
    });
    rows.forEach(row => { row.hidden = !visible.has(row.dataset.surveyRow); });
    document.getElementById('survey-count').textContent = `${visible.size} of ${cards.length} returns`;
    document.getElementById('survey-empty').hidden = visible.size !== 0;
  }
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('reset', () => setTimeout(update, 0));
})();
