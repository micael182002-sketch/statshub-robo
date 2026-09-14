/*
  Gera cards.html a partir de parsed.json + meta.json (name -> [liga, hora]).
  Tambem imprime um ranking (rankeado por numero de linhas + maior teto) pra
  ajudar a montar os destaques do dia — a decisao final de quais entram no
  "Top N" e o texto de "why" continuam sendo julgamento do agente, olhando
  esse ranking (nunca decidir por 1 mercado so).
  Uso: node generate.js
  Le: parsed.json, meta.json, arbitros.json (opcional)
  Escreve: cards.html
*/
const fs = require('fs');
const path = require('path');
const D = __dirname;
const games = JSON.parse(fs.readFileSync(path.join(D, 'parsed.json'), 'utf8'));
const META = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'), 'utf8')); // { "Nome A x Nome B": ["Liga","HH:MM"] }

const METRIC = { Gols: 'gols', Escanteios: 'escanteios', Cartões: 'cartões', Chutes_Gol: 'chutes no gol' };
function fmtVal(v) { return v.replace('.', ','); }
function phrase(mk, tp, dir, v, teamA, teamB) {
  const m = METRIC[mk]; const val = fmtVal(v);
  const both = `${teamA} e ${teamB}`;
  if (mk === 'Gols' && tp === 'Geral' && dir === 'Mais' && v === '0.5') return { p: 'Sai gol no jogo', g: '(mais de 0,5)' };
  if (tp === 'Geral') return { p: `${dir === 'Mais' ? 'Mais' : 'Menos'} de ${val} ${m}`, g: 'no jogo' };
  if (tp === 'A favor') {
    if (m === 'cartões') return { p: `${both} levam ${dir === 'Mais' ? 'mais' : 'menos'} de ${val} cartões` };
    return { p: `${both} fazem ${dir === 'Mais' ? 'mais' : 'menos'} de ${val} ${m}` };
  }
  return { p: `${both} sofrem ${dir === 'Mais' ? 'mais' : 'menos'} de ${val} ${m} do rival` };
}
function parseLine(l) {
  const m = l.match(/^(\S+) \| (Geral|A favor|Contra) \| (Mais|Menos) de ([\d.]+)$/);
  if (!m) return null;
  return { mk: m[1], tp: m[2], dir: m[3], v: m[4] };
}
const TEMPO_TAG = { 'Tempo total': 'TT', '1º tempo': '1T', '2º tempo': '2T' };

// piso de valor por mercado/tipo pra cortar linha fraca (odd baixa/inexistente).
// tempo total: piso calibrado pro jogo inteiro (90min). 1T/2T: piso mais baixo
// pra escanteio/chutes (naturalmente menos eventos em 45min), resto igual.
const FLOOR_TT = {
  'Escanteios|Geral': 4.5, 'Escanteios|A favor': 1.5, 'Escanteios|Contra': 1.5,
  'Cartões|Geral': 1.5, 'Cartões|A favor': 1.5, 'Cartões|Contra': 1.5,
  'Gols|Geral': 0.5, 'Gols|A favor': 0.5, 'Gols|Contra': 0.5,
  'Chutes_Gol|Geral': 3.5, 'Chutes_Gol|A favor': 1.5, 'Chutes_Gol|Contra': 1.5,
};
const FLOOR_HALF = {
  'Escanteios|Geral': 1.5, 'Escanteios|A favor': 1.5, 'Escanteios|Contra': 1.5,
  'Cartões|Geral': 0.5, 'Cartões|A favor': 0.5, 'Cartões|Contra': 0.5,
  'Gols|Geral': 0.5, 'Gols|A favor': 0.5, 'Gols|Contra': 0.5,
  'Chutes_Gol|Geral': 1.5, 'Chutes_Gol|A favor': 1.5, 'Chutes_Gol|Contra': 1.5,
};
function rowsHtml(game, dir) {
  let out = '';
  const [teamA, teamB] = game.name.split(' x ');
  for (const tempoName of ['Tempo total', '1º tempo', '2º tempo']) {
    const FLOOR = tempoName === 'Tempo total' ? FLOOR_TT : FLOOR_HALF;
    const lines = game.tempos[tempoName] || [];
    for (const l of lines) {
      const parsed = parseLine(l);
      if (!parsed || parsed.dir !== dir) continue;
      if (dir === 'Mais') {
        const floor = FLOOR[`${parsed.mk}|${parsed.tp}`] ?? 0;
        if (parseFloat(parsed.v) < floor) continue;
      }
      const { p, g } = phrase(parsed.mk, parsed.tp, parsed.dir, parsed.v, teamA, teamB);
      out += `<div class="row"><span class="tempo">${TEMPO_TAG[tempoName]}</span><span class="pick"><span class="p">${p}</span>${g ? ` <span class="g">${g}</span>` : ''}</span><span class="badge lock">20·20</span></div>\n`;
    }
  }
  return out;
}

