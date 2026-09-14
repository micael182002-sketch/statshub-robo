/*
  Le varredor.log e monta parsed.json (array de jogos com as linhas 20/20 por tempo).
  Uso: node parse.js
*/
const fs = require('fs');
const path = require('path');
const log = fs.readFileSync(path.join(__dirname, 'varredor.log'), 'utf8').split('\n');
const games = [];
let cur = null, tempo = null;
for (const line of log) {
  const gm = line.match(/^\[w\d\] === (.+?) === (.+)? \((\d+)s\)/);
  if (gm) {
    if (/sem amostra/.test(line)) { games.push({ name: gm[1].trim(), skipped: true }); cur = null; continue; }
    cur = { name: gm[1].trim(), teams: (gm[2] || '').trim(), tempos: {} };
    games.push(cur);
    tempo = null;
    continue;
  }
  const tm = line.match(/^\s{2}(Tempo total|1º tempo|2º tempo):/);
  if (tm && cur) { tempo = tm[1]; cur.tempos[tempo] = []; continue; }
  const lm = line.match(/^\s{4}\[20\/20\] (.+)$/);
  if (lm && cur && tempo) { cur.tempos[tempo].push(lm[1]); continue; }
}
fs.writeFileSync(path.join(__dirname, 'parsed.json'), JSON.stringify(games, null, 1));
console.log('games parsed:', games.length);
games.forEach(g => console.log('-', g.name, g.skipped ? '(SKIPPED)' : `[${Object.keys(g.tempos).map(t => g.tempos[t].length).join(',')}]`));
