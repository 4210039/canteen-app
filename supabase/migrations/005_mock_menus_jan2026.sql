-- ═══════════════════════════════════════════════════════════
-- Mock data: 4 weekly menus for January 2026 (for testing)
-- Weeks 2026-W02 (Jan 5–9), W03 (Jan 12–16),
--        2026-W04 (Jan 19–23), W05 (Jan 26–30)
--
-- Week keys use the same formula as the frontend getWeekKey():
--   week = Math.ceil(((dayOfYear) + jan1.getDay() + 1) / 7)
-- Jan 1, 2026 is Thursday (getDay()=4), giving:
--   W01 = Jan 1–4,  W02 = Jan 5–11,  W03 = Jan 12–18,
--   W04 = Jan 19–25, W05 = Jan 26–31
-- ═══════════════════════════════════════════════════════════

insert into menus (org_id, week_key, fetched_at, raw_text, days_json, ingredients)
values

-- ── Week 2026-W02 — 5.–9. ledna 2026 ─────────────────────
(
  '00000000-0000-0000-0000-000000000001',
  '2026-W02',
  '2026-01-05 07:00:00+01',
  'Jídelníček MŠ Harmonie – týden 5.–9. 1. 2026',
  '[
    {
      "name": "Pondělí",
      "date": "5.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s máslem, mléko"},
        {"label": "Oběd",        "dish": "Hovězí vývar s nudlemi, vepřová pečeně se zelím a bramborovým knedlíkem"},
        {"label": "Svačina",     "dish": "Jablko, kakao"}
      ]
    },
    {
      "name": "Úterý",
      "date": "6.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Rohlík se sýrem, čaj"},
        {"label": "Oběd",        "dish": "Rajská polévka, kuřecí řízek obalovaný s bramborovým salátem"},
        {"label": "Svačina",     "dish": "Banán, mléko"}
      ]
    },
    {
      "name": "Středa",
      "date": "7.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Houska s medem, kakao"},
        {"label": "Oběd",        "dish": "Zeleninový krém, svíčková na smetaně s houskovým knedlíkem"},
        {"label": "Svačina",     "dish": "Pomeranč, čaj"}
      ]
    },
    {
      "name": "Čtvrtek",
      "date": "8.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Toustový chléb s marmeládou, mléko"},
        {"label": "Oběd",        "dish": "Bramborová polévka, losos s bramborem a zeleninovým salátem"},
        {"label": "Svačina",     "dish": "Bílý jogurt, piškoty"}
      ]
    },
    {
      "name": "Pátek",
      "date": "9.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Žitný chléb s pomazánkovým máslem, čaj"},
        {"label": "Oběd",        "dish": "Česnečka, těstoviny s rajčatovou omáčkou a strouhaným sýrem"},
        {"label": "Svačina",     "dish": "Mandarinka, mléko"}
      ]
    }
  ]'::jsonb,
  '["Celozrnný chléb s máslem, mléko","Hovězí vývar s nudlemi, vepřová pečeně se zelím a bramborovým knedlíkem","Jablko, kakao","Rohlík se sýrem, čaj","Rajská polévka, kuřecí řízek obalovaný s bramborovým salátem","Banán, mléko","Houska s medem, kakao","Zeleninový krém, svíčková na smetaně s houskovým knedlíkem","Pomeranč, čaj","Toustový chléb s marmeládou, mléko","Bramborová polévka, losos s bramborem a zeleninovým salátem","Bílý jogurt, piškoty","Žitný chléb s pomazánkovým máslem, čaj","Těstoviny s rajčatovou omáčkou a strouhaným sýrem","Mandarinka, mléko"]'::jsonb
),

