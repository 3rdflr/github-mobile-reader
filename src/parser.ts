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
  status: "added" | "removed" | "modified";
  addedLines: string[];
  removedLines: string[];
}

interface DiffHunk {
  header: string;
  lines: Array<{ kind: "added" | "removed" | "context"; content: string }>;
}

export interface PropsChange {
  added: string[];
  removed: string[];
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

  const getOrCreate = (name: string, kind: SymbolKind) => {
    if (!symbolMap.has(name)) symbolMap.set(name, { added: [], removed: [], kind });
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
    }
  }

  const results: SymbolDiff[] = [];
  for (const [name, { added, removed, kind }] of symbolMap) {
    if (added.length === 0 && removed.length === 0) continue;
    results.push({
      name,
      kind,
      status: added.length > 0 && removed.length > 0 ? "modified"
            : added.length > 0 ? "added"
            : "removed",
      addedLines: added,
      removedLines: removed,
    });
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
function buildBehaviorSummary(lines: string[]): string[] {
  const summary: string[] = [];
  const normalized = normalizeCode(lines);

  for (const line of normalized) {
    // React state: const [x, setX] = useState(...)
    const stateMatch = line.match(/const\s+\[(\w+),\s*set\w+\]\s*=\s*useState/);
    if (stateMatch) { summary.push(`\`${stateMatch[1]}\` state 추가`); continue; }

    // Hook calls: useEffect, useCallback, useMemo, etc.
    const hookMatch = line.match(/\b(use[A-Z]\w+)\s*\(/);
    if (hookMatch && !line.includes("=")) { summary.push(`\`${hookMatch[1]}\` 호출`); continue; }

    // Async/await calls
    const awaitMatch = line.match(/await\s+([\w.]+\()/);
    if (awaitMatch) { summary.push(`\`${awaitMatch[1]}\` 비동기 호출`); continue; }

    // Conditionals
    const condMatch = line.match(/^(if|else if)\s*\((.{1,40})\)/);
    if (condMatch) { summary.push(`조건: ${condMatch[2]}`); continue; }

    // Generic function calls at root level
    const callMatch = line.match(/^(\w+)\(/);
    if (callMatch && !["if", "for", "while", "switch", "catch"].includes(callMatch[1])) {
      summary.push(`\`${callMatch[1]}()\` 호출`);
    }
  }

  return [...new Set(summary)].slice(0, 8);
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
  const STATUS_ICON = { added: "✅", removed: "❌", modified: "✏️" };
  const STATUS_LABEL = { added: "새로 추가", removed: "제거됨", modified: "변경됨" };

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
    sections.push(
      `### ${STATUS_ICON[sym.status]} \`${sym.name}\` _(${kindLabel})_ — ${STATUS_LABEL[sym.status]}`,
    );

    // Inline Context line for setup variables / hooks
    if (setupNames.length > 0) {
      sections.push(`_Context: ${setupNames.map((n) => `\`${n}\``).join(", ")}_`);
    }

    // Props / interface changes
    const props = extractPropsChanges(sym.addedLines, sym.removedLines);
    if (props.added.length > 0 || props.removed.length > 0) {
      sections.push("**Props 변화**");
      props.added.forEach((p) => sections.push(`+ \`${p}\``));
      props.removed.forEach((p) => sections.push(`- \`${p}\` (제거됨)`));
    }

    // Behavioral summary for added logic
    if (sym.status !== "removed") {
      const addedSummary = buildBehaviorSummary(sym.addedLines);
      if (addedSummary.length > 0) {
        sections.push("**동작 변화**");
        addedSummary.forEach((l) => sections.push(`+ ${l}`));
      }
    }
    // What was removed
    if (sym.status !== "added" && sym.removedLines.length > 0) {
      const removedSummary = buildBehaviorSummary(sym.removedLines);
      removedSummary.slice(0, 4).forEach((l) => sections.push(`- ${l}`));
    }

    // JSX element diff (map 🔄, conditional ⚡, new/removed tags)
    if (isJSX) {
      const addedTree = parseJSXToFlowTree(sym.addedLines);
      const removedTree = parseJSXToFlowTree(sym.removedLines);
      const jsxDiff = buildJSXDiffSummary(
        addedTree, removedTree, sym.addedLines, sym.removedLines,
      );
      if (jsxDiff.length > 0) {
        sections.push("**UI 변화**");
        jsxDiff.forEach((l) => sections.push(l));
      }
    }

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
 * Generate the complete Reader Markdown document
 */
export function generateReaderMarkdown(
  diffText: string,
  meta: ReaderMarkdownMeta = {},
): string {
  const { added, removed } = filterDiffLines(diffText);

  // ── Detect JSX mode ──────────────────────────────────────
  const isJSX = Boolean(
    (meta.file && isJSXFile(meta.file)) || hasJSXContent(added),
  );

  // ── Attribute lines to symbols via hunk parsing ───────────
  const hunks = parseDiffHunks(diffText);
  const symbolDiffs = attributeLinesToSymbols(hunks);

  // ── Style changes (className diffs) ───────────────────────
  const classNameChanges = isJSX ? parseClassNameChanges(added, removed) : [];

  const sections: string[] = [];

  // ── Per-symbol sections ───────────────────────────────────
  if (symbolDiffs.length > 0) {
    sections.push(...generateSymbolSections(symbolDiffs, isJSX));
  } else {
    // Fallback: no symbols detected — show brief raw summary
    if (added.length > 0) {
      sections.push("### ✅ 추가된 코드\n");
      sections.push("```");
      added.slice(0, 10).forEach((l) => sections.push(l));
      if (added.length > 10) sections.push(`... (+${added.length - 10} lines)`);
      sections.push("```\n");
    }
    if (removed.length > 0) {
      sections.push("### ❌ 제거된 코드\n");
      sections.push("```");
      removed.slice(0, 5).forEach((l) => sections.push(l));
      sections.push("```\n");
    }
  }

  // ── Style Changes (JSX only) ─────────────────────────────
  if (isJSX && classNameChanges.length > 0) {
    sections.push("### 💅 스타일 변화\n");
    sections.push(...renderStyleChanges(classNameChanges));
    sections.push("");
  }

  // ── Footer ───────────────────────────────────────────────
  sections.push("---");
  sections.push(
    "🛠 Auto-generated by [github-mobile-reader](https://github.com/3rdflr/github-mobile-reader). Do not edit manually.",
  );

  return sections.join("\n");
}
