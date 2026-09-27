// license.js — Harley premium lisansını SUNUCUDA imzalar (Ed25519).
// Özel anahtar ASLA istemciye/ repoya girmez; sunucuda env/secret olarak durur.
//
//   HARLEY_LICENSE_KEY_PATH=./secrets/private.pem     (dosya yolu)
//   veya HARLEY_LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
const crypto = require('crypto');
const fs = require('fs');

function loadPrivateKey() {
  if (process.env.HARLEY_LICENSE_PRIVATE_KEY) return process.env.HARLEY_LICENSE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const p = process.env.HARLEY_LICENSE_KEY_PATH;
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  throw new Error('Lisans özel anahtarı bulunamadı (HARLEY_LICENSE_KEY_PATH / HARLEY_LICENSE_PRIVATE_KEY).');
}

// Harley uygulamasının beklediği biçim: "HARLEY-" + base64(payload || 64-byte Ed25519 imza)
function issueLicense(email, days) {
  const priv = loadPrivateKey();
  const data = { email: String(email || '').trim(), type: 'premium', issued: Date.now() };
  if (days && days > 0) data.exp = Date.now() + days * 86400000;
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const sig = crypto.sign(null, payload, priv);
  return 'HARLEY-' + Buffer.concat([payload, sig]).toString('base64');
}

module.exports = { issueLicense };
