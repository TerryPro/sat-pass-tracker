import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { fetchPasses } from "../api";
// 默认参数以 constants.js 为单一来源（支持 frontend/.env 的 VITE_DEFAULT_* 覆盖）
import { DEFAULT_PARAMS as API_DEFAULT_PARAMS } from "../constants.js";

export const DEFAULT_PARAMS = {
  lat: API_DEFAULT_PARAMS.lat,
  lon: API_DEFAULT_PARAMS.lon,
  alt: API_DEFAULT_PARAMS.alt,
  hours: API_DEFAULT_PARAMS.hours,
  sample_interval: API_DEFAULT_PARAMS.sample_interval,
  // 默认卫星必须落在 BUILTIN_SATELLITES 或后端 satellites 库内，否则 MUI Select 值越界告警。
  // 此前硬编码 "fo29" 已从库中移除，改写为内置常驻的 iss，避免首次加载越界。
  satellite: "iss",
};

// 异步加载过境数据（REST）
export const loadPasses = createAsyncThunk(
  "track/loadPasses",
  async (params, { rejectWithValue }) => {
    try {
      return await fetchPasses(params);
    } catch (e) {
      return rejectWithValue(e.message);
    }
  }
);

const trackSlice = createSlice({
  name: "track",
  initialState: {
    params: DEFAULT_PARAMS,
    data: null,          // 过境 + 星下点数据
    loading: false,
    error: "",
    activeIdx: 0,        // 当前选中的过境
    currentPos: null,    // 实时位置（Socket.IO 推送）
    socketStatus: "connecting", // Socket.IO 连接状态：connecting / connected / disconnected
    compactSidebar: true,
    sidebarVisible: true,
  },
  reducers: {
    // 局部更新参数（如只改经纬度）
    updateParams(state, action) {
      state.params = { ...state.params, ...action.payload };
    },
    setActiveIdx(state, action) {
      state.activeIdx = action.payload;
    },
    setCurrentPos(state, action) {
      state.currentPos = action.payload;
    },
    setSocketStatus(state, action) {
      state.socketStatus = action.payload;
    },
    toggleCompactSidebar(state) {
      state.compactSidebar = !state.compactSidebar;
    },
    toggleSidebar(state) {
      state.sidebarVisible = !state.sidebarVisible;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadPasses.pending, (state) => {
        state.loading = true;
        state.error = "";
      })
      .addCase(loadPasses.fulfilled, (state, action) => {
        state.loading = false;
        state.data = action.payload;
        // 默认选中最大仰角最高的过境（展示完整弧线）
        let best = 0;
        action.payload.passes.forEach((pass, i) => {
          if (pass.max_elevation_deg > action.payload.passes[best].max_elevation_deg) best = i;
        });
        state.activeIdx = best;
      })
      .addCase(loadPasses.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload || "加载失败";
      });
  },
});

export const { updateParams, setActiveIdx, setCurrentPos, setSocketStatus, toggleCompactSidebar, toggleSidebar } =
  trackSlice.actions;

export default trackSlice.reducer;
