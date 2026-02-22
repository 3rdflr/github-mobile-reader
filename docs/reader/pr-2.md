# 📖 PR #2 — feat: CLI 추가 + JSX/Tailwind 파서 확장 + 보안 강화

> Repository: 3rdflr/github-mobile-reader  
> Commit: `18aa082`  
> 변경된 JS/TS 파일: 3개

---

## 📄 `src/cli.ts`

## 🧠 Logical Flow

```
parseArgs()
process
get()
args
get
if (!repo)
process
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-]+$/.test(repo)
process
get
if (path.isAbsolute(rawOut)
process
if (args.includes('--token')
process
githubFetch()
if (token)
await
if (!resp.ok)
if (resp.status === 404)
if (resp.status === 401)
if (resp.status === 403)
getPRList()
await
await
getPRMeta()
await
await
getPRFileDiffs()
await
await
rawDiff
chunk
 └─ filter()
processPR()
process
getPRFileDiffs()
getPRMeta()
if (fileDiffs.length === 0)
sections
sections
sections
sections
sections
loop
generateReaderMarkdown
section
 └─ replace()
 └─ replace()
 └─ replace()
 └─ replace()
 └─ replace()
 └─ replace()
sections
sections
sections
sections
sections
fs
path
fs
main()
parseArgs
if (!opts.token)
if (opts.pr)
await
if (outPath)
if (opts.all)
await
if (prs.length === 0)
loop
await
if (outPath)
results
process
main()
process
```

## ✅ Added Code

