// 设置页纯函数工具：格式化与样式常量（与组件解耦，便于独立测试与复用）

// 显示时长（小时）与采样间隔（秒）的下拉文案；整倍数时附带"天/分"换算
export const hourLabel = (h) => (h % 24 === 0 ? `${h} 小时（${h / 24} 天）` : `${h} 小时`);
export const sampleLabel = (s) => (s % 60 === 0 ? `${s} 秒（${s / 60} 分）` : `${s} 秒`);

// 短时间格式：MM-DD HH:mm（本地时区），用于表格紧凑展示
export const fmtDT = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

// 日期格式化：ISO → YYYY-MM-DD
export const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// 频率条目去重（AMSAT 数据库存在重复记录）
export const dedupeFreqs = (list) =>
  list.filter(
    (f, i, arr) =>
      arr.findIndex(
        (x) =>
          x.uplink === f.uplink &&
          x.downlink === f.downlink &&
          x.beacon === f.beacon &&
          x.mode === f.mode
      ) === i
  );

// 输入框通用样式：紧凑间距 + 自适应宽度（移动端两列并排）
export const inputSx = { my: 0.75, flex: "1 1 0", minWidth: 130 };
