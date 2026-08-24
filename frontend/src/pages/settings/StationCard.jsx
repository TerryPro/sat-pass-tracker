// 地面站管理卡片：站点表格（选中即用）+ 新增/编辑对话框（含名称）。
// 对话框状态（dlg/dlgForm）在本地维护；站点增删改通过回调提交给父级容器。
import React, { useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Radio from "@mui/material/Radio";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { CardTitle } from "./parts.jsx";
import { inputSx } from "./helpers.js";

// 站点增删改对话框的初始表单
const EMPTY_DLG_FORM = { name: "", lat: 0, lon: 0, alt: 0 };

export default function StationCard({
  stations,
  selId,
  coords,
  onSelect,
  onStationsChange,
  onSelIdChange,
  onSave,
  onError,
}) {
  // 新增/编辑对话框：null 关闭；{ mode: "add" } 或 { mode: "edit", id }
  const [dlg, setDlg] = useState(null);
  const [dlgForm, setDlgForm] = useState(EMPTY_DLG_FORM);

  // 新增：用当前使用坐标预填，便于快速复制
  const openAdd = () => {
    setDlgForm({ name: "", lat: coords.lat, lon: coords.lon, alt: coords.alt });
    setDlg({ mode: "add" });
  };

  const openEdit = (st) => {
    setDlgForm({ name: st.name, lat: st.lat, lon: st.lon, alt: st.alt });
    setDlg({ mode: "edit", id: st.id });
  };

  const closeDlg = () => setDlg(null);

  const setDlgField = (key) => (e) => {
    const raw = e.target.value;
    const v = key === "name" ? raw : Number(raw);
    setDlgForm((f) => ({ ...f, [key]: v }));
  };

  // 提交对话框：新增自定义站点或更新已有站点（名称可改，留空自动命名）
  const submitDlg = () => {
    const { name, lat, lon, alt } = dlgForm;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt)) {
      onError("坐标必须是有效数字");
      return;
    }
    if (dlg.mode === "edit") {
      const finalName = name.trim() || stations.find((s) => s.id === dlg.id)?.name || "";
      onStationsChange((prev) =>
        prev.map((s) => (s.id === dlg.id ? { ...s, name: finalName, lat, lon, alt } : s))
      );
    } else {
      const customCount = stations.filter((s) => !s.builtin).length;
      const finalName = name.trim() || `自定义站点 ${customCount + 1}`;
      const st = {
        id: `custom-${Date.now()}`,
        name: finalName,
        lat,
        lon,
        alt,
        builtin: false,
      };
      onStationsChange((prev) => [...prev, st]);
      onSelIdChange(st.id);
    }
    setDlg(null);
  };

  // 删除自定义站点（内置站点不可删除）
  const removeStation = (id) => {
    onStationsChange((prev) => prev.filter((s) => s.id !== id));
    onSelIdChange((prev) => (prev === id ? null : prev));
  };

  return (
    <>
      <Paper sx={{ p: 2.5, height: "100%", display: "flex", flexDirection: "column" }}>
        <CardTitle
          title="地面站管理"
          hint="站点仅含名称与经纬度、海拔；点击行使用该站点，自定义站点可编辑、删除"
        />
        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1, flex: 1, minHeight: 120 }}>
          <Table size="small" sx={{ minWidth: 420 }}>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>名称</TableCell>
                <TableCell align="right">纬度</TableCell>
                <TableCell align="right">经度</TableCell>
                <TableCell align="right">海拔</TableCell>
                <TableCell align="right">操作</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {stations.map((st) => (
                <TableRow
                  key={st.id}
                  hover
                  selected={selId === st.id}
                  onClick={() => onSelect(st)}
                  sx={{ cursor: "pointer" }}
                >
                  <TableCell padding="checkbox">
                    <Radio checked={selId === st.id} size="small" onClick={(e) => e.stopPropagation()} />
                  </TableCell>
                  <TableCell>{st.name}</TableCell>
                  <TableCell align="right">{st.lat.toFixed(4)}</TableCell>
                  <TableCell align="right">{st.lon.toFixed(4)}</TableCell>
                  <TableCell align="right">{st.alt} m</TableCell>
                  <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                    {!st.builtin ? (
                      <>
                        <IconButton size="small" aria-label={`编辑 ${st.name}`} onClick={() => openEdit(st)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label={`删除 ${st.name}`} onClick={() => removeStation(st.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        内置
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button size="small" variant="outlined" startIcon={<AddIcon />} onClick={openAdd}>
            新增站点
          </Button>
          <Button size="small" variant="contained" onClick={onSave}>
            保存站点
          </Button>
        </Box>
      </Paper>

      {/* 新增 / 编辑站点对话框（含名称） */}
      <Dialog open={!!dlg} onClose={closeDlg} fullWidth maxWidth="xs">
        <DialogTitle>{dlg?.mode === "edit" ? "编辑站点" : "新增站点"}</DialogTitle>
        <DialogContent>
          <TextField
            label="名称"
            size="small"
            fullWidth
            value={dlgForm.name}
            onChange={setDlgField("name")}
            placeholder={dlg?.mode === "add" ? "留空自动命名" : undefined}
            sx={{ my: 0.75 }}
          />
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
            <TextField
              label="纬度 (°)"
              type="number"
              size="small"
              value={dlgForm.lat}
              onChange={setDlgField("lat")}
              sx={inputSx}
            />
            <TextField
              label="经度 (°)"
              type="number"
              size="small"
              value={dlgForm.lon}
              onChange={setDlgField("lon")}
              sx={inputSx}
            />
          </Box>
          <TextField
            label="海拔 (m)"
            type="number"
            size="small"
            fullWidth
            value={dlgForm.alt}
            onChange={setDlgField("alt")}
            sx={{ my: 0.75 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDlg}>取消</Button>
          <Button variant="contained" onClick={submitDlg}>
            确定
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
