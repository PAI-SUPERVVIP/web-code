// app.js (updated): fit terminal to viewport (calculate cols/rows), PWA install handling,
// sticky modifiers (Ctrl/Alt), keyboard/paste, arrow keys — minimal iSH-like toolbar

const term = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: 'Menlo, Monaco, "Courier New", monospace', fontSize: 13 });
term.open(document.getElementById('term'));

// websocket to backend (same as before)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
ws.onopen = () => console.log('ws open');
ws.onmessage = ev => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'output') term.write(msg.data);
  } catch(e){}
};

// modifiers: single-use or locked
const modifiers = { ctrl: { active:false, locked:false }, alt: { active:false, locked:false } };
function updateModButton(mod) {
  const btn = document.querySelector(`[data-mod="${mod}"]`);
  if (!btn) return;
  const s = modifiers[mod];
  btn.classList.toggle('active', s.locked || s.active);
}
document.querySelectorAll('button.modifier').forEach(btn => {
  const mod = btn.getAttribute('data-mod');
  btn.addEventListener('click', () => { if(!modifiers[mod].locked) modifiers[mod].active = true; updateModButton(mod); });
  btn.addEventListener('dblclick', () => { modifiers[mod].locked = !modifiers[mod].locked; if (modifiers[mod].locked) modifiers[mod].active = true; updateModButton(mod); });
});
function clearSingleUseModifiers() {
  for (const k of Object.keys(modifiers)) {
    if (!modifiers[k].locked) { modifiers[k].active = false; updateModButton(k); }
  }
}

// send helper
function sendData(s) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'input', data: s })); }

// ctrl-char conversion
function toCtrlChar(ch) {
  if (!ch) return '';
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
  const special = { '@': String.fromCharCode(0), '[': String.fromCharCode(27), '\\': String.fromCharCode(28), ']': String.fromCharCode(29), '^': String.fromCharCode(30), '_': String.fromCharCode(31), '?': String.fromCharCode(127) };
  return special[ch] || '';
}

// explicit buttons (Esc / Tab)
document.getElementById('btn-esc').addEventListener('click', () => { sendData('\x1b'); clearSingleUseModifiers(); });
document.getElementById('btn-tab').addEventListener('click', () => { sendData('\t'); clearSingleUseModifiers(); });

// arrows mapping
const arrowMap = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' };
document.querySelectorAll('button[data-arrow]').forEach(b => {
  b.addEventListener('click', () => {
    const dir = b.getAttribute('data-arrow');
    let seq = arrowMap[dir] || '';
    const altActive = modifiers.alt.active || modifiers.alt.locked;
    if (altActive) seq = '\x1b' + seq;
    sendData(seq);
    clearSingleUseModifiers();
  });
});

// paste button
document.getElementById('btn-paste').addEventListener('click', async () => {
  const txt = await navigator.clipboard.readText().catch(()=> '');
  if (txt) sendData(txt);
});

// keyboard toggle (hidden input to reliably show iOS on-screen keyboard)
const hiddenInput = document.getElementById('hidden-input');
const btnKeyboard = document.getElementById('btn-keyboard');
let keyboardOpen = false;
btnKeyboard.addEventListener('click', () => {
  if (!keyboardOpen) { hiddenInput.focus(); keyboardOpen = true; btnKeyboard.textContent = 'Hide'; }
  else { hiddenInput.blur(); keyboardOpen = false; btnKeyboard.textContent = 'Keyboard'; }
});

// forward input from hidden input (on-screen keyboard)
hiddenInput.addEventListener('input', (e) => {
  const v = hiddenInput.value;
  if (v && v.length > 0) {
    sendData(v);
    hiddenInput.value = '';
    clearSingleUseModifiers();
  }
});
hiddenInput.addEventListener('keydown', (e) => {
  let handled = true;
  const altActive = modifiers.alt.active || modifiers.alt.locked;
  const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;
  switch (e.key) {
    case 'Enter': sendData('\r'); break;
    case 'Backspace': sendData('\x7f'); break;
    case 'Tab': sendData('\t'); break;
    case 'Escape': sendData('\x1b'); break;
    case 'ArrowUp': sendData((altActive?'\x1b':'') + '\x1b[A'); break;
    case 'ArrowDown': sendData((altActive?'\x1b':'') + '\x1b[B'); break;
    case 'ArrowLeft': sendData((altActive?'\x1b':'') + '\x1b[D'); break;
    case 'ArrowRight': sendData((altActive?'\x1b':'') + '\x1b[C'); break;
    default:
      if (e.key.length === 1) {
        let out = e.key;
        if (ctrlActive) { const c = toCtrlChar(e.key); if (c) out = c; }
        if (altActive) out = '\x1b' + out;
        sendData(out);
      } else handled = false;
  }
  if (handled) { e.preventDefault(); clearSingleUseModifiers(); }
});

// hardware keyboard / xterm key handling (apply sticky modifiers)
term.onKey(({ key, domEvent }) => {
  const isPrintable = domEvent.key && domEvent.key.length === 1;
  const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;
  const altActive  = modifiers.alt.active  || modifiers.alt.locked;
  let out = '';

  if (isPrintable) {
    if (ctrlActive) {
      const c = toCtrlChar(domEvent.key);
      out = c ? c : domEvent.key;
    } else out = domEvent.key;
    if (altActive) out = '\x1b' + out;
  } else {
    out = key;
    if (altActive) out = '\x1b' + out;
  }

  if (out) sendData(out);
  clearSingleUseModifiers();
});

// ------------------------- terminal fit logic -------------------------
// Measure approximate character size using canvas for the chosen font, then compute cols/rows.
function measureCharSize(fontSize = 13, fontFamily = 'Menlo, Monaco, "Courier New", monospace') {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText('W'); // wide char
    const charWidth = metrics.width || (fontSize * 0.6);
    const charHeight = Math.round(fontSize * 1.2);
    return { charWidth, charHeight };
  } catch (e) {
    return { charWidth: 8, charHeight: 18 };
  }
}

function fitTerminalToContainer() {
  const container = document.getElementById('term');
  const rect = container.getBoundingClientRect();
  const fontSize = term.getOption('fontSize') || 13;
  const fontFamily = term.getOption('fontFamily') || 'Menlo, Monaco, "Courier New", monospace';
  const { charWidth, charHeight } = measureCharSize(fontSize, fontFamily);

  // compute cols/rows so content wraps correctly and doesn't overflow horizontally
  const cols = Math.max(20, Math.floor(rect.width / charWidth));
  const rows = Math.max(6, Math.floor(rect.height / charHeight));
  try {
    term.resize(cols, rows);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'resize', cols, rows }));
  } catch (e) {
    // ignore if resize fails (e.g., not ready)
  }
}

// call on load and on resize/orientation change
window.addEventListener('resize', () => { setTimeout(fitTerminalToContainer, 120); });
window.addEventListener('orientationchange', () => { setTimeout(fitTerminalToContainer, 200); });
setTimeout(fitTerminalToContainer, 300);

// focus terminal on tap
document.getElementById('term').addEventListener('click', () => term.focus());

// ------------------------- PWA install prompt for Android -------------------------
let deferredPrompt = null;
const btnInstall = document.getElementById('btn-install');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.style.display = 'inline-block';
});
btnInstall.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  btnInstall.style.display = 'none';
});

// if iOS, show hint (we already have text in DOM). nothing to do programmatically.
