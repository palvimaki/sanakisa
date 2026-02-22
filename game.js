// game.js — SanaTaisto

import { loadDictionary, isValidWord, getWordList } from './dictionary.js';
import { findBestMove, setWordList } from './ai.js';
import {
  BOARD_SIZE, PREMIUMS, TILE_BAG_DEFINITION,
  BINGO_BONUS, FINNISH_BONUS, INITIAL_RATING, K_FACTOR, RATING_SCALE, RACK_SIZE
} from './board-config.js';

// ─── State ────────────────────────────────────────────────────────────────────
let board;          // null | {letter, points, assignedLetter?, fixed}
let tileBag;
let players;
let currentPlayer;
let gameOver;
let consecutivePasses;
let gameMode     = 'pve';
let aiDifficulty = 'easy';

// Held tile: set when user clicks a rack/board tile (cursor-ghost mechanism)
// { source:'rack'|'board', rackIdx?:number, origRow?:number, origCol?:number,
//   tile:{letter,points,assignedLetter?} }
let held = null;

// Drag-and-drop sources (HTML5 drag API — coexists with click-hold)
let dragSrcRackIdx = null;   // rack index being dragged
let dragSrcBoard   = null;   // {row, col, tile} for board-tile drag

// Tile exchange
let exchangeMode     = false;
let exchangeSelected = new Set(); // rack indices selected for exchange

// ─── Cursor ghost ─────────────────────────────────────────────────────────────
const cursorTileEl = document.getElementById('cursor-tile');
const IS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

document.addEventListener('mousemove', e => {
  if (!held) return;
  cursorTileEl.style.left = e.clientX + 'px';
  cursorTileEl.style.top  = e.clientY + 'px';
});

if (IS_TOUCH) {
  document.addEventListener('touchmove', e => {
    if (!held) return;
    e.preventDefault(); // prevent page scroll while dragging a tile
    const t = e.touches[0];
    cursorTileEl.style.left = t.clientX + 'px';
    cursorTileEl.style.top  = t.clientY + 'px';
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!held) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    const target = document.elementFromPoint(t.clientX, t.clientY);
    handleTouchDrop(target, t.clientX, t.clientY);
  }, { passive: false });
}

function startGhost(tile, x, y) {
  cursorTileEl.innerHTML = '';
  cursorTileEl.appendChild(createTileEl(tile));
  cursorTileEl.style.left    = (x || 0) + 'px';
  cursorTileEl.style.top     = (y || 0) + 'px';
  cursorTileEl.style.display = 'block';
  document.body.style.cursor = 'none';
}

function stopGhost() {
  cursorTileEl.style.display = 'none';
  document.body.style.cursor = '';
}

function cancelHold() {
  if (!held) return;
  if (held.source === 'board') {
    // Return tile to its original board position
    board[held.origRow][held.origCol] = { ...held.tile, fixed: false };
    renderBoard();
    applyLiveValidation();
  }
  // rack source: tile is still in rack (just dimmed), nothing to restore
  held = null;
  stopGhost();
  renderRack();
}

// Touch drop handler — finds the board cell or rack under the finger
async function handleTouchDrop(target, x, y) {
  const cell   = target?.closest('.cell');
  const rackEl = target?.closest('#rack');

  if (cell) {
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    if (isNaN(row) || isNaN(col)) { cancelHold(); return; }
    if (board[row][col]?.fixed) { cancelHold(); return; }

    // Swap any pending tile on the target cell back to rack
    if (board[row][col] && !board[row][col].fixed) {
      const ex = board[row][col];
      players[currentPlayer].rack.push({ letter: ex.letter, points: ex.points });
      board[row][col] = null;
    }

    if (held.tile.letter === ' ' && !held.tile.assignedLetter) {
      const letter = await askBlankLetter();
      if (!letter) { cancelHold(); return; }
      held.tile = { ...held.tile, assignedLetter: letter };
    }

    finishPlacing(row, col);
  } else if (rackEl) {
    // Finger lifted over rack — return board tile to rack, or just cancel for rack tile
    if (held.source === 'board') {
      players[currentPlayer].rack.push({ letter: held.tile.letter, points: held.tile.points });
      board[held.origRow][held.origCol] = null;
      held = null;
      stopGhost();
      renderBoard();
      renderRack();
      applyLiveValidation();
    } else {
      cancelHold();
    }
  } else {
    cancelHold();
  }
}

// Place the currently held tile on board at (row, col). Synchronous.
function finishPlacing(row, col) {
  if (!held) return;
  if (held.source === 'rack') {
    players[currentPlayer].rack.splice(held.rackIdx, 1);
  }
  board[row][col] = { ...held.tile, fixed: false };
  held = null;
  stopGhost();
  renderBoard();
  renderRack();
  applyLiveValidation();
}