-- ── Week 2026-W03 — 12.–16. ledna 2026 ───────────────────
(
  '00000000-0000-0000-0000-000000000001',
  '2026-W03',
  '2026-01-12 07:00:00+01',
  'Jídelníček MŠ Harmonie – týden 12.–16. 1. 2026',
  '[
    {
      "name": "Pondělí",
      "date": "12.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Chléb s máslem a medem, mléko"},
        {"label": "Oběd",        "dish": "Slepičí vývar s játrovými knedlíčky, kuřecí stehno na paprice s rýží"},
        {"label": "Svačina",     "dish": "Hruška, kakao"}
      ]
    },
    {
      "name": "Úterý",
      "date": "13.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Rohlík s pomazánkovým máslem, čaj"},
        {"label": "Oběd",        "dish": "Gulášová polévka, hovězí guláš s houskovým knedlíkem"},
        {"label": "Svačina",     "dish": "Kefír, oplatky"}
      ]
    },
    {
      "name": "Středa",
      "date": "14.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s tvarohem a pažitkou, mléko"},
        {"label": "Oběd",        "dish": "Brokolicový krém, dušené kuřecí prso s brokolicí a bramborovým přilepem"},
        {"label": "Svačina",     "dish": "Jablko, čaj"}
      ]
    },
    {
      "name": "Čtvrtek",
      "date": "15.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Toustový chléb s marmeládou, kakao"},
        {"label": "Oběd",        "dish": "Polévka z červené čočky, rybí filé s bramborem a zeleninovým salátem"},
        {"label": "Svačina",     "dish": "Banán, mléko"}
      ]
    },
    {
      "name": "Pátek",
      "date": "16.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Žitný chléb se šunkou, čaj"},
        {"label": "Oběd",        "dish": "Špenátová polévka, buchtičky se šodó"},
        {"label": "Svačina",     "dish": "Pomeranč, mléko"}
      ]
    }
  ]'::jsonb,
  '["Chléb s máslem a medem, mléko","Slepičí vývar s játrovými knedlíčky, kuřecí stehno na paprice s rýží","Hruška, kakao","Rohlík s pomazánkovým máslem, čaj","Gulášová polévka, hovězí guláš s houskovým knedlíkem","Kefír, oplatky","Celozrnný chléb s tvarohem a pažitkou, mléko","Brokolicový krém, dušené kuřecí prso s brokolicí a bramborovým přilepem","Jablko, čaj","Toustový chléb s marmeládou, kakao","Polévka z červené čočky, rybí filé s bramborem a zeleninovým salátem","Banán, mléko","Žitný chléb se šunkou, čaj","Špenátová polévka, buchtičky se šodó","Pomeranč, mléko"]'::jsonb
),

-- ── Week 2026-W04 — 19.–23. ledna 2026 ───────────────────
(
  '00000000-0000-0000-0000-000000000001',
  '2026-W04',
  '2026-01-19 07:00:00+01',
  'Jídelníček MŠ Harmonie – týden 19.–23. 1. 2026',
  '[
    {
      "name": "Pondělí",
      "date": "19.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s máslem, mléko"},
        {"label": "Oběd",        "dish": "Hovězí vývar s celestýnskými nudlemi, vepřová pečeně se svíčkovou omáčkou a houskovým knedlíkem"},
        {"label": "Svačina",     "dish": "Mandarinka, kakao"}
      ]
    },
    {
      "name": "Úterý",
      "date": "20.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Rohlík s tvarohem, čaj"},
        {"label": "Oběd",        "dish": "Fazolová polévka, kuřecí stehno s dušenou mrkví a rýží"},
        {"label": "Svačina",     "dish": "Jablko, mléko"}
      ]
    },
    {
      "name": "Středa",
      "date": "21.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Houska s medem, mléko"},
        {"label": "Oběd",        "dish": "Krémová rajčatová polévka, těstoviny s boloňskou omáčkou a sýrem"},
        {"label": "Svačina",     "dish": "Sušenky, čaj"}
      ]
    },
    {
      "name": "Čtvrtek",
      "date": "22.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s máslem a džemem, kakao"},
        {"label": "Oběd",        "dish": "Zeleninová polévka s masovými knedlíčky, kuřecí závitek s bramborovou kaší"},
        {"label": "Svačina",     "dish": "Hruška, bílý jogurt"}
      ]
    },
    {
      "name": "Pátek",
      "date": "23.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Toustový chléb se sýrem, čaj"},
        {"label": "Oběd",        "dish": "Čočková polévka, palačinky s tvarohem a lesním ovocem"},
        {"label": "Svačina",     "dish": "Banán, mléko"}
      ]
    }
  ]'::jsonb,
  '["Celozrnný chléb s máslem, mléko","Hovězí vývar s celestýnskými nudlemi, vepřová pečeně se svíčkovou omáčkou","Mandarinka, kakao","Rohlík s tvarohem, čaj","Fazolová polévka, kuřecí stehno s dušenou mrkví a rýží","Jablko, mléko","Houska s medem, mléko","Těstoviny s boloňskou omáčkou a sýrem","Sušenky, čaj","Celozrnný chléb s máslem a džemem, kakao","Zeleninová polévka, kuřecí závitek s bramborovou kaší","Hruška, bílý jogurt","Toustový chléb se sýrem, čaj","Čočková polévka, palačinky s tvarohem a lesním ovocem","Banán, mléko"]'::jsonb
),

