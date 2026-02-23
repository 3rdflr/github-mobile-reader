/**
 * github-mobile-reader - Diff to Logical Flow Parser v0.2
 *
 * Philosophy:
 * - Summarize, don't explain
 * - Be conservative when ambiguous
 * - Show less rather than show wrong
 */

// Priority system for structure detection
export enum Priority {
  CHAINING = 1,
  CONDITIONAL = 2,
  LOOP = 3,
  FUNCTION = 4,
  OTHER = 5,
}

export interface FlowNode {
  type: "root" | "chain" | "condition" | "loop" | "function" | "call";
  name: string;
  children: FlowNode[];
  depth: number;
  priority: Priority;
}

export interface ParseResult {
  root: FlowNode[];
  rawCode: string;
  removedCode: string;
}

export interface ReaderMarkdownMeta {
  pr?: string;
  commit?: string;
  file?: string;
  repo?: string;
  /** Symbol names known to have moved into this file from another file in the same PR */
  movedIntoThisFile?: Set<string>;
  /** Map of symbol name → destination filename for symbols moved out of this file */
  movedOutMap?: Map<string, string>;
}

export interface ClassNameChange {
  component: string;
  added: string[];
  removed: string[];
}

export type SymbolKind =
  | "component"   // PascalCase React component
  | "function"    // regular function / async function
  | "setup";      // simple variable assignment, hook call, short initializer

export interface SymbolDiff {
  name: string;
  kind: SymbolKind;
  status: "added" | "removed" | "modified" | "moved";
  addedLines: string[];
  removedLines: string[];
  /** When status === "moved", where the symbol moved to/from */
  movedTo?: string;
  movedFrom?: string;
}

interface DiffHunk {
  header: string;
  lines: Array<{ kind: "added" | "removed" | "context"; content: string }>;
}

export interface PropsChange {
  added: string[];
  removed: string[];
}

// ── Test file helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if the filename looks like a test/spec file.
 */
export function isTestFile(filename: string): boolean {
  return /\.(test|spec)\.(js|jsx|ts|tsx)$/.test(filename);
}

/**
 * Returns true if the filename looks like a config file (vitest, jest, etc.)
 */
export function isConfigFile(filename: string): boolean {
  return /(?:vitest|jest|vite|tsconfig|eslint|prettier|babel|webpack|rollup)\.config\.(js|ts|cjs|mjs)$/.test(filename)
    || /\.config\.(js|ts|cjs|mjs)$/.test(filename);
}

interface TestCase {
  suite: string;   // describe block name
  name: string;    // it/test block name
}

/**
 * Extract describe/it/test block names from raw diff lines.
 */