// Cancel hold if user clicks somewhere unrelated
document.addEventListener('click', e => {
  if (!held) return;
  if (
    e.target.closest('.cell') ||
    e.target.closest('#rack') ||
    e.target.closest('#blank-selector')
  ) return;
  cancelHold();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') cancelHold();
});

// ─── Blank letter picker ──────────────────────────────────────────────────────
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÅ'.split('');
const blankLettersEl = document.getElementById('blank-letters');
ALPHABET.forEach(letter => {
  const btn = document.createElement('div');
  btn.classList.add('blank-letter');
  btn.dataset.letter = letter;
  btn.textContent = letter;
  blankLettersEl.appendChild(btn);
});

function askBlankLetter() {
  return new Promise(resolve => {
    const overlay   = document.getElementById('blank-selector');
    const cancelBtn = document.getElementById('blank-cancel');
    overlay.style.display = 'flex';

    function finish(result) {
      blankLettersEl.removeEventListener('click',    onPick);
      blankLettersEl.removeEventListener('touchend', onPickTouch);
      cancelBtn.removeEventListener('click',    onCancel);
      cancelBtn.removeEventListener('touchend', onCancelTouch);
      overlay.style.display = 'none';
      resolve(result);
    }

    // Desktop: click
    function onPick(e) {
      const btn = e.target.closest('.blank-letter');
      if (!btn) return;
      finish(btn.dataset.letter);
    }
    function onCancel() { finish(null); }

    // Touch: touchend with stopPropagation so the document touchend handler
    // (which would call cancelHold) never sees these events.
    function onPickTouch(e) {
      const btn = e.target.closest('.blank-letter');
      if (!btn) return;
      e.stopPropagation();
      e.preventDefault();
      finish(btn.dataset.letter);
    }
    function onCancelTouch(e) {
      e.stopPropagation();
      e.preventDefault();
      finish(null);
    }

    blankLettersEl.addEventListener('click',    onPick);
    blankLettersEl.addEventListener('touchend', onPickTouch,   { passive: false });
    cancelBtn.addEventListener('click',    onCancel);
    cancelBtn.addEventListener('touchend', onCancelTouch, { passive: false });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function initGame() {
  board = Array.from({ length: BOARD_SIZE }, () => Array(BOARD_SIZE).fill(null));
  tileBag = buildTileBag();

  const diffLabel = aiDifficulty === 'easy' ? 'Helppo' : aiDifficulty === 'medium' ? 'Keski' : 'Vaikea';
  players = [
    { name: 'Pelaaja 1',                    rating: INITIAL_RATING, score: 0, rack: [], isHuman: true },
    { name: `Tietokone (${diffLabel})`,      rating: 1100,           score: 0, rack: [], isHuman: false },
  ];
  currentPlayer     = 0;
  gameOver          = false;
  consecutivePasses = 0;
  held              = null;
  dragSrcRackIdx    = null;
  dragSrcBoard      = null;
  exchangeMode      = false;
  exchangeSelected.clear();

  stopGhost();
  document.getElementById('submit').disabled = false;
  document.getElementById('pass').disabled   = false;

  await loadDictionary();
  setWordList(getWordList());
  dealRacks();
  renderBoard();
  renderRack();
  updateUI();
  showMessage('Peli alkaa!', 'info', 0);
  showMessage('', 'info', 1);
}

// ─── Tile bag ─────────────────────────────────────────────────────────────────
function buildTileBag() {
  const bag = [];
  for (const [letter, { count, points }] of Object.entries(TILE_BAG_DEFINITION))
    for (let i = 0; i < count; i++) bag.push({ letter, points });
  shuffle(bag);
  return bag;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function dealRacks() { for (let p = 0; p < 2; p++) refillRack(p); }

function refillRack(p) {
  const rack = players[p].rack;
  while (rack.length < RACK_SIZE && tileBag.length > 0) rack.push(tileBag.pop());
}

// ─── Premiums ─────────────────────────────────────────────────────────────────
function premiumType(row, col) {
  if (PREMIUMS.TW.some(([r, c]) => r === row && c === col)) return 'TW';
  if (PREMIUMS.DW.some(([r, c]) => r === row && c === col)) return 'DW';
  if (PREMIUMS.TL.some(([r, c]) => r === row && c === col)) return 'TL';
  if (PREMIUMS.DL.some(([r, c]) => r === row && c === col)) return 'DL';
  return null;
}

// ─── Rendering ────────────────────────────────────────────────────────────────
const PREM_CLASS = { TW: 'premium-tw', DW: 'premium-dw', TL: 'premium-tl', DL: 'premium-dl' };
const PREM_LABEL = { TW: '3W', DW: '2W', TL: '3L', DL: '2L' };

function renderBoard() {
  const el = document.getElementById('board');
  el.innerHTML = '';

  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.row = row;
      cell.dataset.col = col;

      // Always apply premium class (so it shows through transparent tiles)
      const prem = premiumType(row, col);
      if (prem) { cell.classList.add(PREM_CLASS[prem]); cell.dataset.label = PREM_LABEL[prem]; }
      if (row === 7 && col === 7) { cell.classList.add('center'); cell.dataset.label = '★'; }

      const tile = board[row][col];
      if (tile) {
        cell.classList.add('has-tile');
        const tileEl = createTileEl(tile);
        if (tile.fixed) {
          tileEl.classList.add('fixed-tile');
        } else {
          tileEl.classList.add('pending');
          if (IS_TOUCH) {
            tileEl.addEventListener('touchstart', e => {
              e.preventDefault();
              e.stopPropagation();
              if (held) return; // already holding something — touchend will handle drop
              const touch = e.touches[0];
              const t = board[row][col];
              board[row][col] = null;
              held = { source: 'board', origRow: row, origCol: col,
                       tile: { letter: t.letter, points: t.points, assignedLetter: t.assignedLetter } };
              startGhost(held.tile, touch.clientX, touch.clientY);
              tileEl.style.visibility = 'hidden'; // hide in-place; no re-render so touch chain stays intact
            }, { passive: false });
          } else {
            tileEl.draggable = true;
            tileEl.addEventListener('dragstart', e => handleBoardDragStart(e, row, col));
            tileEl.addEventListener('dragend',   e => handleBoardDragEnd(e, row, col));
            tileEl.addEventListener('click',     e => { e.stopPropagation(); handlePendingTileClick(row, col, e); });
          }
        }
        cell.appendChild(tileEl);
      }

      // Cells accept drops (drag on desktop, touch handled via document touchend)
      if (!IS_TOUCH) {
        cell.addEventListener('dragover',  handleDragOver);
        cell.addEventListener('dragleave', handleDragLeave);
        cell.addEventListener('drop',      handleDrop);
        cell.addEventListener('click',     e => handleCellClick(e, row, col));
      }

      el.appendChild(cell);
    }
  }
}

function createTileEl(tile) {
  const el = document.createElement('div');
  el.classList.add('tile');
  el.textContent = tile.letter === ' ' ? (tile.assignedLetter || '') : tile.letter;
  const pts = document.createElement('span');
  pts.classList.add('points');
  pts.textContent = tile.points;
  el.appendChild(pts);
  return el;
}

function renderRack() {
  const rackEl = document.getElementById('rack');
  rackEl.innerHTML = '';
  players[currentPlayer].rack.forEach((tile, idx) => {
    const el = createTileEl(tile);
    el.dataset.idx = idx;

    if (exchangeMode) {
      if (exchangeSelected.has(idx)) el.classList.add('exchange-selected');
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        if (exchangeSelected.has(idx)) exchangeSelected.delete(idx);
        else exchangeSelected.add(idx);
        renderRack();
        updateExchangeUI();
      });
    } else if (IS_TOUCH) {
      if (held?.source === 'rack' && held.rackIdx === idx) el.classList.add('held');
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        e.stopPropagation();
        if (held?.source === 'rack' && held.rackIdx === idx) { cancelHold(); return; }
        if (held) cancelHold();
        const touch = e.touches[0];
        const tile = players[currentPlayer].rack[idx];
        held = { source: 'rack', rackIdx: idx, tile: { ...tile } };
        startGhost(tile, touch.clientX, touch.clientY);
        el.classList.add('held'); // dim in-place; no re-render so touch chain stays intact
      }, { passive: false });
    } else {
      el.draggable = true;
      if (held?.source === 'rack' && held.rackIdx === idx) el.classList.add('held');
      el.addEventListener('dragstart', e => handleRackDragStart(e, idx));
      el.addEventListener('dragend',   handleRackDragEnd);
      el.addEventListener('click',     e => handleRackTileClick(e, idx));
    }
    rackEl.appendChild(el);
  });

  // Clicking empty rack area while holding a board tile → return to rack (desktop only;
  // touch devices handle this via the document touchend → handleTouchDrop)
  if (!IS_TOUCH) {
    rackEl.addEventListener('click', e => {
      if (!held || held.source !== 'board' || e.target.closest('.tile')) return;
      players[currentPlayer].rack.push({ letter: held.tile.letter, points: held.tile.points });
      held = null;
      stopGhost();
      renderBoard();
      renderRack();
      applyLiveValidation();
    });
  }
}

