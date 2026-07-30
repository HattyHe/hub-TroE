"""run_agent.py - CLI 入口（对齐 week12 argparse）。

使用：
  python run_agent.py -q "列出当前目录的文件"
  python run_agent.py --provider dashscope -q "..."
  python run_agent.py --chat     # 交互式多轮
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from src.agent import Agent, new_session  # noqa: E402
from src.llm_client import PROVIDERS, build_client, key_status  # noqa: E402


def chat_repl(agent: Agent) -> None:
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
        answer = agent.run_turn(messages, q)
        print("\n助手：", answer, "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="受限 Bash + Skill 动态加载 Agent")
    parser.add_argument("--question", "-q", help="单个问题（单轮）")
    parser.add_argument("--chat", action="store_true", help="交互式多轮对话")
    parser.add_argument("--provider", default="deepseek", choices=PROVIDERS.keys())
    parser.add_argument("--check-key", action="store_true", help="仅打印密钥状态后退出")
    args = parser.parse_args()

    if args.check_key:
        print(f"{args.provider}_API_KEY: {key_status(args.provider)}")
        return

    client, model = build_client(args.provider)
    agent = Agent(client, model, skills_dir=str(Path(__file__).parent / "skills"))

    if args.chat:
        print(f"[Agent] provider={args.provider} model={model}（多轮对话）\n")
        chat_repl(agent)
        return

    q = args.question or "列出当前目录的文件"
    print(f"[Agent] provider={args.provider} model={model}\n")
    messages = new_session()
    print("Q：", q)
    print("A：", agent.run_turn(messages, q))


if __name__ == "__main__":
    main()
