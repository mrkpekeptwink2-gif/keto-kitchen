/* Расчёт БЖУ и масштабирование порций под вес (зеркалит build/nutrition.py). */
(function () {
  const K = window.KETO;
  const KCAL = { f: 9, p: 4, c: 4 };

  // Норма белка по весу: макс 1 г/кг, мин 60%. Цель по умолчанию ~0.82 г/кг (≈78 г при 95 кг).
  function proteinNorms(weight) {
    return {
      max: Math.round(weight * 1.0),
      min: Math.round(weight * 0.6),
      def: Math.round(weight * 0.82),
    };
  }

  // Норма воды по весу (л/сутки) — текстом из правил.
  function waterNorm(weight) {
    for (const b of K.rules.water.bands) if (weight <= b.maxKg) return b.liters;
    return '3–3,5';
  }

  // Масштабировать порцию? Десерты и лакомства — нет (их не подгоняют под норму белка).
  function isScalable(recipe) {
    if (recipe.category === 'Десерты и смузи' || recipe.goal === 'treat') return false;
    return (recipe.macros.protein_g || 0) > 3;
  }

  // Коэффициент масштабирования под целевой ОБЩИЙ белок на приём (норма 1 г/кг — это общий белок).
  function scaleFactor(recipe, proteinPerMeal) {
    if (!isScalable(recipe)) return 1;
    let k = proteinPerMeal / recipe.macros.protein_g;
    return Math.max(0.4, Math.min(2.5, k));
  }

  function scaledIngredients(recipe, k) {
    return recipe.ingredients.map(i => {
      const g = Math.round((i.grams || 0) * k);
      return Object.assign({}, i, { grams: g });
    });
  }

  // Пересчёт БЖУ при масштабе k. Проценты не меняются, граммы и ккал — масштабируются.
  function scaledMacros(recipe, k) {
    const m = recipe.macros;
    return {
      fat_g: Math.round(m.fat_g * k),
      protein_g: Math.round(m.protein_g * k),
      carb_g: Math.round(m.carb_g * k),
      kcal: Math.round(m.kcal * k),
      fat_pct: m.fat_pct, protein_pct: m.protein_pct, carb_pct: m.carb_pct,
      protein_main_g: Math.round((m.protein_main_g || 0) * k),
    };
  }

  // Попадание в норму БЖУ (для значка соответствия).
  function inBand(m) {
    return m.fat_pct >= 68 && m.fat_pct <= 78 &&
           m.protein_pct >= 17 && m.protein_pct <= 26 &&
           m.carb_pct >= 4 && m.carb_pct <= 11;
  }

  window.Macros = { proteinNorms, waterNorm, scaleFactor, scaledIngredients, scaledMacros, inBand, isScalable };
})();