function updateUI() {
  document.getElementById('name-p1').textContent  = players[0].name;
  document.getElementById('name-p2').textContent  = players[1].name;
  document.getElementById('score-p1').textContent = players[0].score;
  document.getElementById('score-p2').textContent = players[1].score;
  document.getElementById('bag-count').textContent = `${tileBag.length} nappulaa`;
  document.getElementById('panel-p1').classList.toggle('active', currentPlayer === 0 && !gameOver);
  document.getElementById('panel-p2').classList.toggle('active', currentPlayer === 1 && !gameOver);
  updateExchangeUI();
}

function showMessage(text, type = 'info', playerIdx = null) {
  const idx  = playerIdx ?? currentPlayer;
  const el   = document.getElementById(idx === 0 ? 'msg-p1' : 'msg-p2');
  if (!el) return;
  el.textContent = text;
  el.className   = `panel-msg msg-${type}`;
}

// ─── Click: rack tile ─────────────────────────────────────────────────────────
function handleRackTileClick(e, idx) {
  if (gameOver || !players[currentPlayer].isHuman) return;
  e.stopPropagation();

  // Clicking the already-held rack tile → cancel
  if (held?.source === 'rack' && held.rackIdx === idx) {
    cancelHold();
    return;
  }
  // Switch hold to this tile (cancel any previous)
  if (held) cancelHold();

  const tile = players[currentPlayer].rack[idx];
  held = { source: 'rack', rackIdx: idx, tile: { ...tile } };
  startGhost(tile, e.clientX, e.clientY);
  renderRack(); // dim the held tile
}

