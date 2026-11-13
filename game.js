'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Colores de piezas, grilla y brillo: viven en variables CSS
// (:root = dark, [data-theme="light"] = light) y se cachean aquí.
const COLORS = [null, '', '', '', '', '', '', '', ''];
const theme = { grid: '', highlight: '' };

function loadTheme() {
  const css = getComputedStyle(document.documentElement);
  for (let i = 1; i < COLORS.length; i++)
    COLORS[i] = css.getPropertyValue(`--block-${i}`).trim();
  theme.grid = css.getPropertyValue('--grid').trim();
  theme.highlight = css.getPropertyValue('--highlight').trim();
}

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // Tuerca (reto: hueco central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const nameForm = document.getElementById('name-form');
const nameMsg = document.getElementById('name-msg');
const nameInput = document.getElementById('name-input');
const recordsBox = document.getElementById('records');
const recordsList = document.getElementById('records-list');
const recordsStats = document.getElementById('records-stats');
const resetRecordsBtn = document.getElementById('reset-records');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let idle = true;                 // pantalla de inicio: el juego aún no empezó
let combo, maxCombo;             // líneas seguidas: bloqueos consecutivos que limpian líneas
let pending = null;              // { rank } si la partida entra al top y falta guardar el nombre
let highlightRank = null;        // fila del top a resaltar
let newBestCombo = false, newMaxLines = false;

// ---- Records (localStorage) ----
const RECORDS_KEY = 'tetris.records';
const MAX_RECORDS = 5;
const NAME_MAX = 12;
const DEFAULT_NAME = 'ANÓNIMO';

function emptyRecords() {
  return { scores: [], bestCombo: 0, maxLines: 0 };
}

function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    if (!data) return emptyRecords();
    const scores = Array.isArray(data.scores)
      ? data.scores
          .filter(s => s && typeof s.name === 'string' && Number.isFinite(s.score))
          .sort((a, b) => b.score - a.score)
          .slice(0, MAX_RECORDS)
      : [];
    return { scores, bestCombo: Number(data.bestCombo) || 0, maxLines: Number(data.maxLines) || 0 };
  } catch {
    return emptyRecords();
  }
}

function saveRecords() {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch { /* storage no disponible: los records no persisten */ }
}

let records = loadRecords();

// Puesto (0-based) que ocuparía `pts`; los empates quedan debajo del existente.
function rankFor(pts) {
  const i = records.scores.findIndex(s => pts > s.score);
  return i === -1 ? records.scores.length : i;
}

function qualifies(pts) {
  return pts > 0 && rankFor(pts) < MAX_RECORDS;
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    combo++;
    maxCombo = Math.max(maxCombo, combo);
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  } else {
    combo = 0;
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = theme.highlight;
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function renderRecords() {
  const rows = records.scores.map(s => ({ ...s }));
  let hl = highlightRank;
  if (pending) {
    rows.splice(pending.rank, 0, { name: 'TÚ', score });
    hl = pending.rank;
  }
  recordsList.replaceChildren();
  for (let i = 0; i < MAX_RECORDS; i++) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    const pts = document.createElement('span');
    name.className = 'rec-name';
    pts.className = 'rec-score';
    if (rows[i]) {
      name.textContent = rows[i].name;
      pts.textContent = rows[i].score.toLocaleString();
    } else {
      name.textContent = '—';
      li.classList.add('empty');
    }
    if (i === hl && rows[i]) li.classList.add('me');
    li.append(name, pts);
    recordsList.append(li);
  }
  const tag = isNew => (isNew ? ' ¡NUEVO!' : '');
  recordsStats.textContent =
    `Mejor combo: ${records.bestCombo}${tag(newBestCombo)} · ` +
    `Líneas máx.: ${records.maxLines}${tag(newMaxLines)}`;
}

// opts: { records: mostrar top, form: mostrar campo de nombre, btn: texto del botón }
function showOverlay(title, text, opts = {}) {
  overlayTitle.textContent = title;
  overlayTitle.classList.toggle('start', !!opts.start);
  overlayScore.textContent = text;
  recordsBox.classList.toggle('hidden', !opts.records);
  nameForm.classList.toggle('hidden', !opts.form);
  restartBtn.textContent = opts.btn || 'Reiniciar';
  if (opts.records) renderRecords();
  overlay.classList.remove('hidden');
  if (opts.form) {
    nameInput.value = '';
    nameInput.focus();
  }
}

function commitPending(rawName) {
  if (!pending) return;
  const name = rawName.trim().slice(0, NAME_MAX) || DEFAULT_NAME;
  records.scores.splice(pending.rank, 0, { name, score });
  records.scores.length = Math.min(records.scores.length, MAX_RECORDS);
  highlightRank = pending.rank;
  pending = null;
  saveRecords();
  nameForm.classList.add('hidden');
  renderRecords();
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  newBestCombo = maxCombo > records.bestCombo;
  newMaxLines = lines > records.maxLines;
  if (newBestCombo) records.bestCombo = maxCombo;
  if (newMaxLines) records.maxLines = lines;
  if (newBestCombo || newMaxLines) saveRecords();
  highlightRank = null;
  pending = qualifies(score) ? { rank: rankFor(score) } : null;
  if (pending) nameMsg.textContent = `¡Nuevo récord! Puesto #${pending.rank + 1}`;
  showOverlay('GAME OVER', `Puntuación: ${score.toLocaleString()}`, { records: true, form: !!pending });
}

function showStart() {
  init();
  cancelAnimationFrame(animId);
  idle = true;
  newBestCombo = newMaxLines = false;
  highlightRank = null;
  showOverlay('TETRIS', '', { records: true, start: true, btn: 'Jugar' });
}

function togglePause() {
  if (gameOver || idle) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    showOverlay('PAUSA', '');
  }
}

function loop(ts) {
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  // endGame() dentro de este frame no puede cancelarlo: no reagendar.
  if (gameOver) return;
  animId = requestAnimationFrame(loop);
}

function init() {
  idle = false;
  pending = null;
  combo = 0;
  maxCombo = 0;
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver || idle) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => {
  commitPending(nameInput.value); // no perder el récord si reinicia sin guardar
  init();
});

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  commitPending(nameInput.value);
});

resetRecordsBtn.addEventListener('click', () => {
  if (!confirm('¿Borrar todos los records?')) return;
  records = emptyRecords();
  saveRecords();
  newBestCombo = newMaxLines = false;
  highlightRank = null;
  if (pending) pending.rank = rankFor(score);
  renderRecords();
  resetRecordsBtn.blur();
});

const themeToggle = document.getElementById('theme-toggle');

function setTheme(mode) {
  const light = mode === 'light';
  if (light) document.documentElement.dataset.theme = 'light';
  else delete document.documentElement.dataset.theme;
  themeToggle.setAttribute('aria-checked', String(light));
  loadTheme();
  // En pausa o game over el loop no corre: redibujar a mano.
  draw();
  drawNext();
}

themeToggle.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
  themeToggle.blur(); // evita que Space (caída) active el botón
});

loadTheme();
showStart();
