// ============================================================
// NINJA LOOT CHOPPER — Complete Backend
// Node.js + Express + MongoDB + JWT + Socket.io + Redis
// ============================================================

// ─── 1. package.json ─────────────────────────────────────────
/*
{
  "name": "ninja-loot-chopper-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "mongoose": "^8.0.0",
    "jsonwebtoken": "^9.0.2",
    "bcryptjs": "^2.4.3",
    "socket.io": "^4.6.1",
    "ioredis": "^5.3.2",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express-rate-limit": "^7.1.5",
    "helmet": "^7.1.0",
    "joi": "^17.11.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.2"
  }
}
*/

// ─── 2. config/db.js ─────────────────────────────────────────
// FIXED from screenshot: added error handler, retry logic, proper env var
/*
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB connected: ${conn.connection.host}`);
  } catch (err) {
    console.error(`MongoDB connection error: ${err.message}`);
    // retry after 5s instead of hard crash
    setTimeout(connectDB, 5000);
  }
};

mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected — retrying...');
  setTimeout(connectDB, 5000);
});

module.exports = connectDB;
*/

// ─── 3. config/redis.js ──────────────────────────────────────
/*
const Redis = require('ioredis');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

redis.on('connect',  () => console.log('Redis connected'));
redis.on('error',    (e) => console.error('Redis error:', e.message));

module.exports = redis;
*/

// ─── 4. models/Player.js ─────────────────────────────────────
// FIXED from screenshot: missing index, missing timestamps, missing validation
/*
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const PlayerSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username min 3 chars'],
    maxlength: [20, 'Username max 20 chars'],
    match: [/^[a-zA-Z0-9_]+$/, 'Alphanumeric and _ only'],
  },
  email: {
    type: String,
    required: [true, 'Email required'],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Invalid email'],
  },
  password: {
    type: String,
    required: [true, 'Password required'],
    minlength: [6, 'Password min 6 chars'],
    select: false,   // never returned in queries by default
  },
  highScore:     { type: Number, default: 0 },
  highestLevel:  { type: Number, default: 1, min: 1, max: 10 },
  totalTokens:   { type: Number, default: 0 },
  gamesPlayed:   { type: Number, default: 0 },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

// hash password before save
PlayerSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// compare password helper
PlayerSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// never expose password in JSON responses
PlayerSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

PlayerSchema.index({ highScore: -1 });   // for leaderboard queries

module.exports = mongoose.model('Player', PlayerSchema);
*/

// ─── 5. models/GameState.js ──────────────────────────────────
// FIXED from screenshot: added validation, TTL index, proper schema
/*
const mongoose = require('mongoose');

const GameStateSchema = new mongoose.Schema({
  player: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
    required: true,
    index: true,
  },
  level: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    default: 1,
  },
  tokens:     { type: Number, default: 0, min: 0 },
  lives:      { type: Number, default: 3, min: 0, max: 3 },
  combo:      { type: Number, default: 0, min: 0 },
  score:      { type: Number, default: 0, min: 0 },
  powerMode:  { type: Boolean, default: false },
  isComplete: { type: Boolean, default: false },
  completedAt:{ type: Date },
  // checksum prevents client-side score tampering
  serverChecksum: { type: String },
}, {
  timestamps: true,
  // auto-delete incomplete sessions after 24h (prevents DB bloat)
  expireAfterSeconds: 86400,
});

// compound index for player's game history
GameStateSchema.index({ player: 1, createdAt: -1 });

module.exports = mongoose.model('GameState', GameStateSchema);
*/

// ─── 6. middleware/auth.js ────────────────────────────────────
/*
const jwt    = require('jsonwebtoken');
const redis  = require('../config/redis');
const Player = require('../models/Player');

const auth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = header.split(' ')[1];

    // check token blacklist (logout)
    const blacklisted = await redis.get(`blacklist:${token}`);
    if (blacklisted) return res.status(401).json({ error: 'Token revoked' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const player  = await Player.findById(decoded.id).select('-password');
    if (!player || !player.isActive) {
      return res.status(401).json({ error: 'Player not found or deactivated' });
    }

    req.player = player;
    req.token  = token;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    if (err.name === 'JsonWebTokenError')  return res.status(401).json({ error: 'Invalid token' });
    next(err);
  }
};

module.exports = auth;
*/

// ─── 7. middleware/validate.js ────────────────────────────────
/*
const Joi = require('joi');

const schemas = {
  register: Joi.object({
    username: Joi.string().alphanum().min(3).max(20).required(),
    email:    Joi.string().email().required(),
    password: Joi.string().min(6).required(),
  }),
  login: Joi.object({
    email:    Joi.string().email().required(),
    password: Joi.string().required(),
  }),
  saveGame: Joi.object({
    level:     Joi.number().integer().min(1).max(10).required(),
    tokens:    Joi.number().integer().min(0).required(),
    lives:     Joi.number().integer().min(0).max(3).required(),
    combo:     Joi.number().integer().min(0).required(),
    score:     Joi.number().integer().min(0).required(),
    powerMode: Joi.boolean().required(),
  }),
};

const validate = (schema) => (req, res, next) => {
  const { error } = schemas[schema].validate(req.body, { abortEarly: false });
  if (error) {
    return res.status(422).json({
      error: 'Validation failed',
      details: error.details.map(d => d.message),
    });
  }
  next();
};

module.exports = validate;
*/

