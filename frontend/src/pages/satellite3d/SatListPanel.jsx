// 3D 运行态势页：右侧卫星显示列表面板（滑动开关控制每颗卫星的显示与轨道线）。
import React, { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Switch from "@mui/material/Switch";
import Slide from "@mui/material/Slide";

export default function SatListPanel({
  open,
  onClose,
  groupName = "",
  records = [],
  hiddenSet,
  orbitHiddenSet,
  selectedNorad,
  onSelect,      // (norad) => void：双击选中/跟踪
  onToggleHidden,       // (norad) => void
  onToggleOrbitHidden,  // (norad) => void
  onSetHiddenNorads,    // (norads) => void：全显/全隐
}) {
  const [listKw, setListKw] = useState("");

  // 换组（records 变化）时清空搜索词（与原页面 handleGroup 行为一致）
  useEffect(() => {
    setListKw("");
  }, [records]);

  // 列表搜索过滤（按名称或 NORAD 编号）
  const filtered = useMemo(() => {
    const kw = listKw.trim().toLowerCase();
    if (!kw) return records;
    return records.filter((r) => r.name.toLowerCase().includes(kw) || String(r.norad).includes(kw));
  }, [records, listKw]);

  return (
    <Slide direction="left" in={open} mountOnEnter unmountOnExit>
      <Box sx={{ position: "absolute", top: 0, right: 0, bottom: 120, width: 380, maxWidth: "88%", bgcolor: "background.paper", borderLeft: "1px solid", borderColor: "divider", boxShadow: "-8px 0 24px rgba(0,0,0,0.3)", zIndex: 3, display: "flex", flexDirection: "column" }}>
        <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={groupName}>
            {groupName ? `${groupName} · 卫星列表` : "卫星显示列表"}
          </Typography>
          <Button size="small" onClick={() => onSetHiddenNorads([])}>全显</Button>
          <Button size="small" onClick={() => onSetHiddenNorads(records.map((r) => r.norad))}>全隐</Button>
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </Box>
        <Box sx={{ p: 1.25, borderBottom: "1px solid", borderColor: "divider" }}>
          <TextField size="small" fullWidth placeholder="搜索名称 / NORAD" value={listKw} onChange={(e) => setListKw(e.target.value)} />
        </Box>
        {/* 列头：说明两个开关列含义（与行内 flex 布局对齐） */}
        <Box sx={{ px: 1.25, py: 0.5, borderBottom: "1px solid", borderColor: "divider", display: "flex", alignItems: "center", gap: 1, fontSize: 11, color: "text.secondary" }}>
          <Box sx={{ flex: "1 1 auto" }}>卫星名称</Box>
          <Box sx={{ flexShrink: 0, width: 42, textAlign: "center" }} title="是否绘制该卫星的轨道线">轨道线</Box>
          <Box sx={{ flexShrink: 0, width: 42, textAlign: "center" }} title="是否显示该卫星">显示</Box>
        </Box>
        <Box sx={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
          <List dense disablePadding>
            {filtered.map((r) => (
              <ListItem
                key={r.norad}
                disableGutters
                sx={{
                  px: 1.25,
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  cursor: "pointer",
                  "&:hover": { bgcolor: "action.hover" },
                  ...(selectedNorad === r.norad && {
                    bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(59,130,246,0.28)" : "rgba(59,130,246,0.14)"),
                    "& .MuiListItemText-primary": { color: "primary.main", fontWeight: 600 },
                  }),
                }}
                title="双击选中（跟踪）该卫星"
                onDoubleClick={() => onSelect(r.norad)}
              >
                <ListItemText
                  sx={{ minWidth: 0, flex: "1 1 auto" }}
                  primary={
                    <Box title={r.name} sx={{ fontSize: 13, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.name}
                    </Box>
                  }
                  secondary={
                    <Box sx={{ fontSize: 11, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      NORAD {r.norad}
                    </Box>
                  }
                />
                <Switch size="small" title="显示该卫星轨道线" sx={{ flexShrink: 0, width: 42 }} checked={!orbitHiddenSet.has(r.norad)} onChange={() => onToggleOrbitHidden(r.norad)} />
                <Switch size="small" title="显示该卫星" sx={{ flexShrink: 0, width: 42 }} checked={!hiddenSet.has(r.norad)} onChange={() => onToggleHidden(r.norad)} />
              </ListItem>
            ))}
            {!filtered.length && (
              <ListItem><Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>无匹配卫星</Typography></ListItem>
            )}
          </List>
        </Box>
        <Box sx={{ p: 1, borderTop: "1px solid", borderColor: "divider", fontSize: 12, color: "text.secondary" }}>
          共 {records.length} 颗 · 显示 {records.length - hiddenSet.size} 颗 · 隐藏 {hiddenSet.size} 颗
        </Box>
      </Box>
    </Slide>
  );
}
