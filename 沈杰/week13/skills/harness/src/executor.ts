/**
 * L3 执行层 —— 构建执行计划 + 逐步执行
 * 
 * 本层职责：
 * 1. 根据 Skill 的元数据和用户输入，构建一份声明式的执行计划
 * 2. 逐步执行计划中的每一步
 * 3. 支持 dry-run 模式（只规划不执行）
 * 4. 通过回调函数报告执行进度
 * 
 * 本层**不**负责生成业务内容，只负责编排调度。
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFile } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ExecuteOptions,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  ResourceFile,
  RunResult,
  Runtime,
  Skill,
  StepKind,
} from './types.js';

// ============ Data 文件匹配 ============

/**
 * 根据用户输入匹配最相关的 data 文件
 * 
 * 策略：
 * 1. 从用户输入中提取英文单词（连续字母串）
 * 2. 与 data 文件名（不含扩展名）进行匹配
 * 3. 支持大小写不敏感
 */
function matchDataFile(
  dataFiles: ResourceFile[],
  userInput: string
): ResourceFile | null {
  if (dataFiles.length === 0) return null;

  // 从用户输入中提取所有英文单词
  const words = userInput
    .toLowerCase()
    .match(/[a-z]{2,}/g) ?? [];

  if (words.length === 0) return dataFiles[0] ?? null;

  // 按文件名（不含扩展名）匹配
  for (const word of words) {
    const hit = dataFiles.find((f) => {
      const base = f.relativePath.toLowerCase().replace(/\.json$/, '');
      return base === word || base.includes(word);
    });
    if (hit) return hit;
  }

  // 回退：返回第一个 data 文件
  return dataFiles[0] ?? null;
}

// ============ 计划构建 ============

let stepIdCounter = 0;
function nextStepId(): string {
  return `step_${++stepIdCounter}`;
}

/**
 * 构建执行计划（纯函数，无副作用）
 */
export function buildExecutionPlan(
  skill: Skill,
  userInput: string
): ExecutionPlan {
  const steps: ExecutionStep[] = [];

  // Step 0: 任务识别
  steps.push({
    id: nextStepId(),
    kind: 'note',
    status: 'pending',
    message: `识别 Skill「${skill.name}」v${skill.version ?? '?'} 处理请求`,
    payload: { text: userInput },
  });

  // Step 1: 读取 SKILL.md 正文
  steps.push({
    id: nextStepId(),
    kind: 'read',
    status: 'pending',
    message: `加载 ${skill.name} 指令文档`,
    payload: {
      path: skill.dir,
      size: skill.body.length,
    },
  });

  // Step 2: 列出 references（如果有）
  if (skill.references.length > 0) {
    for (const ref of skill.references) {
      steps.push({
        id: nextStepId(),
        kind: 'read',
        status: 'pending',
        message: `读取参考资源: ${ref.relativePath}`,
        payload: { path: ref.path, size: ref.size },
      });
    }
  }

  // Step 3: 列出现有 data 文件
  if (skill.dataFiles.length > 0) {
    steps.push({
      id: nextStepId(),
      kind: 'note',
      status: 'pending',
      message: `检查现有数据文件（${skill.dataFiles.length} 个）`,
      payload: { text: skill.dataFiles.map((f) => f.relativePath).join(', ') },
    });
  }

  // Step 4: 数据生成步骤（由 skill 指令决定具体内容）
  steps.push({
    id: nextStepId(),
    kind: 'generate',
    status: 'pending',
    message: `根据 ${skill.name} 指令生成/准备数据`,
    payload: { topic: userInput },
  });

  // Step 5: 写出产物
  steps.push({
    id: nextStepId(),
    kind: 'write',
    status: 'pending',
    message: '将生成的产物写入目标位置',
    payload: { path: skill.dir, hint: '输出路径由 skill 指令决定' },
  });

  // Step 6: 运行脚本（自动关联 data 文件作为参数）
  if (skill.scripts.length > 0) {
    const matchedDataFile = matchDataFile(skill.dataFiles, userInput);
    for (const script of skill.scripts) {
      const scriptArgs: string[] = [];
      if (matchedDataFile) {
        scriptArgs.push(matchedDataFile.path);
      }
      steps.push({
        id: nextStepId(),
        kind: 'run',
        status: 'pending',
        message: `执行脚本: ${script.path.split(/[\\/]/).pop()} (${script.runtime})${matchedDataFile ? ` ← ${matchedDataFile.relativePath}` : ''}`,
        payload: {
          script: script.path,
          runtime: script.runtime,
          args: scriptArgs,
        },
      });
    }
  }

  // Step 7: 完成
  steps.push({
    id: nextStepId(),
    kind: 'note',
    status: 'pending',
    message: '执行完成，产物已就绪',
  });

  return {
    skillName: skill.name,
    steps,
  };
}

