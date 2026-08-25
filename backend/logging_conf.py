"""
统一日志配置：为整个后端提供一致的时间/级别/模块格式。

在 app.py 的 lifespan 启动时调用 setup_logging()，为根 logger 添加统一的
StreamHandler 与格式化（时间、级别、模块、消息）。各业务模块只需
`logger = logging.getLogger(__name__)` 记录，即可统一输出；避免散落 print。
"""
from __future__ import annotations

import logging
import sys

_FORMAT = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"
_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging(level: int = logging.INFO) -> None:
    """配置根 logger：添加带统一格式的 stdout handler。

    幂等：若根 logger 已挂接 StreamHandler（如测试重载、多次调用），直接返回，
    避免重复追加 handler 导致日志重复输出。
    """
    root = logging.getLogger()
    if any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATE_FORMAT))
    root.addHandler(handler)
    root.setLevel(level)