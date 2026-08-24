import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  fetchSettings,
  saveSettings,
  importSatellite as apiImportSatellite,
  deleteSatellite as apiDeleteSatellite,
} from "../api";

// 从后端读取持久化设置
export const loadSettings = createAsyncThunk("settings/load", async () => fetchSettings());

// 保存设置到后端
export const persistSettings = createAsyncThunk(
  "settings/save",
  async (settings) => saveSettings(settings)
);

// 从网络导入卫星（按 NORAD 目录号）
export const importSatellite = createAsyncThunk(
  "settings/importSatellite",
  async (noradId, { rejectWithValue }) => {
    try {
      return await apiImportSatellite(noradId);
    } catch (e) {
      return rejectWithValue(e.message);
    }
  }
);

// 删除自定义卫星
export const deleteSatellite = createAsyncThunk(
  "settings/deleteSatellite",
  async (id, { rejectWithValue }) => {
    try {
      return await apiDeleteSatellite(id);
    } catch (e) {
      return rejectWithValue(e.message);
    }
  }
);

const settingsSlice = createSlice({
  name: "settings",
  initialState: {
    status: "idle", // idle | loading | loaded | error
    values: null,   // 后端返回的完整设置
  },
  reducers: {
    // 本地即时更新（如主题切换），不写入后端；由 persistSettings 统一持久化
    setLocalSettings(state, action) {
      state.values = { ...(state.values || {}), ...action.payload };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSettings.pending, (state) => {
        state.status = "loading";
      })
      .addCase(loadSettings.fulfilled, (state, action) => {
        state.status = "loaded";
        state.values = action.payload;
      })
      .addCase(loadSettings.rejected, (state) => {
        state.status = "error";
      })
      .addCase(persistSettings.fulfilled, (state, action) => {
        state.values = action.payload;
      })
      .addCase(importSatellite.fulfilled, (state, action) => {
        state.values = { ...state.values, satellites: action.payload.satellites };
      })
      .addCase(deleteSatellite.fulfilled, (state, action) => {
        state.values = { ...state.values, satellites: action.payload.satellites };
      });
  },
});

export const { setLocalSettings } = settingsSlice.actions;

export default settingsSlice.reducer;
