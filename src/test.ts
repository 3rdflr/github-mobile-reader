/**
 * github-mobile-reader — manual smoke tests
 * Run: npx ts-node src/test.ts
 */

import {
  filterDiffLines,
  normalizeCode,
  parseDiffToLogicalFlow,
  generateReaderMarkdown,
  renderFlowTree,
} from './parser';

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const GREEN  = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED    = (s: string) => `\x1b[31m${s}\x1b[0m`;
const YELLOW = (s: string) => `\x1b[33m${s}\x1b[0m`;
const BOLD   = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM    = (s: string) => `\x1b[2m${s}\x1b[0m`;

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ${GREEN('✓')} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED('✗')} ${label}`);
    if (detail) console.log(`    ${RED('→')} ${detail}`);
    failed++;
  }
}

function section(name: string) {
  console.log(`\n${BOLD(YELLOW(`▶ ${name}`))}`);
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CHAINING_DIFF = `
diff --git a/src/utils.ts b/src/utils.ts
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,3 +1,7 @@
+const result = data
+  .map(item => item.value)
+  .filter(v => v > 10)
+  .reduce((a, b) => a + b, 0)
`;

const CONDITIONAL_DIFF = `
diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -0,0 +1,6 @@
+if (isValid) {
+  process(data)
+} else {
+  return fallback
+}
`;

const FUNCTION_DIFF = `
diff --git a/src/api.ts b/src/api.ts
--- a/src/api.ts
+++ b/src/api.ts
@@ -0,0 +1,4 @@
+const fetchUser = async (id: string) => {
+  const res = await fetch('/api/users/' + id)
+  return res.json()
+}
`;

const MIXED_DIFF = `
diff --git a/src/data.ts b/src/data.ts
--- a/src/data.ts
+++ b/src/data.ts
@@ -1,5 +1,10 @@
-const old = legacy()
+import { api } from './api'
+const users = api.getAll()
+  .filter(u => u.active)
+  .map(u => u.name)
+
+if (users.length > 0) {
+  for (let i = 0; i < users.length; i++) {
+    process(users[i])
+  }
+}
`;

const NOISE_DIFF = `
diff --git a/src/types.ts b/src/types.ts
--- a/src/types.ts
+++ b/src/types.ts
@@ -0,0 +1,5 @@
+import { Foo } from './foo'
+export type Bar = { id: string }
+interface Baz { name: string }
+console.log('debug')
+throw new Error('oops')
`;

const EMPTY_DIFF = `
diff --git a/src/style.css b/src/style.css
--- a/src/style.css
+++ b/src/style.css
@@ -0,0 +1,2 @@
+.container { display: flex; }
+.item { color: red; }
`;

// ─── Test Suite 1: filterDiffLines ───────────────────────────────────────────

section('filterDiffLines');

const { added: chainAdded, removed: chainRemoved } = filterDiffLines(CHAINING_DIFF);
assert(
  'extracts added lines (+ prefix)',
  chainAdded.length === 4,
  `expected 4 added lines, got ${chainAdded.length}: ${JSON.stringify(chainAdded)}`
);
assert(
  'skips +++ file header',
  chainAdded.every(l => !l.startsWith('+')),
  'a line still starts with +'
);
assert(
  'removed lines empty when no - lines in diff',
  chainRemoved.length === 0,
  `expected 0 removed lines, got ${chainRemoved.length}`
);

const { removed: mixedRemoved } = filterDiffLines(MIXED_DIFF);
assert(
  'detects removed lines (- prefix)',
  mixedRemoved.length === 1,
  `expected 1 removed line, got ${mixedRemoved.length}: ${JSON.stringify(mixedRemoved)}`
);
assert(
  'removed line content is correct',
  mixedRemoved[0].includes('legacy()'),
  `expected "legacy()" in removed, got: ${mixedRemoved[0]}`
);

// ─── Test Suite 2: normalizeCode ─────────────────────────────────────────────

section('normalizeCode');

const rawLines = [
  'const x = foo();  // trailing comment',
  'const y = bar();',
  '  ',
  '.map(i => i.val); /* inline comment */',
];
const normalized = normalizeCode(rawLines);

assert(
  'removes trailing semicolons',
  !normalized.some(l => l.endsWith(';')),
  `found semicolons in: ${JSON.stringify(normalized)}`
);
assert(
  'removes // inline comments',
  !normalized.some(l => l.includes('//')),
  `found // in: ${JSON.stringify(normalized)}`
);
assert(
  'removes /* */ block comments',
  !normalized.some(l => l.includes('/*')),
  `found /* in: ${JSON.stringify(normalized)}`
);
assert(
  'filters out empty/whitespace-only lines',
  !normalized.some(l => l.trim() === ''),
  `found empty line in: ${JSON.stringify(normalized)}`
);

