/*
  Descobre os jogos de HOJE (ou de amanhã, com --tomorrow) nas 16 ligas padrão,
  abrindo um fixture-âncora conhecido de cada liga e lendo a barra lateral dele
  (mostra o calendário atual daquele time, incluindo jogos já em andamento).
  Uso: node find_fixtures.js [--tomorrow]
  Saída: fixtures_hoje.json = [["Nome time A x Nome time B","substring-liga",url], ...]
*/
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TOMORROW = process.argv.includes('--tomorrow');
const LABEL_RE = TOMORROW ? /\bTomorrow\b|\bMañana\b|\bAmanhã\b/i : /\bToday\b|\bHoy\b|\bHoje\b|\bLIVE\b|\bAO VIVO\b/i;

// Âncoras: um fixture QUALQUER de cada liga (não precisa ser recente — a barra lateral
// mostra o calendário atual do time, não o jogo específico da URL). Trocar só se a liga
// mudar de ID ou o time some do site.
const LEAGUES = [
  ["Premier League", "premier league", "https://www.statshub.com/pt/fixture/liverpool-vs-fulham-mtwfql/362959"],
  ["LaLiga", "laliga", "https://www.statshub.com/pt/fixture/racing-de-santander-vs-deportivo-alaves-mtx1fc/363011"],
  ["Bundesliga", "bundesliga", "https://www.statshub.com/pt/fixture/1-fsv-mainz-05-vs-eintracht-frankfurt-mtx1g7/363401"],
  ["Serie A", "serie a", "https://www.statshub.com/pt/fixture/genoa-vs-frosinone-mtx1gh/363214"],
  ["Ligue 1", "ligue 1", "https://www.statshub.com/pt/fixture/rc-strasbourg-vs-as-monaco-mtwfr7/363371"],
  ["Brasileirão Série A", "brasileirão série a", "https://www.statshub.com/pt/fixture/atletico-mineiro-vs-fluminense-mtwfrg/366069"],
  ["Brasileirão Série B", "brasileirão série b", "https://www.statshub.com/pt/fixture/atletico-goianiense-vs-criciuma-mtwfxv/366164"],
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

(async () => {
  const browser = await chromium.launch({ headless: true });
  const out = [];
  for (const [liga, sub, url] of LEAGUES) {
    const page = await (await browser.newContext({ locale: 'pt-BR', viewport: { width: 1400, height: 1400 } })).newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(3500);
      const rows = await page.evaluate((reSrc, reFlags) => {
        const re = new RegExp(reSrc, reFlags);
        const links = [...document.querySelectorAll('a[href*="/fixture/"]')];
        return links.map(a => ({ href: a.getAttribute('href'), text: (a.innerText || '').replace(/\s+/g, ' ').trim() }))
          .filter(r => re.test(r.text));
      }, LABEL_RE.source, LABEL_RE.flags);
      for (const r of rows) {
        // texto tipo "16:00 Today Leeds Newcastle" ou "LIVE 0-0 Sheffield United Wolverhampton"
        const timeM = r.text.match(/^(\d{1,2}:\d{2})/);
        const hora = timeM ? timeM[1] : 'LIVE';
        const fullUrl = r.href.startsWith('http') ? r.href.split('?')[0] : `https://www.statshub.com${r.href.split('?')[0]}`;
        // nome dos times: pega o texto depois do rótulo (Today/Tomorrow/LIVE/placar), limpa números de placar
        const nameChunk = r.text.replace(/^(\d{1,2}:\d{2})?\s*(Today|Tomorrow|LIVE|AO VIVO)\s*(\d+\s*[-–]\s*\d+)?/i, '').trim();
        out.push({ liga, sub, hora, url: fullUrl, rawText: r.text, nameChunk });
      }
      console.log('===', liga, ':', rows.length, 'jogos');
    } catch (e) {
      console.log('===', liga, 'ERRO:', e.message);
    }
    await page.close();
  }
  fs.writeFileSync(path.join(__dirname, 'fixtures_raw.json'), JSON.stringify(out, null, 1));
  console.log('\nTotal bruto:', out.length, '— revisar fixtures_raw.json e montar fixtures_hoje.json com nomes formatados "Time A x Time B".');
  await browser.close();
})();
