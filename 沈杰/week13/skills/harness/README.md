# Harness Engineering

一套可对 skills 进行**渐进式加载执行**的工程框架。

## 核心理念

渐进式加载将 skill 的处理分为四层，每一层都是**可选的**——你只用需要的层级，就只触发该层的 I/O：

| 层级 | 方法 | 代价 | 说明 |
|------|------|------|------|
| **L0 索引层** | `loadIndex()` | 极低 | 扫描目录 + 读取每个 SKILL.md 的 YAML frontmatter（name/description/version） |
| **L1 匹配层** | `match(query)` | 低 | 基于多因子打分（name 精确/包含、token、关键词、n-gram、trigger）进行相关性排序 |
| **L2 加载层** | `loadSkill(entry)` | 中 | 按需读取 SKILL.md 正文 + references/ + data/ + scripts/（自动探测运行时） |
| **L3 执行层** | `run(query, input)` | 高 | 构建 `ExecutionPlan` 并逐步执行（读/写/运行脚本） |

## 工程结构

```
harness/
  cli.ts                  # CLI 入口
  demo.ts                 # 四层完整流程演示
  package.json
  src/
    types.ts              # 核心类型定义
    scanner.ts            # L0: 索引层
    matcher.ts            # L1: 匹配层
    loader.ts             # L2: 加载层
    executor.ts           # L3: 执行层
    harness.ts            # 门面类 SkillHarness
```

## 安装

```bash
cd skills/harness
npm install
```

## CLI 用法

```bash
# L0: 列出所有 skill（只读 frontmatter）
npx tsx cli.ts list
npx tsx cli.ts list --json

# L1: 匹配最相关的 skill
npx tsx cli.ts match "flash card for resilient"
npx tsx cli.ts match "画一个架构图" --top 5 --min-score 2

# L0+L2: 加载 skill 完整信息
npx tsx cli.ts show flash-card
npx tsx cli.ts show flash-card --json

# L0+L1+L2: 生成执行计划（不执行）
npx tsx cli.ts plan "flash card" --input "给我做 resilient 的闪卡"

# L0+L1+L2+L3: 完整流程
npx tsx cli.ts run "flash card" --input "给我做 resilient 的闪卡"
npx tsx cli.ts run "flash card" --input "resilient 闪卡" --dry-run
```

## 作为库使用

```typescript
import { SkillHarness } from './src/harness.js';

const harness = new SkillHarness();

// L0: 加载索引
const index = await harness.loadIndex();

// L1: 匹配 skill
const matches = await harness.match('flash card for crazy');

// L2: 加载完整 skill
const skill = await harness.loadByName('flash-card');
// skill.body, skill.references, skill.scripts...

// L3: 完整流程
const result = await harness.run(
  'flash card',                    // 匹配用的 query
  '请为 resilient 生成闪卡',       // 完整用户输入
  {
    cwd: process.cwd(),
    dryRun: true,                  // 只规划不执行
    onStep: (step) => {
      console.log(`[${step.status}] ${step.message}`);
    },
  }
);
```

## 设计要点

### 1. 运行时自动探测

根据脚本扩展名自动选择执行环境：
- `.ts/.tsx` → `bun`（可通过 `BUN_X` 环境变量指定路径）
- `.js/.mjs/.cjs` → `node`
- `.py` → `python`
- `.sh/.bash` → `bash`

### 2. 缓存友好

- `loadIndex()` 结果自动缓存
- `loadSkill()` 结果自动缓存
- `invalidate()` 可强制刷新所有缓存

### 3. 计划透明

- `buildExecutionPlan()` 生成纯声明式步骤列表
- `--dry-run` 模式只规划不执行
- `onStep` 回调实时报告每个步骤的状态

### 4. 职责分离

Harness 只负责编排调度：
- **不**生成业务内容（由模型/skill 指令决定）
- **不**创建无意义的文件（除非显式调用 `writeArtifact()`）
- **不**假设 skill 的具体实现方式

### 5. 渐进式加载的价值

```
用户请求
  │
  ▼
[L0] loadIndex()       ← 极低 I/O，毫秒级
  │
  ▼
[L1] match(query)      ← 纯内存计算
  │
  ▼ (只对 top-1 结果)
[L2] loadSkill(entry)  ← 按需读取，MB 级
  │
  ▼
[L3] run(query, input) ← 执行脚本，秒级
```

每一层都是可选的——如果只需要列出可用的 skills，就不会触发 L1-L3 的任何计算。

## 匹配算法详解

`matcher.ts` 使用五因子加权评分：

| 因子 | 权重 | 说明 |
|------|------|------|
| `nameExact` | 0-15 | skill name 精确匹配 (15) / 包含匹配 (10) |
| `nameToken` | 0-3/1 | query token 与 skill name token 匹配 |
| `descKeyword` | 0-2 | query 关键词在 description 中出现 |
| `ngram` | 0-8 | 字符 n-gram 重叠（捕捉中文短语） |
| `trigger` | 0-5 | 触发短语正则匹配（flashcard/diagram/html 等） |

总分阈值 `minScore` 默认为 1，可通过 `--min-score` 调整。

## 执行计划结构

```typescript
interface ExecutionPlan {
  skillName: string;
  steps: ExecutionStep[];
}

interface ExecutionStep {
  id: string;
  kind: 'read' | 'write' | 'run' | 'note' | 'generate';
  message: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  payload?: { ... };
  startedAt?: number;
  finishedAt?: number;
}
```

步骤类型：
- `read` —— 读取资源文件
- `write` —— 写入产物
- `run` —— 执行脚本
- `generate` —— 数据生成（由模型/skill 处理）
- `note` —— 状态标记