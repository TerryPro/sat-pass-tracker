import { configureStore } from "@reduxjs/toolkit";
import trackReducer from "./slices/trackSlice.js";
import settingsReducer from "./slices/settingsSlice.js";
import libraryReducer from "./slices/librarySlice.js";

// 全局 Redux Store：各功能页面共享同一份卫星数据与实时位置
export const store = configureStore({
  reducer: {
    track: trackReducer,
    settings: settingsReducer,
    library: libraryReducer,
  },
});
