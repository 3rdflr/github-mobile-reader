# 📖 github-mobile-reader

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
## 📄 `src/components/UserProfileModal.tsx`

> 💡 Added a delete account confirmation input and Trash2 icon button.
> handleDeleteAccount now validates deleteConfirmInput before calling deleteAccount asynchronously.

### ❌ `loadProfile` _(Function)_ — removed
_Context: `router`_

### ✏️ `UserProfileModal` _(Function)_ — changed
**Behavior**
+ `setShowDeleteConfirm()` called
+ `setDeleteConfirmInput()` called
**UI**
+ `<button>`
+ `<Trash2>`
+ `<input>`

### ✏️ `handleDeleteAccount` _(Function)_ — changed
**Behavior**
+ condition: deleteConfirmInput !== '탈퇴'
+ `setIsDeleting()` called
+ `deleteAccount(` async call
```

---

## Features

- **Per-function summaries** — each function/component gets its own section with status (added / removed / changed)
- **Context inline** — simple variable assignments (`router`, `user`, etc.) appear as `_Context: ..._` instead of noisy independent sections
- **Behavior changes** — detects newly called functions and added conditions
- **UI changes** — detects added/removed JSX components (generic tags like `div`, `span` are filtered)
- **Props changes** — detects TypeScript interface/type modifications
- **JSX semantic patterns** — `🔄 list → <Component>` (map), `⚡ cond && <Component>` (conditional rendering)
- **Gemini AI summaries** (optional) — 1–3 sentence natural language summary per file (`> 💡 ...`)
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
name: 📖 Mobile Reader

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write       # commit the generated .md file
  pull-requests: write  # post the PR comment

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
          github_token: ${{ secrets.GITHUB_TOKEN }}
          base_branch: ${{ github.base_ref }}
          output_dir: docs/reader
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}  # optional
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Post PR Comment
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const path = './reader-output/pr-${{ github.event.pull_request.number }}.md';
            if (!fs.existsSync(path)) { console.log('No reader file generated.'); return; }
            const body = fs.readFileSync(path, 'utf8');
            const comments = await github.rest.issues.listComments({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: ${{ github.event.pull_request.number }},
            });
            const prev = comments.data.find(c =>
              c.user.login === 'github-actions[bot]' && c.body.startsWith('# 📖 PR #')
            );
            if (prev) await github.rest.issues.deleteComment({
              owner: context.repo.owner, repo: context.repo.repo, comment_id: prev.id,
            });
            await github.rest.issues.createComment({
              owner: context.repo.owner, repo: context.repo.repo,
              issue_number: ${{ github.event.pull_request.number }}, body,
            });
```

### Step 2 — Open a PR

Every subsequent PR will automatically receive:
- A Reader Markdown file at `docs/reader/pr-<number>.md`
- A summary comment on the PR

### Action Inputs

| Input            | Required | Default       | Description                                        |
| ---------------- | -------- | ------------- | -------------------------------------------------- |
| `github_token`   | ✅       | —             | Use `${{ secrets.GITHUB_TOKEN }}`                  |
| `base_branch`    | ❌       | `main`        | Base branch the PR is merging into                 |
| `output_dir`     | ❌       | `docs/reader` | Directory for generated `.md` files                |
| `gemini_api_key` | ❌       | —             | Gemini API key — omit to disable AI summaries      |

---

## Gemini AI Summaries (optional)

Even complex hooks like `useCanvasRenderer` (200+ lines) get summarized in 1–3 sentences.
Without an API key, behavior is identical to before — no errors, no fallback output.

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
3. Add `gemini_api_key: ${{ secrets.GEMINI_API_KEY }}` to the workflow (see example above)

> **Security:** GitHub Secrets are masked in all workflow logs and never exposed in plain text.

---

## Output Format

```markdown
# 📖 PR #1 — feat: add account deletion

> Repository: owner/repo
> Commit: `a1b2c3d`
> Changed JS/TS files: 3

---

## 📄 `src/components/UserProfileModal.tsx`

> 💡 AI-generated 1–3 sentence summary (when GEMINI_API_KEY is set)

### ✅ `newFunction` _(Function)_ — added
_Context: `depVar1`, `depVar2`_
**Behavior**
+ `someApi(` async call
**UI**
+ `<NewComponent>`

### ❌ `oldFunction` _(Function)_ — removed

### ✏️ `changedFunction` _(Function)_ — changed
**Props**
+ `newProp: string`
- `oldProp: number`
**Behavior**
+ condition: value !== 'confirm'
**JSX patterns**
🔄 `items` → `<ItemCard>`
⚡ `isVisible` && `<Modal>`
```

### Symbol classification

| Label | Meaning |
| --- | --- |
| `✅ ... — added` | Function/component newly introduced in the diff |
| `❌ ... — removed` | Function/component deleted in the diff |
| `✏️ ... — changed` | Existing function/component with modified content |
| `_Context: `var`_` | Simple variable assignment collapsed inline |

### 💅 Style Changes

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
  generateReaderMarkdown,  // diff → complete Markdown document
  parseDiffHunks,          // diff → DiffHunk[]
  attributeLinesToSymbols, // DiffHunk[] → SymbolDiff[]
  generateSymbolSections,  // SymbolDiff[] → string[]
} from 'github-mobile-reader';
```

#### `generateReaderMarkdown(diffText, meta?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `diffText` | `string` | Raw `git diff` output |
| `meta.pr` | `string?` | Pull request number |
| `meta.commit` | `string?` | Commit SHA |
| `meta.file` | `string?` | File name |
| `meta.repo` | `string?` | Repository in `owner/repo` format |

**Returns:** `string` — the complete Markdown document.

#### `SymbolDiff`

```ts
interface SymbolDiff {
  name: string;
  kind: 'component' | 'function' | 'setup';
  status: 'added' | 'removed' | 'modified';
  addedLines: string[];
  removedLines: string[];
}
```

---

## Language Support

The parser is optimized for JS/TS syntax patterns.

| Language | Extensions | Support |
| --- | --- | --- |
| JavaScript | `.js` `.mjs` `.cjs` | ✅ Full |
| TypeScript | `.ts` | ✅ Full |
| React JSX | `.jsx` | ✅ Full |
| React TSX | `.tsx` | ✅ Full |
| Others | — | 🔜 Planned |

---

## Project Structure

```
github-mobile-reader/
├── src/
│   ├── parser.ts    ← diff parsing and symbol analysis (core logic)
│   ├── gemini.ts    ← Gemini Flash AI summaries (opt-in)
│   ├── index.ts     ← public npm API
│   ├── action.ts    ← GitHub Action entry point
│   └── cli.ts       ← CLI entry point
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
