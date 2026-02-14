// Updated: set terminal fontSize = 16 (iSH-like), prevent double-tap zoom on terminal area,
// ensure hidden input font-size >=16 to avoid iOS auto-zoom, sticky modifiers, keyboard/paste.

const term = new Terminal({
  cursorBlink: true,
  convertEol: true,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 16, // iSH-like sizing and avoids iOS auto-zoom on inputs
});
term.open(document.getElementById('term'));

// WebSocket (same backend)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
ws.onopen = () => console.log('ws open');
ws.onmessage = ev => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'output') term.write(msg.data);
  } catch (e) {}
};

// modifiers
const modifiers = { ctrl: { active:false, locked:false }, alt: { active:false, locked:false } };
function updateModButton(mod) {
  const btn = document.querySelector(`[data-mod="${mod}"]`);
  if (!btn) return;
  btn.classList.toggle('active', modifiers[mod].locked || modifiers[mod].active);
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

// explicit buttons
document.getElementById('btn-esc').addEventListener('click', () => { sendData('\x1b'); clearSingleUseModifiers(); });
document.getElementById('btn-tab').addEventListener('click', () => { sendData('\t'); clearSingleUseModifiers(); });

// arrows
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

// paste
document.getElementById('btn-paste').addEventListener('click', async () => {
  const txt = await navigator.clipboard.readText().catch(()=> '');
  if (txt) sendData(txt);
});

// keyboard toggle - hidden input must have font-size >=16 to avoid zoom
const hiddenInput = document.getElementById('hidden-input');
const btnKeyboard = document.getElementById('btn-keyboard');
let keyboardOpen = false;
btnKeyboard.addEventListener('click', () => {
  if (!keyboardOpen) { hiddenInput.focus(); keyboardOpen = true; btnKeyboard.textContent = 'Hide'; }
  else { hiddenInput.blur(); keyboardOpen = false; btnKeyboard.textContent = 'Keyboard'; }
});

// forward input
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

// hardware keyboard / xterm handlers
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

// ------------------ prevent double-tap zoom on terminal ------------------
// Only on the #term element: detect quick successive taps and prevent default
(function preventDoubleTapZoom() {
  const termEl = document.getElementById('term');
  let lastTouch = 0;
  termEl.addEventListener('touchend', function(e) {
    const now = Date.now();
    if (now - lastTouch <= 300) {
      // prevent double-tap zoom
      e.preventDefault();
      // also focus terminal for convenience (but don't focus hidden input)
      term.focus();
    }
    lastTouch = now;
  }, { passive: false });
})();

// ------------------ terminal fit (estimate) ------------------
function measureChar(fontSize = term.getOption('fontSize') || 16, fontFamily = term.getOption('fontFamily')) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `${fontSize}px ${fontFamily}`;
    const metrics = ctx.measureText('W');
    const charWidth = metrics.width || (fontSize * 0.6);
    const charHeight = Math.round(fontSize * 1.2);
    return { charWidth, charHeight };
  } catch (e) {
    return { charWidth: 9, charHeight: 20 };
  }
}

function fitTerminalToContainer() {
  const container = document.getElementById('term');
  const rect = container.getBoundingClientRect();
  const fontSize = term.getOption('fontSize') || 16;
  const fontFamily = term.getOption('fontFamily');
  const { charWidth, charHeight } = measureChar(fontSize, fontFamily);
  const cols = Math.max(20, Math.floor(rect.width / charWidth));
  const rows = Math.max(6, Math.floor(rect.height / charHeight));
  try {
    term.resize(cols, rows);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type:'resize', cols, rows }));
  } catch (e) {}
}
window.addEventListener('resize', () => setTimeout(fitTerminalToContainer, 120));
window.addEventListener('orientationchange', () => setTimeout(fitTerminalToContainer, 200));
setTimeout(fitTerminalToContainer, 300);

// focus terminal on tap
document.getElementById('term').addEventListener('click', () => term.focus());

// PWA install prompt handling (same as before)
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