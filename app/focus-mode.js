// focus-mode.js — Focus Mode: zamanlayıcı + aktif proje takibi + oturum özeti.
// Basit durum makinesi: idle → running → paused → done.

const fs = require('fs');
const path = require('path');

let session = { state: 'idle' }; // idle | running | paused | done

function start({ project, goal, minutes }) {
  const dur = Math.max(1, Math.min(parseInt(minutes, 10) || 25, 180));
  session = {
    state: 'running',
    project: String(project || '').trim() || 'genel',
    goal: String(goal || '').trim(),
    minutes: dur,
    startedAt: Date.now(),
    remainingMs: dur * 60000,
    lastTick: Date.now(),
  };
  return snapshot();
}

function pause() {
  if (session.state !== 'running') return snapshot();
  tick();
  session.state = 'paused';
  return snapshot();
}

function resume() {
  if (session.state !== 'paused') return snapshot();
  session.state = 'running';
  session.lastTick = Date.now();
  return snapshot();
}

function stop() {
  if (session.state !== 'idle') {
    tick();
    const s = session;
    const totalMs = s.minutes ? s.minutes * 60000 : 0;
    const elapsed = totalMs - s.remainingMs;
    const elapsedMin = Math.round(Math.max(0, elapsed) / 60000 * 10) / 10;
    const finished = s.state === 'done';
    const summary = {
      project: s.project || '',
      goal: s.goal || '',
      elapsedMin,
      plannedMin: s.minutes || 0,
      finished,
      finishedAt: Date.now(),
    };
    s.state = 'idle';
    return { ...snapshot(), summary };
  }
  return snapshot();
}

function tick() {
  if (session.state !== 'running') return;
  const now = Date.now();
  session.remainingMs -= now - session.lastTick;
  session.lastTick = now;
  if (session.remainingMs <= 0) {
    session.remainingMs = 0;
    session.state = 'done';
    session.finishedAt = Date.now();
  }
}

// Her 1 sn çağrılır (renderer interval)
function heartbeat() {
  tick();
  return snapshot();
}

function snapshot() {
  tick();
  const s = session;
  const totalMs = s.minutes ? s.minutes * 60000 : 0;
  const elapsed = totalMs - s.remainingMs;
  return {
    state: s.state,
    project: s.project || '',
    goal: s.goal || '',
    minutes: s.minutes || 0,
    remainingMs: Math.max(0, s.remainingMs || 0),
    elapsedMs: Math.max(0, elapsed),
    // oturum özeti verileri
    summary: s.state === 'done' ? {
      project: s.project,
      elapsedMin: Math.round(elapsed / 60000 * 10) / 10,
      goal: s.goal,
      finishedAt: s.finishedAt,
    } : null,
  };
}

let lastCheckInTs = 0;
// Belirli aralıklarla check-in önerisi üret (ör. her 10 dk)
function checkIn() {
  const s = snapshot();
  if (s.state !== 'running') return null;
  const now = Date.now();
  if (now - lastCheckInTs < 10 * 60000) return null;
  lastCheckInTs = now;
  return {
    text: `Odak oturumun ${s.minutes} dk üzerinden ${Math.round(s.elapsedMs / 60000)} dk oldu — projeye sadık kalıyor musun?`,
  };
}

module.exports = { start, pause, resume, stop, heartbeat, snapshot, checkIn };