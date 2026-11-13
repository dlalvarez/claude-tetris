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
const overlayRecords = document.getElementById('overlay-records');
const scoresOver = document.getElementById('scores-over');
const bestsOver = document.getElementById('bests-over');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveBtn = document.getElementById('save-btn');
const startOverlay = document.getElementById('start-overlay');
const scoresStart = document.getElementById('scores-start');
const bestsStart = document.getElementById('bests-start');
const playBtn = document.getElementById('play-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, maxCombo, pendingEntry;

// ---- Records (localStorage; todo acceso protegido con try/catch) ----
const TOP_N = 5;
const KEY_SCORES = 'tetris.highscores';
const KEY_BESTS = 'tetris.bests';
const KEY_NAME = 'tetris.lastName';

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* sin almacenamiento */ }
}

function loadScores() {
  const list = readJSON(KEY_SCORES, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(s => s && Number.isFinite(s.score))
    .map(s => ({ ...s, name: String(s.name ?? ''), lines: Number(s.lines) || 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);
}

function loadBests() {
  const b = readJSON(KEY_BESTS, {});
  return { maxCombo: Number(b.maxCombo) || 0, maxLines: Number(b.maxLines) || 0 };
}

function loadLastName() {
  try { return localStorage.getItem(KEY_NAME) || ''; } catch (e) { return ''; }
}

// Posición donde entraría `s` (empates van después de los existentes); -1 si no entra.
function rankFor(list, s) {
  if (s <= 0) return -1;
  let i = list.findIndex(e => s > e.score);
  if (i === -1) i = list.length;
  return i < TOP_N ? i : -1;
}

function renderScores(ol, list, highlight) {
  ol.textContent = '';
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Sin records aún';
    ol.appendChild(li);
    return;
  }
  list.forEach((e, i) => {
    const li = document.createElement('li');
    if (i === highlight) li.className = 'new';
    const cols = [`${i + 1}.`, e.name || '---', e.score.toLocaleString(), `${e.lines || 0} L`];
    for (const text of cols) {
      const span = document.createElement('span');
      span.textContent = text;
      li.appendChild(span);
    }
    ol.appendChild(li);
  });
}

function bestsText() {
  const b = loadBests();
  return `Mejor combo: ${b.maxCombo} · Máx. líneas: ${b.maxLines}`;
}

function showStart() {
  renderScores(scoresStart, loadScores(), -1);
  bestsStart.textContent = bestsText();
  startOverlay.classList.remove('hidden');
}

function resetRecords() {
  if (!confirm('¿Borrar todos los records?')) return;
  try {
    localStorage.removeItem(KEY_SCORES);
    localStorage.removeItem(KEY_BESTS);
  } catch (e) { /* sin almacenamiento */ }
  pendingEntry = null;
  nameEntry.classList.add('hidden');
  renderScores(scoresStart, [], -1);
  renderScores(scoresOver, [], -1);
  bestsStart.textContent = bestsOver.textContent = bestsText();
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
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
  return cleared;
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
  // Combo: locks consecutivos que limpian ≥1 línea; un lock sin limpiar lo reinicia.
  if (clearLines()) {
    combo++;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    combo = 0;
  }
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

function endGame() {
  if (gameOver) return;
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  // Bests globales
  const bests = loadBests();
  bests.maxCombo = Math.max(bests.maxCombo, maxCombo);
  bests.maxLines = Math.max(bests.maxLines, lines);
  writeJSON(KEY_BESTS, bests);

  // ¿Entra al top? Vista previa con la fila nueva resaltada.
  const list = loadScores();
  const rank = rankFor(list, score);
  if (rank >= 0) {
    pendingEntry = { score, lines, maxCombo };
    const preview = list.slice();
    preview.splice(rank, 0, { name: '', score, lines });
    renderScores(scoresOver, preview.slice(0, TOP_N), rank);
    nameInput.value = loadLastName();
    nameEntry.classList.remove('hidden');
    // Pequeño retardo: evita que teclas aún presionadas (Space) caigan en el campo.
    setTimeout(() => { nameInput.focus(); nameInput.value = nameInput.value.trim(); }, 400);
  } else {
    pendingEntry = null;
    renderScores(scoresOver, list, -1);
    nameEntry.classList.add('hidden');
  }
  bestsOver.textContent = bestsText();
  overlayRecords.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function saveEntry() {
  if (!pendingEntry) return;
  const name = nameInput.value.trim().slice(0, 12) || 'Anónimo';
  const entry = { name, score: pendingEntry.score, lines: pendingEntry.lines,
                  maxCombo: pendingEntry.maxCombo, date: new Date().toISOString() };
  pendingEntry = null;
  const list = loadScores();
  const rank = rankFor(list, entry.score);
  if (rank < 0) { // otra pestaña cambió el top: ya no entra
    nameEntry.classList.add('hidden');
    renderScores(scoresOver, list, -1);
    return;
  }
  list.splice(rank, 0, entry);
  const top = list.slice(0, TOP_N);
  writeJSON(KEY_SCORES, top);
  try { localStorage.setItem(KEY_NAME, name); } catch (e) { /* sin almacenamiento */ }
  nameEntry.classList.add('hidden');
  renderScores(scoresOver, top, rank);
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlayRecords.classList.add('hidden');
    overlay.classList.remove('hidden');
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
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  combo = 0;
  maxCombo = 0;
  pendingEntry = null;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Los campos de texto no disparan teclas de juego.
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
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

// Reiniciar sin pulsar Guardar guarda el record pendiente con el nombre escrito.
restartBtn.addEventListener('click', () => { saveEntry(); init(); restartBtn.blur(); });
playBtn.addEventListener('click', () => { init(); playBtn.blur(); });
saveBtn.addEventListener('click', () => { saveEntry(); saveBtn.blur(); });
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') { saveEntry(); nameInput.blur(); } });
document.querySelectorAll('.reset-btn').forEach(btn =>
  btn.addEventListener('click', () => { resetRecords(); btn.blur(); }));

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

// Arranque: tablero en reposo detrás de la pantalla de inicio; el juego empieza con "Jugar".
loadTheme();
board = createBoard();
score = lines = 0;
level = 1;
combo = maxCombo = 0;
paused = false;
gameOver = true; // bloquea teclas y pausa hasta pulsar Jugar
next = randomPiece();
spawn();
updateHUD();
draw();
showStart();
