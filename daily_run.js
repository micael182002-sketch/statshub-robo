/*
  Orquestrador diário — roda o pipeline inteiro sozinho (pensado pro Agendador
  de Tarefas do Windows, sem Claude Code aberto):
    1. Descobre os jogos de hoje (16 ligas padrão)
    2. Sweep completo (Gols/Escanteios/Cartões/Chutes no Gol), com 1 retry automático
    3. Gera o relatório (cards.html) + árbitro pros jogos com pick de cartão
    4. Monta o Top 7 do dia por regra fixa (nunca só 1 mercado)
    5. Confere os picks de ONTEM (se existir history de ontem)
    6. Manda um email com os dois blocos
    7. Salva o Top de hoje em history/ pra dar pra conferir amanhã
  Uso: node daily_run.js
*/
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const D = __dirname;

function run(cmd) {
  console.log('\n$ ' + cmd);
  try {
    const out = execSync(cmd, { cwd: D, encoding: 'utf8', maxBuffer: 1024 * 1024 * 50 });
    console.log(out);
    return { ok: true, out };
  } catch (e) {
    console.log('ERRO ao rodar:', cmd, '\n', e.stdout || e.message);
    return { ok: false, out: e.stdout || '', err: e.message };
  }
}
function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function todaySiteFmt(offsetDays = 0) {
  // formato usado no site pra comparar linha da tabela: DD/MM/AA
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}/${mm}/${yy}`;
}

const log = [];
const L = s => { console.log(s); log.push(s); };

(async () => {
  L(`=== Rodada de ${todayISO()} — inicio ${new Date().toLocaleTimeString('pt-BR')} ===`);

  // --- 1. Descobrir jogos de hoje ---
  const r1 = run('node find_fixtures_local.js');
  let fixturesHoje = [];
  try { fixturesHoje = JSON.parse(fs.readFileSync(path.join(D, 'fixtures_hoje.json'), 'utf8')); }
  catch (e) { L('FALHA CRITICA: nao consegui ler fixtures_hoje.json — ' + e.message); }

  if (fixturesHoje.length === 0) {
    await sendEmail('Leitura de hoje — sem jogos encontrados',
      '<p>Não consegui descobrir nenhum jogo hoje nas 16 ligas padrão. Isso pode ser falha de rede ou o site mudou de layout. Log:</p><pre>' + log.join('\n') + '</pre>');
    return;
  }

  // meta.json: nome -> [liga, hora]; sweep list: [nome, sub, url]
  const meta = {};
  const sweepList = [];
  for (const [name, sub, url, hora, liga] of fixturesHoje) {
    meta[name] = [liga, hora || ''];
    sweepList.push([name, sub, url]);
  }
  fs.writeFileSync(path.join(D, 'meta.json'), JSON.stringify(meta, null, 1));
  fs.writeFileSync(path.join(D, 'fixtures_hoje_sweep.json'), JSON.stringify(sweepList, null, 1));
  L(`Jogos encontrados: ${sweepList.length}`);

  // --- 2. Sweep completo + 1 retry automatico ---
  run(`node varredor_statshub.js --fixtures fixtures_hoje_sweep.json --workers 4`);
  let logText = '';
  try { logText = fs.readFileSync(path.join(D, 'varredor.log'), 'utf8'); } catch (e) {}
  let erroNomes = [...logText.matchAll(/!! (.+?) ERRO/g)].map(m => m[1]);
  if (erroNomes.length) {
    L(`${erroNomes.length} jogos com erro, tentando de novo: ${erroNomes.join(', ')}`);
    const retryList = sweepList.filter(f => erroNomes.includes(f[0]));
    fs.copyFileSync(path.join(D, 'varredor.log'), path.join(D, 'varredor_batch1.log.bak'));
    fs.writeFileSync(path.join(D, 'fx_retry.json'), JSON.stringify(retryList, null, 1));
    run(`node varredor_statshub.js --fixtures fx_retry.json --workers 3`);
    // mesclar os dois logs num só antes do parse
    const log2 = fs.readFileSync(path.join(D, 'varredor.log'), 'utf8');
    fs.writeFileSync(path.join(D, 'varredor.log'), fs.readFileSync(path.join(D, 'varredor_batch1.log.bak'), 'utf8') + '\n' + log2);
  }

  // --- 3. Gerar relatorio ---
  run('node parse.js');
  run('node generate.js');

  // arbitro pros jogos com pick de cartao
  let cardsHtml = '';
  try { cardsHtml = fs.readFileSync(path.join(D, 'cards.html'), 'utf8'); } catch (e) {}
  const withCard = [];
  for (const art of cardsHtml.split('<article class="game">').slice(1)) {
    const nameM = art.match(/class="teams">([^<]*)/);
    if (nameM && /cart(ão|ões)/i.test(art)) withCard.push(nameM[1].replace(' × ', ' x '));
  }
  if (withCard.length) {
    const fxRef = sweepList.filter(f => withCard.includes(f[0]));
    fs.writeFileSync(path.join(D, 'fx_for_ref.json'), JSON.stringify(fxRef, null, 1));
    run('node coleta_arbitro.js --fixtures fx_for_ref.json --workers 6');
    run('node generate.js'); // de novo, agora injeta o arbitro
  }

  // --- 4. Top 7 do dia (regra fixa, nunca so 1 mercado) ---
  let ranking = [];
  try { ranking = JSON.parse(fs.readFileSync(path.join(D, 'ranking.json'), 'utf8')); } catch (e) {}
  ranking.sort((a, b) => b.lineCount - a.lineCount || b.maxCard - a.maxCard || b.maxEsc - a.maxEsc || b.maxSot - a.maxSot);
  const top7 = ranking.slice(0, 7);
  const topHtml = top7.map((r, i) => {
    const bits = [];
    if (r.maxEsc > 0) bits.push(`+${String(r.maxEsc).replace('.', ',')} escanteios`);
    if (r.maxCard > 0) bits.push(`+${String(r.maxCard).replace('.', ',')} cartões`);
    if (r.maxSot > 0) bits.push(`+${String(r.maxSot).replace('.', ',')} chutes no gol`);
    const [liga, hora] = meta[r.name] || ['', ''];
    return `<li><b>${r.name.replace(' x ', ' × ')}</b> (${liga}, ${hora}) — ${bits.join(' · ')} <span style="color:#888">[${r.lineCount} linha(s) 20/20]</span></li>`;
  }).join('\n');

  // --- 5. Conferir ontem ---
  let checkHtml = '<p><i>Sem histórico de ontem pra conferir (primeira rodada, ou falha anterior).</i></p>';
  const ontemPath = path.join(D, 'history', `${todayISO(-1)}.json`);
  if (fs.existsSync(ontemPath)) {
    const ontem = JSON.parse(fs.readFileSync(ontemPath, 'utf8'));
    const fxCheck = ontem.map(o => [o.name, o.url, todaySiteFmt(-1)]);
    fs.writeFileSync(path.join(D, 'fx_check.json'), JSON.stringify(fxCheck, null, 1));
    const rc = run('node check_results.js --fixtures fx_check.json');
    if (rc.ok) {
      try {
        const results = JSON.parse(fs.readFileSync(path.join(D, 'resultados_check.json'), 'utf8'));
        const rows = ontem.map(o => {
          const stat = results[o.name] && results[o.name][o.metric];
          if (!stat || typeof stat !== 'object' || stat.home == null) return `<li>${o.name} — não consegui confirmar (dado indisponível)</li>`;
          const sum = stat.home + stat.away;
          const hit = sum > o.line;
          return `<li>${hit ? '✅' : '❌'} ${o.name} — ${o.metric}: ${stat.home}+${stat.away}=${sum} vs linha ${o.line}</li>`;
        });
        checkHtml = `<ul>${rows.join('\n')}</ul>`;
      } catch (e) { checkHtml = `<p>Erro ao processar conferência: ${e.message}</p>`; }
    } else {
      checkHtml = '<p>Falha ao rodar a conferência de ontem (erro técnico no sweep de verificação).</p>';
    }
  }

  // --- 6. Email ---
  // monta a lista COMPLETA de jogos (nao so o Top 7), em ordem cronologica,
  // reaproveitando os blocos ja gerados em cards.html (mantem nome dos times,
  // tags TT/1T/2T e a nota de arbitro exatamente como no relatorio de verdade).
  const allGamesHtml = cardsHtmlToEmail(cardsHtml, meta);

  const dow = new Date().toLocaleDateString('pt-BR', { weekday: 'long' });
  const intro = `
    <p style="color:#555">
      Linhas <b>20/20</b>: bateram nos <b>últimos 20 jogos</b> de cada time, só contando jogos
      da <b>mesma competição</b> do confronto de hoje (nunca "quase" — só fechado 20 de 20).
      São todas <b>"Mais de"</b> — pensadas pra pegar <b>ao vivo</b>, esperando o jogo esfriar
      (poucos escanteios/cartões/chutes até ali) pra odd inflar antes de entrar.
    </p>
    <p style="color:#555;font-size:.9em">
      <b>no jogo</b> = soma dos dois times · <b>fazem/levam</b> = cada time por si (histórico
      dele) · <b>sofrem ... do rival</b> = o que o adversário costuma produzir contra ele ·
      <b>TT / 1º tempo / 2º tempo</b> = janela de tempo da linha · 🟨 = média de cartão do
      árbitro (reforça a aposta quando ele é rigoroso).
    </p>
  `;
  const html = `
    <h2>Leitura de ${dow} (${todayISO()})</h2>
    ${intro}
    <h3>Conferência de ontem</h3>
    ${checkHtml}
    <h3>Destaques de hoje (Top ${top7.length})</h3>
    <p style="color:#888;font-size:.85em">Ranqueado por quantidade de linhas 20/20 e depois pelo maior teto de cartão/escanteio — não é curadoria manual, é regra automática.</p>
    <ol>${topHtml}</ol>
    <h3>Todos os jogos com pick (${ranking.length}, ordem de horário)</h3>
    ${allGamesHtml}
    <p style="color:#888;font-size:.85em">Total: ${sweepList.length} jogos varridos.</p>
  `;
  await sendEmail(`Leitura de ${dow} — statshub`, html);

  function cardsHtmlToEmail(html, meta) {
    const TEMPO_FULL = { TT: 'tempo total', '1T': '1º tempo', '2T': '2º tempo' };
    const arts = html.split('<article class="game">').slice(1);
    const games = arts.map(a => {
      const nameM = a.match(/class="teams">([^<]*)/);
      const name = nameM ? nameM[1] : '?';
      const nameKey = name.replace(' × ', ' x ');
      const [liga, hora] = meta[nameKey] || ['', ''];
      const picks = [...a.matchAll(/<span class="tempo">([^<]*)<\/span><span class="pick"><span class="p">([^<]*)<\/span>(?:\s*<span class="g">([^<]*)<\/span>)?/g)]
        .map(m => `${m[2]}${m[3] ? ' ' + m[3] : ''} <span style="color:#999">(${TEMPO_FULL[m[1]] || m[1]})</span>`);
      const refM = a.match(/class="ref">([^<]*)</);
      const ref = refM ? refM[1] : null;
      return { name, liga, hora, picks, ref };
    });
    games.sort((a, b) => {
      const toMin = h => { const m = (h || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : 9999; };
      return toMin(a.hora) - toMin(b.hora);
    });
    return '<div>' + games.map(g =>
      `<p style="margin:14px 0 4px"><b>${g.name}</b> <span style="color:#888">— ${g.liga}, ${g.hora}</span></p>
       <ul style="margin:0 0 0 18px;padding:0">${g.picks.map(p => `<li>${p}</li>`).join('')}</ul>
       ${g.ref ? `<p style="color:#a67c00;margin:4px 0 0 18px;font-size:.9em">${g.ref}</p>` : ''}`
    ).join('\n') + '</div>';
  }

  // --- 7. Salvar historico de hoje ---
  const historyDir = path.join(D, 'history');
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
  const urlByName = Object.fromEntries(sweepList.map(f => [f[0], f[2]]));
  const historyToday = top7.map(r => {
    let metric = 'ESCANTEIOS', line = r.maxEsc;
    if (r.maxCard > 0) { metric = 'CARTÕES'; line = r.maxCard; }
    else if (r.maxSot > 0 && r.maxEsc === 0) { metric = null; line = null; } // chutes no gol nao tem checker ainda
    return { name: r.name, metric, line, url: urlByName[r.name] };
  }).filter(h => h.metric);
  fs.writeFileSync(path.join(historyDir, `${todayISO()}.json`), JSON.stringify(historyToday, null, 1));
  L('Historico de hoje salvo.');
  fs.writeFileSync(path.join(D, `run_${todayISO()}.log`), log.join('\n'));

  async function sendEmail(subject, htmlBody) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(path.join(D, '.env.json'), 'utf8')); }
    catch (e) { L('Sem .env.json, não deu pra enviar email: ' + e.message); return; }
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: cfg.GMAIL_USER, pass: cfg.GMAIL_APP_PASSWORD },
      tls: { rejectUnauthorized: false }, // TLS local intercepta certificado (antivirus/proxy) — necessario nesta maquina
    });
    try {
      await transporter.sendMail({ from: cfg.GMAIL_USER, to: cfg.SEND_TO, subject, html: htmlBody });
      L('Email enviado: ' + subject);
    } catch (e) {
      L('FALHA ao enviar email: ' + e.message);
    }
  }
})();
