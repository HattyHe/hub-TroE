/**
 * 核心类型定义 —— Harness Engineering
 * 
 * 所有层级共享的类型：索引、匹配结果、完整skill、执行计划等。
 */

// ============ L0: 索引层 ============

/** SKILL.md 的 YAML frontmatter */
export interface SkillFrontmatter {
  name: string;
  description: string;
  version?: string;
}

/** L0 索引条目：只有元数据，不含正文/资源 */
export interface SkillIndexEntry extends SkillFrontmatter {
  dir: string;       // skill 目录绝对路径
  hasScripts: boolean;
  hasReferences: boolean;
  hasData: boolean;
}

// ============ L1: 匹配层 ============

/** 匹配打分结果 */
export interface MatchResult {
  skill: SkillIndexEntry;
  score: number;           // 综合分
  breakdown: ScoreBreakdown;
}

/** 各维度打分明细（便于调试） */
export interface ScoreBreakdown {
  nameExact: number;       // skill name 精确/包含匹配
  nameToken: number;       // token 级别匹配
  descKeyword: number;     // 描述关键词匹配
  ngram: number;           // 字符 n-gram 重叠
  trigger: number;         // 触发短语匹配
}

// ============ L2: 加载层 ============

/** 脚本引用（带运行时探测） */
export interface SkillScript {
  path: string;
  runtime: Runtime;        // 自动探测
  args?: string[];
}

export type Runtime = 'bun' | 'node' | 'python' | 'bash';

/** 资源文件（references/data） */
export interface ResourceFile {
  path: string;
  relativePath: string;    // 相对于 skill 目录
  size: number;
}

/** L2 完整 Skill：包含所有资源 */
export interface Skill extends SkillFrontmatter {
  dir: string;
  body: string;            // SKILL.md 正文（不含 frontmatter）
  references: ResourceFile[];
  dataFiles: ResourceFile[];
  scripts: SkillScript[];
}

// ============ L3: 执行层 ============

/** 执行步骤类型 */
export type StepKind = 'read' | 'write' | 'run' | 'note' | 'generate';

/** 单个执行步骤 */
export interface ExecutionStep {
  id: string;
  kind: StepKind;
  message: string;
  status: StepStatus;
  payload?: StepPayload;
  startedAt?: number;
  finishedAt?: number;
}

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

export type StepPayload =
  | { path: string; size?: number }                    // read
  | { path: string; content?: string; hint?: string }   // write
  | { script: string; runtime: Runtime; args?: string[] } // run
  | { topic: string }                                   // generate
  | { text: string };                                   // note

/** 执行计划 */
export interface ExecutionPlan {
  skillName: string;
  steps: ExecutionStep[];
}

/** 执行结果 */
export interface ExecutionResult {
  plan: ExecutionPlan;
  runResults: RunResult[];
}

export interface RunResult {
  script: string;
  runtime: Runtime;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

// ============ Harness 选项 ============

export interface HarnessOptions {
  skillsDir?: string;
}

export interface ExecuteOptions {
  cwd?: string;
  dryRun?: boolean;
  onStep?: (step: ExecutionStep) => void;
  context?: Record<string, unknown>;
}