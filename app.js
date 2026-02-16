console.log("app.js running");
console.log("NEW app.js loaded", new Date().toISOString());


// ---------- Install button ----------
let deferredPrompt = null;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
installBtn.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.hidden = true;
});

// ---------- Service Worker ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js");
}

// ---------- State + real-world decay ----------
const KEY = "valentine_pet_state_v1";
const clamp = (n) => Math.max(0, Math.min(100, n));
const now = () => Date.now();

let mode = "pet"; // "pet" | "findfish"

// decay per hour (tune!)
const DECAY_PER_HOUR = { hunger: 10, happy: 6, clean: 7 };

// action gains (tune!)
const ACTION = {
  feed:  { hunger:+30, happy:+5, clean:-2, anim:"eat"   },
  play:  { hunger:-5,  happy:+28,clean:-4, anim:"play"  },
  clean: { hunger:0,   happy:+4, clean:+32,anim:"clean" }
};

function defaultState(){
  return { hunger:70, happy:70, clean:70, lastSeen: now(), lastNoteDay:null };
}

function loadState(){
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaultState();
  try { return { ...defaultState(), ...JSON.parse(raw) }; }
  catch { return defaultState(); }
}

function saveState(s){
  localStorage.setItem(KEY, JSON.stringify(s));
}

let state = loadState();
applyRealWorldDecay();
saveState(state);
if (window.desktop?.sendPetState) {
  window.desktop.sendPetState(state);
}


// Apply decay based on time since lastSeen
function applyRealWorldDecay(){
  const dtMs = now() - (state.lastSeen ?? now());
  const hours = dtMs / (1000 * 60 * 60);

  state.hunger = clamp(state.hunger - DECAY_PER_HOUR.hunger * hours);
  state.happy  = clamp(state.happy  - DECAY_PER_HOUR.happy  * hours);
  state.clean  = clamp(state.clean  - DECAY_PER_HOUR.clean  * hours);

  state.lastSeen = now();
}

// ---------- UI wiring ----------
const hungerBar = document.getElementById("hunger");
const happyBar  = document.getElementById("happy");
const cleanBar  = document.getElementById("clean");
const hungerV   = document.getElementById("hungerV");
const happyV    = document.getElementById("happyV");
const cleanV    = document.getElementById("cleanV");
const moodEl    = document.getElementById("mood");
const lastSeenEl= document.getElementById("lastSeen");
const subtitle  = document.getElementById("subtitle");
// core actions
document.getElementById("feed").addEventListener("click", () => act("feed"));
document.getElementById("play").addEventListener("click", () => act("play"));
document.getElementById("wash").addEventListener("click", () => act("clean"));
//minigame (one handler, top level)
document.getElementById("minigame").addEventListener("click", () => {
  console.log("minigame button clicked");
  startFindFish();
});

// reset
document.getElementById("reset").addEventListener("click", () => {
  state = defaultState();
  saveState(state);
  setAnim("idle");
  render();
});

if (window.desktop?.sendPetState) {
  window.desktop.sendPetState(state);
}

function mood(){
  if (state.hunger < 20 || state.clean < 20) return "sick";
  const avg = (state.hunger + state.happy + state.clean)/3;
  if (avg > 75) return "happy";
  if (avg > 45) return "ok";
  return "sad";
}

function render(){
  hungerBar.value = state.hunger; hungerV.textContent = Math.round(state.hunger);
  happyBar.value  = state.happy;  happyV.textContent  = Math.round(state.happy);
  cleanBar.value  = state.clean;  cleanV.textContent  = Math.round(state.clean);

  const m = mood();
  moodEl.textContent =
    m === "happy" ? "Feeling loved 💗" :
    m === "ok"    ? "Doing okay" :
    m === "sad"   ? "Misses you…" :
                    "Not feeling well";

  lastSeenEl.textContent = `Last seen: ${new Date(state.lastSeen).toLocaleString()}`;
}
render();

// ---------- Sprite animation on canvas ----------
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

// IMPORTANT: set to false for crisp pixel art
ctx.imageSmoothingEnabled = false;

