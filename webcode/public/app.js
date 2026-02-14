// Simplified toolbar to mimic iSH: Ctrl, Alt, Esc, Tab, Arrows, Keyboard toggle, Paste
// Sticky modifiers: single-use (click) or locked (double-click)
// Works with both xterm onKey (external keyboard) and a hidden input (on-screen keyboard on iOS)

const term = new Terminal({ cursorBlink: true, convertEol: true });
term.open(document.getElementById('term'));

// WebSocket to backend (same protocol as prototype)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
ws.onopen = () => console.log('ws open');
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'output') term.write(msg.data);
  } catch(e){}
};

// Modifier state
const modifiers = {
  ctrl: { active: false, locked: false },
  alt:  { active: false, locked: false }
};

function updateModButton(mod) {
  const btn = document.querySelector(`[data-mod="${mod}"]`);
  if (!btn) return;
  const s = modifiers[mod];
  if (s.locked || s.active) btn.classList.add('active'); else btn.classList.remove('active');
}

// Click = single-use activate, dblclick = toggle lock
document.querySelectorAll('button.modifier').forEach(btn => {
  const mod = btn.getAttribute('data-mod');
  btn.addEventListener('click', () => {
    if (!modifiers[mod].locked) modifiers[mod].active = true;
    updateModButton(mod);
  });
  btn.addEventListener('dblclick', () => {
    modifiers[mod].locked = !modifiers[mod].locked;
    if (modifiers[mod].locked) modifiers[mod].active = true;
    updateModButton(mod);
  });
});

function clearSingleUseModifiers() {
  for (const m of Object.keys(modifiers)) {
    if (!modifiers[m].locked) {
      modifiers[m].active = false;
      updateModButton(m);
    }
  }
}

// send to backend helper
function sendData(s) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'input', data: s }));
}

// Map printable char -> Ctrl code
function toCtrlChar(ch) {
  if (!ch) return '';
  const c = ch[0];
  const code = c.toUpperCase().charCodeAt(0);
  if (code >= 65 && code <= 90) return String.fromCharCode(code - 64);
  const special = {
    '@': String.fromCharCode(0),
    '[': String.fromCharCode(27),
    '\\': String.fromCharCode(28),
    ']': String.fromCharCode(29),
    '^': String.fromCharCode(30),
    '_': String.fromCharCode(31),
    '?': String.fromCharCode(127)
  };
  return special[ch] || '';
}

// Buttons: Esc, Tab
document.getElementById('btn-esc').addEventListener('click', () => { sendData('\x1b'); clearSingleUseModifiers(); });
document.getElementById('btn-tab').addEventListener('click', () => { sendData('\t'); clearSingleUseModifiers(); });

// Arrows: send ANSI CSI sequences ESC [ A/B/C/D
const arrowMap = { up: '\x1b[A', down: '\x1b[B', right: '\x1b[C', left: '\x1b[D' };
document.querySelectorAll('button[data-arrow]').forEach(b => {
  b.addEventListener('click', () => {
    const dir = b.getAttribute('data-arrow');
    const seq = arrowMap[dir] || '';
    if (seq) {
      // if alt/meta active, prefix ESC
      const altActive = modifiers.alt.active || modifiers.alt.locked;
      const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;
      let out = seq;
      if (altActive) out = '\x1b' + out;
      // ctrl+arrow combos are uncommon; if ctrl active, just send seq (editors interpret differently)
      sendData(out);
      clearSingleUseModifiers();
    }
  });
});

// Paste button
document.getElementById('btn-paste').addEventListener('click', async () => {
  const txt = await navigator.clipboard.readText().catch(()=> '');
  if (txt) sendData(txt);
});

// Keyboard toggle: focus hidden input to bring up iOS keyboard
const hiddenInput = document.getElementById('hidden-input');
const btnKeyboard = document.getElementById('btn-keyboard');
let keyboardOpen = false;
btnKeyboard.addEventListener('click', () => {
  if (!keyboardOpen) {
    hiddenInput.focus();
    keyboardOpen = true;
    btnKeyboard.textContent = 'Hide';
  } else {
    hiddenInput.blur();
    keyboardOpen = false;
    btnKeyboard.textContent = 'Keyboard';
  }
});

// When hidden input receives input (on-screen keyboard), forward characters
hiddenInput.addEventListener('input', (e) => {
  const v = hiddenInput.value;
  if (v && v.length > 0) {
    // send the entered text, then clear the field
    sendData(v);
    hiddenInput.value = '';
    clearSingleUseModifiers();
  }
});

// handle keydown on hidden input for special keys (Enter, Backspace, arrows)
hiddenInput.addEventListener('keydown', (e) => {
  // Allow composition for some languages; if key is printable, input event will handle
  let handled = true;
  const altActive = modifiers.alt.active || modifiers.alt.locked;
  const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;

  switch (e.key) {
    case 'Enter': sendData('\r'); break;
    case 'Backspace': sendData('\x7f'); break;
    case 'Tab': sendData('\t'); break;
    case 'Escape': sendData('\x1b'); break;
    case 'ArrowUp': sendData( (altActive ? '\x1b' : '') + '\x1b[A'); break;
    case 'ArrowDown': sendData( (altActive ? '\x1b' : '') + '\x1b[B'); break;
    case 'ArrowLeft': sendData( (altActive ? '\x1b' : '') + '\x1b[D'); break;
    case 'ArrowRight': sendData( (altActive ? '\x1b' : '') + '\x1b[C'); break;
    default:
      // If it's a single printable char and ctrl is active, convert to control char
      if (e.key.length === 1) {
        let out = e.key;
        if (ctrlActive) {
          const c = toCtrlChar(e.key);
          if (c) out = c;
        }
        if (altActive) out = '\x1b' + out;
        sendData(out);
      } else handled = false;
  }

  if (handled) {
    e.preventDefault();
    clearSingleUseModifiers();
  }
});

// Also handle input from xterm.onKey (external keyboard or if terminal gets focus)
term.onKey(({ key, domEvent }) => {
  // If user uses on-screen keyboard via hidden input, we won't get here for those keys.
  // For hardware keyboards, apply our sticky modifiers.
  const isPrintable = domEvent.key && domEvent.key.length === 1;
  const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;
  const altActive = modifiers.alt.active || modifiers.alt.locked;

  let out = '';
  if (isPrintable) {
    if (ctrlActive) {
      const c = toCtrlChar(domEvent.key);
      out = c ? c : domEvent.key;
    } else {
      out = domEvent.key;
    }
    if (altActive) out = '\x1b' + out;
  } else {
    // non-printable: key param often contains sequence already
    out = key;
    if (altActive) out = '\x1b' + out;
    // ctrl for non-printable not broadly mapped here
  }

  if (out) sendData(out);
  clearSingleUseModifiers();
});

// simple resize notifier
function sendResize() {
  const cols = term.cols || 80;
  const rows = term.rows || 24;
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
}
window.addEventListener('resize', () => setTimeout(sendResize, 150));
setTimeout(sendResize, 200);

// focus terminal when clicking it (so external keyboard works)
document.getElementById('term').addEventListener('click', () => term.focus());