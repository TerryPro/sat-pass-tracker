// 3D 运行态势页数据 hook：选组加载、轨道缓存预采样、播放位置插值、定期重采样体现 J2 进动。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchLibraryEntries } from "../../api/library.js";
import {
  buildSatRecords, buildOrbitCache, interpEciAtMs, interpEciInto, MAX_ALL_PINS,
} from "../../sat/satmath.mjs";

const MAX_ORBIT = 800; // 最多给前 N 颗星画轨道线（轨道缓存上限 MAX_ALL_PINS=800，二者对齐）
const RESAMPLE_STEP_MS = 3600000; // 显示时刻每推进 1 小时 → 以该时刻重采样轨道缓存
const RESAMPLE_BATCH = 40; // rAF 分片：每帧预采样多少颗，避免一次性对全组跑 SGP4 阻塞主线程

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

  // 可见卫星的可复用位置缓冲：仅在轨道缓存/隐藏集变化时重建结构（含每颗的 eci 出参对象），
  // 每帧只原地写入 eci 字段并返回同一数组引用，替代 filter+map 每帧新建数百对象（GC 压力）。
  // 消费方（MultiGlobe onTick）在同帧内同步遍历后立即写入 Cesium primitive，不跨帧持有，可安全复用。
  const posBuf = useMemo(
    () =>
      orbitCache
        .filter((c) => !hiddenSet.has(c.norad))
        .map((c) => ({ norad: c.norad, name: c.name, cache: c, eci: { x: 0, y: 0, z: 0 }, isValid: true })),
    [orbitCache, hiddenSet]
  );

  // 供 MultiGlobe 每帧同步卫星点位置：按「最新时钟时刻」插值全组（与轨道线同帧同时刻，
  // 避免高倍速下 React 状态滞后导致卫星脱轨），同样剔除被隐藏的卫星
  const getPositionsAt = useCallback((d) => {
    if (!d) return [];
    const ms = d.getTime();
    for (const p of posBuf) {
      interpEciInto(p.cache, ms, p.eci); // 原地写入复用对象，避免每帧新建 {x,y,z}
      p.isValid = true;
    }
    return posBuf;
  }, [posBuf]);

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

  // rAF 分片预采样轨道缓存：每帧 RESAMPLE_BATCH 颗，避免一次性对全组跑 SGP4 阻塞主线程。
  // 完成后回调 onDone(caches)；aliveRef 守卫确保卸载后不再继续/提交。初始加载与定期重采样共用。
  const buildCacheBatched = useCallback((list, t, onDone) => {
    if (!aliveRef.current) return;
    const all = [];
    let i = 0;
    const step = () => {
      if (!aliveRef.current) return;
      const end = Math.min(i + RESAMPLE_BATCH, list.length);
      for (; i < end; i++) {
        const c = buildOrbitCache([list[i]], t, 60, 1)[0];
        if (c) all.push(c);
      }
      if (i < list.length) {
        requestAnimationFrame(step);
      } else {
        onDone(all);
      }
    };
    step();
  }, []);

  const startResample = useCallback((t) => {
    if (resampleBusyRef.current || !aliveRef.current) return;
    resampleBusyRef.current = true;
    const list = records.filter((r) => !hiddenSet.has(r.norad)).slice(0, MAX_ALL_PINS);
    buildCacheBatched(list, t, (all) => {
      resampleBusyRef.current = false;
      if (all.length) {
        setOrbitCache((prev) => {
          const m = new Map(prev.map((x) => [x.norad, x]));
          all.forEach((c) => m.set(c.norad, c));
          return [...m.values()];
        });
      }
    });
  }, [records, hiddenSet, buildCacheBatched]);

  // 载入选中的组：分片预采样全组轨道缓存，并重置隐藏/搜索状态
  const handleGroup = useCallback(async (key) => {
    const g = downloadedGroups.find((x) => x.key === key);
    setGroup(key);
    setError("");
    setLoading(true);
    let r;
    try {
      const res = await fetchLibraryEntries({ source: key });
      r = buildSatRecords(res.entries || []);
    } catch (e) {
      setError(e.message || "加载组数据失败");
      setLoading(false);
      return;
    }
    if (!r.length) {
      setError("该组没有可解析的卫星 TLE");
      setLoading(false);
      return;
    }
    setRecords(r);
    setGroupName(g ? g.label : key);
    const now = new Date();
    lastResampleMsRef.current = now.getTime(); // 重置重采样基准（选组已按当前时刻采样）
    // 分片预采样全组轨道（含周期）：播放/拖动时用插值取位；分片避免大组一次性 SGP4 卡死主线程。
    // loading 遮罩持续到分片完成（onDone）再撤下，期间界面可响应。
    resampleBusyRef.current = true;
    buildCacheBatched(r.slice(0, MAX_ALL_PINS), now, (all) => {
      resampleBusyRef.current = false;
      setOrbitCache(all);
      setLoading(false);
    });
  }, [downloadedGroups, buildCacheBatched]);

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
