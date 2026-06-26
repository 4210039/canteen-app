/**
 * Czech Government Nutrition Norms for School Canteens
 * Source: Vyhláška č. 107/2005 Sb., ve znění Vyhlášky č. 310/2025 Sb.
 * Příloha č. 1 – Výživové normy pro školní stravování (běžná výživa)
 * Mandatory from 1. 9. 2026 (přechodné období 2025/2026).
 *
 * KEY CHANGES vs old 398/2016 version:
 *  – Values are now ABSOLUTE grams per age group per meal (not % of adult).
 *  – Zelenina + Ovoce → merged into one group "Zelenina, ovoce".
 *  – Tekuté mléko + Mléčné výrobky → merged into "Mléčné výrobky, mléko".
 *  – NEW group: Celozrnné obiloviny a pseudoobiloviny.
 *  – Cukry volné: maximum 100 % (not 125 %).
 *  – Tuky volné: maximum 100 % (not 125 %).
 *  – Ryby: no upper limit (minimum 75 % only).
 *  – Zelenina, ovoce: no upper limit.
 *  – Luštěniny: no upper limit.
 *  – Celozrnné: no upper limit.
 *
 * All values = čistá hmotnost (net weight, ready-to-cook).
 * Compliance evaluated as monthly average.
 */

window.NORMS = {

  // ── Age groups ─────────────────────────────────────────────
  // pct kept for backward compatibility with any code that reads it,
  // but all gram targets now come from the mealValues table below.
  ageGroups: {
    'ms_2_3':   { label: '2–3 roky (MŠ)',      pct: 0.40 },
    'ms_3_6':   { label: '3–6 let (MŠ)',        pct: 0.60 },
    'zs_7_10':  { label: '7–10 let (ZŠ)',        pct: 0.70 },
    'zs_11_14': { label: '11–14 let (ZŠ)',       pct: 0.80 },
    'adult':    { label: '15+ let / dospělí',    pct: 1.00 },
  },

  // ── Food groups (new structure per 310/2025) ───────────────
  // min/max are tolerance ratios (1.0 = 100 %).
  // null max = no upper limit defined by regulation.
  foodGroups: {
    maso:            { label: 'Maso',                                    unit: 'g', min: 0.75, max: 1.25, color: '#E53935' },
    ryby:            { label: 'Ryby, korýši, měkkýši',                   unit: 'g', min: 0.75, max: null, color: '#1E88E5' },
    mlecneVyrobky:   { label: 'Mléčné výrobky, mléko',                   unit: 'g', min: 0.75, max: 1.25, color: '#FDD835' },
    tuk:             { label: 'Tuky volné',                               unit: 'g', min: 0.75, max: 1.00, color: '#FB8C00' },
    cukr:            { label: 'Cukry volné',                              unit: 'g', min: 0.00, max: 1.00, color: '#8E24AA' },
    zeleninaOvoce:   { label: 'Zelenina, ovoce',                          unit: 'g', min: 0.75, max: null, color: '#43A047' },
    brambory:        { label: 'Brambory a ostatní hlízy',                 unit: 'g', min: 0.75, max: 1.25, color: '#6D4C41' },
    celozrnne:       { label: 'Celozrnné obiloviny a pseudoobiloviny',    unit: 'g', min: 0.75, max: null, color: '#78909C' },
    lustaniny:       { label: 'Luštěniny',                                unit: 'g', min: 0.75, max: null, color: '#3949AB' },
  },

  // ── Absolute gram values per strávník per meal per age group ─
  // Source: Tabulka č. 1, Příloha č. 1, Vyhláška 310/2025 Sb.
  // Keys match foodGroups above.
  // Meal keys: snidane, presnidavka, obed, svacina, vecere,
  //            presnidavka_obed_svacina (= MŠ 3-meal day),
  //            celodenni
  mealValues: {
    'ms_2_3': {
      snidane:                  { maso:5,  ryby:0,  mlecneVyrobky:98,  tuk:3, cukr:3, zeleninaOvoce:48,  brambory:0,  celozrnne:5,  lustaniny:0  },
      presnidavka:              { maso:3,  ryby:2,  mlecneVyrobky:59,  tuk:3, cukr:2, zeleninaOvoce:40,  brambory:0,  celozrnne:4,  lustaniny:1  },
      obed:                     { maso:26, ryby:6,  mlecneVyrobky:44,  tuk:7, cukr:6, zeleninaOvoce:94,  brambory:53, celozrnne:11, lustaniny:7  },
      svacina:                  { maso:3,  ryby:2,  mlecneVyrobky:30,  tuk:2, cukr:1, zeleninaOvoce:27,  brambory:0,  celozrnne:3,  lustaniny:1  },
      vecere:                   { maso:15, ryby:3,  mlecneVyrobky:65,  tuk:4, cukr:4, zeleninaOvoce:58,  brambory:43, celozrnne:6,  lustaniny:4  },
      presnidavka_obed_svacina: { maso:32, ryby:10, mlecneVyrobky:133, tuk:12,cukr:9, zeleninaOvoce:161, brambory:53, celozrnne:18, lustaniny:9  },
      celodenni:                { maso:52, ryby:13, mlecneVyrobky:296, tuk:19,cukr:16,zeleninaOvoce:267, brambory:96, celozrnne:29, lustaniny:13 },
    },
    'ms_3_6': {
      snidane:                  { maso:8,  ryby:0,  mlecneVyrobky:147, tuk:5, cukr:5, zeleninaOvoce:72,  brambory:0,  celozrnne:8,  lustaniny:0  },
      presnidavka:              { maso:4,  ryby:3,  mlecneVyrobky:89,  tuk:4, cukr:4, zeleninaOvoce:60,  brambory:0,  celozrnne:7,  lustaniny:2  },
      obed:                     { maso:39, ryby:9,  mlecneVyrobky:67,  tuk:10,cukr:8, zeleninaOvoce:140, brambory:79, celozrnne:14, lustaniny:9  },
      svacina:                  { maso:4,  ryby:2,  mlecneVyrobky:44,  tuk:4, cukr:2, zeleninaOvoce:41,  brambory:0,  celozrnne:4,  lustaniny:2  },
      vecere:                   { maso:23, ryby:5,  mlecneVyrobky:98,  tuk:6, cukr:5, zeleninaOvoce:87,  brambory:65, celozrnne:10, lustaniny:6  },
      presnidavka_obed_svacina: { maso:47, ryby:14, mlecneVyrobky:200, tuk:18,cukr:14,zeleninaOvoce:241, brambory:79, celozrnne:25, lustaniny:13 },
      celodenni:                { maso:78, ryby:19, mlecneVyrobky:445, tuk:29,cukr:24,zeleninaOvoce:400, brambory:144,celozrnne:43, lustaniny:19 },
    },
    'zs_7_10': {
      snidane:                  { maso:8,  ryby:0,  mlecneVyrobky:171, tuk:6, cukr:5, zeleninaOvoce:84,  brambory:0,  celozrnne:9,  lustaniny:0  },
      presnidavka:              { maso:5,  ryby:3,  mlecneVyrobky:104, tuk:5, cukr:4, zeleninaOvoce:69,  brambory:0,  celozrnne:8,  lustaniny:2  },
      obed:                     { maso:46, ryby:11, mlecneVyrobky:78,  tuk:12,cukr:10,zeleninaOvoce:162, brambory:92, celozrnne:17, lustaniny:11 },
      svacina:                  { maso:5,  ryby:2,  mlecneVyrobky:52,  tuk:4, cukr:3, zeleninaOvoce:48,  brambory:0,  celozrnne:5,  lustaniny:2  },
      vecere:                   { maso:27, ryby:6,  mlecneVyrobky:114, tuk:7, cukr:6, zeleninaOvoce:102, brambory:76, celozrnne:11, lustaniny:7  },
      presnidavka_obed_svacina: { maso:56, ryby:16, mlecneVyrobky:234, tuk:21,cukr:17,zeleninaOvoce:279, brambory:92, celozrnne:30, lustaniny:15 },
      celodenni:                { maso:91, ryby:22, mlecneVyrobky:519, tuk:34,cukr:28,zeleninaOvoce:465, brambory:168,celozrnne:50, lustaniny:22 },
    },
    'zs_11_14': {
      snidane:                  { maso:10, ryby:0,  mlecneVyrobky:196, tuk:7, cukr:6, zeleninaOvoce:96,  brambory:0,  celozrnne:10, lustaniny:0  },
      presnidavka:              { maso:6,  ryby:4,  mlecneVyrobky:119, tuk:6, cukr:5, zeleninaOvoce:80,  brambory:0,  celozrnne:9,  lustaniny:2  },
      obed:                     { maso:52, ryby:13, mlecneVyrobky:89,  tuk:13,cukr:11,zeleninaOvoce:187, brambory:106,celozrnne:20, lustaniny:13 },
      svacina:                  { maso:6,  ryby:3,  mlecneVyrobky:59,  tuk:4, cukr:3, zeleninaOvoce:54,  brambory:0,  celozrnne:6,  lustaniny:2  },
      vecere:                   { maso:30, ryby:6,  mlecneVyrobky:130, tuk:8, cukr:7, zeleninaOvoce:117, brambory:86, celozrnne:13, lustaniny:9  },
      presnidavka_obed_svacina: { maso:64, ryby:20, mlecneVyrobky:267, tuk:23,cukr:19,zeleninaOvoce:321, brambory:106,celozrnne:35, lustaniny:17 },
      celodenni:                { maso:104,ryby:26, mlecneVyrobky:593, tuk:38,cukr:32,zeleninaOvoce:534, brambory:192,celozrnne:58, lustaniny:26 },
    },
    'adult': {
      snidane:                  { maso:12, ryby:0,  mlecneVyrobky:245, tuk:9, cukr:7, zeleninaOvoce:120, brambory:0,  celozrnne:13, lustaniny:0  },
      presnidavka:              { maso:7,  ryby:5,  mlecneVyrobky:148, tuk:6, cukr:6, zeleninaOvoce:100, brambory:0,  celozrnne:11, lustaniny:3  },
      obed:                     { maso:65, ryby:16, mlecneVyrobky:111, tuk:17,cukr:14,zeleninaOvoce:233, brambory:132,celozrnne:25, lustaniny:15 },
      svacina:                  { maso:7,  ryby:3,  mlecneVyrobky:74,  tuk:5, cukr:4, zeleninaOvoce:67,  brambory:0,  celozrnne:7,  lustaniny:3  },
      vecere:                   { maso:39, ryby:8,  mlecneVyrobky:163, tuk:11,cukr:9, zeleninaOvoce:147, brambory:108,celozrnne:16, lustaniny:11 },
      presnidavka_obed_svacina: { maso:79, ryby:24, mlecneVyrobky:333, tuk:28,cukr:24,zeleninaOvoce:400, brambory:132,celozrnne:43, lustaniny:21 },
      celodenni:                { maso:130,ryby:32, mlecneVyrobky:741, tuk:48,cukr:40,zeleninaOvoce:667, brambory:240,celozrnne:72, lustaniny:32 },
    },
  },

  // MŠ default meal distribution (přesnídávka + oběd + svačina)
  // These are ONLY used for calcGrams() when ageGroup is ms_2_3 / ms_3_6
  // and the jídelna serves 3 meals; targets come directly from mealValues.
  mealSplit: {
    presnidavka: 0.20,
    obed:        0.65,
    svacina:     0.15,
  },

  // Frequency rules per 310/2025
  frequencyRules: [
    { group: 'ryby',          minPerMonth: 2,  label: 'Ryby, korýši, měkkýši min. 2× měsíčně' },
    { group: 'lustaniny',     minPerMonth: 4,  label: 'Luštěniny min. 4× měsíčně (1× týdně)' },
    { group: 'zeleninaOvoce', everyMeal: true, label: 'Zelenina nebo ovoce součástí každého jídla' },
  ],

  // ── Helpers ────────────────────────────────────────────────

  /**
   * Get the daily target for a food group, age group, and meal type.
   * Falls back to proportional split if meal not found.
   * @param {string} foodGroup  – key from foodGroups
   * @param {string} meal       – 'presnidavka'|'obed'|'svacina'|'celodenni'|…
   * @param {string} ageGroup   – key from ageGroups
   * @returns {number} grams (daily target per child)
   */
  getDailyTarget(foodGroup, meal, ageGroup) {
    const ageKey = this._mapAgeKey(ageGroup);
    const vals = this.mealValues[ageKey];
    if (!vals) return 0;

    // Map UI meal keys to table keys
    const mealMap = {
      presnidavka: 'presnidavka',
      obed:        'obed',
      svacina:     'svacina',
      snidane:     'snidane',
      vecere:      'vecere',
      celodenni:   'celodenni',
    };
    const tableKey = mealMap[meal];
    if (tableKey && vals[tableKey]) {
      return vals[tableKey][foodGroup] ?? 0;
    }
    // MŠ 3-meal day default
    return (vals['presnidavka_obed_svacina']?.[foodGroup]) ?? 0;
  },

  /**
   * Calculate required ingredient grams for a given meal/childCount.
   */
  calcGrams(foodGroup, meal, ageGroup, childCount) {
    return Math.round(this.getDailyTarget(foodGroup, meal, ageGroup) * childCount);
  },

  /**
   * Daily total across přesnídávka+oběd+svačina (MŠ 3-meal default)
   * or celodenni for full-day facilities.
   */
  calcDailyTotal(foodGroup, ageGroup, childCount, mealType) {
    const mt = mealType || 'presnidavka_obed_svacina';
    const ageKey = this._mapAgeKey(ageGroup);
    const val = this.mealValues[ageKey]?.[mt]?.[foodGroup] ?? 0;
    return Math.round(val * childCount);
  },

  /**
   * Validate monthly compliance for a food group.
   * @param {number} actualG   – actual grams/child/day (monthly avg)
   * @param {string} foodGroup – key from foodGroups
   * @param {string} ageGroup  – key from ageGroups
   * @param {string} mealType  – which meal row to use as target (default: presnidavka_obed_svacina)
   * @returns {{ ok, pct, status, target, actual }}
   */
  checkCompliance(actualG, foodGroup, ageGroup, mealType) {
    const group = this.foodGroups[foodGroup];
    if (!group) return { ok: true, pct: 100, status: 'ok', target: 0, actual: actualG };

    const mt = mealType || 'presnidavka_obed_svacina';
    const ageKey = this._mapAgeKey(ageGroup);
    const target = this.mealValues[ageKey]?.[mt]?.[foodGroup] ?? 0;

    if (target === 0) return { ok: true, pct: 100, status: 'ok', target: 0, actual: actualG };

    const pct = (actualG / target) * 100;
    const minPct = group.min * 100;
    const maxPct = group.max !== null ? group.max * 100 : Infinity;

    let status;
    if (pct < minPct) status = 'low';
    else if (pct > maxPct) status = 'high';
    else status = 'ok';

    return {
      ok: status === 'ok',
      pct: Math.round(pct),
      status,
      target,
      actual: actualG,
    };
  },

  // Map old/new age keys to mealValues keys
  _mapAgeKey(ageGroup) {
    const map = {
      'ms_2_3':   'ms_2_3',
      'ms_3_6':   'ms_3_6',
      'zs_7_10':  'zs_7_10',
      'zs_11_14': 'zs_11_14',
      'adult':    'adult',
    };
    return map[ageGroup] || 'ms_3_6';
  },
};
