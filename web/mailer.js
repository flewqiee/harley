// mailer.js — Lisans anahtarını e-posta ile gönderir. SMTP env yoksa sessizce atlar.
// Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch { /* yok */ }

function configured() { return !!(nodemailer && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS); }

async function sendLicenseEmail(email, key) {
  if (!configured()) { console.log('E-posta atlandı (SMTP ayarlı değil).'); return false; }
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: parseInt(process.env.SMTP_PORT || '587', 10) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: email,
      subject: 'Harley Premium — Lisans Anahtarın',
      text: 'Harley Premium lisans anahtarın:\n\n' + key + '\n\nKullanım: Harley → Ayarlar → Premium → "Lisansı etkinleştir" → anahtarı yapıştır.\n\nTeşekkürler!',
      html: '<p>Harley Premium lisans anahtarın:</p><pre style="font-size:13px">' + key + '</pre><p>Kullanım: <b>Harley → Ayarlar → Premium → "Lisansı etkinleştir"</b> → anahtarı yapıştır.</p>',
    });
    return true;
  } catch (e) { console.log('E-posta gönderilemedi:', e.message); return false; }
}

module.exports = { configured, sendLicenseEmail };
