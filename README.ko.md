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
## 📄 `src/components/TodoList.tsx`

> 💡 기존엔 전체 작업을 무조건 불러왔지만, 이제 filter와 sortOrder를 파라미터로 받아
> 조건부 패치로 변경됨. filter 상태 변경 시 자동으로 재패치함.

**Import 변화**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (제거됨)

**✏️ `TodoList`** _(Component)_ — 변경됨
  변수: `filter`, `sortOrder`
  + (상태) `filter` ← `useState({})`
  + `useEffect` [filter] 변경 시 실행

**✏️ `fetchTasks`** _(Function)_ — 변경됨
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (방어) `!filter` 이면 조기 반환
  + (API 호출) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — 새로 추가
  파라미터+ `field`
  파라미터+ `value`
  + (상태 변경) `setFilter({...filter, [field]: value})`
```

---

## 주요 기능

- **함수 단위 요약** — 함수/컴포넌트별로 한 줄씩 나열. `###` 헤딩 없이 본문 크기 그대로 — 모바일에서 폰트 크기 정상
- **부수 효과 레이블** — 동작 줄에 `(API 호출)`, `(상태 변경)`, `(조건)`, `(에러 처리)`, `(방어)` 레이블을 인라인으로 표시해 코드 안 읽고도 변화 유형 파악 가능
- **guard clause 감지** — `if (!x) return` 패턴을 `(방어) 조기 반환`으로 별도 표기
- **Import 변화** — 파일 단위로 추가·제거된 import 감지
- **파라미터 변화** — 함수 파라미터의 추가·제거 감지 (`파라미터+` / `파라미터-`)
- **변수** — 단순 변수 할당을 가장 가까운 함수에 인라인으로 표시
- **UI 변화** — 추가·제거된 JSX 컴포넌트 감지 (`div`, `span` 등 제네릭 태그 제외); map(`🔄`) 및 조건부 렌더링(`⚡`) 패턴
- **Props 변화** — TypeScript 인터페이스/타입 멤버 변경 감지 (`Props+` / `Props-`); 긴 값은 `'...'`로 축약
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

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          base_branch: ${{ github.base_ref }}
          output_dir: docs/reader
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}  # 선택 사항
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
3. 워크플로우에 `gemini_api_key: ${{ secrets.GEMINI_API_KEY }}` 추가 (위 예시 참고)

> **보안**: GitHub Secrets에 저장된 키는 워크플로우 로그에서도 마스킹되어 절대 노출되지 않습니다.

---

## 출력 형식 상세

```markdown
# 📖 PR #7 — feat: 작업 필터링 및 정렬 컨트롤 추가

> Repository: owner/repo
> Commit: `3f8a21c`
> 변경된 JS/TS 파일: 3개

---

## 📄 `src/components/TodoList.tsx`

> 💡 기존엔 전체 작업을 무조건 불러왔지만, 이제 filter와 sortOrder를 파라미터로 받아
> 조건부 패치로 변경됨. filter 상태 변경 시 자동으로 재패치함.

**Import 변화**
+ `FilterBar`
+ `useSortedTasks`
- `LegacyLoader` (제거됨)

**✏️ `TodoList`** _(Component)_ — 변경됨
  변수: `filter`, `sortOrder`
  + (상태) `filter` ← `useState({})`
  + `useEffect` [filter] 변경 시 실행

**✏️ `fetchTasks`** _(Function)_ — 변경됨
  파라미터+ `filter`
  파라미터+ `sortOrder`
  + (방어) `!filter` 이면 조기 반환
  + (API 호출) `api.getTasks(filter)` → `tasks`

**✅ `handleFilterChange`** _(Function)_ — 새로 추가
  파라미터+ `field`
  파라미터+ `value`
  + (상태 변경) `setFilter({...filter, [field]: value})`

**✏️ `TaskCard`** _(Component)_ — 변경됨
  Props+ `dueDate: '...'`
  + (조건) `!task.completed`
  UI: `<Badge>`
```

### 심볼 분류 기준

| 표시 | 의미 |
| --- | --- |
| `✅ ... — 새로 추가` | diff에서 새로 등장한 함수/컴포넌트 |
| `❌ ... — 제거됨` | diff에서 사라진 함수/컴포넌트 |
| `✏️ ... — 변경됨` | 기존에 존재하고 내용이 수정된 함수/컴포넌트 |
| `변수: x, y` | 단순 변수 할당을 인라인으로 축약 표시 |

### 줄 prefix 의미

| Prefix | 의미 |
| --- | --- |
| `(API 호출)` | `await` 호출 — 서버나 외부 서비스에서 데이터 패치 |
| `(상태 변경)` | `setState` 호출 — React 상태 업데이트 |
| `(상태)` | 훅 할당 — `const x = useHook()` |
| `(조건)` | `if / else if` 분기 |
| `(방어)` | guard clause — `if (!x) return` 조기 반환 패턴 |
| `(에러 처리)` | `catch` 블록 |
| `파라미터+` / `파라미터-` | 함수 파라미터 추가 / 제거 |
| `Props+` / `Props-` | TypeScript 인터페이스/타입 멤버 추가 / 제거 |
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
  generateReaderMarkdown,  // diff → 완성된 Markdown 문서
  parseDiffHunks,          // diff → DiffHunk[]
  attributeLinesToSymbols, // DiffHunk[] → SymbolDiff[]
  generateSymbolSections,  // SymbolDiff[] → string[]
  extractImportChanges,    // 추가·제거된 import 감지
  extractParamChanges,     // 추가·제거된 함수 파라미터 감지
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
│   ├── gemini.ts    ← Gemini 2.5 Flash Lite AI 요약 (opt-in)
│   ├── index.ts     ← npm 공개 API
│   ├── action.ts    ← GitHub Action 진입점
│   ├── cli.ts       ← CLI 진입점
│   └── test.ts      ← 스모크 테스트 (npx ts-node src/test.ts)
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
npm run build:all        # 라이브러리 + Action + CLI 빌드
npx ts-node src/test.ts  # 스모크 테스트 실행
```

PR 환영합니다.

---

## 라이선스

MIT © [3rdflr](https://github.com/3rdflr)
