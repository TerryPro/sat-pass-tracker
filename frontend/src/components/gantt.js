// 时间-仰角甘特图画布绘制（纯函数：输入画布与数据，输出绘制；配色随主题）。
//
// 分两层以优化播放性能：
//   - drawGanttBase：静态层（背景/网格/坐标轴/全部过境仰角曲线），只在数据/选中/显示时长/主题/尺寸变化时重绘；
//   - drawGanttOverlay：把静态层离屏缓存贴到可见画布，仅叠加随 idx 高频变化的“当前位置指示线”。
// 播放时 idx 每 tick（约 4Hz）变化，只需 overlay（贴图 + 一条线），避免每 tick 全量重绘所有过境曲线
// 及其采样点的 Date 解析。离屏 canvas 的 getBoundingClientRect() 为 0，故宽高由调用方以 CSS 像素显式传入。

// 甘特图布局几何（起止时间 / 绘图区 / 坐标映射），base 与 overlay 共用，保证两者像素对齐。
function computeLayout(gt, visibleHours, W, H) {
  const startT = Date.parse(gt.points[0].t);
  // 甘特图时间范围跟随“显示时长”下拉选择
  const endT = Math.min(
    Date.parse(gt.points[gt.points.length - 1].t),
    startT + visibleHours * 3600 * 1000
  );
  const timeSpan = endT - startT || 1;
  const padL = 36, padR = 10, padT = 18, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const xOf = (tMs) => padL + ((tMs - startT) / timeSpan) * plotW;
  const yOf = (el) => padT + (1 - el / 90) * plotH;
  return { startT, endT, timeSpan, padL, padR, padT, padB, plotW, plotH, xOf, yOf };
}

/**
 * 绘制甘特图静态层（不含当前位置指示线）到给定 canvas（通常为离屏缓冲）。
 * @param {object} p
 * @param {HTMLCanvasElement} p.canvas 目标画布（离屏 base）
 * @param {object} p.gt 星下点数据（含 points，用于时间轴范围）
 * @param {Array} p.passes 过境列表
 * @param {number} p.activeIdx 当前选中的过境索引（高亮其曲线）
 * @param {number} p.visibleHours 显示时长窗口（小时）
 * @param {number} p.width 可见区 CSS 像素宽（离屏画布无布局尺寸，需显式传入）
 * @param {number} p.height 可见区 CSS 像素高
 */
export function drawGanttBase({ canvas, gt, passes, activeIdx, visibleHours, width, height }) {
  if (!canvas || !width || !height) return;
  if (!gt || !gt.points || !gt.points.length || !passes || passes.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = width;
  const H = height;

  // 画布配色跟随主题（theme.js 在 <html> 上写入 data-theme）
  const dark = document.documentElement.dataset.theme !== "light";
  const cBg = dark ? "rgba(15,23,42,0.85)" : "rgba(255,255,255,0.9)";
  const cGrid = dark ? "rgba(148,163,184,0.15)" : "rgba(100,116,139,0.25)";
  const cAxis = dark ? "#94a3b8" : "#6b7280";
  const cPassLabel = dark ? "rgba(255,255,255,0.92)" : "rgba(17,24,39,0.85)";

  const { startT, endT, timeSpan, padL, padR, padT, padB, plotW, xOf, yOf } =
    computeLayout(gt, visibleHours, W, H);

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
    const t0 = Date.parse(p.aos);
    const t1 = Date.parse(p.los);
    // 只绘制落在当前显示时长窗口内的过境
    if (t1 < startT || t0 > endT) return;

    const x0 = xOf(t0);
    const x1 = xOf(t1);
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
        const t = Date.parse(s.t);
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
}

/**
 * 合成一帧：把静态层 base 贴到可见 canvas，再叠加当前位置指示线（随 idx 高频变化的唯一部分）。
 * base 与可见 canvas 像素尺寸一致时 1:1 贴图；指示线用 CSS 像素坐标按 dpr 缩放绘制。
 * @param {object} p
 * @param {HTMLCanvasElement} p.canvas 可见画布
 * @param {HTMLCanvasElement|null} p.base 离屏静态层缓存
 * @param {object} p.gt 星下点数据（含 points，用于时间轴范围与当前点）
 * @param {number} p.idx 时间轴当前索引
 * @param {number} p.visibleHours 显示时长窗口（小时）
 * @param {number} p.width 可见区 CSS 像素宽
 * @param {number} p.height 可见区 CSS 像素高
 */
export function drawGanttOverlay({ canvas, base, gt, idx, visibleHours, width, height }) {
  if (!canvas || !width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.round(width * dpr);
  const ph = Math.round(height * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");

  // 1:1 像素贴图（identity 变换）：base 与可见画布同像素尺寸才贴，否则留空（由调用方保证 base 已就绪）
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  if (base && base.width === pw && base.height === ph) {
    ctx.drawImage(base, 0, 0);
  }

  // 当前时间轴位置指示线（唯一随 idx 变化的部分）
  if (!gt || !gt.points || !gt.points.length) return;
  const curP = gt.points[idx];
  if (!curP) return;
  const { padT, padB, xOf } = computeLayout(gt, visibleHours, width, height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cx = xOf(Date.parse(curP.t));
  ctx.strokeStyle = "rgba(248,113,113,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(cx, padT);
  ctx.lineTo(cx, height - padB);
  ctx.stroke();
  ctx.setLineDash([]);
}
