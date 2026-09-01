// 3D 运行态势页数据 hook：选组加载、轨道缓存预采样、播放位置插值、定期重采样体现 J2 进动。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLibraryEntries } from "../../api/library.js";
import {
  buildSatRecords, buildOrbitCache, interpEciAtMs, MAX_ALL_PINS,
} from "../../sat/satmath.mjs";

const MAX_ORBIT = 800; // 最多给前 N 颗星画轨道线（轨道缓存上限 MAX_ALL_PINS=800，二者对齐）
const RESAMPLE_STEP_MS = 3600000; // 显示时刻每推进 1 小时 → 以该时刻重采样轨道缓存

export function useOrbitData({ downloadedGroups, hiddenSet, orbitHiddenSet, showOrbits, playedDate }) {
  const [group, setGroup] = useState("");
  const [records, setRecords] = useState([]);       // [{norad,name,satrec}]
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // 轨道采样缓存（选组时一次性预计算；播放/拖动时用插值取位，避免每帧全组 SGP4）
  const [orbitCache, setOrbitCache] = useState([]);

  // 播放时按「显示时刻」对缓存插值得到全组 ECI 位置（纯插值，无 SGP4 重算），剔除被隐藏的卫星
  const positions = useMemo(() => {
    if (!orbitCache.length || !playedDate) return [];
    const ms = playedDate.getTime();
    return orbitCache.filter((c) => !hiddenSet.has(c.norad)).map((c) => ({
      norad: c.norad,
      name: c.name,
      eci: interpEciAtMs(c, ms),
      isValid: true,
    }));
  }, [orbitCache, playedDate, hiddenSet]);

  // 供 MultiGlobe 每帧同步卫星点位置：按「最新时钟时刻」插值全组（与轨道线同帧同时刻，
  // 避免高倍速下 React 状态滞后导致卫星脱轨），同样剔除被隐藏的卫星
  const getPositionsAt = useCallback((d) => {
    if (!orbitCache.length || !d) return [];
    const ms = d.getTime();
    return orbitCache.filter((c) => !hiddenSet.has(c.norad)).map((c) => ({
      norad: c.norad,
      name: c.name,
      eci: interpEciAtMs(c, ms),
      isValid: true,
    }));
  }, [orbitCache, hiddenSet]);

  // 轨道线数据（从采样缓存取 ECI 序列）：卫星本身显示、且轨道线开关开启（总开关 && 未被逐颗关闭）的才画。
  // 携带轨道缓存 cache：地固系下用「当前时刻 + 采样偏移」插值取 ECI 并实时转换，
  // 轨道线始终经过卫星当前位置、随时间动态更新；GEO（同步）自然收缩为静止点
  const orbits = useMemo(
    () =>
      orbitCache
        .filter((c) => !hiddenSet.has(c.norad))
        .filter((c) => showOrbits && !orbitHiddenSet.has(c.norad))
        .slice(0, MAX_ORBIT)
        .map((c) => ({
          norad: c.norad,
          name: c.name,
          cache: c, // 整圈轨道缓存：绘制统一按「当前时刻 + 采样偏移」插值，仅坐标系决定转换时刻
        })),
    [orbitCache, hiddenSet, orbitHiddenSet, showOrbits]
  );

  // 定期（60s）用「当前时刻」重采样轨道缓存：使轨道线/卫星点体现 J2 轨道面进动，
  // 而非停留在选组时刻的瞬时轨道。分片（每帧 40 颗）避免一次性阻塞主线程。
  // 重采样只替换数据（norad 集合不变），MultiGlobe 轨道线经 ref 读取，不触发实体重建。
  // 注意：重采样基准必须是「显示时刻」（clock.currentTime）而非真实时间——
  // 播放时显示时刻快速推进，进动按显示时刻累积，用真实时间重采样轨道面几乎不动。
  const lastResampleMsRef = useRef(0);
  const resampleBusyRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  const startResample = useCallback((t) => {
    if (resampleBusyRef.current || !aliveRef.current) return;
    resampleBusyRef.current = true;
    const list = records.filter((r) => !hiddenSet.has(r.norad)).slice(0, MAX_ALL_PINS);
    const all = [];
    let i = 0;
    const step = () => {
      if (!aliveRef.current) return;
      const batch = list.slice(i, i + 40);
      i += 40;
      for (const r of batch) {
        const c = buildOrbitCache([r], t, 60, 1)[0];
        if (c) all.push(c);
      }
      if (i < list.length) {
        requestAnimationFrame(step);
      } else {
        resampleBusyRef.current = false;
        if (all.length) {
          setOrbitCache((prev) => {
            const m = new Map(prev.map((x) => [x.norad, x]));
            all.forEach((c) => m.set(c.norad, c));
            return [...m.values()];
          });
        }
      }
    };
    step();
  }, [records, hiddenSet]);

  // 载入选中的组：一次性预采样全组轨道缓存，并重置隐藏/搜索状态
  const handleGroup = useCallback(async (key) => {
    const g = downloadedGroups.find((x) => x.key === key);
    setGroup(key);
    setError("");
    setLoading(true);
    try {
      const res = await fetchLibraryEntries({ source: key });
      const r = buildSatRecords(res.entries || []);
      if (!r.length) { setError("该组没有可解析的卫星 TLE"); return; }
      setRecords(r);
      setGroupName(g ? g.label : key);
      const now = new Date();
      lastResampleMsRef.current = now.getTime(); // 重置重采样基准（选组已按当前时刻采样）
      // 一次性预采样全组轨道（含周期），播放/拖动时用插值取位，显著减少每帧 SGP4
      setOrbitCache(buildOrbitCache(r, now, 60));
    } catch (e) {
      setError(e.message || "加载组数据失败");
    } finally {
      setLoading(false);
    }
  }, [downloadedGroups]);

  // 显示时刻每推进 1 小时 → 以该时刻重采样轨道缓存（体现 J2 进动）。
  // 用显示时刻而非真实时间：播放时显示时刻快速推进，进动按显示时刻累积。
  const maybeResample = useCallback((d) => {
    if (!records.length) return;
    if (d.getTime() - lastResampleMsRef.current >= RESAMPLE_STEP_MS) {
      lastResampleMsRef.current = d.getTime();
      startResample(d);
    }
  }, [records.length, startResample]);

  return {
    group, setGroup, handleGroup,
    records, groupName, loading, error, setError,
    positions, orbits, getPositionsAt, maybeResample,
  };
}
