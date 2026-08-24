import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
// 推演倍速：250ms/跳 × (倍速÷基准240×) = 每次步进的采样点数。基准 sample_interval=60s：
//   240× = 1跳/点，60s/0.25s = 240倍速；120× = 每2tick跳1点；720× = 每tick跳3点
import { PLAY_RATES } from "../constants.js";
import { fmt } from "../chartUtils.js";

// 地图下方时间轴控制条：实时/推演切换 + 时间轴滑动 + 时间戳 + 倍速 + 播放/暂停。
// 纯展示组件，状态由父级管理。
export default function TimelineBar({
  liveMode, onLiveMode,
  playing, onSetPlaying,
  idx, onIdx,
  gt, visibleHours,
  playRate, onPlayRate,
}) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, mt: 1 }}>
      {/* 控制栏：实时模式仅保留切换按钮，播放模式才显示时间轴 + 时间戳 + 播放/暂停 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap", p: 0 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={liveMode ? "live" : "play"}
          onChange={(e, v) => {
            if (!v) return;
            onLiveMode(v === "live");
            if (v === "live") onSetPlaying(false); // 切回实时时停止播放
          }}
        >
          <ToggleButton value="live">实时</ToggleButton>
          <ToggleButton value="play">推演</ToggleButton>
        </ToggleButtonGroup>
        {/* 实时模式下仅显示实时/播放切换，时间轴与操作按钮只在播放模式出现 */}
        {!liveMode && (
          <>
            {(() => {
              // 时间轴最大索引跟随"显示时长"窗口，避免滑动到过滤外的点
              const startT = gt.points.length ? new Date(gt.points[0].t).getTime() : 0;
              const cutoff = startT + visibleHours * 3600 * 1000;
              let maxIdx = 0;
              for (let i = 0; i < gt.points.length; i++) {
                if (new Date(gt.points[i].t).getTime() <= cutoff) maxIdx = i;
                else break;
              }
              const cur = Math.min(idx, maxIdx);
              return (
                <Slider
                  size="small"
                  min={0}
                  max={maxIdx}
                  value={cur}
                  onChange={(e, v) => onIdx(v)}
                  sx={{ flex: 1, minWidth: 0 }}
                />
              );
            })()}
            <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", ml: "auto" }}>
              {fmt(gt.points[idx] && gt.points[idx].t)}
            </Typography>
            <FormControl size="small" sx={{ minWidth: 88 }} title="推演播放速率：真实时间 ÷ 显示时间；基准 sample_interval=60s">
              <InputLabel>倍速</InputLabel>
              <Select
                value={playRate}
                label="倍速"
                sx={{ height: 32 }}
                onChange={(e) => onPlayRate(Number(e.target.value))}
              >
                {PLAY_RATES.map((r) => (
                  <MenuItem key={r} value={r}>{r}×</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button size="small" variant="contained" onClick={() => onSetPlaying(!playing)}>
              {playing ? "手动" : "自动"}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}
