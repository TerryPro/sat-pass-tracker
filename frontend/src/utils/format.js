// 通用格式化工具

// ISO 时间 → 本地 MM-DD HH:mm（紧凑展示）；非法/空值返回 "—"
export function fmtDT(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 显示时刻格式化：utc → UTC 时间；local → 本地时间
export function fmtHMS(date, mode = "utc") {
  const p = (n) => String(n).padStart(2, "0");
  if (mode === "local") {
    return `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())} 本地`;
  }
  return `${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())} UTC`;
}
