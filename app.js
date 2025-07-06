const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static('public'));
app.use(express.json());

const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const KEYS_FILE = path.join(__dirname, 'keys.json');

// Setup multer untuk file terenkripsi
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'encrypted_uploads'; // Folder khusus untuk file terenkripsi
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '.enc'); // Ekstensi .enc untuk file terenkripsi
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|pdf|doc|docx|txt|mp3|wav|ogg|webm|m4a/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('File type not allowed!'));
    }
  }
});

// Fungsi enkripsi file
function encryptFile(buffer, password) {
  try {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipher(algorithm, key);
    
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    
    return {
      encrypted: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  } catch (error) {
    console.error('Error encrypting file:', error);
    return null;
  }
}

// Fungsi dekripsi file
function decryptFile(encryptedData, iv, authTag, password) {
  try {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(password, 'salt', 32);
    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    const decrypted = Buffer.concat([
      decipher.update(encryptedData), 
      decipher.final()
    ]);
    
    return decrypted;
  } catch (error) {
    console.error('Error decrypting file:', error);
    return null;
  }
}

// Variables (sama seperti sebelumnya)
let connectedUsers = {};
let messages = [];
let authorizedUsers = [];
let userPublicKeys = {};
const MAX_USERS = 2;
const MESSAGE_EXPIRY_HOURS = 24;

// Generate server keypair (sama seperti sebelumnya)
const { publicKey: serverPublicKey, privateKey: serverPrivateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

// Load functions (sama seperti sebelumnya)
function loadAuthorizedUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      authorizedUsers = JSON.parse(data);
      console.log(`💕 Loaded ${authorizedUsers.length} authorized users`);
    } else {
      authorizedUsers = [
        { username: "Azz" },
        { username: "Queen" }
      ];
      saveAuthorizedUsers();
      console.log('💕 Created default users.json file');
    }
  } catch (error) {
    console.error('Error loading authorized users:', error);
    authorizedUsers = [
      { username: "Azz" },
      { username: "Queen" }
    ];
  }
}

function saveAuthorizedUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(authorizedUsers, null, 2));
  } catch (error) {
    console.error('Error saving authorized users:', error);
  }
}

function loadPublicKeys() {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      const data = fs.readFileSync(KEYS_FILE, 'utf8');
      userPublicKeys = JSON.parse(data);
      console.log(`🔑 Loaded public keys for ${Object.keys(userPublicKeys).length} users`);
    } else {
      userPublicKeys = {};
      console.log('🔑 No existing keys file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading public keys:', error);
    userPublicKeys = {};
  }
}

function savePublicKeys() {
  try {
    fs.writeFileSync(KEYS_FILE, JSON.stringify(userPublicKeys, null, 2));
  } catch (error) {
    console.error('Error saving public keys:', error);
  }
}

function isUserAuthorized(username) {
  return authorizedUsers.some(user => user.username === username);
}

function loadMessages() {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
      messages = JSON.parse(data);
      console.log(`💕 Loaded ${messages.length} encrypted messages from file`);
      cleanExpiredMessages();
    } else {
      messages = [];
      console.log('💕 No existing messages file found, starting fresh');
    }
  } catch (error) {
    console.error('Error loading messages:', error);
    messages = [];
  }
}

function saveMessages() {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messages, null, 2));
  } catch (error) {
    console.error('Error saving messages:', error);
  }
}

// Fungsi untuk menghapus file media terenkripsi
function deleteEncryptedMediaFile(message) {
  if (message.media && message.media.encryptedPath) {
    const filePath = path.join(__dirname, message.media.encryptedPath);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, (err) => {
        if (err) {
          console.error(`Gagal menghapus file ${filePath}:`, err);
        } else {
          console.log(`💕 Encrypted media deleted: ${filePath}`);
        }
      });
    }
  }
}

