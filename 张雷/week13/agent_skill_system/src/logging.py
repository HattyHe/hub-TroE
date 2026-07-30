"""logging.py - 结构化日志 + stderr 错误（FR-016 / 可观测性原则）。

LLM 链路非确定性，日志与 stderr 是调试与复现的唯一抓手。禁止静默吞没异常。
"""
import json
import sys
import time


def log_event(event: str, **fields) -> None:
    """结构化日志到 stderr：事件名 + 任意字段（输入摘要/工具名/输出摘要/耗时）。"""
    rec = {"event": event, "ts": time.time(), **fields}
    print(json.dumps(rec, ensure_ascii=False), file=sys.stderr, flush=True)


def log_error(message: str, **fields) -> None:
    """错误走 stderr，携带可复现上下文。"""
    rec = {"error": message, "ts": time.time(), **fields}
    print(json.dumps(rec, ensure_ascii=False), file=sys.stderr, flush=True)
