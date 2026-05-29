// ============================================================
//  PAC-BEAR  –  Vanilla JS / HTML5 Canvas
// ============================================================

const canvas  = document.getElementById('gameCanvas');
const ctx     = canvas.getContext('2d');
const scoreEl = document.getElementById('scoreDisplay');
const livesEl = document.getElementById('livesDisplay');
const levelEl = document.getElementById('levelDisplay');
const msgEl   = document.getElementById('message');

// ── Grid constants ──────────────────────────────────────────
const CELL   = 24;   // px per grid cell
const COLS   = 21;
const ROWS   = 23;

canvas.width  = COLS * CELL;
canvas.height = ROWS * CELL;

// ── Maze template  (1=wall, 0=dot, 2=empty/no-dot, 3=power pellet) ──
// 21 columns × 23 rows
const originalMaze = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,3,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,3,1],
  [1,0,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,0,1,1,1,1,1,1,1,0,1,0,1,1,0,1],
  [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
  [1,1,1,1,0,1,1,1,2,1,1,1,2,1,1,1,0,1,1,1,1],
  [1,1,1,1,0,1,2,2,2,2,2,2,2,2,2,1,0,1,1,1,1],
  [1,1,1,1,0,1,2,1,1,2,2,2,1,1,2,1,0,1,1,1,1],
  [2,2,2,2,0,2,2,1,2,2,2,2,2,1,2,2,0,2,2,2,2],
  [1,1,1,1,0,1,2,1,1,1,1,1,1,1,2,1,0,1,1,1,1],
  [1,1,1,1,0,1,2,2,2,2,2,2,2,2,2,1,0,1,1,1,1],
  [1,1,1,1,0,1,2,1,1,1,1,1,1,1,2,1,0,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,1,1,0,1,1,1,0,1,1,1,0,1,1,0,1],
  [1,3,0,1,0,0,0,0,0,0,2,0,0,0,0,0,0,1,0,3,1],
  [1,1,0,1,0,1,0,1,1,1,1,1,1,1,0,1,0,1,0,1,1],
  [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],
  [1,0,1,1,1,1,1,1,0,1,1,1,0,1,1,1,1,1,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,0,1,1,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// Deep-copy helper
function copyMaze(src) {
  return src.map(row => [...row]);
}

// ── Game state ───────────────────────────────────────────────
let maze, score, lives, level, gameState;
let totalDots = 0;
let dotsEaten = 0;

// ── Score Manager ───────────────────────────────────────────
const ScoreManager = {
  highScore: 0,
  isNewHighScore: false,
  playerName: '',   // set to a non-empty string to use a custom name; defaults to 'Anonymous'

  async load() {
    try {
      const res = await fetch('/api/scores?limit=1');
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          this.highScore = data[0].score; // Set high score to the top DB entry
          console.log("Loaded high score from db, ", this.highScore);
          updateHUD(); // Refresh the screen text
        } else {
          this.highScore = 0;
        }
      } else {
        this.highScore = 0;
      }
    } catch (e) {
      console.log("Could not fetch high score from server, using 0.");
      this.highScore = 0;
    }
    updateHUD();
  },

  checkAndSave(score) {
    if (score > this.highScore) {
      this.highScore = score;
      this.isNewHighScore = true;
      try {
        localStorage.setItem('pac-bear-high-score', score);
      } catch (e) {
        // Storage full or unavailable — high score held in memory only
      }
      return true;
    }
    return false;
  },

  // Async — non-blocking. Falls back to localStorage on any error.
  async submitScore(score) {
    const name = (this.playerName && this.playerName.trim()) ? this.playerName.trim() : 'Anonymous';
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch('/api/scores', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ player_name: name, score }),
        signal:  controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
  
      await this.load();
      
    } catch (_err) {
      // Network error, timeout, or non-2xx — fall back to localStorage silently
      //try { localStorage.setItem('pac-bear-high-score', score); } catch (_) { /* ignore */ }
    } finally {
      clearTimeout(timeoutId);
    }
  },
};

