"""
run_agent.py - 作业入口：两个拆分后的天气工具 + agent loop（含多轮对话）

教学重点：
  1. 两个独立工具 geocode / get_weather_by_coords（见 weather_tools.py）
  2. 【真正的 agent loop】--不是"一次 tool_call + 一次回填"的单轮，而是
     循环：模型输出 tool_call -> 执行 -> 回填 -> 再问模型，直到模型不再
     调用工具、给出最终回答为止。
  3. 【多轮对话】会话历史 messages 跨轮累积（全量保留 tool_calls 与 tool 结果），
     模型可基于上文消解"那上海呢"、"明天呢"这类指代/省略；每轮步数预算独立重置。
       - 问"宁德天气"：模型先调 geocode(宁德)->拿到经纬度->再调 get_weather_by_coords->回答（链式/循环）
       - 问"北京的经纬度"：模型只调一次 geocode 即可回答（单工具独立答）
       - 问"经度116.4 纬度39.9 的天气"：模型只调一次 get_weather_by_coords（单工具独立答）
     这些形态共用同一个 loop，差异完全由模型自己决定--这就是 agent loop。

LLM 接口：参考 week11/mode_function_call/run_function_call.py 的 DeepSeek 调用
（OpenAI 兼容协议，openai SDK）。

使用：
  # 配置环境变量
  #   Windows:  set DEEPSEEK_API_KEY=sk-xxx
  #   Linux:    export DEEPSEEK_API_KEY=sk-xxx

  # 单个问题（单轮）
  python run_agent.py -q "宁德今天的天气怎么样？"

  # 内置连贯对话（多轮，演示上下文延续）
  python run_agent.py --demo

  # 进入交互式多轮对话 REPL（exit/quit/Ctrl+C 退出）
  python run_agent.py --chat

  # 切到 DashScope 的 qwen-plus
  python run_agent.py --provider dashscope -q "北京的经纬度"
"""

import json
import os
import sys
import time
from pathlib import Path

from openai import OpenAI

# 让 weather_tools 可被 import（直接 python 运行本脚本也能找到）
sys.path.insert(0, str(Path(__file__).parent))

from weather_tools import geocode, get_weather_by_coords  # noqa: E402

# ── LLM 配置（参考 mode_function_call/run_function_call.py）─────────────────

PROVIDERS = {
    "deepseek": {
        "api_key": os.environ.get("DEEPSEEK_API_KEY", ""),
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "dashscope": {
        "api_key": os.environ.get("DASHSCOPE_API_KEY", ""),
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
}


def build_client(provider: str):
    cfg = PROVIDERS[provider]
    if not cfg["api_key"]:
        print(f"错误：未设置 {provider.upper()}_API_KEY", file=sys.stderr)
        sys.exit(1)
    return OpenAI(api_key=cfg["api_key"], base_url=cfg["base_url"]), cfg["model"]


# ── 工具 Schema：两个拆分后的工具 ───────────────────────────────────────────

TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "geocode",
            "description": (
                "把城市名解析成经纬度（地理编码）。输入中文城市名如'北京'、'宁德'，"
                "返回该城市的纬度 latitude 和经度 longitude。"
                "当用户问'某城市的经纬度/坐标'时直接用本工具即可；"
                "当用户问'某城市天气'但本工具不含天气查询时，先用本工具拿到经纬度，"
                "再把经纬度传给 get_weather_by_coords 查天气（链式调用）。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "城市中文名，如 '宁德'、'北京'"},
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_weather_by_coords",
            "description": (
                "按经纬度查询当前天气及未来3天预报。参数是数值型的纬度/经度。"
                "若用户已直接给出经纬度，直接调用本工具；"
                "若用户只给了城市名，请先调用 geocode 拿到经纬度，再调用本工具（链式）。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "latitude": {"type": "number", "description": "纬度，如 39.9"},
                    "longitude": {"type": "number", "description": "经度，如 116.4"},
                },
                "required": ["latitude", "longitude"],
            },
        },
    },
]

# 工具名 -> 后端函数 的派发表（业务逻辑与协议层分离）
TOOL_DISPATCH = {
    "geocode": geocode,
    "get_weather_by_coords": get_weather_by_coords,
}

SYSTEM_PROMPT = (
    "你是一名天气助手，有两个工具可用：geocode（城市名->经纬度）和 "
    "get_weather_by_coords（经纬度->天气）。"
    "请按需调用工具，必要时可链式调用（先 geocode 拿经纬度，再 get_weather_by_coords 查天气）。"
    "只依据工具返回的数据作答，不要编造。"
)

# ── 【核心】agent loop：模型循环调用工具直到给出最终回答 ────────────────────

MAX_STEPS = 10  # 防御性兜底，避免模型无限循环；每轮独立计数


def new_session() -> list:
    """新建一个会话历史，初始只含 system prompt。多轮对话中 messages 跨轮累积。"""
    return [{"role": "system", "content": SYSTEM_PROMPT}]


