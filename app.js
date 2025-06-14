const express = require('express');
const app = express();
const server = require('http').createServer(app);
const fs = require('fs');
const io = require('socket.io')(server);
const crypto = require('crypto');
const path = require('path');

const PORT = 3000;

const users = JSON.parse(fs.readFileSync('users.json', 'utf-8') || '[]');
let onlineUsers = {};
let lastSeen = {};
let messages = JSON.parse(fs.existsSync('messages.json') ? fs.readFileSync('messages.json') : '[]');

// AES Configuration
const AES_KEY = crypto.randomBytes(32); // Simpan di tempat aman untuk produksi
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

// Middleware
app.use(express.static('public'));
app.use(express.json());

// Serve HTML
app.get('/', (_, res) => res.sendFile(__dirname + '/public/login.html'));

// Socket.IO
io.on('connection', (socket) => {
  let currentUser = null;

  socket.on('login', ({ username, password }) => {
    const user = users.find(u => u.username === username && u.password === password);
    if (!user) {
      socket.emit('loginResult', { success: false, message: 'Login gagal!' });
      return;
    }

    currentUser = username;
    onlineUsers[username] = socket.id;
    lastSeen[username] = new Date();

    const filtered = messages
      .filter(m => [m.from, m.to].includes(username))
      .map(m => ({
        user: m.from,
        text: decrypt(m.text),
        time: m.time
      }));

    socket.emit('loginResult', { success: true, messages: filtered });
    io.emit('userList', getUserStatus(username));
  });

  socket.on('message', ({ text }) => {
    if (!currentUser) return;
    const target = Object.keys(onlineUsers).find(u => u !== currentUser);
    if (!target) return;

    const encryptedText = encrypt(text);
    const msg = {
      from: currentUser,
      to: target,
      text: encryptedText,
      time: Date.now()
    };
    messages.push(msg);
    fs.writeFileSync('messages.json', JSON.stringify(messages));

    const msgDecrypted = {
      user: currentUser,
      text,
      time: msg.time
    };

    socket.emit('message', msgDecrypted);
    if (onlineUsers[target]) {
      io.to(onlineUsers[target]).emit('message', msgDecrypted);
    }
  });

  socket.on('logout', () => {
    if (currentUser) {
      lastSeen[currentUser] = new Date();
      delete onlineUsers[currentUser];
      io.emit('userList', getUserStatus(currentUser));
    }
  });

  socket.on('clearMessages', () => {
    messages = messages.filter(m => ![m.from, m.to].includes(currentUser));
    fs.writeFileSync('messages.json', JSON.stringify(messages));
    socket.emit('message', { user: "System", text: "Semua pesan dihapus.", time: Date.now() });
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      lastSeen[currentUser] = new Date();
      delete onlineUsers[currentUser];
      io.emit('userList', getUserStatus(currentUser));
    }
  });
});

function getUserStatus(requestingUser) {
  const target = users.find(u => u.username !== requestingUser);
  if (!target) return [];
  const isOnline = onlineUsers[target.username] ? true : false;
  return [{
    name: target.username,
    online: isOnline,
    lastSeen: lastSeen[target.username] || null
  }];
}

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