// ─── Test Suite 3: parseDiffToLogicalFlow — chaining ─────────────────────────

section('parseDiffToLogicalFlow — method chaining');

const chainResult = parseDiffToLogicalFlow(CHAINING_DIFF);

assert(
  'produces at least one root node',
  chainResult.root.length > 0,
  `root is empty`
);
assert(
  'root node is "data" (right-hand side of assignment)',
  chainResult.root[0]?.name === 'data',
  `expected "data", got "${chainResult.root[0]?.name}"`
);
assert(
  'root has children (chain nodes)',
  chainResult.root[0]?.children.length > 0,
  'no children on root node'
);
assert(
  'rawCode contains the added lines',
  chainResult.rawCode.includes('data'),
  `rawCode missing "data": ${chainResult.rawCode.slice(0, 80)}`
);

// ─── Test Suite 4: parseDiffToLogicalFlow — conditionals ─────────────────────

section('parseDiffToLogicalFlow — conditionals');

const condResult = parseDiffToLogicalFlow(CONDITIONAL_DIFF);

assert(
  'detects if-block as root node',
  condResult.root.some(n => n.type === 'condition'),
  `no condition node found. nodes: ${JSON.stringify(condResult.root.map(n => n.type))}`
);
assert(
  'condition name contains "if"',
  condResult.root.some(n => n.name.startsWith('if')),
  `condition name: ${condResult.root[0]?.name}`
);

// ─── Test Suite 5: parseDiffToLogicalFlow — function declaration ──────────────

section('parseDiffToLogicalFlow — function declaration');

const funcResult = parseDiffToLogicalFlow(FUNCTION_DIFF);

assert(
  'detects function node',
  funcResult.root.some(n => n.type === 'function'),
  `no function node. types: ${JSON.stringify(funcResult.root.map(n => n.type))}`
);
assert(
  'function name includes "fetchUser"',
  funcResult.root.some(n => n.name.includes('fetchUser')),
  `function names: ${JSON.stringify(funcResult.root.map(n => n.name))}`
);

// ─── Test Suite 6: noise filtering ───────────────────────────────────────────

section('noise filtering (import / export / type / interface / console / throw)');

const noiseResult = parseDiffToLogicalFlow(NOISE_DIFF);

assert(
  'pure-noise diff produces empty root (nothing to show)',
  noiseResult.root.length === 0,
  `expected 0 root nodes, got ${noiseResult.root.length}: ${JSON.stringify(noiseResult.root.map(n => n.name))}`
);
// rawCode preserves all added lines verbatim (including noise) so the
// "Actual Code" section in the output shows the real diff unchanged.
assert(
  'rawCode contains the original added lines (noise preserved for display)',
  noiseResult.rawCode.includes('import') && noiseResult.rawCode.includes('interface'),
  `rawCode: ${noiseResult.rawCode.slice(0, 80)}`
);

// ─── Test Suite 7: non-JS diff (CSS) ─────────────────────────────────────────

section('non-JS diff input (CSS — graceful degradation)');

const cssResult = parseDiffToLogicalFlow(EMPTY_DIFF);

assert(
  'does not throw on non-JS input',
  true  // reaching here means no throw
);
assert(
  'produces empty root for unrecognised syntax',
  cssResult.root.length === 0,
  `expected 0 root nodes, got ${cssResult.root.length}`
);

