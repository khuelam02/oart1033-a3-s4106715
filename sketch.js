'use strict';

// ─────────────────────────────────────────────────────────────
//  BACKGROUND IMAGE
// ─────────────────────────────────────────────────────────────
const bgImg = new Image();
bgImg.src = 'images/bg.png';

// Shared traveller dot image (used by BoxSquare + BodyTriangle)
const circleCountImg = new Image();
circleCountImg.src = 'images/circle-count.png';

// ─────────────────────────────────────────────────────────────
//  UTILS
// ─────────────────────────────────────────────────────────────
const lerp       = (a, b, t) => a + (b - a) * t;
const clamp      = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand       = (lo, hi) => lo + Math.random() * (hi - lo);
const smoothstep = t => t * t * (3 - 2 * t);

// ─────────────────────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────────────────────
const App = {
  phase:         'landing',
  transitioning: false,
  phaseReady:    false,

  handVisible:   false,
  handRaw:       0.5,
  handSmooth:    0.5,
  handX:         0.5,
  handY:         0.5,
};

// ─────────────────────────────────────────────────────────────
//  CANVAS
// ─────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
let W, H;

function resize() {
  W = canvas.width  = window.innerWidth;
  H = canvas.height = window.innerHeight;
  if (App.phase === 'mind') MindViz.rebuild();
  if (App.phase === 'body') BodyViz.rebuild();
  if (App.phase === 'soul') SoulViz.rebuild();
}
window.addEventListener('resize', resize);

// ─────────────────────────────────────────────────────────────
//  SCREEN MANAGEMENT
// ─────────────────────────────────────────────────────────────
function updatePhaseProgress(phase) {
  const bar = document.getElementById('phase-progress');
  if (!bar) return;
  const order = ['mind', 'body', 'soul'];
  const idx   = order.indexOf(phase);

  // Labels — mark active / done
  order.forEach((p, i) => {
    const el = document.getElementById('ppl-' + p);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i < idx)        el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });

  bar.classList.toggle('visible', idx >= 0);
  // Fill + dot are updated live every frame by _liveUpdateProgressBar()
}

// Called every frame from mainLoop — gradually moves the rail dot/fill
// as the user breathes instead of snapping at phase boundaries.
//
// Rail mapping:
//   0%  = start of MIND   (left label)
//   50% = start of BODY   (center label)
//  100% = SOUL complete   (right label)
function _liveUpdateProgressBar() {
  const fill = document.getElementById('pp-rail-fill');
  const dot  = document.getElementById('pp-rail-dot');
  if (!fill || !dot) return;

  let pct = 0;
  if (App.phase === 'mind') {
    // MindBreath.getTotalProgress() → 0…1 over the single box cycle
    pct = MindBreath.getTotalProgress() * 50;
  } else if (App.phase === 'body') {
    pct = 50 + BodyBreath.getTotalProgress() * 50;
  } else if (App.phase === 'soul') {
    pct = 100;
  } else {
    return; // landing / outro — don't touch the bar
  }

  const pctStr = pct.toFixed(2) + '%';
  fill.style.width = pctStr;
  dot.style.left   = pctStr;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) requestAnimationFrame(() => el.classList.add('active'));
  document.body.classList.toggle('on-landing', id === 's-landing');
}

function goPhase(name) {
  if (App.transitioning && name !== 'landing') return;
  App.transitioning = true;
  App.phase         = name;
  App.phaseReady    = false;

  document.getElementById('info-panel')?.classList.remove('open');
  document.getElementById('info-panel-body')?.classList.remove('open');
  document.getElementById('info-panel-soul')?.classList.remove('open');
  document.getElementById('phase-fog')?.style.setProperty('opacity', '0');

  // Stop any active VO immediately on phase skip
  [AudioManager.vo, AudioManager.voBody, AudioManager.voSoul].forEach(a => {
    if (a && !a.paused) { a.pause(); a.currentTime = 0; }
  });
  if (AudioManager.ducked) {
    AudioManager.ducked = false;
    AudioManager._fadeVol(AudioManager.music, 0.42, 500);
  }

  document.body.classList.remove('soul-active');

  if (name === 'outro') {
    showScreen('s-outro');
    document.getElementById('webcam-wrap')?.classList.remove('visible');
    OutroViz.init();
    App.transitioning = false;
    return;
  }
  if (name === 'landing') {
    ctx.clearRect(0, 0, W, H);
    showScreen('s-landing');
    document.getElementById('webcam-wrap')?.classList.remove('visible');
    setTimeout(() => { App.transitioning = false; }, 1600);
    return;
  }

  showScreen('s-exp');
  updatePhaseProgress(name);
  ['mind', 'body', 'soul'].forEach(p => {
    document.getElementById('ui-' + p)?.classList.add('hidden');
    document.getElementById('nav-' + p)?.classList.toggle('active', p === name);
  });

  if (name === 'mind') {
    MindViz.init();
    MindBreath.init();
  }
  if (name === 'body') {
    BodyViz.init();
    BodyBreath.init();
    BodyTriangle.reset();
    MindInstruct.hide();   // clear MIND instruction text before BODY starts
    document.getElementById('webcam-wrap')?.classList.add('visible');
  }
  if (name === 'soul') {
    SoulViz.init();
    document.getElementById('webcam-wrap')?.classList.remove('visible');
    document.body.classList.add('soul-active');
  }

  setTimeout(() => {
    showPhaseReveal(name.toUpperCase(), () => {
      document.getElementById('ui-' + name)?.classList.remove('hidden');
      App.phaseReady    = true;
      App.transitioning = false;
      if (name === 'mind') MindInstruct.init();
      if (name === 'body') BodyInstruct.init();
    });
  }, 400);
}

// ─────────────────────────────────────────────────────────────
//  TYPING INTRO + HAND TUTORIAL
// ─────────────────────────────────────────────────────────────
let _skipFlag = false;

const _sleep = ms => new Promise(r => {
  if (_skipFlag) return r();
  const tid = setTimeout(r, ms);
  const iv  = setInterval(() => { if (_skipFlag) { clearTimeout(tid); clearInterval(iv); r(); } }, 40);
  setTimeout(() => clearInterval(iv), ms + 80);
});

// cursorEl (optional) is appended inside el so "|" follows the typed chars
function _typeInto(el, text, cursorEl) {
  return new Promise(res => {
    const tn = document.createTextNode('');
    el.appendChild(tn);
    if (cursorEl) el.appendChild(cursorEl);
    if (_skipFlag) { tn.data = text; return res(); }
    let i = 0;
    const next = () => {
      if (_skipFlag) { tn.data = text; return res(); }
      if (i >= text.length) return res();
      tn.data += text[i++];
      setTimeout(next, 32 + Math.random() * 22);
    };
    next();
  });
}

function _countUp(el, to, ms) {
  return new Promise(res => {
    if (_skipFlag) { el.textContent = to.toLocaleString(); return res(); }
    const t0 = performance.now();
    const tick = now => {
      if (_skipFlag) { el.textContent = to.toLocaleString(); return res(); }
      const t   = Math.min(1, (now - t0) / ms);
      const val = Math.round(lerp(0, to, smoothstep(t)));
      el.textContent = val.toLocaleString();
      if (t < 1) requestAnimationFrame(tick);
      else res();
    };
    requestAnimationFrame(tick);
  });
}

async function showTypingIntro() {
  const overlay = document.getElementById('typing-overlay');
  const textEl  = document.getElementById('typing-text');
  const cursor  = document.getElementById('typing-cursor');
  const skipBtn = document.getElementById('btn-skip');

  _skipFlag = false;
  // Rescue cursor in case it was stranded inside textEl from a previous run
  document.getElementById('typing-content')?.appendChild(cursor);
  textEl.innerHTML = '';
  overlay.classList.add('active');
  cursor.style.opacity = '1';

  // Space = skip during typing animation
  const onSpaceSkip = e => { if (e.code === 'Space') { e.preventDefault(); _skipFlag = true; } };
  window.addEventListener('keydown', onSpaceSkip);
  if (skipBtn) { skipBtn.style.opacity = '1'; skipBtn.onclick = () => { _skipFlag = true; }; }

  await _sleep(380);

  // ── Line 1 — cursor follows typing ──────────────────────
  const line1 = document.createElement('span');
  line1.style.cssText = 'display:block; white-space:nowrap;';
  textEl.appendChild(line1);
  await _typeInto(line1, 'Have you ever wondered how many times you breathe in a day?', cursor);
  await _sleep(500);

  // ── Big 20,000 ──────────────────────────────────────────
  cursor.style.opacity = '0';
  textEl.appendChild(cursor); // park cursor safely (outside line1)
  const numEl = document.createElement('span');
  numEl.className = 'count-big';
  numEl.textContent = '0';
  textEl.appendChild(numEl);
  await _countUp(numEl, 20000, 1300);
  numEl.classList.add('burst');
  numEl.addEventListener('animationend', () => numEl.classList.remove('burst'), { once: true });
  await _sleep(900);
  cursor.style.opacity = '1';

  // ── Line 3 — cursor follows typing ──────────────────────
  const line3 = document.createElement('span');
  line3.style.display = 'block';
  textEl.appendChild(line3);
  await _typeInto(line3, 'But how many times do you truly feel it?', cursor);
  await _sleep(700);

  // ── Space hint ──────────────────────────────────────────
  // Remove the typing-phase space-skip listener; now Space advances to next screen
  window.removeEventListener('keydown', onSpaceSkip);
  cursor.style.opacity = '0';
  textEl.appendChild(cursor); // park cursor safely
  const spaceHint = document.createElement('span');
  spaceHint.className = 'space-hint';
  spaceHint.textContent = 'Press Space to continue';
  textEl.appendChild(spaceHint);
  await _sleep(50);
  spaceHint.style.opacity = '1';

  await new Promise(res => {
    const onKey = e => {
      if (e.code === 'Space') { e.preventDefault(); window.removeEventListener('keydown', onKey); res(); }
    };
    window.addEventListener('keydown', onKey);
    const iv = setInterval(() => { if (_skipFlag) { window.removeEventListener('keydown', onKey); clearInterval(iv); res(); } }, 50);
  });

  if (skipBtn) skipBtn.style.opacity = '0';
  overlay.classList.remove('active');
  await _sleep(700);
}