// ─── Click: empty board cell ──────────────────────────────────────────────────
async function handleCellClick(e, row, col) {
  if (!held || gameOver) return;
  if (board[row][col] && board[row][col].fixed) return; // can't place on fixed tile

  // If placing on another pending tile: pick it up and place held tile there
  if (board[row][col] && !board[row][col].fixed) {
    // Swap: put existing back to rack, place held tile here
    const existing = board[row][col];
    players[currentPlayer].rack.push({ letter: existing.letter, points: existing.points });
    board[row][col] = null;
  }

  // Handle blank letter assignment
  if (held.tile.letter === ' ' && !held.tile.assignedLetter) {
    const letter = await askBlankLetter();
    if (!letter) return;
    held.tile = { ...held.tile, assignedLetter: letter };
  }

  finishPlacing(row, col);
}

// ─── Click: pending board tile (pick it up) ───────────────────────────────────
function handlePendingTileClick(row, col, e) {
  if (gameOver || !players[currentPlayer].isHuman) return;

  // If we're holding something, swap: put held tile here, pick up existing
  if (held) {
    const existing = board[row][col];
    board[row][col] = null;

    // Async: might need blank letter for held tile before placing
    // For simplicity: if held tile is blank (assignedLetter already set from when it was placed),
    // place it. If it's an unassigned blank, we handle that in finishPlacing path.
    if (held.tile.letter === ' ' && !held.tile.assignedLetter) {
      // Can't handle async here cleanly; just cancel and let user re-place
      board[row][col] = existing; // restore
      return;
    }

    const oldHeld = held;
    held = { source: 'board', origRow: row, origCol: col, tile: { letter: existing.letter, points: existing.points, assignedLetter: existing.assignedLetter } };
    startGhost(held.tile, e.clientX, e.clientY);

    // Place old held tile at this cell
    board[row][col] = { ...oldHeld.tile, fixed: false };
    if (oldHeld.source === 'rack') players[currentPlayer].rack.splice(oldHeld.rackIdx, 1);
    renderBoard();
    renderRack();
    applyLiveValidation();
    return;
  }

  // Nothing held: pick up this tile
  const tile = board[row][col];
  board[row][col] = null;
  held = { source: 'board', origRow: row, origCol: col, tile: { letter: tile.letter, points: tile.points, assignedLetter: tile.assignedLetter } };
  startGhost(held.tile, e.clientX, e.clientY);
  renderBoard();
  applyLiveValidation();
}

// ─── Drag: rack tiles ─────────────────────────────────────────────────────────
function handleRackDragStart(e, idx) {
  if (held) { cancelHold(); }
  dragSrcRackIdx = idx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', idx);
  e.currentTarget.classList.add('dragging');
}

function handleRackDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  dragSrcRackIdx = null;
}

// ─── Drag: board pending tiles ────────────────────────────────────────────────
function handleBoardDragStart(e, row, col) {
  if (held) { cancelHold(); }
  const tile = board[row][col];
  if (!tile || tile.fixed) { e.preventDefault(); return; }
  dragSrcBoard = { row, col, tile: { ...tile } };
  board[row][col] = null; // temporarily clear while dragging
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', 'board');
  e.currentTarget.classList.add('dragging');
}

function handleBoardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  if (dragSrcBoard) {
    // Drop was not on a valid cell — restore tile
    board[dragSrcBoard.row][dragSrcBoard.col] = { ...dragSrcBoard.tile, fixed: false };
    dragSrcBoard = null;
    renderBoard();
    applyLiveValidation();
  }
}

