/*
  VARREDOR StatsHub — 20/20 (+ "quase": min 18/20) por jogo, nos 3 tempos, 4 mercados.
  Uso: node varredor_statshub.js --fixtures fx.json [--workers 4] [--ft-only] [--markets Gols,Escanteios,Cartões,Chutes_Gol]
       fx.json = [["Nome","substring-liga-minusculo","https://www.statshub.com/pt/fixture/.../ID"], ...]
  Saída: varredor.log  +  varredor_result.json  (no diretório atual)
*/
const { chromium } = require('C:/Users/micae/OneDrive/Desktop/Vs Code/sgf/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const OUT = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = path.join(OUT, 'varredor.log');
const log = s => { console.log(s); fs.appendFileSync(LOG, s + '\n'); };

let FIXTURES = [];
const argv = process.argv;
const fa = argv.indexOf('--fixtures'); if (fa > -1) FIXTURES = JSON.parse(fs.readFileSync(argv[fa + 1], 'utf8'));
const wa = argv.indexOf('--workers'); const WORKERS = wa > -1 ? +argv[wa + 1] : 4;
const FT_ONLY = argv.includes('--ft-only'); // só Tempo total (≈3x mais rápido)
const ma = argv.indexOf('--markets'); const MARKET_FILTER = ma > -1 ? argv[ma + 1].split(',') : null; // ex: --markets Cartões

const R = n => Array.from({ length: n }, (_, i) => i + 0.5);
const TEMPOS = ([
  ['Tempo total', /Tempo total|Full Time/i,    { Gols: [0.5,1.5,2.5,3.5,4.5,5.5], Escanteios: R(21), Cartões: R(11), Chutes_Gol: R(21) }],
  ['1º tempo',    /Primeiro tempo|First Half/i, { Gols: [0.5,1.5,2.5,3.5],         Escanteios: R(11), Cartões: R(6), Chutes_Gol: R(11) }],
  ['2º tempo',    /Segundo tempo|Second Half/i, { Gols: [0.5,1.5,2.5,3.5,4.5],     Escanteios: R(13), Cartões: R(7), Chutes_Gol: R(13) }],
]).slice(0, FT_ONLY ? 1 : 3);
const MARKETS = [['Goals', 'Gols'], ['Corners', 'Escanteios'], ['Cards', 'Cartões'], ['Shots On Target', 'Chutes_Gol']]
  .filter(([, pt]) => !MARKET_FILTER || MARKET_FILTER.includes(pt));
const TYPEMAP = { Total: 'Geral', For: 'A favor', Against: 'Contra' };
const W = 270; // wait base (ms)

async function convergeComps(page, wantSub) {
  await page.getByRole('button', { name: /Competicoes|Competições/i }).click();
  await sleep(900);
  const map = await page.$$eval('[role=switch]', els => els.map(e => {
    let t = ''; let n = e.parentElement;
    for (let i = 0; i < 4 && n; i++) { const x = (n.innerText || '').trim(); if (x) { t = x; break; } n = n.parentElement; }
    return { id: e.id, label: t.split('\n')[0].trim() };
  }));
  const comp = map.filter(m => m.id && m.id.startsWith('bet-comp-'));
  const keep = (comp.find(m => m.label.toLowerCase().includes(wantSub)) || {}).id || (comp[0] && comp[0].id);
  for (let it = 0; it < 18; it++) {
    const sws = await page.$$eval('[role=switch]', els => els.filter(e => e.id && e.id.startsWith('bet-comp-')).map(e => ({ id: e.id, ac: e.getAttribute('aria-checked') })));
    let acted = false;
    for (const s of sws) {
      const k = s.id === keep;
      if (k && s.ac !== 'true') { await page.locator(`[id="${s.id}"]`).click(); acted = true; await sleep(300); break; }
      if (!k && s.ac === 'true') { await page.locator(`[id="${s.id}"]`).click(); acted = true; await sleep(300); break; }
    }
    if (!acted) break;
  }
  await page.keyboard.press('Escape'); await sleep(300);
  await page.keyboard.press('Escape'); await sleep(900);
  return (comp.find(m => m.id === keep) || {}).label;
}
async function selectMarket(page, label) {
  for (let a = 0; a < 5; a++) {
    await page.getByRole('combobox').first().click(); await sleep(700);
    const opt = page.getByRole('option').filter({ hasText: label }).first();
    if (await opt.count()) { await opt.click(); await sleep(1300); return true; }
    await page.keyboard.press('Escape'); await sleep(400);
  }
  return false;
}
async function setTempo(page, re) {
  await page.getByRole('button', { name: /Tempo total|Full Time|Primeiro tempo|Segundo tempo|First Half|Second Half/i }).first().click();
  await sleep(600);
  await page.getByRole('option', { name: re }).first().click().catch(async () => { await page.getByText(re).last().click(); });
  await sleep(1100);
}
async function readCards(page) {
  return await page.evaluate(() => {
    const cards = [...document.querySelectorAll('div')].filter(e => {
      const t = e.textContent || '';
      return /Analysis Type/i.test(t) && /Taxa de acerto/i.test(t) && t.length < 1500;
    }).sort((a, b) => a.textContent.length - b.textContent.length);
    const picked = []; const seen = new Set();
    for (const c of cards) { const name = (c.innerText || '').split('\n')[0].trim(); if (!name || seen.has(name)) continue; seen.add(name); picked.push(c); if (picked.length === 2) break; }
    return picked.map(c => { const it = c.innerText || ''; const m = it.match(/(\d+)\s*de\s*(\d+)\s*partidas/i); return { name: it.split('\n')[0].trim(), hit: m ? +m[1] : null, total: m ? +m[2] : null }; });
  });
}
async function setType(page, idx, type) { await page.getByRole('button', { name: type, exact: true }).nth(idx).click(); await sleep(W); }
async function setLine(page, dir, line) {
  await page.locator('select').first().selectOption({ label: dir }); await sleep(120);
  const inp = page.locator('input[type="number"]').first();
  await inp.fill(String(line)); await inp.press('Enter'); await sleep(W);
}

async function doFixture(page, name, sub, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4000);
  await page.getByText('Stats dos times', { exact: true }).click();
  await sleep(2600);
  await page.getByRole('button', { name: /Analisador/i }).click();
  await sleep(2600);
  // sub === "*" => não filtra competição: usa últimos 20 jogos corridos (todas as competições).
  const liga = (sub === '*') ? 'últimos 20 corridos (todas competições)' : await convergeComps(page, sub);
  let p0 = [];
  for (let tryI = 0; tryI < 6; tryI++) {
    await sleep(1500);
    p0 = await readCards(page);
    if (p0.length === 2 && p0[0].total === 20 && p0[1].total === 20) break;
  }
  if (p0.length < 2 || p0[0].total !== 20 || p0[1].total !== 20) return { name, liga, skipped: true, probe: p0 };
  const teams = [p0[0].name, p0[1].name];
  const result = { name, liga, teams, tempos: {} };

  for (const [tName, tRe, ranges] of TEMPOS) {
    await setTempo(page, tRe);
    const lock = {}, quase = {};
    const solo = { [teams[0]]: {}, [teams[1]]: {} };
    for (const [mkt, mktPT] of MARKETS) {
      if (!(await selectMarket(page, mkt))) continue;
      for (const type of ['Total', 'For', 'Against']) {
        await setType(page, 0, type); await setType(page, 1, type);
        for (const line of ranges[mktPT]) {
          await setLine(page, 'Acima', line);
          const c = await readCards(page);
          if (c.length < 2 || c[0].total !== 20 || c[1].total !== 20) continue;
          const [h0, h1] = [c[0].hit, c[1].hit];
          const K = `${mktPT}|${TYPEMAP[type]}`;
          if (h0 === 20 && h1 === 20) lock[`${K}|Mais`] = Math.max(lock[`${K}|Mais`] ?? -1, line);
          else if (Math.min(h0, h1) >= 18) { const cur = quase[K]; if (!cur || line > cur.line) quase[K] = { line, h0, h1 }; }
          if (h0 === 20) { if (!solo[c[0].name]) solo[c[0].name] = {}; solo[c[0].name][K] = Math.max(solo[c[0].name][K] ?? -1, line); }
          if (h1 === 20) { if (!solo[c[1].name]) solo[c[1].name] = {}; solo[c[1].name][K] = Math.max(solo[c[1].name][K] ?? -1, line); }
          if (h0 === 0 && h1 === 0) { lock[`${K}|Menos`] = Math.min(lock[`${K}|Menos`] ?? 99, line); break; }
        }
      }
    }
    result.tempos[tName] = {
      lock: Object.entries(lock).map(([k, v]) => { const [mk, tp, dir] = k.split('|'); return `${mk} | ${tp} | ${dir} de ${v}`; }),
      quase: Object.entries(quase).map(([k, o]) => { const [mk, tp] = k.split('|'); return `${mk} | ${tp} | Mais de ${o.line}  (${o.h0}/20 & ${o.h1}/20)`; }),
      solo: Object.entries(solo).flatMap(([team, ks]) => Object.entries(ks).map(([k, v]) => { const [mk, tp] = k.split('|'); return `${team} | ${mk} | ${tp} | Mais de ${v}`; })),
    };
  }
  return result;
}

