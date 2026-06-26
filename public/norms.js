/**
 * Czech Government Nutrition Norms for School Canteens
 * Source: Vyhláška č. 107/2005 Sb., amended by 398/2016 Sb.
 * Tabulka 1 - Spotřební koš (Consumption Basket)
 * Values in grams per child per day (čistá hmotnost = net weight)
 * MŠ = Mateřská škola (Kindergarten), age 3-6 years = 60% of adult portion
 *
 * 8 food groups tracked:
 * 1. Maso (Meat)
 * 2. Ryby (Fish)
 * 3. Mléko a mléčné výrobky (Milk & dairy)
 * 4. Tuk volný (Free fat/oil)
 * 5. Cukr volný (Free sugar)
 * 6. Zelenina (Vegetables)
 * 7. Ovoce (Fruit)
 * 8. Brambory a ostatní hlízy (Potatoes)
 * 9. Luštěniny (Legumes)
 *
 * For MŠ (age 3-6): 3 meals/day = přesnídávka + oběd + svačina
 * Monthly average consumption per child per day
 */

window.NORMS = {
  // Age group: 3-6 years (MŠ Harmonie profile = ages 2-6)
  // Portions: 2-3 yrs = 40%, 4-6 yrs = 60% of adult
  // MŠ uses TOTAL of přesnídávka+oběd+svačina

  ageGroups: {
    'ms_2_3': { label: '2–3 roky (MŠ)', pct: 0.40 },
    'ms_3_6': { label: '3–6 let (MŠ)', pct: 0.60 },
    'zs_7_10': { label: '7–10 let (ZŠ)', pct: 0.70 },
    'zs_11_14': { label: '11–14 let (ZŠ)', pct: 0.80 },
    'adult': { label: '15+ let / dospělí', pct: 1.00 },
  },

  // Tabulka 1 - Daily values (g/child/day) for ADULT (100%)
  // MŠ uses SUM of přesnídávka+oběd+svačina per regulation (Příloha 1, bod 2)
  // Per meal split for MŠ: přesnídávka 20%, oběd 65%, svačina 15%
  //
  // Zelenina/Ovoce note: the official table lists these as two separate
  // columns (Zelenina, Ovoce), but this app previously tracked them as
  // one combined "Zelenina a ovoce" group at 250 g/adult/day. Splitting
  // it here keeps the same combined total (125 g + 125 g = 250 g) as a
  // working default — adjust adultDay below per food group if your own
  // jídelna's records call for a different vegetable/fruit split.
  foodGroups: {
    maso:       { label: 'Maso',                       unit: 'g', adultDay: 75,  min: 0.75, max: 1.25, color: '#E53935' },
    ryby:       { label: 'Ryby, korýši, měkkýši',      unit: 'g', adultDay: 10,  min: 0.75, max: 1.25, color: '#1E88E5' },
    mleko:      { label: 'Mléko a mléčné výrobky',     unit: 'g', adultDay: 250, min: 0.75, max: 1.25, color: '#FDD835' },
    tuk:        { label: 'Tuk volný',                  unit: 'g', adultDay: 20,  min: 0.75, max: 1.25, color: '#FB8C00' },
    cukr:       { label: 'Cukr volný',                 unit: 'g', adultDay: 20,  min: 0.75, max: 1.25, color: '#8E24AA' },
    zelenina:   { label: 'Zelenina',                   unit: 'g', adultDay: 125, min: 0.75, max: 1.25, color: '#43A047' },
    ovoce:      { label: 'Ovoce',                      unit: 'g', adultDay: 125, min: 0.75, max: 1.25, color: '#C0CA33' },
    brambory:   { label: 'Brambory a hlízy',            unit: 'g', adultDay: 150, min: 0.75, max: 1.25, color: '#6D4C41' },
    lustaniny:  { label: 'Luštěniny',                   unit: 'g', adultDay: 15,  min: 0.75, max: 1.25, color: '#3949AB' },
  },

  // MŠ meal split percentages (přesnídávka + oběd + svačina = 100%)
  mealSplit: {
    presnidavka: 0.20,
    obed:        0.65,
    svacina:     0.15,
  },

  // Frequency rules from the 12 regulatory points
  frequencyRules: [
    { group: 'ryby',      minPerMonth: 2,  label: 'Ryby min. 2× měsíčně' },
    { group: 'lustaniny', minPerMonth: 4,  label: 'Luštěniny min. 4× měsíčně (1× týdně)' },
    { group: 'zelenina',  everyMeal: true, label: 'Zelenina/ovoce součástí každého jídla' },
    { group: 'ovoce',     everyMeal: true, label: 'Zelenina/ovoce součástí každého jídla' },
  ],

  /**
   * Calculate required ingredient quantity for a meal
   * @param {string} foodGroup - key from foodGroups
   * @param {string} meal - 'presnidavka' | 'obed' | 'svacina'
   * @param {string} ageGroup - key from ageGroups
   * @param {number} childCount - number of children
   * @returns {number} grams needed
   */
  calcGrams(foodGroup, meal, ageGroup, childCount) {
    const group = this.foodGroups[foodGroup];
    const age = this.ageGroups[ageGroup] || this.ageGroups['ms_3_6'];
    const split = this.mealSplit[meal] || 0.65;
    if (!group) return 0;
    return Math.round(group.adultDay * age.pct * split * childCount);
  },

  /**
   * Calculate total daily requirement across all meals
   */
  calcDailyTotal(foodGroup, ageGroup, childCount) {
    const group = this.foodGroups[foodGroup];
    const age = this.ageGroups[ageGroup] || this.ageGroups['ms_3_6'];
    if (!group) return 0;
    return Math.round(group.adultDay * age.pct * childCount);
  },

  /**
   * Validate monthly compliance for a food group
   * @param {number} actualG - actual grams consumed per child per day (monthly avg)
   * @param {string} foodGroup
   * @param {string} ageGroup
   * @returns {{ ok: boolean, pct: number, status: 'ok'|'low'|'high' }}
   */
  checkCompliance(actualG, foodGroup, ageGroup) {
    const group = this.foodGroups[foodGroup];
    const age = this.ageGroups[ageGroup] || this.ageGroups['ms_3_6'];
    const target = group.adultDay * age.pct;
    const pct = target > 0 ? (actualG / target) * 100 : 100;
    return {
      ok: pct >= group.min * 100 && pct <= group.max * 100,
      pct: Math.round(pct),
      status: pct < group.min * 100 ? 'low' : pct > group.max * 100 ? 'high' : 'ok',
      target,
      actual: actualG,
    };
  },
};