// ─── Drag: board cells (drop targets) ────────────────────────────────────────
function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drop-target');
}

function handleDragLeave(e) {
  e.currentTarget.classList.remove('drop-target');
}

async function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drop-target');

  const row = parseInt(e.currentTarget.dataset.row);
  const col = parseInt(e.currentTarget.dataset.col);
  if (isNaN(row) || isNaN(col)) return;

  // Determine which tile is being dragged
  let tileToPlace = null;
  let sourceIsRack  = false;

  if (dragSrcRackIdx !== null) {
    tileToPlace   = { ...players[currentPlayer].rack[dragSrcRackIdx] };
    sourceIsRack  = true;
    dragSrcRackIdx = null;
  } else if (dragSrcBoard) {
    tileToPlace  = dragSrcBoard.tile;
    dragSrcBoard = null; // consumed — don't restore in dragend
  } else {
    return;
  }

  // Target occupied?
  if (board[row][col]) {
    if (board[row][col].fixed) {
      // Can't place on fixed tile: restore source
      if (sourceIsRack) { /* rack tile stays */ }
      else { board[row][col] = null; /* already cleared in dragstart; just abandon */ }
      renderBoard(); renderRack();
      return;
    }
    // Pending tile there: send it to rack, place new tile
    const existing = board[row][col];
    players[currentPlayer].rack.push({ letter: existing.letter, points: existing.points });
    board[row][col] = null;
  }

  // Blank tile needs letter assignment
  if (tileToPlace.letter === ' ' && !tileToPlace.assignedLetter) {
    const letter = await askBlankLetter();
    if (!letter) {
      if (sourceIsRack) { /* tile stays in rack */ }
      renderBoard(); renderRack();
      return;
    }
    tileToPlace.assignedLetter = letter;
  }

  if (sourceIsRack) players[currentPlayer].rack.splice(
    players[currentPlayer].rack.findIndex(t =>
      t.letter === tileToPlace.letter && t.points === tileToPlace.points
    ), 1
  );

  board[row][col] = { ...tileToPlace, fixed: false };
  renderBoard();
  renderRack();
  applyLiveValidation();
}

// ─── Pending tile helpers ─────────────────────────────────────────────────────
function getPendingTiles() {
  const result = [];
  for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c] && !board[r][c].fixed) result.push({ row: r, col: c });
  return result;
}

function recallTiles() {
  if (exchangeMode) cancelExchangeMode();
  cancelHold();
  for (const { row, col } of getPendingTiles()) {
    const t = board[row][col];
    players[currentPlayer].rack.push({ letter: t.letter, points: t.points });
    board[row][col] = null;
  }
  renderBoard();
  renderRack();
  clearValidationUI();
}

// ─── Live validation & score badge ───────────────────────────────────────────
function clearValidationUI() {
  document.querySelectorAll('.tile-valid, .tile-invalid').forEach(el =>
    el.classList.remove('tile-valid', 'tile-invalid')
  );
  document.querySelectorAll('.live-score').forEach(el => el.remove());
}

function applyLiveValidation() {
  clearValidationUI();
  const pending = getPendingTiles();
  if (pending.length === 0) return;

  // ── Full structural check (layout, gap, connectivity, center) ────────────────
  if (validatePlacement(pending) !== null) { markAll(pending, 'tile-invalid'); return; }

  // ── Extract words and validate each ─────────────────────────────────────────
  const words = extractAllWords(pending);
  if (words.length === 0) return; // single tile not yet forming a word — neutral

  const wordResults = words.map(w => ({ ...w, valid: isValidWord(w.word) }));

  // Mark ALL tiles that participate in any word (pending + fixed)
  const lastTile = pending[pending.length - 1];
  const allCells = new Map();
  for (const wr of wordResults)
    for (const { row, col } of wr.cells) {
      const key = `${row},${col}`;
      if (!allCells.has(key)) allCells.set(key, { row, col, words: [] });
      allCells.get(key).words.push(wr);
    }
  for (const { row, col, words } of allCells.values()) {
    const cellEl = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
    const tileEl = cellEl?.querySelector('.tile');
    if (!tileEl) continue;
    if (words.every(w => w.valid)) tileEl.classList.add('tile-valid');
    else                           tileEl.classList.add('tile-invalid');
  }

  // ── Live score badge on last tile if all words are valid ─────────────────────
  const allValid = wordResults.every(w => w.valid);
  if (allValid) {
    const { total } = scoreWords(wordResults, pending);
    const cellEl = document.querySelector(`.cell[data-row="${lastTile.row}"][data-col="${lastTile.col}"]`);
    if (cellEl) {
      const badge = document.createElement('div');
      badge.classList.add('live-score');
      badge.textContent = `+${total}`;
      cellEl.appendChild(badge);
    }
  }
}

