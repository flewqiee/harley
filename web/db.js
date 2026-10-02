// db.js — Veritabanı katmanı. DATABASE_URL varsa PostgreSQL, yoksa SQLite (node:sqlite).
// Böylece yerelde SQLite, üretimde (Render/Neon) Postgres ile çalışır.
const path = require('path');

const usePg = !!process.env.DATABASE_URL;
let pg = null;
let sqlite = null;

if (usePg) {
  const { Pool } = require('pg');
  pg = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === '0' ? false : { rejectUnauthorized: false },
  });
} else {
  const { DatabaseSync } = require('node:sqlite');
  sqlite = new DatabaseSync(process.env.DB_PATH || path.join(__dirname, 'data.sqlite'));
}

async function init() {
  if (usePg) {
    await pg.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at BIGINT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, amount TEXT, currency TEXT, status TEXT NOT NULL DEFAULT 'pending', provider_ref TEXT, created_at BIGINT NOT NULL, paid_at BIGINT);
      CREATE TABLE IF NOT EXISTS licenses (id SERIAL PRIMARY KEY, user_id INTEGER NOT NULL, key TEXT NOT NULL, email TEXT, issued_at BIGINT NOT NULL, exp BIGINT);
    `);
  } else {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, amount TEXT, currency TEXT, status TEXT NOT NULL DEFAULT 'pending', provider_ref TEXT, created_at INTEGER NOT NULL, paid_at INTEGER);
      CREATE TABLE IF NOT EXISTS licenses (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, key TEXT NOT NULL, email TEXT, issued_at INTEGER NOT NULL, exp INTEGER);
    `);
  }
}

async function userByEmail(email) {
  if (usePg) { const r = await pg.query('SELECT * FROM users WHERE email = $1', [email]); return r.rows[0]; }
  return sqlite.prepare('SELECT * FROM users WHERE email = ?').get(email);
}
async function userById(id) {
  if (usePg) { const r = await pg.query('SELECT * FROM users WHERE id = $1', [id]); return r.rows[0]; }
  return sqlite.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
async function insUser(email, hash) {
  const now = Date.now();
  if (usePg) { const r = await pg.query('INSERT INTO users (email, pass_hash, created_at) VALUES ($1,$2,$3) RETURNING id', [email, hash, now]); return r.rows[0].id; }
  const r = sqlite.prepare('INSERT INTO users (email, pass_hash, created_at) VALUES (?,?,?)').run(email, hash, now);
  return Number(r.lastInsertRowid);
}
async function insOrder(userId, amount, currency) {
  const now = Date.now();
  if (usePg) { const r = await pg.query("INSERT INTO orders (user_id, amount, currency, status, created_at) VALUES ($1,$2,$3,'pending',$4) RETURNING id", [userId, amount, currency, now]); return r.rows[0].id; }
  const r = sqlite.prepare("INSERT INTO orders (user_id, amount, currency, status, created_at) VALUES (?,?,?,'pending',?)").run(userId, amount, currency, now);
  return Number(r.lastInsertRowid);
}
async function orderById(id) {
  if (usePg) { const r = await pg.query('SELECT * FROM orders WHERE id = $1', [id]); return r.rows[0]; }
  return sqlite.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}
async function setOrderRef(id, ref) {
  if (usePg) { await pg.query('UPDATE orders SET provider_ref=$1 WHERE id=$2', [ref, id]); return; }
  sqlite.prepare('UPDATE orders SET provider_ref=? WHERE id=?').run(ref, id);
}
async function orderByRef(ref) {
  if (usePg) { const r = await pg.query('SELECT * FROM orders WHERE provider_ref=$1 ORDER BY id DESC LIMIT 1', [ref]); return r.rows[0]; }
  return sqlite.prepare('SELECT * FROM orders WHERE provider_ref = ? ORDER BY id DESC LIMIT 1').get(ref);
}
async function markPaid(id) {
  if (usePg) { await pg.query("UPDATE orders SET status='paid', paid_at=$1 WHERE id=$2", [Date.now(), id]); return; }
  sqlite.prepare("UPDATE orders SET status='paid', paid_at=? WHERE id=?").run(Date.now(), id);
}
async function licByUser(userId) {
  if (usePg) { const r = await pg.query('SELECT * FROM licenses WHERE user_id=$1 ORDER BY issued_at DESC LIMIT 1', [userId]); return r.rows[0]; }
  return sqlite.prepare('SELECT * FROM licenses WHERE user_id = ? ORDER BY issued_at DESC LIMIT 1').get(userId);
}
async function insLic(userId, key, email, exp) {
  const now = Date.now();
  if (usePg) { await pg.query('INSERT INTO licenses (user_id, key, email, issued_at, exp) VALUES ($1,$2,$3,$4,$5)', [userId, key, email, now, exp]); return; }
  sqlite.prepare('INSERT INTO licenses (user_id, key, email, issued_at, exp) VALUES (?,?,?,?,?)').run(userId, key, email, now, exp);
}

module.exports = { init, userByEmail, userById, insUser, insOrder, orderById, setOrderRef, orderByRef, markPaid, licByUser, insLic, usingPg: usePg };
