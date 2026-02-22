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
  type: 'root' | 'chain' | 'condition' | 'loop' | 'function' | 'call';
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

/**
 * Step 1: Filter diff lines — added (+) and removed (-) separately
 */
export function filterDiffLines(diffText: string): {
  added: string[];
  removed: string[];
} {
  const lines = diffText.split('\n');

  const added = lines
    .filter(l => l.startsWith('+') && !l.startsWith('+++') && l.trim() !== '+')
    .map(l => l.substring(1));

  const removed = lines
    .filter(l => l.startsWith('-') && !l.startsWith('---') && l.trim() !== '-')
    .map(l => l.substring(1));

  return { added, removed };
}

/**
 * Step 2: Normalize code — remove noise, preserve structure
 */
export function normalizeCode(lines: string[]): string[] {
  return lines
    .map(line => {
      let normalized = line;
      normalized = normalized.replace(/\/\/.*$/, '');
      normalized = normalized.replace(/\/\*.*?\*\//, '');
      normalized = normalized.trim();
      normalized = normalized.replace(/;$/, '');
      return normalized;
    })
    .filter(line => line.length > 0);
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
  if (!line.trim().startsWith('.')) return false;
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
  return ignorePatterns.some(p => p.test(line.trim()));
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
          type: 'chain',
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
        type: 'function',
        name: funcMatch ? `${funcMatch[1]}()` : 'function()',
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
        type: 'root',
        name: root,
        children: [],
        depth: relativeDepth,
        priority: Priority.CHAINING,
      };
      roots.push(currentChain);
    } else if (isConditional(line)) {
      const condMatch = line.match(/(if|else|switch)\s*\(([^)]+)\)/);
      const condName = condMatch ? `${condMatch[1]} (${condMatch[2]})` : line.trim();
      roots.push({
        type: 'condition',
        name: condName,
        children: [],
        depth: relativeDepth,
        priority: Priority.CONDITIONAL,
      });
      currentChain = null;
    } else if (isLoop(line)) {
      roots.push({
        type: 'loop',
        name: 'loop',
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
  const prefix = indent === 0 ? '' : ' '.repeat((indent - 1) * 4) + ' └─ ';

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
    rawCode: added.join('\n'),
    removedCode: removed.join('\n'),
  };
}

/**
 * Generate the complete Reader Markdown document
 */
export function generateReaderMarkdown(
  diffText: string,
  meta: ReaderMarkdownMeta = {}
): string {
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

  const sections: string[] = [];
  const lang = isJSX ? 'tsx' : 'typescript';

  // ── Header ──────────────────────────────────────────────
  sections.push('# 📖 GitHub Reader View\n');
  sections.push('> Generated by **github-mobile-reader**');
  if (meta.repo)   sections.push(`> Repository: ${meta.repo}`);
  if (meta.pr)     sections.push(`> Pull Request: #${meta.pr}`);
  if (meta.commit) sections.push(`> Commit: \`${meta.commit}\``);
  if (meta.file)   sections.push(`> File: \`${meta.file}\``);
  sections.push('\n');

  // ── Logical Flow ─────────────────────────────────────────
  if (flowTree.length > 0) {
    sections.push('## 🧠 Logical Flow\n');
    sections.push('```');
    sections.push(...renderFlowTree(flowTree));
    sections.push('```\n');
  }

  // ── JSX Structure (JSX only) ─────────────────────────────
  if (isJSX && jsxTree.length > 0) {
    sections.push('## 🎨 JSX Structure\n');
    sections.push('```');
    sections.push(...renderFlowTree(jsxTree));
    sections.push('```\n');
  }

  // ── Style Changes (JSX only) ─────────────────────────────
  if (isJSX && classNameChanges.length > 0) {
    sections.push('## 💅 Style Changes\n');
    sections.push(...renderStyleChanges(classNameChanges));
    sections.push('');
  }

  // ── Added Code ───────────────────────────────────────────
  if (rawCode.trim()) {
    sections.push('## ✅ Added Code\n');
    sections.push(`\`\`\`${lang}`);
    sections.push(rawCode);
    sections.push('```\n');
  }

  // ── Removed Code ─────────────────────────────────────────
  if (removedCode.trim()) {
    sections.push('## ❌ Removed Code\n');
    sections.push(`\`\`\`${lang}`);
    sections.push(removedCode);
    sections.push('```\n');
  }

  // ── Footer ───────────────────────────────────────────────
  sections.push('---');
  sections.push('🛠 Auto-generated by [github-mobile-reader](https://github.com/your-org/github-mobile-reader). Do not edit manually.');

  return sections.join('\n');
}
