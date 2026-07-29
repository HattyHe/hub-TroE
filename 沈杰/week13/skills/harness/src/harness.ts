/**
 * SkillHarness —— 渐进式加载执行的门面类
 * 
 * 统一入口，封装 L0→L1→L2→L3 四层能力：
 * - loadIndex()  → L0
 * - match()      → L0 + L1
 * - loadSkill()  → L2
 * - run()        → L0 + L1 + L2 + L3
 * 
 * 所有方法异步安全，支持缓存与失效刷新。
 */

import { buildSkillIndex, DEFAULT_SKILLS_DIR } from './scanner.js';
import { rankSkills } from './matcher.js';
import { loadSkill } from './loader.js';
import { buildExecutionPlan, executePlan } from './executor.js';
import type {
  ExecuteOptions,
  ExecutionPlan,
  ExecutionResult,
  HarnessOptions,
  MatchResult,
  Skill,
  SkillIndexEntry,
} from './types.js';

export class SkillHarness {
  private skillsDir: string;
  private indexCache: SkillIndexEntry[] | null = null;
  private skillCache = new Map<string, Skill>();

  constructor(options: HarnessOptions = {}) {
    this.skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
  }

  // ============ L0: 索引层 ============

  /**
   * 加载 / 刷新索引（只读 frontmatter，轻量）
   * @param force 强制刷新缓存
   */
  async loadIndex(force = false): Promise<SkillIndexEntry[]> {
    if (this.indexCache && !force) {
      return this.indexCache;
    }
    this.indexCache = await buildSkillIndex(this.skillsDir);
    return this.indexCache;
  }

  /**
   * 使所有缓存失效
   */
  invalidate(): void {
    this.indexCache = null;
    this.skillCache.clear();
  }

  // ============ L1: 匹配层 ============

  /**
   * 根据用户 query 匹配最相关的 skills
   * @param query 用户查询文本
   * @param topK 返回前 K 个结果
   * @param minScore 最低分数阈值
   */
  async match(
    query: string,
    topK = 3,
    minScore = 1
  ): Promise<MatchResult[]> {
    const index = await this.loadIndex();
    return rankSkills(query, index, topK, minScore);
  }

  // ============ L2: 加载层 ============

  /**
   * 按需加载完整 Skill（含正文、references、data、scripts）
   * @param entry 索引条目
   */
  async loadSkill(entry: SkillIndexEntry): Promise<Skill> {
    const cached = this.skillCache.get(entry.dir);
    if (cached) return cached;

    const skill = await loadSkill(entry);
    this.skillCache.set(entry.dir, skill);
    return skill;
  }

  /**
   * 按名称加载 Skill
   */
  async loadByName(name: string): Promise<Skill | null> {
    const index = await this.loadIndex();
    const hit = index.find((s) => s.name === name);
    if (!hit) return null;
    return this.loadSkill(hit);
  }

  // ============ L3: 执行层 ============

  /**
   * 完整流程：匹配 → 加载 → 规划 → 执行
   * 
   * @param query 匹配用的查询（短文本，用于 L1 匹配）
   * @param userInput 完整用户输入（用于生成计划）
   * @param options 执行选项
   */
  async run(
    query: string,
    userInput: string,
    options: ExecuteOptions = {}
  ): Promise<{
    matches: MatchResult[];
    skill: Skill | null;
    plan: ExecutionPlan | null;
    result: ExecutionResult | null;
  }> {
    // L0 + L1: 匹配
    const matches = await this.match(query, 5);
    const best = matches[0];

    if (!best) {
      return {
        matches,
        skill: null,
        plan: null,
        result: null,
      };
    }

    // L2: 加载
    const skill = await this.loadSkill(best.skill);

    // L3: 规划
    const plan = buildExecutionPlan(skill, userInput);

    // L3: 执行
    const result = await executePlan(plan, skill, options);

    return { matches, skill, plan, result };
  }

  /**
   * 获取 skills 根目录
   */
  getSkillsDir(): string {
    return this.skillsDir;
  }
}