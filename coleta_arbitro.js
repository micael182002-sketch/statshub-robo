/*
  Coleta leve: nome do árbitro + média de cartões/jogo dele, pra cada fixture.
  NÃO abre o Analisador (rápido, ~5-10s por jogo). Roda em paralelo.
  Uso: node coleta_arbitro.js --fixtures fx_for_ref.json [--workers 6]
  Saída: arbitros.json = { "Nome A x Nome B": { name, avgCards } }
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let FIXTURES = [];
const argv = process.argv;
const fa = argv.indexOf('--fixtures'); if (fa > -1) FIXTURES = JSON.parse(fs.readFileSync(argv[fa + 1], 'utf8'));
const wa = argv.indexOf('--workers'); const WORKERS = wa > -1 ? +argv[wa + 1] : 6;

async function getReferee(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(2500);
  return await page.evaluate(() => {
    const a = document.querySelector('a[href*="/referee/"]');
    if (!a) return null;
    const full = a.textContent.replace(/\s+/g, ' ').trim();
    // o DOM duplica nome completo + abreviado colados; corta no início da abreviação "X. "
    const m = full.match(/^(.+?)(?=[A-Z]\.\s)/);
    const name = m ? m[1].trim() : full;
    const avgMatch = full.match(/(\d\.\d\d)/);
    const cleanName = name.includes(',') ? name.split(',').reverse().map(s => s.trim()).join(' ') : name;
    return { name: cleanName, avgCards: avgMatch ? parseFloat(avgMatch[1]) : null };
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const queue = FIXTURES.slice();
  const results = {};
  async function worker(id) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1200 }, locale: 'pt-BR' });
    const page = await ctx.newPage();
    while (queue.length) {
      const job = queue.shift(); if (!job) break;
      const [name, , url] = job;
      try {
        const ref = await getReferee(page, url);
        results[name] = ref;
        console.log(`[w${id}] ${name} :: ${ref ? `${ref.name} (${ref.avgCards})` : 'sem árbitro listado'}`);
      } catch (e) {
        console.log(`[w${id}] !! ${name} ERRO: ${e.message}`);
        results[name] = null;
      }
    }
    await ctx.close();
  }
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
  fs.writeFileSync(path.join(__dirname, 'arbitros.json'), JSON.stringify(results, null, 1));
  await browser.close();
  console.log('DONE');
})();