// Your sprite sheets should be HORIZONTAL strips (frames in one row)
const SPRITES = {
  idle:  { src:"./sprites/idle.png",  frameW:64, frameH:64, frames:4, fps:6  },
  eat:   { src:"./sprites/eat.png",   frameW:64, frameH:64, frames:4, fps:10 },
  play:  { src:"./sprites/play.png",  frameW:64, frameH:64, frames:4, fps:10 },
  clean: { src:"./sprites/clean.png", frameW:64, frameH:64, frames:4, fps:10 },
  sad:   { src:"./sprites/sad.png",   frameW:64, frameH:64, frames:2, fps:4  }
};

const FISH_IMG = new Image();
FISH_IMG.src = "./sprites/JBL.png";


for (const k of Object.keys(SPRITES)){
  const img = new Image();
  img.src = SPRITES[k].src;
  SPRITES[k].img = img;
}

let anim = { name:"idle", t0: performance.now(), once:false };
function setAnim(name, once=false){
  anim = { name, t0: performance.now(), once };
}

function drawCenteredText(text, y, font, alpha=1){
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = font;
  ctx.fillStyle = "#ffffff";
  const w = ctx.measureText(text).width;
  ctx.fillText(text, (canvas.width - w) / 2, y);
  ctx.restore();
}

// -------- Find the Fish mini-game --------
let ff = null;

function startFindFish() {
  mode = "findfish";
  moodEl.style.display = "none";


  const slots = [
    { x: 60,  y: 150 },
    { x: 120, y: 150 },
    { x: 180, y: 150 }
  ];

  ff = {
    phase: "show",                 // NEW: show -> shuffle -> pick -> reveal -> done
    message: "watch where the JBL starts…",
    showUntil: performance.now() + 900, // show fish for 0.9s
    slots,
    cups: [
      { id: 0, slot: 0 },
      { id: 1, slot: 1 },
      { id: 2, slot: 2 }
    ],
    fishCupId: Math.floor(Math.random() * 3),
    shuffleCount: 0,
    shuffleTarget: 6 + Math.floor(Math.random() * 3),
    anim: null,
    pickCupId: null,
    rewardGiven: false
  };
}


// Canvas click/tap
canvas.addEventListener("pointerdown", (e) => {
  if (mode !== "findfish" || !ff) return;

  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my = (e.clientY - rect.top)  * (canvas.height / rect.height);

  if (ff.phase === "ready") {
    ff.phase = "shuffle";
    ff.message = "watch closely…";
    return;
  }

  if (ff.phase === "pick") {
    const cupId = hitTestCup(mx, my);
    if (cupId == null) return;
    ff.pickCupId = cupId;
    ff.phase = "reveal";
    ff.message = "revealing…";
    return;
  }

 if (ff.phase === "done" || (ff.phase === "reveal" && ff.rewardGiven)) {
  mode = "pet";
  moodEl.style.display = "";
  ff = null;
}

});

function hitTestCup(mx, my) {
  // Cup bounds (simple rectangles for hit test)
  for (const cup of ff.cups) {
    const p = cupPos(cup);
    const w = 46, h = 56;
    if (mx >= p.x - w/2 && mx <= p.x + w/2 && my >= p.y - h && my <= p.y) {
      return cup.id;
    }
  }
  return null;
}

function cupPos(cup) {
  const s = ff.slots[cup.slot];
  return { x: s.x, y: s.y };
}

