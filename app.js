'use strict';

const PASSWORD_HASH = '379fb1eb999bfb776c12bc25e7d4c248ab718490f43c760e51c641ab083b0779';
const AUTH_KEY = 'shogi-tournament-authenticated';
const DATA_URL = 'shogi-tournament-backup-20260824.json';
const MAX_ROUNDS = 5;
const loginForm = document.getElementById('login-form');
const passwordInput = document.getElementById('password');
const loginError = document.getElementById('login-error');

const sha256 = async value => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const unlock = () => {
  document.body.classList.add('authenticated');
  sessionStorage.setItem(AUTH_KEY, 'true');
};

if (sessionStorage.getItem(AUTH_KEY) === 'true') unlock();

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  loginError.textContent = '';
  if (await sha256(passwordInput.value) === PASSWORD_HASH) {
    unlock();
    passwordInput.value = '';
  } else {
    loginError.textContent = 'パスワードが違います。';
    passwordInput.select();
  }
});

let data;
const tableEl = document.getElementById('results-table');

const loadTournamentData = async () => {
  const response = await fetch(DATA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error(`大会データの取得に失敗しました（${response.status}）`);
  return response.json();
};

const createPlayerMap = initialValue => new Map(
  data.players.map(player => [player.id, typeof initialValue === 'function' ? initialValue() : initialValue])
);

const getWinnerAndLoser = match => match.result === 'A'
  ? { winnerId: match.a, loserId: match.b }
  : { winnerId: match.b, loserId: match.a };

const sumOpponentWins = (opponents, winCounts) => new Map(
  data.players.map(player => [
    player.id,
    opponents.get(player.id).reduce((total, opponentId) => total + winCounts.get(opponentId), 0)
  ])
);

const calculateStandings = () => {
  const winCounts = createPlayerMap(0);
  const winPoints = createPlayerMap(50);
  const opponentIds = createPlayerMap(() => []);
  const defeatedOpponentIds = createPlayerMap(() => []);
  const completedRoundAbsences = (data.absences || []).slice(0, data.rounds.length);
  const absentPlayerIds = new Set(completedRoundAbsences.flat());

  data.rounds.forEach((round, roundIndex) => {
    round.forEach(match => {
      const { winnerId, loserId } = getWinnerAndLoser(match);
      winCounts.set(winnerId, winCounts.get(winnerId) + 1);
      winPoints.set(loserId, winPoints.get(loserId) - (10 - roundIndex));
      opponentIds.get(match.a).push(match.b);
      opponentIds.get(match.b).push(match.a);
      defeatedOpponentIds.get(winnerId).push(loserId);
    });
  });

  const solkoffScores = sumOpponentWins(opponentIds, winCounts);
  const sbScores = sumOpponentWins(defeatedOpponentIds, winCounts);
  const rankedPlayers = data.players
    .filter(player => !absentPlayerIds.has(player.id))
    .sort((left, right) =>
      winCounts.get(right.id) - winCounts.get(left.id) ||
      winPoints.get(right.id) - winPoints.get(left.id) ||
      solkoffScores.get(right.id) - solkoffScores.get(left.id) ||
      sbScores.get(right.id) - sbScores.get(left.id)
    );

  const rankings = new Map();
  let previousScore = null;
  let previousRank = 0;
  rankedPlayers.forEach((player, index) => {
    const wins = winCounts.get(player.id);
    const score = wins === MAX_ROUNDS
      ? 'perfect-score'
      : [wins, winPoints.get(player.id), solkoffScores.get(player.id), sbScores.get(player.id)].join(':');
    const rank = score === previousScore ? previousRank : index + 1;
    rankings.set(player.id, rank);
    previousScore = score;
    previousRank = rank;
  });

  return { winCounts, winPoints, solkoffScores, sbScores, rankings, rankedPlayers, absentPlayerIds };
};

const createTableHeader = () => {
  const thead = document.createElement('thead');
  const row = document.createElement('tr');
  const corner = document.createElement('th');
  corner.className = 'corner';
  corner.textContent = '回戦';
  row.append(corner);

  data.players.forEach(player => {
    const th = document.createElement('th');
    th.className = 'name-head';
    const label = document.createElement('div');
    label.className = 'name-cell';
    const id = document.createElement('span');
    id.className = 'head-id';
    id.textContent = player.id;
    const name = document.createElement('span');
    name.className = 'vertical-name';
    name.textContent = player.name.replace(/[　\s]+/g, '');
    label.append(id, name);
    th.append(label);
    row.append(th);
  });

  thead.append(row);
  return thead;
};

const getRoundResults = round => {
  const results = new Map();
  round.forEach(match => {
    results.set(match.a, { outcome: match.result === 'A' ? 'win' : 'loss', opponentId: match.b });
    results.set(match.b, { outcome: match.result === 'B' ? 'win' : 'loss', opponentId: match.a });
  });
  return results;
};

const createResultCell = (player, result, isAbsent) => {
  const cell = document.createElement('td');
  const state = isAbsent ? 'absence' : result?.outcome || 'none';
  const display = { win: '○', loss: '●', absence: '欠', none: '－' };
  const description = { win: '勝ち', loss: '負け', absence: '欠席', none: '対局なし' };
  cell.className = `result-cell ${state}`;
  cell.textContent = display[state];
  cell.title = `${player.name}：${description[state]}`;

  if (result && !isAbsent) {
    const opponentId = document.createElement('span');
    opponentId.className = 'opponent-id';
    opponentId.textContent = result.opponentId;
    opponentId.title = `対戦相手ID：${result.opponentId}`;
    cell.append(opponentId);
  }
  return cell;
};

const appendRoundRows = tbody => {
  data.rounds.forEach((round, roundIndex) => {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.className = 'round-label';
    label.scope = 'row';
    label.textContent = `第${roundIndex + 1}回戦`;
    row.append(label);

    const results = getRoundResults(round);
    const absentIds = new Set(data.absences?.[roundIndex] || []);
    data.players.forEach(player => {
      row.append(createResultCell(player, results.get(player.id), absentIds.has(player.id)));
    });
    tbody.append(row);
  });
};

const appendSummaryRow = (tbody, labelText, values, absentPlayerIds) => {
  const row = document.createElement('tr');
  row.className = 'summary-row';
  const label = document.createElement('th');
  label.className = 'summary-label';
  label.scope = 'row';
  label.textContent = labelText;
  row.append(label);
  data.players.forEach(player => {
    const cell = document.createElement('td');
    cell.className = 'summary-cell';
    cell.textContent = absentPlayerIds.has(player.id) ? 'ー' : values.get(player.id);
    row.append(cell);
  });
  tbody.append(row);
  return row;
};

const highlightTopPlayers = rankedPlayers => {
  const topPlayerIds = new Set(rankedPlayers.slice(0, 8).map(player => player.id));
  data.players.forEach((player, playerIndex) => {
    if (!topPlayerIds.has(player.id)) return;
    tableEl.querySelectorAll(`tr > *:nth-child(${playerIndex + 2})`)
      .forEach(cell => cell.classList.add('top-eight'));
  });
};

const bindControls = ({ scRow, sbRow }) => {
  const highlightButton = document.getElementById('highlight-button');
  highlightButton.addEventListener('click', () => {
    const enabled = document.body.classList.toggle('highlight-top-eight');
    highlightButton.setAttribute('aria-pressed', String(enabled));
    highlightButton.textContent = enabled ? '強調を解除' : '上位8名を強調';
  });

  [['show-sc', scRow], ['show-sb', sbRow]].forEach(([checkboxId, row]) => {
    document.getElementById(checkboxId).addEventListener('change', event => {
      row.hidden = !event.currentTarget.checked;
    });
  });
};

const renderTournament = () => {
  const standings = calculateStandings();
  const tbody = document.createElement('tbody');
  appendRoundRows(tbody);
  appendSummaryRow(tbody, '勝ち数', standings.winCounts, standings.absentPlayerIds);
  appendSummaryRow(tbody, '勝ち点', standings.winPoints, standings.absentPlayerIds);
  const scRow = appendSummaryRow(tbody, 'SC', standings.solkoffScores, standings.absentPlayerIds);
  const sbRow = appendSummaryRow(tbody, 'SB', standings.sbScores, standings.absentPlayerIds);
  appendSummaryRow(tbody, '順位', standings.rankings, standings.absentPlayerIds);
  tableEl.append(createTableHeader(), tbody);
  highlightTopPlayers(standings.rankedPlayers);
  bindControls({ scRow, sbRow });
};

const updateMetadata = () => {
  document.getElementById('player-count').textContent = data.players.length;
  document.getElementById('caption-player-count').textContent = data.players.length;
  document.getElementById('round-progress').textContent = data.rounds.length === MAX_ROUNDS
    ? `全${MAX_ROUNDS}回戦終了`
    : `第${data.rounds.length}回戦終了時点`;
  document.getElementById('tournament-summary').hidden = false;
  document.getElementById('updated-at').textContent = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(data.updatedAt));
};

const initialize = async () => {
  try {
    data = await loadTournamentData();
    updateMetadata();
    renderTournament();
  } catch (error) {
    console.error(error);
    const message = '大会データを読み込めませんでした。ページを再読み込みしてください。';
    loginError.textContent = message;
    const dataError = document.getElementById('data-error');
    dataError.textContent = message;
    dataError.hidden = false;
  }
};

initialize();
