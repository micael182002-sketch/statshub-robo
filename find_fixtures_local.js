/*
  Descobre os jogos de HOJE nas 16 ligas padrao, de forma 100% automatica
  (sem julgamento humano) — usa o SLUG da URL pra montar o nome do time
  (mais confiavel que o texto abreviado da barra lateral).
  Uso: node find_fixtures_local.js
  Saida: fixtures_hoje.json = [["Nome A x Nome B","substring-liga",url,"HH:MM"], ...]
*/
const { chromium } = require('C:/Users/micae/OneDrive/Desktop/Vs Code/sgf/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LABEL_RE = /\bToday\b|\bHoy\b|\bHoje\b|\bLIVE\b|\bAO VIVO\b/i;

const LEAGUES = [
  ["Premier League", "premier league", "https://www.statshub.com/pt/fixture/liverpool-vs-fulham-mtwfql/362959"],
  ["LaLiga", "laliga", "https://www.statshub.com/pt/fixture/racing-de-santander-vs-deportivo-alaves-mtx1fc/363011"],
  ["Bundesliga", "bundesliga", "https://www.statshub.com/pt/fixture/1-fsv-mainz-05-vs-eintracht-frankfurt-mtx1g7/363401"],
  ["Serie A", "serie a", "https://www.statshub.com/pt/fixture/genoa-vs-frosinone-mtx1gh/363214"],
  ["Ligue 1", "ligue 1", "https://www.statshub.com/pt/fixture/rc-strasbourg-vs-as-monaco-mtwfr7/363371"],
  ["Brasileirão A", "brasileirão série a", "https://www.statshub.com/pt/fixture/atletico-mineiro-vs-fluminense-mtwfrg/366069"],
  ["Brasileirão B", "brasileirão série b", "https://www.statshub.com/pt/fixture/atletico-goianiense-vs-criciuma-mtwfxv/366164"],
  ["Liga Profesional", "liga profesional", "https://www.statshub.com/pt/fixture/estudiantes-de-la-plata-vs-platense-mtwfsz/363970"],
  ["Eredivisie", "eredivisie", "https://www.statshub.com/pt/fixture/fc-twente-vs-ado-den-haag-mtxvaw/363461"],
  ["MLS", "mls", "https://www.statshub.com/pt/fixture/fc-cincinnati-vs-charlotte-fc-mtxva8/364797"],
  ["Saudi Pro League", "saudi pro league", "https://www.statshub.com/pt/fixture/al-taawoun-vs-al-hilal-mtxvcc/366489"],
  ["Championship", "championship", "https://www.statshub.com/pt/fixture/bolton-wanderers-vs-cardiff-city-mtxv2m/363116"],
  ["LaLiga 2", "laliga 2", "https://www.statshub.com/pt/fixture/fc-andorra-vs-real-sociedad-b-mtxvar/363786"],
  ["2. Bundesliga", "2. bundesliga", "https://www.statshub.com/pt/fixture/vfl-bochum-1848-vs-spvgg-greuther-furth-mtxv4k/363600"],
  ["Liga MX", "liga mx, apertura", "https://www.statshub.com/pt/fixture/deportivo-toluca-fc-vs-atlas-fc-mtyhdi/366742"],
  ["Liga Portugal", "liga portugal betclic", "https://www.statshub.com/pt/fixture/cd-nacional-vs-fc-alverca-mtym3i/364644"],
];

function titleCase(slug) {
  return slug.split('-').map(w => {
    if (/^\d/.test(w)) return w.toUpperCase(); // "07" etc mantem
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
function namesFromHref(href) {
  // ex: /pt/fixture/leeds-united-vs-newcastle-united-mtzal8/362960 -> "leeds-united-vs-newcastle-united-mtzal8"
  const m = href.match(/\/fixture\/([^/]+)\/(\d+)/);
  if (!m) return null;
  let slug = m[1].replace(/-[a-z0-9]{6}$/i, ''); // tira o sufixo aleatorio final (ex "-mtzal8")
  const parts = slug.split('-vs-');
  if (parts.length !== 2) return null;
  return { teamA: titleCase(parts[0]), teamB: titleCase(parts[1]) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const out = [];
  for (const [liga, sub, url] of LEAGUES) {
    const page = await (await browser.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 1400 } })).newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3500);
      const rows = await page.evaluate(({ reSrc, reFlags }) => {
        const re = new RegExp(reSrc, reFlags);
        const links = [...document.querySelectorAll('a[href*="/fixture/"]')];
        return links.map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').replace(/\s+/g, ' ').trim() }))
          .filter(r => re.test(r.text));
      }, { reSrc: LABEL_RE.source, reFlags: LABEL_RE.flags });
      for (const r of rows) {
        const names = namesFromHref(r.href);
        if (!names) continue;
        const timeM = r.text.match(/^(\d{1,2}:\d{2})/);
        const hora = timeM ? timeM[1] : null;
        const fullUrl = r.href.startsWith('http') ? r.href.split('?')[0] : `https://www.statshub.com${r.href.split('?')[0]}`;
        out.push([`${names.teamA} x ${names.teamB}`, sub, fullUrl, hora, liga]);
      }
      console.log('===', liga, ':', rows.length, 'jogos');
    } catch (e) {
      console.log('===', liga, 'ERRO:', e.message);
    }
    await page.close();
  }
  // dedup por nome (as vezes o mesmo jogo aparece 2x na barra lateral)
  const seen = new Set();
  const dedup = out.filter(o => { if (seen.has(o[0])) return false; seen.add(o[0]); return true; });
  fs.writeFileSync(path.join(__dirname, 'fixtures_hoje.json'), JSON.stringify(dedup, null, 1));
  console.log('\nTotal:', dedup.length, 'jogos em fixtures_hoje.json');
  await browser.close();
})();