function updateFindFish(t) {
  if (!ff) return;

  if (ff.phase === "show" && performance.now() >= ff.showUntil) {
  ff.phase = "shuffle";
  ff.message = "watch closely…";
}

  // Run shuffle logic
  if (ff.phase === "shuffle") {
    // If no current animation, start one
    if (!ff.anim) {
      if (ff.shuffleCount >= ff.shuffleTarget) {
        ff.phase = "pick";
        ff.message = "pick a cup!";
        return;
      }
      // Pick two different cups to swap their slots
      const a = Math.floor(Math.random() * 3);
      let b = Math.floor(Math.random() * 3);
      while (b === a) b = Math.floor(Math.random() * 3);

      const cupA = ff.cups[a];
      const cupB = ff.cups[b];

      ff.anim = {
        aId: cupA.id,
        bId: cupB.id,
        aFrom: cupA.slot, aTo: cupB.slot,
        bFrom: cupB.slot, bTo: cupA.slot,
        start: performance.now(),
        dur: 420 // ms
      };
    }

    // Progress the swap animation
    const p = (performance.now() - ff.anim.start) / ff.anim.dur;
    if (p >= 1) {
      // Commit swap at end
      const cupA = ff.cups.find(c => c.id === ff.anim.aId);
      const cupB = ff.cups.find(c => c.id === ff.anim.bId);
      cupA.slot = ff.anim.aTo;
      cupB.slot = ff.anim.bTo;

      ff.anim = null;
      ff.shuffleCount += 1;
    }
  }

  if (ff.phase === "reveal" && !ff.rewardGiven) {
    // Give reward immediately on reveal
    const win = ff.pickCupId === ff.fishCupId;

    // Apply reward to your pet stats
    if (win) {
      state.happy = clamp(state.happy + 6);
      state.hunger = clamp(state.hunger + 0);
      state.clean = clamp(state.clean + 0);
      // fun boost
      state.happy = clamp(state.happy + 6);
      subtitle.textContent = "You found it! +Fun 💗";
    } else {
      subtitle.textContent = "No JBL… try again!";
    }
    state.lastSeen = Date.now();
    saveState(state);
    render();

    if (window.desktop?.sendPetState) {
  window.desktop.sendPetState(state);
    }


    ff.rewardGiven = true;

    // After a short delay, mark done
    setTimeout(() => {
      if (!ff) return;
      ff.phase = "done";
      ff.message = win ? "Nice! Tap to Return" : "tap to return";
    }, 650);
  }
}

// helper: rounded rectangle panel
function roundRect(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}

function drawFindFish(t) {
  // update first
  updateFindFish(t);

  // background
  // soft in-canvas panel instead of grey wash
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#000";
    roundRect(12, 12, canvas.width - 24, canvas.height - 24, 16);
    ctx.fill();
    ctx.restore();


  // title
  ctx.globalAlpha = 0.9;
  ctx.font = "14px EightBitDragon, monospace"; // will fall back if not loaded
  ctx.fillStyle = "#ffffff";
  drawCenteredText("FIND THE JBL", 32, '14px "EightBitDragon", monospace', 0.9);

  ctx.globalAlpha = 1;

  // message
  ctx.globalAlpha = 0.85;
  ctx.font = "11px EightBitDragon, monospace";
  drawCenteredText(ff.message, 52, '11px "EightBitDragon", monospace', 0.85);
  ctx.globalAlpha = 1;

  // Draw fish (only visible during reveal/done)
  const showFish = ff.phase === "show" || ff.phase === "reveal" || ff.phase === "done";
  if (showFish) {
    const fishCup = ff.cups.find(c => c.id === ff.fishCupId);
    const fp = animatedCupPos(fishCup);
   if (FISH_IMG.complete && FISH_IMG.naturalWidth > 0) {
  const scale = 1; // try 2 or 3
  const w = FISH_IMG.naturalWidth * scale;   // 50 * 3 = 150
  const h = FISH_IMG.naturalHeight * scale;  // 37 * 3 = 111

  const cupH = 56; // your cup height
  const x = fp.x - w / 2;
  const y = fp.y - cupH + 12; // tweak: 8–16 range

  ctx.drawImage(FISH_IMG, x, y, w, h);
    }



  }

  // Draw cups
  for (const cup of ff.cups) {
    const p = animatedCupPos(cup);
    drawCup(p.x, p.y);

    // highlight chosen cup
    if ((ff.phase === "reveal" || ff.phase === "done") && cup.id === ff.pickCupId) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#ff4d6d";
      ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 26, p.y - 62, 52, 62);
      ctx.globalAlpha = 1;
    }
  }

  // hint
  drawCenteredText(
  "tap screen",
  226,
  '10px "EightBitDragon", monospace',
  0.65
);
}

