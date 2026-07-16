"""
main.py - fincli：天气查询 统一命令行入口

把 src/ 后端能力封装成一条"看起来像 git/ls 那样"的真实命令，而不是
`python xxx.py ...`。通过 pyproject.toml 的 [project.scripts] 注册为
console_script，`pip install -e .` 后即可全局调用：

  fincli weather --city 宁德

不想安装也可直接跑：
  python mode_cli/cli/main.py weather --city 宁德
  python -m mode_cli.cli.main weather --city 宁德

教学点：
  1. CLI 作为"工具实现层"，本质就是一个能跑的脚本--跟协议无关
  2. 用 pyproject + console_script 把脚本变成 PATH 上的真实命令，是 Python CLI 工具的标准发布方式
  3. 一个 fincli 含子命令（weather），对应 git 的子命令设计

依赖：
  pip install httpx
"""

import argparse
import sys
from pathlib import Path

# 让本脚本能 import 项目根的 src/（无论从哪个工作目录 / 是否安装）
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from src.weather_backend import get_weather  # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        prog="fincli",
        description="fincli - 天气查询 命令行工具",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    # fincli weather ...
    p_weather = sub.add_parser("weather", help="查询城市天气")
    p_weather.add_argument("--city", required=True, help="城市中文名，如 宁德")

    args = parser.parse_args()

    if args.cmd == "weather":
        print(get_weather(args.city))


if __name__ == "__main__":
    main()