// ============ 计划执行 ============

/**
 * 选择运行时命令
 */
function resolveRuntimeCommand(runtime: Runtime): string {
  switch (runtime) {
    case 'bun':
      return process.env.BUN_X ?? 'bun';
    case 'python':
      return 'python';
    case 'bash':
      return process.platform === 'win32' ? 'cmd' : 'bash';
    case 'node':
    default:
      return 'node';
  }
}

/**
 * 执行单个脚本
 */
export function runScript(
  scriptPath: string,
  runtime: Runtime,
  args: string[] = [],
  cwd: string = process.cwd()
): Promise<RunResult> {
  return new Promise((resolve) => {
    const cmd = resolveRuntimeCommand(runtime);
    const spawnArgs = [scriptPath, ...args];
    const start = Date.now();
    let stdout = '';
    let stderr = '';

    const child: ChildProcess = spawn(cmd, spawnArgs, { cwd, shell: false });

    child.stdout?.on('data', (d) => {
      stdout += String(d);
    });

    child.stderr?.on('data', (d) => {
      stderr += String(d);
    });

    child.on('close', (code) => {
      resolve({
        script: scriptPath,
        runtime,
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      resolve({
        script: scriptPath,
        runtime,
        exitCode: -1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - start,
      });
    });
  });
}

/**
 * 执行完整计划
 */
export async function executePlan(
  plan: ExecutionPlan,
  skill: Skill,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const cwd = options.cwd ?? process.cwd();
  const runResults: RunResult[] = [];

  for (const step of plan.steps) {
    step.status = 'running';
    step.startedAt = Date.now();
    options.onStep?.(step);

    try {
      switch (step.kind) {
        case 'run': {
          if (!options.dryRun && step.payload) {
            const { script, runtime, args } = step.payload as {
              script: string;
              runtime: Runtime;
              args?: string[];
            };
            const scriptArgs = args ?? [];
            const result = await runScript(script, runtime, scriptArgs, cwd);
            runResults.push(result);
            step.payload = { ...step.payload, result };
          }
          break;
        }

        case 'write': {
          if (!options.dryRun) {
            // 确保输出目录存在（harness 不生成内容，只做基础设施）
            if (step.payload && typeof step.payload === 'object') {
              const { path } = step.payload as { path?: string };
              if (path) {
                // 不创建目录也不写文件，留给 skill 自行处理
                // harness 只做最小化的基础设施支持
              }
            }
          }
          break;
        }

        case 'read':
        case 'generate':
        case 'note':
        default:
          // 这些步骤由模型/skill 自行处理，harness 只追踪状态
          break;
      }

      step.status = 'done';
    } catch (err) {
      step.status = 'failed';
      step.payload = {
        ...step.payload,
        error: (err as Error).message,
      };
    }

    step.finishedAt = Date.now();
    options.onStep?.(step);
  }

  return { plan, runResults };
}

// ============ 辅助函数 ============

/** 确保目录存在 */
export function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

/** 写入产物 */
export async function writeArtifact(
  outputPath: string,
  content: string
): Promise<void> {
  ensureDir(dirname(outputPath));
  await writeFile(outputPath, content, 'utf-8');
}

export type { StepKind };