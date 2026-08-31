// 设置页容器：地面站管理 / 参数设置 两张独立卡片。
// 仅保留跨卡片共享的状态（表单、站点列表、通知条）与保存/自动保存逻辑；
// 各卡片的对话框与本地状态内聚在 pages/settings/ 下的组件中。
// 卫星管理已迁移到独立页面（/satellites），不再在此重复。
import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import { useDispatch, useSelector } from "react-redux";
import { loadPasses, updateParams } from "../slices/trackSlice.js";
import { persistSettings, setLocalSettings } from "../slices/settingsSlice.js";
import { BUILTIN_SATELLITES, BUILTIN_STATIONS } from "../constants.js";
import StationCard from "./settings/StationCard.jsx";
import ParamsCard from "./settings/ParamsCard.jsx";

// 数值字段转 Number，其余（satellite/theme）保持字符串
const NUMERIC_KEYS = ["lat", "lon", "alt", "hours", "sample_interval"];

// 设置页：地面站管理（独立卡片）/ 参数设置（独立卡片），各自保存到后端
export default function SettingsPage() {
  const dispatch = useDispatch();
  const params = useSelector((s) => s.track.params);
  const savedSettings = useSelector((s) => s.settings.values);
  const themeSetting = useSelector((s) => s.settings.values?.theme || "dark");
  const showDashedSetting = useSelector(
    (s) => (s.settings.values?.terminator_show_dashed ?? true) === true
  );
  const timeDisplaySetting = useSelector((s) => s.settings.values?.time_display || "utc");
  const reduxStations = useSelector((s) => s.settings.values?.stations);
  const satellites = useSelector((s) => s.settings.values?.satellites || BUILTIN_SATELLITES);
  const [form, setForm] = useState(() => ({
    // 以持久化设置为优先，其次回退到当前轨道参数（直接访问 /settings 时 track 尚未加载）
    lat: savedSettings?.lat ?? params.lat,
    lon: savedSettings?.lon ?? params.lon,
    alt: savedSettings?.alt ?? params.alt,
    satellite: savedSettings?.satellite ?? params.satellite,
    hours: savedSettings?.hours ?? params.hours,
    sample_interval: savedSettings?.sample_interval ?? params.sample_interval,
    theme: themeSetting,
    terminator_show_dashed: showDashedSetting,
    time_display: timeDisplaySetting, // utc | local：界面时间显示时区
    orbit_color: savedSettings?.orbit_color || "rgba(255,180,70,0.55)", // 运行态势轨道线颜色
    tle_mode: savedSettings?.tle_mode || "online", // online（联网优先）| builtin（内置/本地，不联网）
  }));
  // 字段级"用户是否主动编辑过"标记：
  // - terminator_show_dashed：用户手动点过 Switch 后置 true；保存成功后清 false，允许后续从 Redux 回填。
  const fieldDirtyRef = useRef({ terminator_show_dashed: false });
  // 站点列表（内置 + 自定义），仅管理名称 / 经纬度 / 海拔
  const [stations, setStations] = useState(reduxStations || BUILTIN_STATIONS);
  const [selId, setSelId] = useState(
    () =>
      (reduxStations || BUILTIN_STATIONS).find(
        (s) => s.lat === params.lat && s.lon === params.lon && s.alt === params.alt
      )?.id || null
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // 1) 站点列表 + 选中项同步：每次 Redux stations 变更都刷新（初始加载 / 保存站点 / 删除站点）
  useEffect(() => {
    if (!reduxStations) return;
    setStations(reduxStations);
    setSelId((prev) => {
      if (prev && reduxStations.some((s) => s.id === prev)) return prev;
      const match = reduxStations.find(
        (s) => s.lat === form.lat && s.lon === form.lon && s.alt === form.alt
      );
      return match ? match.id : reduxStations[0]?.id || null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduxStations]);

  // 2) 外观字段（theme / 晨昏线虚线开关）从 Redux → 本地 form 的回填策略：
  //    a. showDashedSetting：每次 Redux 值变化后检查；仅当"用户没手动改过这个开关"时才同步进 form。
  //       刷新页面 / 从其他页面跳转后（App/页面级 loadSettings 拉回后端持久化值），会正确回填；
  //       用户手动切换开关 → dirty=true → 不再被 Redux 覆盖 → 避免"保存后 stations 新引用引发的回写"。
  //    b. theme：即时生效型（setField("theme") 会 dispatch(setLocalSettings)，
  //       并且全局 AppShell / 其他页面也可能改 theme），所以始终按 Redux 同步，form 与 Redux 不一致时拉回。
  useEffect(() => {
    if (fieldDirtyRef.current.terminator_show_dashed) return;
    setForm((f) =>
      f.terminator_show_dashed === showDashedSetting
        ? f
        : { ...f, terminator_show_dashed: showDashedSetting }
    );
  }, [showDashedSetting]);

  useEffect(() => {
    setForm((f) => (f.theme === themeSetting ? f : { ...f, theme: themeSetting }));
  }, [themeSetting]);

  // 自动保存：参数/外观字段变更后防抖 800ms 写入后端，无需手动点保存。
  // 站点列表仍由"保存站点"按钮提交（增删改属于显式操作）；此处只覆盖表单字段。
  // 比较基准是 persistedRef 快照（首次从后端加载，之后由自动保存同步），
  // 而非 Redux 实时值——主题经 setLocalSettings 即时生效会立刻改变 Redux 值，
  // 若直接比较会导致误判"已一致"或把持久化值覆盖成页面默认值。
  const pickForm = (src) => ({
    lat: src.lat, lon: src.lon, alt: src.alt,
    satellite: src.satellite, hours: src.hours, sample_interval: src.sample_interval,
    theme: src.theme, terminator_show_dashed: src.terminator_show_dashed,
    time_display: src.time_display, orbit_color: src.orbit_color,
    tle_mode: src.tle_mode,
  });
  const sameForm = (a, b) =>
    a.lat === b.lat && a.lon === b.lon && a.alt === b.alt &&
    a.satellite === b.satellite && a.hours === b.hours &&
    a.sample_interval === b.sample_interval &&
    a.theme === b.theme && a.terminator_show_dashed === b.terminator_show_dashed &&
    a.time_display === b.time_display && a.orbit_color === b.orbit_color &&
    a.tle_mode === b.tle_mode;

  const persistedRef = useRef(null); // 最近一次已持久化/已加载的表单字段快照
  const initedRef = useRef(false);   // 是否已用后端值初始化过表单（只一次）
  const savingRef = useRef(false);   // 保存请求在途标记，防止重复写入

  // 设置加载完成后：用持久化值初始化快照并回填表单（仅首次，避免覆盖用户编辑）
  useEffect(() => {
    if (!savedSettings || initedRef.current) return;
    initedRef.current = true;
    persistedRef.current = pickForm(savedSettings);
    setForm((f) => (sameForm(f, persistedRef.current) ? f : { ...f, ...persistedRef.current }));
  }, [savedSettings]);

  // 表单与快照不一致 → 防抖自动保存
  useEffect(() => {
    if (!persistedRef.current || sameForm(form, persistedRef.current)) return;
    const id = setTimeout(() => {
      if (savingRef.current) return; // 已有保存请求在途，避免重复写入
      savingRef.current = true;
      // 发起请求时同步更新快照：保存完成后 Redux 刷新不会再把同一变更判为"脏"
      fieldDirtyRef.current.terminator_show_dashed = false;
      persistedRef.current = pickForm(form);
      dispatch(persistSettings(pickForm(form))).finally(() => {
        savingRef.current = false;
      });
    }, 800);
    return () => clearTimeout(id);
  }, [
    form.lat, form.lon, form.alt, form.satellite, form.hours,
    form.sample_interval, form.theme, form.terminator_show_dashed, form.time_display, form.orbit_color, form.tle_mode, dispatch,
  ]);

  const setField = (key) => (e) => {
    const raw = e.target.value;
    const v = NUMERIC_KEYS.includes(key) ? Number(raw) : raw;
    setForm((f) => ({ ...f, [key]: v }));
    // 外观类即时生效（不点保存也立即应用）
    if (key === "theme" || key === "time_display" || key === "orbit_color") dispatch(setLocalSettings({ [key]: v }));
  };

  // 布尔字段：从 Switch 读取 checked（比如晨昏线显示相关）；手动改动后标记 dirty，防止 Redux 立即覆盖
  const setBoolField = (key) => (e) => {
    const v = !!e.target.checked;
    if (key in fieldDirtyRef.current) fieldDirtyRef.current[key] = true;
    setForm((f) => ({ ...f, [key]: v }));
  };

  // 选中站点：填入经纬度与海拔
  const selectStation = (st) => {
    setSelId(st.id);
    setForm((f) => ({ ...f, lat: st.lat, lon: st.lon, alt: st.alt }));
  };

  // 保存站点：提交站点列表 + 当前使用坐标（选中站点），同时一并持久化外观类字段
  // （theme / terminator_show_dashed 等）——避免用户改了卡片2的开关却点了卡片1的保存按钮造成漏写。
  const handleSaveStations = async () => {
    setError("");
    try {
      const saved = await dispatch(
        persistSettings({
          stations,
          lat: form.lat,
          lon: form.lon,
          alt: form.alt,
          theme: form.theme,
          terminator_show_dashed: form.terminator_show_dashed,
          time_display: form.time_display,
        })
      ).unwrap();
      const { stations: _stations, theme: _theme, ...trackParams } = saved;
      dispatch(updateParams(trackParams));
      dispatch(loadPasses(trackParams));
      // 保存成功后：后端与 Redux 已是最新值，本地草稿 dirty 标记清除，允许后续回填同步
      fieldDirtyRef.current.terminator_show_dashed = false;
      // 同步自动保存快照，避免随后自动保存重复写入
      persistedRef.current = {
        ...persistedRef.current,
        lat: form.lat, lon: form.lon, alt: form.alt,
        theme: form.theme, terminator_show_dashed: form.terminator_show_dashed,
        time_display: form.time_display,
      };
      setSaved(true);
    } catch (e) {
      setError(e.message || "保存失败");
    }
  };

  // 保存参数：仅提交卫星/时长/采样/主题等配置，一并持久化外观类布尔开关
  const handleSave = async () => {
    setError("");
    try {
      const savedSettings = await dispatch(persistSettings(form)).unwrap();
      const { theme, ...trackParams } = savedSettings;
      dispatch(updateParams(trackParams));
      dispatch(loadPasses(trackParams));
      // 保存成功后：后端与 Redux 已经是最新值，本地草稿 dirty 标记可以清除，
      // 允许后续刷新页面 / 重新进入设置页时从 Redux 回填最新持久化值。
      fieldDirtyRef.current.terminator_show_dashed = false;
      // 同步自动保存快照，避免随后自动保存重复写入
      persistedRef.current = pickForm(form);
      setSaved(true);
    } catch (e) {
      setError(e.message || "保存失败");
    }
  };

  return (
    <Box sx={{ p: 2, flex: 1, minHeight: 0, overflow: "auto" }}>
      <Grid container spacing={2}>
        {/* 卡片 1：地面站管理（独立容器） */}
        <Grid size={{ xs: 12, md: 6 }}>
          <StationCard
            stations={stations}
            selId={selId}
            coords={{ lat: form.lat, lon: form.lon, alt: form.alt }}
            onSelect={selectStation}
            onStationsChange={setStations}
            onSelIdChange={setSelId}
            onSave={handleSaveStations}
            onError={setError}
          />
        </Grid>

        {/* 卡片 2：参数设置（独立容器） */}
        <Grid size={{ xs: 12, md: 6 }}>
          <ParamsCard
            form={form}
            satellites={satellites}
            onField={setField}
            onBoolField={setBoolField}
            onSave={handleSave}
          />
        </Grid>
      </Grid>

      <Snackbar open={saved} autoHideDuration={2500} onClose={() => setSaved(false)}>
        <Alert severity="success" variant="filled" onClose={() => setSaved(false)}>
          设置已保存并应用
        </Alert>
      </Snackbar>
      <Snackbar open={!!error} autoHideDuration={4000} onClose={() => setError("")}>
        <Alert severity="error" variant="filled" onClose={() => setError("")}>
          {error}
        </Alert>
      </Snackbar>
    </Box>
  );
}