function markAll(pending, cls) {
  for (const { row, col } of pending) {
    const el = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"] .tile`);
    el?.classList.add(cls);
  }
}

// ─── Word extraction ──────────────────────────────────────────────────────────
function getWordInDirection(startRow, startCol, dir) {
  const dr = dir === 'V' ? 1 : 0, dc = dir === 'H' ? 1 : 0;
  let r = startRow, c = startCol;
  while (r - dr >= 0 && c - dc >= 0 && board[r - dr][c - dc]) { r -= dr; c -= dc; }
  const cells = [];
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c]) {
    cells.push({ row: r, col: c, tile: board[r][c] });
    r += dr; c += dc;
  }
  if (cells.length < 2) return null;
  const word = cells.map(({ tile: t }) =>
    (t.letter === ' ' ? (t.assignedLetter || '?') : t.letter).toLowerCase()
  ).join('');
  return { word, cells };
}

function extractAllWords(pending) {
  if (pending.length === 0) return [];
  const words = [], seen = new Set();
  const rows  = [...new Set(pending.map(p => p.row))];
  const cols  = [...new Set(pending.map(p => p.col))];
  const dir   = pending.length > 1 ? (rows.length === 1 ? 'H' : 'V') : null;
  const add   = (w, key) => { if (w && !seen.has(key)) { seen.add(key); words.push(w); } };

  if (dir === 'H') {
    add(getWordInDirection(pending[0].row, pending[0].col, 'H'), `H${pending[0].row}`);
    for (const { row, col } of pending) add(getWordInDirection(row, col, 'V'), `V${col}`);
  } else if (dir === 'V') {
    add(getWordInDirection(pending[0].row, pending[0].col, 'V'), `V${pending[0].col}`);
    for (const { row, col } of pending) add(getWordInDirection(row, col, 'H'), `H${row}`);
  } else {
    add(getWordInDirection(pending[0].row, pending[0].col, 'H'), `H${pending[0].row}`);
    add(getWordInDirection(pending[0].row, pending[0].col, 'V'), `V${pending[0].col}`);
  }
  return words;
}

// ─── Placement validation ─────────────────────────────────────────────────────
function validatePlacement(pending) {
  if (pending.length === 0) return 'Sijoita ensin nappuloita laudalle.';

  const rows = pending.map(p => p.row), cols = pending.map(p => p.col);
  if (new Set(rows).size > 1 && new Set(cols).size > 1)
    return 'Nappulat täytyy asettaa samalle riville tai sarakkeelle.';

  if (pending.length > 1) {
    if (new Set(rows).size === 1) {
      const row = rows[0], mn = Math.min(...cols), mx = Math.max(...cols);
      for (let c = mn; c <= mx; c++) if (!board[row][c]) return 'Nappulat eivät muodosta yhtenäistä jonoa.';
    } else {
      const col = cols[0], mn = Math.min(...rows), mx = Math.max(...rows);
      for (let r = mn; r <= mx; r++) if (!board[r][col]) return 'Nappulat eivät muodosta yhtenäistä jonoa.';
    }
  }

  let boardHasTiles = false;
  outer: for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c]?.fixed) { boardHasTiles = true; break outer; }

  if (!boardHasTiles) {
    if (!pending.some(p => p.row === 7 && p.col === 7))
      return 'Ensimmäinen sana täytyy kulkea keskiruudun (★) kautta.';
  } else {
    const connected = pending.some(({ row, col }) =>
      [[row-1,col],[row+1,col],[row,col-1],[row,col+1]].some(
        ([r, c]) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c]?.fixed
      )
    );
    if (!connected) return 'Sanan täytyy liittyä laudalla oleviin kirjaimiin.';
  }
  return null;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreWords(words, pending) {
  const pendingSet = new Set(pending.map(p => `${p.row},${p.col}`));
  let total = 0;
  const summaries = [];

  for (const { word, cells } of words) {
    let letterSum = 0, wordMult = 1;
    for (const { row, col, tile } of cells) {
      const isNew = pendingSet.has(`${row},${col}`);
      let val = tile.points;
      if (isNew) {
        const prem = premiumType(row, col);
        if (prem === 'DL') val *= 2;
        else if (prem === 'TL') val *= 3;
        if (prem === 'DW') wordMult *= 2;
        else if (prem === 'TW') wordMult *= 3;
      }
      letterSum += val;
    }
    let ws = letterSum * wordMult;
    if (word.length > 6) ws += FINNISH_BONUS;
    total += ws;
    summaries.push(`${word.toUpperCase()} (${ws}p)`);
  }

  if (pending.length >= RACK_SIZE) { total += BINGO_BONUS; summaries.push(`+${BINGO_BONUS} bingo!`); }
  return { total, summaries };
}

