// usePlayback Hook：管理时间轴推演/播放状态与逻辑。
// 从 GroundTrack 中拆出的状态：idx / playing / liveMode / playRate，
// 以及播放推进间隔（固定 250ms tick，按倍速比率含小数累计步进）与
// 回看模式下时间轴索引到选中过境的联动。
import { useEffect, useRef, useState } from "react";

// 推演基准倍速（倍速选项见 TimelineBar.jsx 的 PLAY_RATES）
const BASE_RATE = 240;

/**
 * 管理时间轴推演状态：当前索引、播放/实时模式、推演倍速与对应副作用。
 * @param {object} p
 * @param {object|null} p.gt 星下点数据（含 points，用于播放范围与时间轴联动）
 * @param {Array} p.passes 过境列表
 * @param {number} p.activeIdx 当前选中过境索引
 * @param {Function} p.onSelect 选中过境回调（回看模式联动更新选中）
 * @returns {object} 状态与 setter（idx/playing/liveMode/playRate）
 */
export function usePlayback({ gt, passes, activeIdx, onSelect }) {
  const [idx, setIdx] = useState(0); // 时间轴当前索引
  const [playing, setPlaying] = useState(false);
  const [liveMode, setLiveMode] = useState(true); // true=实时模式（Socket 推送位置）/ false=播放模式（时间轴）
  const [playRate, setPlayRate] = useState(BASE_RATE);
  const playAccumRef = useRef(0); // 小数步进累积（非整数倍速时避免不动）

  // 播放：固定每 250ms 一 tick，按 playRate/BASE_RATE 的比率（含小数累计）推进采样索引
  // step = playRate / BASE_RATE（点/tick）；<1 时靠 accum 累积到 ≥1 才真正推进，
  // 避免低于 240× 的档位（120× / 60× / 30×）仍然按 240× 全速前进
  useEffect(() => {
    if (!playing || liveMode || !gt) return;
    playAccumRef.current = 0;
    const id = setInterval(() => {
      setIdx((i) => {
        const last = gt.points.length - 1;
        if (i >= last) {
          setPlaying(false);
          return i;
        }
        const stepF = playAccumRef.current + playRate / BASE_RATE;
        if (stepF < 1) {
          // 不足 1 点：只累积，本次不动
          playAccumRef.current = stepF;
          return i;
        }
        const step = Math.floor(stepF);
        playAccumRef.current = stepF - step;
        const next = Math.min(last, i + step);
        if (next >= last) setPlaying(false);
        return next;
      });
    }, 250);
    return () => clearInterval(id);
  }, [playing, gt, liveMode, playRate]);

  // 回看（播放）模式：时间轴索引变化时，联动选中该时间点所属的过境，
  // 使甘特图上方"选中过境"信息随拖动/播放一起更新。
  useEffect(() => {
    if (liveMode || !gt || !gt.points || !gt.points[idx] || !passes || !passes.length) return;
    const t = new Date(gt.points[idx].t).getTime();
    let best = activeIdx || 0;
    let bestD = Infinity;
    passes.forEach((p, i) => {
      const mid = (new Date(p.aos).getTime() + new Date(p.los).getTime()) / 2;
      const d = Math.abs(mid - t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best !== activeIdx) onSelect(best);
  }, [idx, passes, activeIdx, onSelect, liveMode, gt]);

  return { idx, setIdx, playing, setPlaying, liveMode, setLiveMode, playRate, setPlayRate };
}
