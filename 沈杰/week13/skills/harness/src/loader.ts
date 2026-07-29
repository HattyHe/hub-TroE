/**
 * L2 加载层 —— 按需加载完整 Skill
 * 
 * 当某个 skill 被选中后，才触发此层：
 * - 读取 SKILL.md 正文
 * - 扫描并读取 references/ 目录
 * - 扫描并读取 data/ 目录
 * - 扫描 scripts/ 并探测运行时
 * 
 * 这是 I/O 密集层，只在需要时才触发。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { parseFrontmatter } from './scanner.js';
import type {
  ResourceFile,
  Runtime,
  Skill,
  SkillIndexEntry,
  SkillScript,
} from './types.js';

// 脚本运行时映射
const RUNTIME_MAP: Record<string, Runtime> = {
  '.ts': 'bun',
  '.tsx': 'bun',
  '.js': 'node',
  '.mjs': 'node',
  '.cjs': 'node',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
};

/** 根据文件扩展名探测运行时 */
export function detectRuntime(filePath: string): Runtime {
  const ext = extname(filePath).toLowerCase();
  return RUNTIME_MAP[ext] ?? 'node';
}

/**
 * 递归收集目录下的所有文件
 */
async function collectFiles(
  baseDir: string,
  subDir: string
): Promise<ResourceFile[]> {
  const dirPath = join(baseDir, subDir);
  const entries = await readdir(dirPath).catch(() => []);
  const files: ResourceFile[] = [];

  for (const name of entries) {
    const fullPath = join(dirPath, name);
    const s = await stat(fullPath).catch(() => null);
    if (!s) continue;

    if (s.isFile()) {
      files.push({
        path: fullPath,
        relativePath: relative(baseDir, fullPath),
        size: s.size,
      });
    } else if (s.isDirectory()) {
      const nested = await collectFiles(baseDir, relative(baseDir, fullPath));
      files.push(...nested);
    }
  }

  return files;
}

/**
 * 收集 scripts 并探测运行时
 */
async function collectScripts(baseDir: string): Promise<SkillScript[]> {
  const scriptsDir = join(baseDir, 'scripts');
  const entries = await readdir(scriptsDir).catch(() => []);
  const scripts: SkillScript[] = [];

  for (const name of entries) {
    const fullPath = join(scriptsDir, name);
    const s = await stat(fullPath).catch(() => null);
    if (!s || !s.isFile()) continue;

    // 跳过 node_modules 等依赖目录
    if (name === 'node_modules' || name.startsWith('.')) continue;

    scripts.push({
      path: fullPath,
      runtime: detectRuntime(fullPath),
    });
  }

  return scripts;
}

/**
 * 加载完整 Skill（L2 主入口）
 */
export async function loadSkill(
  entry: SkillIndexEntry
): Promise<Skill> {
  const raw = await readFile(join(entry.dir, 'SKILL.md'), 'utf-8');
  const { meta, body } = parseFrontmatter(raw);

  const [references, dataFiles, scripts] = await Promise.all([
    collectFiles(entry.dir, 'references').catch(() => []),
    collectFiles(entry.dir, 'data').catch(() => []),
    collectScripts(entry.dir).catch(() => []),
  ]);

  return {
    ...meta,
    dir: entry.dir,
    body,
    references,
    dataFiles,
    scripts,
  };
}