(async () => {
  fs.writeFileSync(LOG, `varredor: ${FIXTURES.length} jogos, ${WORKERS} workers\n`);
  const t0 = Date.now();
  const browser = await chromium.launch({ headless: true });
  const queue = FIXTURES.slice();
  const results = [];
  async function worker(id) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 2600 }, locale: 'pt-BR' });
    const page = await ctx.newPage();
    while (queue.length) {
      const job = queue.shift(); if (!job) break;
      const [name, sub, url] = job;
      const started = Date.now();
      try { const r = await doFixture(page, name, sub, url); results.push(r); logResult(r, id, started); }
      catch (e) { results.push({ name, error: e.message }); log(`[w${id}] !! ${name} ERRO: ${e.message}`); }
      fs.writeFileSync(path.join(OUT, 'varredor_result.json'), JSON.stringify(results, null, 1));
    }
    await ctx.close();
  }
  function logResult(r, id, started) {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    if (r.skipped) { log(`\n[w${id}] === ${r.name} === (${secs}s) — sem amostra de 20 jogos, pulado  ${JSON.stringify(r.probe||[])}`); return; }
    log(`\n[w${id}] === ${r.name} === ${r.teams.join(' & ')} (${secs}s)`);
    for (const [t, o] of Object.entries(r.tempos)) {
      log(`  ${t}:`);
      o.lock.forEach(l => log(`    [20/20] ${l}`));
      o.quase.forEach(l => log(`    [quase] ${l}`));
      const pairMax = {};
      o.lock.forEach(l => { const m = l.match(/^(\S+) \| (\S+) \| Mais de ([\d.]+)$/); if (m) pairMax[`${m[1]}|${m[2]}`] = parseFloat(m[3]); });
      (o.solo || []).forEach(l => {
        const m = l.match(/^(.+?) \| (\S+) \| (\S+) \| Mais de ([\d.]+)$/);
        if (!m) return;
        const [, team, mk, tp, vStr] = m; const v = parseFloat(vStr);
        const pm = pairMax[`${mk}|${tp}`] ?? -1;
        if (v > pm) log(`    [SOLO ${team}] ${mk} | ${tp} | Mais de ${v}`);
      });
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  await browser.close();
  log(`\nALL DONE em ${((Date.now() - t0) / 60000).toFixed(1)} min`);
})();
