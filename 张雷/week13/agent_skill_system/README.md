# Agent Skill System

受限 Bash 工具（白名单校验）+ Agent Skill 动态加载。week13 作业。

## 能力

- **受限 Bash**：白名单模式，仅放行许可命令；拦截命令替换 / 解释器透传 / 间接删除 / 重定向等绕过手段；Agent 层 + Bash 工具层双层校验；拦截回灌结构化 `BlockResult`。
- **Skill 动态加载**：扫描技能索引 -> LLM 选定单个 Skill -> 按需加载主体 -> LLM 自然语言提取工具 -> 动态注入 -> 经受限 Bash 执行；Skill 可临时扩展白名单（用毕回收）。

## 结构

```
src/
├── whitelist.py     # 纯函数校验：解析/归一化/拆分/严格拦截/白名单匹配（双层共用）
├── bash_tool.py     # 受限执行器：layer-2 校验 + subprocess(shell=False) + cd 状态跟踪 + 管道
├── skill_loader.py  # 索引/主体加载 + LLM 工具提取 + ToolSpec
├── agent.py         # agent loop + Skill 选择/激活/停用 + 工具动态注入/派发 + 结构化日志
├── llm_client.py    # DeepSeek/DashScope provider（复用 week12）
└── logging.py       # 结构化日志 + stderr 错误（FR-016）
skills/
├── file-overview/skill.md          # 样本技能：文件统计
└── flash-card/SKILL.md             # 单词闪卡生成技能
    ├── scripts/make_flashcard.py   #   渲染脚本：JSON → HTML
    └── data/                       #   单词 JSON 数据（集中存放，可复用）
tests/               # 纯脚本测试（python tests/test_*.py）
run_agent.py         # CLI 入口
outputs/skills/      # Skill 产物输出目录（如闪卡 HTML）
```

## 安装

```bash
conda activate py312
pip install -r requirements.txt   # openai（已装则跳过）
# 密钥在 ~/.zshrc：DEEPSEEK_API_KEY / DASHSCOPE_API_KEY
python run_agent.py --check-key   # 仅打印 set/MISSING，不回显
```

## 使用

```bash
# 基础 Bash 工具
python run_agent.py -q "列出当前目录的文件"
python run_agent.py -q "统计当前目录下有多少个文件"   # 触发 file-overview 技能

# 闪卡技能
python run_agent.py -q "给我做张 thrive 的闪卡"      # 触发 flash-card 技能 → outputs/skills/thrive.html
python run_agent.py -q "做一个 resilient 的单词卡"

# 其他
python run_agent.py --provider dashscope -q "..."
python run_agent.py --chat                          # 交互式多轮
```

## Skill 编写

放 `skills/<name>/skill.md`（或 `SKILL.md`），front-matter（`name`/`description`）+ markdown 主体（执行指令）。

工具定义推荐使用 ```` ```tools ```` 代码块（确定性解析，优先于 LLM 提取）：

````markdown
```tools
{
  "tools": [{
    "name": "my_tool",
    "description": "...",
    "parameters": {"type": "object", "properties": {...}},
    "command_template": "cmd1 {param} && cmd2 {__json__} -o {word}.html",
    "json_input": true
  }]
}
```
````

- `{param}` 标量占位符，`{__json__}` 为结构化参数临时 JSON 文件路径。
- `json_input: true` 时，系统将全部参数写入临时 JSON 文件并用 `{__json__}` 替换。
- 无 `tools` 块时，fallback 到 LLM 从自然语言提取（不稳定，不推荐）。

详见 `specs/001-bash-whitelist-skill-loader/contracts/skill-format.md`。

## 测试

```bash
python tests/test_whitelist.py        # 校验规则（纯函数，离线）
python tests/test_bash_tool.py        # 执行器：拦截无副作用 + cd/管道
python tests/test_skill_loader.py     # 索引/提取 + per-skill 契约
python tests/test_agent_integration.py # agent 全链路（mock LLM，离线）
```

## 已知简化

- `&&`/`||` 短路语义不实现，组合命令全子命令合规时顺序执行（research D2）。`&&`/`||` 的分隔解析已修复（`parse_segments` 将 `&&`/`||` 作为独立分隔符处理）。
- `|` 管道在两侧合规时以 `subprocess.Popen` 串联。
- `cd` 由执行器 stateful 跟踪 cwd（不 spawn），使 `cd dir; ls` 生效。
- skill.md front-matter 用极简解析器，未引入 pyyaml。
- Skill 工具提取优先从 `tools` 代码块确定性解析，LLM 提取仅作 fallback（避免 command_template 不稳定）。

## 安全审查（T028）

- 全处 `subprocess.run(shell=False)`，禁用 `shell=True`，无 shell 注入面。
- 双层校验：Agent 派发层 + Bash 执行器入口均调 `validate`（FR-006）。
- 临时白名单扩展不覆盖严格拦截项（替换/重定向/解释器/间接删除/find 禁用 flag），扩展期间始终拦截（FR-015）。
- `find -delete`/`-exec` 一律拦截（`FIND_FORBIDDEN_FLAG`），`truncate` 一律拦截（`INDIRECT_DELETE`）。
