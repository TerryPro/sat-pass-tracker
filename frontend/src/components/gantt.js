// 时间-仰角甘特图画布绘制（纯函数：输入画布与数据，输出绘制；配色随主题）

/**
 * 在 canvas 上绘制时间-仰角甘特图。
 * @param {object} p
 * @param {HTMLCanvasElement} p.canvas 目标画布
 * @param {object} p.gt 星下点数据（含 points，用于时间轴范围与当前位置线）
 * @param {Array} p.passes 过境列表
 * @param {number} p.activeIdx 当前选中的过境索引
 * @param {number} p.idx 时间轴当前索引
 * @param {number} p.visibleHours 显示时长窗口（小时）
 */
export function drawGanttToCanvas({ canvas, gt, passes, activeIdx, idx, visibleHours }) {
  if (!canvas || !gt || !passes || passes.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  // 画布配色跟随主题（theme.js 在 <html> 上写入 data-theme）
  const dark = document.documentElement.dataset.theme !== "light";
  const cBg = dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
  const cGrid = dark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.25)";
  const cAxis = dark ? "#94a3b8" : "#6b7280";
  const cPassLabel = dark ? "rgba(255,255,255,0.92)" : "rgba(17,24,39,0.85)";

  const startT = new Date(gt.points[0].t).getTime();
  // 甘特图时间范围跟随"显示时长"下拉选择
  const endT = Math.min(
    new Date(gt.points[gt.points.length - 1].t).getTime(),
    startT + visibleHours * 3600 * 1000
  );
  const timeSpan = endT - startT || 1;
  const padL = 36, padR = 10, padT = 18, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xOf = (t) => padL + ((new Date(t).getTime() - startT) / timeSpan) * plotW;
  const yOf = (el) => padT + (1 - el / 90) * plotH;

  ctx.clearRect(0, 0, W, H);

  // 背景
  ctx.fillStyle = cBg;
  ctx.fillRect(0, 0, W, H);

  // 网格线
  ctx.strokeStyle = cGrid;
  ctx.lineWidth = 1;
  // 横向：仰角 0,30,60,90
  for (const el of [0, 30, 60, 90]) {
    const y = yOf(el);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }
  // 纵向：时间网格线，按总时长动态选步长，避免标签过密
  const hoursSpan = timeSpan / (3600 * 1000);
  const gridStepMin = hoursSpan <= 6 ? 30 : hoursSpan <= 12 ? 60 : hoursSpan <= 24 ? 120 : 240;
  const gridStepMs = gridStepMin * 60 * 1000;
  const firstGrid = Math.ceil(startT / gridStepMs) * gridStepMs;
  for (let t = firstGrid; t <= endT; t += gridStepMs) {
    const x = xOf(t);
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, H - padB);
    ctx.stroke();
  }

  // 纵轴标签（仰角）
  ctx.fillStyle = cAxis;
  ctx.font = "10px sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const el of [0, 30, 60, 90]) {
    ctx.fillText(`${el}°`, padL - 6, yOf(el));
  }

  // 横轴标签（时间），比网格线更稀疏，保证可读
  const labelStepMin = hoursSpan <= 6 ? 60 : hoursSpan <= 12 ? 120 : hoursSpan <= 24 ? 240 : 480;
  const labelStepMs = labelStepMin * 60 * 1000;
  const firstLabel = Math.ceil(startT / labelStepMs) * labelStepMs;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let t = firstLabel; t <= endT; t += labelStepMs) {
    const x = xOf(t);
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    ctx.fillText(`${hh}:${mm}`, x, H - padB + 4);
  }

  // 绘制每个过境：优先用真实采样点连成的仰角曲线（对高轨/长持续过境准确），
  // 无采样数据时回退为钟形近似（0 → max → 0）
  passes.forEach((p, i) => {
    const t0 = new Date(p.aos).getTime();
    const t1 = new Date(p.los).getTime();
    // 只绘制落在当前显示时长窗口内的过境
    if (t1 < startT || t0 > endT) return;

    const x0 = xOf(p.aos);
    const x1 = xOf(p.los);
    const yBot = yOf(0);
    const isActive = i === activeIdx;
    const baseHue = 205 + (i % 12) * 6;
    const samples = p.samples && p.samples.length > 1 ? p.samples : null;

    // 峰值（标签定位用）：真实采样点取最大值，否则取钟形顶点
    let peakT = t0;
    let peakEl = p.max_elevation_deg || 0;

    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    if (samples) {
      // 真实仰角曲线：逐点连线（el 裁剪到地平线以上）
      for (const s of samples) {
        const t = new Date(s.t).getTime();
        const el = Math.max(0, s.el);
        if (el > peakEl) {
          peakEl = el;
          peakT = t;
        }
        ctx.lineTo(xOf(t), yOf(el));
      }
    } else {
      // 兜底：钟形近似 0 → max → 0
      const duration = t1 - t0 || 1;
      for (let k = 0; k <= 30; k++) {
        const r = k / 30;
        const t = t0 + r * duration;
        const el = (p.max_elevation_deg || 0) * Math.pow(Math.sin(Math.PI * r), 2);
        ctx.lineTo(xOf(t), yOf(el));
      }
    }
    ctx.lineTo(x1, yBot);
    ctx.closePath();

    ctx.fillStyle = isActive ? `hsla(${baseHue}, 90%, 60%, 0.55)` : `hsla(${baseHue}, 70%, 55%, 0.22)`;
    ctx.fill();
    ctx.strokeStyle = isActive ? `hsla(${baseHue}, 90%, 65%, 0.9)` : `hsla(${baseHue}, 70%, 60%, 0.45)`;
    ctx.lineWidth = isActive ? 2 : 1;
    ctx.stroke();

    // 名称标签（空间够才画，放在曲线峰值附近）
    const label = p.satellite || `Pass #${i + 1}`;
    const labelW = ctx.measureText(label).width;
    if (x1 - x0 > labelW + 6 && peakEl > 8) {
      ctx.fillStyle = cPassLabel;
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(label, xOf(peakT), yOf(Math.min(peakEl, 90)) - 3);
    }
  });

  // 当前时间轴位置指示线
  const curP = gt.points[idx];
  if (curP) {
    const cx = xOf(curP.t);
    ctx.strokeStyle = "rgba(248,113,113,0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cx, padT);
    ctx.lineTo(cx, H - padB);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