function cleanExpiredMessages() {
  const now = new Date();
  const newMessages = [];

  for (const message of messages) {
    const ageInHours = (now - new Date(message.timestamp)) / (1000 * 60 * 60);
    if (ageInHours < MESSAGE_EXPIRY_HOURS) {
      newMessages.push(message);
    } else {
      deleteEncryptedMediaFile(message);
    }
  }

  const removedCount = messages.length - newMessages.length;
  messages = newMessages;

  if (removedCount > 0) {
    console.log(`💕 Removed ${removedCount} expired encrypted messages`);
    saveMessages();
    io.emit('messages_cleaned', { removedCount });
  }
}

function createServerSignature(message) {
  try {
    const sign = crypto.createSign('SHA256');
    sign.write(JSON.stringify({
      id: message.id,
      username: message.username,
      timestamp: message.timestamp
    }));
    sign.end();
    return sign.sign(serverPrivateKey, 'base64');
  } catch (error) {
    console.error('Error creating server signature:', error);
    return null;
  }
}

// Initialize
loadAuthorizedUsers();
loadMessages();
loadPublicKeys();

// Cleanup interval
setInterval(cleanExpiredMessages, 60 * 60 * 1000);

// ROUTES
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Route upload file dengan enkripsi
app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Baca file yang diupload
    const fileBuffer = fs.readFileSync(req.file.path);
    
    // Generate password unik untuk file ini
    const filePassword = crypto.randomBytes(32).toString('hex');
    
    // Enkripsi file
    const encryptedFile = encryptFile(fileBuffer, filePassword);
    if (!encryptedFile) {
      throw new Error('Failed to encrypt file');
    }
    
    // Simpan file terenkripsi
    const encryptedFilePath = req.file.path;
    const encryptedData = {
      encrypted: encryptedFile.encrypted,
      iv: encryptedFile.iv,
      authTag: encryptedFile.authTag
    };
    
    fs.writeFileSync(encryptedFilePath, JSON.stringify(encryptedData));
    
    console.log(`🔒 File encrypted and saved: ${req.file.originalname}`);
    
    res.json({
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      encryptedPath: req.file.path,
      filePassword: filePassword, // Password akan dienkripsi di client side
      mimeType: req.file.mimetype
    });
    
  } catch (error) {
    console.error('Error encrypting file:', error);
    res.status(500).json({ error: 'Failed to encrypt file' });
  }
});

// Route untuk serve file terenkripsi (perlu password)
app.get('/encrypted-file/:filename', (req, res) => {
  const filename = req.params.filename;
  const password = req.query.password;
  
  if (!password) {
    return res.status(400).json({ error: 'Password required' });
  }
  
  try {
    const filePath = path.join(__dirname, 'encrypted_uploads', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Baca file terenkripsi
    const encryptedData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // Dekripsi file
    const decryptedBuffer = decryptFile(
      Buffer.from(encryptedData.encrypted.data), 
      encryptedData.iv, 
      encryptedData.authTag, 
      password
    );
    
    if (!decryptedBuffer) {
      return res.status(400).json({ error: 'Invalid password or corrupted file' });
    }
    
    // Kirim file yang sudah didekripsi
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'inline'
    });
    
    res.send(decryptedBuffer);
    
  } catch (error) {
    console.error('Error serving encrypted file:', error);
    res.status(500).json({ error: 'Failed to decrypt file' });
  }
});

// Route untuk server public key
app.get('/server-key', (req, res) => {
  res.json({ serverPublicKey });
});

