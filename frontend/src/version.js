// 应用版本：单一来源为仓库根 VERSION 文件（后端 config.py 同样读取它）
import raw from "../../VERSION?raw";

export const APP_VERSION = raw.trim() || "1.0.0";
