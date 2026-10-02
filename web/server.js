// server.js — Harley Premium web mağazası (hesap + ödeme + lisans teslimi).
// DB: DATABASE_URL varsa PostgreSQL, yoksa SQLite. Çalıştır: node server.js
require('dotenv/config');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { issueLicense } = require('./license');
const payments = require('./payments');
const mailer = require('./mailer');

const PORT = process.env.PORT || 8080;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const PRICE = process.env.PRICE || '299';
const CURRENCY = process.env.CURRENCY || 'TRY';
const APP_URL = process.env.APP_URL || ('http://localhost:' + PORT);
const LICENSE_DAYS = parseInt(process.env.LICENSE_DAYS || '0', 10);

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

// basit hız sınırı (bellekte)
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
function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }
function requireAuth(req, res, next) { if (!req.session.userId) return res.status(401).json({ ok: false, message: 'Giriş gerekli.' }); next(); }

app.get('/api/public-config', (req, res) => res.json({ price: PRICE, currency: CURRENCY }));

// Uygulama sürüm/güncelleme bilgisi. min: altındaki sürümler ZORUNLU güncelleme görür.
app.get('/api/version', (req, res) => res.json({
  latest: process.env.LATEST_VERSION || '0.13.0',
  min: process.env.MIN_VERSION || '0.0.0',
  url: process.env.DOWNLOAD_URL || 'https://github.com/flewqiee/harley/releases/latest',
}));

// ---- Auth ----
app.post('/api/register', rateLimit(10, 60000), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pass = String(req.body.password || '');
    if (!validEmail(email)) return res.status(400).json({ ok: false, message: 'Geçerli e-posta gir.' });
    if (pass.length < 8) return res.status(400).json({ ok: false, message: 'Şifre en az 8 karakter olmalı.' });
    if (await db.userByEmail(email)) return res.status(409).json({ ok: false, message: 'Bu e-posta zaten kayıtlı.' });
    const hash = await bcrypt.hash(pass, 12);
    req.session.userId = await db.insUser(email, hash);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.post('/api/login', rateLimit(20, 60000), async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const pass = String(req.body.password || '');
    const u = await db.userByEmail(email);
    if (!u || !(await bcrypt.compare(pass, u.pass_hash))) return res.status(401).json({ ok: false, message: 'E-posta veya şifre hatalı.' });
    req.session.userId = u.id;
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const u = await db.userById(req.session.userId);
    if (!u) return res.status(401).json({ ok: false, message: 'Oturum geçersiz.' });
    const lic = await db.licByUser(u.id);
    res.json({ ok: true, email: u.email, price: PRICE, currency: CURRENCY, license: lic ? lic.key : null, licenseExp: lic ? lic.exp : null });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// ---- Satın alma ----
app.post('/api/checkout', requireAuth, rateLimit(20, 60000), async (req, res) => {
  try {
    const u = await db.userById(req.session.userId);
    const orderId = await db.insOrder(u.id, PRICE, CURRENCY);

    if (payments.configured()) {
      const b = req.body || {};
      const buyer = {
        id: u.id, email: u.email,
        name: String(b.name || '').trim() || 'Harley',
        surname: String(b.surname || '').trim() || 'Musteri',
        gsm: String(b.gsm || '').trim() || '+905000000000',
        identityNumber: String(b.identityNumber || '').trim() || '11111111111',
        city: String(b.city || '').trim() || 'Istanbul',
        address: String(b.address || '').trim() || 'Belirtilmedi',
        ip: (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim(),
      };
      const result = await payments.initCheckoutForm({
        orderId, price: PRICE, currency: CURRENCY, buyer,
        callbackUrl: APP_URL + '/api/iyzico/callback',
      });
      if (result && result.status === 'success') {
        await db.setOrderRef(orderId, result.token);
        return res.json({ ok: true, orderId, provider: 'iyzico', token: result.token, checkoutFormContent: result.checkoutFormContent || null, paymentPageUrl: result.paymentPageUrl || null });
      }
      return res.status(502).json({ ok: false, message: 'Ödeme başlatılamadı: ' + ((result && result.errorMessage) || 'bilinmeyen') });
    }

    // Manuel (iyzico yapılandırılmadıysa)
    const payUrl = APP_URL + '/dashboard?order=' + orderId;
    res.json({ ok: true, orderId, payUrl, provider: 'manual' });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// iyzico ödeme dönüşü (callback): imzalı olarak bize token gönderir; sonucu API'den çekeriz.
app.post('/api/iyzico/callback', async (req, res) => {
  try {
    const token = req.body && req.body.token;
    if (!token) return res.status(400).send('token yok');
    const result = await payments.retrieve(token);
    if (result && result.paymentStatus === 'SUCCESS') {
      const order = await db.orderByRef(token);
      if (order && order.status !== 'paid') {
        await db.markPaid(order.id);
        await grantLicense(order.user_id);
      }
      return res.redirect(302, '/dashboard?paid=1');
    }
    return res.redirect(302, '/dashboard?paid=0');
  } catch (e) { return res.status(500).send('hata: ' + e.message); }
});

async function grantLicense(userId) {
  const u = await db.userById(userId);
  if (!u) return null;
  let lic = await db.licByUser(userId);
  if (lic) return lic;
  let key;
  try { key = issueLicense(u.email, LICENSE_DAYS); }
  catch (e) { console.error('Lisans üretilemedi:', e.message); return null; }
  const exp = LICENSE_DAYS > 0 ? Date.now() + LICENSE_DAYS * 86400000 : null;
  await db.insLic(userId, key, u.email, exp);
  mailer.sendLicenseEmail(u.email, key).catch(() => {});
  return db.licByUser(userId);
}

app.post('/api/admin/mark-paid', rateLimit(30, 60000), async (req, res) => {
  try {
    if (!ADMIN_TOKEN || req.body.token !== ADMIN_TOKEN) return res.status(403).json({ ok: false, message: 'Yetkisiz.' });
    const order = await db.orderById(Number(req.body.orderId));
    if (!order) return res.status(404).json({ ok: false, message: 'Sipariş yok.' });
    await db.markPaid(order.id);
    const lic = await grantLicense(order.user_id);
    res.json({ ok: true, license: lic && lic.key });
  } catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

// ---- Sayfalar ----
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

db.init().then(() => {
  app.listen(PORT, () => {
    console.log('Harley web mağazası: ' + APP_URL + '  (DB: ' + (db.usingPg ? 'Postgres' : 'SQLite') + ')');
    if (!process.env.SESSION_SECRET) console.log('UYARI: SESSION_SECRET ayarlı değil (üretimde mutlaka ayarla).');
    if (!process.env.HARLEY_LICENSE_KEY_PATH && !process.env.HARLEY_LICENSE_PRIVATE_KEY) console.log('UYARI: lisans özel anahtarı ayarlı değil.');
  });
}).catch((e) => { console.error('DB init hatası:', e.message); process.exit(1); });
