// scripts/obfuscate-premium.js — Premium modulunu build oncesi obfuscate eder.
//   node scripts/obfuscate-premium.js obfuscate   (yedekle + obfuscate)
//   node scripts/obfuscate-premium.js restore     (orijinali geri koy)
// Kaynak: premium/index.js, premium/license.js  ·  Yedek: *.src.js
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'premium');
const FILES = ['index.js', 'license.js'];
const mode = process.argv[2] || 'obfuscate';

function p(f) { return path.join(DIR, f); }

if (mode === 'restore') {
  for (const f of FILES) {
    if (fs.existsSync(p(f + '.src.js'))) {
      fs.copyFileSync(p(f + '.src.js'), p(f));
      fs.unlinkSync(p(f + '.src.js'));
      console.log('restore:', f);
    }
  }
  process.exit(0);
}

let JavaScriptObfuscator;
try { JavaScriptObfuscator = require('javascript-obfuscator'); }
catch { console.log('javascript-obfuscator yok; obfuscate atlandi.'); process.exit(0); }

for (const f of FILES) {
  if (!fs.existsSync(p(f))) continue;
  if (!fs.existsSync(p(f + '.src.js'))) fs.copyFileSync(p(f), p(f + '.src.js'));
  const src = fs.readFileSync(p(f + '.src.js'), 'utf8');
  const out = JavaScriptObfuscator.obfuscate(src, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.4,
    deadCodeInjection: false,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    identifierNamesGenerator: 'hexadecimal',
    disableConsoleOutput: false,
  }).getObfuscatedCode();
  fs.writeFileSync(p(f), out, 'utf8');
  console.log('obfuscated:', f);
}
