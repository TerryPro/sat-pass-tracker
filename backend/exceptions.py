"""
统一业务异常：路由层直接 raise，由 app.py 注册的全局处理器转换为 {"error": ...} 响应。

避免每个 handler 手写 try/except + JSONResponse，保证错误结构与状态码一致。
"""

from __future__ import annotations


class APIError(Exception):
    """所有业务错误的基类：携带 HTTP 状态码与对外提示信息。"""

    status_code: int = 500
    detail: str = "服务内部错误"

    def __init__(self, detail: str | None = None):
        if detail is not None:
            self.detail = detail
        super().__init__(self.detail)


class NotFoundError(APIError):
    """资源不存在（404）。"""

    status_code = 404
    detail = "资源不存在"


class ValidationError(APIError):
    """请求参数无效（400）。"""

    status_code = 400
    detail = "请求参数无效"


class ServiceError(APIError):
    """服务内部错误（500）。"""

    status_code = 500
    detail = "服务内部错误"
