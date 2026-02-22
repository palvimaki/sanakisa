// ai.js — Sanakisa computer opponent

import { isValidWord } from './dictionary.js';
import { BOARD_SIZE, PREMIUMS, BINGO_BONUS, FINNISH_BONUS, RACK_SIZE } from './board-config.js';

let _wordListDesc = []; // long words first (medium / hard — best candidates up front)
let _wordListAsc  = []; // short words first (easy — weaker candidates up front)

// Called once after dictionary loads.
export function setWordList(list) {
  _wordListDesc = [...list].sort((a, b) => b.length - a.length);
  _wordListAsc  = [..._wordListDesc].reverse();
}

// ─── Main entry ───────────────────────────────────────────────────────────────
// Returns {tiles:[{row,col,tile}], score, word} or null (AI should pass/exchange)
export function findBestMove(board, rack, difficulty = 'easy') {
  if (_wordListDesc.length === 0 || rack.length === 0) return null;

  const timeLimit = difficulty === 'hard' ? 4000 : difficulty === 'medium' ? 2000 : 800;
  const deadline  = Date.now() + timeLimit;
  const anchors   = getAnchorSquares(board);
  if (anchors.length === 0) return null;

  const wordList   = difficulty === 'easy' ? _wordListAsc : _wordListDesc;
  const candidates = preFilterWords(wordList, board, rack);

  const byRow = {}, byCol = {};
  for (const { row, col } of anchors) {
    (byRow[row] ??= []).push(col);
    (byCol[col] ??= []).push(row);
  }

  let best = null, bestScore = -Infinity;
  const allMoves = []; // collected for easy mode random pick

  for (const word of candidates) {
    if (Date.now() > deadline) break;

    // ── Horizontal placements ──
    for (const [rowStr, anchorCols] of Object.entries(byRow)) {
      const row = +rowStr;
      const maxStart = BOARD_SIZE - word.length;

      for (let startCol = 0; startCol <= maxStart; startCol++) {
        const endCol = startCol + word.length - 1;
        if (!anchorCols.some(c => c >= startCol && c <= endCol)) continue;
        if (startCol > 0 && board[row][startCol - 1]) continue;
        if (endCol < BOARD_SIZE - 1 && board[row][endCol + 1]) continue;

        const tiles = tryPlace(board, word, row, startCol, 'H', rack);
        if (!tiles) continue;

        for (const { row: r, col: c, tile: t } of tiles) board[r][c] = t;
        const crossOk = validateCrossWords(board, tiles, 'H');
        const score   = crossOk ? computeScore(board, tiles) : -1;
        for (const { row: r, col: c } of tiles) board[r][c] = null;

        if (score > 0) {
          if (difficulty === 'easy') {
            allMoves.push({ tiles, score, word });
          } else if (score > bestScore) {
            bestScore = score;
            best = { tiles, score, word };
          }
        }
      }
    }

    // ── Vertical placements ──
    for (const [colStr, anchorRows] of Object.entries(byCol)) {
      const col = +colStr;
      const maxStart = BOARD_SIZE - word.length;

      for (let startRow = 0; startRow <= maxStart; startRow++) {
        const endRow = startRow + word.length - 1;
        if (!anchorRows.some(r => r >= startRow && r <= endRow)) continue;
        if (startRow > 0 && board[startRow - 1][col]) continue;
        if (endRow < BOARD_SIZE - 1 && board[endRow + 1][col]) continue;

        const tiles = tryPlace(board, word, col, startRow, 'V', rack);
        if (!tiles) continue;

        for (const { row: r, col: c, tile: t } of tiles) board[r][c] = t;
        const crossOk = validateCrossWords(board, tiles, 'V');
        const score   = crossOk ? computeScore(board, tiles) : -1;
        for (const { row: r, col: c } of tiles) board[r][c] = null;

        if (score > 0) {
          if (difficulty === 'easy') {
            allMoves.push({ tiles, score, word });
          } else if (score > bestScore) {
            bestScore = score;
            best = { tiles, score, word };
          }
        }
      }
    }
  }

  // Easy: pick randomly from the top 3 scoring moves found
  if (difficulty === 'easy') {
    if (allMoves.length === 0) return null;
    allMoves.sort((a, b) => b.score - a.score);
    const topN = Math.min(3, allMoves.length);
    return allMoves[Math.floor(Math.random() * topN)];
  }

  return bestScore > 0 ? best : null;
}

// ─── Anchor squares ───────────────────────────────────────────────────────────
function getAnchorSquares(board) {
  let hasTiles = false;
  outer: for (let r = 0; r < BOARD_SIZE; r++)
    for (let c = 0; c < BOARD_SIZE; c++)
      if (board[r][c]?.fixed) { hasTiles = true; break outer; }

  if (!hasTiles) return [{ row: 7, col: 7 }];

  const anchors = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c]) continue;
      if ([[r-1,c],[r+1,c],[r,c-1],[r,c+1]].some(
        ([nr, nc]) => nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE && board[nr]?.[nc]?.fixed
      )) anchors.push({ row: r, col: c });
    }
  }
  return anchors;
}