// ─── Submit move ──────────────────────────────────────────────────────────────
function submitMove() {
  if (gameOver) return;
  cancelHold();

  const pending = getPendingTiles();
  const err = validatePlacement(pending);
  if (err) { showMessage(err, 'error'); return; }

  const words = extractAllWords(pending);
  if (words.length === 0) { showMessage('Ei muodostunut sanoja.', 'error'); return; }

  const invalid = words.filter(w => !isValidWord(w.word));
  if (invalid.length > 0) {
    showMessage(`Virheellinen sana: ${invalid.map(w => w.word.toUpperCase()).join(', ')}`, 'error');
    return;
  }

  const { total, summaries } = scoreWords(words, pending);
  for (const { row, col } of pending) board[row][col].fixed = true;
  players[currentPlayer].score += total;
  consecutivePasses = 0;

  clearValidationUI();
  showMessage(`${summaries.join('  ')} — ${total} p`, 'success', currentPlayer);

  refillRack(currentPlayer);
  if (players[currentPlayer].rack.length === 0 && tileBag.length === 0) { endGame(); return; }

  currentPlayer = 1 - currentPlayer;
  renderBoard();
  updateUI();
  if (!players[currentPlayer].isHuman) { scheduleAiMove(); } else { renderRack(); }
}

// ─── Pass move ────────────────────────────────────────────────────────────────
function passMove() {
  if (gameOver) return;
  cancelHold();
  if (getPendingTiles().length > 0) { showMessage('Palauta nappulat ensin tai hyväksy siirto.', 'error'); return; }

  consecutivePasses++;
  showMessage(`${players[currentPlayer].name} ohitti.`, 'info', currentPlayer);
  if (consecutivePasses >= 4) { endGame(); return; }

  currentPlayer = 1 - currentPlayer;
  updateUI();
  if (!players[currentPlayer].isHuman) { scheduleAiMove(); } else { renderRack(); }
}

// ─── AI turn ──────────────────────────────────────────────────────────────────
function scheduleAiMove() {
  showMessage('Miettii...', 'info', 1);
  requestAnimationFrame(() => setTimeout(doAiMove, 80));
}

function doAiMove() {
  const move = findBestMove(board, players[currentPlayer].rack, aiDifficulty);
  if (!move) {
    if (tileBag.length > 0) {
      // Exchange the lowest-value tiles instead of passing
      const rack = players[currentPlayer].rack;
      const sorted = rack.map((t, i) => ({ t, i })).sort((a, b) => a.t.points - b.t.points);
      const n = Math.min(Math.ceil(rack.length / 2), tileBag.length);
      const toSwap = sorted.slice(0, n);
      toSwap.sort((a, b) => b.i - a.i).forEach(({ i }) => {
        tileBag.push({ letter: rack[i].letter, points: rack[i].points });
        rack.splice(i, 1);
      });
      shuffle(tileBag);
      refillRack(currentPlayer);
      consecutivePasses = 0;
      showMessage(`Vaihtaa ${n} nappulaa...`, 'info', 1);
    } else {
      consecutivePasses++;
      showMessage(`${players[currentPlayer].name} ohitti.`, 'info', 1);
      if (consecutivePasses >= 4) { endGame(); return; }
    }
    currentPlayer = 1 - currentPlayer;
    renderRack(); updateUI();
    return;
  }

  for (const { row, col, tile } of move.tiles) board[row][col] = { ...tile, fixed: true };
  for (const { tile } of move.tiles) {
    const idx = players[currentPlayer].rack.findIndex(t => t.letter === tile.letter);
    if (idx >= 0) players[currentPlayer].rack.splice(idx, 1);
  }

  players[currentPlayer].score += move.score;
  consecutivePasses = 0;
  showMessage(`${move.word.toUpperCase()} — ${move.score} p`, 'success', 1);
  refillRack(currentPlayer);

  if (players[currentPlayer].rack.length === 0 && tileBag.length === 0) { endGame(); return; }

  currentPlayer = 1 - currentPlayer;
  renderBoard(); renderRack(); updateUI();
}

