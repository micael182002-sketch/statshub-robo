# statshub-robo

Sweep automatizado do [statshub.com](https://www.statshub.com) pra achar linhas de aposta
"20/20" (bateram nos últimos 20 jogos de cada time, na competição do confronto) em
Escanteios, Cartões, Gols e Chutes no Gol — pensado pra pegar odd inflada **ao vivo**
quando o jogo esfria.

## Ligas padrão (16, cresce com o tempo)

Premier League, LaLiga, Bundesliga, Serie A, Ligue 1, Brasileirão Série A e B,
Liga Profesional (Argentina), Eredivisie, MLS, Saudi Pro League, Championship,
LaLiga 2, 2. Bundesliga, Liga MX (Apertura), Liga Portugal Betclic.

Não cortar liga por rendimento baixo de uma rodada isolada — mesmo ligas "fracas"
às vezes dão o melhor achado do dia.

## Pipeline diário

1. **`node find_fixtures.js`** — abre um fixture-âncora de cada liga (não precisa ser
   recente, a barra lateral mostra o calendário atual do time) e lê os jogos marcados
   "Today"/"LIVE" na barra lateral. Gera `fixtures_raw.json` (dados brutos, nomes
   abreviados/inconsistentes — precisa de um passe de limpeza manual/LLM pra virar
   `fixtures_hoje.json` no formato `[["Time A x Time B","substring-liga",url], ...]`).
   Usar `--tomorrow` pra achar os jogos de amanhã em vez de hoje.
2. **`node varredor_statshub.js --fixtures fixtures_hoje.json --workers 4`** — sweep
   completo (4 mercados × 3 tipos × 3 tempos). Gera `varredor.log`. Demora ~200-300s
   por jogo com 4 workers (ex.: 40 jogos ≈ 30-45min).
   - **Erro de rede em cascata**: se um `page.goto()` falhar (`net::ERR_*`), a mesma aba
     do worker erra em cascata em TODOS os jogos seguintes da fila dele
     ("interrupted by another navigation"). Sempre `grep "ERRO" varredor.log` depois do
     sweep — se tiver erro, isolar esses jogos num `fx_retry.json` e rodar de novo
     (funciona ~100% na segunda tentativa).
   - Times recém-promovidos/com poucos jogos disputados aparecem como
     "sem amostra de 20 jogos, pulado" — isso é normal, não é bug.
3. **`node parse.js`** — converte `varredor.log` em `parsed.json`.
4. Montar **`meta.json`** = `{ "Time A x Time B": ["Liga","HH:MM"] }` pra cada jogo
   (nome da liga bonito + horário de kickoff — sem isso o card não aparece formatado).
5. **`node generate.js`** — aplica o piso por mercado/tempo e gera `cards.html` +
   imprime um ranking auxiliar (linhas, maior escanteio/cartão/chute) pra ajudar a
   montar os destaques do dia.
6. **`node coleta_arbitro.js --fixtures fx_para_arbitro.json --workers 6`** — só pros
   jogos que têm pick de CARTÃO (regex `/cart(ão|ões)/i` no card já gerado). Pega nome
   do árbitro + média de cartões/jogo dele. Gera `arbitros.json` — rodar `generate.js`
   de novo depois pra injetar isso nos cards.
7. Montar o HTML final juntando `style.css` (reusar sem alterar) + cabeçalho +
   seção de destaques (curada à mão, olhando o ranking do passo 5 — **nunca ranquear
   só por 1 mercado**) + `cards.html` + rodapé.
8. **Verificar o dia anterior**: `node check_results.js --fixtures fx_check.json` onde
   `fx_check.json = [["Nome do jogo", url, "DD/MM/AA"], ...]` dos jogos do Top do dia
   anterior (guardados em `history/YYYY-MM-DD.json`, ver abaixo). Compara resultado
   real (soma casa+fora) contra a linha apostada.
9. **Enviar o email** via Gmail MCP (`mcp__Gmail__send_message` ou nome equivalente
   do connector anexado à rotina) pro endereço do usuário, com: (a) conferência do dia
   anterior (lista hit/miss) + (b) os destaques/picks de hoje + link do relatório
   (se publicado como artifact) ou o HTML resumido no corpo do email.
10. **Persistir o histórico**: salvar em `history/YYYY-MM-DD.json` os picks do Top do
    dia (nome do jogo, mercado, linha, url do fixture) — commitar e dar push nesse
    arquivo no fim da rotina, senão a checagem do dia seguinte não tem o que conferir
    (cada rodada da rotina é um clone novo, sem estado local entre execuções).

## Regras do relatório (todas confirmadas pelo usuário)

1. **Só 20/20 estrito.** Nunca misturar "quase" (18-19/20) como linha oficial.
2. **Só AO VIVO** — nunca gerar bloco "Menos de"/pré-jogo.
3. **Sempre o teto, nunca a linha fraca.** Ver `FLOOR_TT`/`FLOOR_HALF` em `generate.js`:
   Escanteios total ≥4,5 (≥1,5 por tempo/por time), Cartões ≥1,5 (qualquer tipo),
   Gols ≥0,5, Chutes no Gol total ≥3,5 (≥1,5 por tempo/por time).
4. **Nunca ranquear por um mercado só.** Sempre cruzar Escanteios/Cartões/Chutes/Gols
   antes de montar os destaques do dia.
5. **Nomear sempre os dois times** nas frases "A favor"/"Contra" (`Time A e Time B
   fazem/levam/sofrem X`) — nunca "cada time"/"o adversário" genérico.
6. **Cards em ordem cronológica de kickoff**, destaques do dia ficam numa seção à
   parte (não misturar ordem).
7. **Árbitro só aparece em jogo com pick de cartão**, nunca em jogo só de escanteio/gol.
8. **"Time que sempre marca/leva cartão" é por time individual** (`tp === 'A favor'`),
   não por assimetria entre os dois lados de um jogo — não confundir com achado
   `Geral`/`Contra` (esses não contam como "time sozinho").
9. Formato de entrega: sempre um documento/artefato completo, nunca só tabela solta.

## Fixture-âncoras (find_fixtures.js)

As URLs em `find_fixtures.js` são de jogos ANTIGOS de propósito — a barra lateral do
statshub mostra o calendário atual do TIME, não o jogo específico da URL, então esses
links continuam servindo indefinidamente (só trocar se o time sumir do site ou a liga
mudar de ID interno).
