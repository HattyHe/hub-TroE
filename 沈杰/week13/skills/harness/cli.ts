#!/usr/bin/env node
/**
 * Harness CLI —— 渐进式加载执行 skills 的命令行入口
 * 
 * 命令层级：
 *   list    → L0  列出所有 skill（只读 frontmatter）
 *   match   → L1  匹配最相关的 skill
 *   show    → L0+L2 加载 skill 完整信息
 *   plan    → L0+L1+L2 生成执行计划（不执行）
 *   run     → L0+L1+L2+L3 完整流程
 */

import { Command } from 'commander';
import { SkillHarness } from './src/harness.js';
import { buildExecutionPlan } from './src/executor.js';
import type { ExecutionPlan, ExecutionStep, MatchResult } from './src/types.js';

const program = new Command();

program
  .name('harness')
  .description('渐进式加载执行 skills 的 Harness Engineering')
  .version('0.1.0')
  .option('-d, --skills-dir <path>', 'skills 根目录');

// ============ L0: list ============
program
  .command('list')
  .description('列出所有已发现的 skill（L0: 只读 frontmatter）')
  .option('-j, --json', '以 JSON 格式输出')
  .action(async (options) => {
    const harness = new SkillHarness({ skillsDir: options.skillsDir });
    const index = await harness.loadIndex();

    if (options.json) {
      console.log(JSON.stringify(index, null, 2));
    } else {
      console.log(`\u250c Found ${index.length} skill(s) \u2510\n`);
      for (const s of index) {
        console.log(`  \u25b8 ${s.name}${s.version ? ` v${s.version}` : ''}`);
        console.log(`    ${truncate(s.description, 100)}`);
        const tags: string[] = [];
        if (s.hasScripts) tags.push('scripts');
        if (s.hasData) tags.push('data');
        if (s.hasReferences) tags.push('references');
        if (tags.length) console.log(`    [${tags.join(', ')}]`);
        console.log('');
      }
    }
  });

// ============ L1: match ============
program
  .command('match <query>')
  .description('基于 query 匹配最相关的 skill（L0+L1）')
  .option('-k, --top <n>', '返回前 N 个结果', '3')
  .option('--min-score <n>', '最低分数阈值', '1')
  .option('-j, --json', '以 JSON 格式输出')
  .action(async (query, options) => {
    const harness = new SkillHarness({ skillsDir: options.skillsDir });
    const matches = await harness.match(
      query,
      Number(options.top),
      Number(options.minScore)
    );

    if (options.json) {
      console.log(
        JSON.stringify(
          matches.map((m) => ({
            name: m.skill.name,
            score: m.score,
            breakdown: m.breakdown,
            description: m.skill.description,
          })),
          null,
          2
        )
      );
    } else {
      if (matches.length === 0) {
        console.log('No skill matched.');
        return;
      }
      console.log(`\u250c Matched ${matches.length} skill(s) for "${query}" \u2510\n`);
      for (const m of matches) {
        printMatch(m);
      }
    }
  });

// ============ L0+L2: show ============
program
  .command('show <name>')
  .description('加载并显示 skill 完整信息（L0+L2）')
  .option('-j, --json', '以 JSON 格式输出')
  .action(async (name, options) => {
    const harness = new SkillHarness({ skillsDir: options.skillsDir });
    const skill = await harness.loadByName(name);

    if (!skill) {
      console.error(`Skill not found: ${name}`);
      process.exit(1);
    }

    if (options.json) {
      const summary = {
        name: skill.name,
        version: skill.version,
        dir: skill.dir,
        description: skill.description,
        bodyLength: skill.body.length,
        references: skill.references.map((r) => r.relativePath),
        dataFiles: skill.dataFiles.map((r) => r.relativePath),
        scripts: skill.scripts.map((s) => ({
          path: s.path,
          runtime: s.runtime,
        })),
      };
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`\u250c ${skill.name}${skill.version ? ` v${skill.version}` : ''} \u2510`);
      console.log(`  Dir: ${skill.dir}`);
      console.log(`  Body: ${skill.body.length} chars`);
      console.log('');

      if (skill.references.length) {
        console.log(`  References (${skill.references.length}):`);
        for (const r of skill.references) {
          console.log(`    \u25b8 ${r.relativePath} (${r.size} bytes)`);
        }
      }

      if (skill.dataFiles.length) {
        console.log(`  Data (${skill.dataFiles.length}):`);
        for (const d of skill.dataFiles) {
          console.log(`    \u25b8 ${d.relativePath} (${d.size} bytes)`);
        }
      }

      if (skill.scripts.length) {
        console.log(`  Scripts (${skill.scripts.length}):`);
        for (const s of skill.scripts) {
          const fname = s.path.split(/[\\/]/).pop();
          console.log(`    \u25b8 ${fname} [${s.runtime}]`);
        }
      }
      console.log('');
    }
  });