// ─── End game ─────────────────────────────────────────────────────────────────
function endGame() {
  gameOver = true;
  const r0 = players[0].rack.reduce((s, t) => s + t.points, 0);
  const r1 = players[1].rack.reduce((s, t) => s + t.points, 0);

  if      (players[0].rack.length === 0) { players[0].score += r1; players[1].score -= r1; }
  else if (players[1].rack.length === 0) { players[1].score += r0; players[0].score -= r0; }
  else                                   { players[0].score -= r0; players[1].score -= r1; }

  let winnerIdx;
  if      (players[0].score > players[1].score) winnerIdx = 0;
  else if (players[1].score > players[0].score) winnerIdx = 1;

  if (winnerIdx !== undefined) {
    const w = players[winnerIdx], l = players[1 - winnerIdx];
    const exp   = 1 / (1 + Math.pow(10, (l.rating - w.rating) / RATING_SCALE));
    const delta = Math.round(K_FACTOR * (1 - exp));
    w.rating = Math.max(800, w.rating + delta);
    l.rating = Math.max(800, l.rating - delta);
  }

  updateUI();
  document.getElementById('submit').disabled = true;
  document.getElementById('pass').disabled   = true;

  const result = winnerIdx !== undefined
    ? `Peli ohi! ${players[winnerIdx].name} voitti! ${players[0].score}–${players[1].score}`
    : `Peli ohi! Tasapeli! ${players[0].score}–${players[1].score}`;

  showMessage(result, 'success', 0);
  showMessage('', 'info', 1);
}

// ─── Tile exchange ────────────────────────────────────────────────────────────
function enterExchangeMode() {
  if (gameOver || !players[currentPlayer].isHuman) return;
  if (getPendingTiles().length > 0) { showMessage('Palauta nappulat ensin.', 'error'); return; }
  if (tileBag.length === 0) { showMessage('Pussi on tyhjä — ei voi vaihtaa.', 'error'); return; }
  cancelHold();
  exchangeMode = true;
  exchangeSelected.clear();
  renderRack();
  updateExchangeUI();
  showMessage('Valitse vaihdettavat nappulat.', 'info');
}

function cancelExchangeMode() {
  exchangeMode = false;
  exchangeSelected.clear();
  renderRack();
  updateExchangeUI();
}

function confirmExchange() {
  if (exchangeSelected.size === 0 || tileBag.length === 0) return;
  const rack = players[currentPlayer].rack;
  const indices = [...exchangeSelected].sort((a, b) => b - a); // descending for safe splice
  const returned = indices.map(i => ({ letter: rack[i].letter, points: rack[i].points }));
  indices.forEach(i => rack.splice(i, 1));
  returned.forEach(t => tileBag.push(t));
  shuffle(tileBag);
  refillRack(currentPlayer);
  consecutivePasses = 0;

  const n = returned.length;
  showMessage(`Vaihdettiin ${n} nappula${n > 1 ? 'a' : ''}.`, 'info', currentPlayer);

  cancelExchangeMode();
  currentPlayer = 1 - currentPlayer;
  updateUI();
  if (!players[currentPlayer].isHuman) scheduleAiMove();
  else renderRack();
}

function updateExchangeUI() {
  const exBtn   = document.getElementById('exchange');
  const cfBtn   = document.getElementById('exchange-confirm');
  const isHuman = players[currentPlayer].isHuman;

  if (exchangeMode) {
    exBtn.textContent = 'Peruuta';
    exBtn.classList.add('btn-ghost');
    cfBtn.style.display = '';
    cfBtn.disabled = exchangeSelected.size === 0;
    document.getElementById('submit').disabled = true;
    document.getElementById('pass').disabled   = true;
    document.getElementById('recall').disabled = true;
  } else {
    exBtn.textContent = 'Vaihda';
    exBtn.classList.remove('btn-ghost');
    cfBtn.style.display = 'none';
    document.getElementById('submit').disabled = gameOver || !isHuman;
    document.getElementById('pass').disabled   = gameOver || !isHuman;
    document.getElementById('recall').disabled = false;
    exBtn.disabled = gameOver || !isHuman || tileBag.length === 0;
  }
}

// ─── Buttons ──────────────────────────────────────────────────────────────────
document.getElementById('submit').addEventListener('click',           submitMove);
document.getElementById('pass').addEventListener('click',             passMove);
document.getElementById('exchange').addEventListener('click',         () => exchangeMode ? cancelExchangeMode() : enterExchangeMode());
document.getElementById('exchange-confirm').addEventListener('click', confirmExchange);
document.getElementById('recall').addEventListener('click',           recallTiles);
document.getElementById('new-game').addEventListener('click',         showSetup);

// ─── Setup ────────────────────────────────────────────────────────────────────
function showSetup() {
  recallTiles();
  document.getElementById('setup-overlay').style.display = 'flex';
}

document.getElementById('start-game').addEventListener('click', () => {
  aiDifficulty = document.querySelector('input[name="difficulty"]:checked')?.value ?? 'easy';
  document.getElementById('setup-overlay').style.display = 'none';
  initGame();
});

document.getElementById('open-feedback').addEventListener('click', e => {
  e.preventDefault();
  document.getElementById('setup-overlay').style.display = 'none';
  document.getElementById('feedback-overlay').style.display = 'flex';
});

document.getElementById('close-feedback').addEventListener('click', () => {
  document.getElementById('feedback-overlay').style.display = 'none';
  document.getElementById('setup-overlay').style.display = 'flex';
});

showSetup();
