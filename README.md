# 📖 github-mobile-reader

> `github-mobile-reader` transforms raw git diffs into clean, vertically-scrollable Markdown — no more pinch-zooming or swiping left and right to read a single line.

[![npm version](https://img.shields.io/npm/v/github-mobile-reader.svg)](https://www.npmjs.com/package/github-mobile-reader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

---

## The Problem

GitHub's mobile web view renders code in a fixed-width monospace block. Long lines require horizontal scrolling, deeply nested logic is invisible at a glance, and reviewing a PR on a commute is practically impossible.

## The Solution

`github-mobile-reader` parses a git diff and produces a **Logical Flow** — a compact tree that shows _what the code does_, not just what characters changed. The result is a Markdown document that reads top-to-bottom on any screen width.

**Before** (raw diff, mobile web):

```
← swipe → swipe → swipe →
+ const result = data.map(item => item.value).filter(v => v > 10).reduce((a,b) => a+b, 0)
```

**After** (Reader Markdown):

```
data
 └─ map(item → value)
     └─ filter(callback)
         └─ reduce(callback)
```

---

## Features

- **Zero-dependency core** — the parser runs anywhere Node.js ≥ 18 is available
- **Dual output format** — CJS (`require`) and ESM (`import`) with full TypeScript types
- **GitHub Action** — drop one YAML block into any repo and get auto-generated Reader docs on every PR
- **Tracks both sides of a diff** — shows added _and_ removed code in separate sections
- **Conservative by design** — when a pattern is ambiguous, the library shows less rather than showing something wrong

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Language Support](#language-support)
3. [GitHub Action (recommended)](#github-action-recommended)
4. [npm Library Usage](#npm-library-usage)
5. [Output Format](#output-format)
6. [API Reference](#api-reference)
7. [How the Parser Works](#how-the-parser-works)
8. [Contributing](#contributing)
9. [License](#license)

---

## Language Support

The parser is built on regex-based pattern matching, so it can technically receive a diff from any language. However, the detection patterns are tuned to JavaScript/TypeScript syntax, which means the **quality of the Logical Flow output varies by language**.

### Current support (v0.1)

| Language                   | Extensions                |   Flow Quality    | Notes                                                                                   |
| -------------------------- | ------------------------- | :---------------: | --------------------------------------------------------------------------------------- |
| **JavaScript**             | `.js` `.mjs` `.cjs`       |      ✅ Full      | Baseline target language                                                                |
| **TypeScript**             | `.ts`                     |      ✅ Full      | JS superset — all patterns apply                                                        |
| **React JSX**              | `.jsx`                    |      ✅ Full      | Same syntax as JS                                                                       |
| **React TSX**              | `.tsx`                    |      ✅ Full      | Same syntax as TS                                                                       |
| **Next.js**                | `.js` `.ts` `.jsx` `.tsx` |      ✅ Full      | Framework on top of JS/TS                                                               |
| **Java**                   | `.java`                   | ⚠️ Partial (~55%) | `if/for/while` and dot-chaining work; function declarations missed (no `const/let/var`) |
| **C#**                     | `.cs`                     | ⚠️ Partial (~35%) | LINQ chaining (`.Where().Select()`) works; `using`/`namespace`/`class` not detected     |
| **C**                      | `.c` `.h`                 | ❌ Minimal (~15%) | No matching keywords; pointer syntax (`->`, `*`) not understood                         |
| **Python, Go, Rust, etc.** | —                         |    🔜 Planned     | See roadmap below                                                                       |

> **Note:** Java, C#, and C files are not processed by the GitHub Action by default.
> The Action only scans `.js .jsx .ts .tsx .mjs .cjs` files ([`src/action.ts` line 66](src/action.ts)).
> To process other languages you would need a custom adapter (see [Contributing](#contributing)).

### Why JS/TS/React/Next.js work fully

All four share the same underlying syntax. The parser recognises:

- **Method chaining** — line starting with `.` after a line ending with `)` or `}`
  ```ts
  data
    .filter((item) => item.active) // detected as P1 chain
    .map((item) => item.value); // detected as P1 chain
  ```
- **Function declarations** — `const`, `let`, `var`, `function`, `async`
- **Conditionals** — `if / else / switch`
- **Loops** — `for / while`
- **Noise filtering** — `import`, `export`, `type`, `interface`, `console.log` are silently dropped

### Why C / C# / Java are limited

These languages use different conventions for the patterns above:

| Concept              | JS/TS (✅ detected)    | Java / C# / C (❌ missed)        |
| -------------------- | ---------------------- | -------------------------------- |
| Variable declaration | `const x = …`          | `int x = …` / `String x = …`     |
| Arrow callbacks      | `x => x.value`         | Lambdas differ per language      |
| Noise imports        | `import` / `export`    | `using` / `#include` / `package` |
| Async functions      | `async function foo()` | `async Task<T> Foo()`            |

### Roadmap — Language Adapter system (v0.2)

To support additional languages, a **Language Adapter** architecture is planned:

```
src/languages/
├── base.adapter.ts     ← shared interface
├── js-ts.adapter.ts    ← current logic (promoted from parser.ts)
├── java.adapter.ts     ← public/private/void declarations, Stream chaining
└── csharp.adapter.ts   ← using/namespace, LINQ chaining
```

Each adapter will declare:

- Supported file extensions
- Function-declaration detection pattern
- Keywords to ignore (noise list)
- Chaining notation (dot vs. arrow `->`)

If you'd like to contribute an adapter for your language, see [Contributing](#contributing).

---

## Quick Start

```bash
npm install github-mobile-reader
```

```ts
import { generateReaderMarkdown } from "github-mobile-reader";
import { execSync } from "child_process";

const diff = execSync("git diff HEAD~1", { encoding: "utf8" });
const markdown = generateReaderMarkdown(diff, { file: "src/utils.ts" });

console.log(markdown);
```

---

## GitHub Action (recommended)

The easiest way to use this library is as a GitHub Action. On every pull request it will:

1. Parse the diff of all changed `.js` / `.ts` files
2. Write a Reader Markdown file to `docs/reader/pr-<number>.md` inside your repo
3. Post a summary comment directly on the PR

### Step 1 — Add the workflow file

Create `.github/workflows/mobile-reader.yml` in your repository:

```yaml
name: 📖 Mobile Reader

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write # commit the generated .md file
  pull-requests: write # post the PR comment

jobs:
  generate-reader:
    name: Generate Mobile Reader View
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # full history required for git diff

      - name: Generate Reader Markdown
        uses: 3rdflr/github-mobile-reader@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          base_branch: ${{ github.base_ref }}
          output_dir: docs/reader
        env:
          PR_NUMBER: ${{ github.event.pull_request.number }}

      - name: Commit Reader Markdown
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/reader/
          if git diff --cached --quiet; then
            echo "No changes to commit"
          else
            git commit -m "docs(reader): update mobile reader for PR #${{ github.event.pull_request.number }} [skip ci]"
            git push
          fi
```

### Step 2 — Open a PR

That's it. Every subsequent PR will automatically get:

- A Reader Markdown file at `docs/reader/pr-<number>.md`
- A comment on the PR linking to the generated file

### Action Inputs

| Input          | Required | Default       | Description                         |
| -------------- | -------- | ------------- | ----------------------------------- |
| `github_token` | ✅       | —             | Use `${{ secrets.GITHUB_TOKEN }}`   |
| `base_branch`  | ❌       | `main`        | The branch the PR is merging into   |
| `output_dir`   | ❌       | `docs/reader` | Directory for generated `.md` files |

---

## npm Library Usage

Use `github-mobile-reader` as a plain library in any Node.js project — CI scripts, custom bots, local tooling, etc.

### Installation

```bash
# npm
npm install github-mobile-reader

# pnpm
pnpm add github-mobile-reader

# yarn
yarn add github-mobile-reader
```

### CommonJS

```js
const { generateReaderMarkdown } = require("github-mobile-reader");
```

### ESM / TypeScript

```ts
import {
  generateReaderMarkdown,
  parseDiffToLogicalFlow,
} from "github-mobile-reader";
```

### Basic Example

```ts
import { generateReaderMarkdown } from "github-mobile-reader";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

// Get the diff for the last commit
const diff = execSync("git diff HEAD~1 HEAD", { encoding: "utf8" });

// Generate Reader Markdown with metadata
const markdown = generateReaderMarkdown(diff, {
  pr: "42",
  commit: "a1b2c3d",
  file: "src/api/users.ts",
  repo: "my-org/my-repo",
});

// Write to a file or post to Slack / Discord / GitHub
writeFileSync("reader.md", markdown, "utf8");
```

### Low-level API Example

If you only need the parsed tree (e.g. to build your own renderer):

```ts
import { parseDiffToLogicalFlow, renderFlowTree } from "github-mobile-reader";

const { root, rawCode, removedCode } = parseDiffToLogicalFlow(diff);

// root  → FlowNode[]  (the logical tree)
// rawCode     → string  (added lines, joined)
// removedCode → string  (removed lines, joined)

const treeLines = renderFlowTree(root);
console.log(treeLines.join("\n"));
```

---

## Output Format

A generated Reader Markdown document has four sections:

```markdown
# 📖 GitHub Reader View

> Generated by **github-mobile-reader**
> Repository: my-org/my-repo
> Pull Request: #42
> Commit: `a1b2c3d`
> File: `src/api/users.ts`

---

## 🧠 Logical Flow
```

getData()
└─ filter(callback)
└─ map(item → value)
└─ reduce(callback)

````

## ✅ Added Code

```typescript
const result = getData()
  .filter(item => item.active)
  .map(item => item.value)
  .reduce((a, b) => a + b, 0)
````

## ❌ Removed Code

```typescript
const result = getData().map((item) => item.value);
```

---

🛠 Auto-generated by github-mobile-reader. Do not edit manually.

````

---

## API Reference

### `generateReaderMarkdown(diffText, meta?)`

The main entry point. Parses a raw git diff string and returns a complete Reader Markdown document.

| Parameter | Type | Description |
|-----------|------|-------------|
| `diffText` | `string` | Raw output of `git diff` |
| `meta.pr` | `string?` | Pull request number |
| `meta.commit` | `string?` | Commit SHA |
| `meta.file` | `string?` | File name shown in the header |
| `meta.repo` | `string?` | Repository in `owner/repo` format |

**Returns:** `string` — the complete Markdown document.

---

### `parseDiffToLogicalFlow(diffText)`

Parses a diff into a structured result without rendering.

**Returns:** `ParseResult`

```ts
interface ParseResult {
  root: FlowNode[]    // logical tree (added lines)
  rawCode: string     // added lines joined with \n
  removedCode: string // removed lines joined with \n
}
````

---

### `renderFlowTree(nodes, indent?)`

Converts a `FlowNode[]` tree into an array of Markdown-safe text lines.

```ts
const lines = renderFlowTree(root);
// [ 'getData()', ' └─ filter(callback)', ' └─ map(item → value)' ]
```

---

### `FlowNode`

```ts
interface FlowNode {
  type: "root" | "chain" | "condition" | "loop" | "function" | "call";
  name: string;
  children: FlowNode[];
  depth: number;
  priority: Priority;
}
```

---

### `Priority` (enum)

| Value             | Meaning                                                     |
| ----------------- | ----------------------------------------------------------- |
| `CHAINING = 1`    | Method chains (`.map()`, `.filter()`, …) — highest priority |
| `CONDITIONAL = 2` | `if` / `else` / `switch` blocks                             |
| `LOOP = 3`        | `for` / `while` loops                                       |
| `FUNCTION = 4`    | Function declarations                                       |
| `OTHER = 5`       | Everything else                                             |

---

## How the Parser Works

The parser runs a deterministic pipeline — no AI, no external dependencies.

```
git diff text
  │
  ▼
1. filterDiffLines()     — split + and - lines, strip +++ / --- headers
  │
  ▼
2. normalizeCode()       — remove ; comments, trim whitespace
  │
  ▼
3. getIndentDepth()      — calculate nesting level (2 spaces = 1 level)
  │
  ▼
4. parseToFlowTree()     — match patterns in priority order:
  │                          P1 chaining  (.map .filter .reduce …)
  │                          P2 conditional  (if / else / switch)
  │                          P3 loop  (for / while)
  │                          P4 function declaration
  │
  ▼
5. renderFlowTree()      — convert tree → indented text lines
  │
  ▼
generateReaderMarkdown() — assemble the final Markdown document
```

**Key design decisions:**

- **Conservative** — lines that cannot be classified are silently skipped rather than misrepresented.
- **Imports / exports / types / interfaces / console.log** are ignored; they do not contribute to understanding flow.
- **Callback arguments** are simplified: `.map(item => item.value)` becomes `map(item → value)` when the body is a single property access; otherwise it becomes `map(callback)`.
- **Depth** is tracked via indentation (2-space baseline) and used only as a fallback when chaining detection is ambiguous.

### Supported Languages (v0.1)

See the full breakdown in the [Language Support](#language-support) section.
In short: **JS / TS / React / Next.js are fully supported**; Java and C# are partial; C and others are planned via the Language Adapter system (v0.2).

---

## Contributing

Pull requests are welcome! Here's how to get started:

```bash
# Clone the repo
git clone https://github.com/3rdflr/github-mobile-reader.git
cd github-mobile-reader

# Install dependencies
npm install

# Build (library + action runner)
npm run build:all

# Watch mode during development
npm run dev
```

### Project Structure

```
github-mobile-reader/
├── src/
│   ├── parser.ts     ← core diff → logical flow parser
│   ├── index.ts      ← public npm API surface
│   └── action.ts     ← GitHub Action entry point
├── dist/             ← compiled output (auto-generated, do not edit)
├── .github/
│   └── workflows/
│       └── mobile-reader.yml   ← example workflow for consumers
├── action.yml        ← GitHub Action definition
├── package.json
└── tsconfig.json
```

### Adding Support for a New Language

The parser currently relies on JS/TS syntax heuristics (dot-chaining, `const`/`let`/`var`, `function`, `if`/`for`/`while`). To add a new language:

1. Add detection helpers in `src/parser.ts` (follow the existing `isChaining`, `isConditional` pattern)
2. Update `filterDiffLines` to handle the new file extension
3. Open a PR with a test diff as an example

---

## License

MIT © [3rdflr](https://github.com/3rdflr)

---
