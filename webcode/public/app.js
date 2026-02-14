// Minimal xterm integration with sticky modifiers (single-use or double-click lock)
// Assumes a websocket server matching previous prototype (JSON messages {type:'input'|'resize'|'output', ...})

const term = new Terminal({ cursorBlink: true, convertEol: true });
term.open(document.getElementById('term'));

// WebSocket
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
ws.onopen = () => console.log('ws open');
ws.onmessage = (ev) => {
  try {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'output') term.write(msg.data);
  } catch(e){}
};

// Modifier state: each has active (true for next use) and locked (true for persist)
const modifiers = {
  ctrl: { active: false, locked: false },
  alt:  { active: false, locked: false },
  meta: { active: false, locked: false }
};

// helper to update button UI
function updateModButton(mod) {
  const btn = document.querySelector(`[data-mod="${mod}"]`);
  if (!btn) return;
  const state = modifiers[mod];
  if (state.locked) {
    btn.classList.add('active');
    btn.style.boxShadow = "0 0 0 3px rgba(31,106,155,0.12)";
  } else if (state.active) {
    btn.classList.add('active');
    btn.style.boxShadow = "";
  } else {
    btn.classList.remove('active');
    btn.style.boxShadow = "";
  }
}

// toggle single-use active on click; double-click toggles locked state
document.querySelectorAll('button.modifier').forEach(btn => {
  const mod = btn.getAttribute('data-mod');
  btn.addEventListener('click', (e) => {
    // single click: activate for one use (unless already locked)
    if (!modifiers[mod].locked) modifiers[mod].active = true;
    updateModButton(mod);
  });
  btn.addEventListener('dblclick', (e) => {
    // double-click: toggle lock
    modifiers[mod].locked = !modifiers[mod].locked;
    // when locking, also ensure active is true
    if (modifiers[mod].locked) modifiers[mod].active = true;
    updateModButton(mod);
  });
});

// Utility: convert printable char to ctrl-code (e.g., 'x' -> \x18)
function toCtrlChar(ch) {
  if (!ch || ch.length === 0) return '';
  const c = ch[0];
  const code = c.toUpperCase().charCodeAt(0);
  // Only A-Z map to control codes (Ctrl-A .. Ctrl-Z => 0x01 .. 0x1A)
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(code - 64);
  }
  // handle some special ctrl combos
  const special = {
    '@': String.fromCharCode(0), // Ctrl+@
    '[': String.fromCharCode(27), // Ctrl+[
    '\\': String.fromCharCode(28), // Ctrl+\
    ']': String.fromCharCode(29), // Ctrl+]
    '^': String.fromCharCode(30), // Ctrl+^
    '_': String.fromCharCode(31), // Ctrl+_
    '?': String.fromCharCode(127) // DEL for Ctrl+?
  };
  if (special[ch]) return special[ch];
  return ''; // not mappable
}

// After sending a key, clear non-locked modifiers that were single-use
function clearSingleUseModifiers() {
  for (const m of Object.keys(modifiers)) {
    if (!modifiers[m].locked) modifiers[m].active = false;
    updateModButton(m);
  }
}

// send data to backend
function sendData(s) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', data: s }));
  } else {
    console.warn('ws not open');
  }
}

// Handle clicks for explicit buttons (Esc, Tab, ^C, ^X)
document.querySelectorAll('.toolbar button[data-send]').forEach(b => {
  b.addEventListener('click', () => {
    const raw = b.getAttribute('data-send');
    // the attribute contains escape sequences like \x1b or \t; evaluate them:
    const evaled = raw.replace(/\\x([0-9A-Fa-f]{2})/g, (_,h) => String.fromCharCode(parseInt(h,16)))
                      .replace(/\\t/g, '\t')
                      .replace(/\\n/g, '\n');
    sendData(evaled);
    clearSingleUseModifiers();
  });
});

// Buttons that request ctrl+<char> (e.g., ^X)
document.querySelectorAll('.toolbar button[data-send_ctrl]').forEach(b => {
  b.addEventListener('click', () => {
    const ch = b.getAttribute('data-send_ctrl');
    const ctrl = toCtrlChar(ch);
    if (ctrl) sendData(ctrl);
    else sendData(ch);
    clearSingleUseModifiers();
  });
});

// Paste button
document.getElementById('btn-paste').addEventListener('click', async () => {
  const text = await navigator.clipboard.readText().catch(()=> '');
  if (text) sendData(text);
});

// Clear button: just clear terminal viewport (not backend)
document.getElementById('btn-clear').addEventListener('click', () => term.clear());

// Quick commands
document.querySelectorAll('.cmd').forEach(b => {
  b.addEventListener('click', () => {
    const c = b.getAttribute('data-cmd') + '\n';
    sendData(c);
  });
});

// Core: intercept keys from xterm and apply modifiers
// Use onKey to get domEvent and the printable key
term.onKey(({ key, domEvent }) => {
  // If user used an external hardware keyboard with real modifiers, let xterm handle it
  // But for on-screen keyboard, we want to apply our sticky modifiers
  const isPrintable = domEvent.key && domEvent.key.length === 1;
  let out = '';

  const ctrlActive = modifiers.ctrl.active || modifiers.ctrl.locked;
  const altActive  = modifiers.alt.active  || modifiers.alt.locked;
  const metaActive = modifiers.meta.active || modifiers.meta.locked;

  // If user pressed Enter, Backspace, etc, domEvent.key holds values like "Enter", "Backspace"
  // xterm's key parameter for arrows is already escape sequences; handle printable chars specially
  if (isPrintable) {
    // If ctrl active -> convert letter to control code
    if (ctrlActive) {
      const c = toCtrlChar(domEvent.key);
      if (c) out += c;
      else {
        // fallback: send key as-is prefixed by Ctrl via lower-level heuristics
        out += domEvent.key;
      }
    } else {
      out += domEvent.key;
    }

    // If alt active -> prefix ESC (Alt as Meta)
    if (altActive) out = '\x1b' + out;

    // meta (e.g., Mac cmd) -> prefix ESC as well (common behavior)
    if (metaActive) out = '\x1b' + out;
  } else {
    // Non-printable: use some mappings
    // If the key is an Arrow, Home, End, PageUp/PageDown, Enter, Backspace etc,
    // xterm already normalizes them in `key` param. Use that but also apply Alt/Meta prefix.
    out = key;

    // If ctrl lock active for non-printable keys (like ctrl+arrow) there's no standard mapping here,
    // so we just let it pass as-is. For editor combos, provide explicit toolbar buttons (like ^X).
    if (altActive || metaActive) out = '\x1b' + out;
  }

  // Send composed sequence to backend
  if (out) sendData(out);

  // Clear single-use modifiers
  clearSingleUseModifiers();
});

// resize: simple approach, better to use xterm-addon-fit in production
function sendResize() {
  const cols = term.cols || 80;
  const rows = term.rows || 24;
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  }
}
window.addEventListener('resize', () => {
  setTimeout(sendResize, 100);
});
setTimeout(sendResize, 200);

// Focus terminal for mobile when tapping the terminal area
document.getElementById('term').addEventListener('click', () => term.focus());