def run_turn(client, model: str, messages: list, question: str, verbose: bool = True) -> dict:
    """
    在一轮会话上跑一次 agent loop：追加用户问题 -> 工具循环到最终回答。

    messages 是跨轮累积的会话历史（含 system 与之前所有轮次），本函数**就地追加**
    本轮的 user / assistant(tool_calls) / tool / 最终 assistant 消息--全量保留，
    使下一轮能引用上文（多轮对话记忆）。每轮步数预算 MAX_STEPS 独立重置。
    """
    messages.append({"role": "user", "content": question})
    t0 = time.time()
    tool_call_log = []

    for step in range(1, MAX_STEPS + 1):
        resp = client.chat.completions.create(
            model=model,
            messages=messages,
            tools=TOOLS_SCHEMA,
            tool_choice="auto",
        )
        msg = resp.choices[0].message

        # 模型本轮不再调用工具 -> 已经是最终回答，退出循环
        if not msg.tool_calls:
            # 最终回答也并入会话历史，供下一轮引用（多轮记忆的关键）
            messages.append({"role": "assistant", "content": msg.content or ""})
            if verbose:
                print(f"  -> [llm] 最终回答（第{step}轮，共{time.time() - t0:.1f}s）")
            return {
                "answer": msg.content or "",
                "tool_calls": tool_call_log,
                "steps": step,
                "elapsed": time.time() - t0,
            }

        # 把 assistant 这条带 tool_calls 的消息原样回填，保持上下文（全量保留）
        messages.append(msg)

        # 逐个执行模型本轮要调的工具
        for tc in msg.tool_calls:
            name = tc.function.name
            args = json.loads(tc.function.arguments or "{}")
            tool_call_log.append({"name": name, "args": args})
            if verbose:
                print(f"  -> [tool step {step}] {name}({args})")
            fn = TOOL_DISPATCH.get(name)
            if fn is None:
                result = f"未知工具：{name}"
            else:
                try:
                    result = fn(**args)
                except TypeError as e:
                    result = f"参数错误：{e}"
                except Exception as e:
                    result = f"工具执行失败：{e}"
            preview = (result or "")[:120].replace("\n", " ")
            if verbose:
                print(f"    ↩ {preview}{'...' if len(result or '') > 120 else ''}\n")
            # 以 role=tool 回填，tool_call_id 必须对上（全量保留）
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })
        # 循环回到顶部，让模型看到工具结果后决定：继续调工具 or 给最终回答

    # 达到最大步数仍未给出最终回答：仍写一条 assistant 消息，保持历史结构完整
    fallback = "（达到最大步数，模型仍未给出最终回答）"
    messages.append({"role": "assistant", "content": fallback})
    return {
        "answer": fallback,
        "tool_calls": tool_call_log,
        "steps": MAX_STEPS,
        "elapsed": time.time() - t0,
    }


# ── 入口 ───────────────────────────────────────────────────────────────────

# --demo 的连贯对话：三句话共用同一个会话，演示多轮上下文延续与指代/省略消解
DEMO_CONVERSATION = [
    "宁德今天的天气怎么样？",   # 第1轮：链式 geocode -> get_weather_by_coords，建立城市+天气上下文
    "那上海呢？",              # 第2轮：靠历史消解"那…呢" -> 重新 geocode(上海) 查天气
    "明天呢？",                # 第3轮：靠历史消解"明天" -> 从已有预报取或重查
]


def chat_repl(client, model: str, verbose: bool = True):
    """交互式多轮对话 REPL：messages 跨轮累积，exit/quit/Ctrl+C 退出。"""
    messages = new_session()
    print("进入多轮对话（输入 exit/quit 或 Ctrl+C 退出）\n")
    while True:
        try:
            q = input("你：").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n再见。")
            break
        if not q:
            continue
        if q.lower() in ("exit", "quit", "退出"):
            print("再见。")
            break
        result = run_turn(client, model, messages, q, verbose=verbose)
        print("\n助手：")
        print(result["answer"])
        print(f"\n（本轮工具调用 {len(result['tool_calls'])} 次，循环 {result['steps']} 轮，"
              f"耗时 {result['elapsed']:.1f}s）\n")


def _print_turn(idx, q, result):
    print("=" * 60)
    print(f"Q{idx}：{q}")
    print("=" * 60)
    print("\n最终回答：")
    print(result["answer"])
    print(f"\n（本轮工具调用 {len(result['tool_calls'])} 次，循环 {result['steps']} 轮，"
          f"耗时 {result['elapsed']:.1f}s）\n")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="作业：拆分天气工具 + agent loop（含多轮对话）")
    parser.add_argument("--question", "-q", help="单个问题（单轮）")
    parser.add_argument("--demo", action="store_true", help="跑内置连贯对话（多轮，演示上下文延续）")
    parser.add_argument("--chat", action="store_true", help="进入交互式多轮对话 REPL")
    parser.add_argument("--provider", default="deepseek", choices=PROVIDERS.keys())
    parser.add_argument("--quiet", action="store_true", help="少输出")
    args = parser.parse_args()

    client, model = build_client(args.provider)
    verbose = not args.quiet

    if args.chat:
        print(f"[Split Weather Agent] provider={args.provider} model={model}（多轮对话）\n")
        chat_repl(client, model, verbose=verbose)
        return

    if args.demo:
        print(f"[Split Weather Agent] provider={args.provider} model={model}（连贯对话演示）\n")
        messages = new_session()
        for i, q in enumerate(DEMO_CONVERSATION, 1):
            result = run_turn(client, model, messages, q, verbose=verbose)
            _print_turn(i, q, result)
        return

    # 默认：单轮（-q 给定，否则用第一条示例）
    q = args.question or DEMO_CONVERSATION[0]
    print(f"[Split Weather Agent] provider={args.provider} model={model}\n")
    messages = new_session()
    result = run_turn(client, model, messages, q, verbose=verbose)
    _print_turn("", q, result)


if __name__ == "__main__":
    main()
