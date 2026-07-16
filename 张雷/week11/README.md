# week11 工具调用 - 天气查询（三方式对比 + 多轮循环）

## 背景
本周「工具调用」教学：让大模型"动手"调用外部工具的**三种主流方式**--Function Call / MCP / CLI--
用同一套业务（**天气查询**）实现并横向对比。天气查询支持**多轮循环**：模型可基于一次天气结果
做条件判断（如"若气温低于 20 度则查 A 城，否则查 B 城"），先查一个城市、看到结果再决定查哪个。

## 三种方式（同一份后端 × 三种封装）

| 方式 | 层次 | 工具从哪来 | 调用怎么执行 |
|------|------|-----------|-------------|
| **Function Call** | 模型能力层（意图生成） | 开发者手写 JSON Schema | 宿主直接调后端函数 |
| **MCP** | 协议标准层（接入规范） | 连接 Server 自动发现 | 跨进程 `call_tool`（stdio JSON-RPC） |
| **CLI** | 工具实现层（执行手段） | 命令行子命令 | 子进程执行，stdout 回传 |

- **方式一** `mode_function_call/run_function_call.py`：手写 `TOOLS_SCHEMA` + `TOOL_DISPATCH` 表。
- **方式二** `mode_mcp/run_mcp.py`：连 `mode_mcp/servers/weather_server.py`，`connect_all_servers` 走 建管道->握手->`list_tools` 发现->转 OpenAI schema，执行走 `session.call_tool`。
- **方式三** `mode_cli/run_cli.py`：`fincli`（`pip install -e .` 注册到 PATH）作为真实命令。`named` 模式白名单 enum（`run_cli(command, args)`），`bash` 模式沙箱执行（`run_bash(command)`，黑名单正则+命令头白名单+超时+工作目录锁定）。
- `src/weather_backend.py` - 共享业务逻辑（Open-Meteo 天气，含地名歧义处理），三方式都复用。
- `compare.py` - 同一问题集跑四路（Function Call / MCP / CLI-named / CLI-bash）横向对比。

## 关键设计：多轮循环
三个 `run_*.py` 的 `run()` 是同一骨架的循环：

```python
for round_i in range(MAX_ROUNDS):          # MAX_ROUNDS=8 安全上限
    resp = create(messages, tools)
    msg = resp.message
    if not msg.tool_calls: break           # 模型给最终答案 -> 结束
    执行本轮所有 tool_calls，回填 role=tool 结果
    # 进入下一轮，模型可基于结果继续（再调工具 / 给出最终答案）
else:                                       # 触顶：强制 tool_choice=none 收尾
    create(messages, tools, tool_choice="none")
```

- **安全上限**：`MAX_ROUNDS=8`，触顶走 `for...else` 用 `tool_choice="none"` 强制模型给出最终答案，
  并在 verbose 模式打印 `⚠ 达到最大轮次`（大声失败，不静默截断）。
- **返回字段**：`run()` 返回 `{answer, tool_calls, elapsed, rounds}`；`compare.py` 解析 `answer/tool_calls/elapsed`。

## 演示（天气）
默认问题与 `--demo` 首题是条件天气题，必然跨多轮：

> 查一下宁德现在的天气，如果宁德当前气温低于 20 度，就再查哈尔滨的天气，否则再查广州的天气。

模型须先查宁德（第 1 轮），看到气温后才能决定查哈尔滨还是广州（第 2 轮），再给结论（第 3 轮）--
数据依赖强制多轮，不会被模型并行一把梭。

```bash
export DEEPSEEK_API_KEY=sk-xxx
export DASHSCOPE_API_KEY=sk-xxx        # 备选 LLM（--provider dashscope 切 qwen-plus）

python mode_function_call/run_function_call.py            # 默认即天气循环题
python mode_function_call/run_function_call.py --demo
python mode_mcp/run_mcp.py --demo
python mode_cli/run_cli.py --mode named --demo
python mode_cli/run_cli.py --mode bash  --demo

python compare.py                      # 三方式（4 路）横向对比
```

## 验证
- `python3 -m py_compile` 三个 `run_*.py` + `compare.py` + `main.py` + `weather_server.py` 均通过。
- `test_loop.py`：桩掉 `openai`/`src.*` 后导入真实模块，用假 client 验证三条路径--
  天气多轮(3 轮/2 调用)、无工具直答(1 轮/0 调用)、触顶收尾(8 轮 + `tool_choice=none`)，**全部通过**。该脚本不联网、不发 API。
- live demo（需 API Key 且为对外调用）不在本环境跑，用户在有依赖的环境运行即可。

## 约定
- **三个 `run_*.py` 故意镜像**：结构、`DEMO_QUESTIONS`、`SYSTEM_PROMPT` 风格保持一致；改一个通常要同步另两个。
- **分层**：业务逻辑改动放 `src/`，协议层（工具从哪来、怎么执行）改动放各 `mode_*/run_*.py`，二者分离。
- **箭头字符陷阱**：源码注释里的 `->` 是单个 Unicode U+2192，`--` 常是 em dash U+2014，非 ASCII；改大段时用 ASCII 锚点或写脚本定位替换。