// ============ L0+L1+L2: plan ============
program
  .command('plan <query>')
  .description('匹配并生成执行计划（L0+L1+L2，不执行）')
  .option('--input <text>', '用户输入/任务描述')
  .action(async (query, options) => {
    const harness = new SkillHarness({ skillsDir: options.skillsDir });
    const matches = await harness.match(query, 5);
    const best = matches[0];

    if (!best) {
      console.log('No skill matched.');
      return;
    }

    const skill = await harness.loadSkill(best.skill);
    const userInput = options.input || query;
    const plan = buildExecutionPlan(skill, userInput);

    console.log(`\u250c Execution Plan for "${skill.name}" \u2510\n`);
    console.log(formatPlan(plan));
  });

// ============ L0+L1+L2+L3: run ============
program
  .command('run <query>')
  .description('完整流程：匹配→加载→规划→执行（L0+L1+L2+L3）')
  .option('--input <text>', '用户输入/任务描述')
  .option('--dry-run', '只规划不执行')
  .option('-j, --json', '以 JSON 格式输出')
  .action(async (query, options) => {
    const harness = new SkillHarness({ skillsDir: options.skillsDir });
    const userInput = options.input || query;

    if (!options.json) {
      console.log(`\u250c Running: "${query}" \u2510\n`);
    }

    const result = await harness.run(query, userInput, {
      cwd: process.cwd(),
      dryRun: options.dryRun,
      onStep: (step: ExecutionStep) => {
        if (!options.json) {
          const icon =
            step.status === 'done' ? '\u2705' :
            step.status === 'failed' ? '\u274c' :
            step.status === 'running' ? '\u2699\ufe0f' :
            '\u23f3';
          console.log(
            `  ${icon} [${step.status}] ${step.kind.toUpperCase().padEnd(8)} ${step.message}`
          );
        }
      },
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            matches: result.matches.map((m) => ({
              name: m.skill.name,
              score: m.score,
            })),
            skill: result.skill?.name ?? null,
            plan: result.plan,
            runResults: result.result?.runResults ?? [],
          },
          null,
          2
        )
      );
    } else {
      if (result.skill) {
        console.log(`\n\u250c Matched Skill: ${result.skill.name} \u2510\n`);
      }

      if (result.result) {
        const { runResults } = result.result;
        if (runResults.length > 0) {
          console.log('\u250c Script Results \u2510');
          for (const r of runResults) {
            const icon = r.exitCode === 0 ? '\u2705' : '\u274c';
            console.log(
              `  ${icon} ${r.script.split(/[\\/]/).pop()} [${r.runtime}] exit=${r.exitCode} (${r.durationMs}ms)`
            );
            if (r.stdout.trim()) {
              console.log(`     stdout: ${truncate(r.stdout.trim(), 200)}`);
            }
            if (r.stderr.trim()) {
              console.log(`     stderr: ${truncate(r.stderr.trim(), 200)}`);
            }
          }
        }
      }
    }
  });

// ============ 辅助函数 ============

function truncate(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length > n ? clean.slice(0, n) + '...' : clean;
}

function printMatch(m: MatchResult): void {
  const { breakdown } = m;
  console.log(`  \u25b8 [score=${m.score}] ${m.skill.name}`);
  console.log(`    ${truncate(m.skill.description, 120)}`);
  const details: string[] = [];
  if (breakdown.nameExact) details.push(`name:${breakdown.nameExact}`);
  if (breakdown.nameToken) details.push(`token:${breakdown.nameToken}`);
  if (breakdown.descKeyword) details.push(`kw:${breakdown.descKeyword}`);
  if (breakdown.ngram) details.push(`ngram:${breakdown.ngram}`);
  if (breakdown.trigger) details.push(`trigger:${breakdown.trigger}`);
  if (details.length) console.log(`    [${details.join(' + ')}]`);
  console.log('');
}

function formatPlan(plan: ExecutionPlan): string {
  const lines: string[] = [];
  lines.push(`  Plan for "${plan.skillName}" (${plan.steps.length} steps)\n`);

  for (const step of plan.steps) {
    const icon =
      step.status === 'done' ? '\u2705' :
      step.status === 'failed' ? '\u274c' :
      '\u23f3';
    lines.push(
      `  ${icon} ${step.kind.toUpperCase().padEnd(8)} ${step.message}`
    );

    if (step.payload && typeof step.payload === 'object') {
      const p = step.payload as Record<string, unknown>;
      if (p.path) {
        const fname = String(p.path).split(/[\\/]/).pop();
        lines.push(`      \u2192 path: ${fname}`);
      }
      if (p.script) {
        const fname = String(p.script).split(/[\\/]/).pop();
        lines.push(`      \u2192 script: ${fname} [${p.runtime}]`);
      }
      if (p.error) {
        lines.push(`      \u274c error: ${p.error}`);
      }
    }
  }

  return lines.join('\n');
}

// ============ 启动 ============
program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});