import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import {
  fetchLibraryMeta,
  downloadSource,
  fetchLibraryEntries,
} from "../api/library.js";

// 加载数据源元信息（可用组 + 本地是否已下载）
export const loadLibraryMeta = createAsyncThunk("library/meta", async () => fetchLibraryMeta());

// 下载某数据源组文件并合并进本地卫星库
export const downloadLibrarySource = createAsyncThunk("library/download", async (key, { rejectWithValue }) => {
  try {
    return await downloadSource(key);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

// 浏览本地卫星库数据（q/source 过滤）
export const loadLibraryEntries = createAsyncThunk("library/entries", async (params = {}, { rejectWithValue }) => {
  try {
    return await fetchLibraryEntries(params);
  } catch (e) {
    return rejectWithValue(e.message);
  }
});

const librarySlice = createSlice({
  name: "library",
  initialState: {
    meta: null,          // { groups:[{key,label,url,downloaded,count,fetched_at}], total_entries }
    entries: null,       // { count, generated_at, entries:[{norad_id,name,source,tle1,tle2}] }
    searching: false,    // entries 加载中
    downloadingKey: null, // 正在下载的组 key
    error: "",
    _latestSeq: 0,       // 最新一次 entries 请求的序号（latest-wins 竞态防护）
  },
  reducers: {
    clearLibraryError(state) {
      state.error = "";
    },
    clearEntries(state) {
      state.entries = null;
      state.searching = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadLibraryMeta.pending, (state) => {
        state.error = "";
      })
      .addCase(loadLibraryMeta.fulfilled, (state, action) => {
        state.meta = action.payload;
      })
      .addCase(loadLibraryMeta.rejected, (state, action) => {
        state.error = action.error?.message || "加载数据源失败";
      })
      .addCase(downloadLibrarySource.fulfilled, (state) => {
        state.downloadingKey = null;
      })
      .addCase(downloadLibrarySource.pending, (state, action) => {
        state.downloadingKey = action.meta.arg;
        state.error = "";
      })
      .addCase(downloadLibrarySource.rejected, (state, action) => {
        state.downloadingKey = null;
        state.error = action.payload || "下载失败";
        // 下载失败也要刷新元信息，使 downloaded 状态回退为未下载（若有旧状态）
      })
      .addCase(loadLibraryEntries.pending, (state, action) => {
        const seq = action.meta.arg?.seq || 0;
        if (seq < state._latestSeq) return; // 过期请求，忽略
        state.searching = true;
        state.error = "";
      })
      .addCase(loadLibraryEntries.fulfilled, (state, action) => {
        const seq = action.meta.arg?.seq || 0;
        if (seq < state._latestSeq) return; // 过期请求结果，不覆盖较新的数据
        state._latestSeq = seq;
        state.searching = false;
        state.entries = action.payload;
      })
      .addCase(loadLibraryEntries.rejected, (state, action) => {
        // 仅最新请求的错误才展示，避免过期请求的报错覆盖界面
        const seq = action.meta.arg?.seq || 0;
        if (seq < state._latestSeq) return;
        state._latestSeq = seq;
        state.searching = false;
        state.error = action.payload || "加载卫星库数据失败";
      });
  },
});

export const { clearLibraryError, clearEntries } = librarySlice.actions;

export default librarySlice.reducer;
