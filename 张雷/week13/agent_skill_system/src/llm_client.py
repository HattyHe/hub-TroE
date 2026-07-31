"""llm_client.py - DeepSeek / DashScope provider（复用 week12 build_client）。

OpenAI 兼容协议。密钥从环境变量读取，检查时仅输出 set / MISSING，不回显值（constitution）。
"""
from __future__ import annotations

import os
import sys

from openai import OpenAI

PROVIDERS = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
        "key_env": "DEEPSEEK_API_KEY",
    },
    "dashscope": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
        "key_env": "DASHSCOPE_API_KEY",
    },
}


def key_status(provider: str) -> str:
    env = PROVIDERS[provider]["key_env"]
    return "set" if os.environ.get(env) else "MISSING"


def build_client(provider: str = "deepseek"):
    cfg = PROVIDERS[provider]
    key = os.environ.get(cfg["key_env"], "")
    if not key:
        print(f"错误：未设置 {cfg['key_env']}（{key_status(provider)}）", file=sys.stderr)
        sys.exit(1)
    return OpenAI(api_key=key, base_url=cfg["base_url"]), cfg["model"]
