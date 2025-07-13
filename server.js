const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = 8080; // Port bebas (pastikan tidak bentrok)
const DB_PATH = path.join(__dirname, 'database.json');

// =============================================
// INITIAL SETUP
// =============================================

// Initialize database if not exists
if (!fs.existsSync(DB_PATH)) {
  const defaultData = {
    users: [
      {
        username: "admin",
        password: "admin123",
        name: "Admin",
        role: "owner",
        expiredDate: null,
        cooldown: {
          member: 60,
          reseller: 30,
          reseller_vip: 15,
          ownerlite: 0,
          owner: 0
        }
      },
      {
        username: "reseller",
        password: "reseller123",
        name: "Reseller VIP",
        role: "reseller_vip",
        expiredDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        cooldown: {
          member: 60,
          reseller: 30,
          reseller_vip: 15,
          ownerlite: 0,
          owner: 0
        }
      }
    ],
    bugs: [],
    accounts: []
  };
  fs.writeFileSync(DB_PATH, JSON.stringify(defaultData, null, 2));
}

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://ridhogas-evwh.vercel.app'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(bodyParser.json());

// =============================================
// HELPER FUNCTIONS
// =============================================

const readDB = () => {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH));
  } catch (err) {
    console.error("Database read error:", err);
    return { users: [], bugs: [], accounts: [] };
  }
};

const writeDB = (data) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Database write error:", err);
  }
};

const authenticate = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ success: false, message: 'Unauthorized' });

  const token = authHeader.split(' ')[1];
  const db = readDB();
  const user = db.users.find(u => u.token === token);

  if (!user) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }

  req.user = user;
  next();
};

// =============================================
// API ENDPOINTS
// =============================================

// 1. AUTHENTICATION ENDPOINTS
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  
  const user = db.users.find(u => u.username === username && u.password === password);
  
  if (!user) {
    return res.status(401).json({ 
      success: false, 
      message: 'Username atau password salah' 
    });
  }

  // Generate simple token (in production, use JWT)
  const token = Buffer.from(`${username}:${Date.now()}`).toString('base64');
  user.token = token;
  writeDB(db);

  const { password: _, token: t, ...userData } = user;
  
  res.json({
    success: true,
    user: userData,
    token
  });
});

app.post('/api/logout', authenticate, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.username === req.user.username);
  if (user) delete user.token;
  writeDB(db);
  
  res.json({ success: true });
});

// 2. BUG ENDPOINTS
app.post('/api/bugs', authenticate, (req, res) => {
  const { target, bugType, isPrivate } = req.body;
  
  if (!target || !bugType) {
    return res.status(400).json({
      success: false,
      message: 'Target dan jenis bug wajib diisi'
    });
  }

  const db = readDB();
  
  // Check cooldown
  const lastBug = db.bugs
    .filter(b => b.username === req.user.username)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  
  const cooldown = req.user.cooldown?.[req.user.role] || 60;
  if (lastBug && (Date.now() - new Date(lastBug.timestamp).getTime() < cooldown * 1000)) {
    return res.status(429).json({
      success: false,
      message: `Anda dalam cooldown. Tunggu ${cooldown} detik`
    });
  }

  // Save bug
  db.bugs.push({
    username: req.user.username,
    target,
    bugType,
    isPrivate: !!isPrivate,
    timestamp: new Date().toISOString()
  });
  writeDB(db);
  
  res.json({
    success: true,
    message: `Bug ${bugType} berhasil dikirim ke ${target}`,
    cooldown
  });
});

// 3. ACCOUNT MANAGEMENT ENDPOINTS
app.get('/api/accounts', authenticate, (req, res) => {
  if (!['owner', 'ownerlite', 'reseller_vip', 'reseller'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak'
    });
  }

  const db = readDB();
  const accounts = db.users
    .filter(u => u.username !== req.user.username)
    .map(({ password, token, ...user }) => user);
  
  res.json({
    success: true,
    accounts
  });
});

app.post('/api/accounts', authenticate, (req, res) => {
  if (!['owner', 'ownerlite', 'reseller_vip', 'reseller'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak'
    });
  }

  const { username, password, role, duration = 30 } = req.body;
  const db = readDB();

  if (db.users.some(u => u.username === username)) {
    return res.status(400).json({
      success: false,
      message: 'Username sudah digunakan'
    });
  }

  const newUser = {
    username,
    password,
    name: username,
    role: role || 'member',
    expiredDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString(),
    cooldown: {
      member: 60,
      reseller: 30,
      reseller_vip: 15,
      ownerlite: 0,
      owner: 0
    }
  };

  db.users.push(newUser);
  writeDB(db);

  const { password: pwd, ...userData } = newUser;
  
  res.json({
    success: true,
    account: userData
  });
});

app.delete('/api/accounts/:username', authenticate, (req, res) => {
  if (!['owner', 'ownerlite'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Akses ditolak'
    });
  }

  const db = readDB();
  const index = db.users.findIndex(u => u.username === req.params.username);
  
  if (index === -1) {
    return res.status(404).json({
      success: false,
      message: 'Akun tidak ditemukan'
    });
  }

  if (db.users[index].role === 'owner') {
    return res.status(403).json({
      success: false,
      message: 'Tidak bisa menghapus akun owner'
    });
  }

  db.users.splice(index, 1);
  writeDB(db);

  res.json({ success: true });
});

// 4. HEALTH CHECK
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    dbStatus: fs.existsSync(DB_PATH) ? 'OK' : 'MISSING'
  });
});

// 5. ERROR HANDLING
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan internal'
  });
});

// =============================================
// START SERVER
// =============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ====================================
   Apophis Backend Berjalan!
   Mode: ${process.env.NODE_ENV || 'development'}
   Port: ${PORT}
   DB Path: ${DB_PATH}
  ====================================
  `);
});
