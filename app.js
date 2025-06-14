<!-- =================== app.js =================== -->
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));
app.use(express.json());

const USERS_FILE = './users.json';
const MESSAGES_FILE = './messages.json';
const AES_KEY = crypto.randomBytes(32);
const AES_IV = crypto.randomBytes(16);

function encrypt(text) {
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decrypt(encrypted) {
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, AES_IV);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function loadJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file));
  } catch {
    return [];
  }
}

function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

const users = loadJSON(USERS_FILE);
let messages = loadJSON(MESSAGES_FILE);
let onlineUsers = {};

function cleanupMessages() {
  const now = Date.now();
  messages = messages.filter(msg => now - msg.time <= 86400000);
  saveJSON(MESSAGES_FILE, messages);
}
setInterval(cleanupMessages, 60000);

io.on('connection', socket => {
  let currentUser = null;

  socket.on('signup', ({ username, password }) => {
    if (users.find(u => u.username === username)) {
      socket.emit('signupResult', { success: false, message: 'Username sudah dipakai' });
      return;
    }
    users.push({ username, password });
    saveJSON(USERS_FILE, users);
    socket.emit('signupResult', { success: true });
  });

  socket.on('login', ({ username, password }) => {
    const valid = users.find(u => u.username === username && u.password === password);
    if (!valid) {
      socket.emit('loginResult', { success: false, message: 'Login gagal' });
      return;
    }
    currentUser = username;
    onlineUsers[username] = { socketId: socket.id, lastSeen: Date.now() };
    socket.emit('loginResult', {
      success: true,
      messages: messages.filter(m => [m.from, m.to].includes(username)).map(m => ({
        user: m.from,
        text: decrypt(m.text),
        time: m.time
      }))
    });
    updateOnlineStatus();
  });

  socket.on('message', ({ text }) => {
    if (!currentUser) return;
    const targetUser = Object.keys(onlineUsers).find(u => u !== currentUser);
    if (!targetUser) return;
    const encText = encrypt(text);
    const message = {
      from: currentUser,
      to: targetUser,
      text: encText,
      time: Date.now()
    };
    messages.push(message);
    saveJSON(MESSAGES_FILE, messages);

    [currentUser, targetUser].forEach(u => {
      const socketId = onlineUsers[u]?.socketId;
      if (socketId) {
        io.to(socketId).emit('message', {
          user: message.from,
          text,
          time: message.time
        });
      }
    });
  });

  socket.on('logout', () => {
    if (currentUser) {
      onlineUsers[currentUser].lastSeen = Date.now();
      delete onlineUsers[currentUser];
      updateOnlineStatus();
    }
  });

  socket.on('deleteAll', () => {
    messages = messages.filter(m => m.from !== currentUser && m.to !== currentUser);
    saveJSON(MESSAGES_FILE, messages);
    socket.emit('loginResult', {
      success: true,
      messages: []
    });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      onlineUsers[currentUser].lastSeen = Date.now();
      delete onlineUsers[currentUser];
      updateOnlineStatus();
    }
  });

  function updateOnlineStatus() {
    if (!currentUser) return;
    const otherUser = Object.keys(onlineUsers).find(u => u !== currentUser);
    const status = otherUser ? `🔵 ${otherUser} (Online)` : `⚫ ${Object.keys(users).find(u => u !== currentUser)} (Offline)`;
    const lastSeen = otherUser ? null : new Date(onlineUsers[Object.keys(users).find(u => u !== currentUser)]?.lastSeen || Date.now()).toLocaleTimeString();
    socket.emit('userList', { name: status, lastSeen });
  }
});

server.listen(3000, () => console.log('Server aktif di http://localhost:3000'));

