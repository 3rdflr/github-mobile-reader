# github-mobile-reader

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
# PR #7 — feat: 작업 필터링 및 정렬 컨트롤 추가

owner/repo · `3f8a21c` · JS/TS 3개 파일 변경

---

## `src/components/TodoList.tsx`

> 💡 기존엔 전체 작업을 무조건 불러왔지만, 이제 filter와 sortOrder를 파라미터로 받아
> 조건부 패치로 변경됨. filter 상태 변경 시 자동으로 재패치함.

**Import 변화**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (제거됨)

**✏️ `TodoList`** _(Component)_ — 변경됨
  변수: `filter`, `sortOrder`
  + (state) `filter` ← `useState({})`
  ~ `useEffect` deps 변경

**✏️ `fetchTasks`** _(Function)_ — 변경됨
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (guard) `!filter` → early return
  + (API) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — 새로 추가
  파라미터+ `field`
  파라미터+ `value`
  + (setState) `setFilter({...filter, [field]: value})`
```

---

## 주요 기능

- **함수 단위 요약** — 함수/컴포넌트별로 한 줄씩 나열. `###` 헤딩 없이 본문 크기 그대로 — 모바일에서 폰트 크기 정상
- **부수 효과 레이블** — 동작 줄에 `(API)`, `(setState)`, `(state)`, `(cond)`, `(catch)`, `(guard)` 레이블을 인라인으로 표시해 코드 안 읽고도 변화 유형 파악 가능
- **guard clause 감지** — `if (!x) return` 패턴을 `(guard) early return`으로 별도 표기
- **Import 변화** — 파일 단위로 추가·제거된 import 감지
- **파라미터 변화** — 함수 파라미터의 추가·제거 감지 (최대 4개, 초과분은 `… 외 N개`)
- **변수** — 단순 변수 할당을 가장 가까운 함수에 인라인으로 표시 (최대 5개)
- **UI 변화** — 추가·제거된 JSX 컴포넌트 감지 (`div`, `span` 등 제네릭 태그 제외); map 및 조건부 렌더링 패턴
- **Props 변화** — TypeScript 인터페이스/타입 멤버 변경 감지 (최대 5개; 긴 값은 `'...'`로 축약)
- **useEffect 중복 제거** — added/removed 양쪽에 동일한 `useEffect`가 나오면 `~ useEffect deps 변경` 한 줄로 통합
- **cross-file 리팩토링 감지** — 같은 PR에서 A파일에서 제거되고 B파일에 추가된 심볼은 `❌ 제거됨` 대신 `📦 → B파일로 이동됨`으로 표시
- **오탐 방지** — diff의 context 라인에 심볼이 남아있으면 `removed` 대신 `modified`로 재분류
- **잘린 코드 라인 필터링** — `)` 로 시작하거나, 괄호 불균형이거나, 연산자로 끝나는 mid-expression 조각은 분석 전에 제거
- **빈 섹션 숨김** — 감지된 변경 내용이 없는 `변경됨` 심볼은 출력에서 제외
- **동작 요약 우선순위** — 출력 항목을 신호 유형별로 우선순위 적용: state/API (최대 4개) → guard/catch (최대 2개) → cond (최대 2개) → setState/useEffect/return (최대 2개)
- **테스트 파일 요약** — `.test.ts` 등 테스트 파일은 코드 분석 대신 `describe`/`it` 블록 이름을 그룹별로 표시
- **설정 파일 요약** — vitest/jest/vite 설정 파일은 추가·제거된 플러그인 목록만 표시
- **Gemini AI 요약** (선택) — 코드 라인이 아닌 비즈니스 로직 변화 + 부수 효과 중심 1~2줄 요약 (`> 💡 ...`)
- **보안** — 토큰은 환경변수로만 주입; 셸 히스토리에 노출 없음

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

> **보안 참고:** `--token` 플래그는 지원하지 않습니다. CLI 인자로 시크릿을 전달하면 셸 히스토리와 `ps` 출력에 토큰이 노출됩니다.

### 단일 PR

```bash
npx github-mobile-reader --repo owner/repo --pr 42
```

### 단일 PR + Gemini AI 요약

```bash
GEMINI_API_KEY=AIzaSy... npx github-mobile-reader --repo owner/repo --pr 42
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
| `--out`         | `./reader-output` | 출력 디렉터리 (상대 경로만, `..` 불가)            |
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

          # 이전 봇 코멘트 삭제
          PREV_ID=$(gh api repos/${{ github.repository }}/issues/${PR_NUMBER}/comments \
            --jq '.[] | select(.user.login == "github-actions[bot]" and (.body | startswith("# PR #"))) | .id' \
            | head -1)
          if [ -n "$PREV_ID" ]; then
            gh api -X DELETE repos/${{ github.repository }}/issues/comments/${PREV_ID}
          fi

          gh pr comment ${PR_NUMBER} --repo ${{ github.repository }} --body-file "$FILE"
```

### Step 2 — PR 열기

이후 모든 PR에 자동으로 요약 코멘트가 게시됩니다.

---

## Gemini AI 요약 설정 (선택)

`useCanvasRenderer` 같은 200줄짜리 훅도 1~3줄로 자연어 요약해줍니다.
API 키가 없으면 오류 없이 기존과 동일하게 동작합니다.

**Gemini 2.5 Flash Lite** 사용 — 빠르고 저렴하며 thinking 오버헤드 없음.

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
3. `Generate Reader Markdown` 스텝에 `--gemini-key ${{ secrets.GEMINI_API_KEY }}` 추가

> **보안**: GitHub Secrets에 저장된 키는 워크플로우 로그에서도 마스킹되어 절대 노출되지 않습니다.

