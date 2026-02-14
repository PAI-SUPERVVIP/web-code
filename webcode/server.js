const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

// On websocket connection, spawn a shell (prototype)
wss.on('connection', function connection(ws, req) {
  console.log('WS connected');

  // spawn shell (on linux server; for mac use /bin/bash or /bin/zsh)
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: process.env
  });

  // send shell output to client
  ptyProcess.on('data', function(data) {
    try { ws.send(JSON.stringify({ type: 'output', data })); } catch(e){}
  });

  // receive input from client
  ws.on('message', function incoming(msg) {
    try {
      const msgObj = JSON.parse(msg);
      if (msgObj.type === 'input') {
        ptyProcess.write(msgObj.data);
      } else if (msgObj.type === 'resize') {
        ptyProcess.resize(msgObj.cols, msgObj.rows);
      }
    } catch(e) {
      // ignore parse errors
    }
  });

  ws.on('close', () => {
    try { ptyProcess.kill(); } catch(e){}
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});