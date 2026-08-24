// useAppTheme Hook：读取应用主题（设置页 theme 字段），供组件配色跟随亮/暗主题。
// 该选择器在多处组件重复出现（地图/图表/甘特图等），收敛为单一 Hook 保证取色一致。
import { useSelector } from "react-redux";

export function useAppTheme() {
  return useSelector((s) => s.settings.values?.theme || "dark");
}
