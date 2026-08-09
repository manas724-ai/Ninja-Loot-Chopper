import { useState, useEffect, useRef, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const CANVAS_W = 480;
const CANVAS_H = 600;
const GRAVITY = 0.5;
const JUMP_V = -13;
const NINJA_W = 36;
const NINJA_H = 44;
const BLADE_W = 56;
const BLADE_H = 14;
const GROUND_Y = CANVAS_H - 60;

const LEVEL_CONFIG = [
  { level: 1,  speed: 2.2, spawnRate: 90,  tokensNeeded: 8,  name: "Rice Fields",    bg: "#1a3a1a", accent: "#4ade80" },
  { level: 2,  speed: 2.7, spawnRate: 80,  tokensNeeded: 12, name: "Bamboo Forest",  bg: "#1a2a1a", accent: "#86efac" },
  { level: 3,  speed: 3.2, spawnRate: 72,  tokensNeeded: 16, name: "Misty Valley",   bg: "#1a1a2e", accent: "#818cf8" },
  { level: 4,  speed: 3.7, spawnRate: 64,  tokensNeeded: 20, name: "Fire Dojo",      bg: "#2e1a1a", accent: "#fb923c" },
  { level: 5,  speed: 4.2, spawnRate: 58,  tokensNeeded: 25, name: "Storm Peak",     bg: "#1a1a2e", accent: "#38bdf8" },
  { level: 6,  speed: 4.8, spawnRate: 50,  tokensNeeded: 30, name: "Shadow Temple",  bg: "#0f0f1a", accent: "#c084fc" },
  { level: 7,  speed: 5.4, spawnRate: 44,  tokensNeeded: 36, name: "Ice Citadel",    bg: "#0f1a2e", accent: "#67e8f9" },
  { level: 8,  speed: 6.0, spawnRate: 38,  tokensNeeded: 42, name: "Lava Fortress",  bg: "#2e0f0f", accent: "#fbbf24" },
  { level: 9,  speed: 6.8, spawnRate: 32,  tokensNeeded: 50, name: "Dragon's Lair",  bg: "#1a0f2e", accent: "#f472b6" },
  { level: 10, speed: 7.8, spawnRate: 26,  tokensNeeded: 60, name: "Ninja Heaven",   bg: "#000000", accent: "#ffd700" },
];

const FRUITS = ["🍎","🍊","🍋","🍇","🍓","🥝","🍑","🍍","🥭","🍌","🫐","🍒"];
const VEGS   = ["🥕","🌽","🥦","🍆","🥑","🧅","🥬","🫑","🍄","🧄","🥒","🍅"];
const BOMBS  = ["💣","🔥","⚡","🪨"];

function randomItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function NinjaLootChopper() {
  const canvasRef = useRef(null);
  const stateRef  = useRef(null);
  const rafRef    = useRef(null);
  const keysRef   = useRef({});

  const [screen,   setScreen]   = useState("menu");   // menu | playing | paused | dead | win
  const [uiData,   setUiData]   = useState({ level:1, tokens:0, needed:8, lives:3, combo:0, powerMode:false, levelName:"Rice Fields", accent:"#4ade80" });

  // ── init game state ──
  const initState = useCallback((startLevel = 1) => {
    const cfg = LEVEL_CONFIG[startLevel - 1];
    return {
      level: startLevel,
      cfg,
      ninja: { x: 80, y: GROUND_Y - NINJA_H, vy: 0, onGround: true, slashing: false, slashTimer: 0 },
      blade: null,
      blocks: [],
      particles: [],
      tokens: 0,
      lives: 3,
      combo: 0,
      comboTimer: 0,
      powerMode: false,
      powerTimer: 0,
      speedMult: 1,
      speedTimer: 0,
      frame: 0,
      spawnCounter: 0,
      bgStars: Array.from({length:40}, () => ({ x: Math.random()*CANVAS_W, y: Math.random()*GROUND_Y, r: Math.random()*1.5+0.5, twinkle: Math.random()*60 })),
    };
  }, []);

  // ── game loop ──
  const loop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = stateRef.current;
    if (!s) return;

    s.frame++;
    const cfg = s.cfg;

    // — input —
    if (keysRef.current["ArrowLeft"] || keysRef.current["a"])  s.ninja.x = Math.max(0, s.ninja.x - 4);
    if (keysRef.current["ArrowRight"] || keysRef.current["d"]) s.ninja.x = Math.min(CANVAS_W - NINJA_W, s.ninja.x + 4);

    // — ninja physics —
    const n = s.ninja;
    n.vy += GRAVITY;
    n.y  += n.vy;
    if (n.y >= GROUND_Y - NINJA_H) { n.y = GROUND_Y - NINJA_H; n.vy = 0; n.onGround = true; }
    if (n.slashTimer > 0) { n.slashTimer--; if (n.slashTimer === 0) n.slashing = false; }

    // — blade physics —
    if (s.blade) {
      s.blade.x += s.blade.vx * (s.powerMode ? 1.5 : 1);
      if (s.blade.x > CANVAS_W + 20) s.blade = null;
    }

    // — power mode timer —
    if (s.powerMode) { s.powerTimer--; if (s.powerTimer <= 0) s.powerMode = false; }

    // — speed burst timer —
    if (s.speedTimer > 0) { s.speedTimer--; if (s.speedTimer === 0) s.speedMult = 1; }

    // — combo timer —
    if (s.comboTimer > 0) { s.comboTimer--; if (s.comboTimer === 0) s.combo = 0; }

    // — spawn blocks —
    const effectiveRate = Math.max(18, cfg.spawnRate - Math.floor(s.tokens / 3));
    s.spawnCounter++;
    if (s.spawnCounter >= effectiveRate) {
      s.spawnCounter = 0;
      const isBomb = Math.random() < (0.15 + (cfg.level - 1) * 0.02);
      const y = isBomb
        ? GROUND_Y - NINJA_H - Math.random() * 80
        : Math.random() < 0.4
          ? GROUND_Y - NINJA_H - 100 - Math.random() * 120  // high (need jump)
          : GROUND_Y - NINJA_H - Math.random() * 20;         // low (ground level)
      s.blocks.push({
        x: CANVAS_W + 10,
        y,
        emoji: isBomb ? randomItem(BOMBS) : (Math.random()<0.6 ? randomItem(FRUITS) : randomItem(VEGS)),
        isBomb,
        vx: cfg.speed * s.speedMult * (0.9 + Math.random()*0.2),
        collected: false,
        missed: false,
        size: 32,
      });
    }

    // — move blocks & collision —
    for (let i = s.blocks.length - 1; i >= 0; i--) {
      const b = s.blocks[i];
      b.x -= b.vx;

      // blade hit
      if (s.blade && !b.collected && !b.missed) {
        const bx = s.blade.x, by = s.blade.y;
        if (bx < b.x + b.size && bx + BLADE_W > b.x && by < b.y + b.size && by + BLADE_H > b.y) {
          if (b.isBomb) {
            s.lives--;
            spawnParticles(s, b.x + 16, b.y + 16, "#ff4444", 12);
            s.blade = null;
          } else {
            b.collected = true;
            s.tokens++;
            s.combo++;
            s.comboTimer = 90;
            if (s.combo >= 5) s.powerMode = true, s.powerTimer = 180;
            spawnParticles(s, b.x + 16, b.y + 16, cfg.accent, 8);
            s.blade = null;
          }
        }
      }

      // ninja body hit (touching bomb)
      if (!b.collected && !b.missed && b.isBomb) {
        if (n.x < b.x + b.size && n.x + NINJA_W > b.x && n.y < b.y + b.size && n.y + NINJA_H > b.y) {
          s.lives--;
          spawnParticles(s, b.x + 16, b.y + 16, "#ff4444", 14);
          b.missed = true;
        }
      }

      // off screen
      if (b.x < -b.size) {
        if (!b.collected && !b.isBomb) {
          // missed fruit — random speed burst
          if (Math.random() < 0.3) { s.speedMult = 1.5; s.speedTimer = 120; }
          s.combo = 0;
        }
        s.blocks.splice(i, 1);
      }
    }

    // — particles —
    for (let i = s.particles.length - 1; i >= 0; i--) {
      const p = s.particles[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.15; p.life--;
      if (p.life <= 0) s.particles.splice(i, 1);
    }

    // — check lives —
    if (s.lives <= 0) { cancelAnimationFrame(rafRef.current); setScreen("dead"); return; }

    // — level complete —
    if (s.tokens >= cfg.tokensNeeded) {
      if (cfg.level >= 10) { cancelAnimationFrame(rafRef.current); setScreen("win"); return; }
      const nextCfg = LEVEL_CONFIG[cfg.level];
      s.level = cfg.level + 1;
      s.cfg = nextCfg;
      s.tokens = 0;
      s.blocks = [];
      s.combo = 0;
      s.powerMode = false;
      s.spawnCounter = 0;
    }

    // — update UI —
    setUiData({ level: s.level, tokens: s.tokens, needed: s.cfg.tokensNeeded, lives: s.lives, combo: s.combo, powerMode: s.powerMode, levelName: s.cfg.name, accent: s.cfg.accent });

    // — DRAW —
    draw(ctx, s);

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  function spawnParticles(s, x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 2 + Math.random() * 3;
      s.particles.push({ x, y, vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed - 2, life: 30 + Math.random()*20, color, size: 3 + Math.random()*3 });
    }
  }

  function draw(ctx, s) {
    const cfg = s.cfg;
    const n = s.ninja;

    // background
    ctx.fillStyle = cfg.bg;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // stars
    s.bgStars.forEach(star => {
      const twinkle = 0.5 + 0.5 * Math.sin((s.frame + star.twinkle) * 0.05);
      ctx.globalAlpha = twinkle * 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // ground
    const gr = ctx.createLinearGradient(0, GROUND_Y, 0, CANVAS_H);
    gr.addColorStop(0, cfg.accent + "44");
    gr.addColorStop(1, cfg.accent + "11");
    ctx.fillStyle = gr;
    ctx.fillRect(0, GROUND_Y, CANVAS_W, CANVAS_H - GROUND_Y);
    ctx.strokeStyle = cfg.accent;
    ctx.lineWidth = 2;
    ctx.shadowColor = cfg.accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y); ctx.lineTo(CANVAS_W, GROUND_Y);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // blocks / fruits
    s.blocks.forEach(b => {
      if (b.collected) return;
      ctx.font = `${b.size}px serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // glow for bombs
      if (b.isBomb) { ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 12; }
      ctx.fillText(b.emoji, b.x + b.size/2, b.y + b.size/2);
      ctx.shadowBlur = 0;
    });

    // blade / shuriken
    if (s.blade) {
      ctx.save();
      ctx.translate(s.blade.x + BLADE_W/2, s.blade.y + BLADE_H/2);
      ctx.rotate(s.frame * 0.4);
      ctx.font = "28px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = cfg.accent;
      ctx.shadowBlur = 16;
      ctx.fillText("🌟", 0, 0);
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ninja
    ctx.save();
    ctx.translate(n.x + NINJA_W/2, n.y + NINJA_H/2);
    if (n.slashing) ctx.rotate(-0.3);
    ctx.font = `${NINJA_H}px serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (s.powerMode) { ctx.shadowColor = cfg.accent; ctx.shadowBlur = 20; }
    ctx.fillText("🥷", 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();

    // particles
    s.particles.forEach(p => {
      ctx.globalAlpha = p.life / 50;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    });
    ctx.globalAlpha = 1;

    // combo flash
    if (s.combo >= 3) {
      ctx.font = "bold 22px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = cfg.accent;
      ctx.shadowColor = cfg.accent;
      ctx.shadowBlur = 10;
      ctx.fillText(`COMBO x${s.combo}!`, CANVAS_W / 2, 80);
      ctx.shadowBlur = 0;
    }

    // power mode banner
    if (s.powerMode) {
      ctx.font = "bold 16px 'Courier New', monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = cfg.accent;
      ctx.shadowColor = cfg.accent;
      ctx.shadowBlur = 14;
      ctx.fillText("⚡ POWER MODE ⚡", CANVAS_W / 2, 110);
      ctx.shadowBlur = 0;
    }
  }

  // ── controls ──
  useEffect(() => {
    const onKey = (e) => {
      keysRef.current[e.key] = e.type === "keydown";
      if (e.type === "keydown") {
        const s = stateRef.current;
        if (!s) return;
        if ((e.key === " " || e.key === "ArrowUp" || e.key === "w") && s.ninja.onGround) {
          s.ninja.vy = JUMP_V; s.ninja.onGround = false;
        }
        if (e.key === "z" || e.key === "x" || e.key === "Enter") {
          if (!s.blade) {
            s.blade = { x: s.ninja.x + NINJA_W, y: s.ninja.y + NINJA_H/2 - BLADE_H/2, vx: 9 };
            s.ninja.slashing = true; s.ninja.slashTimer = 12;
          }
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); };
  }, []);

  const startGame = useCallback((fromLevel = 1) => {
    stateRef.current = initState(fromLevel);
    setScreen("playing");
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [initState, loop]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // touch controls
  const touchSlash = () => {
    const s = stateRef.current;
    if (!s || !s.blade) { if(s) { s.blade = { x: s.ninja.x + NINJA_W, y: s.ninja.y + NINJA_H/2 - BLADE_H/2, vx: 9 }; s.ninja.slashing = true; s.ninja.slashTimer = 12; } }
  };
  const touchJump = () => {
    const s = stateRef.current;
    if (s && s.ninja.onGround) { s.ninja.vy = JUMP_V; s.ninja.onGround = false; }
  };
  const touchLeft  = (on) => { keysRef.current["ArrowLeft"]  = on; };
  const touchRight = (on) => { keysRef.current["ArrowRight"] = on; };

  const accent = uiData.accent;

  // ─────────────────────────── RENDER ───────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:"#050510", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"'Courier New', monospace", userSelect:"none" }}>

      {/* MENU */}
      {screen === "menu" && (
        <div style={{ textAlign:"center", color:"#fff", maxWidth:460, padding:"0 20px" }}>
          <div style={{ fontSize:72, marginBottom:8 }}>🥷</div>
          <h1 style={{ fontSize:32, fontWeight:900, letterSpacing:3, marginBottom:4, background:"linear-gradient(90deg,#4ade80,#818cf8,#fb923c)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>NINJA LOOT CHOPPER</h1>
          <p style={{ color:"#888", fontSize:13, marginBottom:24 }}>Slice fruits. Dodge bombs. Survive 10 levels.</p>
          <div style={{ background:"#111", border:"1px solid #333", borderRadius:12, padding:"16px 20px", marginBottom:24, textAlign:"left", fontSize:13, color:"#aaa", lineHeight:1.8 }}>
            <b style={{color:"#fff"}}>CONTROLS</b><br/>
            ⬅ ➡ / A D &nbsp;— Move<br/>
            ↑ / W / Space &nbsp;— Jump<br/>
            Z / X / Enter &nbsp;— Throw Shuriken<br/>
            <span style={{color:"#4ade80"}}>5 combo streak → ⚡ Power Mode</span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:24 }}>
            {LEVEL_CONFIG.map(l => (
              <div key={l.level} style={{ background:"#111", border:`1px solid ${l.accent}33`, borderRadius:8, padding:"8px 12px", cursor:"pointer", transition:"all 0.2s" }}
                onClick={() => startGame(l.level)}
                onMouseEnter={e => e.currentTarget.style.borderColor = l.accent}
                onMouseLeave={e => e.currentTarget.style.borderColor = l.accent+"33"}>
                <span style={{color:l.accent, fontWeight:700}}>Lv {l.level}</span>
                <span style={{color:"#666", fontSize:11, marginLeft:8}}>{l.name}</span>
              </div>
            ))}
          </div>
          <button onClick={() => startGame(1)} style={{ background:"linear-gradient(135deg,#4ade80,#22c55e)", color:"#000", border:"none", padding:"14px 48px", borderRadius:8, fontSize:16, fontWeight:900, cursor:"pointer", letterSpacing:2, boxShadow:"0 0 20px #4ade8066" }}>
            START — LEVEL 1
          </button>
        </div>
      )}

      {/* GAME */}
      {screen === "playing" && (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:0 }}>
          {/* HUD */}
          <div style={{ width:CANVAS_W, background:"#050510", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:`1px solid ${accent}33` }}>
            <div style={{ color:accent, fontWeight:700, fontSize:13 }}>
              LV {uiData.level} · {uiData.levelName}
            </div>
            <div style={{ color:"#fff", fontSize:13 }}>
              {"❤️".repeat(uiData.lives)}{"🖤".repeat(Math.max(0, 3-uiData.lives))}
            </div>
            <div style={{ color:accent, fontWeight:700, fontSize:13 }}>
              🍎 {uiData.tokens}/{uiData.needed}
            </div>
          </div>
          {/* progress bar */}
          <div style={{ width:CANVAS_W, height:4, background:"#1a1a2e" }}>
            <div style={{ height:4, background:accent, width:`${(uiData.tokens/uiData.needed)*100}%`, boxShadow:`0 0 8px ${accent}`, transition:"width 0.2s" }}/>
          </div>

          <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H} style={{ display:"block" }} />

          {/* touch controls */}
          <div style={{ width:CANVAS_W, background:"#050510", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, borderTop:`1px solid ${accent}22` }}>
            <button onPointerDown={() => touchLeft(true)} onPointerUp={() => touchLeft(false)} onPointerLeave={() => touchLeft(false)}
              style={{ flex:1, padding:"14px 0", background:"#1a1a2e", border:`1px solid ${accent}44`, borderRadius:8, color:accent, fontSize:22, cursor:"pointer" }}>◀</button>
            <button onPointerDown={touchJump}
              style={{ flex:1, padding:"14px 0", background:"#1a1a2e", border:`1px solid ${accent}44`, borderRadius:8, color:accent, fontSize:22, cursor:"pointer" }}>▲</button>
            <button onPointerDown={touchSlash}
              style={{ flex:1.5, padding:"14px 0", background:`${accent}22`, border:`1px solid ${accent}`, borderRadius:8, color:accent, fontSize:18, fontWeight:700, cursor:"pointer" }}>⭐ SLASH</button>
            <button onPointerDown={() => touchRight(true)} onPointerUp={() => touchRight(false)} onPointerLeave={() => touchRight(false)}
              style={{ flex:1, padding:"14px 0", background:"#1a1a2e", border:`1px solid ${accent}44`, borderRadius:8, color:accent, fontSize:22, cursor:"pointer" }}>▶</button>
          </div>
        </div>
      )}

      {/* DEAD */}
      {screen === "dead" && (
        <div style={{ textAlign:"center", color:"#fff" }}>
          <div style={{ fontSize:64, marginBottom:8 }}>💀</div>
          <h2 style={{ fontSize:28, fontWeight:900, color:"#ff4444", letterSpacing:2 }}>MISSION FAILED</h2>
          <p style={{ color:"#666", marginBottom:8 }}>Reached Level {uiData.level} · {uiData.levelName}</p>
          <p style={{ color:"#aaa", fontSize:13, marginBottom:28 }}>The ninja must start this level again — not from the beginning.</p>
          <div style={{ display:"flex", gap:12, justifyContent:"center" }}>
            <button onClick={() => startGame(uiData.level)} style={{ background:"#ff4444", color:"#fff", border:"none", padding:"12px 28px", borderRadius:8, fontSize:15, fontWeight:700, cursor:"pointer" }}>
              RETRY LV {uiData.level}
            </button>
            <button onClick={() => setScreen("menu")} style={{ background:"#222", color:"#aaa", border:"1px solid #444", padding:"12px 28px", borderRadius:8, fontSize:15, cursor:"pointer" }}>
              MENU
            </button>
          </div>
        </div>
      )}

      {/* WIN */}
      {screen === "win" && (
        <div style={{ textAlign:"center", color:"#fff" }}>
          <div style={{ fontSize:64, marginBottom:8 }}>🏆</div>
          <h2 style={{ fontSize:28, fontWeight:900, letterSpacing:2, background:"linear-gradient(90deg,#ffd700,#fb923c)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>NINJA MASTER!</h2>
          <p style={{ color:"#ffd700", marginBottom:24 }}>All 10 levels conquered. The legend is complete.</p>
          <button onClick={() => startGame(1)} style={{ background:"linear-gradient(135deg,#ffd700,#fb923c)", color:"#000", border:"none", padding:"14px 40px", borderRadius:8, fontSize:16, fontWeight:900, cursor:"pointer", letterSpacing:2 }}>
            PLAY AGAIN
          </button>
        </div>
      )}
    </div>
  );
}