// SOCKET.IO (sama seperti sebelumnya)
io.on('connection', (socket) => {
  console.log('💕 User connected:', socket.id);

  socket.emit('server_public_key', { serverPublicKey });

  socket.on('register_public_key', (data) => {
    if (!socket.username) return;
    
    console.log(`🔑 Registering public key for ${socket.username}`);
    userPublicKeys[socket.username] = data.publicKey;
    savePublicKeys();
    
    io.emit('public_key_update', { 
      username: socket.username, 
      publicKey: data.publicKey 
    });
    
    console.log(`🔑 Public key registered for ${socket.username}`);
  });

  socket.on('join', (username) => {
    if (!isUserAuthorized(username)) {
      socket.emit('unauthorized');
      console.log(`💔 Unauthorized access attempt: ${username}`);
      return;
    }

    if (Object.keys(connectedUsers).length >= MAX_USERS) {
      socket.emit('room_full');
      console.log(`💔 Room full, rejected: ${username}`);
      return;
    }

    const isTaken = Object.values(connectedUsers).some(user => user.username === username);
    if (isTaken) {
      socket.emit('username_taken');
      console.log(`💔 Username taken: ${username}`);
      return;
    }

    connectedUsers[socket.id] = {
      username,
      status: 'online',
      joinedAt: new Date()
    };

    socket.username = username;
    
    socket.emit('load_messages', messages);
    socket.emit('all_public_keys', userPublicKeys);
    
    io.emit('user_list_update', Object.values(connectedUsers));
    socket.broadcast.emit('user_joined', username);
    
    console.log(`💕 ${username} joined the romantic chat (authorized & encrypted)`);
  });

  socket.on('new_message', (data) => {
    if (!socket.username) return;

    console.log(`💕 Encrypted message from ${socket.username}`);

    if (data.type === 'encrypted') {
      const message = {
        id: Date.now() + Math.random(),
        username: socket.username,
        encryptedContent: data.encryptedContent,
        encryptedKeys: data.encryptedKeys,
        media: data.media || null,
        timestamp: new Date(),
        type: 'encrypted'
      };

      message.serverSignature = createServerSignature(message);

      messages.push(message);
      saveMessages();
      io.emit('message_received', message);
      
      console.log(`🔒 Encrypted message saved with ${Object.keys(data.encryptedKeys || {}).length} recipient keys`);
    } 
    else {
      const message = {
        id: Date.now() + Math.random(),
        username: socket.username,
        text: data.text,
        media: data.media || null,
        timestamp: new Date(),
        type: data.type || 'text'
      };

      messages.push(message);
      saveMessages();
      io.emit('message_received', message);
      
      console.log(`💕 Regular message from ${socket.username}`);
    }
  });

  socket.on('typing', (isTyping) => {
    if (!socket.username) return;
    socket.broadcast.emit('user_typing', {
      username: socket.username,
      isTyping
    });
  });

  socket.on('clear_messages', () => {
    if (!socket.username) return;

    console.log(`💕 ${socket.username} clearing all encrypted messages`);
    
    messages.forEach(deleteEncryptedMediaFile);
    messages = [];
    saveMessages();
    io.emit('messages_cleared');
    
    console.log(`💕 All encrypted messages cleared by ${socket.username}`);
  });

  socket.on('disconnect', () => {
    if (socket.username) {
      delete connectedUsers[socket.id];
      io.emit('user_list_update', Object.values(connectedUsers));
      socket.broadcast.emit('user_left', socket.username);
      console.log(`💔 ${socket.username} left the romantic chat`);
    } else {
      console.log('💔 Anonymous user disconnected:', socket.id);
    }
  });

  socket.on('error', (error) => {
    console.error('💔 Socket error:', error);
  });
});

// Graceful shutdown (sama seperti sebelumnya)
process.on('SIGINT', () => {
  console.log('\n💕 Shutting down romantic chat server gracefully...');
  saveMessages();
  saveAuthorizedUsers();
  savePublicKeys();
  server.close(() => {
    console.log('💕 Romantic chat server closed. Goodbye lovers! 💕');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n💕 Received SIGTERM, shutting down gracefully...');
  saveMessages();
  saveAuthorizedUsers();
  savePublicKeys();
  server.close(() => {
    console.log('💕 Romantic chat server terminated. Until we meet again! 💕');
    process.exit(0);
  });
});

const PORT = process.env.PORT || 80;
server.listen(PORT, () => {
  console.log(`💕💕💕 Romantic Encrypted Chat Server running on port ${PORT} 💕💕💕`);
  console.log(`🔒 End-to-End Encryption: ENABLED`);
  console.log(`📁 File Encryption: ENABLED`);
  console.log(`👥 Max Users: ${MAX_USERS}`);
  console.log(`⏰ Message Expiry: ${MESSAGE_EXPIRY_HOURS} hours`);
  console.log(`💖 Authorized Users: ${authorizedUsers.map(u => u.username).join(', ')}`);
  console.log('💕 Server ready for romantic conversations! 💕');
});
