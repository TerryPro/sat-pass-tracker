// useGroundData Hook：加载星下点轨迹数据，管理 gt / loading / error 状态。
// 从 GroundTrack 中拆出的数据获取逻辑：参数（坐标/时长/卫星）变化时重新拉取，
// 加载成功后通过 onLoaded 通知上层重置时间轴索引。
import { useEffect, useRef, useState } from "react";
import { fetchGroundTrack } from "../api";

/**
 * 加载星下点轨迹数据。
 * @param {object} params
 * @param {number} params.lat 地面站纬度
 * @param {number} params.lon 地面站经度
 * @param {number} params.alt 地面站高度（m）
 * @param {number} params.hours 计算窗口（小时）
 * @param {string} params.satellite 卫星 key
 * @param {object} [opts]
 * @param {Function} [opts.onLoaded] 数据加载成功回调（用于重置时间轴索引等）
 * @returns {{ gt: object|null, loading: boolean, error: string }}
 */
export function useGroundData({ lat, lon, alt, hours, satellite }, opts = {}) {
  const { onLoaded } = opts;
  const [gt, setGt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // onLoaded 用 ref 保存：避免每次渲染生成的新函数导致 fetch effect 重复触发
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  // 坐标/时长/卫星变化时重新加载
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetchGroundTrack({ lat, lon, alt, hours, satellite })
      .then((d) => {
        if (cancelled) return;
        setGt(d);
        onLoadedRef.current?.();
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lon, alt, hours, satellite]);

  return { gt, loading, error };
}