-- ── Week 2026-W05 — 26.–30. ledna 2026 ───────────────────
(
  '00000000-0000-0000-0000-000000000001',
  '2026-W05',
  '2026-01-26 07:00:00+01',
  'Jídelníček MŠ Harmonie – týden 26.–30. 1. 2026',
  '[
    {
      "name": "Pondělí",
      "date": "26.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s pomazánkovým máslem, mléko"},
        {"label": "Oběd",        "dish": "Vývar s masovými knedlíčky, vepřový guláš s houskovým knedlíkem"},
        {"label": "Svačina",     "dish": "Pomeranč, kakao"}
      ]
    },
    {
      "name": "Úterý",
      "date": "27.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Rohlík s máslem, čaj"},
        {"label": "Oběd",        "dish": "Špenátová polévka, kuřecí řízek přírodní s bramborovým salátem"},
        {"label": "Svačina",     "dish": "Mandarinka, mléko"}
      ]
    },
    {
      "name": "Středa",
      "date": "28.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Chléb se sýrem, mléko"},
        {"label": "Oběd",        "dish": "Kapustová polévka, svíčková na smetaně s houskovým knedlíkem"},
        {"label": "Svačina",     "dish": "Jablko, čaj"}
      ]
    },
    {
      "name": "Čtvrtek",
      "date": "29.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Toustový chléb s marmeládou, kakao"},
        {"label": "Oběd",        "dish": "Pórková polévka, rybí tyčinky s bramborovou kaší a okurkovým salátem"},
        {"label": "Svačina",     "dish": "Bílý jogurt, sušenky"}
      ]
    },
    {
      "name": "Pátek",
      "date": "30.1.",
      "meals": [
        {"label": "Přesnídávka", "dish": "Celozrnný chléb s tvarohem, čaj"},
        {"label": "Oběd",        "dish": "Rajská polévka, smažené sýrové kuličky se šťouchanými bramborami"},
        {"label": "Svačina",     "dish": "Banán, mléko"}
      ]
    }
  ]'::jsonb,
  '["Celozrnný chléb s pomazánkovým máslem, mléko","Vývar s masovými knedlíčky, vepřový guláš s houskovým knedlíkem","Pomeranč, kakao","Rohlík s máslem, čaj","Špenátová polévka, kuřecí řízek přírodní s bramborovým salátem","Mandarinka, mléko","Chléb se sýrem, mléko","Kapustová polévka, svíčková na smetaně s houskovým knedlíkem","Jablko, čaj","Toustový chléb s marmeládou, kakao","Pórková polévka, rybí tyčinky s bramborovou kaší a okurkovým salátem","Bílý jogurt, sušenky","Celozrnný chléb s tvarohem, čaj","Rajská polévka, smažené sýrové kuličky se šťouchanými bramborami","Banán, mléko"]'::jsonb
)

on conflict (org_id, week_key) do nothing;
