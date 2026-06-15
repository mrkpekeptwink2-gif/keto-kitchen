/* Keto Kitchen — SPA: роутинг, поиск по ингредиентам, рецепты, избранное, покупки, правила, БАДы. */
(function () {
  const K = window.KETO, M = window.Macros, S = window.Store;
  const app = document.getElementById('app');
  const byId = id => document.getElementById(id);

  const CAT_EMOJI = {
    'Птица': '🍗', 'Говядина': '🥩', 'Свинина': '🥓', 'Рыба и морепродукты': '🐟',
    'Салаты': '🥗', 'Яйца': '🍳', 'Супы': '🍲', 'Десерты и смузи': '🍰',
  };
  const SRC_LABEL = { pdf: '📕 Из книги', guide: '📗 База (гайд)', bonus: '✨ Бонус', ai: '🤖 Придумано ИИ' };

  const recipeById = {}; K.recipes.forEach(r => recipeById[r.id] = r);
  let selected = new Set(S.get('searchIngredients', []));
  let builderSel = new Set(S.get('builderProducts', []));   // конструктор блюда: выбранные продукты

  /* ---------- добавленные пользователем продукты (per-recipe) ---------- */
  const getAdds = id => S.get('addn_' + id, []);
  const setAdds = (id, a) => S.set('addn_' + id, a);
  const setTxt = (id, v) => { const el = byId(id); if (el) el.textContent = v; };
  function currentRid() { const el = document.querySelector('#app .recipe'); return el ? +el.dataset.rid : 0; }

  // калорийность продукта на 100 г: указанная вручную или из БЖУ
  function kcalOf(p) { return (p.kc != null && p.kc !== '') ? +p.kc : (p.f * 9 + p.p * 4 + p.c * 4); }

  // итоговые макросы = масштабированное блюдо + добавленные продукты
  function totalsWith(baseM, adds) {
    let F = baseM.fat_g, P = baseM.protein_g, C = baseM.carb_g, kcal = baseM.kcal;
    adds.forEach(a => {
      F += a.f * a.grams / 100; P += a.p * a.grams / 100; C += a.c * a.grams / 100;
      kcal += kcalOf(a) * a.grams / 100;
    });
    const pf = kcal ? Math.round(F * 9 / kcal * 100) : 0;
    const pp = kcal ? Math.round(P * 4 / kcal * 100) : 0;
    return { fat_g: Math.round(F), protein_g: Math.round(P), carb_g: Math.round(C), kcal: Math.round(kcal),
             fat_pct: pf, protein_pct: pp, carb_pct: Math.max(0, 100 - pf - pp) };
  }

  // объединённый каталог продуктов: встроенные + сохранённые пользователем
  const userProducts = () => S.get('userProducts', []);
  function allProducts() {
    const map = {};
    K.products.forEach(p => { map[p.n.toLowerCase()] = p; });
    userProducts().forEach(p => { map[p.n.toLowerCase()] = p; });
    return Object.values(map);
  }
  function findProduct(name) {
    const q = (name || '').trim().toLowerCase();
    if (!q) return null;
    const all = allProducts();
    return all.find(x => x.n.toLowerCase() === q) || all.find(x => x.n.toLowerCase().indexOf(q) === 0) || null;
  }

  /* ---------- пересчёт граммовок под пропорции блюда (при добавлении продуктов) ---------- */
  const nut = key => K.nutrition[key] || { f: 0, p: 0, c: 0 };
  const ratioOf = r => ({ f: r.macros.fat_pct, p: r.macros.protein_pct, c: r.macros.carb_pct });

  function baseMacros(ings) {
    let F = 0, P = 0, C = 0;
    ings.forEach(i => { const n = nut(i.key); F += n.f * i.grams / 100; P += n.p * i.grams / 100; C += n.c * i.grams / 100; });
    return { fat_g: F, protein_g: P, carb_g: C, kcal: F * 9 + P * 4 + C * 4 };
  }

  // подобрать граммовки базовых ингредиентов так, чтобы блюдо+добавки сохраняли пропорцию target
  // и общий белок ≈ targetProtein. Координатный спуск с тернарным поиском.
  function rebalance(r, adds, targetProtein, target) {
    const items = r.ingredients.map(i => ({ key: i.key, base: i.grams || 0 }));
    const N = items.length;
    let aF = 0, aP = 0, aC = 0;
    adds.forEach(a => { aF += a.f * a.grams / 100; aP += a.p * a.grams / 100; aC += a.c * a.grams / 100; });
    // основной белковый ингредиент (наибольший вклад белка: мясо/птица/рыба и т.п.)
    const protSet = new Set(K.proteinKeys || []);
    let mainIdx = -1, mainContrib = -1;
    items.forEach((it, i) => {
      if (protSet.has(it.key)) { const c = nut(it.key).p * it.base; if (c > mainContrib) { mainContrib = c; mainIdx = i; } }
    });
    // удерживаем у исходной граммовки: второстепенные белковые (яйцо, сыр…) → изменение белка
    // забирает основной ингредиент; и приправы/зелень (≈0 макросов) → чтобы не «гуляли»
    const SEASON = new Set(['spice', 'sweetener', 'water', 'baking_powder', 'garlic',
                            'lemon_juice', 'lemon_zest', 'herbs', 'psyllium']);
    const pinProtein = items.map((it, i) =>
      (i !== mainIdx && nut(it.key).p >= 5) || SEASON.has(it.key));
    // овощи/зелень защищаем от сильного уменьшения (урезаем их в последнюю очередь)
    const VEG = new Set(['lettuce', 'broccoli', 'green_beans', 'cauliflower', 'zucchini', 'spinach',
                         'mushroom', 'asparagus', 'napa', 'celery', 'cucumber', 'onion', 'carrot', 'pickle']);
    let baseProt = 0; items.forEach(it => baseProt += nut(it.key).p * it.base / 100);
    const k0 = baseProt > 0 ? Math.max(0.3, Math.min(1, (targetProtein - aP) / baseProt)) : 1;
    const x = items.map((it, i) => pinProtein[i] ? it.base : it.base * k0);
    const lo = items.map(it => it.base > 0 ? Math.max(1, it.base * 0.15) : 0);
    // непинованным ингредиентам (основной белок, жиры, овощи) разрешён рост — чтобы выровнять
    // пропорцию ростом, а не урезанием овощей
    const hi = items.map((it, i) => it.base > 0 ? (pinProtein[i] ? it.base : it.base * 3) : 0);
    function cost(x) {
      let F = aF, P = aP, C = aC;
      for (let i = 0; i < N; i++) { const n = nut(items[i].key); F += n.f * x[i] / 100; P += n.p * x[i] / 100; C += n.c * x[i] / 100; }
      const kc = (F * 9 + P * 4 + C * 4) || 1;
      const dr = (F * 9 / kc * 100 - target.f) ** 2 + (P * 4 / kc * 100 - target.p) ** 2 + (C * 4 / kc * 100 - target.c) ** 2;
      const ds = targetProtein > 0 ? ((P - targetProtein) / targetProtein * 100) ** 2 : 0;
      let reg = 0, vreg = 0;  // reg: второстепенные белковые/приправы; vreg: защита овощей ОТ УМЕНЬШЕНИЯ
      for (let i = 0; i < N; i++) {
        if (pinProtein[i]) { const d = x[i] - items[i].base; reg += d * d; }
        else if (VEG.has(items[i].key) && items[i].base > 0 && x[i] < items[i].base) {
          const d = (x[i] - items[i].base) / items[i].base; vreg += d * d;  // штраф только за срез овоща
        }
      }
      return dr + 0.1 * ds + 0.12 * reg + 300 * vreg;
    }
    for (let s = 0; s < 30; s++) {
      for (let i = 0; i < N; i++) {
        if (hi[i] <= lo[i]) continue;
        let a = lo[i], b = hi[i];
        for (let it = 0; it < 20; it++) {
          const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
          x[i] = m1; const c1 = cost(x); x[i] = m2; const c2 = cost(x);
          if (c1 < c2) b = m2; else a = m1;
        }
        x[i] = (a + b) / 2;
      }
    }
    return x.map(v => Math.round(v));
  }
  function macroBarIds(m) {
    return `<div class="mbar"><span class="mbar__f" id="rBarF" style="width:${m.fat_pct}%"></span>`
      + `<span class="mbar__p" id="rBarP" style="width:${m.protein_pct}%"></span>`
      + `<span class="mbar__c" id="rBarC" style="width:${m.carb_pct}%"></span></div>`
      + `<div class="mlabels"><span class="ml-f" id="rmlF">Ж ${m.fat_pct}%</span>`
      + `<span class="ml-p" id="rmlP">Б ${m.protein_pct}%</span>`
      + `<span class="ml-c" id="rmlC">У ${m.carb_pct}%</span></div>`;
  }

  /* ---------- утилиты ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => s.toLowerCase().trim();

  function macroBar(m) {
    return `<div class="mbar" title="Жиры ${m.fat_pct}% · Белки ${m.protein_pct}% · Углеводы ${m.carb_pct}%">
      <span class="mbar__f" style="width:${m.fat_pct}%"></span>
      <span class="mbar__p" style="width:${m.protein_pct}%"></span>
      <span class="mbar__c" style="width:${m.carb_pct}%"></span>
    </div>
    <div class="mlabels"><span class="ml-f">Ж ${m.fat_pct}%</span><span class="ml-p">Б ${m.protein_pct}%</span><span class="ml-c">У ${m.carb_pct}%</span></div>`;
  }

  function complianceBadge(r) {
    if (r.source === 'bonus' || r.source === 'ai') {
      if (r.goal === 'treat') return `<span class="cbadge treat">🍰 Десерт — редко</span>`;
      return r.compliant ? `<span class="cbadge ok">✓ Адаптировано под 70/20/10</span>`
                         : `<span class="cbadge warn">⚠ Проверьте БЖУ</span>`;
    }
    if (r.category === 'Десерты и смузи') return `<span class="cbadge treat">🍰 Десерт — есть редко</span>`;
    return `<span class="cbadge ok">✓ По методике 70/20/10</span>`;
  }

  function photoHtml(r, cls) {
    const ill = r.photo_illustrative ? `<span class="ill-badge">иллюстрация</span>` : '';
    if (r.photo) return `<img class="${cls}" loading="lazy" src="${esc(r.photo)}" alt="${esc(r.title)}">${ill}`;
    return `<div class="${cls} ph"><span>${CAT_EMOJI[r.category] || '🍽️'}</span></div>`;
  }

  function recipeCard(r) {
    const fav = S.isFav(r.id);
    return `<a class="card" href="#/recipe/${esc(r.slug)}">
      <div class="card__media">${photoHtml(r, 'card__img')}
        <button class="heart ${fav ? 'on' : ''}" data-fav="${r.id}" title="В избранное">${fav ? '❤️' : '🤍'}</button>
        <span class="src-badge">${SRC_LABEL[r.source]}</span>
      </div>
      <div class="card__body">
        <div class="card__cat">${CAT_EMOJI[r.category] || ''} ${esc(r.category)}</div>
        <h3 class="card__title">${esc(r.title)}</h3>
        ${macroBar(r.macros)}
        <div class="card__kcal">${r.macros.kcal} ккал${r.servings > 1 ? ' · порция' : ''}</div>
      </div>
    </a>`;
  }

  function grid(list, emptyMsg) {
    if (!list.length) return `<p class="empty">${esc(emptyMsg || 'Ничего не найдено.')}</p>`;
    return `<div class="grid">${list.map(recipeCard).join('')}</div>`;
  }

  /* ---------- поиск по ингредиентам ---------- */
  function groupSatisfied(group, sel) {
    return group.some(g => {
      for (const s of sel) if (g === s || g.indexOf(s) !== -1 || s.indexOf(g) !== -1) return true;
      return false;
    });
  }
  function matchRecipe(r, sel) {
    const groups = r.ingGroups || [];
    let matched = 0; const miss = [];
    groups.forEach(g => { groupSatisfied(g, sel) ? matched++ : miss.push(g[0]); });
    return { matched, missing: miss.length, total: groups.length, missGroups: miss };
  }

  function viewHome() {
    const sel = [...selected];
    const popular = K.ingredientCatalog.slice(0, 28);
    let results = '';
    if (sel.length) {
      const scored = K.recipes.map(r => ({ r, m: matchRecipe(r, selected) }))
        .filter(x => x.m.matched > 0)
        .sort((a, b) => a.m.missing - b.m.missing || b.m.matched - a.m.matched || a.m.total - b.m.total);
      const ready = scored.filter(x => x.m.missing === 0).map(x => x.r);
      const near = scored.filter(x => x.m.missing >= 1).slice(0, 30);
      const nearCards = near.map(x => `
        <a class="card" href="#/recipe/${esc(x.r.slug)}">
          <div class="card__media">${photoHtml(x.r, 'card__img')}<span class="src-badge">${SRC_LABEL[x.r.source]}</span></div>
          <div class="card__body"><div class="card__cat">${CAT_EMOJI[x.r.category] || ''} ${esc(x.r.category)}</div>
            <h3 class="card__title">${esc(x.r.title)}</h3>
            <div class="missing">не хватает: ${x.m.missGroups.map(esc).join(', ')}</div>
          </div></a>`).join('');
      results = `
        <section class="results">
          ${ready.length ? `<h2>✅ Можно приготовить <span class="count">${ready.length}</span></h2>${grid(ready)}` : ''}
          ${near.length ? `<h2>Хорошо подходят <span class="count">докупить немного</span></h2>
            <div class="grid">${nearCards}</div>` : ''}
          ${(!ready.length && !near.length) ? `<p class="empty">Ничего не нашлось. Попробуйте выбрать другие продукты.</p>` : ''}
        </section>`;
    } else {
      // подборка: по 1-2 из каждой категории
      const featured = [];
      K.categories.forEach(c => featured.push(...K.recipes.filter(r => r.category === c && r.photo).slice(0, 2)));
      results = `<section class="results"><h2>Загляните в меню</h2>${grid(featured)}</section>`;
    }

    return `
      <section class="hero">
        <h1>Что приготовить из того, что есть?</h1>
        <p class="muted">Отметьте продукты из холодильника — подберём кето-блюда по методике 70/20/10.</p>
        <div class="search-box">
          <input id="ingInput" type="text" placeholder="Например: курица, авокадо, яйца…" autocomplete="off">
          <div class="suggest" id="ingSuggest" hidden></div>
        </div>
        <div class="chips" id="selChips">
          ${sel.map(t => `<span class="chip on" data-ing="${esc(t)}">${esc(t)} ✕</span>`).join('')}
          ${sel.length ? `<button class="chip clear" id="clearSel">очистить всё</button>` : ''}
        </div>
        <div class="chips popular">
          ${popular.map(p => `<span class="chip ${selected.has(p.name) ? 'on' : ''}" data-ing="${esc(p.name)}">${esc(p.name)}</span>`).join('')}
        </div>
      </section>
      ${results}`;
  }

  function rerenderHome() { app.innerHTML = viewHome(); bindHome(); }

  function bindHome() {
    const input = byId('ingInput'), sug = byId('ingSuggest');
    if (input) {
      input.addEventListener('input', () => {
        const q = norm(input.value);
        if (!q) { sug.hidden = true; return; }
        const matches = K.ingredientCatalog.filter(c => c.name.indexOf(q) !== -1).slice(0, 8);
        sug.innerHTML = matches.map(m => `<div class="suggest__item" data-ing="${esc(m.name)}">${esc(m.name)} <span class="muted">${m.count}</span></div>`).join('')
          || `<div class="suggest__item muted">нет совпадений</div>`;
        sug.hidden = false;
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          const q = norm(input.value);
          const first = K.ingredientCatalog.find(c => c.name.indexOf(q) !== -1);
          if (first) { addIng(first.name); input.value = ''; sug.hidden = true; }
        }
      });
    }
  }

  function addIng(t) { selected.add(t); S.set('searchIngredients', [...selected]); rerenderHome(); }
  function removeIng(t) { selected.delete(t); S.set('searchIngredients', [...selected]); rerenderHome(); }

  /* ---------- конструктор блюда из продуктов ---------- */
  const KTARGET = { f: 70, p: 20, c: 10 };

  function productByName(name) {
    const q = norm(name);
    return allProducts().find(x => norm(x.n) === q) || null;
  }
  // категория продукта по доминирующему макросу (по калориям)
  function prodCat(p) {
    const kf = p.f * 9, kp = p.p * 4, kc = p.c * 4, tot = kf + kp + kc || 1;
    if (kp / tot >= 0.45) return 'protein';
    if (kf / tot >= 0.60) return 'fat';
    if (kc / tot >= 0.35) return 'carb';
    return 'mixed';
  }

  // подобрать граммовки выбранных продуктов под 70/20/10 и целевой белок (координатный спуск)
  function buildDish(prods, targetProtein) {
    const N = prods.length;
    const g = prods.map(() => 40), lo = prods.map(() => 0), hi = prods.map(() => 600);
    const mac = gg => {
      let F = 0, P = 0, C = 0;
      for (let i = 0; i < N; i++) { F += prods[i].f * gg[i] / 100; P += prods[i].p * gg[i] / 100; C += prods[i].c * gg[i] / 100; }
      return { F, P, C, kc: F * 9 + P * 4 + C * 4 };
    };
    const cost = gg => {
      const m = mac(gg), k = m.kc || 1;
      const dr = (m.F * 9 / k * 100 - KTARGET.f) ** 2 + (m.P * 4 / k * 100 - KTARGET.p) ** 2 + (m.C * 4 / k * 100 - KTARGET.c) ** 2;
      // привязка размера к калорийности приёма (~белок×20 при 20% белка) — даёт нужный белок
      // в сбалансированном блюде и не даёт раздуться вырожденным наборам (напр. одно масло)
      const tk = targetProtein > 0 ? targetProtein * 20 : 600;
      const ds = ((m.kc - tk) / tk * 100) ** 2;
      return dr + 0.08 * ds;
    };
    for (let s = 0; s < 40; s++) for (let i = 0; i < N; i++) {
      let a = lo[i], b = hi[i];
      for (let it = 0; it < 26; it++) {
        const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
        g[i] = m1; const c1 = cost(g); g[i] = m2; const c2 = cost(g);
        if (c1 < c2) b = m2; else a = m1;
      }
      g[i] = (a + b) / 2;
    }
    const grams = g.map(v => Math.round(v));
    const m = mac(grams), k = m.kc || 1;
    const pf = Math.round(m.F * 9 / k * 100), pp = Math.round(m.P * 4 / k * 100);
    return {
      grams,
      fat_g: Math.round(m.F), protein_g: Math.round(m.P), carb_g: Math.round(m.C), kcal: Math.round(m.kc),
      fat_pct: pf, protein_pct: pp, carb_pct: Math.max(0, 100 - pf - pp),
    };
  }

  // чего не хватает, чтобы попасть в норму (по лучшему достигнутому соотношению)
  function builderNeeds(m) {
    const needs = [];
    if (m.fat_pct < 68 || m.protein_pct > 26 || m.carb_pct > 11) needs.push('fat');
    if (m.protein_pct < 17 || m.fat_pct > 78) needs.push('protein');
    if (m.carb_pct < 4) needs.push('carb');
    return [...new Set(needs)];
  }
  const NEED_LABEL = {
    fat: 'Маловато жира (или слишком много белка/углеводов) — добавьте жирный продукт:',
    protein: 'Маловато белка — добавьте белковый продукт:',
    carb: 'Почти нет углеводов — добавьте немного овощей или ягод:',
  };
  // подсказать продукты нужной категории (которых ещё нет в наборе)
  function suggestFor(need) {
    const have = new Set([...builderSel].map(norm));
    const list = allProducts().filter(p => prodCat(p) === need && !have.has(norm(p.n)));
    list.sort((a, b) => need === 'fat' ? b.f - a.f : need === 'protein' ? b.p - a.p : b.c - a.c);
    return list.slice(0, 6);
  }

  function viewBuilder() {
    const names = [...builderSel];
    const prods = names.map(productByName).filter(Boolean);
    // популярные теги по группам
    const pop = { protein: [], fat: [], carb: [] };
    allProducts().forEach(p => { const c = prodCat(p); if (pop[c] && pop[c].length < 9) pop[c].push(p); });
    const tagRow = arr => arr.map(p => `<span class="chip ${builderSel.has(p.n) ? 'on' : ''}" data-bing="${esc(p.n)}">${esc(p.n)}</span>`).join('');

    let result;
    if (!prods.length) {
      result = `<p class="empty">Отметьте продукты, которые у вас есть — соберу из них блюдо в кето-пропорции 70/20/10.</p>`;
    } else {
      const tp = S.settings().proteinPerMeal;
      const d = buildDish(prods, tp);
      const ok = M.inBand(d);
      const rows = prods.map((p, i) => {
        const g = d.grams[i];
        const tiny = g < 3 ? ` <small class="muted">— можно не добавлять</small>` : '';
        return `<li data-bg="${g}"><span class="ing-name">${esc(p.n)}${tiny}</span><span class="ing-g"><b class="g-now">${g}</b> г</span></li>`;
      }).join('');
      // бегунок белка — как на странице рецепта (пропорция при масштабировании не меняется)
      const set = S.settings();
      const baseProt = d.protein_g;
      const scalable = ok && baseProt > 3;   // бегунок только для сбалансированного блюда
      const sMin = scalable ? Math.max(10, Math.round(Math.min(baseProt, set.proteinPerMeal) * 0.5)) : 0;
      const sMax = scalable ? Math.round(Math.max(baseProt, set.proteinPerMeal) * 2) : 0;
      const startProt = scalable ? Math.min(sMax, Math.max(sMin, Math.round(baseProt))) : baseProt;
      const sliderCard = scalable ? `
        <div class="slider-card">
          <div class="slider-head"><span>🍗 Белок в этом приёме</span><b id="bpsVal">${startProt} г</b></div>
          <input type="range" id="bProteinSlider" min="${sMin}" max="${sMax}" step="1" value="${startProt}"
                 data-base="${baseProt}" data-kcal="${d.kcal}" data-fat="${d.fat_g}" data-carb="${d.carb_g}">
          <div class="slider-live" id="bpsLive">🔥 ${d.kcal} ккал · Ж ${d.fat_g} · Б ${d.protein_g} · У ${d.carb_g} г</div>
          <div class="slider-foot muted">Двигайте бегунок, чтобы подогнать порцию под себя. Ваша норма:
            <b>${set.proteinPerDay} г/день</b> · ~${set.proteinPerMeal} г на приём.
            <button class="settings-link" id="openSettings2">изменить норму ⚖️</button></div>
        </div>` : '';
      let advice = '';
      if (!ok) {
        advice = `<div class="builder-advice">
          <p class="ba-head">⚠ Пока не выходит ровно 70/20/10 — получается ${d.fat_pct}/${d.protein_pct}/${d.carb_pct}.</p>
          ${builderNeeds(d).map(n => `<div class="ba-need"><p>${NEED_LABEL[n]}</p>
            <div class="chips">${suggestFor(n).map(p => `<span class="chip" data-bing="${esc(p.n)}">＋ ${esc(p.n)}</span>`).join('')}</div>
          </div>`).join('')}
        </div>`;
      }
      result = `
        <section class="builder-result">
          <div class="macro-card">
            <div class="macro-card__top">
              <div class="macro-num"><b id="bmKcal">${d.kcal}</b><span>ккал</span></div>
              <div class="macro-num"><b id="bmFat">${d.fat_g} г</b><span>жиры</span></div>
              <div class="macro-num"><b id="bmProt">${d.protein_g} г</b><span>белок</span></div>
              <div class="macro-num"><b id="bmCarb">${d.carb_g} г</b><span>углеводы</span></div>
            </div>
            ${macroBar(d)}
            <div class="addctl">${ok
              ? `<span class="cbadge ok">✓ Сбалансировано под 70/20/10</span>`
              : `<span class="cbadge warn">⚠ Нужно докинуть продуктов</span>`}</div>
          </div>
          ${sliderCard}
          <h2>Граммовки</h2>
          <ul class="ing-list builder-ings">${rows}</ul>
          ${advice}
        </section>`;
    }

    return `
      <section class="hero">
        <h1>🧪 Конструктор блюда</h1>
        <p class="muted">Отметьте продукты, которые есть под рукой — подберу граммовки в кето-пропорции 70/20/10. Если чего-то не хватает — подскажу, что добавить.</p>
        <div class="search-box">
          <input id="bInput" type="text" placeholder="Например: курица, авокадо, масло…" autocomplete="off">
          <div class="suggest" id="bSuggest" hidden></div>
        </div>
        <div class="chips" id="bChips">
          ${names.map(t => `<span class="chip on" data-bing="${esc(t)}">${esc(t)} ✕</span>`).join('')}
          ${names.length ? `<button class="chip clear" id="bClear">очистить всё</button>` : ''}
        </div>
        <div class="bgroups">
          <div class="bgroup"><span class="bg-label">🥩 Белок</span><div class="chips">${tagRow(pop.protein)}</div></div>
          <div class="bgroup"><span class="bg-label">🧀 Жиры</span><div class="chips">${tagRow(pop.fat)}</div></div>
          <div class="bgroup"><span class="bg-label">🥦 Овощи / углеводы</span><div class="chips">${tagRow(pop.carb)}</div></div>
        </div>
      </section>
      ${result}`;
  }

  function rerenderBuilder() { app.innerHTML = viewBuilder(); bindBuilder(); }
  function bindBuilder() {
    const input = byId('bInput'), sug = byId('bSuggest');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = norm(input.value);
      if (!q) { sug.hidden = true; return; }
      const matches = allProducts().filter(p => norm(p.n).indexOf(q) !== -1).slice(0, 8);
      sug.innerHTML = matches.map(p => `<div class="suggest__item" data-bing="${esc(p.n)}">${esc(p.n)} <span class="muted">Ж${p.f} Б${p.p} У${p.c}</span></div>`).join('')
        || `<div class="suggest__item muted">нет совпадений</div>`;
      sug.hidden = false;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const q = norm(input.value);
        const first = allProducts().find(p => norm(p.n).indexOf(q) !== -1);
        if (first) { addBuilder(first.n); input.value = ''; sug.hidden = true; }
      }
    });
  }
  function addBuilder(n) { builderSel.add(n); S.set('builderProducts', [...builderSel]); rerenderBuilder(); }
  function removeBuilder(n) { builderSel.delete(n); S.set('builderProducts', [...builderSel]); rerenderBuilder(); }

  /* ---------- категории ---------- */
  function viewCategories() {
    const src = location.hash.split('?')[1] || '';
    const cards = K.categories.map(c => {
      const n = K.recipes.filter(r => r.category === c).length;
      return `<a class="cat-tile" href="#/category/${encodeURIComponent(c)}">
        <span class="cat-emoji">${CAT_EMOJI[c]}</span>
        <span class="cat-name">${esc(c)}</span><span class="cat-count">${n}</span></a>`;
    }).join('');
    const bonusN = K.recipes.filter(r => r.source === 'bonus').length;
    const guideN = K.recipes.filter(r => r.source === 'guide').length;
    const aiN = K.recipes.filter(r => r.source === 'ai').length;
    return `<section class="section">
      <h1>Категории</h1>
      <div class="cat-grid">${cards}</div>
      <h2>Особые подборки</h2>
      <div class="cat-grid">
        ${aiN ? `<a class="cat-tile alt" href="#/source/ai"><span class="cat-emoji">🤖</span><span class="cat-name">ИИ-повар</span><span class="cat-count">${aiN}</span></a>` : ''}
        <a class="cat-tile alt" href="#/source/bonus"><span class="cat-emoji">✨</span><span class="cat-name">Бонусные рецепты</span><span class="cat-count">${bonusN}</span></a>
        <a class="cat-tile alt" href="#/source/guide"><span class="cat-emoji">📗</span><span class="cat-name">Базовые блюда (гайд)</span><span class="cat-count">${guideN}</span></a>
      </div>
    </section>`;
  }

  function viewCategory(name) {
    const list = K.recipes.filter(r => r.category === name);
    const off = list.filter(r => r.source !== 'bonus' && r.source !== 'ai');
    const bonus = list.filter(r => r.source === 'bonus');
    const ai = list.filter(r => r.source === 'ai');
    return `<section class="section">
      <a class="back" href="#/categories">‹ Категории</a>
      <h1>${CAT_EMOJI[name] || ''} ${esc(name)} <span class="count">${list.length}</span></h1>
      ${grid(off)}
      ${ai.length ? `<h2>🤖 Придумано ИИ (адаптировано под методику)</h2>${grid(ai)}` : ''}
      ${bonus.length ? `<h2>✨ Бонусные (адаптированы под методику)</h2>${grid(bonus)}` : ''}
    </section>`;
  }

  function viewSource(src) {
    const list = K.recipes.filter(r => r.source === src);
    const title = src === 'bonus' ? '✨ Бонусные рецепты'
                : src === 'ai' ? '🤖 ИИ-повар'
                : '📗 Базовые блюда из гайда';
    const note = src === 'bonus'
      ? 'Подобраны из совместимых рецептов, проверены по запрещённым продуктам и адаптированы под 70/20/10 (порции рассчитаны оптимизатором).'
      : src === 'ai'
      ? 'Рецепты, придуманные ИИ по вашему запросу: проверены по запрещённым продуктам и адаптированы под 70/20/10. Хотите ещё — попросите меня придумать рецепты из нужных продуктов.'
      : 'Примеры блюд из гайда. Подгоните порции под свой вес — переключатель есть на странице рецепта.';
    const byCat = {};
    list.forEach(r => { (byCat[r.category] = byCat[r.category] || []).push(r); });
    const blocks = Object.keys(byCat).map(c => `<h2>${CAT_EMOJI[c] || ''} ${esc(c)}</h2>${grid(byCat[c])}`).join('');
    return `<section class="section">
      <a class="back" href="#/categories">‹ Категории</a>
      <h1>${title} <span class="count">${list.length}</span></h1>
      <p class="muted">${note}</p>${blocks}</section>`;
  }

  /* ---------- страница рецепта ---------- */
  function viewRecipe(slug) {
    const r = K.recipes.find(x => x.slug === slug);
    if (!r) return `<section class="section"><p class="empty">Рецепт не найден.</p></section>`;
    const set = S.settings();
    const canScale = M.isScalable(r);
    const baseProt = r.macros.protein_g;
    // диапазон бегунка белка (г). Старт — «как в рецепте» (своя граммовка для каждого рецепта);
    // двигая бегунок, можно подогнать под свою норму на приём.
    const sMin = canScale ? Math.max(10, Math.round(Math.min(baseProt, set.proteinPerMeal) * 0.5)) : 0;
    const sMax = canScale ? Math.round(Math.max(baseProt, set.proteinPerMeal) * 2) : 0;
    const startProt = canScale ? Math.min(sMax, Math.max(sMin, Math.round(baseProt))) : baseProt;
    const adds = getAdds(r.id);
    const rebalanceOn = S.get('rebalanceOn', true);
    const k = (canScale && baseProt > 0) ? startProt / baseProt : 1;
    let ings, baseM, rebalanced = false;
    if (adds.length && rebalanceOn) {
      const target = canScale ? startProt : r.macros.protein_g;
      const gx = rebalance(r, adds, target, ratioOf(r));
      ings = r.ingredients.map((i, idx) => Object.assign({}, i, { grams: gx[idx] }));
      baseM = baseMacros(ings);
      rebalanced = true;
    } else {
      ings = M.scaledIngredients(r, k);
      baseM = M.scaledMacros(r, k);
    }
    const m = totalsWith(baseM, adds);           // итог с учётом добавленных продуктов
    const fav = S.isFav(r.id), shop = S.inShop(r.id);

    const ingRows = ings.map((i, idx) => {
      const orig = r.ingredients[idx];
      return `<li data-base="${orig.grams}"><span class="ing-name">${esc(i.name)}</span>
        <span class="ing-g"><b class="g-now">${i.grams}</b> г</span></li>`;
    }).join('');
    const addRows = adds.map((a, idx) => {
      const gf = Math.round(a.f * a.grams / 100), gp = Math.round(a.p * a.grams / 100),
            gc = Math.round(a.c * a.grams / 100), gk = Math.round(kcalOf(a) * a.grams / 100);
      return `<li class="added"><span class="ing-name">➕ ${esc(a.n)}
          <small class="addkbju">${gk} ккал · Ж${gf} Б${gp} У${gc}</small></span>
        <span class="ing-g">${a.grams} г <button class="rm-add" data-rmadd="${idx}" title="Убрать">✕</button></span></li>`;
    }).join('');

    return `<article class="recipe" data-rid="${r.id}">
      <a class="back" href="${history.length > 1 ? 'javascript:history.back()' : '#/'}">‹ Назад</a>
      <div class="recipe__media">${photoHtml(r, 'recipe__img')}</div>
      <div class="recipe__head">
        <div class="card__cat">${CAT_EMOJI[r.category] || ''} ${esc(r.category)} · ${SRC_LABEL[r.source]}</div>
        <h1>${esc(r.title)}</h1>
        ${complianceBadge(r)}
      </div>

      <div class="macro-card">
        <div class="macro-card__top">
          <div class="macro-num"><b id="mKcal">${m.kcal}</b><span>ккал${r.servings > 1 ? ' / порция' : ''}</span></div>
          <div class="macro-num"><b id="mFat">${m.fat_g} г</b><span>жиры</span></div>
          <div class="macro-num"><b id="mProt">${m.protein_g} г</b><span>белок</span></div>
          <div class="macro-num"><b id="mCarb">${m.carb_g} г</b><span>углеводы</span></div>
        </div>
        ${macroBarIds(m)}
        ${adds.length ? `<div class="addctl">
          <label class="switch sm"><input type="checkbox" id="rebalanceToggle" ${rebalanceOn ? 'checked' : ''}>
            <span>⚖️ Подгонять граммовки под пропорции блюда</span></label>
          <span class="muted">${rebalanced ? '✓ состав пересчитан под добавленные продукты' : 'итог с учётом добавленного'}</span>
        </div>` : ''}
      </div>

      ${canScale ? `
      <div class="slider-card">
        <div class="slider-head"><span>🍗 Белок в этом приёме</span><b id="psVal">${startProt} г</b></div>
        <input type="range" id="proteinSlider" min="${sMin}" max="${sMax}" step="1" value="${startProt}"
               data-rid="${r.id}" data-base="${baseProt}">
        <div class="slider-live" id="psLive">🔥 ${m.kcal} ккал&nbsp;·&nbsp;Ж ${m.fat_g}&nbsp;·&nbsp;Б ${m.protein_g}&nbsp;·&nbsp;У ${m.carb_g} г</div>
        <div class="slider-foot muted">Сейчас — как в рецепте. Ваша норма: <b>${set.proteinPerDay} г/день</b> · ~${set.proteinPerMeal} г на приём (${set.meals}).
          Двигайте бегунок, чтобы подогнать под себя. <button class="settings-link" id="openSettings2">изменить норму ⚖️</button></div>
      </div>`
      : `<div class="scale-row"><span class="muted">Десерт — порция не масштабируется по белку.</span></div>`}

      <div class="recipe__cols">
        <div class="recipe__ing">
          <h2>Ингредиенты</h2>
          <ul class="ing-list">${ingRows}${addRows}</ul>

          <div class="add-prod">
            <button class="btn btn--ghost btn--sm" id="addToggle">➕ Добавить продукт</button>
            ${adds.length ? `<button class="settings-link" id="clearAdds">очистить добавленное</button>` : ''}
            <div class="add-form" id="addForm" hidden>
              <div class="add-search">
                <input id="addName" type="text" autocomplete="off" placeholder="Найти продукт (напр. шоколад, сыр…)">
                <div class="suggest" id="prodSuggest" hidden></div>
              </div>
              <div class="add-row">
                <input type="number" id="addGrams" value="20" min="1" max="3000" aria-label="граммы"><span class="muted">г</span>
                <button class="btn btn--sm" id="addConfirm">Добавить</button>
              </div>
              <details class="custom-prod">
                <summary>Нет в списке? Добавить свой продукт (на 100 г)</summary>
                <input id="cName" placeholder="название продукта">
                <div class="cpac">
                  <input type="number" id="cF" placeholder="жиры"><input type="number" id="cP" placeholder="белок">
                  <input type="number" id="cC" placeholder="углев"><input type="number" id="cKcal" placeholder="ккал*">
                </div>
                <button class="btn btn--sm" id="addCustom">Добавить и сохранить</button>
                <p class="muted">*ккал необязательно — посчитаем из БЖУ. Продукт сохранится в вашей базе для будущих рецептов. Граммы берутся из поля выше.</p>
              </details>
            </div>
          </div>

          <div class="recipe__actions">
            <button class="btn ${fav ? 'btn--on' : ''}" data-fav="${r.id}">${fav ? '❤️ В избранном' : '🤍 В избранное'}</button>
            <button class="btn ${shop ? 'btn--on' : ''}" data-shop="${r.id}">🛒 ${shop ? 'В списке покупок' : 'В список покупок'}</button>
          </div>
        </div>
        <div class="recipe__steps">
          <h2>Приготовление</h2>
          <ol>${r.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          ${r.notes && r.notes.length ? `<div class="notes"><h3>Примечания</h3>${r.notes.map(n => `<p>${esc(n)}</p>`).join('')}</div>` : ''}
        </div>
      </div>
    </article>`;
  }

  /* ---------- добавление продуктов ---------- */
  function renderProdSuggest(q) {
    const box = byId('prodSuggest'); if (!box) return;
    q = (q || '').trim().toLowerCase();
    if (!q) { box.hidden = true; box.innerHTML = ''; return; }
    const matches = allProducts().filter(p => p.n.toLowerCase().indexOf(q) !== -1).slice(0, 8);
    box.innerHTML = matches.length
      ? matches.map(p => `<div class="suggest__item prod-sg" data-name="${esc(p.n)}">
          <span>${esc(p.n)}</span>
          <span class="muted">Ж${p.f} Б${p.p} У${p.c} · ${Math.round(kcalOf(p))} ккал</span></div>`).join('')
      : `<div class="suggest__item muted">нет совпадений — добавьте свой продукт ниже</div>`;
    box.hidden = false;
  }
  function addFromList() {
    const name = (byId('addName').value || '').trim();
    const grams = Math.max(1, +byId('addGrams').value || 0);
    if (!name) return;
    const p = findProduct(name);
    if (!p) { alert('Не нашли такой продукт. Откройте «Добавить свой продукт» и введите КБЖУ.'); return; }
    const id = currentRid(); const a = getAdds(id);
    a.push({ n: p.n, f: p.f, p: p.p, c: p.c, kc: (p.kc != null ? p.kc : null), grams });
    setAdds(id, a); render();
  }
  function addCustom() {
    const id = currentRid();
    const name = (byId('cName').value || '').trim();
    const grams = Math.max(1, +byId('addGrams').value || 0);
    const f = +byId('cF').value || 0, p = +byId('cP').value || 0, c = +byId('cC').value || 0;
    const kcRaw = byId('cKcal').value;
    const kc = (kcRaw !== '' && kcRaw != null) ? +kcRaw : null;
    if (!name) { alert('Введите название продукта.'); return; }
    if (f === 0 && p === 0 && c === 0 && !kc) { alert('Введите БЖУ (или калории) продукта на 100 г.'); return; }
    // сохранить в пользовательскую базу, если такого названия ещё нет
    const up = userProducts();
    const exists = up.some(x => x.n.toLowerCase() === name.toLowerCase())
                || K.products.some(x => x.n.toLowerCase() === name.toLowerCase());
    if (!exists) { up.push({ n: name, f, p, c, kc }); S.set('userProducts', up); }
    const a = getAdds(id); a.push({ n: name, f, p, c, kc, grams }); setAdds(id, a); render();
  }

  /* ---------- избранное ---------- */
  function viewFavorites() {
    const list = S.favorites().map(id => recipeById[id]).filter(Boolean);
    return `<section class="section"><h1>❤️ Избранное <span class="count">${list.length}</span></h1>
      ${grid(list, 'Здесь появятся блюда, которые вы отметите сердечком.')}</section>`;
  }

  /* ---------- список покупок ---------- */
  function viewShopping() {
    const ids = S.shopping();
    const set = S.settings();
    const recs = ids.map(id => recipeById[id]).filter(Boolean);
    if (!recs.length) return `<section class="section"><h1>🛒 Список покупок</h1>
      <p class="empty">Добавляйте блюда в список покупок — продукты сложатся вместе с граммовкой под ваш вес.</p></section>`;

    const scaleOn = S.get('scaleOn', true);
    const agg = {};
    recs.forEach(r => {
      const k = scaleOn ? M.scaleFactor(r, set.proteinPerMeal) : 1;
      const ings = M.scaledIngredients(r, k);
      ings.forEach(i => {
        const name = i.name.split('/')[0].trim();
        agg[name] = (agg[name] || 0) + (i.grams || 0);
      });
    });
    const rows = Object.keys(agg).sort((a, b) => a.localeCompare(b, 'ru'))
      .map(n => `<li><label><input type="checkbox"> <span>${esc(n)}</span></label><span class="ing-g">${Math.round(agg[n])} г</span></li>`).join('');

    return `<section class="section">
      <h1>🛒 Список покупок <span class="count">${recs.length} блюд</span></h1>
      <p class="muted">${scaleOn ? `Граммовка пересчитана под ваш вес (${set.weight} кг).`
        : `Граммовка — как в рецептах. Включите «порцию под мой вес» на странице рецепта, чтобы пересчитать.`}</p>
      <ul class="shop-list">${rows}</ul>
      <h2>Блюда в списке</h2>
      <ul class="shop-recs">${recs.map(r => `<li><a href="#/recipe/${esc(r.slug)}">${esc(r.title)}</a>
        <button class="mini-x" data-shop="${r.id}">убрать</button></li>`).join('')}</ul>
      <button class="btn btn--ghost" id="clearShop">Очистить список</button>
    </section>`;
  }

  /* ---------- правила + счётчик ---------- */
  function viewRules() {
    const set = S.settings(), R = K.rules;
    const norms = M.proteinNorms(set.weight);
    const allowed = R.allowed.map(([grp, items]) =>
      `<details class="acc"><summary>${esc(grp)}</summary><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></details>`).join('');
    return `<section class="section">
      <h1>📋 Правила диеты</h1>

      <div class="rule-card calc">
        <h2>🧮 Счётчик нормы белка по весу</h2>
        <label>Ваш вес, кг <input type="number" id="ruleWeight" value="${set.weight}" min="40" max="200"></label>
        <div class="calc-out" id="calcOut">
          ${proteinCalcHtml(set.weight)}
        </div>
      </div>

      <div class="rule-card"><h2>${esc(R.principle.title)}</h2><p>${esc(R.principle.text)}</p>${macroBar({fat_pct:70,protein_pct:20,carb_pct:10})}</div>
      <div class="rule-card"><h2>${esc(R.protein.title)}</h2><p>${esc(R.protein.text)}</p></div>
      <div class="rule-card"><h2>${esc(R.water.title)}</h2><p>${esc(R.water.text)}</p></div>
      <div class="rule-card"><h2>${esc(R.sugar.title)}</h2><p>${esc(R.sugar.text)}</p></div>
      <div class="rule-card"><h2>${esc(R.cooking.title)}</h2><p>${esc(R.cooking.text)}</p></div>
      <div class="rule-card"><h2>${esc(R.habits.title)}</h2><p>${esc(R.habits.text)}</p></div>

      <div class="rule-card"><h2>✅ Что можно</h2>${allowed}
        <p class="muted criteria">${esc(R.compliance)}</p></div>
      <div class="rule-card forbidden"><h2>⛔ Что нельзя</h2><ul>${R.forbidden.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div>
    </section>`;
  }

  function proteinCalcHtml(weight) {
    const n = M.proteinNorms(weight);
    const set = S.settings();
    const water = M.waterNorm(weight);
    return `<p>Максимум: <b>${n.max} г</b> белка/день (1 г на кг). Минимум: <b>${n.min} г</b> (60%).</p>
      <p>Ваша цель сейчас: <b>${set.proteinPerDay} г/день</b> ≈ <b>${set.proteinPerMeal} г</b> на приём (при ${set.meals} приёмах).</p>
      <p>Норма воды: <b>${water} л</b> в сутки, равномерно в течение дня.</p>
      <p class="muted">Изменить вес и число приёмов можно кнопкой ⚖️ вверху — порции во всех рецептах пересчитаются.</p>`;
  }

  /* ---------- БАДы ---------- */
  function viewSupplements() {
    const Sp = K.supplements;
    const list = Sp.list.map(s => `<div class="sup"><div class="sup__name">${esc(s.name)}</div>
      <div class="sup__purpose">${esc(s.purpose)}</div><div class="sup__dose">${esc(s.dose)}</div></div>`).join('');
    const prot = Sp.protocols.map(p => `<div class="rule-card"><h2>${esc(p.name)}</h2>
      <ol>${p.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('');
    return `<section class="section">
      <h1>💊 БАДы и добавки</h1>
      <p class="muted">${esc(Sp.intro)}</p>
      <div class="sup-list">${list}</div>
      ${prot}
      <div class="rule-card warn-card"><p>⚠ ${esc(Sp.warning)}</p></div>
    </section>`;
  }

  /* ---------- роутинг ---------- */
  function render() {
    const hash = location.hash || '#/';
    const path = hash.slice(1).split('?')[0];
    const parts = path.split('/').filter(Boolean); // ['recipe','slug']
    window.scrollTo(0, 0);
    if (parts.length === 0) { app.innerHTML = viewHome(); bindHome(); }
    else if (parts[0] === 'builder') { app.innerHTML = viewBuilder(); bindBuilder(); }
    else if (parts[0] === 'categories') app.innerHTML = viewCategories();
    else if (parts[0] === 'category') app.innerHTML = viewCategory(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'source') app.innerHTML = viewSource(parts[1]);
    else if (parts[0] === 'recipe') app.innerHTML = viewRecipe(decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'favorites') app.innerHTML = viewFavorites();
    else if (parts[0] === 'shopping') app.innerHTML = viewShopping();
    else if (parts[0] === 'rules') app.innerHTML = viewRules();
    else if (parts[0] === 'supplements') app.innerHTML = viewSupplements();
    else app.innerHTML = viewHome();
    updateNav(parts[0] || '');
    updateBadges();
  }

  function updateNav(active) {
    document.querySelectorAll('.topnav a, .bottomnav a').forEach(a => {
      const h = a.getAttribute('href').slice(1).split('/').filter(Boolean)[0] || '';
      a.classList.toggle('active', h === active);
    });
    // «Поиск» (лупа) активна на главной и в конструкторе
    const sActive = active === '' || active === 'builder';
    const tb = byId('topSearchBtn'); if (tb) tb.classList.toggle('active', sActive);
    const bb = byId('botSearchBtn'); if (bb) bb.classList.toggle('active', sActive);
  }
  function updateBadges() {
    const f = S.favorites().length, s = S.shopping().length;
    document.querySelectorAll('[data-badge="fav"]').forEach(e => { e.textContent = f || ''; e.style.display = f ? '' : 'none'; });
    document.querySelectorAll('[data-badge="shop"]').forEach(e => { e.textContent = s || ''; e.style.display = s ? '' : 'none'; });
  }

  /* ---------- делегирование событий ---------- */
  app.addEventListener('click', e => {
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) { e.preventDefault(); S.toggleFav(+favBtn.dataset.fav); render(); return; }
    const shopBtn = e.target.closest('[data-shop]');
    if (shopBtn) { e.preventDefault(); S.toggleShop(+shopBtn.dataset.shop); render(); return; }
    const chip = e.target.closest('[data-ing]');
    if (chip) {
      e.preventDefault();
      const t = chip.dataset.ing;
      selected.has(t) ? removeIng(t) : addIng(t);
      return;
    }
    const bchip = e.target.closest('[data-bing]');
    if (bchip) { e.preventDefault(); const t = bchip.dataset.bing; builderSel.has(t) ? removeBuilder(t) : addBuilder(t); return; }
    if (e.target.id === 'bClear') { builderSel.clear(); S.set('builderProducts', []); rerenderBuilder(); return; }
    if (e.target.id === 'clearSel') { selected.clear(); S.set('searchIngredients', []); rerenderHome(); return; }
    if (e.target.id === 'clearShop') { S.clearShop(); render(); return; }
    if (e.target.id === 'openSettings2') { openSettings(); return; }
    if (e.target.id === 'addToggle') { const f = byId('addForm'); if (f) f.hidden = !f.hidden; return; }
    const sg = e.target.closest('.prod-sg');
    if (sg) { const inp = byId('addName'); if (inp) inp.value = sg.dataset.name; const s = byId('prodSuggest'); if (s) s.hidden = true; return; }
    if (e.target.id === 'addConfirm') { addFromList(); return; }
    if (e.target.id === 'addCustom') { addCustom(); return; }
    if (e.target.id === 'clearAdds') { setAdds(currentRid(), []); render(); return; }
    const rm = e.target.closest('[data-rmadd]');
    if (rm) { const id = currentRid(); const a = getAdds(id); a.splice(+rm.dataset.rmadd, 1); setAdds(id, a); render(); return; }
  });

  // живой пересчёт при движении бегунка белка (и плавно на телефоне)
  function updateSlider(sl) {
    const r = recipeById[+sl.dataset.rid];
    const val = +sl.value;
    setTxt('psVal', val + ' г');
    const adds = getAdds(r.id);
    let baseM;
    if (adds.length && S.get('rebalanceOn', true)) {
      const gx = rebalance(r, adds, val, ratioOf(r));
      baseM = baseMacros(r.ingredients.map((i, idx) => ({ key: i.key, grams: gx[idx] })));
      document.querySelectorAll('#app .ing-list li[data-base]').forEach((li, idx) => {
        const g = li.querySelector('.g-now'); if (g && gx[idx] != null) g.textContent = gx[idx];
      });
    } else {
      const base = +sl.dataset.base, k = base > 0 ? val / base : 1;
      document.querySelectorAll('#app .ing-list li[data-base]').forEach(li => {
        const g = li.querySelector('.g-now'); if (g) g.textContent = Math.round((+li.dataset.base) * k);
      });
      baseM = M.scaledMacros(r, k);
    }
    const t = totalsWith(baseM, adds);
    setTxt('mKcal', t.kcal); setTxt('mFat', t.fat_g + ' г');
    setTxt('mProt', t.protein_g + ' г'); setTxt('mCarb', t.carb_g + ' г');
    const bf = byId('rBarF'), bp = byId('rBarP'), bc = byId('rBarC');
    if (bf) { bf.style.width = t.fat_pct + '%'; bp.style.width = t.protein_pct + '%'; bc.style.width = t.carb_pct + '%'; }
    setTxt('rmlF', 'Ж ' + t.fat_pct + '%'); setTxt('rmlP', 'Б ' + t.protein_pct + '%'); setTxt('rmlC', 'У ' + t.carb_pct + '%');
    setTxt('psLive', `🔥 ${t.kcal} ккал · Ж ${t.fat_g} · Б ${t.protein_g} · У ${t.carb_g} г`);
  }

  // бегунок белка в конструкторе: масштабируем граммовки и БЖУ (проценты не меняются)
  function updateBuilderSlider(sl) {
    const base = +sl.dataset.base, val = +sl.value, k = base > 0 ? val / base : 1;
    setTxt('bpsVal', val + ' г');
    document.querySelectorAll('#app .builder-ings li[data-bg]').forEach(li => {
      const g = li.querySelector('.g-now'); if (g) g.textContent = Math.round((+li.dataset.bg) * k);
    });
    const kcal = Math.round(+sl.dataset.kcal * k), fat = Math.round(+sl.dataset.fat * k), carb = Math.round(+sl.dataset.carb * k);
    setTxt('bmKcal', kcal); setTxt('bmFat', fat + ' г'); setTxt('bmProt', val + ' г'); setTxt('bmCarb', carb + ' г');
    setTxt('bpsLive', `🔥 ${kcal} ккал · Ж ${fat} · Б ${val} · У ${carb} г`);
  }

  app.addEventListener('input', e => {
    if (e.target.id === 'proteinSlider') updateSlider(e.target);
    if (e.target.id === 'bProteinSlider') updateBuilderSlider(e.target);
    if (e.target.id === 'addName') renderProdSuggest(e.target.value);
    if (e.target.id === 'ruleWeight') {
      const w = Math.max(40, Math.min(200, +e.target.value || 95));
      byId('calcOut').innerHTML = proteinCalcHtml(w);
    }
  });

  app.addEventListener('change', e => {
    if (e.target.id === 'rebalanceToggle') { S.set('rebalanceOn', e.target.checked); render(); }
  });

  /* ---------- настройки (вес/приёмы/белок) ---------- */
  function openSettings() {
    const set = S.settings(); const n = M.proteinNorms(set.weight);
    byId('setWeight').value = set.weight;
    byId('setMeals').value = set.meals;
    const slider = byId('setProtein');
    slider.min = n.min; slider.max = n.max; slider.value = set.proteinPerDay;
    byId('proteinOut').textContent = set.proteinPerDay + ' г/день';
    byId('proteinRange').textContent = `(${n.min}–${n.max} г)`;
    byId('settingsDrawer').hidden = false;
  }
  function closeSettings() { byId('settingsDrawer').hidden = true; }

  byId('settingsBtn').addEventListener('click', openSettings);
  byId('settingsClose').addEventListener('click', () => {
    const weight = Math.max(40, Math.min(200, +byId('setWeight').value || 95));
    const meals = +byId('setMeals').value || 2;
    const proteinPerDay = +byId('setProtein').value || Math.round(weight * 0.82);
    S.saveSettings({ weight, meals, proteinPerDay });
    byId('wLabel').textContent = weight + ' кг';
    closeSettings(); render();
  });
  byId('settingsDrawer').addEventListener('click', e => { if (e.target.id === 'settingsDrawer') closeSettings(); });
  byId('setWeight').addEventListener('input', () => {
    const w = Math.max(40, Math.min(200, +byId('setWeight').value || 95));
    const n = M.proteinNorms(w); const sl = byId('setProtein');
    sl.min = n.min; sl.max = n.max; sl.value = n.def;
    byId('proteinOut').textContent = n.def + ' г/день'; byId('proteinRange').textContent = `(${n.min}–${n.max} г)`;
  });
  byId('setProtein').addEventListener('input', () => { byId('proteinOut').textContent = byId('setProtein').value + ' г/день'; });
  byId('setMeals').addEventListener('change', () => {});

  /* ---------- выпадающее меню «Поиск»: готовые рецепты / конструктор ---------- */
  (function () {
    const tBtn = byId('topSearchBtn'), tMenu = byId('topSearchMenu');
    const bBtn = byId('botSearchBtn'), sheet = byId('searchSheet');
    const closeAll = () => { if (tMenu) tMenu.hidden = true; if (sheet) sheet.hidden = true; };
    if (tBtn && tMenu) tBtn.addEventListener('click', e => { e.stopPropagation(); const open = !tMenu.hidden; closeAll(); tMenu.hidden = open; });
    if (bBtn && sheet) bBtn.addEventListener('click', e => { e.stopPropagation(); const open = !sheet.hidden; closeAll(); sheet.hidden = open; });
    document.addEventListener('click', closeAll);
    window.addEventListener('hashchange', closeAll);
  })();

  /* ---------- старт ---------- */
  byId('wLabel').textContent = S.settings().weight + ' кг';
  window.addEventListener('hashchange', render);
  render();
})();