function animatedCupPos(cup) {
  // If the cup is part of current swap animation, interpolate between slots
  if (ff.anim && (cup.id === ff.anim.aId || cup.id === ff.anim.bId)) {
    const now = performance.now();
    const p = Math.min(1, (now - ff.anim.start) / ff.anim.dur);
    const ease = p * p * (3 - 2 * p); // smoothstep

    const fromSlot = (cup.id === ff.anim.aId) ? ff.anim.aFrom : ff.anim.bFrom;
    const toSlot   = (cup.id === ff.anim.aId) ? ff.anim.aTo   : ff.anim.bTo;

    const a = ff.slots[fromSlot];
    const b = ff.slots[toSlot];

    return {
      x: a.x + (b.x - a.x) * ease,
      y: a.y + (b.y - a.y) * ease
    };
  }

  return cupPos(cup);
}

function drawCup(x, y) {
  // simple “cup” drawing
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x - 22, y - 56, 44, 56);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 22, y - 56, 44, 56);

  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fillRect(x - 26, y - 60, 52, 8);
}


function draw(t){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if (mode === "findfish") {
    drawFindFish(t);
    return;
  }
  // ...existing pet draw...

  // background hearts (cheap & cute)
  // background hearts
    const tt = t / 1000;

    ctx.save();
    ctx.globalCompositeOperation = "source-over"; // safety
    ctx.globalAlpha = 0.22;                       // was 0.14 (too faint)
    ctx.fillStyle = "#ff4d6d";                    // visible pink
    ctx.font = "18px system-ui";

    for (let i = 0; i < 6; i++) {
  const x = (i * 45 + (tt * 12)) % 260 - 10;
  const y = 30 + (i % 3) * 22 + Math.sin(tt + i) * 6;
  ctx.fillText("♥", x, y);
    }

    ctx.restore();



  const m = mood();
  const show = anim.name !== "idle" ? anim.name : (m === "sad" || m === "sick" ? "sad" : "idle");


  // mood pop
  if (m === "happy") { ctx.globalAlpha = 0.45; ctx.font = "28px system-ui"; ctx.fillText("💗", 112, 60); ctx.globalAlpha = 1; }
  if (m === "sick")  { ctx.globalAlpha = 0.45; ctx.font = "28px system-ui"; ctx.fillText("🤒", 112, 60); ctx.globalAlpha = 1; }
  const s = SPRITES[show];

if (s?.img && s.img.complete && s.img.naturalWidth > 0) {
  const elapsed = (t - anim.t0) / 1000;
  const frame = Math.floor(elapsed * s.fps) % s.frames;

  // return to idle after one-shot animation
  if (anim.once && anim.name !== "idle") {
    const cycle = s.frames / s.fps;
    if (elapsed >= cycle) setAnim("idle");
  }

  const scale = 2.6;
  const dw = s.frameW * scale;
  const dh = s.frameH * scale;
  const dx = (canvas.width - dw) / 2;
  const dy = (canvas.height - dh) / 2 + 10;

  ctx.drawImage(
    s.img,
    frame * s.frameW, 0, s.frameW, s.frameH,
    dx, dy, dw, dh
  );
}
}



function loop(t){ draw(t); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

window.addEventListener("load", () => {
  const card = document.querySelector(".card");
  if (!card) return;

  // Measure the actual UI size
  const r = card.getBoundingClientRect();
  const w = Math.ceil(r.width);
  const h = Math.ceil(r.height) + 80; // small extra for header if needed

  // If running in Electron, ask main process to resize window
  if (window.desktop?.setWindowSize) {
    window.desktop.setWindowSize(w, h);
  }
});


// ---------- Actions + daily love line ----------
function act(type){
  const a = ACTION[type];
  state.hunger = clamp(state.hunger + a.hunger);
  state.happy  = clamp(state.happy  + a.happy);
  state.clean  = clamp(state.clean  + a.clean);
  state.lastSeen = now();
  saveState(state);
  render();

  setAnim(a.anim, true);
  maybeDailyNote();
}

function maybeDailyNote(){
  const today = new Date().toDateString();
  if (state.lastNoteDay === today) return;
  state.lastNoteDay = today;
  saveState(state);

  subtitle.textContent = pick([
    "Hey look, he made you a heart 💘",
    "He missed you. Like, a lot. 💗",
    "Love boost: +∞ 🫶",
    "He's the happiest when you check in ✨"
  ]);
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