// ─── Pre-filter words ─────────────────────────────────────────────────────────
function preFilterWords(wordList, board, rack) {
  const freq = {};
  let blanks = 0;

  for (const t of rack) {
    if (t.letter === ' ') blanks++;
    else freq[t.letter] = (freq[t.letter] || 0) + 1;
  }
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const t = board[r][c];
      if (!t) continue;
      const l = t.letter === ' ' ? t.assignedLetter : t.letter;
      freq[l] = (freq[l] || 0) + 1;
    }
  }

  return wordList.filter(word => {
    const upper = word.toUpperCase();
    const wFreq = {};
    for (const l of upper) wFreq[l] = (wFreq[l] || 0) + 1;
    let need = 0;
    for (const [l, n] of Object.entries(wFreq)) {
      const have = freq[l] || 0;
      if (have < n) need += n - have;
    }
    return need <= blanks;
  });
}

// ─── Try to place a word ──────────────────────────────────────────────────────
function tryPlace(board, word, lineVal, startPos, dir, rack) {
  const rackCopy = rack.map(t => ({ ...t }));
  const tiles = [];

  for (let i = 0; i < word.length; i++) {
    const letter = word[i].toUpperCase();
    const r = dir === 'H' ? lineVal : startPos + i;
    const c = dir === 'H' ? startPos + i : lineVal;

    const existing = board[r]?.[c];
    if (existing) {
      const el = (existing.letter === ' ' ? existing.assignedLetter : existing.letter).toUpperCase();
      if (el !== letter) return null;
    } else {
      const idx = rackCopy.findIndex(t => t.letter === letter);
      if (idx >= 0) {
        const t = rackCopy.splice(idx, 1)[0];
        tiles.push({ row: r, col: c, tile: { ...t, fixed: true } });
      } else {
        const blankIdx = rackCopy.findIndex(t => t.letter === ' ');
        if (blankIdx < 0) return null;
        const t = rackCopy.splice(blankIdx, 1)[0];
        tiles.push({ row: r, col: c, tile: { ...t, assignedLetter: letter, fixed: true } });
      }
    }
  }

  return tiles.length > 0 ? tiles : null;
}

// ─── Cross-word validation ────────────────────────────────────────────────────
function validateCrossWords(board, tiles, dir) {
  const crossDir = dir === 'H' ? 'V' : 'H';
  for (const { row, col } of tiles) {
    const cw = getWordAt(board, row, col, crossDir);
    if (cw && !isValidWord(cw.word)) return false;
  }
  return true;
}

// ─── Word extraction helper ───────────────────────────────────────────────────
function getWordAt(board, row, col, dir) {
  const dr = dir === 'V' ? 1 : 0;
  const dc = dir === 'H' ? 1 : 0;
  let r = row, c = col;
  while (r - dr >= 0 && c - dc >= 0 && board[r - dr]?.[c - dc]) { r -= dr; c -= dc; }

  const cells = [];
  while (r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r]?.[c]) {
    cells.push({ row: r, col: c, tile: board[r][c] });
    r += dr; c += dc;
  }
  if (cells.length < 2) return null;

  const word = cells.map(({ tile: t }) =>
    (t.letter === ' ' ? t.assignedLetter : t.letter).toLowerCase()
  ).join('');
  return { word, cells };
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function computeScore(board, tiles) {
  const pendingSet = new Set(tiles.map(({ row, col }) => `${row},${col}`));
  const seenKeys = new Set();
  let total = 0;

  for (const { row, col } of tiles) {
    for (const dir of ['H', 'V']) {
      const w = getWordAt(board, row, col, dir);
      if (!w) continue;
      const key = dir === 'H'
        ? `H${row},${w.cells[0].col}`
        : `V${col},${w.cells[0].row}`;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      let letterSum = 0, wordMult = 1;
      for (const { row: r, col: c, tile: t } of w.cells) {
        const isNew = pendingSet.has(`${r},${c}`);
        let val = t.points;
        if (isNew) {
          const prem = getPremType(r, c);
          if (prem === 'DL') val *= 2;
          else if (prem === 'TL') val *= 3;
          if (prem === 'DW') wordMult *= 2;
          else if (prem === 'TW') wordMult *= 3;
        }
        letterSum += val;
      }
      let ws = letterSum * wordMult;
      if (w.word.length > 6) ws += FINNISH_BONUS;
      total += ws;
    }
  }

  if (tiles.length >= RACK_SIZE) total += BINGO_BONUS;
  return total;
}

function getPremType(row, col) {
  if (PREMIUMS.TW.some(([r, c]) => r === row && c === col)) return 'TW';
  if (PREMIUMS.DW.some(([r, c]) => r === row && c === col)) return 'DW';
  if (PREMIUMS.TL.some(([r, c]) => r === row && c === col)) return 'TL';
  if (PREMIUMS.DL.some(([r, c]) => r === row && c === col)) return 'DL';
  return null;
}