---

## 출력 형식 상세

```markdown
# PR #7 — feat: 작업 필터링 및 정렬 컨트롤 추가

owner/repo · `3f8a21c` · JS/TS 3개 파일 변경

---

## `src/components/TodoList.tsx`

> 💡 기존엔 전체 작업을 무조건 불러왔지만, 이제 filter와 sortOrder를 파라미터로 받아
> 조건부 패치로 변경됨. filter 상태 변경 시 자동으로 재패치함.

**Import 변화**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (제거됨)

**✏️ `TodoList`** _(Component)_ — 변경됨
  변수: `filter`, `sortOrder`
  + (state) `filter` ← `useState({})`
  ~ `useEffect` deps 변경

**✏️ `fetchTasks`** _(Function)_ — 변경됨
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (guard) `!filter` → early return
  + (API) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — 새로 추가
  파라미터+ `field`
  파라미터+ `value`
  + (setState) `setFilter({...filter, [field]: value})`

**✏️ `TaskCard`** _(Component)_ — 변경됨
  Props+ `dueDate: '...'`
  + (cond) `!task.completed`
  UI: `<Badge>`
```

### 심볼 분류 기준

| 표시 | 의미 |
| --- | --- |
| `✅ ... — 새로 추가` | diff에서 새로 등장한 함수/컴포넌트 |
| `❌ ... — 제거됨` | diff에서 완전히 사라진 함수/컴포넌트 |
| `✏️ ... — 변경됨` | 기존에 존재하고 내용이 수정된 함수/컴포넌트 |
| `📦 ... — 이동됨` | 같은 PR 내 다른 파일에서 제거되고 이 파일에 추가된 심볼 |
| `변수: x, y` | 단순 변수 할당을 인라인으로 축약 표시 (최대 5개, 초과분은 `외 N개`) |

### 줄 prefix 의미

| Prefix | 의미 |
| --- | --- |
| `+` | 추가된 동작 |
| `-` | 제거된 동작 |
| `~` | 변경된 동작 (added/removed 양쪽에 같은 신호가 있을 때, 예: `useEffect` deps 변경) |
| `(API)` | `await` 호출 — 서버나 외부 서비스에서 데이터 패치 |
| `(setState)` | `setState` 호출 — React 상태 업데이트 |
| `(state)` | 훅 할당 — `const x = useHook()` |
| `(cond)` | `if / else if` 분기 |
| `(guard)` | guard clause — `if (!x) return` 조기 종료 패턴 |
| `(catch)` | `catch` 블록 |
| `(return)` | 비자명 반환값 |
| `파라미터+` / `파라미터-` | 함수 파라미터 추가 / 제거 (최대 4개) |
| `Props+` / `Props-` | TypeScript 인터페이스/타입 멤버 추가 / 제거 (최대 5개) |
| `UI:` | JSX 컴포넌트 추가 또는 제거 |

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
  generateReaderMarkdown,    // diff → 완성된 Markdown 문서
  parseDiffHunks,            // diff → DiffHunk[]
  attributeLinesToSymbols,   // DiffHunk[] → SymbolDiff[]
  generateSymbolSections,    // SymbolDiff[] → string[]
  extractImportChanges,      // 추가·제거된 import 감지
  extractParamChanges,       // 추가·제거된 함수 파라미터 감지
  extractRemovedSymbolNames, // diff → string[] (순수 제거된 심볼 이름)
  extractAddedSymbolNames,   // diff → string[] (순수 추가된 심볼 이름)
} from 'github-mobile-reader';
```

#### `generateReaderMarkdown(diffText, meta?)`

| 파라미터 | 타입 | 설명 |
| --- | --- | --- |
| `diffText` | `string` | `git diff` 원시 출력 |
| `meta.pr` | `string?` | PR 번호 |
| `meta.commit` | `string?` | 커밋 SHA |
| `meta.file` | `string?` | 파일 이름 (테스트/설정 파일 감지에 사용) |
| `meta.repo` | `string?` | `owner/repo` 형식 |
| `meta.movedOutMap` | `Map<string, string>?` | 심볼 → 이동된 대상 파일 (cross-file 이동 표시) |
| `meta.movedIntoThisFile` | `Set<string>?` | 이 파일로 이동된 심볼 이름 목록 |

**반환값:** `string` — 완성된 Markdown 문서

#### `SymbolDiff`

```ts
interface SymbolDiff {
  name: string;
  kind: 'component' | 'function' | 'setup';
  status: 'added' | 'removed' | 'modified' | 'moved';
  addedLines: string[];
  removedLines: string[];
  movedTo?: string;   // status === 'moved'일 때 이동된 대상 파일
  movedFrom?: string; // status === 'moved'일 때 이동된 원본 파일
}
```

---

## 지원 언어

파서는 JS/TS 구문 패턴에 최적화되어 있습니다.

| 언어 | 확장자 | 지원 수준 |
| --- | --- | --- |
| JavaScript | `.js` `.mjs` `.cjs` | 완전 지원 |
| TypeScript | `.ts` | 완전 지원 |
| React JSX | `.jsx` | 완전 지원 |
| React TSX | `.tsx` | 완전 지원 |
| 기타 언어 | — | 예정 |

---

## 프로젝트 구조

```
github-mobile-reader/
├── src/
│   ├── parser.ts    ← diff 파싱 및 심볼 분석 (핵심 로직)
│   ├── gemini.ts    ← Gemini 2.5 Flash Lite AI 요약 (opt-in)
│   ├── index.ts     ← npm 공개 API
│   ├── action.ts    ← GitHub Action 진입점
│   └── cli.ts       ← CLI 진입점 (2-pass cross-file 분석)
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
