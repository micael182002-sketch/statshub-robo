/*
  Confere o resultado real (Gols/Escanteios/Cartões) de jogos já encerrados,
  comparando com a linha apostada, pra medir taxa de acerto do dia anterior.
  Uso: node check_results.js --fixtures fx_check.json
       fx_check.json = [["Nome A x Nome B", url, "DD/MM/AA"], ...]  (data no formato do site)
  Saída: resultados_check.json = { "Nome": { GOLS: {home,away}, ESCANTEIOS: {...}, CARTÕES: {...} } }
*/
const { chromium } = require('C:/Users/micae/OneDrive/Desktop/Vs Code/sgf/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FIXTURES = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--fixtures') + 1], 'utf8'));
const METRICS = ['GOLS', 'ESCANTEIOS', 'CARTÕES'];

async function clickMetric(p, label) {
  return await p.evaluate((label) => {
    const els = [...document.querySelectorAll('button,div,span,a')];
    const el = els.find(e => (e.textContent || '').trim().toUpperCase() === label.toUpperCase() && e.children.length === 0);
    if (el) { el.click(); return true; }
    return false;
  }, label);
}
async function readRow(p, date) {
  return await p.evaluate((date) => {
    const all = [...document.querySelectorAll('tr, div')].filter(e => (e.textContent || '').includes(date) && (e.textContent || '').length < 200);
    for (const e of all) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      const m = t.match(/^\S+\s+(\S.*?)\s+(\d+)\s+(\d+)\s+(\S.*?)\s+/);
      if (m) return { raw: t, teamHome: m[1], home: +m[2], away: +m[3], teamAway: m[4] };
    }
    return null;
  }, date);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = {};
  for (const [name, url, date] of FIXTURES) {
    const p = await (await browser.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 2600 } })).newPage();
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3500);
      await p.getByText('Stats dos times', { exact: true }).click();
      await sleep(2200);
      const stats = {};
      for (const metric of METRICS) {
        const ok = await clickMetric(p, metric);
        if (!ok) { stats[metric] = null; continue; }
        await sleep(1600);
        stats[metric] = await readRow(p, date);
      }
      results[name] = stats;
      console.log('===', name, '::', JSON.stringify(stats));
    } catch (e) {
      console.log('===', name, 'ERRO:', e.message);
      results[name] = { error: e.message };
    }
    await p.close();
  }
  fs.writeFileSync(path.join(__dirname, 'resultados_check.json'), JSON.stringify(results, null, 1));
  await browser.close();
  console.log('DONE');
})();
