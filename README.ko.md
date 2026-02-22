# 📖 github-mobile-reader

> GitHub PR diff를 모바일에서 읽기 좋은 Markdown으로 변환합니다.
> 긴 코드를 읽지 않아도 **함수 단위로 무엇이 바뀌었는지** 한눈에 파악할 수 있습니다.

[![npm version](https://img.shields.io/npm/v/github-mobile-reader.svg)](https://www.npmjs.com/package/github-mobile-reader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

[English →](README.md)

---

## 왜 만들었나

GitHub 모바일 웹에서 PR을 리뷰하면 코드가 고정폭 블록으로 렌더링됩니다.
긴 줄은 가로 스크롤이 필요하고, 깊게 중첩된 로직은 한눈에 들어오지 않습니다.

`github-mobile-reader`는 diff를 파싱해 **함수/컴포넌트 단위로 변경 내용을 요약**합니다.
어떤 함수가 추가/삭제/수정됐는지, 어떤 상태나 UI가 바뀌었는지를 짧게 보여줍니다.

---

## 출력 예시

```markdown
## 📄 `src/components/UserProfileModal.tsx`

> 💡 회원 탈퇴 확인 입력창과 Trash2 아이콘 버튼을 추가하고, deleteConfirmInput 검증 후
> deleteAccount API를 비동기 호출하는 흐름으로 handleDeleteAccount를 변경함.

### ❌ `loadProfile` _(Function)_ — 제거됨
_Context: `router`_

### ✏️ `UserProfileModal` _(Function)_ — 변경됨
**동작 변화**
+ `setShowDeleteConfirm()` 호출
+ `setDeleteConfirmInput()` 호출
**UI 변화**
+ `<button>`
+ `<Trash2>`
+ `<input>`

### ✏️ `handleDeleteAccount` _(Function)_ — 변경됨
**동작 변화**
+ 조건: deleteConfirmInput !== '탈퇴'
+ `setIsDeleting()` 호출
+ `deleteAccount(` 비동기 호출
```

---

## 주요 기능

- **함수 단위 요약** — 파일 전체가 아닌 함수/컴포넌트별로 변경 내용을 정리
- **상태 표시** — ✅ 새로 추가 / ❌ 제거됨 / ✏️ 변경됨
- **Context 인라인** — 단순 변수 할당(`router`, `user` 등)은 독립 섹션 대신 `_Context: ..._`로 요약
- **동작 변화** — 새로 호출된 함수, 추가된 조건 감지
- **UI 변화** — 추가/제거된 JSX 컴포넌트 감지 (div, span 등 제네릭 태그 제외)
- **Props 변화** — TypeScript 인터페이스/타입 변경 감지
- **JSX 시맨틱 패턴** — `🔄 list → <Component>` (map), `⚡ cond && <Component>` (조건부 렌더링)
- **Gemini AI 요약** (선택) — 복잡한 함수도 1~3줄로 자연어 요약 (`> 💡 ...`)
- **보안** — 토큰은 환경변수로만 주입; 코드에 하드코딩 불가

---

## 목차

1. [CLI 사용법](#cli-사용법)
2. [GitHub Action](#github-action)
3. [Gemini AI 요약 설정](#gemini-ai-요약-설정-선택)
4. [출력 형식 상세](#출력-형식-상세)
5. [npm 라이브러리 사용](#npm-라이브러리-사용)
6. [지원 언어](#지원-언어)
7. [프로젝트 구조](#프로젝트-구조)
8. [기여](#기여)

---

## CLI 사용법

별도 설치 없이 `npx`로 바로 실행합니다.

### 인증

```bash
export GITHUB_TOKEN=ghp_xxxx
```

> `--token` 플래그는 지원하지 않습니다. 셸 히스토리와 `ps` 출력에 토큰이 노출되기 때문입니다.

### 단일 PR

```bash
npx github-mobile-reader --repo owner/repo --pr 42
```

### 최근 PR 전체

```bash
npx github-mobile-reader --repo owner/repo --all --limit 20
```

### 옵션

| 플래그          | 기본값            | 설명                                              |
| --------------- | ----------------- | ------------------------------------------------- |
| `--repo`        | *(필수)*          | `owner/repo` 형식의 저장소 이름                   |
| `--pr`          | —                 | 특정 PR 번호 처리                                 |
| `--all`         | —                 | 최근 PR 전체 처리 (`--limit`와 함께 사용)         |
| `--out`         | `./reader-output` | 출력 디렉터리 (상대 경로, `..` 불가)              |
| `--limit`       | `10`              | `--all` 사용 시 최대 PR 수                        |
| `--gemini-key`  | —                 | Gemini API 키 (또는 `GEMINI_API_KEY` 환경변수)    |

토큰: `$GITHUB_TOKEN` 환경변수에서 읽음 (미인증 60 req/hr, 인증 5,000 req/hr)

각 PR은 `reader-output/pr-<number>.md` 파일 하나를 생성합니다.

---

## GitHub Action

PR이 열릴 때마다 자동으로 Reader 문서를 생성하고 PR에 코멘트를 답니다.

### Step 1 — 워크플로우 파일 추가

`.github/workflows/mobile-reader.yml` 생성:

```yaml
name: 📖 Mobile Reader

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write       # 생성된 .md 파일 커밋
  pull-requests: write  # PR 코멘트 작성

jobs:
  generate-reader:
    name: Generate Mobile Reader View
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate Reader Markdown
        uses: 3rdflr/github-mobile-reader@v1
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          base_branch: ${{ github.base_ref }}
          output_dir: docs/reader
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}  # 선택 사항
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
            git commit -m "docs(reader): PR #${{ github.event.pull_request.number }} reader 업데이트 [skip ci]"
            git push
          fi
```

### Step 2 — PR 열기

이후 모든 PR에 자동으로:
- `docs/reader/pr-<number>.md` 생성 및 커밋
- PR에 요약 코멘트 게시

### Action 입력값

| 입력값           | 필수 | 기본값        | 설명                                              |
| ---------------- | ---- | ------------- | ------------------------------------------------- |
| `github_token`   | ✅   | —             | `${{ secrets.GITHUB_TOKEN }}` 사용                |
| `base_branch`    | ❌   | `main`        | PR이 병합될 기준 브랜치                           |
| `output_dir`     | ❌   | `docs/reader` | 생성 파일 저장 경로                               |
| `gemini_api_key` | ❌   | —             | Gemini AI 요약용 API 키 (없으면 AI 요약 비활성화) |

---

## Gemini AI 요약 설정 (선택)

`useCanvasRenderer` 같은 200줄짜리 hook도 1~3줄로 자연어 요약해줍니다.
API 키가 없으면 AI 요약 없이 기존과 동일하게 동작합니다.

### API 키 발급

[aistudio.google.com/apikey](https://aistudio.google.com/apikey) — 무료로 발급 가능

### CLI에서 사용

```bash
# 환경변수로 전달 (권장)
GEMINI_API_KEY=AIzaSy... npx github-mobile-reader --repo owner/repo --pr 42

# 플래그로 전달
npx github-mobile-reader --repo owner/repo --pr 42 --gemini-key AIzaSy...
```

### GitHub Action에서 사용

1. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
2. 이름: `GEMINI_API_KEY`, 값: 발급받은 키
3. 워크플로우에 `gemini_api_key: ${{ secrets.GEMINI_API_KEY }}` 추가 (위 예시 참고)

> **보안**: GitHub Secrets에 저장된 키는 워크플로우 로그에도 마스킹되어 절대 노출되지 않습니다.

---

## 출력 형식 상세

```markdown
# 📖 PR #1 — feat: 회원 탈퇴 기능 추가

> Repository: owner/repo
> Commit: `a1b2c3d`
> 변경된 JS/TS 파일: 3개

---

## 📄 `src/components/UserProfileModal.tsx`

> 💡 AI가 생성한 1~3줄 요약 (GEMINI_API_KEY 설정 시)

### ✅ `newFunction` _(Function)_ — 새로 추가
_Context: `depVar1`, `depVar2`_
**동작 변화**
+ `someApi(` 비동기 호출
**UI 변화**
+ `<NewComponent>`

### ❌ `oldFunction` _(Function)_ — 제거됨

### ✏️ `changedFunction` _(Function)_ — 변경됨
**Props 변화**
+ `newProp: string`
- `oldProp: number`
**동작 변화**
+ 조건: value !== 'confirm'
**JSX 패턴**
🔄 `items` → `<ItemCard>`
⚡ `isVisible` && `<Modal>`
```

### 심볼 분류 기준

| 표시 | 의미 |
| --- | --- |
| `✅ ... — 새로 추가` | diff에서 새로 등장한 함수/컴포넌트 |
| `❌ ... — 제거됨` | diff에서 사라진 함수/컴포넌트 |
| `✏️ ... — 변경됨` | 기존에 존재하고 내용이 수정된 함수/컴포넌트 |
| `_Context: `var`_` | 단순 변수 할당 등 독립 섹션이 불필요한 심볼 |

---

## npm 라이브러리 사용

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

### 공개 API

```ts
import {
  generateReaderMarkdown,  // diff → 완성된 Markdown 문서
  parseDiffHunks,          // diff → DiffHunk[]
  attributeLinesToSymbols, // DiffHunk[] → SymbolDiff[]
  generateSymbolSections,  // SymbolDiff[] → string[]
} from 'github-mobile-reader';
```

#### `generateReaderMarkdown(diffText, meta?)`

| 파라미터 | 타입 | 설명 |
| --- | --- | --- |
| `diffText` | `string` | `git diff` 원시 출력 |
| `meta.pr` | `string?` | PR 번호 |
| `meta.commit` | `string?` | 커밋 SHA |
| `meta.file` | `string?` | 파일 이름 |
| `meta.repo` | `string?` | `owner/repo` 형식 |

**반환값:** `string` — 완성된 Markdown 문서

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

## 지원 언어

파서는 JS/TS 구문 패턴에 최적화되어 있습니다.

| 언어 | 확장자 | 지원 수준 |
| --- | --- | --- |
| JavaScript | `.js` `.mjs` `.cjs` | ✅ 완전 지원 |
| TypeScript | `.ts` | ✅ 완전 지원 |
| React JSX | `.jsx` | ✅ 완전 지원 |
| React TSX | `.tsx` | ✅ 완전 지원 |
| 기타 언어 | — | 🔜 예정 |

---

## 프로젝트 구조

```
github-mobile-reader/
├── src/
│   ├── parser.ts    ← diff 파싱 및 심볼 분석 (핵심 로직)
│   ├── gemini.ts    ← Gemini Flash AI 요약 (opt-in)
│   ├── index.ts     ← npm 공개 API
│   ├── action.ts    ← GitHub Action 진입점
│   └── cli.ts       ← CLI 진입점
├── dist/            ← 컴파일 결과물 (자동 생성)
├── reader-output/   ← CLI 출력 디렉터리 (gitignored)
├── action.yml       ← GitHub Action 정의
└── package.json
```

---

## 기여

```bash
git clone https://github.com/3rdflr/github-mobile-reader.git
cd github-mobile-reader
npm install
npm run build:all   # 라이브러리 + Action + CLI 빌드
```

PR 환영합니다.

---

## 라이선스

MIT © [3rdflr](https://github.com/3rdflr)
