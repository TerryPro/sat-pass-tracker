// 设置页通用展示组件：卡片标题与键值信息网格
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

// 卡片标题（含可选说明文字）
export function CardTitle({ title, hint }) {
  return (
    <>
      <Typography variant="h6" sx={{ mb: 0.5 }}>
        {title}
      </Typography>
      {hint ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {hint}
        </Typography>
      ) : null}
    </>
  );
}

// 键值信息网格（卫星信息对话框的分区展示用）；linkKeys 中的键值渲染为外链
export function InfoGrid({ fields, linkKeys = [] }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: "0 24px" }}>
      {fields.map(([label, value]) => (
        <Box
          key={label}
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 2,
            py: 0.75,
            borderBottom: "1px dashed",
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {label}
          </Typography>
          {linkKeys.includes(label) && value ? (
            <Typography variant="body2" sx={{ wordBreak: "break-all", ml: 1, textAlign: "right" }}>
              <a href={value} target="_blank" rel="noreferrer" style={{ color: "#90caf9" }}>
                {value}
              </a>
            </Typography>
          ) : (
            <Typography variant="body2" sx={{ wordBreak: "break-all", ml: 1, textAlign: "right" }}>
              {value || "—"}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}