export function extractTestCases(addedLines: string[]): TestCase[] {
  const results: TestCase[] = [];
  let currentSuite = "";

  for (const line of addedLines) {
    const t = line.trim();

    // describe('suite name', ...) or describe("suite name", ...)
    // Use backreference \1 so the closing quote matches the opening quote
    const suiteMatch = t.match(/^describe\s*\(\s*(['"`])(.*?)\1/);
    if (suiteMatch) {
      currentSuite = suiteMatch[2];
      continue;
    }

    // it('test name', ...) or test('test name', ...)
    const caseMatch = t.match(/^(?:it|test)\s*\(\s*(['"`])(.*?)\1/);
    if (caseMatch) {
      results.push({ suite: currentSuite, name: caseMatch[2] });
    }
  }

  return results;
}

/**
 * Generate a readable markdown summary for a test file diff.
 * Groups test cases by suite and lists them clearly.
 */
export function generateTestFileSummary(
  addedLines: string[],
  removedLines: string[],
): string[] {
  const sections: string[] = [];

  const addedCases = extractTestCases(addedLines);
  const removedCases = extractTestCases(removedLines);

  // Group added cases by suite
  const suiteMap = new Map<string, string[]>();
  for (const { suite, name } of addedCases) {
    const key = suite || "(root)";
    if (!suiteMap.has(key)) suiteMap.set(key, []);
    suiteMap.get(key)!.push(name);
  }

  if (suiteMap.size > 0) {
    for (const [suite, cases] of suiteMap) {
      sections.push(`**테스트: \`${suite}\`**`);
      cases.forEach((c) => sections.push(`  + ${c}`));
      sections.push("");
    }
  }

  // Removed test cases
  if (removedCases.length > 0) {
    sections.push("**제거된 테스트**");
    removedCases.forEach(({ suite, name }) => {
      const label = suite ? `${suite} > ${name}` : name;
      sections.push(`  - ${label}`);
    });
    sections.push("");
  }

  return sections;
}

// ── JSX / Tailwind helpers ─────────────────────────────────────────────────────

export function isJSXFile(filename: string): boolean {
  return /\.(jsx|tsx)$/.test(filename);
}

export function hasJSXContent(lines: string[]): boolean {
  return lines.some(
    (l) => /<[A-Z][A-Za-z]*[\s/>]/.test(l) || /return\s*\(/.test(l),
  );
}

export function isClassNameOnlyLine(line: string): boolean {
  return /^className=/.test(line.trim());
}

export function extractClassName(line: string): string | null {
  // Static: className="flex items-center gap-2"
  const staticMatch = line.match(/className="([^"]*)"/);
  if (staticMatch) return staticMatch[1];

  // Ternary: className={isDark ? "bg-gray-900" : "bg-white"}
  const ternaryMatch = line.match(
    /className=\{[^?]+\?\s*"([^"]*)"\s*:\s*"([^"]*)"\}/,
  );
  if (ternaryMatch) return `${ternaryMatch[1]} ${ternaryMatch[2]}`;

  // Template literal: className={`base ${condition ? "a" : "b"}`}
  const templateMatch = line.match(/className=\{`([^`]*)`\}/);
  if (templateMatch) {
    const raw = templateMatch[1];
    const literals = raw.replace(/\$\{[^}]*\}/g, " ").trim();
    const exprStrings = [...raw.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
    return [literals, ...exprStrings].filter(Boolean).join(" ");
  }

  return null;
}

export function extractComponentFromLine(line: string): string {
  const tagMatch = line.match(/<([A-Za-z][A-Za-z0-9.]*)/);
  if (tagMatch) return tagMatch[1];
  return "unknown";
}

export function parseClassNameChanges(
  addedLines: string[],
  removedLines: string[],
): ClassNameChange[] {
  const componentMap = new Map<
    string,
    { added: Set<string>; removed: Set<string> }
  >();

  for (const line of addedLines.filter((l) => /className=/.test(l))) {
    const cls = extractClassName(line);
    const comp = extractComponentFromLine(line);
    if (!cls) continue;
    if (!componentMap.has(comp))
      componentMap.set(comp, { added: new Set(), removed: new Set() });
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => componentMap.get(comp)!.added.add(c));
  }

  for (const line of removedLines.filter((l) => /className=/.test(l))) {
    const cls = extractClassName(line);
    const comp = extractComponentFromLine(line);
    if (!cls) continue;
    if (!componentMap.has(comp))
      componentMap.set(comp, { added: new Set(), removed: new Set() });
    cls
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => componentMap.get(comp)!.removed.add(c));
  }

  const changes: ClassNameChange[] = [];
  for (const [comp, { added, removed }] of componentMap) {
    if (comp === "unknown") continue; // skip unresolvable components
    const pureAdded = [...added].filter((c) => !removed.has(c));
    const pureRemoved = [...removed].filter((c) => !added.has(c));
    if (pureAdded.length === 0 && pureRemoved.length === 0) continue;
    changes.push({ component: comp, added: pureAdded, removed: pureRemoved });
  }

  return changes;
}

export function renderStyleChanges(changes: ClassNameChange[]): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    lines.push(`**${change.component}**`);
    if (change.added.length > 0) lines.push(`  + ${change.added.join("  ")}`);
    if (change.removed.length > 0)
      lines.push(`  - ${change.removed.join("  ")}`);
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

  return eventProps.length > 0 ? `${name}(${eventProps.join(", ")})` : name;
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
    t === "{" ||
    t === "}" ||
    t === "(" ||
    t === ")" ||
    t === "<>" ||
    t === "</>" ||
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
      type: "call",
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

/**
 * Step 1: Filter diff lines — added (+) and removed (-) separately
 */
export function filterDiffLines(diffText: string): {
  added: string[];
  removed: string[];
} {
  const lines = diffText.split("\n");

  const added = lines
    .filter(
      (l) => l.startsWith("+") && !l.startsWith("+++") && l.trim() !== "+",
    )
    .map((l) => l.substring(1));

  const removed = lines
    .filter(
      (l) => l.startsWith("-") && !l.startsWith("---") && l.trim() !== "-",
    )
    .map((l) => l.substring(1));

  return { added, removed };
}

/**
 * Step 2: Normalize code — remove noise, preserve structure
 */
export function normalizeCode(lines: string[]): string[] {
  return lines
    .map((line) => {
      let normalized = line;
      normalized = normalized.replace(/\/\/.*$/, "");
      normalized = normalized.replace(/\/\*.*?\*\//, "");
      normalized = normalized.trim();
      normalized = normalized.replace(/;$/, "");
      return normalized;
    })
    .filter((line) => line.length > 0);
}

/**
 * Step 3: Calculate indentation depth (2 spaces = 1 level)
 */
export function getIndentDepth(line: string): number {
  const match = line.match(/^(\s*)/);
  if (!match) return 0;
  return Math.floor(match[1].length / 2);
}

/**
 * Step 4: Detect chaining pattern (P1 — Highest Priority)
 */
export function isChaining(line: string, prevLine: string | null): boolean {
  if (!prevLine) return false;
  if (!line.trim().startsWith(".")) return false;
  if (!prevLine.match(/[)\}]$/)) return false;
  return true;
}

/**
 * Step 5: Extract method name from chaining
 */
export function extractChainMethod(line: string): string {
  const match = line.match(/\.(\w+)\(/);
  if (match) return `${match[1]}()`;
  return line.trim();
}

/**
 * Step 6: Simplify callback arguments
 */
export function simplifyCallback(methodCall: string): string {
  // .method(param => param.property)
  const arrowMatch = methodCall.match(/(\w+)\((\w+)\s*=>\s*(\w+)\.(\w+)\)/);
  if (arrowMatch) {
    const [, method, param, , prop] = arrowMatch;
    return `${method}(${param} → ${prop})`;
  }

  // .method(anything)  →  method(callback)
  const callbackMatch = methodCall.match(/(\w+)\([^)]+\)/);
  if (callbackMatch) return `${callbackMatch[1]}(callback)`;

  return methodCall;
}

/**
 * Step 7: Detect conditional (P2)
 */
export function isConditional(line: string): boolean {
  return /^(if|else|switch)\s*[\(\{]/.test(line.trim());
}

/**
 * Step 8: Detect loop (P3)
 */
export function isLoop(line: string): boolean {
  return /^(for|while)\s*\(/.test(line.trim());
}

/**
 * Step 9: Detect function declaration (P4)
 */
export function isFunctionDeclaration(line: string): boolean {
  const t = line.trim();
  return (
    // function foo() / async function foo()
    /^(async\s+)?function\s+\w+/.test(t) ||
    // const foo = () => / const foo = async () => / const foo = async (x: T) =>
    /^(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(t) ||
    // const foo = function / const foo = async function
    /^(const|let|var)\s+\w+\s*=\s*(async\s+)?function/.test(t)
  );
}

/**
 * Step 10: Lines that should not appear in the flow
 */
export function shouldIgnore(line: string): boolean {
  const ignorePatterns = [
    /^import\s+/,
    /^export\s+/,
    /^type\s+/,
    /^interface\s+/,
    /^console\./,
    /^return$/,
    /^throw\s+/,
  ];
  return ignorePatterns.some((p) => p.test(line.trim()));
}

/**
 * Step 11: Extract root identifier from a line
 */
export function extractRoot(line: string): string | null {
  // const result = getData()
  const assignMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(\w+)/);
  if (assignMatch) return assignMatch[2];

  // getData()
  const callMatch = line.match(/^(\w+)\(/);
  if (callMatch) return `${callMatch[1]}()`;

  // data.map()
  const methodMatch = line.match(/^(\w+)\./);
  if (methodMatch) return methodMatch[1];

  return null;
}

/**
 * Main parser: convert normalized lines → FlowNode tree
 */
export function parseToFlowTree(lines: string[]): FlowNode[] {
  const roots: FlowNode[] = [];
  let currentChain: FlowNode | null = null;
  let prevLine: string | null = null;
  let baseDepth = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (shouldIgnore(line)) {
      prevLine = line;
      continue;
    }

    const depth = getIndentDepth(lines[i]);
    if (baseDepth === -1) baseDepth = depth;
    const relativeDepth = depth - baseDepth;

    // P1: chaining
    if (isChaining(line, prevLine)) {
      const method = extractChainMethod(line);
      const simplified = simplifyCallback(method);

      if (currentChain) {
        const chainNode: FlowNode = {
          type: "chain",
          name: simplified,
          children: [],
          depth: relativeDepth,
          priority: Priority.CHAINING,
        };

        let parent = currentChain;
        while (
          parent.children.length > 0 &&
          parent.children[parent.children.length - 1].depth >= relativeDepth
        ) {
          const last = parent.children[parent.children.length - 1];
          if (last.children.length > 0) parent = last;
          else break;
        }
        parent.children.push(chainNode);
      }

      prevLine = line;
      continue;
    }

    // P4: function declaration — must be checked BEFORE extractRoot,
    // because "const foo = async ..." would otherwise match extractRoot first.
    if (isFunctionDeclaration(line)) {
      const funcMatch = line.match(/(?:function|const|let|var)\s+(\w+)/);
      roots.push({
        type: "function",
        name: funcMatch ? `${funcMatch[1]}()` : "function()",
        children: [],
        depth: relativeDepth,
        priority: Priority.FUNCTION,
      });
      currentChain = null;
      prevLine = line;
      continue;
    }

    // New root / chain start
    const root = extractRoot(line);
    if (root) {
      currentChain = {
        type: "root",
        name: root,
        children: [],
        depth: relativeDepth,
        priority: Priority.CHAINING,
      };
      roots.push(currentChain);
    } else if (isConditional(line)) {
      const condMatch = line.match(/(if|else|switch)\s*\(([^)]+)\)/);
      const condName = condMatch
        ? `${condMatch[1]} (${condMatch[2]})`
        : line.trim();
      roots.push({
        type: "condition",
        name: condName,
        children: [],
        depth: relativeDepth,
        priority: Priority.CONDITIONAL,
      });
      currentChain = null;
    } else if (isLoop(line)) {
      roots.push({
        type: "loop",
        name: "loop",
        children: [],
        depth: relativeDepth,
        priority: Priority.LOOP,
      });
      currentChain = null;
    }

    prevLine = line;
  }

  return roots;
}

/**
 * Render flow tree as markdown lines
 */
export function renderFlowTree(nodes: FlowNode[], indent = 0): string[] {
  const lines: string[] = [];
  const prefix = indent === 0 ? "" : " ".repeat((indent - 1) * 4) + " └─ ";

  for (const node of nodes) {
    lines.push(prefix + node.name);
    if (node.children.length > 0) {
      lines.push(...renderFlowTree(node.children, indent + 1));
    }
  }

  return lines;
}

/**
 * Main entry: parse a raw diff string → ParseResult
 */
export function parseDiffToLogicalFlow(diffText: string): ParseResult {
  const { added, removed } = filterDiffLines(diffText);
  const normalizedAdded = normalizeCode(added);
  const flowTree = parseToFlowTree(normalizedAdded);

  return {
    root: flowTree,
    rawCode: added.join("\n"),
    removedCode: removed.join("\n"),
  };
}

// ── Import change detection ────────────────────────────────────────────────────

/**
 * Extract named imports from a single import line.
 * e.g. `import { foo, bar } from 'baz'` → ['foo', 'bar']
 * e.g. `import DefaultExport from 'baz'` → ['DefaultExport']
 */
function extractImportNames(line: string): string[] {
  const named = line.match(/\{\s*([^}]+)\s*\}/);
  if (named) {
    return named[1].split(",").map((s) => s.trim().replace(/\s+as\s+\w+/, "")).filter(Boolean);
  }
  const def = line.match(/^import\s+(\w+)\s+from/);
  if (def) return [def[1]];
  return [];
}

/**
 * Detect newly imported and removed imported names between added/removed lines.
 */
export function extractImportChanges(
  addedLines: string[],
  removedLines: string[],
): { added: string[]; removed: string[] } {
  const getImports = (lines: string[]) =>
    lines
      .filter((l) => l.trim().startsWith("import "))
      .flatMap(extractImportNames);

  const addedImports = new Set(getImports(addedLines));
  const removedImports = new Set(getImports(removedLines));

  return {
    added: [...addedImports].filter((i) => !removedImports.has(i)),
    removed: [...removedImports].filter((i) => !addedImports.has(i)),
  };
}

// ── Function parameter change detection ───────────────────────────────────────

/**
 * Extract parameter names from a function declaration line.
 * Handles: function foo(a, b, c), const foo = (a, b) =>, const foo = async (a: T, b: T) =>
 */
function extractParams(line: string): string[] {
  // Match the first (...) group
  const m = line.match(/\(\s*([^)]*)\s*\)/);
  if (!m || !m[1].trim()) return [];
  return m[1]
    .split(",")
    .map((p) =>
      p
        .trim()
        .replace(/:.*$/, "")   // strip type annotation
        .replace(/=.*$/, "")   // strip default value
        .replace(/^\.\.\./,"") // strip rest ...
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Compare function parameters between added and removed declaration lines.
 * Returns { added, removed } param names.
 */
export function extractParamChanges(
  addedLines: string[],
  removedLines: string[],
): { added: string[]; removed: string[] } {
  const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?\()/;

  const getParams = (lines: string[]): Set<string> => {
    const result = new Set<string>();
    for (const line of lines) {
      if (DECL_RE.test(line.trim())) {
        extractParams(line).forEach((p) => result.add(p));
      }
    }
    return result;
  };

  const addedParams = getParams(addedLines);
  const removedParams = getParams(removedLines);

  return {
    added: [...addedParams].filter((p) => !removedParams.has(p)),
    removed: [...removedParams].filter((p) => !addedParams.has(p)),
  };
}

// ── Shared symbol detection regexes ───────────────────────────────────────────

// Matches lowercase functions AND ALL_CAPS export functions (e.g. DELETE, GET, POST)
const FUNC_RE =
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?(?:const|let|var)\s+([a-z]\w+)\s*=\s*(?:async\s+)?\(?|^(?:export\s+)?(?:const|let|var)\s+([a-z]\w+)\s*=\s*[a-z]\w+\s*[<(]/;
// React component: PascalCase (uppercase first, then at least one lowercase)
const COMPONENT_RE =
  /^(?:export\s+)?(?:default\s+)?(?:function|const)\s+([A-Z][a-z][A-Za-z0-9]*)/;

// A declaration line that opens a function body on the same line
const FUNCTION_BODY_RE = /(?:=>\s*\{|(?:async\s+)?function\s*\w*\s*\()|\)\s*\{/;
// Arrow function assigned to a const where the body starts on the NEXT line
// e.g. `const foo = () => someCall(` — multiline, no { on this line
const ARROW_MULTILINE_RE = /^(?:export\s+)?(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\(/;

function extractSymbolFromLine(line: string): string | undefined {
  const trimmed = line.trim();
  const cm = trimmed.match(COMPONENT_RE) || trimmed.match(FUNC_RE);
  if (cm) {
    const name = cm[1] || cm[2] || cm[3];
    if (name) return name;
  }
  return undefined;
}

/**
 * Classify a symbol declaration line as component, function, or setup.
 * - component: PascalCase (React component)
 * - function: function keyword, arrow with body, or multiline arrow assignment
 * - setup: simple one-liner assignment / hook call (e.g. const x = useRouter())
 */
function classifySymbol(declarationLine: string): SymbolKind {
  const trimmed = declarationLine.trim();

  // PascalCase → component
  if (COMPONENT_RE.test(trimmed)) return "component";

  // `function foo` / `async function foo` keyword → function
  if (/^(?:export\s+)?(?:async\s+)?function\s+/.test(trimmed)) return "function";

  // Arrow function with body opener on same line → function
  if (FUNCTION_BODY_RE.test(trimmed)) return "function";

  // `const foo = (` or `const foo = async (` — multiline arrow, body on next line
  if (ARROW_MULTILINE_RE.test(trimmed)) return "function";

  // Assigned arrow without parens: `const foo = () => someExpr(` (no {)
  // Only treat as function if it calls something non-trivially (has parens)
  if (/=\s*(?:async\s+)?\(\)\s*=>\s*\w+\s*\(/.test(trimmed)) return "function";

  // Everything else: const router = useRouter(), const x = 'value', etc.
  return "setup";
}

// ── Hunk parsing & symbol attribution ─────────────────────────────────────────

/**
 * Split raw diff text into structured hunks.
 * Each hunk has a header line and classified lines (added/removed/context).
 */
export function parseDiffHunks(diffText: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("@@")) {
      current = { header: line, lines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    // Skip diff file headers
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) {
      current.lines.push({ kind: "added", content: line.substring(1) });
    } else if (line.startsWith("-")) {
      current.lines.push({ kind: "removed", content: line.substring(1) });
    } else {
      current.lines.push({ kind: "context", content: line });
    }
  }

  return hunks;
}

/**
 * Extract the trailing function/component name from a @@ hunk header.
 * e.g. "@@ -10,5 +10,8 @@ function UserProfileModal(" → "UserProfileModal"
 */
function extractSymbolFromHunkHeader(header: string): string | undefined {
  const m = header.match(/@@[^@]*@@\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|(?:const|let|var)\s+(\w+))/);
  if (m) return m[1] || m[2];
  return undefined;
}

/**
 * Attribute each added/removed line to the nearest enclosing symbol (function/component).
 * Uses hunk headers and line-by-line declaration scanning.
 */
export function attributeLinesToSymbols(hunks: DiffHunk[]): SymbolDiff[] {
  const symbolMap = new Map<string, { added: string[]; removed: string[]; kind: SymbolKind }>();
  // Track context lines per symbol to detect "still alive" symbols
  const contextLines = new Map<string, string[]>();

  const getOrCreate = (name: string, kind: SymbolKind) => {
    if (!symbolMap.has(name)) symbolMap.set(name, { added: [], removed: [], kind });
    if (!contextLines.has(name)) contextLines.set(name, []);
    return symbolMap.get(name)!;
  };

  for (const hunk of hunks) {
    let currentSymbol = extractSymbolFromHunkHeader(hunk.header) ?? "module-level";
    let currentKind: SymbolKind = "function";

    for (const { kind, content } of hunk.lines) {
      // Update current symbol when a declaration is encountered (context or added)
      if (kind !== "removed") {
        const declared = extractSymbolFromLine(content);
        if (declared) {
          currentSymbol = declared;
          currentKind = classifySymbol(content);
        }
      }

      if (kind === "added") getOrCreate(currentSymbol, currentKind).added.push(content);
      else if (kind === "removed") getOrCreate(currentSymbol, currentKind).removed.push(content);
      else {
        // context line — proves the symbol still exists in the file
        getOrCreate(currentSymbol, currentKind);
        contextLines.get(currentSymbol)!.push(content);
      }
    }
  }

  // Collect all added lines across all symbols — used to detect
  // "refactor-out" pattern: a symbol appears removed but its name
  // still appears in other symbols' added context lines.
  const allAddedLines = [...symbolMap.values()].flatMap((v) => v.added);

  const results: SymbolDiff[] = [];
  for (const [name, { added, removed, kind }] of symbolMap) {
    if (added.length === 0 && removed.length === 0) continue;

    // If all removed lines are comments or blank, don't classify as "removed"
    const meaningfulRemoved = removed.filter(
      (l) => l.trim().length > 0 && !l.trim().startsWith("//") && !l.trim().startsWith("/*") && !l.trim().startsWith("*"),
    );

    const effectiveAdded = added.length > 0;
    const effectiveRemoved = meaningfulRemoved.length > 0;

    let status: SymbolDiff["status"] =
        effectiveAdded && effectiveRemoved ? "modified"
      : effectiveAdded ? "added"
      : effectiveRemoved ? "removed"
      : "modified";

    if (status === "removed") {
      // Refactor-out detection 1: name still referenced in other symbols' added lines
      const namePattern = new RegExp(`\\b${name}\\b`);
      if (allAddedLines.some((l) => namePattern.test(l))) {
        status = "modified";
      }
      // Refactor-out detection 2: symbol has context lines → it still exists in the file,
      // only some inner logic was removed (e.g. inlined helpers extracted to another file)
      else if ((contextLines.get(name)?.length ?? 0) > 0) {
        status = "modified";
      }
    }

    results.push({ name, kind, status, addedLines: added, removedLines: removed });
  }

  return results;
}

// ── Props / behavior analysis ──────────────────────────────────────────────────

/**
 * Detect TypeScript prop/interface changes from added vs removed lines.
 */
export function extractPropsChanges(
  addedLines: string[],
  removedLines: string[],
): PropsChange {
  // Match interface member lines: "  propName?: SomeType;"
  const MEMBER_RE = /^\s*(\w+\??)\s*:\s*(.+?)(?:;|,)?\s*$/;

  const extractMembers = (lines: string[]): Set<string> => {
    const members = new Set<string>();
    for (const line of lines) {
      const m = line.match(MEMBER_RE);
      if (m) members.add(`${m[1]}: ${m[2].trim()}`);
    }
    return members;
  };

  const addedMembers = extractMembers(addedLines);
  const removedMembers = extractMembers(removedLines);

  return {
    added: [...addedMembers].filter((m) => !removedMembers.has(m)),
    removed: [...removedMembers].filter((m) => !addedMembers.has(m)),
  };
}

/**
 * Summarize behavioral signals from a set of diff lines.
 * Returns at most 8 human-readable bullet strings.
 */
/** Returns true if a line has unbalanced parentheses/brackets — likely a mid-expression fragment */
function isSyntacticallyIncomplete(line: string): boolean {
  const t = line.trim();
  // Reject lines that start with a closing paren/bracket — they are continuations of a previous line
  if (/^[)\]]/.test(t)) return true;
  // Count unmatched open parens/brackets
  let parens = 0, brackets = 0;
  for (const ch of t) {
    if (ch === "(") parens++;
    else if (ch === ")") parens--;
    else if (ch === "[") brackets++;
    else if (ch === "]") brackets--;
  }
  // If parens or brackets are unbalanced (open or close), it's a fragment
  if (parens !== 0 || brackets !== 0) return true;
  // Lines ending with an operator or opening brace mid-expression
  if (/[,(+\-*&|?]$/.test(t)) return true;
  return false;
}

function buildBehaviorSummary(lines: string[], mode: "added" | "removed" = "added"): string[] {
  // Priority buckets — each has its own cap:
  //   tier1 (state/API): unlimited — core data flow, always shown
  //   tier2 (guard/catch): max 2 — safety/error boundaries
  //   tier3 (cond): max 2 — branching logic
  //   tier4 (setState/useEffect/return): max 2 — side effects
  const tier1: string[] = []; // (state), (API)
  const tier2: string[] = []; // (guard), (catch)
  const tier3: string[] = []; // (cond)
  const tier4: string[] = []; // (setState), useEffect, (return)

  const normalized = normalizeCode(lines).filter((l) => !isSyntacticallyIncomplete(l));

  for (const line of normalized) {
    // ── Tier 1: React state ──────────────────────────────────
    const stateMatch = line.match(/const\s+\[(\w+),\s*set\w+\]\s*=\s*useState\s*\(([^)]*)\)/);
    if (stateMatch) {
      const init = stateMatch[2].trim();
      const initLabel = init.length > 0 ? ` = ${init}` : "";
      tier1.push(mode === "removed"
        ? `state \`${stateMatch[1]}\` 제거`
        : `state \`${stateMatch[1]}\`${initLabel} 추가`);
      continue;
    }

    // ── Tier 1: Hook assigned to variable ───────────────────
    const hookAssignMatch = line.match(/const\s+(\w+)\s*=\s*(use[A-Z]\w+)\s*\(([^)]*)\)/);
    if (hookAssignMatch) {
      const arg = hookAssignMatch[3].trim();
      const argLabel = arg.length > 0 && arg.length <= 30 ? `(${arg})` : "";
      tier1.push(`(state) \`${hookAssignMatch[1]}\` ← \`${hookAssignMatch[2]}${argLabel}\``);
      continue;
    }

    // ── Tier 1: Bare hook call ───────────────────────────────
    const hookMatch = line.match(/^\s*(use[A-Z]\w+)\s*\(/);
    if (hookMatch) { tier1.push(`(state) \`${hookMatch[1]}\` called`); continue; }

    // ── Tier 1: Async/await assigned ────────────────────────
    const awaitAssignMatch = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*await\s+([\w.]+)\s*\(([^)]{0,40})\)/);
    if (awaitAssignMatch) {
      const arg = awaitAssignMatch[3].trim();
      const argLabel = arg.length > 0 && arg.length <= 25 ? `(${arg})` : "()";
      tier1.push(`(API) \`${awaitAssignMatch[2]}${argLabel}\` → \`${awaitAssignMatch[1]}\``);
      continue;
    }

    // ── Tier 1: Bare await call ──────────────────────────────
    const awaitMatch = line.match(/^await\s+([\w.]+)\s*\(([^)]{0,40})\)/);
    if (awaitMatch) {
      const arg = awaitMatch[2].trim();
      const argLabel = arg.length > 0 && arg.length <= 25 ? `(${arg})` : "()";
      tier1.push(`(API) \`${awaitMatch[1]}${argLabel}\``);
      continue;
    }

    // ── Tier 2: Guard clause ─────────────────────────────────
    const guardMatch = line.match(/^if\s*\((.{1,50})\)\s*return/);
    if (guardMatch) {
      tier2.push(`(guard) \`${guardMatch[1].trim()}\` → early return`);
      continue;
    }

    // ── Tier 2: Error handling ───────────────────────────────
    const catchMatch = line.match(/^catch\s*\(\s*(\w+)\s*\)/);
    if (catchMatch) { tier2.push(`(catch) \`${catchMatch[1]}\``); continue; }

    // ── Tier 3: Conditionals (non-guard)
    // Only match `if (cond) {` or `if (cond)` at end of line — reject inline one-liners
    // like `if (x) doSomething()` which produce garbled output
    const condMatch = line.match(/^(if|else if)\s*\(([^)]{1,60})\)\s*\{?\s*$/);
    if (condMatch) { tier3.push(`(cond) \`${condMatch[2].trim()}\``); continue; }

    // ── Tier 4: useEffect ────────────────────────────────────
    const effectMatch = line.match(/useEffect\s*\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{?|useEffect\s*\(\s*\(\s*\)\s*=>/);
    if (effectMatch) {
      const depsMatch = line.match(/useEffect[^,]*,\s*\[([^\]]*)\]/);
      if (depsMatch) {
        const deps = depsMatch[1].trim();
        tier4.push(deps.length === 0
          ? `\`useEffect\` 마운트 시 1회 실행`
          : `\`useEffect\` [${deps}] 변경 시 실행`);
      } else {
        tier4.push(`\`useEffect\` 등록`);
      }
      continue;
    }

    // ── Tier 4: setState calls ───────────────────────────────
    const setStateMatch = line.match(/^(set[A-Z]\w+)\s*\(([^)]{0,40})\)/);
    if (setStateMatch) {
      const arg = setStateMatch[2].trim();
      const argLabel = arg.length > 0 && arg.length <= 30 ? `(${arg})` : "()";
      tier4.push(`(setState) \`${setStateMatch[1]}${argLabel}\``);
      continue;
    }

    // ── Tier 4: Non-trivial return value ─────────────────────
    const returnMatch = line.match(/^return\s+(.{3,60})/);
    if (returnMatch && !returnMatch[1].startsWith("<") && !returnMatch[1].startsWith("{")) {
      const val = returnMatch[1].trim().replace(/[;,]$/, "");
      if (val.length <= 50) tier4.push(`(return) \`${val}\``);
      continue;
    }
  }

  // Merge buckets with per-tier caps, then deduplicate
  const result = [
    ...[...new Set(tier1)].slice(0, 4),   // Tier 1: max 4 (state/API — core data flow)
    ...[...new Set(tier2)].slice(0, 2),   // Tier 2: max 2 (guard/catch)
    ...[...new Set(tier3)].slice(0, 2),   // Tier 3: max 2 (cond)
    ...[...new Set(tier4)].slice(0, 2),   // Tier 4: max 2 (setState/useEffect/return)
  ];

  return result;
}

// Generic / structural HTML tags that carry no semantic meaning in diffs
const GENERIC_JSX_TAGS = new Set([
  "div", "span", "section", "article", "aside", "main", "header", "footer",
  "nav", "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption",
  "p", "br", "hr", "strong", "em", "b", "i", "small", "sub", "sup",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "thead", "tbody", "tr", "th", "td",
  "form", "fieldset", "legend",
  "svg", "g", "path", "rect", "circle", "line", "polygon",
  "Fragment", "React.Fragment",
]);

/**
 * Detect data-to-component mapping patterns in JSX lines.
 * Recognises: {list.map(...)} / {items.map(...)} / {data?.map(...)}
 * Returns entries like "🔄 `list` → `ItemRow`"
 */
function detectJSXMappings(lines: string[]): string[] {
  const mappings: string[] = [];
  for (const line of lines) {
    // {source.map((item) => <Component or <div
    const m = line.match(/\{(\w[\w.?]*)\s*\.map\s*\(\s*(?:\w+|\(\w+\))\s*=>\s*(?:\(?\s*)?<([A-Za-z][A-Za-z0-9.]*)/);
    if (m) {
      const source = m[1].replace(/\?$/, "");
      const component = m[2];
      mappings.push(`🔄 \`${source}\` → \`<${component}>\``);
      continue;
    }
    // {source?.map((item) => <Component (optional chain variant)
    const m2 = line.match(/\{(\w[\w.]*)\?\.map\s*\(\s*(?:\w+|\(\w+\))\s*=>/);
    if (m2) mappings.push(`🔄 \`${m2[1]}\` (map)`);
  }
  return [...new Set(mappings)];
}

/**
 * Detect conditional rendering patterns in JSX lines.
 * Recognises: {cond && <Component} / {cond ? <A : <B}
 * Returns entries like "⚡ `isOpen` → `<Modal>`"
 */
function detectJSXConditions(lines: string[]): string[] {
  const conds: string[] = [];
  for (const line of lines) {
    // {cond && <Component
    const andand = line.match(/\{(\w[\w.?]*)\s*&&\s*<([A-Za-z][A-Za-z0-9.]*)/);
    if (andand) {
      const cond = andand[1].replace(/\?$/, "");
      conds.push(`⚡ \`${cond}\` && \`<${andand[2]}>\``);
      continue;
    }
    // {cond ? <A : <B
    const ternary = line.match(/\{(\w[\w.?]*)\s*\?\s*<([A-Za-z][A-Za-z0-9.]*)[^:]*:\s*<([A-Za-z][A-Za-z0-9.]*)/);
    if (ternary) {
      const cond = ternary[1].replace(/\?$/, "");
      conds.push(`⚡ \`${cond}\` ? \`<${ternary[2]}>\` : \`<${ternary[3]}>\``);
    }
  }
  return [...new Set(conds)];
}

/**
 * Compare two JSX trees and return which MEANINGFUL elements were added vs removed.
 * Generic structural tags (div, span, p, …) are filtered out.
 * Mapping (🔄) and conditional (⚡) patterns are surfaced first.
 */
function buildJSXDiffSummary(
  addedTree: FlowNode[],
  removedTree: FlowNode[],
  addedRaw: string[],
  removedRaw: string[],
): string[] {
  const flatten = (nodes: FlowNode[], acc: string[] = []): string[] => {
    for (const n of nodes) {
      // Strip event props suffix "(onClick, ...)" to get the bare tag name
      const tag = n.name.replace(/\(.*\)$/, "").trim();
      acc.push(tag);
      flatten(n.children, acc);
    }
    return acc;
  };

  // Only keep semantically meaningful tags
  const significant = (names: string[]) =>
    names.filter((n) => !GENERIC_JSX_TAGS.has(n) && !n.startsWith("/"));

  const addedNames = new Set(significant(flatten(addedTree)));
  const removedNames = new Set(significant(flatten(removedTree)));

  const lines: string[] = [];

  // 1. map() relationships
  const mappings = detectJSXMappings(addedRaw);
  mappings.slice(0, 3).forEach((m) => lines.push(`+ ${m}`));

  // 2. conditional rendering
  const conditions = detectJSXConditions(addedRaw);
  conditions.slice(0, 3).forEach((c) => lines.push(`+ ${c}`));

  // 3. removed conditional rendering
  detectJSXConditions(removedRaw).slice(0, 2)
    .forEach((c) => lines.push(`- ${c} 제거`));

  // 4. new meaningful tags not in either mapping/condition lists
  const alreadyMentioned = new Set(
    [...mappings, ...conditions].flatMap((s) =>
      [...s.matchAll(/`<(\w+)>`/g)].map((m) => m[1]),
    ),
  );
  [...addedNames]
    .filter((n) => !removedNames.has(n) && !alreadyMentioned.has(n))
    .slice(0, 4)
    .forEach((n) => lines.push(`+ \`<${n}>\``));

  // 5. removed meaningful tags
  [...removedNames]
    .filter((n) => !addedNames.has(n))
    .slice(0, 3)
    .forEach((n) => lines.push(`- \`<${n}>\` 제거`));

  return lines;
}

/**
 * Generate per-symbol markdown sections showing before/after changes.
 */
export function generateSymbolSections(
  symbolDiffs: SymbolDiff[],
  isJSX: boolean,
): string[] {
  const sections: string[] = [];
  const STATUS_ICON = { added: "✅", removed: "❌", modified: "✏️", moved: "📦" };
  const getStatusLabel = (sym: SymbolDiff) => {
    if (sym.status === "moved") {
      if (sym.movedTo) return `→ \`${sym.movedTo}\`로 이동됨`;
      if (sym.movedFrom) return `← \`${sym.movedFrom}\`에서 이동됨`;
      return "다른 파일로 이동됨";
    }
    return { added: "새로 추가", removed: "제거됨", modified: "변경됨" }[sym.status];
  };

  // Walk the list in order: attach each setup variable to the nearest
  // preceding significant symbol so it appears as an inline Context line.
  type SignificantEntry = {
    sym: SymbolDiff;
    setupNames: string[];
  };

  const entries: SignificantEntry[] = [];
  let pendingSetup: string[] = [];

  for (const sym of symbolDiffs) {
    if (sym.name === "module-level") continue;

    if (sym.kind === "setup") {
      pendingSetup.push(sym.name);
    } else {
      // Flush pending setup onto this significant symbol
      entries.push({ sym, setupNames: pendingSetup });
      pendingSetup = [];
    }
  }
  // Any trailing setup items → attach to last entry or discard if none
  if (pendingSetup.length > 0 && entries.length > 0) {
    entries[entries.length - 1].setupNames.push(...pendingSetup);
  }

  for (const { sym, setupNames } of entries) {
    const kindLabel = sym.kind === "component" ? "Component" : "Function";
    // Flat bold line instead of ### heading — keeps font size normal on mobile
    sections.push(
      `**${STATUS_ICON[sym.status]} \`${sym.name}\`** _(${kindLabel})_ — ${getStatusLabel(sym)}`,
    );

    const lines: string[] = [];

    // Setup variables attached to this symbol (cap at 5)
    if (setupNames.length > 0) {
      const VAR_CAP = 5;
      const shown = setupNames.slice(0, VAR_CAP).map((n) => `\`${n}\``).join(", ");
      const extra = setupNames.length > VAR_CAP ? ` 외 ${setupNames.length - VAR_CAP}개` : "";
      lines.push(`변수: ${shown}${extra}`);
    }

    // Function parameter changes (cap at 4, summarise rest)
    const paramChanges = extractParamChanges(sym.addedLines, sym.removedLines);
    const PARAM_CAP = 4;
    paramChanges.added.slice(0, PARAM_CAP).forEach((p) => lines.push(`파라미터+ \`${p}\``));
    if (paramChanges.added.length > PARAM_CAP)
      lines.push(`파라미터+ … 외 ${paramChanges.added.length - PARAM_CAP}개`);
    paramChanges.removed.slice(0, PARAM_CAP).forEach((p) => lines.push(`파라미터- \`${p}\``));
    if (paramChanges.removed.length > PARAM_CAP)
      lines.push(`파라미터- … 외 ${paramChanges.removed.length - PARAM_CAP}개`);

    // Props / interface changes (cap at 5, summarise rest)
    const props = extractPropsChanges(sym.addedLines, sym.removedLines);
    const abbreviateProp = (p: string) =>
      p.replace(/^(\w[\w?]*:\s*)(['"`])(.{20,})(\2)$/, "$1$2...$2");
    const PROPS_CAP = 5;
    props.added.slice(0, PROPS_CAP).forEach((p) => lines.push(`Props+ \`${abbreviateProp(p)}\``));
    if (props.added.length > PROPS_CAP)
      lines.push(`Props+ … 외 ${props.added.length - PROPS_CAP}개`);
    props.removed.slice(0, PROPS_CAP).forEach((p) => lines.push(`Props- \`${abbreviateProp(p)}\``));
    if (props.removed.length > PROPS_CAP)
      lines.push(`Props- … 외 ${props.removed.length - PROPS_CAP}개`);

    // Behavioral summary (skip for moved — content lives in the destination file)
    if (sym.status !== "removed" && sym.status !== "moved") {
      const addedBehavior = buildBehaviorSummary(sym.addedLines);
      const removedBehavior = sym.status !== "added" && sym.removedLines.length > 0
        ? buildBehaviorSummary(sym.removedLines, "removed")
        : [];

      // Deduplicate: if the same signal appears in both added and removed,
      // it means it was modified (e.g. useEffect deps changed) — show once as changed
      const deduped = addedBehavior.filter((l) => {
        // Strip leading markers to get the core signal for comparison
        const core = l
          .replace(/^state `(\w+)`.*$/, "state:$1")
          .replace(/^`useEffect`.*$/, "useEffect");
        const removedCore = removedBehavior.map((r) =>
          r.replace(/^state `(\w+)`.*$/, "state:$1")
           .replace(/^`useEffect`.*$/, "useEffect"),
        );
        return !removedCore.includes(core);
      });

      // Items that exist in removed but not added → changed (show as modified)
      const changedOnly = removedBehavior.filter((l) => {
        const core = l
          .replace(/^state `(\w+)`.*$/, "state:$1")
          .replace(/^`useEffect`.*$/, "useEffect");
        const addedCore = addedBehavior.map((a) =>
          a.replace(/^state `(\w+)`.*$/, "state:$1")
           .replace(/^`useEffect`.*$/, "useEffect"),
        );
        return addedCore.includes(core);
      });

      deduped.forEach((l) => lines.push(`+ ${l}`));
      // Show "changed" items (in both sides) without +/- prefix
      changedOnly.slice(0, 2).forEach((l) => lines.push(`~ ${l.replace(/^state `\w+` 제거$/, "").replace(/^`useEffect`.*$/, "`useEffect` deps 변경")}`));

      // Purely removed signals (not in added)
      const pureRemoved = removedBehavior.filter((l) => {
        const core = l
          .replace(/^state `(\w+)`.*$/, "state:$1")
          .replace(/^`useEffect`.*$/, "useEffect");
        const addedCore = addedBehavior.map((a) =>
          a.replace(/^state `(\w+)`.*$/, "state:$1")
           .replace(/^`useEffect`.*$/, "useEffect"),
        );
        return !addedCore.includes(core);
      });
      pureRemoved.slice(0, 4).forEach((l) => lines.push(`- ${l}`));
    } else if (sym.status === "removed" && sym.removedLines.length > 0) {
      buildBehaviorSummary(sym.removedLines, "removed").slice(0, 4)
        .forEach((l) => lines.push(`- ${l}`));
    }

    // JSX element diff
    if (isJSX) {
      const addedTree = parseJSXToFlowTree(sym.addedLines);
      const removedTree = parseJSXToFlowTree(sym.removedLines);
      buildJSXDiffSummary(addedTree, removedTree, sym.addedLines, sym.removedLines)
        .forEach((l) => lines.push(`UI: ${l.replace(/^[+-]\s*/, "")}`));
    }

    // Skip symbols with no meaningful content (e.g. only context lines with no added/removed analysis)
    if (lines.length === 0 && sym.status === "modified") continue;

    lines.forEach((l) => sections.push(`  ${l}`));
    sections.push("");
  }

  return sections;
}

// ── Changed symbol extraction ─────────────────────────────────────────────────

/**
 * Extract function/component names from lines with change status.
 * Returns list of { name, status } where status is 'added' | 'removed' | 'modified'.
 */
export function extractChangedSymbols(
  addedLines: string[],
  removedLines: string[],
): { name: string; status: "added" | "removed" | "modified" }[] {
  const extract = (lines: string[]): Set<string> => {
    const names = new Set<string>();
    for (const line of lines) {
      const cm = line.match(COMPONENT_RE) || line.match(FUNC_RE);
      if (cm) {
        const name = cm[1] || cm[2] || cm[3];
        if (name) names.add(name);
      }
    }
    return names;
  };

  const addedNames = extract(addedLines);
  const removedNames = extract(removedLines);

  const results: { name: string; status: "added" | "removed" | "modified" }[] =
    [];
  const seen = new Set<string>();

  for (const name of addedNames) {
    seen.add(name);
    results.push({
      name,
      status: removedNames.has(name) ? "modified" : "added",
    });
  }
  for (const name of removedNames) {
    if (!seen.has(name)) {
      results.push({ name, status: "removed" });
    }
  }

  return results;
}

/**
 * Render JSX tree as a single compact line: div > header > button(onClick)
 * Falls back to multi-line for deep trees.
 */
export function renderJSXTreeCompact(nodes: FlowNode[], maxDepth = 3): string {
  const lines: string[] = [];

  function walk(node: FlowNode, depth: number) {
    if (depth > maxDepth) return;
    const indent = "  ".repeat(depth);
    const hasChildren = node.children.length > 0;
    lines.push(`${indent}${node.name}${hasChildren ? "" : ""}`);
    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  for (const root of nodes) {
    walk(root, 0);
  }

  return lines.join("\n");
}

/**
 * Extract symbol names that were purely removed (not modified) in a diff.
 * Used by cli.ts for cross-file refactoring detection.
 */
export function extractRemovedSymbolNames(diffText: string): string[] {
  const hunks = parseDiffHunks(diffText);
  const symbolDiffs = attributeLinesToSymbols(hunks);
  return symbolDiffs
    .filter((s) => s.status === "removed" && s.name !== "module-level")
    .map((s) => s.name);
}

/**
 * Extract symbol names that were purely added (not modified) in a diff.
 * Used by cli.ts for cross-file refactoring detection.
 */
export function extractAddedSymbolNames(diffText: string): string[] {
  const hunks = parseDiffHunks(diffText);
  const symbolDiffs = attributeLinesToSymbols(hunks);
  return symbolDiffs
    .filter((s) => s.status === "added" && s.name !== "module-level")
    .map((s) => s.name);
}

/**
 * Generate the complete Reader Markdown document
 */
export function generateReaderMarkdown(
  diffText: string,
  meta: ReaderMarkdownMeta = {},
): string {
  const { added, removed } = filterDiffLines(diffText);

  // ── Test file shortcut ───────────────────────────────────
  if (meta.file && isTestFile(meta.file)) {
    const sections: string[] = [];
    sections.push(...generateTestFileSummary(added, removed));
    sections.push("---");
    sections.push(
      "🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.",
    );
    return sections.join("\n");
  }

  // ── Config file shortcut ──────────────────────────────────
  if (meta.file && isConfigFile(meta.file)) {
    const sections: string[] = [];
    const configImports = extractImportChanges(added, removed);
    if (configImports.added.length > 0) {
      sections.push("**플러그인/설정 추가**");
      configImports.added.forEach((i) => sections.push(`+ \`${i}\``));
      sections.push("");
    }
    if (configImports.removed.length > 0) {
      sections.push("**플러그인/설정 제거**");
      configImports.removed.forEach((i) => sections.push(`- \`${i}\``));
      sections.push("");
    }
    if (sections.length === 0) {
      sections.push("설정값 변경");
    }
    sections.push("---");
    sections.push(
      "🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.",
    );
    return sections.join("\n");
  }

  // ── Detect JSX mode ──────────────────────────────────────
  const isJSX = Boolean(
    (meta.file && isJSXFile(meta.file)) || hasJSXContent(added),
  );

  // ── Attribute lines to symbols via hunk parsing ───────────
  const hunks = parseDiffHunks(diffText);
  const symbolDiffs = attributeLinesToSymbols(hunks);

  // ── Detect moved symbols (removed here, imported elsewhere in same file) ──
  const fileImportChanges = extractImportChanges(added, removed);
  const newlyImported = new Set(fileImportChanges.added);
  for (const sym of symbolDiffs) {
    if (sym.status === "removed" && newlyImported.has(sym.name)) {
      sym.status = "moved";
    }
  }

  // ── Apply cross-file move context from cli.ts ─────────────
  if (meta.movedOutMap) {
    for (const sym of symbolDiffs) {
      if (sym.status === "removed" && meta.movedOutMap.has(sym.name)) {
        sym.status = "moved";
        sym.movedTo = meta.movedOutMap.get(sym.name);
      }
    }
  }
  if (meta.movedIntoThisFile) {
    for (const sym of symbolDiffs) {
      if (sym.status === "added" && meta.movedIntoThisFile.has(sym.name)) {
        sym.movedFrom = "다른 파일";
      }
    }
  }

  const sections: string[] = [];

  // ── File-level import changes ─────────────────────────────
  if (fileImportChanges.added.length > 0 || fileImportChanges.removed.length > 0) {
    sections.push("**Import 변화**");
    fileImportChanges.added.forEach((i) => sections.push(`+ \`${i}\``));
    fileImportChanges.removed.forEach((i) => sections.push(`- \`${i}\` (제거됨)`));
    sections.push("");
  }

  // ── Per-symbol sections ───────────────────────────────────
  if (symbolDiffs.length > 0) {
    sections.push(...generateSymbolSections(symbolDiffs, isJSX));
  } else {
    // Fallback: no symbols detected — show brief raw summary
    if (added.length > 0) {
      sections.push("```");
      added.slice(0, 10).forEach((l) => sections.push(l));
      if (added.length > 10) sections.push(`... (+${added.length - 10} lines)`);
      sections.push("```");
      sections.push("");
    }
  }

  // ── Footer ───────────────────────────────────────────────
  sections.push("---");
  sections.push(
    "🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.",
  );

  return sections.join("\n");
}
