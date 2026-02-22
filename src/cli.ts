#!/usr/bin/env node
/**
 * github-mobile-reader CLI
 *
 * Usage:
 *   npx github-mobile-reader --repo owner/repo --pr 123
 *   npx github-mobile-reader --repo owner/repo --all
 *   npx github-mobile-reader --repo owner/repo --pr 123 --token ghp_xxxx
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateReaderMarkdown } from './parser';
import { summarizeWithGemini } from './gemini';

// ── CLI argument parser ────────────────────────────────────────────────────────

function parseArgs(): {
  repo: string;
  pr?: number;
  all: boolean;
  token?: string;
  out: string;
  limit: number;
  geminiKey?: string;
} {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const repo = get('--repo');
  if (!repo) {
    console.error('Error: --repo <owner/repo> is required');
    console.error('');
    console.error('Examples:');
    console.error('  npx github-mobile-reader --repo 3rdflr/-FE- --pr 5');
    console.error('  npx github-mobile-reader --repo 3rdflr/-FE- --all');
    process.exit(1);
  }

  // Validate repo format (must be owner/repo with no path traversal)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-]+$/.test(repo)) {
    console.error('Error: --repo must be in "owner/repo" format (e.g. "3rdflr/my-app")');
    process.exit(1);
  }

  const rawOut = get('--out') ?? './reader-output';
  // Prevent absolute paths and path traversal in --out
  if (path.isAbsolute(rawOut) || rawOut.includes('..')) {
    console.error('Error: --out must be a relative path without ".." (e.g. "./reader-output")');
    process.exit(1);
  }

  if (args.includes('--token')) {
    console.error('Error: --token flag is not supported for security reasons.');
    console.error('       Set the GITHUB_TOKEN environment variable instead:');
    console.error('       export GITHUB_TOKEN=ghp_xxxx');
    process.exit(1);
  }

  return {
    repo,
    pr: get('--pr') ? Number(get('--pr')) : undefined,
    all: args.includes('--all'),
    token: process.env.GITHUB_TOKEN,
    out: rawOut,
    limit: Number(get('--limit') ?? '10'),
    // AI summary: --gemini-key flag or GEMINI_API_KEY env var
    geminiKey: get('--gemini-key') ?? process.env.GEMINI_API_KEY,
  };
}

// ── GitHub API helpers ─────────────────────────────────────────────────────────

async function githubFetch(url: string, token?: string, accept = 'application/vnd.github+json') {
  const headers: Record<string, string> = { Accept: accept };
  if (token) headers['Authorization'] = `token ${token}`;

  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    if (resp.status === 404) throw new Error(`Not found: ${url}`);
    if (resp.status === 401) throw new Error('Authentication failed. Set the GITHUB_TOKEN environment variable.');
    if (resp.status === 403) throw new Error('Rate limit or permission error. Set GITHUB_TOKEN for higher rate limits.');
    // Avoid echoing raw API response body — it may contain sensitive request metadata
    throw new Error(`GitHub API error (status ${resp.status})`);
  }
  return resp;
}

async function getPRList(repo: string, token?: string, limit = 10): Promise<{ number: number; title: string }[]> {
  const url = `https://api.github.com/repos/${repo}/pulls?state=all&per_page=${limit}&sort=updated&direction=desc`;
  const resp = await githubFetch(url, token);
  const data = await resp.json() as Array<{ number: number; title: string }>;
  return data.map(pr => ({ number: pr.number, title: pr.title }));
}

async function getPRMeta(repo: string, prNumber: number, token?: string): Promise<{ title: string; head: string }> {
  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
  const resp = await githubFetch(url, token);
  const data = await resp.json() as { title: string; head: { sha: string } };
  return { title: data.title, head: data.head.sha.slice(0, 7) };
}

// ── Diff splitting ─────────────────────────────────────────────────────────────

const JS_TS_EXT = /\.(js|jsx|ts|tsx|mjs|cjs)$/;

interface FileDiff {
  filename: string;
  diff: string;
}

async function getPRFileDiffs(repo: string, prNumber: number, token?: string): Promise<FileDiff[]> {
  const url = `https://api.github.com/repos/${repo}/pulls/${prNumber}`;
  const resp = await githubFetch(url, token, 'application/vnd.github.v3.diff');
  const rawDiff = await resp.text();

  // diff를 파일별로 분리
  const chunks = rawDiff.split(/(?=^diff --git )/m).filter(Boolean);

  return chunks
    .map(chunk => {
      const match = chunk.match(/^diff --git a\/(.+?) b\//m);
      return match ? { filename: match[1], diff: chunk } : null;
    })
    .filter((item): item is FileDiff => item !== null && JS_TS_EXT.test(item.filename));
}

// ── Core: process one PR ───────────────────────────────────────────────────────

async function processPR(
  repo: string,
  prNumber: number,
  outDir: string,
  token?: string,
  geminiKey?: string,
): Promise<string> {
  process.stdout.write(`  Fetching PR #${prNumber}...`);

  const [fileDiffs, meta] = await Promise.all([
    getPRFileDiffs(repo, prNumber, token),
    getPRMeta(repo, prNumber, token),
  ]);

  if (fileDiffs.length === 0) {
    console.log(` — JS/TS 변경 없음 (스킵)`);
    return '';
  }

  // 파일별로 섹션 생성
  const sections: string[] = [];

  sections.push(`# 📖 PR #${prNumber} — ${meta.title}\n`);
  sections.push(`> Repository: ${repo}  `);
  sections.push(`> Commit: \`${meta.head}\`  `);
  sections.push(`> 변경된 JS/TS 파일: ${fileDiffs.length}개\n`);
  sections.push('---\n');

  for (const { filename, diff } of fileDiffs) {
    const section = generateReaderMarkdown(diff, {
      pr: String(prNumber),
      commit: meta.head,
      file: filename,
      repo,
    });

    // Footer 줄 제거 후 내용 확인
    const body = section
      .replace(/^---\n/m, '')
      .replace(/^🛠 Auto-generated.*\n?/m, '')
      .replace(/^\n+/, '')
      .trimEnd();

    if (!body) continue; // 변경 요약이 없으면 파일 섹션 생략
    sections.push(`## 📄 \`${filename}\`\n`);

    // AI summary (opt-in — only when geminiKey is provided)
    if (geminiKey) {
      const summary = await summarizeWithGemini(filename, diff, geminiKey);
      if (summary) sections.push(`> 💡 ${summary}\n`);
    }

    sections.push(body);
    sections.push('\n---\n');
  }

  sections.push('🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.');

  const markdown = sections.join('\n');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `pr-${prNumber}.md`);
  fs.writeFileSync(outPath, markdown, 'utf8');

  console.log(` ✓  "${meta.title}" (${fileDiffs.length}개 파일)`);
  return outPath;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(`\n📖 github-mobile-reader CLI`);
  console.log(`   repo : ${opts.repo}`);
  console.log(`   out  : ${opts.out}`);
  if (!opts.token) {
    console.log(`   auth : none (60 req/hr limit — use GITHUB_TOKEN for more)`);
  } else {
    console.log(`   auth : token provided`);
  }
  if (opts.geminiKey) {
    console.log(`   ai   : Gemini Flash enabled\n`);
  } else {
    console.log(`   ai   : off (set GEMINI_API_KEY to enable AI summaries)\n`);
  }

  if (opts.pr) {
    const outPath = await processPR(opts.repo, opts.pr, opts.out, opts.token, opts.geminiKey);
    if (outPath) console.log(`\n✅ Done → ${outPath}\n`);
    return;
  }

  if (opts.all) {
    console.log(`  Fetching PR list (limit: ${opts.limit})...`);
    const prs = await getPRList(opts.repo, opts.token, opts.limit);

    if (prs.length === 0) {
      console.log('  No PRs found.');
      return;
    }

    console.log(`  Found ${prs.length} PR(s)\n`);

    const results: string[] = [];
    for (const pr of prs) {
      try {
        const outPath = await processPR(opts.repo, pr.number, opts.out, opts.token, opts.geminiKey);
        if (outPath) results.push(outPath);
      } catch (err) {
        console.log(` ✗  PR #${pr.number} skipped: ${(err as Error).message}`);
      }
    }

    console.log(`\n✅ Done — ${results.length} file(s) written to ${opts.out}/\n`);
    results.forEach(p => console.log(`   ${p}`));
    console.log('');
    return;
  }

  console.error('Error: specify --pr <number> or --all');
  process.exit(1);
}

main().catch(err => {
  console.error(`\n❌ ${err.message}\n`);
  process.exit(1);
});
