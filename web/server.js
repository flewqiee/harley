// server.js — Harley Premium web mağazası (hesap + ödeme + lisans teslimi).
// Node 22+ gerekir (node:sqlite). Çalıştır: node server.js
require('dotenv/config');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { issueLicense } = require('./license');
let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* eski Node */ }

const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PRICE = process.env.PRICE || '299';
const CURRENCY = process.env.CURRENCY || 'TRY';
const APP_URL = process.env.APP_URL || ('http://localhost:' + PORT);
const LICENSE_DAYS = parseInt(process.env.LICENSE_DAYS || '0', 10); // 0 = süresiz

if (!DatabaseSync) { console.error('node:sqlite yok — Node 22+ gerekir.'); process.exit(1); }
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.sqlite');
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount TEXT, currency TEXT, status TEXT NOT NULL DEFAULT 'pending', provider_ref TEXT, created_at INTEGER NOT NULL, paid_at INTEGER);
  CREATE TABLE IF NOT EXISTS licenses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, email TEXT, issued_at INTEGER NOT NULL, exp INTEGER);
`);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: 'harley.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(24).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000 },
}));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---- basit hız sınırı (bellekte) ----
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const k = (req.ip || 'x') + ':' + req.path;
    const now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(k, arr);
    if (arr.length > max) return res.status(429).json({ ok: false, message: 'Çok fazla istek — biraz sonra dene.' });
    next();
  };
}
const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),
  insUser: db.prepare('INSERT INTO users (email, pass_hash, created_at) VALUES (?, ?, ?)'),
  insOrder: db.prepare('INSERT INTO orders (user_id, amount, currency, status, created_at) VALUES (?, ?, ?, ?, ?)'),
  orderById: db.prepare('SELECT * FROM orders WHERE id = ?'),
  markPaid: db.prepare('UPDATE orders SET status = ?, paid_at = ? WHERE id = ?'),
  licByUser: db.prepare('SELECT * FROM licenses WHERE user_id = ? ORDER BY issued_at DESC LIMIT 1'),
  insLic: db.prepare('INSERT INTO licenses (user_id, key, email, issued_at, exp) VALUES (?, ?, ?, ?, ?)'),
};

app.get('/api/public-config', (req, res) => res.json({ price: PRICE, currency: CURRENCY }));

function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ ok: false, message: 'Giriş gerekli.' }); next(); }

// ---- Auth ----
app.post('/api/register', rateLimit(10, 60000), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '');
  if (!validEmail(email)) return res.status(400).json({ ok: false, message: 'Geçerli e-posta gir.' });
  if (pass.length < 8) return res.status(400).json({ ok: false, message: 'Şifre en az 8 karakter olmalı.' });
  if (q.userByEmail.get(email)) return res.status(409).json({ ok: false, message: 'Bu e-posta zaten kayıtlı.' });
  const hash = await bcrypt.hash(pass, 12);
  q.insUser.run(email, hash, Date.now());
  const u = q.userByEmail.get(email);
  req.session.userId = u.id;
  res.json({ ok: true });
});

app.post('/api/login', rateLimit(20, 60000), async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const pass = String(req.body.password || '');
  const u = q.userByEmail.get(email);
  if (!u || !(await bcrypt.compare(pass, u.pass_hash))) return res.status(401).json({ ok: false, message: 'E-posta veya şifre hatalı.' });
  req.session.userId = u.id;
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', requireAuth, (req, res) => {
  const u = q.userById.get(req.session.userId);
  const lic = q.licByUser.get(u.id);
  res.json({ ok: true, email: u.email, price: PRICE, currency: CURRENCY, license: lic ? lic.key : null, licenseExp: lic ? lic.exp : null });
});

// ---- Satın alma ----
// Ödeme sağlayıcı seçilene kadar: sipariş oluşturulur (pending). Admin onaylayınca lisans verilir.
// (iyzico/PayTR entegrasyonu için /api/payment/callback buraya bağlanır.)
app.post('/api/checkout', requireAuth, rateLimit(20, 60000), (req, res) => {
  const u = q.userById.get(req.session.userId);
  const r = q.insOrder.run(u.id, PRICE, CURRENCY, 'pending', Date.now());
  const orderId = Number(r.lastInsertRowid);
  // Sağlayıcı entegre olunca: burada ödeme sayfasına yönlendir (iyzico) ve provider_ref sakla.
  const payUrl = (process.env.PAYMENT_URL || '') ? (process.env.PAYMENT_URL + '?order=' + orderId) : APP_URL + '/dashboard?order=' + orderId;
  res.json({ ok: true, orderId, payUrl, provider: process.env.PAYMENT_PROVIDER || 'manual' });
});

function grantLicense(userId) {
  const u = q.userById.get(userId);
  if (!u) return null;
  let lic = q.licByUser.get(userId);
  if (lic) return lic;
  let key;
  try { key = issueLicense(u.email, LICENSE_DAYS); }
  catch (e) { console.error('Lisans üretilemedi:', e.message); return null; }
  const exp = LICENSE_DAYS > 0 ? Date.now() + LICENSE_DAYS * 86400000 : null;
  q.insLic.run(userId, key, u.email, Date.now(), exp);
  return q.licByUser.get(userId);
}

// Ödeme sağlayıcısının callback'i (imza doğrulaması eklenmeli!). MVP: orderId + admin token.
app.post('/api/admin/mark-paid', rateLimit(30, 60000), (req, res) => {
  if (!ADMIN_TOKEN || req.body.token !== ADMIN_TOKEN) return res.status(403).json({ ok: false, message: 'Yetkisiz.' });
  const order = q.orderById.get(Number(req.body.orderId));
  if (!order) return res.status(404).json({ ok: false, message: 'Sipariş yok.' });
  q.markPaid.run('paid', Date.now(), order.id);
  const lic = grantLicense(order.user_id);
  res.json({ ok: true, license: lic && lic.key });
});

// ---- Dashboard ----
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log('Harley web mağazası: ' + APP_URL);
  if (!process.env.SESSION_SECRET) console.log('UYARI: SESSION_SECRET ayarlı değil (üretimde mutlaka ayarla).');
  if (!process.env.HARLEY_LICENSE_KEY_PATH && !process.env.HARLEY_LICENSE_PRIVATE_KEY) console.log('UYARI: lisans özel anahtarı ayarlı değil (HARLEY_LICENSE_KEY_PATH).');
});
