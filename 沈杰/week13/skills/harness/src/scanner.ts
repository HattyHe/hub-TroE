/**
 * L0 索引层 —— 扫描 skills 目录，只读 SKILL.md 的 YAML frontmatter
 * 
 * 这是最轻量的层级：
 * - 只访问目录结构 + 解析 YAML frontmatter
 * - 不读取 SKILL.md 正文、references、data、scripts
 * - 用于快速浏览所有可用 skills
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import type {
  SkillFrontmatter,
  SkillIndexEntry,
} from './types.js';

// 默认 skills 根目录：当前文件在 skills/harness/src/，往上两层到 skills/
const HARNESS_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
export const DEFAULT_SKILLS_DIR = join(HARNESS_DIR, '..');

const SKILL_MD = 'SKILL.md';
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__']);

/**
 * 解析 SKILL.md 的 YAML frontmatter
 * 
 * SKILL.md 格式:
 * ```
 * ---
 * name: skill-name
 * description: 描述文本
 * version: 1.0.0
 * ---
 * 
 * 正文内容...
 * ```
 */
export function parseFrontmatter(raw: string): {
  meta: SkillFrontmatter;
  body: string;
} {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) {
    return {
      meta: { name: 'unknown', description: '' },
      body: raw,
    };
  }
  const parsed = yaml.parse(m[1]) ?? {};
  return {
    meta: {
      name: String(parsed.name ?? 'unknown'),
      description: String(parsed.description ?? ''),
      version: parsed.version ? String(parsed.version) : undefined,
    },
    body: m[2] ?? '',
  };
}

/**
 * 检查 skill 目录的子资源是否存在
 */
async function checkSubdirs(dir: string): Promise<{
  hasScripts: boolean;
  hasReferences: boolean;
  hasData: boolean;
}> {
  const subs = ['scripts', 'references', 'data'];
  const results = await Promise.all(
    subs.map(async (sub) => {
      try {
        const s = await stat(join(dir, sub));
        return s.isDirectory();
      } catch {
        return false;
      }
    })
  );
  return {
    hasScripts: results[0],
    hasReferences: results[1],
    hasData: results[2],
  };
}

/**
 * 列出 skills 根目录下所有包含 SKILL.md 的子目录
 */
export async function findSkillDirs(skillsDir: string): Promise<string[]> {
  const entries = await readdir(skillsDir);
  const dirs: string[] = [];

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(skillsDir, name);
    const s = await stat(full).catch(() => null);
    if (!s || !s.isDirectory()) continue;

    const skillMd = join(full, SKILL_MD);
    const mdStat = await stat(skillMd).catch(() => null);
    if (mdStat && mdStat.isFile()) {
      dirs.push(full);
    }
  }

  return dirs;
}

/**
 * 构建单个 skill 的索引条目（只读取 frontmatter）
 */
export async function buildIndexEntry(
  dir: string
): Promise<SkillIndexEntry> {
  const raw = await readFile(join(dir, SKILL_MD), 'utf-8');
  const { meta } = parseFrontmatter(raw);
  const subs = await checkSubdirs(dir);
  return {
    ...meta,
    dir,
    ...subs,
  };
}

/**
 * 构建完整索引（L0 主入口）
 */
export async function buildSkillIndex(
  skillsDir: string = DEFAULT_SKILLS_DIR
): Promise<SkillIndexEntry[]> {
  const dirs = await findSkillDirs(skillsDir);
  const entries = await Promise.all(dirs.map((d) => buildIndexEntry(d)));
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}