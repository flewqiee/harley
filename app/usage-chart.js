// usage-chart.js — DeepSeek dashboard benzeri token kullanım grafiği.
// Canvas tabanlı, area chart, gradient, grid çizgileri, yumuşak eğriler.

class UsageChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    this.mode = 'tokens'; // 'tokens' | 'requests'
    this.animProgress = 0;
    this.animFrame = null;
  }

  setData(days, mode, githubDays) {
    this.data = days || [];
    this.mode = mode || 'tokens';
    this.githubDays = githubDays || [];
    if (this.animProgress >= 1) {
      this.animProgress = 1;
      this.draw();
    } else {
      this.animate();
    }
  }

  animate() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    const start = performance.now();
    const duration = 600;
    const tick = (now) => {
      this.animProgress = Math.min(1, (now - start) / duration);
      this.draw();
      if (this.animProgress < 1) this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  draw() {
    const { canvas, ctx, data, mode, animProgress, githubDays } = this;
    if (!canvas || !ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Kart henüz yerleşmediyse (genişlik 0) bir sonraki frame'de tekrar dene — ilk açılışta grafiğin
    // boş kalmasını engeller (tab değiştirmeden görünür).
    if (rect.width === 0 || rect.height === 0) {
      requestAnimationFrame(() => this.draw());
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const padL = 45;
    const padR = 12;
    const padT = 10;
    const padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    // Değerleri topla
    let values, labelPrefix;
    if (mode === 'github') {
      values = githubDays.map((d) => d.count || 0);
      labelPrefix = 'GitHub: ';
    } else if (mode === 'requests') {
      values = data.map((d) => d.msgs || 0);
      labelPrefix = '';
    } else {
      values = data.map((d) => (d.input || 0) + (d.output || 0));
      labelPrefix = '';
    }
    if (!values.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.font = '12px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Veri yok', W / 2, H / 2);
      return;
    }
    const maxVal = Math.max(1, ...values);
    const step = chartW / Math.max(1, values.length - 1);

    // Grid çizgileri
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (chartH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    // Y-ekseni etiketleri
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (chartH / gridLines) * i;
      const val = maxVal - (maxVal / gridLines) * i;
      ctx.fillText(this.fmtShort(val), padL - 6, y + 3);
    }

    // X-ekseni etiketleri (tarihler)
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    const labelStep = Math.max(1, Math.floor(values.length / 6));
    for (let i = 0; i < values.length; i += labelStep) {
      const x = padL + i * step;
      const label = data[i].day || '';
      ctx.fillText(label, x, H - 6);
    }

    // Eğri noktaları hesapla (animasyonlu)
    const pts = values.map((v, i) => ({
      x: padL + i * step,
      y: padT + chartH - (v / maxVal) * chartH * Math.min(1, animProgress * 1.2),
    }));

    // Area gradient
    const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    grad.addColorStop(0, 'rgba(59, 130, 246, 0.35)');
    grad.addColorStop(0.6, 'rgba(59, 130, 246, 0.08)');
    grad.addColorStop(1, 'rgba(59, 130, 246, 0)');

    // Area doldurma
    ctx.beginPath();
    ctx.moveTo(pts[0].x, padT + chartH);
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        ctx.lineTo(pts[i].x, pts[i].y);
      } else {
        const cpx1 = pts[i - 1].x + step * 0.4;
        const cpy1 = pts[i - 1].y;
        const cpx2 = pts[i].x - step * 0.4;
        const cpy2 = pts[i].y;
        ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, pts[i].x, pts[i].y);
      }
    }
    ctx.lineTo(pts[pts.length - 1].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Çizgi
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) {
        ctx.moveTo(pts[i].x, pts[i].y);
      } else {
        const cpx1 = pts[i - 1].x + step * 0.4;
        const cpy1 = pts[i - 1].y;
        const cpx2 = pts[i].x - step * 0.4;
        const cpy2 = pts[i].y;
        ctx.bezierCurveTo(cpx1, cpy1, cpx2, cpy2, pts[i].x, pts[i].y);
      }
    }
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Noktalar (sonuncusu vurgulu)
    for (let i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, i === pts.length - 1 ? 4 : 2, 0, Math.PI * 2);
      ctx.fillStyle = i === pts.length - 1 ? '#3b82f6' : 'rgba(59, 130, 246, 0.6)';
      ctx.fill();
      if (i === pts.length - 1) {
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    }
  }

  fmtShort(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n));
  }
}

module.exports = { UsageChart };