```typescript
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
// ── CLI argument parser ────────────────────────────────────────────────────────
function parseArgs(): {
  repo: string;
  pr?: number;
  all: boolean;
  token?: string;
  out: string;
  limit: number;
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
async function processPR(repo: string, prNumber: number, outDir: string, token?: string): Promise<string> {
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
    // generateReaderMarkdown의 헤더(# 📖 ...) 대신 파일명 헤더로 교체
    const withoutHeader = section
      .replace(/^# 📖.*\n/, '')
      .replace(/^> Generated by.*\n/m, '')
      .replace(/^> Repository:.*\n/m, '')
      .replace(/^> Pull Request:.*\n/m, '')
      .replace(/^> Commit:.*\n/m, '')
      .replace(/^> File:.*\n/m, '')
      .replace(/^\n+/, '');
    sections.push(`## 📄 \`${filename}\`\n`);
    sections.push(withoutHeader);
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
    console.log(`   auth : none (60 req/hr limit — use --token or GITHUB_TOKEN for more)\n`);
  } else {
    console.log(`   auth : token provided\n`);
  }
  if (opts.pr) {
    const outPath = await processPR(opts.repo, opts.pr, opts.out, opts.token);
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
        const outPath = await processPR(opts.repo, pr.number, opts.out, opts.token);
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
```

---
🛠 Auto-generated by [github-mobile-reader](https://github.com/your-org/github-mobile-reader). Do not edit manually.

---

## 📄 `src/index.ts`

## ✅ Added Code

```typescript
  // JSX/Tailwind
  isJSXFile,
  hasJSXContent,
  isClassNameOnlyLine,
  extractClassName,
  parseClassNameChanges,
  renderStyleChanges,
  isJSXElement,
  extractJSXComponentName,
  parseJSXToFlowTree,
  ClassNameChange,
```

---
🛠 Auto-generated by [github-mobile-reader](https://github.com/your-org/github-mobile-reader). Do not edit manually.

---

## 📄 `src/parser.ts`

## 🧠 Logical Flow

```
line
if (staticMatch)
line
if (ternaryMatch)
line
if (templateMatch)
templateMatch
raw
line
if (tagMatch)
new
loop
extractClassName
extractComponentFromLine
if (!cls)
if (!componentMap.has(comp)
cls
loop
extractClassName
extractComponentFromLine
if (!cls)
if (!componentMap.has(comp)
cls
loop
if (pureAdded.length === 0 && pureRemoved.length === 0)
changes
loop
lines
if (change.added.length > 0)
if (change.removed.length > 0)
line
line
trimmed
if (closingMatch)
trimmed
if (!nameMatch)
nameMatch
loop
eventProps
line
isClassNameOnlyLine()
loop
if (!isJSXElement(line)
if (shouldIgnoreJSX(line)
getIndentDepth
if (isJSXClosing(line)
loop
stack
extractJSXComponentName
isJSXSelfClosing
loop
stack
if (stack.length === 0)
roots
if (!selfClosing)
stack
Boolean
isJSX
normalizeCode
parseToFlowTree
addedForFlow
isJSX
removedForCode
isJSX
isJSX
isJSX
if (flowTree.length > 0)
sections
sections
if (isJSX && jsxTree.length > 0)
sections
sections
sections
if (isJSX && classNameChanges.length > 0)
sections
sections
sections
if (rawCode.trim()
sections
sections
if (removedCode.trim()
sections
sections
```

## 💅 Style Changes

**unknown**
  + flex  items-center  gap-2  ([^  bg-gray-900  bg-white  a  b

## ✅ Added Code

```tsx
export interface ClassNameChange {
  component: string;
  added: string[];
  removed: string[];
}
// ── JSX / Tailwind helpers ─────────────────────────────────────────────────────
export function isJSXFile(filename: string): boolean {
  return /\.(jsx|tsx)$/.test(filename);
}
export function hasJSXContent(lines: string[]): boolean {
  return lines.some(l => /<[A-Z][A-Za-z]*[\s/>]/.test(l) || /return\s*\(/.test(l));
}
export function isClassNameOnlyLine(line: string): boolean {
  return /^className=/.test(line.trim());
}
export function extractClassName(line: string): string | null {
  // Static: className="flex items-center gap-2"
  const staticMatch = line.match(/className="([^"]*)"/);
  if (staticMatch) return staticMatch[1];
  // Ternary: className={isDark ? "bg-gray-900" : "bg-white"}
  const ternaryMatch = line.match(/className=\{[^?]+\?\s*"([^"]*)"\s*:\s*"([^"]*)"\}/);
  if (ternaryMatch) return `${ternaryMatch[1]} ${ternaryMatch[2]}`;
  // Template literal: className={`base ${condition ? "a" : "b"}`}
  const templateMatch = line.match(/className=\{`([^`]*)`\}/);
  if (templateMatch) {
    const raw = templateMatch[1];
    const literals = raw.replace(/\$\{[^}]*\}/g, ' ').trim();
    const exprStrings = [...raw.matchAll(/"([^"]*)"/g)].map(m => m[1]);
    return [literals, ...exprStrings].filter(Boolean).join(' ');
  }
  return null;
}
export function extractComponentFromLine(line: string): string {
  const tagMatch = line.match(/<([A-Za-z][A-Za-z0-9.]*)/);
  if (tagMatch) return tagMatch[1];
  return 'unknown';
}
export function parseClassNameChanges(
  addedLines: string[],
  removedLines: string[]
): ClassNameChange[] {
  const componentMap = new Map<string, { added: Set<string>; removed: Set<string> }>();
  for (const line of addedLines.filter(l => /className=/.test(l))) {
    const cls = extractClassName(line);
    const comp = extractComponentFromLine(line);
    if (!cls) continue;
    if (!componentMap.has(comp)) componentMap.set(comp, { added: new Set(), removed: new Set() });
    cls.split(/\s+/).filter(Boolean).forEach(c => componentMap.get(comp)!.added.add(c));
  }
  for (const line of removedLines.filter(l => /className=/.test(l))) {
    const cls = extractClassName(line);
    const comp = extractComponentFromLine(line);
    if (!cls) continue;
    if (!componentMap.has(comp)) componentMap.set(comp, { added: new Set(), removed: new Set() });
    cls.split(/\s+/).filter(Boolean).forEach(c => componentMap.get(comp)!.removed.add(c));
  }
  const changes: ClassNameChange[] = [];
  for (const [comp, { added, removed }] of componentMap) {
    const pureAdded = [...added].filter(c => !removed.has(c));
    const pureRemoved = [...removed].filter(c => !added.has(c));
    if (pureAdded.length === 0 && pureRemoved.length === 0) continue;
    changes.push({ component: comp, added: pureAdded, removed: pureRemoved });
  }
  return changes;
}
export function renderStyleChanges(changes: ClassNameChange[]): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    lines.push(`**${change.component}**`);
    if (change.added.length > 0) lines.push(`  + ${change.added.join('  ')}`);
    if (change.removed.length > 0) lines.push(`  - ${change.removed.join('  ')}`);
  }
  return lines;
}
// ── JSX Structure helpers ──────────────────────────────────────────────────────
export function isJSXElement(line: string): boolean {
  const t = line.trim();
  return /^<[A-Za-z]/.test(t) || /^<\/[A-Za-z]/.test(t);
}
export function isJSXClosing(line: string): boolean {
  return /^<\/[A-Za-z]/.test(line.trim());
}
export function isJSXSelfClosing(line: string): boolean {
  return /\/>[\s]*$/.test(line.trim());
}
export function extractJSXComponentName(line: string): string {
  const trimmed = line.trim();
  const closingMatch = trimmed.match(/^<\/([A-Za-z][A-Za-z0-9.]*)/);
  if (closingMatch) return `/${closingMatch[1]}`;
  const nameMatch = trimmed.match(/^<([A-Za-z][A-Za-z0-9.]*)/);
  if (!nameMatch) return trimmed;
  const name = nameMatch[1];
  // Collect event handler props (onClick, onChange, etc.)
  const eventProps: string[] = [];
  for (const m of trimmed.matchAll(/\b(on[A-Z]\w+)=/g)) {
    eventProps.push(m[1]);
  }
  return eventProps.length > 0 ? `${name}(${eventProps.join(', ')})` : name;
}
export function shouldIgnoreJSX(line: string): boolean {
  const t = line.trim();
  return (
    isClassNameOnlyLine(t) ||
    /^style=/.test(t) ||
    /^aria-/.test(t) ||
    /^data-/.test(t) ||
    /^strokeLinecap=/.test(t) ||
    /^strokeLinejoin=/.test(t) ||
    /^strokeWidth=/.test(t) ||
    /^viewBox=/.test(t) ||
    /^fill=/.test(t) ||
    /^stroke=/.test(t) ||
    /^d="/.test(t) ||
    t === '{' || t === '}' ||
    t === '(' || t === ')' ||
    t === '<>' || t === '</>' ||
    /^\{\/\*/.test(t)
  );
}
export function parseJSXToFlowTree(lines: string[]): FlowNode[] {
  const roots: FlowNode[] = [];
  const stack: Array<{ node: FlowNode; depth: number }> = [];
  for (const line of lines) {
    if (!isJSXElement(line)) continue;
    if (shouldIgnoreJSX(line)) continue;
    const depth = getIndentDepth(line);
    if (isJSXClosing(line)) {
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
        stack.pop();
      }
      continue;
    }
    const name = extractJSXComponentName(line);
    const selfClosing = isJSXSelfClosing(line);
    const node: FlowNode = {
      type: 'call',
      name,
      children: [],
      depth,
      priority: Priority.OTHER,
    };
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    if (!selfClosing) {
      stack.push({ node, depth });
    }
  }
  return roots;
}
  const { added, removed } = filterDiffLines(diffText);
  // ── Detect JSX mode ──────────────────────────────────────
  const isJSX = Boolean(
    (meta.file && isJSXFile(meta.file)) || hasJSXContent(added)
  );
  // ── Parse logical flow (strip className lines in JSX mode) ──
  const addedForFlow = isJSX ? added.filter(l => !isClassNameOnlyLine(l)) : added;
  const normalizedAdded = normalizeCode(addedForFlow);
  const flowTree = parseToFlowTree(normalizedAdded);
  // ── Raw code (className stripped in JSX mode) ────────────
  const rawCode = addedForFlow.join('\n');
  const removedForCode = isJSX ? removed.filter(l => !isClassNameOnlyLine(l)) : removed;
  const removedCode = removedForCode.join('\n');
  // ── JSX-specific analysis ────────────────────────────────
  const classNameChanges = isJSX ? parseClassNameChanges(added, removed) : [];
  const jsxTree = isJSX ? parseJSXToFlowTree(added) : [];
  const lang = isJSX ? 'tsx' : 'typescript';
  // ── Logical Flow ─────────────────────────────────────────
  if (flowTree.length > 0) {
    sections.push(...renderFlowTree(flowTree));
    sections.push('```\n');
  }
  // ── JSX Structure (JSX only) ─────────────────────────────
  if (isJSX && jsxTree.length > 0) {
    sections.push('## 🎨 JSX Structure\n');
    sections.push('```');
    sections.push(...renderFlowTree(jsxTree));
  // ── Style Changes (JSX only) ─────────────────────────────
  if (isJSX && classNameChanges.length > 0) {
    sections.push('## 💅 Style Changes\n');
    sections.push(...renderStyleChanges(classNameChanges));
    sections.push('');
  }
  if (rawCode.trim()) {
    sections.push(`\`\`\`${lang}`);
    sections.push(rawCode);
  if (removedCode.trim()) {
    sections.push(`\`\`\`${lang}`);
    sections.push(removedCode);
```

## ❌ Removed Code

```tsx
  const result = parseDiffToLogicalFlow(diffText);
  // ── Logical Flow (added) ─────────────────────────────────
  if (result.root.length > 0) {
    sections.push(...renderFlowTree(result.root));
  if (result.rawCode.trim()) {
    sections.push('```typescript');
    sections.push(result.rawCode);
  if (result.removedCode.trim()) {
    sections.push('```typescript');
    sections.push(result.removedCode);
```

---
🛠 Auto-generated by [github-mobile-reader](https://github.com/your-org/github-mobile-reader). Do not edit manually.

---

🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.