// ── Particle System ─────────────────────────────────────────
const ParticleSystem = {
  trailParticles:     [],
  explosionParticles: [],
  sparkleParticles:   [],
  confettiParticles:  [],

  spawnTrail(x, y) {
    if (this.trailParticles.length >= 60) this.trailParticles.shift();
    const trailColors = ['#790ECB', '#9b30e8', '#c084fc'];
    this.trailParticles.push({
      x,
      y,
      vx:       0,
      vy:       0,
      radius:   2 + Math.random() * 3,           // [2, 5)
      color:    trailColors[Math.floor(Math.random() * trailColors.length)],
      lifetime: 8 + Math.floor(Math.random() * 13), // [8, 20]
      age:      0,
    });
  },

  spawnExplosion(x, y, colors, count) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI;
      const speed = 1 + Math.random() * 2;       // [1, 3)
      this.explosionParticles.push({
        x,
        y,
        vx:       Math.cos(angle) * speed,
        vy:       Math.sin(angle) * speed,
        radius:   2 + Math.random() * 2,          // [2, 4)
        color:    colors[i % colors.length],
        lifetime: 20 + Math.floor(Math.random() * 21), // [20, 40]
        age:      0,
      });
    }
  },

  spawnSparkle(x, y) {
    const sparkleColors = ['#ffffff', '#c084fc'];
    const count = 6 + Math.floor(Math.random() * 5); // [6, 10]
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * 2 * Math.PI;
      const speed = 1 + Math.random() * 2;            // [1, 3)
      this.sparkleParticles.push({
        x,
        y,
        vx:       Math.cos(angle) * speed,
        vy:       Math.sin(angle) * speed,
        radius:   2 + Math.random() * 2,               // [2, 4)
        color:    sparkleColors[Math.floor(Math.random() * sparkleColors.length)],
        lifetime: 15 + Math.floor(Math.random() * 16), // [15, 30]
        age:      0,
      });
    }
  },

  spawnConfetti() {
    const confettiColors = ['#790ECB', '#c084fc', '#ffffff', '#ffb852', '#00ffff'];
    const count = 60 + Math.floor(Math.random() * 41); // [60, 100]
    for (let i = 0; i < count; i++) {
      this.confettiParticles.push({
        x:        Math.random() * canvas.width,
        y:        0,
        vx:       -1 + Math.random() * 2,              // [-1, 1)
        vy:       1 + Math.random() * 2,               // [1, 3)
        radius:   3 + Math.random() * 2,               // [3, 5)
        color:    confettiColors[Math.floor(Math.random() * confettiColors.length)],
        lifetime: 90 + Math.floor(Math.random() * 61), // [90, 150]
        age:      0,
      });
    }
  },

  update() {
    const advance = arr => arr
      .map(p => { p.age++; p.x += p.vx; p.y += p.vy; return p; })
      .filter(p => p.age < p.lifetime);

    this.trailParticles     = advance(this.trailParticles);
    this.explosionParticles = advance(this.explosionParticles);
    this.sparkleParticles   = advance(this.sparkleParticles);
    this.confettiParticles  = advance(this.confettiParticles);
  },

  draw(ctx) {
    const drawArray = arr => {
      arr.forEach(p => {
        ctx.globalAlpha = (p.lifetime - p.age) / p.lifetime;
        ctx.fillStyle   = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };

    drawArray(this.trailParticles);
    drawArray(this.explosionParticles);
    drawArray(this.sparkleParticles);
    drawArray(this.confettiParticles);
  },

  clearAll() {
    this.trailParticles     = [];
    this.explosionParticles = [];
    this.sparkleParticles   = [];
    this.confettiParticles  = [];
  },

  clearExplosions() {
    this.explosionParticles = [];
  },
};

// ── Player ───────────────────────────────────────────────────
const PLAYER_SPEED = 6;   // frames between moves
let player;

// ── Ghosts ───────────────────────────────────────────────────
const GHOST_SPEED  = 12;  // frames between moves (slower than player)
const GHOST_COLORS = ['#ff4444', '#ffb8ff', '#00ffff', '#ffb852'];
let ghosts;

// ── Kiro logo image ──────────────────────────────────────────
const kiroImg = new Image();
kiroImg.src   = 'BearIcon.png';
//kiroImg.src   = 'kiro-logo.png';

// ── Input ────────────────────────────────────────────────────
const keys = {};
let   pendingDir = null;   // buffered next direction

document.addEventListener('keydown', e => {
  keys[e.key] = true;

  const dirMap = {
    ArrowUp:    { x: 0, y: -1 },
    ArrowDown:  { x: 0, y:  1 },
    ArrowLeft:  { x: -1, y: 0 },
    ArrowRight: { x:  1, y: 0 },
  };

  if (dirMap[e.key]) {
    pendingDir = dirMap[e.key];
    if (gameState === 'start') startGame();
    e.preventDefault();
  }
});

document.addEventListener('keyup', e => { keys[e.key] = false; });

// ── Initialise / reset ───────────────────────────────────────
function initGame() {
  // ScoreManager.load() is called once at boot (see bottom of file).
  // Do NOT call it here — it would overwrite the in-memory highScore
  // that checkAndSave() just updated when the previous game ended.
  maze      = copyMaze(originalMaze);
  score     = 0;
  lives     = 3;
  level     = 1;
  gameState = 'start';
  dotsEaten = 0;
  pendingDir = null;

  // Count total dots + power pellets
  totalDots = 0;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (maze[r][c] === 0 || maze[r][c] === 3) totalDots++;

  resetPositions();
  updateHUD();
}

function resetPositions() {
  player = {
    col: 10, row: 16,
    dir: { x: 0, y: 0 },
    nextDir: null,
    frame: 0,
    mouthAngle: 0,
    mouthDir: 1,
    powered: false,
    powerTimer: 0,
  };

  ghosts = [
    makeGhost(10, 9,  0),
    makeGhost(9,  10, 1),
    makeGhost(11, 10, 2),
    makeGhost(10, 11, 3),
  ];
}

function makeGhost(col, row, colorIdx) {
  return {
    col, row,
    colorIdx,
    dir: randomDir(),
    frame: Math.floor(Math.random() * GHOST_SPEED), // stagger starts
    scared: false,
    scaredTimer: 0,
    eaten: false,
  };
}

function randomDir() {
  const dirs = [
    { x: 1, y: 0 }, { x: -1, y: 0 },
    { x: 0, y: 1 }, { x: 0, y: -1 },
  ];
  return dirs[Math.floor(Math.random() * dirs.length)];
}

// ── Start game ───────────────────────────────────────────────
function startGame() {
  gameState  = 'playing';
  player.frame = 0;
  ghosts.forEach(g => g.frame = Math.floor(Math.random() * GHOST_SPEED));
  msgEl.textContent = '';
}

// ── HUD update ───────────────────────────────────────────────
function updateHUD() {
  scoreEl.textContent = score;
  livesEl.textContent = '♥ '.repeat(lives).trim();
  levelEl.textContent = level;
  const highScoreEl = document.getElementById('highScoreDisplay');
  if (highScoreEl) highScoreEl.textContent = ScoreManager.highScore;
}

// ── Collision helpers ────────────────────────────────────────
function isWall(col, row) {
  if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return true;
  return maze[row][col] === 1;
}

// Wrap-around tunnel (row 10 is the open corridor)
function wrapCol(col) {
  if (col < 0)    return COLS - 1;
  if (col >= COLS) return 0;
  return col;
}

// ── Player movement ──────────────────────────────────────────
function movePlayer() {
  player.frame++;
  if (player.frame < PLAYER_SPEED) return;
  player.frame = 0;

  // Try to apply buffered direction first
  if (pendingDir) {
    const nc = player.col + pendingDir.x;
    const nr = player.row + pendingDir.y;
    if (!isWall(wrapCol(nc), nr)) {
      player.dir = pendingDir;
    }
    pendingDir = null;
  }

  // Move in current direction
  if (player.dir.x !== 0 || player.dir.y !== 0) {
    const nc = wrapCol(player.col + player.dir.x);
    const nr = player.row + player.dir.y;
    if (!isWall(nc, nr)) {
      player.col = nc;
      player.row = nr;
      if (gameState === 'playing' && (player.dir.x !== 0 || player.dir.y !== 0)) {
        ParticleSystem.spawnTrail(player.col * CELL + CELL / 2, player.row * CELL + CELL / 2);
      }
    }
  }

  // Eat dot / power pellet
  const cell = maze[player.row][player.col];
  if (cell === 0) {
    maze[player.row][player.col] = 2;
    score     += 10;
    dotsEaten++;
    updateHUD();
  } else if (cell === 3) {
    maze[player.row][player.col] = 2;
    score     += 50;
    dotsEaten++;
    activatePower();
    ParticleSystem.spawnSparkle(player.col * CELL + CELL / 2, player.row * CELL + CELL / 2);
    updateHUD();
  }

  // Level complete?
  if (dotsEaten >= totalDots) {
    gameState = 'levelComplete';
    msgEl.textContent = '🎉 Level Complete! Press any arrow key for next level';
  }
}

function activatePower() {
  player.powered    = true;
  player.powerTimer = 300; // ~5 seconds at 60fps
  ghosts.forEach(g => { g.scared = true; g.scaredTimer = 300; });
}

// ── Ghost movement ───────────────────────────────────────────
function moveGhosts() {
  ghosts.forEach(g => {
    if (g.eaten) return;

    // Power timer countdown
    if (g.scared) {
      g.scaredTimer--;
      if (g.scaredTimer <= 0) g.scared = false;
    }

    g.frame++;
    if (g.frame < GHOST_SPEED) return;
    g.frame = 0;

    // Try to keep going in current direction; if blocked, pick random valid dir
    const nc = wrapCol(g.col + g.dir.x);
    const nr = g.row + g.dir.y;

    if (!isWall(nc, nr)) {
      g.col = nc;
      g.row = nr;
    } else {
      // Pick a new random direction that isn't a wall
      const dirs = [
        { x: 1, y: 0 }, { x: -1, y: 0 },
        { x: 0, y: 1 }, { x: 0, y: -1 },
      ].filter(d => !isWall(wrapCol(g.col + d.x), g.row + d.y));

      if (dirs.length > 0) {
        g.dir = dirs[Math.floor(Math.random() * dirs.length)];
        g.col = wrapCol(g.col + g.dir.x);
        g.row = g.row + g.dir.y;
      }
    }
  });
}

// ── Ghost–player collision ───────────────────────────────────
function checkGhostCollision() {
  ghosts.forEach(g => {
    if (g.eaten) return;
    if (g.col === player.col && g.row === player.row) {
      if (g.scared) {
        // Eat the ghost
        g.eaten = true;
        score  += 200;
        updateHUD();
        const count = 8 + Math.floor(Math.random() * 5);
        ParticleSystem.spawnExplosion(g.col * CELL + CELL / 2, g.row * CELL + CELL / 2, [GHOST_COLORS[g.colorIdx]], count);
        // Respawn ghost after a delay
        setTimeout(() => {
          g.col   = 10;
          g.row   = 9;
          g.dir   = randomDir();
          g.eaten = false;
          g.scared = false;
        }, 3000);
      } else {
        // Player dies
        lives--;
        updateHUD();
        const count = 12 + Math.floor(Math.random() * 9);
        ParticleSystem.spawnExplosion(player.col * CELL + CELL / 2, player.row * CELL + CELL / 2, ['#ff4444'], count);
        if (lives <= 0) {
          const isNew = ScoreManager.checkAndSave(score);
          
          // Prompt for name if they hit a high score or just generally want to submit
          let name = prompt("Game Over! Enter your name for the leaderboard:", "Anonymous");
          if (!name || !name.trim()) name = "Anonymous";
          ScoreManager.playerName = name.slice(0, 50);

          ScoreManager.submitScore(score); // non-blocking; falls back to localStorage on error
          if (isNew) ParticleSystem.spawnConfetti();
          ParticleSystem.clearExplosions();
          gameState = 'gameOver';
          msgEl.textContent = '💀 Game Over! Press any arrow key to restart';
        } else {
          msgEl.textContent = '💥 Ouch! Press any arrow key to continue';
          gameState = 'dead';
          setTimeout(() => {
            resetPositions();
            pendingDir = null;
            gameState  = 'start';
            msgEl.textContent = 'Use arrow keys to move! Press any arrow key to start';
          }, 1500);
        }
      }
    }
  });
}

// ── Player power timer ───────────────────────────────────────
function updatePower() {
  if (player.powered) {
    player.powerTimer--;
    if (player.powerTimer <= 0) {
      player.powered = false;
      ghosts.forEach(g => g.scared = false);
    }
  }
}

// ── Next level ───────────────────────────────────────────────
function nextLevel() {
  level++;
  maze      = copyMaze(originalMaze);
  dotsEaten = 0;
  pendingDir = null;
  ParticleSystem.clearExplosions();
  resetPositions();
  updateHUD();
  gameState = 'start';
  msgEl.textContent = `Level ${level}! Press any arrow key to start`;
}

// ── Restart ──────────────────────────────────────────────────
function restartGame() {
  ScoreManager.isNewHighScore = false;
  ParticleSystem.clearAll();
  initGame();
  gameState = 'start';
  msgEl.textContent = 'Use arrow keys to move! Press any arrow key to start';
}

// ── Drawing ──────────────────────────────────────────────────
const WALL_COLOR   = '#790ECB';
const DOT_COLOR    = '#c084fc';
const POWER_COLOR  = '#ffffff';
const FLOOR_COLOR  = '#0d0d0d';

function drawMaze() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = c * CELL;
      const y = r * CELL;
      const cell = maze[r][c];

      if (cell === 1) {
        // Wall
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(x, y, CELL, CELL);
        // Inner glow effect
        ctx.fillStyle = '#9b30e8';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        ctx.fillStyle = WALL_COLOR;
        ctx.fillRect(x + 3, y + 3, CELL - 6, CELL - 6);
      } else {
        // Floor
        ctx.fillStyle = FLOOR_COLOR;
        ctx.fillRect(x, y, CELL, CELL);

        if (cell === 0) {
          // Dot
          ctx.fillStyle = DOT_COLOR;
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, 3, 0, Math.PI * 2);
          ctx.fill();
        } else if (cell === 3) {
          // Power pellet – pulsing
          const pulse = 0.7 + 0.3 * Math.sin(Date.now() / 200);
          ctx.fillStyle = POWER_COLOR;
          ctx.shadowColor = '#ffffff';
          ctx.shadowBlur  = 10 * pulse;
          ctx.beginPath();
          ctx.arc(x + CELL / 2, y + CELL / 2, 6 * pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
    }
  }
}