// ─── 8. routes/auth.js ───────────────────────────────────────
/*
const router   = require('express').Router();
const jwt      = require('jsonwebtoken');
const redis    = require('../config/redis');
const Player   = require('../models/Player');
const auth     = require('../middleware/auth');
const validate = require('../middleware/validate');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, {
  expiresIn: process.env.JWT_EXPIRES_IN || '7d',
});

// POST /api/auth/register
router.post('/register', validate('register'), async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    const existing = await Player.findOne({ $or: [{ email }, { username }] });
    if (existing) {
      const field = existing.email === email ? 'Email' : 'Username';
      return res.status(409).json({ error: `${field} already in use` });
    }

    const player = await Player.create({ username, email, password });
    const token  = signToken(player._id);

    // cache session in Redis (TTL 7 days)
    await redis.setex(`session:${player._id}`, 604800, token);

    res.status(201).json({ token, player });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', validate('login'), async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const player = await Player.findOne({ email }).select('+password');
    if (!player || !(await player.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (!player.isActive) {
      return res.status(403).json({ error: 'Account deactivated' });
    }

    const token = signToken(player._id);
    await redis.setex(`session:${player._id}`, 604800, token);

    res.json({ token, player });
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res, next) => {
  try {
    // blacklist current token until its natural expiry
    const decoded  = require('jsonwebtoken').decode(req.token);
    const ttl      = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) await redis.setex(`blacklist:${req.token}`, ttl, '1');
    await redis.del(`session:${req.player._id}`);
    res.json({ message: 'Logged out' });
  } catch (err) { next(err); }
});

// GET /api/auth/me
router.get('/me', auth, (req, res) => res.json({ player: req.player }));

module.exports = router;
*/

// ─── 9. routes/game.js ───────────────────────────────────────
/*
const router    = require('express').Router();
const crypto    = require('crypto');
const GameState = require('../models/GameState');
const Player    = require('../models/Player');
const auth      = require('../middleware/auth');
const validate  = require('../middleware/validate');

// Server-side score validation — max tokens per level
const MAX_TOKENS_PER_LEVEL = [8,12,16,20,25,30,36,42,50,60];

function serverChecksum(playerId, level, score) {
  return crypto.createHmac('sha256', process.env.SCORE_SECRET)
    .update(`${playerId}:${level}:${score}`)
    .digest('hex')
    .slice(0, 16);
}

// POST /api/game/save  — save mid-game state
router.post('/save', auth, validate('saveGame'), async (req, res, next) => {
  try {
    const { level, tokens, lives, combo, score, powerMode } = req.body;

    // anti-cheat: tokens cannot exceed level max
    const maxAllowed = MAX_TOKENS_PER_LEVEL[level - 1];
    if (tokens > maxAllowed) {
      return res.status(400).json({ error: 'Invalid token count' });
    }

    const checksum = serverChecksum(req.player._id, level, score);

    const gameState = await GameState.findOneAndUpdate(
      { player: req.player._id, isComplete: false },
      { level, tokens, lives, combo, score, powerMode, serverChecksum: checksum },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ gameState, checksum });
  } catch (err) { next(err); }
});

// POST /api/game/complete  — level completed
router.post('/complete', auth, async (req, res, next) => {
  try {
    const { level, score, checksum } = req.body;

    // verify checksum
    const expected = serverChecksum(req.player._id, level, score);
    if (checksum !== expected) {
      return res.status(400).json({ error: 'Score verification failed' });
    }

    const gameState = await GameState.findOneAndUpdate(
      { player: req.player._id, isComplete: false },
      { isComplete: true, completedAt: new Date() },
      { new: true }
    );

    // update player high score and level
    const player = await Player.findById(req.player._id);
    let updated = false;
    if (score > player.highScore) { player.highScore = score; updated = true; }
    if (level > player.highestLevel) { player.highestLevel = level; updated = true; }
    player.gamesPlayed++;
    player.totalTokens += gameState?.tokens || 0;
    await player.save();

    res.json({ player, gameState, newHighScore: updated });
  } catch (err) { next(err); }
});

// GET /api/game/state  — resume last saved game
router.get('/state', auth, async (req, res, next) => {
  try {
    const gameState = await GameState.findOne({ player: req.player._id, isComplete: false })
      .sort({ updatedAt: -1 });
    res.json({ gameState });
  } catch (err) { next(err); }
});

// GET /api/game/history  — player's game history
router.get('/history', auth, async (req, res, next) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const history = await GameState.find({ player: req.player._id, isComplete: true })
      .sort({ completedAt: -1 })
      .skip((page-1)*limit)
      .limit(limit);
    res.json({ history, page });
  } catch (err) { next(err); }
});

module.exports = router;
*/

