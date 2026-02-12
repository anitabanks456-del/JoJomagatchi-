console.log("app.js running");

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

document.getElementById("feed").addEventListener("click", () => act("feed"));
document.getElementById("play").addEventListener("click", () => act("play"));
document.getElementById("wash").addEventListener("click", () => act("clean"));
document.getElementById("reset").addEventListener("click", () => {
  state = defaultState();
  saveState(state);
  setAnim("idle");
  render();
});

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

for (const k of Object.keys(SPRITES)){
  const img = new Image();
  img.src = SPRITES[k].src;
  SPRITES[k].img = img;
}

let anim = { name:"idle", t0: performance.now(), once:false };
function setAnim(name, once=false){
  anim = { name, t0: performance.now(), once };
}

function draw(t){
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // background hearts (cheap & cute)
  const tt = t/1000;
  ctx.globalAlpha = 0.14;
  ctx.font = "18px system-ui";
  for(let i=0;i<6;i++){
    const x = (i*45 + (tt*12)) % 260 - 10;
    const y = 30 + (i%3)*22 + Math.sin(tt + i)*6;
    ctx.fillText("♥", x, y);
  }
  ctx.globalAlpha = 1;

  const m = mood();
  const show = anim.name !== "idle" ? anim.name : (m === "sad" || m === "sick" ? "sad" : "idle");

  const s = SPRITES[show];
  if (!s?.img) return;

  const elapsed = (t - anim.t0) / 1000;
  const frame = Math.floor(elapsed * s.fps) % s.frames;

  // if action anim is "once", return to idle after 1 cycle
  if (anim.once && anim.name !== "idle") {
    const cycle = s.frames / s.fps;
    if (elapsed >= cycle) setAnim("idle");
  }

  const scale = 2.6;
  const dw = s.frameW * scale;
  const dh = s.frameH * scale;
  const dx = (canvas.width - dw)/2;
  const dy = (canvas.height - dh)/2 + 10;

  ctx.drawImage(
    s.img,
    frame * s.frameW, 0, s.frameW, s.frameH,
    dx, dy, dw, dh
  );

  // mood pop
  if (m === "happy") { ctx.globalAlpha = 0.45; ctx.font = "28px system-ui"; ctx.fillText("💗", 112, 60); ctx.globalAlpha = 1; }
  if (m === "sick")  { ctx.globalAlpha = 0.45; ctx.font = "28px system-ui"; ctx.fillText("🤒", 112, 60); ctx.globalAlpha = 1; }
}

function loop(t){ draw(t); requestAnimationFrame(loop); }
requestAnimationFrame(loop);

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
    "Your pet made you a heart 💘",
    "They missed you. Like, a lot. 💗",
    "Love boost: +∞ 🫶",
    "They’re happiest when you check in ✨"
  ]);
}
function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
