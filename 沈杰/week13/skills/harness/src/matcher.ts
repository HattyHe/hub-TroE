/**
 * L1 匹配层 —— 多因子打分算法
 * 
 * 对用户 query 与每个 skill 的元数据做多维度相关性评估：
 * 1. skill name 精确匹配 / 包含匹配
 * 2. token 级别匹配（query token vs skill name token）
 * 3. 描述关键词匹配（query 关键词 vs skill description）
 * 4. 字符 n-gram 重叠（捕捉中英混合的模糊匹配）
 * 5. 触发短语匹配（description 中的 trigger pattern）
 */

import type { MatchResult, ScoreBreakdown, SkillIndexEntry } from './types.js';

// 停用词（中英文）
const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'with', 'and', 'or',
  'is', 'are', 'how', 'what', 'when', 'where', 'why', 'do', 'does',
  'user', 'ask', 'asks', 'request', 'please', 'help', 'me',
  '帮', '我', '请', '做', '一个', '的', '了', '给', '把', '让',
]);

// 触发短语模式：key 是模式名称，re 是正则
const TRIGGER_PATTERNS: { key: string; re: RegExp }[] = [
  { key: 'flashcard', re: /flash[\s-]?card|闪卡|单词卡|vocab|word[\s-]?card/i },
  { key: 'diagram', re: /diagram|chart|graph|画.*图|架构图|流程图|时序图|结构图/i },
  { key: 'svg', re: /\.svg|svg/i },
  { key: 'html', re: /\.html|html|网页|卡片|card/i },
  { key: 'python', re: /python|\.py/i },
  { key: 'word', re: /\b[a-z]{3,}\b/i },  // 任意 3+ 字母单词
];

// ============ 分词工具 ============

/** 将文本转小写并分词（支持中英混合） */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  // 将非字母数字/中文替换为空格
  const clean = lower.replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ');
  const tokens = clean.split(/\s+/).filter((t) => t.length > 0);
  return tokens;
}

/** 提取有效关键词（去停用词、去短词） */
function extractKeywords(text: string): Set<string> {
  const tokens = tokenize(text);
  const set = new Set<string>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    if (t.length < 2) continue;
    set.add(t);
  }
  return set;
}

/** 生成字符 n-gram（用于模糊匹配中文短语） */
function charNgrams(text: string, n = 2): Set<string> {
  const lower = text.toLowerCase();
  const clean = lower.replace(/[^a-z0-9\u4e00-\u9fff]/g, ' ');
  const grams = new Set<string>();

  // 字符级 n-gram（捕捉中文短语）
  const chars = clean.replace(/\s+/g, '');
  for (let i = 0; i <= chars.length - n; i++) {
    grams.add(chars.slice(i, i + n));
  }

  // 词级 n-gram（捕捉英文短语）
  const words = clean.split(/\s+/).filter((w) => w.length >= n);
  for (const w of words) {
    grams.add(w);
  }

  return grams;
}

// ============ 打分逻辑 ============

/**
 * 对单个 skill 进行打分
 */
export function scoreSkill(
  query: string,
  skill: SkillIndexEntry
): MatchResult {
  const q = query.trim();
  const name = skill.name.toLowerCase();
  const desc = (skill.description ?? '').toLowerCase();

  const breakdown: ScoreBreakdown = {
    nameExact: 0,
    nameToken: 0,
    descKeyword: 0,
    ngram: 0,
    trigger: 0,
  };

  // 1. Skill name 精确匹配 / 包含匹配
  if (q.toLowerCase() === name) {
    breakdown.nameExact += 15;
  }
  if (q.toLowerCase().includes(name) || name.includes(q.toLowerCase())) {
    breakdown.nameExact += 10;
  }

  // 2. Token 级别匹配
  const qTokens = tokenize(q);
  const nameTokens = tokenize(skill.name);
  for (const t of qTokens) {
    if (nameTokens.includes(t)) {
      breakdown.nameToken += 3;
    } else if (name.includes(t)) {
      breakdown.nameToken += 1;
    }
  }

  // 3. 描述关键词匹配
  const qKw = extractKeywords(q);
  for (const kw of qKw) {
    if (desc.includes(kw)) {
      breakdown.descKeyword += 2;
    }
  }

  // 4. 字符 n-gram 重叠
  const qGrams = charNgrams(q);
  const descGrams = charNgrams(desc);
  let gramHit = 0;
  for (const g of qGrams) {
    if (descGrams.has(g)) gramHit++;
  }
  breakdown.ngram = Math.min(gramHit, 8);

  // 5. 触发短语匹配
  const combinedText = `${q} ${desc}`;
  for (const t of TRIGGER_PATTERNS) {
    if (t.re.test(combinedText)) {
      breakdown.trigger += 5;
    }
  }

  const total =
    breakdown.nameExact +
    breakdown.nameToken +
    breakdown.descKeyword +
    breakdown.ngram +
    breakdown.trigger;

  return {
    skill,
    score: total,
    breakdown,
  };
}

/**
 * 对所有 skills 进行排名
 */
export function rankSkills(
  query: string,
  index: SkillIndexEntry[],
  topK = 3,
  minScore = 1
): MatchResult[] {
  const results = index.map((s) => scoreSkill(query, s));
  results.sort((a, b) => b.score - a.score);
  return results.filter((r) => r.score >= minScore).slice(0, topK);
}