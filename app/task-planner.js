// task-planner.js — Görev planlayıcı: karmaşık görevleri adımlara böler, ilerlemeyi takip eder.
const fs = require('fs');
const path = require('path');
const https = require('https');

const TASKS_FILE = path.join(process.env.USERPROFILE || '', 'HarleyDosyalar', 'tasks.json');

function readTasks() {
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return { active: null, history: [] }; }
}
function writeTasks(t) {
  try {
    fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(t, null, 2), 'utf8');
  } catch { /* sessiz */ }
}

// DeepSeek bulut ile plan oluşturma
async function generatePlan(taskDescription, model) {
  const prompt = `Sen bir görev planlayıcısın. Aşağıdaki görevi adım adım plana dönüştür.

Her adım tek satır olsun, "ADIM: " ile başlasın. 3-8 arası adım olsun.
Adımlar sıralı ve uygulanabilir olsun. Kısa ve net yaz.

GÖREV: ${taskDescription}

PLAN:`;

  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || '', 'HarleyDosyalar', 'deepseek-config.json'), 'utf8')); } catch { /* yok */ }
  const apiKey = cfg.apiKey || '';
  const body = JSON.stringify({
    model: cfg.model || model || 'deepseek-flash',
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    max_tokens: 500,
  });

  return new Promise((resolve, reject) => {
    if (!apiKey) return resolve([taskDescription]);
    const r = https.request({
      hostname: 'api.deepseek.com', path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
          // ADIM: satırlarını çıkar
          const steps = text.split('\n')
            .map(l => l.replace(/^[-*\d.]*\s*ADIM[:\s]*/i, '').trim())
            .filter(l => l.length > 3 && l.length < 200);
          resolve(steps.length ? steps : [taskDescription]);
        } catch { resolve([taskDescription]); }
      });
    });
    r.setTimeout(30000, () => r.destroy(new Error('timeout')));
    r.on('error', () => resolve([taskDescription]));
    r.write(body);
    r.end();
  });
}
// Yeni görev oluştur
async function createTask(description, model) {
  const steps = await generatePlan(description, model);
  const task = {
    id: Date.now().toString(36),
    description,
    steps: steps.map((s, i) => ({ id: i, text: s, done: false, startedAt: null, completedAt: null })),
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  const t = readTasks();
  t.active = task;
  writeTasks(t);
  return task;
}

// Adımı tamamla
function completeStep(stepId) {
  const t = readTasks();
  if (!t.active) return null;
  const step = t.active.steps.find(s => s.id === stepId);
  if (!step) return null;
  step.done = true;
  step.completedAt = new Date().toISOString();
  // Tüm adımlar tamamlandı mı?
  if (t.active.steps.every(s => s.done)) {
    t.active.completedAt = new Date().toISOString();
    t.history.push(t.active);
    if (t.history.length > 30) t.history = t.history.slice(-30);
    t.active = null;
  }
  writeTasks(t);
  return t.active;
}

// Adımı başlat
function startStep(stepId) {
  const t = readTasks();
  if (!t.active) return null;
  const step = t.active.steps.find(s => s.id === stepId);
  if (!step) return null;
  step.startedAt = new Date().toISOString();
  writeTasks(t);
  return t.active;
}

// Aktif görevi al
function getActiveTask() {
  return readTasks().active;
}

// Görevi iptal et
function cancelTask() {
  const t = readTasks();
  const cancelled = t.active;
  t.active = null;
  writeTasks(t);
  return cancelled;
}

module.exports = { createTask, completeStep, startStep, getActiveTask, cancelTask, readTasks, writeTasks };