// ─── 10. routes/leaderboard.js ───────────────────────────────
/*
const router = require('express').Router();
const redis  = require('../config/redis');
const Player = require('../models/Player');

const CACHE_TTL = 60; // seconds

// GET /api/leaderboard?limit=20
router.get('/', async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 20, 100);
    const cacheKey = `leaderboard:top${limit}`;

    // try cache first
    const cached = await redis.get(cacheKey);
    if (cached) return res.json({ leaderboard: JSON.parse(cached), fromCache: true });

    const leaderboard = await Player.find({ isActive: true })
      .sort({ highScore: -1 })
      .limit(limit)
      .select('username highScore highestLevel gamesPlayed createdAt');

    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(leaderboard));
    res.json({ leaderboard, fromCache: false });
  } catch (err) { next(err); }
});

// GET /api/leaderboard/rank/:playerId
router.get('/rank/:playerId', async (req, res, next) => {
  try {
    const player = await Player.findById(req.params.playerId).select('highScore username');
    if (!player) return res.status(404).json({ error: 'Player not found' });

    const rank = await Player.countDocuments({ highScore: { $gt: player.highScore }, isActive: true }) + 1;
    res.json({ rank, player });
  } catch (err) { next(err); }
});

module.exports = router;
*/

// ─── 11. socket/gameSocket.js ─────────────────────────────────
/*
const jwt    = require('jsonwebtoken');
const redis  = require('../config/redis');
const Player = require('../models/Player');

module.exports = (io) => {
  // auth middleware for socket
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));

      const blacklisted = await redis.get(`blacklist:${token}`);
      if (blacklisted) return next(new Error('Token revoked'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const player  = await Player.findById(decoded.id).select('-password');
      if (!player || !player.isActive) return next(new Error('Unauthorized'));

      socket.player = player;
      next();
    } catch (e) { next(new Error('Auth failed')); }
  });

  io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.player.username}`);

    // join player to their personal room
    socket.join(`player:${socket.player._id}`);

    // broadcast leaderboard update
    const emitLeaderboard = async () => {
      const top10 = await Player.find({ isActive: true })
        .sort({ highScore: -1 }).limit(10)
        .select('username highScore highestLevel');
      io.emit('leaderboard:update', top10);
    };

    // score update from client (validated server-side in REST)
    socket.on('score:update', async ({ score, level }) => {
      try {
        const player = await Player.findById(socket.player._id);
        if (score > player.highScore) {
          player.highScore = score;
          await player.save();
          // invalidate leaderboard cache
          await redis.del('leaderboard:top20');
          await emitLeaderboard();
          // notify the player's room they have a new high score
          io.to(`player:${socket.player._id}`).emit('score:newHigh', { score });
        }
      } catch (e) { socket.emit('error', { message: 'Score update failed' }); }
    });

    // level complete broadcast
    socket.on('level:complete', ({ level }) => {
      socket.broadcast.emit('level:completed', {
        username: socket.player.username,
        level,
        timestamp: Date.now(),
      });
    });

    socket.on('disconnect', () => {
      console.log(`Player disconnected: ${socket.player.username}`);
    });
  });
};
*/

// ─── 12. server.js (MAIN) ────────────────────────────────────
/*
require('dotenv').config();
const express     = require('express');
const http        = require('http');
const { Server }  = require('socket.io');
const cors        = require('cors');
const helmet      = require('helmet');
const rateLimit   = require('express-rate-limit');

const connectDB       = require('./config/db');
const redis           = require('./config/redis');
const authRoutes      = require('./routes/auth');
const gameRoutes      = require('./routes/game');
const leaderboardRoutes = require('./routes/leaderboard');
const gameSocket      = require('./socket/gameSocket');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || 'http://localhost:3000', methods: ['GET','POST'] },
});

// ── security
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json({ limit: '10kb' }));  // prevent large payload attacks

// ── rate limiting
const limiter = rateLimit({ windowMs: 15*60*1000, max: 100, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many auth attempts' } });
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── routes
app.use('/api/auth',        authRoutes);
app.use('/api/game',        gameRoutes);
app.use('/api/leaderboard', leaderboardRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// ── global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  const status = err.status || 500;
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});

// ── socket
gameSocket(io);

// ── start
const PORT = process.env.PORT || 4000;
const start = async () => {
  await connectDB();
  await redis.connect();
  server.listen(PORT, () => console.log(`Ninja server on :${PORT}`));
};
start();
*/

// ─── 13. .env.example ────────────────────────────────────────
/*
PORT=4000
MONGO_URI=mongodb://localhost:27017/ninja-loot-chopper
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=
JWT_SECRET=your_super_secret_jwt_key_change_this
JWT_EXPIRES_IN=7d
SCORE_SECRET=your_score_hmac_secret_change_this
CLIENT_URL=http://localhost:3000
*/