// ─── Test Suite 8: renderFlowTree ────────────────────────────────────────────

section('renderFlowTree');

const treeLines = renderFlowTree(chainResult.root);

assert(
  'returns at least one line',
  treeLines.length > 0,
  'renderFlowTree returned empty array'
);
assert(
  'first line is the root identifier (no indent)',
  !treeLines[0].startsWith(' '),
  `first line has unexpected indent: "${treeLines[0]}"`
);
assert(
  'child lines contain └─ connector',
  treeLines.slice(1).some(l => l.includes('└─')),
  `no └─ found in child lines: ${JSON.stringify(treeLines)}`
);

// ─── Test Suite 9: generateReaderMarkdown ────────────────────────────────────

section('generateReaderMarkdown — function diff output');

const md = generateReaderMarkdown(CHAINING_DIFF, {
  pr: '42',
  commit: 'abc1234',
  file: 'src/utils.ts',
  repo: '3rdflr/github-mobile-reader',
});

assert(
  'contains auto-generated footer',
  md.includes('Auto-generated'),
  'footer missing'
);
assert(
  'does not contain old Logical Flow section',
  !md.includes('🧠 Logical Flow'),
  'old Logical Flow section still present — should be removed'
);
assert(
  'does not contain old Added Code section header',
  !md.includes('✅ Added Code'),
  'old Added Code section still present — should be removed'
);
assert(
  'does not throw or return empty string',
  md.length > 0,
  'output is empty'
);

// ─── Test Suite 10: generateReaderMarkdown — new symbol-based format ──────────

section('generateReaderMarkdown — symbol sections');

const SYMBOL_DIFF = `
diff --git a/src/user.ts b/src/user.ts
--- a/src/user.ts
+++ b/src/user.ts
@@ -0,0 +1,8 @@ function UserProfile
+async function fetchUser(id: string) {
+  const res = await fetch('/api/users/' + id)
+  return res.json()
+}
+
+function deleteUser(id: string) {
+  if (!id) return
+}
`;

const mdSym = generateReaderMarkdown(SYMBOL_DIFF, { file: 'src/user.ts' });

assert(
  'detects newly added function',
  mdSym.includes('추가') && mdSym.includes('fetchUser'),
  `expected 추가 + fetchUser in output: "${mdSym.slice(0, 200)}"`
);
assert(
  'detects async call in behavior',
  mdSym.includes('비동기 호출') || mdSym.includes('fetch'),
  'async behavior not detected'
);
assert(
  'detects condition in deleteUser',
  mdSym.includes('조건') || mdSym.includes('!id'),
  'condition not detected in deleteUser'
);

// ─── Test Suite 11: generateReaderMarkdown — removed lines ───────────────────

section('generateReaderMarkdown — removed lines tracked');

const REMOVE_DIFF = `
diff --git a/src/data.ts b/src/data.ts
--- a/src/data.ts
+++ b/src/data.ts
@@ -1,5 +1,5 @@ function processData
-const [count, setCount] = useState(0)
+const [total, setTotal] = useState(0)
+const result = compute()
`;

const mdRemove = generateReaderMarkdown(REMOVE_DIFF, { file: 'src/data.ts' });

assert(
  'output contains footer',
  mdRemove.includes('Auto-generated'),
  'footer missing'
);
assert(
  'removed state detected',
  mdRemove.includes('count') || mdRemove.includes('state 제거'),
  'removed state not surfaced'
);
assert(
  'added state detected',
  mdRemove.includes('total') || mdRemove.includes('state 추가'),
  'added state not surfaced'
);

// ─── Summary ─────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log(`\n${'─'.repeat(50)}`);
console.log(BOLD(`Results: ${GREEN(`${passed} passed`)}  ${failed > 0 ? RED(`${failed} failed`) : DIM('0 failed')}  / ${total} total`));

if (failed > 0) {
  console.log(RED('\nSome tests failed. Check output above.'));
  process.exit(1);
} else {
  console.log(GREEN('\nAll tests passed! ✓'));
}
