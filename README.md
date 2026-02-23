# github-mobile-reader

> Transform GitHub PR diffs into mobile-friendly Markdown — understand what changed per function without reading long code.

[![npm version](https://img.shields.io/npm/v/github-mobile-reader.svg)](https://www.npmjs.com/package/github-mobile-reader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

[한국어 문서 →](README.ko.md)

---

## The Problem

GitHub's mobile web renders code in a fixed-width monospace block. Long lines require horizontal scrolling, and deeply nested logic is impossible to read on a commute.

## The Solution

`github-mobile-reader` parses a git diff and produces a **per-function summary** — showing what each function/component added, removed, or changed rather than raw line diffs.

---

## Example Output

```markdown
# PR #7 — feat: add task filtering and sort controls

owner/repo · `3f8a21c` · JS/TS 3개 파일 변경

---

## `src/components/TodoList.tsx`

> 💡 Previously fetched all tasks unconditionally. Now accepts filter and sortOrder
> params — fetchTasks is called conditionally and filter state drives re-fetching.

**Import changes**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (removed)

**✏️ `TodoList`** _(Component)_ — changed
  변수: `filter`, `sortOrder`
  + (state) `filter` ← `useState({})`
  ~ `useEffect` deps 변경

**✏️ `fetchTasks`** _(Function)_ — changed
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (guard) `!filter` → early return
  + (API) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — added
  파라미터+ `field`
  파라미터+ `value`
  + (setState) `setFilter({...filter, [field]: value})`
```

---

## Features

- **Per-function summaries** — each function/component gets its own bold line with status (added / removed / changed); no `###` headings, normal font size on mobile
- **Side-effect labels** — behavior lines are prefixed with `(API)`, `(setState)`, `(state)`, `(cond)`, `(catch)`, `(guard)` so you can tell at a glance what kind of change it is
- **Guard clause detection** — `if (!x) return` patterns surfaced as `(guard) early return` entries
- **Import changes** — newly added or removed imports at the file level
- **Parameter changes** — added or removed function parameters (capped at 4, rest shown as `… 외 N개`)
- **Variables** — simple variable assignments attached to the nearest function shown inline (capped at 5)
- **UI changes** — added/removed JSX components (generic tags like `div`, `span` are filtered); map and conditional rendering patterns
- **Props changes** — TypeScript interface/type member changes (capped at 5; long string values abbreviated to `'...'`)
- **useEffect deduplication** — if the same `useEffect` appears in both added and removed sides, shown once as `~ useEffect deps 변경` instead of duplicating
- **Cross-file refactoring detection** — symbols removed in one file and added in another within the same PR are classified as `📦 moved` rather than `❌ removed`
- **False-removed prevention** — symbols that still appear in context lines of the diff are reclassified from `removed` to `modified`
- **Syntactically incomplete line filtering** — mid-expression fragments (unbalanced parentheses, lines starting with `)`, trailing operators) are excluded before analysis
- **Empty section suppression** — `modified` symbols with no detectable changes are silently omitted
- **Behavior summary prioritization** — output lines ranked by signal type: state/API (max 4) → guard/catch (max 2) → cond (max 2) → setState/useEffect/return (max 2)
- **Test file summaries** — test/spec files show grouped `describe`/`it` block names instead of code analysis
- **Config file summaries** — vitest/jest/vite config changes show added/removed plugins instead of code analysis
- **Gemini AI summaries** (optional) — focuses on business logic change and side effects, not raw lines (`> 💡 ...`)
- **Secure by default** — tokens are injected via environment variables only; no flag that leaks to shell history

---

## Table of Contents

1. [CLI Usage](#cli-usage)
2. [GitHub Action](#github-action)
3. [Gemini AI Summaries (optional)](#gemini-ai-summaries-optional)
4. [Output Format](#output-format)
5. [npm Library Usage](#npm-library-usage)
6. [Language Support](#language-support)
7. [Project Structure](#project-structure)
8. [Contributing](#contributing)

---

## CLI Usage

Run directly with `npx` — no setup or config file needed.

### Authentication

```bash
export GITHUB_TOKEN=ghp_xxxx
```

> **Security note:** The CLI does not accept a `--token` flag. Passing secrets as CLI arguments exposes them in shell history and `ps` output.

### Single PR

```bash
npx github-mobile-reader --repo owner/repo --pr 42
```

### Single PR with Gemini AI summaries

```bash
GEMINI_API_KEY=AIzaSy... npx github-mobile-reader --repo owner/repo --pr 42
```

### All recent PRs

```bash
npx github-mobile-reader --repo owner/repo --all --limit 20
```

### Options

| Flag           | Default           | Description                                         |
| -------------- | ----------------- | --------------------------------------------------- |
| `--repo`       | *(required)*      | Repository in `owner/repo` format                   |
| `--pr`         | —                 | Process a single PR by number                       |
| `--all`        | —                 | Process all recent PRs (use with `--limit`)         |
| `--out`        | `./reader-output` | Output directory — relative paths only, no `..`     |
| `--limit`      | `10`              | Max number of PRs to fetch when using `--all`       |
| `--gemini-key` | —                 | Gemini API key (or set `GEMINI_API_KEY` env var)    |

Token: read from `$GITHUB_TOKEN` (60 req/hr unauthenticated, 5,000 req/hr authenticated).

Each PR produces one file: `reader-output/pr-<number>.md`

---

## GitHub Action

Automatically generates a Reader document and posts a comment on every PR.

### Step 1 — Add the workflow file

Create `.github/workflows/mobile-reader.yml`:

```yaml
name: Mobile Reader

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  issues: write

jobs:
  generate-reader:
    name: Generate Mobile Reader View
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Generate Reader Markdown
        run: npx github-mobile-reader@latest --repo ${{ github.repository }} --pr ${{ github.event.pull_request.number }} --out ./reader-output
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Post PR Comment
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          FILE="./reader-output/pr-${PR_NUMBER}.md"
          if [ ! -f "$FILE" ]; then
            echo "No reader file generated."
            exit 0
          fi

          # Delete previous bot comment if exists
          PREV_ID=$(gh api repos/${{ github.repository }}/issues/${PR_NUMBER}/comments \
            --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("# PR #"))) | .id' \
            | head -1)
          if [ -n "$PREV_ID" ]; then
            gh api -X DELETE repos/${{ github.repository }}/issues/comments/${PREV_ID}
          fi

          gh pr comment ${PR_NUMBER} --repo ${{ github.repository }} --body-file "$FILE"
```

### Step 2 — Open a PR

Every subsequent PR will automatically receive a summary comment.

---

## Gemini AI Summaries (optional)

Even complex hooks like `useCanvasRenderer` (200+ lines) get summarized in 1–3 sentences.
Without an API key, behavior is identical — no errors, no fallback output.

Uses **Gemini 2.5 Flash Lite** — fast, low-cost, no thinking overhead.

### Get a free API key

[aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### CLI

```bash
# via environment variable (recommended)
GEMINI_API_KEY=AIzaSy... npx github-mobile-reader --repo owner/repo --pr 42

# via flag
npx github-mobile-reader --repo owner/repo --pr 42 --gemini-key AIzaSy...
```

### GitHub Action

1. Go to **Settings → Secrets and variables → Actions → New repository secret**
2. Name: `GEMINI_API_KEY`, Value: your key
3. Add `--gemini-key ${{ secrets.GEMINI_API_KEY }}` to the `Generate Reader Markdown` step

> **Security:** GitHub Secrets are masked in all workflow logs and never exposed in plain text.

---

## Output Format

```markdown
# PR #7 — feat: add task filtering and sort controls

owner/repo · `3f8a21c` · JS/TS 3개 파일 변경

---

## `src/components/TodoList.tsx`

> 💡 Previously fetched all tasks unconditionally. Now accepts filter and sortOrder
> params — fetchTasks is called conditionally and filter state drives re-fetching.

**Import changes**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (removed)

**✏️ `TodoList`** _(Component)_ — changed
  변수: `filter`, `sortOrder`
  + (state) `filter` ← `useState({})`
  ~ `useEffect` deps 변경

**✏️ `fetchTasks`** _(Function)_ — changed
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (guard) `!filter` → early return
  + (API) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — added
  파라미터+ `field`
  파라미터+ `value`
  + (setState) `setFilter({...filter, [field]: value})`

**✏️ `TaskCard`** _(Component)_ — changed
  Props+ `dueDate: '...'`
  + (cond) `!task.completed`
  UI: `<Badge>`
```

### Symbol classification

| Label | Meaning |
| --- | --- |
| `✅ ... — added` | Function/component newly introduced in the diff |
| `❌ ... — removed` | Function/component deleted in the diff |
| `✏️ ... — changed` | Existing function/component with modified content |
| `📦 ... — moved` | Symbol removed here and added in another file within the same PR |
| `변수: x, y` | Simple variable assignments collapsed inline (up to 5, rest shown as `외 N개`) |

### Line prefixes

| Prefix | Meaning |
| --- | --- |
| `+` | Added behavior |
| `-` | Removed behavior |
| `~` | Changed behavior (same signal in both added and removed sides, e.g. `useEffect` deps) |
| `(API)` | `await` call — fetches data from a server or external service |
| `(setState)` | `setState` call — updates React state |
| `(state)` | Hook assignment — `const x = useHook()` |
| `(cond)` | `if / else if` branch |
| `(guard)` | Guard clause — `if (!x) return` early-exit pattern |
| `(catch)` | `catch` block |
| `(return)` | Non-trivial return value |
| `파라미터+` / `파라미터-` | Function parameter added / removed (up to 4) |
| `Props+` / `Props-` | TypeScript interface/type member added / removed (up to 5) |
| `UI:` | JSX component added or removed |

---

## npm Library Usage

```bash
npm install github-mobile-reader
```

```ts
import { generateReaderMarkdown } from 'github-mobile-reader';
import { execSync } from 'child_process';

const diff = execSync('git diff HEAD~1 HEAD', { encoding: 'utf8' });
const markdown = generateReaderMarkdown(diff, {
  pr: '42',
  commit: 'a1b2c3d',
  file: 'src/api/users.ts',
  repo: 'my-org/my-repo',
});

console.log(markdown);
```

### Public API

```ts
import {
  generateReaderMarkdown,    // diff → complete Markdown document
  parseDiffHunks,            // diff → DiffHunk[]
  attributeLinesToSymbols,   // DiffHunk[] → SymbolDiff[]
  generateSymbolSections,    // SymbolDiff[] → string[]
  extractImportChanges,      // detect added/removed imports
  extractParamChanges,       // detect added/removed function parameters
  extractRemovedSymbolNames, // diff → string[] (purely removed symbol names)
  extractAddedSymbolNames,   // diff → string[] (purely added symbol names)
} from 'github-mobile-reader';
```

#### `generateReaderMarkdown(diffText, meta?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `diffText` | `string` | Raw `git diff` output |
| `meta.pr` | `string?` | Pull request number |
| `meta.commit` | `string?` | Commit SHA |
| `meta.file` | `string?` | File name (used to detect test/config files) |
| `meta.repo` | `string?` | Repository in `owner/repo` format |
| `meta.movedOutMap` | `Map<string, string>?` | Symbol → destination file (for cross-file move annotation) |
| `meta.movedIntoThisFile` | `Set<string>?` | Symbol names that moved into this file from another |

**Returns:** `string` — the complete Markdown document.

#### `SymbolDiff`

```ts
interface SymbolDiff {
  name: string;
  kind: 'component' | 'function' | 'setup';
  status: 'added' | 'removed' | 'modified' | 'moved';
  addedLines: string[];
  removedLines: string[];
  movedTo?: string;   // destination file when status === 'moved'
  movedFrom?: string; // source file when status === 'moved'
}
```

---

## Language Support

The parser is optimized for JS/TS syntax patterns.

| Language | Extensions | Support |
| --- | --- | --- |
| JavaScript | `.js` `.mjs` `.cjs` | Full |
| TypeScript | `.ts` | Full |
| React JSX | `.jsx` | Full |
| React TSX | `.tsx` | Full |
| Others | — | Planned |

---

## Project Structure

```
github-mobile-reader/
├── src/
│   ├── parser.ts    ← diff parsing and symbol analysis (core logic)
│   ├── gemini.ts    ← Gemini 2.5 Flash Lite AI summaries (opt-in)
│   ├── index.ts     ← public npm API
│   ├── action.ts    ← GitHub Action entry point
│   └── cli.ts       ← CLI entry point (2-pass cross-file analysis)
├── dist/            ← compiled output (auto-generated)
├── reader-output/   ← CLI output directory (gitignored)
├── action.yml       ← GitHub Action definition
└── package.json
```

---

## Contributing

```bash
git clone https://github.com/3rdflr/github-mobile-reader.git
cd github-mobile-reader
npm install
npm run build:all   # build library + Action + CLI
```

Pull requests are welcome.

---

## License

MIT © [3rdflr](https://github.com/3rdflr)