let arbitros = {};
try { arbitros = JSON.parse(fs.readFileSync(path.join(D, 'arbitros.json'), 'utf8')); } catch (e) {}
function refHtml(game, live) {
  if (!/cart(ão|ões)/i.test(live)) return '';
  const ref = arbitros[game.name];
  if (!ref || ref.avgCards == null) return '';
  const val = fmtVal(String(ref.avgCards));
  let flag = '';
  if (ref.avgCards >= 4.5) flag = ' — rigoroso, reforça o over';
  else if (ref.avgCards <= 3.3) flag = ' — mais brando que a média, atenção';
  return `<div class="ref">🟨 Árbitro: ${ref.name} · média ${val} cartões/jogo${flag}</div>`;
}
function gameCard(game) {
  const meta = META[game.name] || ['', ''];
  const [liga, hora] = meta;
  const live = rowsHtml(game, 'Mais');
  const teams = game.name.replace(' x ', ' × ');
  if (!live) return '';
  const ref = refHtml(game, live);
  return `
    <article class="game">
      <div class="ghead">
        <span class="comp">${liga}</span><span class="time">${hora}</span>
        <span class="teams">${teams}</span>
      </div>
      <div class="block liveb"><h3>▲ Ao vivo</h3>${live}${ref}</div>
    </article>`;
}

function toMinutes(hora) {
  const m = (hora || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 99999;
  return (+m[1]) * 60 + (+m[2]);
}
const sortedGames = games.filter(g => !g.skipped).sort((a, b) => {
  const ha = (META[a.name] || ['', ''])[1];
  const hb = (META[b.name] || ['', ''])[1];
  return toMinutes(ha) - toMinutes(hb);
});

const cardsHtml = sortedGames.map(gameCard).join('\n');
fs.writeFileSync(path.join(D, 'cards.html'), cardsHtml);
const present = sortedGames.filter(g => gameCard(g) !== '');

// ranking auxiliar pra escolher os destaques do dia — NUNCA decidir só pelo maior numero
// de linhas; olhar tambem qual mercado (escanteio/cartao costumam ser os de odd melhor)
// e se tem confirmacao em mais de um tempo (TT + 1T/2T do mesmo mercado = mais solido).
const ranking = present.map(g => {
  const live = rowsHtml(g, 'Mais');
  const lineCount = (live.match(/class="row"/g) || []).length;
  const maxEsc = Math.max(0, ...[...live.matchAll(/Mais de ([\d,]+) escanteios/g)].map(m => parseFloat(m[1].replace(',', '.'))));
  const maxCard = Math.max(0, ...[...live.matchAll(/Mais de ([\d,]+) cartões/g)].map(m => parseFloat(m[1].replace(',', '.'))));
  const maxSot = Math.max(0, ...[...live.matchAll(/Mais de ([\d,]+) chutes no gol/g)].map(m => parseFloat(m[1].replace(',', '.'))));
  return { name: g.name, lineCount, maxEsc, maxCard, maxSot };
}).sort((a, b) => b.lineCount - a.lineCount || b.maxCard - a.maxCard || b.maxEsc - a.maxEsc);

console.log('total games:', sortedGames.length, 'with pick:', present.length);
console.log('dropped (no line above floor):', sortedGames.filter(g => gameCard(g) === '').map(g => g.name).join(', '));
console.log('\n--- ranking auxiliar (nao decide sozinho o Top N, so ajuda) ---');
ranking.forEach(r => console.log(r.name, '::', r.lineCount, 'linhas | maxEsc', r.maxEsc, '| maxCard', r.maxCard, '| maxSot', r.maxSot));
fs.writeFileSync(path.join(D, 'ranking.json'), JSON.stringify(ranking, null, 1));
