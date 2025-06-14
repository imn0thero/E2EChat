const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const USERS_FILE = path.join(__dirname, 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'messages.json');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, JSON.stringify({}));
if (!fs.existsSync(MESSAGES_FILE)) fs.writeFileSync(MESSAGES_FILE, JSON.stringify([]));

let messages = loadMessages();
let onlineUsers = {};

setInterval(() => {
  const now = Date.now();
  messages = messages.filter(m => now - m.time < 24 * 60 * 60 * 1000);
  saveMessages(messages);
}, 60 * 1000);

function loadUsers() {
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function saveMessages(msgs) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
}

io.on('connection', socket => {
  let currentUser = null;

  socket.on('signup', data => {
    const users = loadUsers();
    if (!data.username || !data.password) {
      socket.emit('signupResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    if (users[data.username]) {
      socket.emit('signupResult', { success: false, message: 'Username sudah dipakai' });
    } else {
      users[data.username] = data.password;
      saveUsers(users);
      socket.emit('signupResult', { success: true });
    }
  });

  socket.on('login', data => {
    const users = loadUsers();
    if (!data.username || !data.password) {
      socket.emit('loginResult', { success: false, message: 'Username dan password wajib diisi' });
      return;
    }
    if (users[data.username] && users[data.username] === data.password) {
      currentUser = data.username;
      onlineUsers[currentUser] = socket.id;
      socket.emit('loginResult', { success: true, user: currentUser });
      io.emit('userList', Object.keys(onlineUsers));
    } else {
      socket.emit('loginResult', { success: false, message: 'Username atau password salah' });
    }
  });

  socket.on('requestUserList', () => {
    if (currentUser) {
      socket.emit('userList', Object.keys(onlineUsers));
    }
  });

  socket.on('privateMessage', msg => {
    const { from, to, text, iv } = msg;
    if (!from || !to || !text || !iv) return;

    const messageData = {
      id: uuidv4(),
      from,
      to,
      text,
      iv,
      time: Date.now()
    };

    messages.push(messageData);
    saveMessages(messages);

    const toSocket = onlineUsers[to];
    if (toSocket) io.to(toSocket).emit('privateMessage', messageData);

    const fromSocket = onlineUsers[from];
    if (fromSocket) io.to(fromSocket).emit('privateMessage', messageData);
  });

  socket.on('ecdh:exchange', data => {
    const toSocket = onlineUsers[data.to];
    if (toSocket) io.to(toSocket).emit('ecdh:exchange', data);
  });

  socket.on('logout', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('userList', Object.keys(onlineUsers));
      currentUser = null;
    }
  });

  socket.on('disconnect', () => {
    if (currentUser) {
      delete onlineUsers[currentUser];
      io.emit('userList', Object.keys(onlineUsers));
      currentUser = null;
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