async function showHandTutorial() {
  const tutorial  = document.getElementById('hand-tutorial');
  const gestures  = tutorial.querySelectorAll('.ht-gesture');
  const readyBtn  = document.getElementById('btn-ready');
  const introEl   = tutorial.querySelector('.ht-intro');
  const skipBtn   = document.getElementById('btn-skip-tutorial');

  // Reset skip flag so typing-intro skip doesn't bleed through
  _skipFlag = false;

  // Show webcam above the tutorial overlay
  const wcamEl = document.getElementById('webcam-wrap');
  wcamEl?.classList.add('visible', 'on-top');

  // Skip-tutorial resolver — set when waiting on ready button
  let _doneResolve = null;
  let _done = false;

  const skipTutorial = () => {
    if (_done) return;
    _done = true;
    _skipFlag = true;               // exits gesture tick loops
    if (_doneResolve) _doneResolve(); // skips ready-button wait
  };

  if (skipBtn) {
    skipBtn.style.opacity = '1';
    skipBtn.onclick = skipTutorial;
  }

  // Space = skip during hand tutorial
  const onSpaceSkipTutorial = e => { if (e.code === 'Space') { e.preventDefault(); skipTutorial(); } };
  window.addEventListener('keydown', onSpaceSkipTutorial);

  tutorial.classList.add('active');
  await _sleep(500);

  // All gestures appear dimmed at once
  gestures.forEach(g => g.classList.add('show'));
  await _sleep(500);

  const HOLD_MS       = 4000;
  const targetGesture = ['open', 'closed', 'open'];

  for (let i = 0; i < gestures.length; i++) {
    if (_skipFlag) break;

    const g    = gestures[i];
    const fill = g.querySelector('.ht-progress-fill');

    gestures.forEach((gg, j) => {
      gg.classList.toggle('ht-active', j === i);
      gg.classList.toggle('ht-dim',    j !== i && !gg.classList.contains('ht-done'));
    });
    if (fill) fill.style.width = '0%';

    let holdStart = null;
    await new Promise(res => {
      const tick = () => {
        if (_skipFlag) return res();
        const correct = App.handVisible &&
                        getGesture(App.handSmooth) === targetGesture[i];
        if (correct) {
          if (!holdStart) holdStart = performance.now();
          const pct = Math.min(1, (performance.now() - holdStart) / HOLD_MS);
          if (fill) fill.style.width = (pct * 100) + '%';
          if (pct >= 1) return res();
        } else {
          holdStart = null;
          if (fill) fill.style.width = '0%';
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    g.classList.remove('ht-active', 'ht-dim');
    g.classList.add('ht-done');
    if (fill) fill.style.width = '100%';
    await _sleep(280);
  }

  if (!_skipFlag) {
    if (introEl) introEl.textContent = 'Perfect. You\'re ready.';
    await _sleep(500);
    readyBtn.classList.add('show');
  }

  // Wait for "Are you ready?" click OR skip button
  await new Promise(res => {
    _doneResolve = res;
    if (_skipFlag) return res();
    readyBtn.addEventListener('click', res, { once: true });
  });
  _doneResolve = null;

  // Reset
  window.removeEventListener('keydown', onSpaceSkipTutorial);
  if (skipBtn) skipBtn.style.opacity = '0';
  wcamEl?.classList.remove('on-top');
  tutorial.classList.remove('active');
  gestures.forEach(g => g.classList.remove('show', 'ht-active', 'ht-dim', 'ht-done'));
  readyBtn.classList.remove('show');
  if (introEl) introEl.textContent = 'Here are the gestures you\'ll use';
  await _sleep(700);
}

// ─────────────────────────────────────────────────────────────
//  PHASE WORD REVEAL
// ─────────────────────────────────────────────────────────────
function showPhaseReveal(word, onDone) {
  const overlay = document.getElementById('phase-reveal');
  const wordEl  = document.getElementById('reveal-word');

  wordEl.textContent = word;
  wordEl.style.transition = 'none';
  wordEl.style.opacity    = '0';
  wordEl.style.transform  = 'scale(0.84) translateY(10px)';
  overlay.style.opacity   = '1';

  requestAnimationFrame(() => requestAnimationFrame(() => {
    wordEl.style.transition = 'opacity 0.6s ease, transform 0.9s cubic-bezier(0.34,1.4,0.64,1)';
    wordEl.style.opacity    = '1';
    wordEl.style.transform  = 'scale(1) translateY(0)';
  }));

  setTimeout(() => {
    wordEl.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
    wordEl.style.opacity    = '0';
    wordEl.style.transform  = 'scale(1.06) translateY(-8px)';
    setTimeout(() => {
      overlay.style.opacity = '0';
      if (onDone) onDone();
    }, 500);
  }, 1400);
}

// ─────────────────────────────────────────────────────────────
//  HAND TRACKER
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
//  ╔══════════════════════════════════════╗
//  ║  HAND OVERLAY — Glowing Silhouette   ║
//  ╚══════════════════════════════════════╝
//  Draws a blue glowing hand outline on the webcam canvas preview.
//  Uses MediaPipe's 21 landmarks to trace every finger bone.
// ─────────────────────────────────────────────────────────────
const HandOverlay = {
  canvas: null,
  ctx:    null,
  CW: 320, CH: 240,   // internal canvas resolution

  // Finger bone connectivity
  BONES: [
    [0,1],[1,2],[2,3],[3,4],           // thumb
    [0,5],[5,6],[6,7],[7,8],           // index
    [0,9],[9,10],[10,11],[11,12],      // middle
    [0,13],[13,14],[14,15],[15,16],    // ring
    [0,17],[17,18],[18,19],[19,20],    // pinky
    [5,9],[9,13],[13,17],              // inner palm knuckle bar
  ],
  // Fingertip indices (draw slightly larger dot)
  TIPS: [4, 8, 12, 16, 20],

  init() {
    this.canvas        = document.getElementById('hand-overlay');
    if (!this.canvas) return;
    this.canvas.width  = this.CW;
    this.canvas.height = this.CH;
    this.ctx           = this.canvas.getContext('2d');
  },

  clear() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.CW, this.CH);
  },

  draw(lm) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.CW, this.CH);

    // Normalize landmark → canvas pixel (x NOT flipped; CSS mirrors the whole canvas)
    const pt = i => [lm[i].x * this.CW, lm[i].y * this.CH];

    // ── Pass 1: wide outer glow ──
    ctx.save();
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.shadowBlur = 28;
    ctx.shadowColor = 'rgba(80, 155, 255, 0.85)';
    ctx.strokeStyle = 'rgba(100, 175, 255, 0.45)';
    ctx.lineWidth   = 22;
    this._stroke(ctx, pt);
    ctx.restore();

    // ── Pass 2: mid fill glow ──
    ctx.save();
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(160, 210, 255, 0.80)';
    ctx.strokeStyle = 'rgba(180, 220, 255, 0.72)';
    ctx.lineWidth   = 11;
    this._stroke(ctx, pt);
    ctx.restore();

    // ── Pass 3: inner white-blue core ──
    ctx.save();
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.shadowBlur = 4;
    ctx.shadowColor = 'rgba(220, 235, 255, 0.9)';
    ctx.strokeStyle = 'rgba(230, 242, 255, 0.90)';
    ctx.lineWidth   = 3.5;
    this._stroke(ctx, pt);
    ctx.restore();

    // ── Joint dots ──
    for (let i = 0; i < 21; i++) {
      const [x, y] = pt(i);
      const r = this.TIPS.includes(i) ? 4.5 : 3;
      ctx.save();
      ctx.shadowBlur  = 10;
      ctx.shadowColor = 'rgba(170, 215, 255, 0.9)';
      ctx.fillStyle   = 'rgba(225, 240, 255, 0.92)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  },

  _stroke(ctx, pt) {
    for (const [a, b] of this.BONES) {
      const [ax, ay] = pt(a);
      const [bx, by] = pt(b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
  }
};

const HandTracker = {
  async start() {
    const video = document.getElementById('webcam');
    try {
      if (typeof Hands === 'undefined' || typeof Camera === 'undefined')
        throw new Error('MediaPipe not loaded');

      const hands = new Hands({
        locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
      });
      hands.setOptions({
        maxNumHands: 1, modelComplexity: 1,
        minDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      hands.onResults(r => this.onResults(r));

      const cam = new Camera(video, {
        onFrame: async () => { await hands.send({ image: video }); },
        width: 320, height: 240,
      });
      await cam.start();
    } catch (e) {
      console.warn('Hand tracking unavailable — mouse fallback active');
      this.fallback();
    }
  },

  onResults(r) {
    if (r.multiHandLandmarks?.length) {
      const lm = r.multiHandLandmarks[0];
      App.handVisible = true;
      App.handRaw = this.openness(lm);
      App.handX   = lm[9].x;
      App.handY   = lm[9].y;
      HandOverlay.draw(lm);
    } else {
      App.handVisible = false;
      HandOverlay.clear();
    }
  },

  openness(lm) {
    const tips = [8, 12, 16, 20], pips = [6, 10, 14, 18];
    let n = 0;
    for (let i = 0; i < 4; i++) { if (lm[tips[i]].y < lm[pips[i]].y) n++; }
    const pw = Math.abs(lm[5].x - lm[17].x);
    if (Math.abs(lm[4].x - lm[0].x) > pw * 0.42) n++;
    return n / 5;
  },

  fallback() {
    App.handVisible = true;
    window.addEventListener('mousemove', e => {
      App.handRaw = clamp(1 - e.clientY / window.innerHeight, 0, 1);
      App.handX   = e.clientX / window.innerWidth;
      App.handY   = e.clientY / window.innerHeight;
      App.handVisible = true;
    });
    window.addEventListener('touchmove', e => {
      const t = e.touches[0];
      App.handRaw = clamp(1 - t.clientY / window.innerHeight, 0, 1);
      App.handX   = t.clientX / window.innerWidth;
      App.handY   = t.clientY / window.innerHeight;
    }, { passive: true });
  }
};

// ─────────────────────────────────────────────────────────────
//  AUDIO MANAGER
//  Files: audio/music.mp3  (looping bg)
//         audio/voiceover.mp3  (box breathing guide)
// ─────────────────────────────────────────────────────────────
const AudioManager = {
  music: null, vo: null, voBody: null, voSoul: null,
  ducked: false, voPlayed: false, voBodyPlayed: false, voSoulPlayed: false,
  voEndCallback: null,

  init() {
    this.music        = document.getElementById('audio-music');
    this.vo           = document.getElementById('audio-vo');
    this.voBody       = document.getElementById('audio-vo-body');
    this.voSoul       = document.getElementById('audio-vo-soul');
    this.ducked       = false;
    this.voPlayed     = false;
    this.voBodyPlayed = false;
    this.voSoulPlayed = false;
  },

  startMusic() {
    if (!this.music) return;
    this.music.volume = 0.42;
    this.music.muted  = false;

    this.music.play().then(() => {
      this._setLPSpin(true);
    }).catch(() => {
      // Browser blocked — play muted, spin LP, unmute on first interaction
      this.music.muted = true;
      this.music.play().then(() => this._setLPSpin(true)).catch(() => {});

      const unlock = () => {
        this.music.muted = false;
        if (this.music.paused) this.music.play().catch(() => {});
      };
      document.addEventListener('click',      unlock, { once: true });
      document.addEventListener('touchstart', unlock, { once: true });
      document.addEventListener('keydown',    unlock, { once: true });
    });
  },

  // Toggle play / pause (LP spins when playing)
  togglePlay() {
    if (!this.music) return;
    if (this.music.paused) {
      this.music.muted = false;
      this.music.play().catch(() => {});
      this._setLPSpin(true);
    } else {
      this.music.pause();
      this._setLPSpin(false);
    }
  },

  _setLPSpin(on) {
    document.getElementById('lp-img')?.classList.toggle('spinning', on);
  },

  // Called once when breathing practice begins
  playVO() {
    if (!this.vo || this.voPlayed) return;
    this.voPlayed = true;
    this.ducked   = true;
    this._fadeVol(this.music, 0.11, 1100);
    this.vo.currentTime = 0;
    this.vo.play().catch(() => {});
    this.vo.onended = () => {
      this.ducked = false;
      this._fadeVol(this.music, 0.42, 1800);
      if (this.voEndCallback) { this.voEndCallback(); this.voEndCallback = null; }
    };
  },

  // Called once when body breathing practice begins
  playBodyVO() {
    if (!this.voBody || this.voBodyPlayed) return;
    this.voBodyPlayed = true;
    this.ducked       = true;
    this._fadeVol(this.music, 0.11, 1100);
    this.voBody.currentTime = 0;
    this.voBody.play().catch(() => {});
    this.voBody.onended = () => {
      this.ducked = false;
      this._fadeVol(this.music, 0.42, 1800);
    };
  },

  // Called once when soul phase becomes active — music keeps playing softly
  playSoulVO(onEnd) {
    if (!this.voSoul || this.voSoulPlayed) return;
    this.voSoulPlayed = true;
    this.ducked       = true;
    this._fadeVol(this.music, 0.16, 1200);
    this.voSoul.currentTime = 0;
    this.voSoul.play().catch(() => {});
    this.voSoul.onended = () => {
      this.ducked = false;
      this._fadeVol(this.music, 0.38, 2200);
      if (onEnd) onEnd();
    };
  },

  _fadeVol(audio, target, ms) {
    if (!audio) return;
    const from = audio.volume;
    const t0   = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      audio.volume = lerp(from, target, smoothstep(t));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
};

// ─────────────────────────────────────────────────────────────
//  GESTURE CORRECTNESS  (standalone — used by MindBreath, MindViz, BoxSquare)
// ─────────────────────────────────────────────────────────────
function isGestureCorrect() {
  const s = MindBreath.state;
  if (s === 'waiting' || s === 'detected' || s === 'complete') return true;
  if (!App.handVisible) return false;
  if (s === 'inhale')                 return App.handSmooth > 0.55; // open palm
  if (s === 'hold1' || s === 'hold2') return App.handSmooth < 0.45; // closed fist
  if (s === 'exhale')                 return App.handSmooth > 0.55; // open palm
  return false;
}

// ─────────────────────────────────────────────────────────────
//  MIND BREATH  — one full box cycle: inhale·hold·exhale·hold (4s each)
//  Phase timer is GATED — only advances while gesture is correct.
//  This keeps everything (animations, countdown, VO) in lockstep.
// ─────────────────────────────────────────────────────────────
const MindBreath = {
  PHASES:       ['inhale', 'hold1', 'exhale', 'hold2'],
  DURATION:     4000,
  DETECT_HOLD:  900,
  state:        'waiting',
  phaseStart:   0,
  detectStart:  0,
  _gatedElapsed: 0,   // ms of correct-gesture time in current phase
  _gatedPrev:    0,   // last timestamp for gated delta

  init() {
    this.state         = 'waiting';
    this.phaseStart    = 0;
    this.detectStart   = 0;
    this._gatedElapsed = 0;
    this._gatedPrev    = 0;
  },

  isHandInCenter() {
    return App.handVisible &&
           Math.abs(App.handX - 0.5) < 0.40 &&
           App.handY > 0.12 && App.handY < 0.88;
  },

  // 0→1 progress based on gated (gesture-correct) time only
  getTotalProgress() {
    if (this.state === 'waiting' || this.state === 'detected') return 0;
    if (this.state === 'complete') return 1;
    const idx = this.PHASES.indexOf(this.state);
    if (idx === -1) return 0;
    return (idx + clamp(this._gatedElapsed / this.DURATION, 0, 1)) / 4;
  },

  getDetectProgress(now) {
    if (this.state !== 'waiting' || !this.detectStart) return 0;
    return clamp((now - this.detectStart) / this.DETECT_HOLD, 0, 1);
  },

  // Countdown based on gated elapsed — freezes when gesture wrong
  getCountdown() {
    if (this.state === 'waiting' || this.state === 'detected' || this.state === 'complete') return 0;
    return Math.ceil(Math.max(0, (this.DURATION - this._gatedElapsed) / 1000));
  },

  update(now) {
    if (!App.phaseReady || App.phase !== 'mind') return;

    if (this.state === 'waiting') {
      if (this.isHandInCenter()) {
        if (!this.detectStart) this.detectStart = now;
        if (now - this.detectStart >= this.DETECT_HOLD) {
          this._go('detected', now);
        }
      } else {
        this.detectStart = 0;
      }
      return;
    }

    if (this.state === 'detected') {
      const elapsed    = now - this.phaseStart;
      const cdEl       = document.getElementById('detect-countdown');
      const remaining  = Math.ceil((3000 - elapsed) / 1000);
      const displayNum = Math.min(3, Math.max(1, remaining));

      if (elapsed < 3000) {
        if (cdEl && cdEl.textContent !== String(displayNum)) {
          cdEl.textContent = displayNum;
          cdEl.classList.remove('cd-pop');
          void cdEl.offsetWidth;          // force reflow → restart animation
          cdEl.classList.add('cd-pop');
        }
      } else {
        if (cdEl) { cdEl.classList.remove('cd-pop'); cdEl.textContent = ''; }
        AudioManager.playVO();
        this._go('inhale', now);
      }
      return;
    }

    if (this.state === 'complete') return;

    // Advance gated elapsed only when gesture is correct
    if (isGestureCorrect()) {
      if (this._gatedPrev > 0) this._gatedElapsed += now - this._gatedPrev;
    }
    this._gatedPrev = now;

    if (this._gatedElapsed >= this.DURATION) {
      const idx  = this.PHASES.indexOf(this.state);
      const next = idx < 3 ? this.PHASES[idx + 1] : 'complete';
      this._go(next, now);
    }
  },

  _go(next, now) {
    // Clear the 3-2-1 countdown whenever we leave any state
    const cdEl = document.getElementById('detect-countdown');
    if (cdEl) { cdEl.classList.remove('cd-pop'); cdEl.textContent = ''; }

    this.state         = next;
    this.phaseStart    = now;
    this._gatedElapsed = 0;
    this._gatedPrev    = 0;
    BreathUI.sync(next);
    MindInstruct.onPhase(next);
    if (next === 'complete') {
      const doGoBody = () => setTimeout(() => goPhase('body'), 500);
      const vo = AudioManager.vo;
      if (vo && !vo.ended && AudioManager.voPlayed) {
        AudioManager.voEndCallback = doGoBody; // wait for VO to finish
      } else {
        doGoBody();
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  BODY BREATH  — single 4-7-8 cycle (gated, same architecture as MindBreath)
// ─────────────────────────────────────────────────────────────
const BodyBreath = {
  PHASES:    ['inhale', 'hold', 'exhale'],
  DURATIONS: { inhale: 6700, hold: 11800, exhale: 13500 },
  TOTAL_MS:  32000,
  DETECT_HOLD: 900,
  state: 'waiting', phaseStart: 0, detectStart: 0,
  _gatedElapsed: 0, _gatedPrev: 0,

  init() {
    this.state = 'waiting'; this.phaseStart = 0; this.detectStart = 0;
    this._gatedElapsed = 0; this._gatedPrev = 0;
  },

  isHandInCenter() {
    return App.handVisible &&
           Math.abs(App.handX - 0.5) < 0.40 &&
           App.handY > 0.12 && App.handY < 0.88;
  },

  // 0 → 1 over the full 19s cycle (gated)
  getTotalProgress() {
    if (this.state === 'waiting' || this.state === 'detected') return 0;
    if (this.state === 'complete') return 1;
    const idx = this.PHASES.indexOf(this.state);
    if (idx === -1) return 0;
    const doneMs = this.PHASES.slice(0, idx).reduce((s, p) => s + this.DURATIONS[p], 0);
    return (doneMs + Math.min(this._gatedElapsed, this.DURATIONS[this.state])) / this.TOTAL_MS;
  },

  getDetectProgress(now) {
    if (this.state !== 'waiting' || !this.detectStart) return 0;
    return clamp((now - this.detectStart) / this.DETECT_HOLD, 0, 1);
  },

  getCountdown() {
    if (this.state === 'waiting' || this.state === 'detected' || this.state === 'complete') return 0;
    return Math.ceil(Math.max(0, (this.DURATIONS[this.state] - this._gatedElapsed) / 1000));
  },

  isGestureCorrect() {
    const s = this.state;
    if (s === 'waiting' || s === 'detected' || s === 'complete') return true;
    if (!App.handVisible) return false;
    if (s === 'inhale') return App.handSmooth > 0.55; // open palm
    if (s === 'hold')   return App.handSmooth < 0.45; // closed fist
    if (s === 'exhale') return App.handSmooth > 0.55; // open palm
    return false;
  },

  update(now) {
    if (!App.phaseReady || App.phase !== 'body') return;

    if (this.state === 'waiting') {
      if (this.isHandInCenter()) {
        if (!this.detectStart) this.detectStart = now;
        if (now - this.detectStart >= this.DETECT_HOLD) this._go('detected', now);
      } else {
        this.detectStart = 0;
      }
      return;
    }

    if (this.state === 'detected') {
      const elapsed   = now - this.phaseStart;
      const cdEl      = document.getElementById('detect-countdown');
      const remaining = Math.ceil((3000 - elapsed) / 1000);
      const num       = Math.min(3, Math.max(1, remaining));
      if (elapsed < 3000) {
        if (cdEl && cdEl.textContent !== String(num)) {
          cdEl.textContent = num;
          cdEl.classList.remove('cd-pop');
          void cdEl.offsetWidth;
          cdEl.classList.add('cd-pop');
        }
      } else {
        if (cdEl) { cdEl.classList.remove('cd-pop'); cdEl.textContent = ''; }
        AudioManager.playBodyVO();
        BodyViz.startVideo();   // video + VO start together
        this._go('inhale', now);
      }
      return;
    }

    if (this.state === 'complete') return;

    if (this.isGestureCorrect()) {
      if (this._gatedPrev > 0) this._gatedElapsed += now - this._gatedPrev;
    }
    this._gatedPrev = now;

    if (this._gatedElapsed >= this.DURATIONS[this.state]) {
      const idx  = this.PHASES.indexOf(this.state);
      const next = idx < 2 ? this.PHASES[idx + 1] : 'complete';
      this._go(next, now);
    }
  },

  _go(next, now) {
    const cdEl = document.getElementById('detect-countdown');
    if (cdEl) { cdEl.classList.remove('cd-pop'); cdEl.textContent = ''; }
    this.state = next; this.phaseStart = now;
    this._gatedElapsed = 0; this._gatedPrev = 0;
    BodyBreathUI.sync(next);
    BodyInstruct.onPhase(next);
    if (next === 'complete') {
      // Transition to SOUL after VO finishes (or 8s fallback)
      // Use a fired flag so only one of the two paths actually calls goPhase
      let soulFired = false;
      const doSoul = () => {
        if (soulFired) return;
        if (App.transitioning) { setTimeout(doSoul, 400); return; } // retry until free
        soulFired = true;
        goPhase('soul');
      };
      const vb = AudioManager.voBody;
      if (vb && !vb.ended && !vb.paused) {
        vb.addEventListener('ended', () => setTimeout(doSoul, 800), { once: true });
        setTimeout(doSoul, 12000); // fallback: 12s max wait
      } else {
        setTimeout(doSoul, 1800);
      }
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  BODY BREATH UI  (ring + label — BODY)
// ─────────────────────────────────────────────────────────────
const BodyBreathUI = {
  sync(state) {
    const labels = {
      waiting: '···', detected: '···',
      inhale: 'INHALE', hold: 'HOLD', exhale: 'EXHALE', complete: '✓'
    };
    const el = document.getElementById('lbl-body-phase');
    if (el) el.textContent = labels[state] || '···';
    const ring = document.getElementById('ring-body');
    if (ring) {
      ring.classList.remove('inhale', 'exhale', 'hold');
      if (state === 'inhale') ring.classList.add('inhale');
      else if (state === 'hold')   ring.classList.add('hold');
      else if (state === 'exhale') ring.classList.add('exhale');
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  BREATH UI  (ring + phase/hint labels — MIND)
// ─────────────────────────────────────────────────────────────
const BreathUI = {
  sync(state) {
    const labels = {
      waiting: '···', detected: '···', inhale: 'INHALE', hold1: 'HOLD',
      exhale: 'EXHALE', hold2: 'HOLD', complete: '✓'
    };
    const hints = {
      waiting:  '',
      detected: '',
      inhale:   '<img src="images/inhale hand sign.png" alt="" class="hand-sign-img"> open palm',
      hold1:    '<img src="images/exhale hand sign.png" alt="" class="hand-sign-img"> close fist',
      exhale:   '<img src="images/inhale hand sign.png" alt="" class="hand-sign-img"> open palm',
      hold2:    '<img src="images/exhale hand sign.png" alt="" class="hand-sign-img"> close fist',
      complete: '',
    };
    const steps = {
      waiting: '', detected: '', inhale: '1 · 4', hold1: '2 · 4',
      exhale: '3 · 4', hold2: '4 · 4', complete: 'complete',
    };

    const el = document.getElementById('lbl-phase');
    if (el) el.textContent = labels[state] || '···';

    const hintEl = document.getElementById('lbl-hint');
    if (hintEl) hintEl.innerHTML = hints[state] || '';

    const cyclesEl = document.getElementById('lbl-cycles');
    if (cyclesEl) cyclesEl.textContent = steps[state] || '';

    const ring = document.getElementById('ring-mind');
    if (ring) {
      ring.classList.remove('inhale', 'exhale', 'hold');
      if (state === 'inhale') ring.classList.add('inhale');
      else if (state === 'exhale') ring.classList.add('exhale');
      else if (state === 'hold1' || state === 'hold2') ring.classList.add('hold');
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  GESTURE HELPER  (3 states: open / flat / closed)
// ─────────────────────────────────────────────────────────────
function getGesture(openness) {
  if (openness > 0.65) return 'open';
  if (openness < 0.32) return 'closed';
  return 'flat';
}

// Hand badge (3-state)
let _lastGesture = '';
function updateHandDisplay() {
  if (!App.phaseReady) return;
  const g = getGesture(App.handSmooth);
  if (g === _lastGesture) return;
  _lastGesture = g;
  const imgMap = {
    open:   'images/inhale hand sign.png',
    flat:   'images/hold hand sign.png',
    closed: 'images/exhale hand sign.png',
  };
  const labels = { open: 'OPEN', flat: 'FLAT', closed: 'CLOSED' };
  const icon = document.getElementById('hand-icon-lbl');
  const lbl  = document.getElementById('hand-state-lbl');
  if (icon) icon.innerHTML = `<img src="${imgMap[g]}" alt="${g}" class="hand-badge-img">`;
  if (lbl)  lbl.textContent = labels[g];
}

// Countdown inside breath widget
function updateCountDisplay(now) {
  const el = document.getElementById('lbl-count');
  if (!el) return;
  if (App.phase !== 'mind' || !App.phaseReady) { el.textContent = ''; return; }
  const n = MindBreath.getCountdown();
  el.textContent = n > 0 ? n : '';
}

// ─────────────────────────────────────────────────────────────
//  BOX SQUARE  — corner visualization, one side per 4s phase
// ─────────────────────────────────────────────────────────────
const BoxSquare = {
  _gatedTP:    0,   // gesture-gated total progress (0 → 4)
  _prevNow:    0,
  _prevState:  '',

  reset() {
    this._gatedTP   = 0;
    this._prevNow   = 0;
    this._prevState = '';
  },

  draw(now) {
    const s  = Math.min(W, H) * 0.50;
    const x0 = W / 2 - s / 2;
    const y0 = H / 2 - s / 2;

    // ── Gesture-gated progress ─────────────────────────────
    const st  = MindBreath.state;
    const idx = MindBreath.PHASES.indexOf(st);
    if (st !== this._prevState) {
      if (st === 'complete') this._gatedTP = 4;
      else if (idx >= 0 && this._gatedTP < idx) this._gatedTP = idx;
      this._prevState = st;
    }
    if (idx >= 0 && isGestureCorrect() && this._prevNow > 0) {
      const dt = (now - this._prevNow) / MindBreath.DURATION;
      this._gatedTP = Math.min(idx + 1, this._gatedTP + dt);
    }
    this._prevNow = now;
    const tp = this._gatedTP;  // 0 → 4

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';

    // ── Static square outline ───────────────────────────────
    ctx.strokeStyle = 'rgba(18, 38, 60, 0.22)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(x0,     y0);
    ctx.lineTo(x0 + s, y0);
    ctx.lineTo(x0 + s, y0 + s);
    ctx.lineTo(x0,     y0 + s);
    ctx.closePath();
    ctx.stroke();

    // ── Corner dots ─────────────────────────────────────────
    [[x0, y0], [x0+s, y0], [x0+s, y0+s], [x0, y0+s]].forEach(([vx, vy]) => {
      ctx.beginPath(); ctx.arc(vx, vy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,38,60,0.22)'; ctx.fill();
    });

    // ── Travelling pastel-blue dot ───────────────────────────
    // Sides: top → right → bottom → left
    const corners = [
      [x0,     y0    ],
      [x0 + s, y0    ],
      [x0 + s, y0 + s],
      [x0,     y0 + s],
      [x0,     y0    ],  // wrap back to start
    ];
    const seg = Math.min(tp, 4);
    const i   = Math.min(3, Math.floor(seg));
    const t   = seg - i;
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const dotX = lerp(ax, bx, t);
    const dotY = lerp(ay, by, t);
    const dotR = s * 0.036;

    // Traveller: circle-count image
    if (circleCountImg.complete) {
      const sz = dotR * 2.4;
      ctx.save();
      ctx.drawImage(circleCountImg, dotX - sz / 2, dotY - sz / 2, sz, sz);
      ctx.restore();
    } else {
      // Fallback dot if image not loaded yet
      ctx.save();
      ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(128,196,240,0.94)'; ctx.fill();
      ctx.restore();
    }


    ctx.restore();
  }
};

// ─────────────────────────────────────────────────────────────
//  BODY TRIANGLE  — traces the 4-7-8 cycle (inhale→hold→exhale)
//  Split into update / drawShape / drawLabels so the lung video
//  can be composited between the geometry and the text overlay.
// ─────────────────────────────────────────────────────────────
const BodyTriangle = {
  _gatedTP: 0, _prevNow: 0, _prevState: '',

  reset() { this._gatedTP = 0; this._prevNow = 0; this._prevState = ''; },

  // Shared vertex/size data
  _verts() {
    const r  = Math.min(W, H) * 0.50;
    const cx = W / 2, cy = H / 2 + H * 0.08;
    return { r, cx, cy, V: [
      [cx,                         cy - r      ],  // 0 top
      [cx + r * Math.sqrt(3) / 2,  cy + r / 2  ],  // 1 bottom-right
      [cx - r * Math.sqrt(3) / 2,  cy + r / 2  ],  // 2 bottom-left
    ]};
  },

  // Advance gated progress — call once per frame before drawShape/drawLabels
  update(now) {
    const st  = BodyBreath.state;
    const idx = BodyBreath.PHASES.indexOf(st);
    if (st !== this._prevState) {
      if (st === 'complete') this._gatedTP = 3;
      else if (idx >= 0 && this._gatedTP < idx) this._gatedTP = idx;
      this._prevState = st;
    }
    if (idx >= 0 && BodyBreath.isGestureCorrect() && this._prevNow > 0) {
      this._gatedTP = Math.min(idx + 1,
        this._gatedTP + (now - this._prevNow) / BodyBreath.DURATIONS[st]);
    }
    this._prevNow = now;
  },

  // Static outline + travelling pastel-blue dot
  drawShape() {
    const { r, V } = this._verts();
    const tp = this._gatedTP;   // 0 → 3

    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';

    // ── Static triangle outline ──────────────────────────────
    ctx.strokeStyle = 'rgba(18,38,60,0.22)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(...V[2]); ctx.lineTo(...V[0]);
    ctx.lineTo(...V[1]); ctx.lineTo(...V[2]);
    ctx.stroke();

    // ── Corner dots ──────────────────────────────────────────
    V.forEach(([vx, vy]) => {
      ctx.beginPath(); ctx.arc(vx, vy, 3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(18,38,60,0.22)'; ctx.fill();
    });

    // ── Travelling dot (inhale V2→V0, hold V0→V1, exhale V1→V2) ─
    const corners = [V[2], V[0], V[1], V[2]];   // 3 segments + wrap
    const seg = Math.min(tp, 3);
    const si  = Math.min(2, Math.floor(seg));
    const t   = seg - si;
    const [ax, ay] = corners[si];
    const [bx, by] = corners[si + 1];
    const dotX = lerp(ax, bx, t);
    const dotY = lerp(ay, by, t);
    const dotR = r * 0.045;

    // Traveller: circle-count image
    if (circleCountImg.complete) {
      const sz = dotR * 2.4;
      ctx.save();
      ctx.drawImage(circleCountImg, dotX - sz / 2, dotY - sz / 2, sz, sz);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath(); ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(128,196,240,0.94)'; ctx.fill();
      ctx.restore();
    }

    ctx.restore();
  },

  // Phase name + countdown text — drawn AFTER the video so text floats on top
  drawLabels() {}
};

// ─────────────────────────────────────────────────────────────
//  MIND INSTRUCTION
// ─────────────────────────────────────────────────────────────
const MindInstruct = {
  el: null, _cur: '',

  init() {
    this.el   = document.getElementById('mind-instruction');
    this._cur = '';
    this._show('Raise your hand to the center of the screen');
  },

  onPhase(state) {
    const msgs = {
      detected: 'Hand detected — get ready...',
      inhale:   'Inhale slowly... open your palm',
      hold1:    'Hold... close your fist',
      exhale:   'Exhale slowly... open your palm',
      hold2:    'Hold... close your fist',
      complete: 'Beautiful. Your mind is still.',
    };
    this._show(msgs[state] || '');
  },

  _show(text) {
    if (!this.el || this._cur === text) return;
    this._cur = text;
    this.el.style.opacity = '0';
    setTimeout(() => {
      if (this.el && this._cur === text) {
        this.el.textContent = text;
        this.el.style.opacity = '1';
      }
    }, 550);
  },

  update() {
    if (App.phase !== 'mind' || !App.phaseReady) return;
    if (MindBreath.state !== 'waiting') return;
    if (!App.handVisible) {
      this._show('Raise your hand to the center of the screen');
    } else if (!MindBreath.isHandInCenter()) {
      this._show('Move your hand to the center');
    } else {
      this._show('Hold still...');
    }
  },

  hide() {
    if (this.el) { this.el.style.opacity = '0'; this._cur = ''; }
  }
};

// ─────────────────────────────────────────────────────────────
//  BODY INSTRUCTION
// ─────────────────────────────────────────────────────────────
const BodyInstruct = {
  el: null, _cur: '',

  init() {
    this.el   = document.getElementById('body-instruction');
    this._cur = '';
    this._show('Raise your hand to the center of the screen');
  },

  onPhase(state) {
    const msgs = {
      detected: 'Hand detected — get ready...',
      inhale:   'Inhale slowly... open your palm',
      hold:     'Hold... close your fist',
      exhale:   'Exhale slowly... open your palm',
      complete: 'Your body is nourished.',
    };
    this._show(msgs[state] || '');
  },

  _show(text) {
    if (!this.el || this._cur === text) return;
    this._cur = text;
    this.el.style.opacity = '0';
    setTimeout(() => {
      if (this.el && this._cur === text) {
        this.el.textContent = text;
        this.el.style.opacity = '1';
      }
    }, 550);
  },

  update() {
    if (App.phase !== 'body' || !App.phaseReady) return;
    if (BodyBreath.state !== 'waiting') return;
    if (!App.handVisible) {
      this._show('Raise your hand to the center of the screen');
    } else if (!BodyBreath.isHandInCenter()) {
      this._show('Move your hand to the center');
    } else {
      this._show('Hold still...');
    }
  },

  hide() { if (this.el) { this.el.style.opacity = '0'; this._cur = ''; } }
};


// ─────────────────────────────────────────────────────────────
//  ╔══════════════════════════════════════╗
//  ║  MIND VIZ — Tangled Thread           ║
//  ╚══════════════════════════════════════╝
// ─────────────────────────────────────────────────────────────
const MindViz = {
  pts:  [],
  N:    800,
  calm: 0,
  _animTime: 0,
  _prevNow:  0,

  init()    { this.calm = 0; this._animTime = 0; this._prevNow = 0; this.rebuild(); BoxSquare.reset(); },

  rebuild() {
    this.pts = [];
    const cx = W / 2, cy = H / 2;
    const R  = Math.min(W, H) * 0.19;  // fits inside square (0.50 * vmin / 2 = 0.25)

    for (let i = 0; i < this.N; i++) {
      const t   = i / (this.N - 1);
      const env = smoothstep(clamp(t * 5.5, 0, 1)) *
                  smoothstep(clamp((1 - t) * 5.5, 0, 1));
      const sx  = lerp(W * 0.06, W * 0.94, t);
      const sy  = cy;
      const θ   = t * Math.PI * 2 * 13;
      const tx  = cx + R * (
        0.62 * Math.cos(3  * θ + 0.40) +
        0.27 * Math.cos(7  * θ + 1.15) +
        0.12 * Math.cos(11 * θ + 2.50) +
        0.06 * Math.cos(17 * θ + 0.85)
      );
      const ty  = cy + R * (
        0.58 * Math.sin(4  * θ + 0.75) +
        0.23 * Math.sin(9  * θ + 1.80) +
        0.10 * Math.sin(13 * θ + 0.30) +
        0.05 * Math.sin(21 * θ + 1.45)
      );
      this.pts.push({
        tx: lerp(sx, tx, env), ty: lerp(sy, ty, env), sx, sy, t, env,
        ph1: Math.random() * Math.PI * 2,
        ph2: Math.random() * Math.PI * 2,
        ph3: Math.random() * Math.PI * 2,
        ph4: Math.random() * Math.PI * 2,
      });
    }
  },

  draw(now) {
    if (bgImg.complete) ctx.drawImage(bgImg, 0, 0, W, H);
    else { ctx.fillStyle = '#c8d8e8'; ctx.fillRect(0, 0, W, H); }

    if (!App.phaseReady) return;

    BoxSquare.draw(now);

    // ── Hand detection indicator (waiting / detected states) ──────
    if (MindBreath.state === 'waiting' || MindBreath.state === 'detected') {
      const hx = (1 - App.handX) * W;
      const hy = App.handY * H;

      if (MindBreath.state === 'waiting' && App.handVisible && MindBreath.isHandInCenter()) {
        // Arc filling up as user holds hand in center
        const prog = MindBreath.getDetectProgress(now);
        ctx.save();
        ctx.lineWidth   = 2.5;
        ctx.lineCap     = 'round';
        // Ghost ring
        ctx.strokeStyle = 'rgba(32,52,72,0.12)';
        ctx.beginPath();
        ctx.arc(hx, hy, 38, 0, Math.PI * 2);
        ctx.stroke();
        // Filling arc
        ctx.strokeStyle = 'rgba(32,52,72,0.65)';
        ctx.beginPath();
        ctx.arc(hx, hy, 38, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();
        ctx.restore();

      } else if (MindBreath.state === 'detected') {
        // Confirmed — expanding rings pulse
        const t  = (now - MindBreath.phaseStart) / 1200;
        for (let i = 0; i < 3; i++) {
          const phase = (t + i * 0.28) % 1;
          const r     = 28 + phase * 72;
          const alpha = (1 - phase) * 0.55;
          ctx.save();
          ctx.strokeStyle = `rgba(32,52,72,${alpha})`;
          ctx.lineWidth   = 1.5;
          ctx.beginPath();
          ctx.arc(hx, hy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Center dot
        ctx.save();
        ctx.fillStyle = 'rgba(32,52,72,0.55)';
        ctx.beginPath();
        ctx.arc(hx, hy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

      } else if (MindBreath.state === 'waiting' && App.handVisible) {
        // Hand visible but not in center — gentle pulse
        const pulse = 0.5 + 0.5 * Math.sin(now / 500);
        ctx.save();
        ctx.strokeStyle = `rgba(32,52,72,${0.15 * pulse})`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(hx, hy, 32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Advance animation time only when correct gesture — freeze otherwise
    if (isGestureCorrect()) {
      this._animTime += this._prevNow > 0 ? (now - this._prevNow) : 0;
    }
    this._prevNow = now;
    const time = this._animTime / 1000;

    // Calm chases gated progress — auto-freezes when gesture wrong because target stops moving
    const target = MindBreath.getTotalProgress();
    this.calm = Math.min(target, this.calm + 0.004);
    if (this.calm < target - 0.008) this.calm = target - 0.008;

    const c     = smoothstep(this.calm);
    const chaos = 1 - c;
    const amp   = chaos * Math.min(W, H) * 0.10;
    const spd   = 1.6 + chaos * 2.8;

    ctx.save();
    ctx.lineCap    = 'round';
    ctx.lineJoin   = 'round';
    ctx.strokeStyle = `rgba(32,52,72,${lerp(0.58, 0.20, c)})`;
    ctx.lineWidth   = lerp(1.6, 0.75, c);

    ctx.beginPath();
    for (let i = 0; i < this.pts.length; i++) {
      const p   = this.pts[i];
      const osc = p.env * amp;
      const ox  = osc * (
        0.50 * Math.sin(time * spd        + p.ph1) +
        0.32 * Math.sin(time * spd * 1.73 + p.ph2) +
        0.18 * Math.sin(time * spd * 2.91 + p.ph3)
      );
      const oy  = osc * (
        0.48 * Math.cos(time * spd * 1.19 + p.ph4) +
        0.34 * Math.cos(time * spd * 2.07 + p.ph1) +
        0.18 * Math.cos(time * spd * 3.14 + p.ph2)
      );
      const x = lerp(p.tx + ox, p.sx, c);
      const y = lerp(p.ty + oy, p.sy, c);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }
};

// ─────────────────────────────────────────────────────────────
//  ╔══════════════════════════════════════╗
//  ║  BODY VIZ                            ║
//  ╚══════════════════════════════════════╝
// ─────────────────────────────────────────────────────────────
const BodyViz = {
  _video:        null,
  _videoStarted: false,

  init() {
    if (!this._video) {
      this._video = document.getElementById('body-lung-video');
    }
    this._videoStarted = false;
    if (this._video) {
      this._video.pause();
      this._video.currentTime = 0;
      this._video.style.transform = 'translate(-50%,-50%) scale(1)';
    }
  },

  // Start playing — called when practice begins (inhale phase starts)
  startVideo() {
    if (this._video) {
      this._videoStarted = true;
      this._video.currentTime = 0;
      this._video.playbackRate = 0.308; // ~2× slower than before
      this._video.play().catch(() => {});
    }
  },

  rebuild() {},

  draw(now) {
    // 1 — Background
    if (bgImg.complete) ctx.drawImage(bgImg, 0, 0, W, H);
    else { ctx.fillStyle = '#c8d8e8'; ctx.fillRect(0, 0, W, H); }

    if (!App.phaseReady) return;

    // 3 — Triangle outline + progress dot
    BodyTriangle.update(now);
    BodyTriangle.drawShape();

    // 4 — Lung video: play/pause + JS-driven heartbeat scale
    if (this._videoStarted && this._video) {
      const gestureOk = BodyBreath.isGestureCorrect() &&
                        BodyBreath.state !== 'waiting' &&
                        BodyBreath.state !== 'detected' &&
                        BodyBreath.state !== 'complete';
      if (gestureOk && this._video.paused)  this._video.play().catch(() => {});
      if (!gestureOk && !this._video.paused) this._video.pause();

      // Heartbeat scale — JS-driven to avoid CSS animation compositor promotion
      const t   = (now % 1600) / 1600;
      let scale = 1;
      if      (t < 0.075) scale = 1 + (t / 0.075) * 0.030;
      else if (t < 0.160) scale = 1.030 - ((t - 0.075) / 0.085) * 0.013;
      else if (t < 0.250) scale = 1.017 - ((t - 0.160) / 0.090) * 0.017;
      this._video.style.transform = `translate(-50%,-50%) scale(${scale.toFixed(4)})`;
    }

    // 5 — Triangle labels
    BodyTriangle.drawLabels();

    // 6 — Hand detection indicators
    const hx = (1 - App.handX) * W;
    const hy = App.handY * H;

    if (BodyBreath.state === 'waiting' && App.handVisible && BodyBreath.isHandInCenter()) {
      const prog = BodyBreath.getDetectProgress(now);
      ctx.save();
      ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(32,52,72,0.12)';
      ctx.beginPath(); ctx.arc(hx, hy, 38, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(32,52,72,0.65)';
      ctx.beginPath();
      ctx.arc(hx, hy, 38, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
      ctx.stroke();
      ctx.restore();

    } else if (BodyBreath.state === 'detected') {
      const t = (now - BodyBreath.phaseStart) / 3000;
      for (let i = 0; i < 3; i++) {
        const ph = (t + i * 0.28) % 1;
        ctx.save();
        ctx.strokeStyle = `rgba(32,52,72,${(1 - ph) * 0.55})`;
        ctx.lineWidth   = 1.5;
        ctx.beginPath(); ctx.arc(hx, hy, 28 + ph * 72, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      ctx.save();
      ctx.fillStyle = 'rgba(32,52,72,0.55)';
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();

    } else if (BodyBreath.state === 'waiting' && App.handVisible) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 500);
      ctx.save();
      ctx.strokeStyle = `rgba(32,52,72,${0.15 * pulse})`;
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.arc(hx, hy, 32, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
};

// ─────────────────────────────────────────────────────────────
//  ╔══════════════════════════════════════╗
//  ║  SOUL VIZ — Two reaching hands       ║
//  ╚══════════════════════════════════════╝
//
//  bottom-hand-soul.png   → bottom-left corner
//  top-hand-soul.png      → top-right corner
//  Open palm & hold  → hands slowly approach + 4-pt star appears
//  Fist / no hand    → hands drift back apart
//  Sparse star field in background.
//  VO plays once after 3-2-1 countdown. Outro fires when VO ends.
// ─────────────────────────────────────────────────────────────
const SoulViz = {
  stars: [],
  dust:  [],

  _outroTriggered:   false,
  _voPlayed:         false,
  _closeness:        0,    // 0 = apart, 1 = fully together
  _cycleCount:       0,    // how many open-palm cycles completed
  _wasClose:         false,// was closeness above threshold last frame
  _midShown:         false,
  _finalShown:       false,
  _prlxX:            0,    // smoothed parallax X offset (px)
  _prlxY:            0,    // smoothed parallax Y offset (px)

  // detection gate
  _detectState:      'waiting',
  _detectStart:      0,
  _detectPhaseStart: 0,
  _activeStart:      0,    // timestamp when _detectState became 'active'
  DETECT_HOLD:       900,

  STAR_COUNT:    7200,
  DUST_COUNT:    2200,

  init() {
    this._outroTriggered   = false;
    this._detectState      = 'waiting';
    this._detectStart      = 0;
    this._detectPhaseStart = 0;
    this._voPlayed         = false;
    this._closeness        = 0;
    this._cycleCount       = 0;
    this._wasClose         = false;
    this._midShown         = false;
    this._finalShown       = false;
    this._prlxX            = 0;
    this._prlxY            = 0;
    this._activeStart      = 0;

    // Reset hand positions
    const bh = document.getElementById('soul-bottom-hand');
    const th = document.getElementById('soul-top-hand');
    if (bh) { bh.style.transform = ''; bh.style.filter = 'brightness(1.35) saturate(1.15)'; }
    if (th) { th.style.transform = ''; th.style.filter = 'brightness(1.35) saturate(1.15)'; }

    // Force-hide webcam in soul phase (no transition delay)
    const wcam = document.getElementById('webcam-wrap');
    if (wcam) { wcam.classList.remove('visible'); wcam.style.opacity = '0'; wcam.style.pointerEvents = 'none'; }

    // Hide soul messages
    document.getElementById('soul-msg')?.classList.remove('show');
    document.getElementById('soul-final')?.classList.remove('show');
    const _sf = document.getElementById('soul-flower');
    if (_sf) _sf.style.opacity = '0';

    this.rebuild();
  },

  isHandInCenter() {
    return App.handVisible &&
           Math.abs(App.handX - 0.5) < 0.40 &&
           App.handY > 0.12 && App.handY < 0.88;
  },

  getDetectProgress(now) {
    if (this._detectState !== 'waiting' || !this._detectStart) return 0;
    return clamp((now - this._detectStart) / this.DETECT_HOLD, 0, 1);
  },

  rebuild() {
    const W2 = W || window.innerWidth, H2 = H || window.innerHeight;
    this.stars = [];
    for (let i = 0; i < this.STAR_COUNT; i++) {
      // Power-law: mostly sub-pixel, very few medium accent stars
      const r = 0.018 + Math.pow(Math.random(), 4.2) * 0.90;
      this.stars.push({
        x: Math.random() * W2, y: Math.random() * H2,
        r, hue: rand(195, 268),
        baseAlpha: 0.08 + Math.random() * 0.62,
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.003, 0.016),
        depth: rand(0.10, 1.00),  // parallax layer (deeper = more movement)
      });
    }
    this.dust = [];
    for (let i = 0; i < this.DUST_COUNT; i++) {
      this.dust.push({
        x: Math.random() * W2, y: Math.random() * H2,
        r: 0.015 + Math.random() * 0.09,
        hue: rand(200, 270),
        alpha: rand(0.04, 0.22),
        phase: Math.random() * Math.PI * 2,
        speed: rand(0.003, 0.014),
        depth: rand(0.05, 0.55),
      });
    }
  },

  // Draw star-soul image at (x,y)
  draw(now) {
    const cx = W / 2, cy = H / 2;
    const open = App.handSmooth;

    // 1 ── Background — always deep dark
    const sg = ctx.createRadialGradient(cx, cy * 0.55, 0, cx, H * 0.60, Math.max(W, H) * 0.90);
    sg.addColorStop(0,   'rgb(10,16,42)');
    sg.addColorStop(0.5, 'rgb(5,9,26)');
    sg.addColorStop(1,   'rgb(1,2,10)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, W, H);

    if (!App.phaseReady) return;

    // 1b ── Detection gate ─────────────────────────────────────
    if (this._detectState === 'waiting') {
      if (this.isHandInCenter()) {
        if (!this._detectStart) this._detectStart = now;
        if (now - this._detectStart >= this.DETECT_HOLD) {
          this._detectState      = 'detected';
          this._detectPhaseStart = now;
          const cdEl = document.getElementById('detect-countdown');
          if (cdEl) cdEl.textContent = '3';
        }
      } else { this._detectStart = 0; }
      return;
    }

    if (this._detectState === 'detected') {
      const elapsed = now - this._detectPhaseStart;
      const cdEl    = document.getElementById('detect-countdown');
      const dn      = Math.min(3, Math.max(1, Math.ceil((3000 - elapsed) / 1000)));
      if (elapsed < 3000) {
        if (cdEl && cdEl.textContent !== String(dn)) {
          cdEl.textContent = dn;
          cdEl.classList.remove('cd-pop'); void cdEl.offsetWidth; cdEl.classList.add('cd-pop');
        }
      } else {
        if (cdEl) { cdEl.classList.remove('cd-pop'); cdEl.textContent = ''; }
        this._detectState = 'active';
        this._activeStart = now;
      }
      return;
    }

    // ── active ─────────────────────────────────────────────────

    // Play soul VO once (music ducks softly, keeps running; no auto-outro)
    if (!this._voPlayed) {
      this._voPlayed = true;
      AudioManager.playSoulVO(null);
    }

    // 2 ── Closeness driven by CLOSED fist ───────────────────
    // Fist (hold) → hands come together
    // Open palm (hand visible, not fist) → hands drift apart
    // No hand detected → FREEZE position (no drift)
    const isFist  = App.handVisible && open < 0.45;
    const isOpen  = App.handVisible && open >= 0.45;
    if (isFist)       this._closeness = lerp(this._closeness, 1, 0.022);
    else if (isOpen)  this._closeness = lerp(this._closeness, 0, 0.015);
    // else: !handVisible → freeze _closeness unchanged
    const cl = this._closeness;

    // Smooth parallax offset driven by hand position (applied locally near hand)
    const tpx = App.handVisible ? (App.handX - 0.5) * 55 : 0;
    const tpy = App.handVisible ? (App.handY - 0.5) * 36 : 0;
    this._prlxX = lerp(this._prlxX, tpx, 0.038);
    this._prlxY = lerp(this._prlxY, tpy, 0.038);
    // Hand canvas coords (mirrored X) for local influence field
    const hxCanvas   = App.handVisible ? (1 - App.handX) * W : -9999;
    const hyCanvas   = App.handVisible ? App.handY * H       : -9999;
    const prlxRadius = Math.min(W, H) * 0.38;  // radius of local influence

    // Count hold cycles (together → apart = 1 cycle)
    if (this._wasClose && cl < 0.25) {
      this._cycleCount++;
      if (this._cycleCount >= 3 && !this._midShown) {
        this._midShown = true;
        document.getElementById('soul-msg')?.classList.add('show');
      }
      if (this._cycleCount >= 6 && !this._finalShown) {
        this._finalShown = true;
        document.getElementById('soul-msg')?.classList.remove('show');
        document.getElementById('soul-final')?.classList.add('show');
      }
    }
    this._wasClose = cl > 0.60;

    // 3 ── Move hand images via CSS transform ──────────────────
    const vmin  = Math.min(W, H);
    const moveX = vmin * 0.38 * cl;
    const moveY = vmin * 0.32 * cl;

    const bh = document.getElementById('soul-bottom-hand');
    const th = document.getElementById('soul-top-hand');
    if (bh) {
      bh.style.transform = `translate(${moveX.toFixed(1)}px,${(-moveY).toFixed(1)}px)`;
      bh.style.filter    = `brightness(${(1.35 + cl * 0.35).toFixed(2)}) saturate(1.15) drop-shadow(0 0 18px rgba(120,170,255,0.25))`;
    }
    if (th) {
      th.style.transform = `translate(${(-moveX).toFixed(1)}px,${moveY.toFixed(1)}px)`;
      th.style.filter    = `brightness(${(1.35 + cl * 0.45).toFixed(2)}) saturate(1.15) drop-shadow(0 0 18px rgba(120,170,255,0.25))`;
    }

    // 4 ── Flower + sparkle stars: fade in when hands nearly touching ─
    const flowerAlphaVal = clamp((cl - 0.72) / 0.13, 0, 1).toFixed(3);
    const flowerEl = document.getElementById('soul-flower');
    if (flowerEl) flowerEl.style.opacity = flowerAlphaVal;
    const st1 = document.getElementById('soul-star-1');
    const st2 = document.getElementById('soul-star-2');
    if (st1) st1.style.opacity = flowerAlphaVal;
    if (st2) st2.style.opacity = flowerAlphaVal;

    if (cl > 0.85) {
      // Soft ambient glow behind flower when hands are together
      const glowR = vmin * 0.22;
      const glow  = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0,   `rgba(140,180,255,0.18)`);
      glow.addColorStop(1,   'transparent');
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.beginPath(); ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow; ctx.fill();
      ctx.restore();
    }

    // 6 ── Dust (localized parallax) ──────────────────────────
    for (const dp of this.dust) {
      dp.phase += dp.speed;
      const tw = 0.5 + 0.5 * Math.sin(dp.phase);
      const sa = dp.alpha * tw;
      if (sa < 0.025) continue;
      const ddxd = dp.x - hxCanvas, ddyd = dp.y - hyCanvas;
      const distD = Math.sqrt(ddxd * ddxd + ddyd * ddyd);
      const lf = App.handVisible ? Math.max(0, 1 - distD / prlxRadius) : 0;
      const dx = dp.x + this._prlxX * dp.depth * lf;
      const dy = dp.y + this._prlxY * dp.depth * lf;
      ctx.beginPath(); ctx.arc(dx, dy, dp.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${dp.hue},50%,90%,${sa.toFixed(3)})`;
      ctx.fill();
    }

    // 7 ── Stars (localized parallax) ─────────────────────────
    for (const s of this.stars) {
      s.phase += s.speed;
      const tw = 0.5 + 0.5 * Math.sin(s.phase);
      const sa = Math.min(s.baseAlpha * tw, 1);
      if (sa < 0.012) continue;
      const sr = s.r * (0.8 + tw * 0.26);
      const ddxs = s.x - hxCanvas, ddys = s.y - hyCanvas;
      const distS = Math.sqrt(ddxs * ddxs + ddys * ddys);
      const lf = App.handVisible ? Math.max(0, 1 - distS / prlxRadius) : 0;
      const sx = s.x + this._prlxX * s.depth * lf;
      const sy = s.y + this._prlxY * s.depth * lf;

      if (sr > 0.65) {
        const hg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 5.5);
        hg.addColorStop(0, `hsla(${s.hue},65%,94%,${Math.min(sa * 0.40, 0.82)})`);
        hg.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(sx, sy, sr * 5.5, 0, Math.PI * 2);
        ctx.fillStyle = hg; ctx.fill();
      }

      ctx.beginPath(); ctx.arc(sx, sy, Math.max(sr, 0.28), 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${s.hue},42%,96%,${sa.toFixed(3)})`;
      ctx.fill();

      // Subtle cross sparkle on largest stars
      if (s.r > 1.05 && sa > 0.28) {
        const arm = sr * 4.0 * tw;
        ctx.save();
        ctx.strokeStyle = `hsla(${s.hue},60%,98%,${Math.min(sa * 0.38, 0.60)})`;
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        ctx.moveTo(sx - arm, sy); ctx.lineTo(sx + arm, sy);
        ctx.moveTo(sx, sy - arm); ctx.lineTo(sx, sy + arm);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 8 ── Soft user-hand glow ────────────────────────────────
    if (App.handVisible) {
      const hx = (1 - App.handX) * W, hy = App.handY * H;
      const hr = 38 + open * 48;
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
      hg.addColorStop(0, `rgba(165,195,255,${0.04 + open * 0.09})`);
      hg.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = hg; ctx.fill();
    }

  },

  _triggerOutro() {
    if (this._outroTriggered) return;
    this._outroTriggered = true;
    ['soul-bottom-hand','soul-top-hand'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.transform = ''; el.style.filter = ''; }
    });
    document.getElementById('soul-msg')?.classList.remove('show');
    document.getElementById('soul-final')?.classList.remove('show');
    // Restore webcam inline style so future phases can control it normally
    const wcam = document.getElementById('webcam-wrap');
    if (wcam) { wcam.style.opacity = ''; wcam.style.pointerEvents = ''; }
    goPhase('outro');
  }
};

// ─────────────────────────────────────────────────────────────
//  ╔══════════════════════════════════════╗
//  ║  OUTRO VIZ — Text reveal only        ║
//  ╚══════════════════════════════════════╝
//  Background is bg.png via CSS — no canvas needed here.
// ─────────────────────────────────────────────────────────────
const OutroViz = {
  init() {
    this.revealText();
  },
  revealText() {
    document.querySelectorAll('.o-line').forEach((el, i) =>
      setTimeout(() => el.classList.add('show'), 400 + i * 700));
    setTimeout(() => document.querySelector('.o-sub')?.classList.add('show'),  2500);
    setTimeout(() => document.getElementById('btn-restart')?.classList.add('show'), 3400);
  }
};

// ─────────────────────────────────────────────────────────────
//  PHASE FOG — centralized opacity + detection ring for mind/body/soul
// ─────────────────────────────────────────────────────────────
const RING_CIRC = 251.3; // 2π × 40 (SVG circle r=40)

function updatePhaseFog(now) {
  const fog  = document.getElementById('phase-fog');
  const fill = document.getElementById('fr-fill');
  if (!fog) return;

  const ph = App.phase;
  // Dark fog for soul, heavier for body, default for mind
  fog.classList.toggle('soul-fog', ph === 'soul');
  fog.classList.toggle('body-fog', ph === 'body');

  if ((ph !== 'mind' && ph !== 'body' && ph !== 'soul') || !App.phaseReady) {
    fog.style.opacity = '0';
    return;
  }

  // Get the current detect state + progress for the active phase
  let detectState, phaseStart, detectProg;
  if (ph === 'mind') {
    detectState = MindBreath.state;
    phaseStart  = MindBreath.phaseStart;
    detectProg  = MindBreath.getDetectProgress(now);
  } else if (ph === 'body') {
    detectState = BodyBreath.state;
    phaseStart  = BodyBreath.phaseStart;
    detectProg  = BodyBreath.getDetectProgress(now);
  } else {
    detectState = SoulViz._detectState;
    phaseStart  = SoulViz._detectPhaseStart;
    detectProg  = SoulViz.getDetectProgress(now);
  }

  const hint = document.getElementById('fog-hint');
  const ring = document.getElementById('fog-ring');

  if (detectState === 'waiting') {
    fog.style.opacity = '1';
    if (hint) hint.style.opacity = '1';
    if (ring) ring.style.opacity = '1';
    // Ring fills as hand is held in center
    if (fill) fill.style.strokeDashoffset = String((1 - detectProg) * RING_CIRC);
  } else if (detectState === 'detected') {
    // Hide hint text and ring as soon as countdown starts
    if (hint) hint.style.opacity = '0';
    if (ring) ring.style.opacity = '0';
    if (ph === 'soul') {
      // Soul: keep fog fully up during countdown, fade only after active
      fog.style.opacity = '1';
    } else {
      // Mind / body: fade fog concurrently with countdown
      const t = clamp((now - phaseStart) / 3000, 0, 1);
      fog.style.opacity = String(1 - t);
    }
    if (fill) fill.style.strokeDashoffset = '0'; // ring complete
  } else {
    // 'active' state
    if (ph === 'soul') {
      // Fade fog out quickly after countdown ends
      const t = clamp((now - SoulViz._activeStart) / 1400, 0, 1);
      fog.style.opacity = String(1 - t);
    } else {
      fog.style.opacity = '0';
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  MAIN LOOP
// ─────────────────────────────────────────────────────────────
function mainLoop(now) {
  App.handSmooth = lerp(App.handSmooth, App.handRaw, 0.1);

  MindBreath.update(now);
  BodyBreath.update(now);
  updateCountDisplay(now);
  updateHandDisplay();
  MindInstruct.update();
  BodyInstruct.update();
  _liveUpdateProgressBar();
  updatePhaseFog(now);

  // Pause/resume MIND VO when gesture is wrong
  if (App.phase === 'mind' && App.phaseReady && AudioManager.voPlayed && AudioManager.vo) {
    const vo = AudioManager.vo;
    const ok = isGestureCorrect();
    if (!ok && !vo.paused && !vo.ended) vo.pause();
    if (ok  &&  vo.paused && !vo.ended) vo.play().catch(() => {});
  }

  // Pause/resume BODY VO + video when gesture is wrong (or 'complete' — gate lifts)
  if (App.phase === 'body' && App.phaseReady && AudioManager.voBodyPlayed) {
    const ok  = BodyBreath.isGestureCorrect();
    const vb  = AudioManager.voBody;
    const vid = BodyViz._video;
    if (vb) {
      if (!ok && !vb.paused  && !vb.ended)  vb.pause();
      if (ok  &&  vb.paused  && !vb.ended)  vb.play().catch(() => {});
    }
    if (vid) {
      if (!ok && !vid.paused && !vid.ended) vid.pause();
      if (ok  &&  vid.paused && !vid.ended) vid.play().catch(() => {});
    }
  }

  if (App.phase === 'mind') MindViz.draw(now);
  if (App.phase === 'body') BodyViz.draw(now);
  if (App.phase === 'soul') SoulViz.draw(now);
  requestAnimationFrame(mainLoop);
}

// ─────────────────────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  resize();
  document.body.classList.add('on-landing'); // landing is initial screen
  AudioManager.init();
  AudioManager.startMusic(); // start on landing; retries on first click if blocked
  HandOverlay.init();

  document.getElementById('btn-music')?.addEventListener('click', () => {
    AudioManager.togglePlay();
  });

  // Spacebar: advance phase during experience
  window.addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (!App.phaseReady || App.transitioning) return;
    e.preventDefault();
    const next = { mind: 'body', body: 'soul', soul: 'outro' };
    if (next[App.phase]) goPhase(next[App.phase]);
  });

  document.getElementById('info-btn')?.addEventListener('click', () => {
    document.getElementById('info-panel')?.classList.toggle('open');
  });
  document.getElementById('info-close')?.addEventListener('click', () => {
    document.getElementById('info-panel')?.classList.remove('open');
  });

  document.getElementById('info-btn-body')?.addEventListener('click', () => {
    document.getElementById('info-panel-body')?.classList.toggle('open');
  });
  document.getElementById('info-close-body')?.addEventListener('click', () => {
    document.getElementById('info-panel-body')?.classList.remove('open');
  });

  document.getElementById('info-btn-soul')?.addEventListener('click', () => {
    document.getElementById('info-panel-soul')?.classList.toggle('open');
  });
  document.getElementById('info-close-soul')?.addEventListener('click', () => {
    document.getElementById('info-panel-soul')?.classList.remove('open');
  });

  // Landing info button
  document.getElementById('landing-info-btn')?.addEventListener('click', () => {
    document.getElementById('landing-info-panel')?.classList.toggle('open');
  });
  document.getElementById('landing-info-close')?.addEventListener('click', () => {
    document.getElementById('landing-info-panel')?.classList.remove('open');
  });
  // Close panel when clicking outside
  document.getElementById('s-landing')?.addEventListener('click', e => {
    const panel = document.getElementById('landing-info-panel');
    const btn   = document.getElementById('landing-info-btn');
    if (panel?.classList.contains('open') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open');
    }
  });

  document.getElementById('btn-start').addEventListener('click', async () => {
    HandTracker.start();

    // Set up mind phase silently behind the typing overlay
    App.phase         = 'mind';
    App.phaseReady    = false;
    App.transitioning = true;
    MindViz.init();
    MindBreath.init();
    showScreen('s-exp');
    ['mind', 'body', 'soul'].forEach(p => {
      document.getElementById('ui-' + p)?.classList.add('hidden');
      document.getElementById('nav-' + p)?.classList.toggle('active', p === 'mind');
    });

    await showTypingIntro();
    await showHandTutorial();

    updatePhaseProgress('mind');
    showPhaseReveal('MIND', () => {
      document.getElementById('ui-mind')?.classList.remove('hidden');
      document.getElementById('webcam-wrap')?.classList.add('visible');
      App.phaseReady    = true;
      App.transitioning = false;
      MindInstruct.init();
    });
  });

  document.getElementById('btn-soul-outro')?.addEventListener('click', () => {
    SoulViz._triggerOutro();
  });

  document.getElementById('btn-restart').addEventListener('click', () => {
    // ── Reset App state ──────────────────────────────────────
    App.phase         = 'landing';
    App.transitioning = false;
    App.phaseReady    = false;
    App.handSmooth    = 0.5;
    App.handRaw       = 0.5;

    // ── Reset audio (stop VOs, restore music volume) ─────────
    if (AudioManager.vo)     { AudioManager.vo.pause();     AudioManager.vo.currentTime     = 0; }
    if (AudioManager.voBody) { AudioManager.voBody.pause(); AudioManager.voBody.currentTime = 0; }
    if (AudioManager.voSoul) { AudioManager.voSoul.pause(); AudioManager.voSoul.currentTime = 0; }
    AudioManager.voPlayed     = false;
    AudioManager.voBodyPlayed = false;
    AudioManager.voSoulPlayed = false;
    AudioManager.ducked       = false;
    AudioManager._fadeVol(AudioManager.music, 0.42, 600);

    // ── Reset all phase modules ───────────────────────────────
    MindViz.init();
    MindBreath.init();
    MindBreath.detectStart = 0;
    BodyBreath.init();
    BodyViz.init();     // resets video to frame 0
    SoulViz.init();     // clears particles, resets detection + interaction state

    // ── Hide all instructions / UI leftovers ─────────────────
    MindInstruct.hide();
    BodyInstruct.hide();
    document.querySelectorAll('.o-line, .o-sub').forEach(el => el.classList.remove('show'));
    document.getElementById('btn-restart')?.classList.remove('show');
    document.getElementById('webcam-wrap')?.classList.remove('visible');
    document.getElementById('phase-reveal')?.style.setProperty('opacity', '0');
    document.getElementById('soul-msg')?.classList.remove('show');
    document.getElementById('soul-final')?.classList.remove('show');
    document.getElementById('phase-fog')?.style.setProperty('opacity', '0');

    // ── Clear canvas ─────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);

    showScreen('s-landing');
    setTimeout(() => { App.transitioning = false; }, 1600);
  });

  requestAnimationFrame(mainLoop);

  // ── DEV SHORTCUT ─────────────────────────────────────────────
  // Add ?dev=body to URL → skip straight to BODY phase on reload
  // Remove the param → back to normal landing flow
  const _devPhase = new URLSearchParams(location.search).get('dev');
  if (_devPhase === 'body' || _devPhase === 'mind' || _devPhase === 'soul') {
    HandTracker.start();
    document.body.classList.remove('on-landing');
    if (_devPhase === 'body') {
      MindViz.init();   // needed so mainLoop doesn't crash on mind refs
      MindBreath.init();
    }
    goPhase(_devPhase);
  }
});
