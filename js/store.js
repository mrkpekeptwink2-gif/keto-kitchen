/* Хранилище настроек, избранного и списка покупок в localStorage. */
(function () {
  const PREFIX = 'keto_';
  function get(key, def) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? def : JSON.parse(v); }
    catch (e) { return def; }
  }
  function set(key, val) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(val)); } catch (e) {}
  }

  const d = window.KETO.defaults;
  function settings() {
    const s = get('settings', null) || {};
    const weight = s.weight || d.weight;
    const meals = s.meals || d.mealsPerDay;
    const proteinPerDay = s.proteinPerDay || Math.round(weight * 0.82);
    return { weight, meals, proteinPerDay, proteinPerMeal: Math.round(proteinPerDay / meals) };
  }
  function saveSettings(s) { set('settings', s); }

  // избранное / покупки — массивы id рецептов
  function favorites() { return get('favorites', []); }
  function isFav(id) { return favorites().indexOf(id) !== -1; }
  function toggleFav(id) {
    const f = favorites(); const i = f.indexOf(id);
    if (i === -1) f.push(id); else f.splice(i, 1);
    set('favorites', f); return f.indexOf(id) !== -1;
  }
  function shopping() { return get('shopping', []); }
  function inShop(id) { return shopping().indexOf(id) !== -1; }
  function toggleShop(id) {
    const s = shopping(); const i = s.indexOf(id);
    if (i === -1) s.push(id); else s.splice(i, 1);
    set('shopping', s); return s.indexOf(id) !== -1;
  }
  function clearShop() { set('shopping', []); }

  window.Store = { get, set, settings, saveSettings, favorites, isFav, toggleFav,
                   shopping, inShop, toggleShop, clearShop };
})();
