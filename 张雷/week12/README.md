# 拆分天气工具 + Agent Loop（含多轮对话）

把 `get_weather(city)` 内部串接的两次 HTTP 请求拆成两个对模型暴露的独立工具，用一个 **agent loop** 让模型既能链式调用、也能单工具独立作答；并在此基础上加入**多轮对话**--会话历史跨轮累积，模型可基于上文消解"那上海呢"、"明天呢"这类指代/省略。

> 本目录是 week11 `function_call_mcp_cli` 作业的延续答案。**不修改任何原始代码**，全部实现都在 `week12/` 下完成。

## 目录

- [背景与作业要求](#背景与作业要求)
- [调用形态](#调用形态)
- [多轮对话](#多轮对话)
- [目录结构](#目录结构)
- [安装依赖](#安装依赖)
- [配置环境变量](#配置环境变量)
- [运行](#运行)
- [仅测试后端工具（不调 LLM）](#仅测试后端工具不调-llm)
- [与原始代码的关系](#与原始代码的关系)
- [实现要点](#实现要点)

## 背景与作业要求

原始 `week11/src/weather_backend.py` 的 `get_weather(city)` 内部串了两次 HTTP 请求：

1. **Geocoding**：城市名 -> 经纬度
2. **Forecast**：经纬度 -> 天气

作业要把它拆成两个对模型暴露的独立工具，让模型既能链式调用、也能单工具独立答，再进一步支持多轮对话：

| 要求 | 实现 |
| --- | --- |
| 把两个接口拆成两个工具 | `geocode(city)`（城市->经纬度）+ `get_weather_by_coords(lat, lon)`（经纬度->天气） |
| 循环链式调用（agent loop） | `run_turn()` 用循环，模型可先 `geocode` 拿经纬度再 `get_weather_by_coords` 查天气 |
| 单工具独立答"某地经纬度" | 问"北京的经纬度"->模型只调 `geocode` 即可 |
| 单工具独立答"给经纬度直接查天气" | 问"经度116.4 纬度39.9 的天气"->模型只调 `get_weather_by_coords` |
| 多轮对话 | 会话历史 `messages` 跨轮累积（全量保留 tool_calls 与 tool 结果），模型可基于上文消解指代/省略；`--chat` 进 REPL，`--demo` 跑连贯对话 |
| 模型参考项目里的 deepseek 接口调用 | 复用 `week11/mode_function_call/run_function_call.py` 的 `PROVIDERS`/`build_client` 写法（OpenAI 兼容协议，`openai` SDK，默认 `deepseek-chat`） |

三种形态共用**同一个 agent loop**，差异完全由模型自己决定该调几次、调哪个--这就是 agent loop 的核心。

## 调用形态

两个工具互不依赖，模型按需选择单工具或链式（`-q` 单问或 `--chat` 多轮均可触发）：

| 问法 | 预期工具调用 | 形态 |
| --- | --- | --- |
| 宁德今天的天气怎么样？ | `geocode(宁德)` -> `get_weather_by_coords(26.66, 119.52)` | 链式（loop 多轮） |
| 北京的经纬度是多少？ | `geocode(北京)` | 单工具独立答 |
| 经度116.4、纬度39.9 这个地方天气如何？ | `get_weather_by_coords(39.9, 116.4)` | 单工具独立答 |

## 多轮对话

会话历史 `messages` 跨轮累积：上一轮的 `user` / `assistant(tool_calls)` / `tool` / 最终回答**全量保留**，下一轮模型据此消解指代与省略。每轮步数预算 `MAX_STEPS` 独立重置。指代消解完全依赖模型自身（不额外改 system prompt）。

`--demo` 用同一个会话跑一组互相引用的追问，演示上下文延续：

| 轮次 | 问题 | 预期行为 |
| --- | --- | --- |
| 1 | 宁德今天的天气怎么样？ | 链式 `geocode`->`get_weather_by_coords`，建立城市+天气上下文 |
| 2 | 那上海呢？ | 靠历史消解"那…呢"，重新 `geocode(上海)` 查天气 |
| 3 | 明天呢？ | 靠历史消解"明天"，从已返回的预报里取（通常 0 次工具调用） |

`--chat` 则进入交互式 REPL，可自由多轮追问。

## 目录结构

```text
week12/
├── weather_tools.py   # 两个拆分后的工具（业务逻辑层，纯 httpx，与 LLM 无关）
├── run_agent.py       # 工具 schema + agent loop + 多轮对话 + DeepSeek 调用入口
└── README.md          # 本文件
```

## 安装依赖

```bash
pip install openai httpx
```

> Open-Meteo 免费、无需 key；LLM 用 DeepSeek（OpenAI 兼容协议）。

## 配置环境变量

```bash
# Windows (PowerShell)
$env:DEEPSEEK_API_KEY="sk-xxx"
# Windows (cmd)
set DEEPSEEK_API_KEY=sk-xxx
# Linux / macOS
export DEEPSEEK_API_KEY=sk-xxx
```

也可切到 DashScope 的 `qwen-plus`（用 `DASHSCOPE_API_KEY`）：

```bash
$env:DASHSCOPE_API_KEY="sk-xxx"   # Windows PowerShell
python run_agent.py --provider dashscope -q "北京的经纬度"
```

## 运行

在 `week12/` 目录下执行：

```bash
# 1. 单个问题（单轮）
python run_agent.py -q "宁德今天的天气怎么样？"

# 2. 内置连贯对话（多轮，演示上下文延续与指代消解）
python run_agent.py --demo

# 3. 进入交互式多轮对话 REPL（exit/quit/Ctrl+C 退出）
python run_agent.py --chat

# 4. 切换 LLM provider
python run_agent.py --provider dashscope --demo
```

每轮会打印 `[tool step N] geocode(...)` / `↩ 结果预览`，最后给出最终回答和"本轮工具调用 N 次，循环 M 轮，耗时 Xs"的统计。

## 仅测试后端工具（不调 LLM）

```bash
python weather_tools.py
```

会跑一遍自测：先 `geocode("宁德")` 打印经纬度，再用抠出来的经纬度调 `get_weather_by_coords` 查天气，验证两个工具和链路本身没问题。

## 与原始代码的关系

- 不修改 `week11/src/`、`week11/mode_function_call/`、`week11/mode_mcp/`、`week11/mode_cli/` 任何原始文件。
- `weather_tools.py` 从 `week11/src/weather_backend.py` 提取出两个接口的逻辑，重写为两个独立函数
  （消歧策略保留，输出格式按"工具结果"重排，方便模型消费与链式传递经纬度）。
- `run_agent.py` 的 LLM 调用风格（`PROVIDERS` / `build_client` / DeepSeek OpenAI 兼容）
  参考 `week11/mode_function_call/run_function_call.py`，并把它的单轮回填升级为循环 agent loop，
  再进一步把单次 `run()` 重构为跨轮累积历史的 `run_turn()`，支持多轮对话。

## 实现要点

### `weather_tools.py`

- `geocode` 复用了原 backend 的"同名小村庄消歧"策略（裸"宁德"会命中西藏那曲的一个村，所以低级行政点且没带"市/县/区"后缀时用 `city+"市"` 重查）。
- 文末带一段 `__main__` 自测，手动演示一次"geocode -> 拿经纬度 -> get_weather_by_coords"的链式调用。

### `run_agent.py`

- `TOOLS_SCHEMA`：两个工具的 JSON Schema，`description` 写清楚"什么时候单用、什么时候链式"。
- `TOOL_DISPATCH`：工具名 -> 后端函数 的派发表（业务逻辑与协议层分离）。
- `new_session()`：新建会话历史（初始含 `SYSTEM_PROMPT`），多轮对话中 `messages` 跨轮累积。
- `run_turn(client, model, messages, question)`：**真正的 agent loop**--`for step in range(1, MAX_STEPS+1)`
  有界循环，每轮带上历史 `messages` 问模型；模型输出 `tool_calls` 就执行并回填，模型不再调工具就把最终回答
  并入历史后退出。相比原 `run_function_call.py` 的"一次 tool_call + 一次回填"**单轮**，本作业是**循环**，
  且 `messages` 跨轮累积支持多轮对话。
- `chat_repl()`：交互式多轮对话 REPL，`exit`/`quit`/Ctrl+C/EOF 均可干净退出。
- 历史保留策略：**全量保留** `assistant(tool_calls)` 与 `tool` 消息（符合 OpenAI 协议要求），不做截断。
