# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Vanilla-JS Tetris (HTML5 Canvas). No dependencies, no build step, no tests, no linter. The README is written in Spanish; keep it that way when editing it.

## Running

Open `index.html` directly, or serve statically: `python3 -m http.server 8000` and visit `http://localhost:8000`.

## Architecture

Three files, loaded by `index.html` with a plain `<script>` tag (no modules):

- `index.html` — DOM skeleton: `#board` canvas, `#next-canvas` preview, HUD elements (`#score`, `#lines`, `#level`), and `#overlay` (pause / game over, with `#restart-btn`).
- `style.css` — layout and theming.
- `game.js`source ~/.zshrc (~300 lines) — all game logic in one global scope:
  - Constants at top: `COLS`/`ROWS`/`BLOCK` (10×20, 30px), `COLORS`, `PIECES` (shape matrices indexed by color index), `LINE_SCORES`.
  - Mutable state is a set of top-level `let`s (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, ...), all reset in `init()`. `restartBtn` calls `init` again.
  - Game loop: `loop(ts)` driven by `requestAnimationFrame`, accumulating time in `dropAccum` against `dropInterval` (which shrinks with level) to gravity-drop the current piece. `lockPiece` → `merge` → `clearLines` → `spawn` is the lock pipeline; `spawn` triggers `endGame` on immediate collision.
  - Rotation (`tryRotate`) rotates the matrix with `rotateCW` and tries wall-kick offsets via `collide`.
  - Rendering is separate from logic: `draw()` (board, ghost piece via `ghostY`, current piece) and `drawNext()`; both use `drawBlock`.
  - Input: a single `keydown` listener at the bottom of `game.js` dispatches all controls.