function drawPlayer() {
  const x = player.col * CELL + CELL / 2;
  const y = player.row * CELL + CELL / 2;
  const r = CELL / 2 - 2;

  // Draw Kiro logo if loaded, otherwise fallback circle
  if (kiroImg.complete && kiroImg.naturalWidth > 0) {
    ctx.save();
    // Rotate sprite to face movement direction
    const angle = Math.atan2(player.dir.y, player.dir.x);
    ctx.translate(x, y);
    if (player.dir.x !== 0 || player.dir.y !== 0) ctx.rotate(angle);
    ctx.drawImage(kiroImg, -r, -r, r * 2, r * 2);
    ctx.restore();
  } else {
    // Fallback: purple circle with mouth
    ctx.fillStyle = player.powered ? '#c084fc' : '#790ECB';
    ctx.shadowColor = '#790ECB';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Power aura
  if (player.powered) {
    ctx.strokeStyle = `rgba(192, 132, 252, ${0.4 + 0.4 * Math.sin(Date.now() / 100)})`;
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.arc(x, y, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawGhosts() {
  ghosts.forEach(g => {
    if (g.eaten) return;

    const x = g.col * CELL;
    const y = g.row * CELL;
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const r  = CELL / 2 - 2;

    let color;
    if (g.scared) {
      // Flash white when about to stop being scared
      color = (g.scaredTimer < 60 && Math.floor(Date.now() / 200) % 2 === 0)
        ? '#ffffff'
        : '#3b82f6';
    } else {
      color = GHOST_COLORS[g.colorIdx];
    }

    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 8;

    // Ghost body: semicircle top + wavy bottom
    ctx.beginPath();
    ctx.arc(cx, cy - 2, r, Math.PI, 0, false);
    // Wavy bottom
    const waveY = cy - 2 + r;
    const waveW = r * 2 / 3;
    ctx.lineTo(cx + r, waveY);
    ctx.quadraticCurveTo(cx + waveW,     waveY + 5, cx + waveW / 2, waveY);
    ctx.quadraticCurveTo(cx,             waveY + 5, cx - waveW / 2, waveY);
    ctx.quadraticCurveTo(cx - waveW,     waveY + 5, cx - r,         waveY);
    ctx.lineTo(cx - r, cy - 2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Eyes (skip when scared)
    if (!g.scared) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx - 4, cy - 4, 3, 0, Math.PI * 2);
      ctx.arc(cx + 4, cy - 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000088';
      ctx.beginPath();
      ctx.arc(cx - 3 + g.dir.x, cy - 4 + g.dir.y, 1.5, 0, Math.PI * 2);
      ctx.arc(cx + 5 + g.dir.x, cy - 4 + g.dir.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawOverlay() {
  if (gameState === 'start') {
    // Subtle dark vignette
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle   = '#790ECB';
    ctx.font        = 'bold 28px Courier New';
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#790ECB';
    ctx.shadowBlur  = 20;
    ctx.fillText('PAC-BEAR', canvas.width / 2, canvas.height / 2 - 20);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#c084fc';
    ctx.font        = '14px Courier New';
    ctx.fillText('Use arrow keys to move!', canvas.width / 2, canvas.height / 2 + 14);
    ctx.fillText('Press any arrow key to start', canvas.width / 2, canvas.height / 2 + 34);
    ctx.textAlign   = 'left';
  }

  if (gameState === 'gameOver') {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle   = '#ff4444';
    ctx.font        = 'bold 30px Courier New';
    ctx.textAlign   = 'center';

    if (ScoreManager.isNewHighScore) {
      ctx.fillStyle   = '#39FF14';
      ctx.font        = 'bold 24px Courier New';
      ctx.fillText(`Player: ${ScoreManager.playerName}`, canvas.width / 2, canvas.height / 2 + 70); // Added line
      ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 + 100); // Shifted down slightly

      ctx.shadowColor = '#c084fc';
      ctx.shadowBlur  = 14;
      ctx.fillText('✨ NEW HIGH SCORE! ✨', canvas.width / 2, canvas.height / 2 - 50);
      ctx.shadowBlur  = 0;
    }

    ctx.fillStyle   = '#ff4444';
    ctx.font        = 'bold 30px Courier New';
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur  = 20;
    ctx.fillText('GAME OVER', canvas.width / 2, canvas.height / 2 - 20);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#ffffff';
    ctx.font        = '16px Courier New';
    ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 + 14);
    ctx.fillStyle   = '#c084fc';
    ctx.font        = '13px Courier New';
    ctx.fillText('Press any arrow key to restart', canvas.width / 2, canvas.height / 2 + 40);
    ctx.textAlign   = 'left';
  }

  if (gameState === 'levelComplete') {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle   = '#790ECB';
    ctx.font        = 'bold 26px Courier New';
    ctx.textAlign   = 'center';
    ctx.shadowColor = '#790ECB';
    ctx.shadowBlur  = 20;
    ctx.fillText('LEVEL COMPLETE!', canvas.width / 2, canvas.height / 2 - 20);
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = '#c084fc';
    ctx.font        = '14px Courier New';
    ctx.fillText(`Score: ${score}`, canvas.width / 2, canvas.height / 2 + 14);
    ctx.fillText('Press any arrow key for next level', canvas.width / 2, canvas.height / 2 + 38);
    ctx.textAlign   = 'left';
  }
}

// ── Key handler for state transitions ───────────────────────
document.addEventListener('keydown', e => {
  const isArrow = ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key);
  if (!isArrow) return;

  if (gameState === 'gameOver') {
    restartGame();
  } else if (gameState === 'levelComplete') {
    nextLevel();
    startGame();
  }
});

// ── Main game loop ───────────────────────────────────────────
function gameLoop() {
  // Clear
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawMaze();

  if (gameState === 'playing') {
    movePlayer();
    moveGhosts();
    checkGhostCollision();
    updatePower();
    ParticleSystem.update();
  }

  drawGhosts();
  drawPlayer();
  if (gameState === 'playing' || gameState === 'dead') {
    ParticleSystem.draw(ctx);
  }
  drawOverlay();

  requestAnimationFrame(gameLoop);
}

// ── Boot ─────────────────────────────────────────────────────
// Wait for the server to return the high score FIRST, then start the game loop
ScoreManager.load().then(() => {
  initGame();
  gameLoop();
});
