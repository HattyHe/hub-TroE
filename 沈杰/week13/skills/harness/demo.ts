/**
 * Harness Engineering 演示
 * 
 * 演示如何通过四层渐进式加载来使用 SkillHarness：
 * L0 → L1 → L2 → L3
 */

import { SkillHarness } from './src/harness.js';
import { buildExecutionPlan } from './src/executor.js';

async function main() {
  const harness = new SkillHarness();

  console.log('='.repeat(60));
  console.log('  Harness Engineering Demo');
  console.log('  渐进式加载执行 Skills');
  console.log('='.repeat(60));

  // ============ L0: 索引层 ============
  console.log('\n【L0】加载索引（只读 frontmatter，轻量）\n');
  const index = await harness.loadIndex();
  console.log(`发现 ${index.length} 个 skill：\n`);
  for (const s of index) {
    console.log(`  - ${s.name}${s.version ? ` v${s.version}` : ''}`);
    console.log(`    ${s.description.slice(0, 80)}...`);
    const tags: string[] = [];
    if (s.hasScripts) tags.push('scripts');
    if (s.hasData) tags.push('data');
    if (s.hasReferences) tags.push('references');
    if (tags.length) console.log(`    [${tags.join(', ')}]`);
    console.log('');
  }

  // ============ L1: 匹配层 ============
  console.log('【L1】多因子匹配\n');
  const queries = [
    'flash card for resilient',
    '给我做张 crazy 词的闪卡',
    '生成一个英语单词卡',
  ];

  for (const query of queries) {
    const matches = await harness.match(query, 3);
    console.log(`Query: "${query}"`);
    if (matches.length === 0) {
      console.log('  无匹配\n');
      continue;
    }
    for (const m of matches) {
      const { breakdown } = m;
      const details: string[] = [];
      if (breakdown.nameExact) details.push(`name:${breakdown.nameExact}`);
      if (breakdown.nameToken) details.push(`token:${breakdown.nameToken}`);
      if (breakdown.descKeyword) details.push(`kw:${breakdown.descKeyword}`);
      if (breakdown.ngram) details.push(`ngram:${breakdown.ngram}`);
      if (breakdown.trigger) details.push(`trigger:${breakdown.trigger}`);
      console.log(`  [score=${m.score}] ${m.skill.name}  (${details.join(' + ')})`);
    }
    console.log('');
  }

  // ============ L2: 加载层 ============
  console.log('【L2】按需加载完整 Skill\n');
  const skill = await harness.loadByName('flash-card');
  if (skill) {
    console.log(`Skill: ${skill.name}${skill.version ? ` v${skill.version}` : ''}`);
    console.log(`  目录: ${skill.dir}`);
    console.log(`  正文: ${skill.body.length} 字符`);
    console.log(`  引用: ${skill.references.length} 个文件`);
    console.log(`  数据: ${skill.dataFiles.length} 个文件`);
    console.log(`  脚本: ${skill.scripts.length} 个`);
    for (const script of skill.scripts) {
      const fname = script.path.split(/[\\/]/).pop();
      console.log(`    - ${fname} [${script.runtime}]`);
    }
    console.log('');
  }

  // ============ L3: 执行层 ============
  console.log('【L3】构建执行计划 + Dry-Run\n');
  const testCases = [
    { query: 'flash card', input: '给我做一张 resilient 的闪卡' },
    { query: 'flash card', input: '帮我生成 crazy 单词卡' },
  ];

  for (const tc of testCases) {
    console.log(`\n--- Test: "${tc.input}" ---`);
    const result = await harness.run(tc.query, tc.input, {
      cwd: process.cwd(),
      dryRun: true, // 只规划，不实际执行
      onStep: (step) => {
        const icon =
          step.status === 'done' ? '✅' :
          step.status === 'failed' ? '❌' :
          '⏳';
        console.log(`  ${icon} [${step.status}] ${step.kind.padEnd(8)} ${step.message}`);
      },
    });

    if (result.skill) {
      console.log(`\n  ✅ 匹配 Skill: ${result.skill.name}`);
      console.log(`  📋 计划步骤: ${result.plan?.steps.length ?? 0}`);
      console.log(`  🎬 脚本执行: ${result.result?.runResults.length ?? 0} 个`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  Demo 完成！');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});