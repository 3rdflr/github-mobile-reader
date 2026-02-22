# 📖 github-mobile-reader

> `github-mobile-reader`는 git diff를 깔끔하게 세로 스크롤로 읽을 수 있는 Markdown 문서로 변환합니다 — 더 이상 좌우 핀치줌이나 가로 스와이프는 필요 없습니다.

[![npm version](https://img.shields.io/npm/v/github-mobile-reader.svg)](https://www.npmjs.com/package/github-mobile-reader)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js ≥ 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

> 영어 문서는 [README.md](./README.md)에서 확인하세요.

---

## 문제 상황

GitHub의 모바일 웹 뷰는 코드를 고정 너비의 모노스페이스 블록으로 렌더링합니다. 긴 줄은 가로 스크롤을 요구하고, 깊게 중첩된 로직은 한눈에 파악이 불가능하며, 출퇴근 지하철에서 PR 리뷰를 하는 건 사실상 불가능에 가깝습니다.

## 해결책

`github-mobile-reader`는 git diff를 파싱해서 **Logical Flow** — 단순히 어떤 문자가 바뀌었는지가 아니라 *코드가 무엇을 하는지*를 보여주는 간결한 트리 — 를 생성합니다. 결과물은 어떤 화면 너비에서도 위에서 아래로 읽히는 Markdown 문서입니다.

**Before** (기존 diff, 모바일 웹):

```
← 스와이프 → 스와이프 → 스와이프 →
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

## 주요 기능

- **의존성 제로 코어** — 파서는 Node.js ≥ 18이 있는 어디서나 동작합니다
- **이중 출력 포맷** — CJS (`require`)와 ESM (`import`) 모두 지원, TypeScript 타입 포함
- **CLI** — `npx github-mobile-reader --repo owner/repo --pr 42` 로 어떤 PR이든 즉시 변환
- **GitHub Action** — 레포에 YAML 파일 하나만 추가하면 PR마다 Reader 문서가 자동 생성됩니다
- **파일별 분리 출력** — 변경된 JS/TS 파일마다 독립적인 섹션으로 출력
- **JSX/Tailwind 인식** — `.jsx`/`.tsx` 파일은 컴포넌트 트리(`🎨 JSX Structure`)와 Tailwind 클래스 diff(`💅 Style Changes`)를 별도 섹션으로 분리 출력
- **양방향 diff 추적** — 추가된 코드와 삭제된 코드를 각각 별도 섹션으로 표시
- **보수적 설계** — 패턴이 애매할 때는 잘못된 정보를 보여주는 대신 덜 보여줍니다
- **보안 기본값** — 토큰은 `$GITHUB_TOKEN` 환경변수로만 읽음 — 셸 히스토리나 `ps` 목록에 노출되는 `--token` 플래그 없음

---

## 목차

1. [빠른 시작](#빠른-시작)
2. [언어 지원](#언어-지원)
3. [CLI 사용법](#cli-사용법)
4. [GitHub Action (권장)](#github-action-권장)
5. [npm 라이브러리 사용법](#npm-라이브러리-사용법)
6. [출력 형식](#출력-형식)
7. [API 레퍼런스](#api-레퍼런스)
8. [파서 동작 원리](#파서-동작-원리)
9. [기여하기](#기여하기)
10. [라이선스](#라이선스)

---

## CLI 사용법

터미널에서 `github-mobile-reader`를 바로 실행할 수 있습니다 — 별도 설정 파일 불필요. GitHub에서 PR diff를 받아 모바일 친화적인 Markdown으로 변환하고 `./reader-output/`에 PR별로 파일을 저장합니다.

### 인증 (토큰 설정)

CLI 실행 **전에** 환경변수로 GitHub 토큰을 설정하세요:

```bash
export GITHUB_TOKEN=ghp_xxxx
npx github-mobile-reader --repo owner/repo --pr 42
```

> **보안 안내:** CLI는 `--token` 플래그를 지원하지 않습니다. 커맨드라인 인자로 시크릿을 전달하면 셸 히스토리와 `ps` 출력에 토큰이 노출됩니다. 반드시 환경변수를 사용하세요.

### 단일 PR

```bash
npx github-mobile-reader --repo owner/repo --pr 42
```

### 최근 PR 전체

```bash
npx github-mobile-reader --repo owner/repo --all
```

### 옵션

| 플래그      | 기본값             | 설명                                                    |
| ----------- | ------------------ | ------------------------------------------------------- |
| `--repo`    | *(필수)*           | `owner/repo` 형식의 레포지토리                          |
| `--pr`      | —                  | 특정 PR 번호 하나 처리                                  |
| `--all`     | —                  | 최근 PR 전체 처리 (`--limit`와 함께 사용)               |
| `--out`     | `./reader-output`  | 생성된 `.md` 파일 저장 경로 — 상대 경로만 허용, `..` 불가 |
| `--limit`   | `10`               | `--all` 사용 시 가져올 PR 최대 개수                     |

토큰: `$GITHUB_TOKEN` 환경변수에서 읽음 (미인증 시 60 req/hr, 인증 시 5 000 req/hr).

### 출력 결과

PR마다 `reader-output/pr-<번호>.md` 파일 하나가 생성됩니다.

JSX/TSX 파일은 추가 섹션이 생성됩니다:

```
# 📖 PR #42 — My Feature

## 📄 `src/App.tsx`

### 🧠 Logical Flow   ← JS 로직 트리
### 🎨 JSX Structure  ← 컴포넌트 계층 구조 (JSX/TSX 전용)
### 💅 Style Changes  ← 추가/제거된 Tailwind 클래스 (JSX/TSX 전용)
### ✅ Added Code
### ❌ Removed Code
```

> **참고:** `reader-output/`는 기본적으로 `.gitignore`에 포함되어 있습니다 — 생성된 파일은 로컬에만 저장되며 레포지토리에 커밋되지 않습니다.

---

## 빠른 시작

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

## 언어 지원

파서는 정규식 기반 패턴 매칭으로 동작하므로 기술적으로는 어떤 언어의 diff도 입력받을 수 있습니다. 다만 감지 패턴이 JavaScript/TypeScript 문법에 맞춰 설계되어 있어 **Logical Flow 출력 품질이 언어마다 다릅니다**.

### 현재 지원 현황 (v0.1)

| 언어                    | 확장자                    |      품질      | 비고                                                                        |
| ----------------------- | ------------------------- | :------------: | --------------------------------------------------------------------------- |
| **JavaScript**          | `.js` `.mjs` `.cjs`       |    ✅ 완전     | 파서의 기준 언어                                                            |
| **TypeScript**          | `.ts`                     |    ✅ 완전     | JS 상위 집합 — 모든 패턴 적용                                               |
| **React JSX**           | `.jsx`                    |    ✅ 완전     | JS와 동일한 문법                                                            |
| **React TSX**           | `.tsx`                    |    ✅ 완전     | TS와 동일한 문법                                                            |
| **Next.js**             | `.js` `.ts` `.jsx` `.tsx` |    ✅ 완전     | JS/TS 위에서 동작하는 프레임워크                                            |
| **Java**                | `.java`                   | ⚠️ 부분 (~55%) | `if/for/while`과 체이닝은 동작; 함수 선언 감지 실패 (`const/let/var` 없음)  |
| **C#**                  | `.cs`                     | ⚠️ 부분 (~35%) | LINQ 체이닝(`.Where().Select()`)은 동작; `using`/`namespace`/`class` 미감지 |
| **C**                   | `.c` `.h`                 | ❌ 최소 (~15%) | 매칭 키워드 없음; 포인터 문법(`->`, `*`) 미지원                             |
| **Python, Go, Rust 등** | —                         |    🔜 예정     | 아래 로드맵 참고                                                            |

> **참고:** Java, C#, C 파일은 기본적으로 GitHub Action에서 처리되지 않습니다.
> Action은 `.js .jsx .ts .tsx .mjs .cjs` 파일만 스캔합니다 ([`src/action.ts` 66번째 줄](src/action.ts)).
> 다른 언어를 처리하려면 커스텀 어댑터가 필요합니다 ([기여하기](#기여하기) 참고).

### JS/TS/React/Next.js가 완전 지원되는 이유

네 가지 모두 동일한 기반 문법을 공유합니다. 파서가 인식하는 것:

- **메서드 체이닝** — `)`나 `}`로 끝나는 줄 다음에 `.`으로 시작하는 줄
  ```ts
  data
    .filter((item) => item.active) // P1 체이닝으로 감지
    .map((item) => item.value); // P1 체이닝으로 감지
  ```
- **함수 선언** — `const`, `let`, `var`, `function`, `async`
- **조건문** — `if / else / switch`
- **반복문** — `for / while`
- **노이즈 필터링** — `import`, `export`, `type`, `interface`, `console.log`는 자동으로 제거

### C / C# / Java가 제한적인 이유

이 언어들은 위 패턴에 대해 다른 표기 방식을 사용합니다:

| 개념          | JS/TS (✅ 감지됨)      | Java / C# / C (❌ 미감지)        |
| ------------- | ---------------------- | -------------------------------- |
| 변수 선언     | `const x = …`          | `int x = …` / `String x = …`     |
| 화살표 콜백   | `x => x.value`         | 언어마다 람다 문법 다름          |
| 노이즈 import | `import` / `export`    | `using` / `#include` / `package` |
| 비동기 함수   | `async function foo()` | `async Task<T> Foo()`            |

### 로드맵 — Language Adapter 시스템 (v0.2)

추가 언어 지원을 위해 **Language Adapter** 아키텍처가 계획되어 있습니다:

```
src/languages/
├── base.adapter.ts     ← 공통 인터페이스
├── js-ts.adapter.ts    ← 현재 로직 (parser.ts에서 분리)
├── java.adapter.ts     ← public/private/void 선언, Stream 체이닝
└── csharp.adapter.ts   ← using/namespace, LINQ 체이닝
```

각 어댑터가 제공하는 것:

- 지원 파일 확장자 목록
- 함수 선언 감지 패턴
- 무시할 키워드 목록 (노이즈)
- 체이닝 표기 방식 (점(`.`) vs. 화살표(`->`))

언어 어댑터를 기여하고 싶다면 [기여하기](#기여하기)를 확인하세요.

---

## GitHub Action (권장)

이 라이브러리를 사용하는 가장 쉬운 방법입니다. 매 PR마다 자동으로:

1. 변경된 `.js` / `.ts` 파일의 diff를 파싱
2. `docs/reader/pr-<번호>.md` 파일을 레포에 저장
3. PR에 요약 코멘트를 자동으로 달아줍니다

### Step 1 — 워크플로우 파일 추가

레포에 `.github/workflows/mobile-reader.yml`을 만들어 주세요:

```yaml
name: 📖 Mobile Reader

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write # .md 파일 커밋
  pull-requests: write # PR 코멘트 작성

jobs:
  generate-reader:
    name: Generate Mobile Reader View
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # git diff에 전체 히스토리 필요

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
            echo "변경사항 없음"
          else
            git commit -m "docs(reader): PR #${{ github.event.pull_request.number }} 모바일 리더 업데이트 [skip ci]"
            git push
          fi
```

### Step 2 — PR 열기

이게 전부입니다. 이후 모든 PR에 자동으로:

- `docs/reader/pr-<번호>.md` 파일 생성
- 생성된 파일 링크가 담긴 PR 코멘트 자동 게시

### Action 입력값

| 입력값         | 필수 | 기본값        | 설명                               |
| -------------- | ---- | ------------- | ---------------------------------- |
| `github_token` | ✅   | —             | `${{ secrets.GITHUB_TOKEN }}` 사용 |
| `base_branch`  | ❌   | `main`        | PR이 머지되는 대상 브랜치          |
| `output_dir`   | ❌   | `docs/reader` | 생성된 `.md` 파일 저장 경로        |

---

## npm 라이브러리 사용법

CI 스크립트, 커스텀 봇, 로컬 도구 등 모든 Node.js 프로젝트에서 라이브러리로 사용할 수 있습니다.

### 설치

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

### 기본 사용 예시

```ts
import { generateReaderMarkdown } from "github-mobile-reader";
import { execSync } from "child_process";
import { writeFileSync } from "fs";

// 마지막 커밋의 diff 가져오기
const diff = execSync("git diff HEAD~1 HEAD", { encoding: "utf8" });

// 메타데이터와 함께 Reader Markdown 생성
const markdown = generateReaderMarkdown(diff, {
  pr: "42",
  commit: "a1b2c3d",
  file: "src/api/users.ts",
  repo: "my-org/my-repo",
});

// 파일 저장 또는 Slack / Discord / GitHub에 게시
writeFileSync("reader.md", markdown, "utf8");
```

### 저수준 API 예시

트리 구조만 필요한 경우 (예: 커스텀 렌더러 제작):

```ts
import { parseDiffToLogicalFlow, renderFlowTree } from "github-mobile-reader";

const { root, rawCode, removedCode } = parseDiffToLogicalFlow(diff);

// root        → FlowNode[]  (논리 트리)
// rawCode     → string      (추가된 줄, 줄바꿈으로 연결)
// removedCode → string      (삭제된 줄, 줄바꿈으로 연결)

const treeLines = renderFlowTree(root);
console.log(treeLines.join("\n"));
```

---

## 출력 형식

생성된 Reader Markdown 문서는 네 개의 섹션으로 구성됩니다:

````markdown
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
```

## ✅ Added Code

```typescript
const result = getData()
  .filter((item) => item.active)
  .map((item) => item.value)
  .reduce((a, b) => a + b, 0);
```

## ❌ Removed Code

```typescript
const result = getData().map((item) => item.value);
```

---

🛠 Auto-generated by github-mobile-reader. Do not edit manually.
````

---

## API 레퍼런스

### `generateReaderMarkdown(diffText, meta?)`

메인 진입점. 원시 git diff 문자열을 파싱해서 완성된 Reader Markdown 문서를 반환합니다.

| 파라미터      | 타입      | 설명                          |
| ------------- | --------- | ----------------------------- |
| `diffText`    | `string`  | `git diff`의 원시 출력        |
| `meta.pr`     | `string?` | PR 번호                       |
| `meta.commit` | `string?` | 커밋 SHA                      |
| `meta.file`   | `string?` | 헤더에 표시할 파일명          |
| `meta.repo`   | `string?` | `owner/repo` 형식의 레포 이름 |

**반환값:** `string` — 완성된 Markdown 문서

---

### `parseDiffToLogicalFlow(diffText)`

렌더링 없이 diff를 구조화된 결과로 파싱합니다.

**반환값:** `ParseResult`

```ts
interface ParseResult {
  root: FlowNode[]; // 논리 트리 (추가된 줄)
  rawCode: string; // 추가된 줄 (\n으로 연결)
  removedCode: string; // 삭제된 줄 (\n으로 연결)
}
```

---

### `renderFlowTree(nodes, indent?)`

`FlowNode[]` 트리를 Markdown 안전한 텍스트 줄 배열로 변환합니다.

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

### `Priority` (열거형)

| 값                | 의미                                            |
| ----------------- | ----------------------------------------------- |
| `CHAINING = 1`    | 메서드 체인 (`.map()`, `.filter()`, …) — 최우선 |
| `CONDITIONAL = 2` | `if` / `else` / `switch` 블록                   |
| `LOOP = 3`        | `for` / `while` 반복문                          |
| `FUNCTION = 4`    | 함수 선언                                       |
| `OTHER = 5`       | 그 외                                           |

---

## 파서 동작 원리

파서는 결정론적 파이프라인으로 동작합니다 — AI 없음, 외부 의존성 없음.

```
git diff 텍스트
  │
  ▼
1. filterDiffLines()     — + / - 줄 분리, +++ / --- 헤더 제거
  │
  ▼
2. normalizeCode()       — ; 제거, 주석 제거, 공백 정리
  │
  ▼
3. getIndentDepth()      — 중첩 레벨 계산 (2 spaces = 1 레벨)
  │
  ▼
4. parseToFlowTree()     — 우선순위 순서로 패턴 매칭:
  │                          P1 체이닝  (.map .filter .reduce …)
  │                          P2 조건문  (if / else / switch)
  │                          P3 반복문  (for / while)
  │                          P4 함수 선언
  │
  ▼
5. renderFlowTree()      — 트리 → 들여쓰기된 텍스트 줄로 변환
  │
  ▼
generateReaderMarkdown() — 최종 Markdown 문서 조립
```

**주요 설계 결정:**

- **보수적** — 분류되지 않는 줄은 잘못된 정보 대신 조용히 건너뜁니다
- **import / export / type / interface / console.log**는 무시됩니다. 흐름 이해에 기여하지 않기 때문입니다
- **콜백 인자 축약** — 본문이 단일 속성 접근일 때 `.map(item => item.value)`를 `map(item → value)`로 축약합니다. 그 외에는 `map(callback)`으로 표시합니다
- **함수 선언은 최우선 체크** — `const foo = async …`가 `extractRoot`에 잘못 분류되지 않도록, 함수 선언 감지를 루트 추출보다 먼저 수행합니다
- **depth**는 들여쓰기 기반 (2-space 기준)으로 추적되며, 체이닝 감지가 애매할 때 보조 정보로만 사용됩니다

### 지원 언어 (v0.1)

[언어 지원](#언어-지원) 섹션의 전체 표를 확인하세요.
요약: **JS / TS / React / Next.js 완전 지원**, Java와 C#은 부분 지원, C 등은 Language Adapter 시스템(v0.2)으로 계획 중.

---

## 기여하기

PR은 언제든지 환영합니다! 시작 방법:

```bash
# 레포 클론
git clone https://github.com/3rdflr/github-mobile-reader.git
cd github-mobile-reader

# 의존성 설치
npm install

# 빌드 (라이브러리 + Action runner)
npm run build:all

# 개발 중 watch 모드
npm run dev

# 테스트 실행
npx ts-node src/test.ts
```

### 프로젝트 구조

```
github-mobile-reader/
├── src/
│   ├── parser.ts     ← 핵심 diff → logical flow 파서
│   ├── index.ts      ← npm 공개 API
│   ├── action.ts     ← GitHub Action 진입점
│   ├── cli.ts        ← CLI 진입점 (npx github-mobile-reader)
│   └── test.ts       ← 스모크 테스트 (33개)
├── dist/             ← 컴파일 결과물 (자동 생성, 수정 금지)
├── reader-output/    ← CLI 출력 디렉토리 (gitignore됨)
├── .github/
│   └── workflows/
│       └── mobile-reader.yml   ← 사용자용 예시 워크플로우
├── action.yml        ← GitHub Action 정의
├── README.md         ← 영어 문서
├── README.ko.md      ← 한국어 문서 (현재 파일)
├── package.json
└── tsconfig.json
```

### 새 언어 어댑터 추가하기

파서는 현재 JS/TS 문법 휴리스틱에 의존합니다 (점 체이닝, `const`/`let`/`var`, `function`, `if`/`for`/`while`). 새 언어를 추가하려면:

1. `src/parser.ts`에서 감지 헬퍼 추가 (기존 `isChaining`, `isConditional` 패턴 참고)
2. `src/action.ts`의 `filterDiffLines`에서 새 파일 확장자 허용
3. `src/test.ts`에 해당 언어의 diff 예시를 테스트 케이스로 추가
4. 예시 diff를 포함해서 PR 오픈

---

## 라이선스

MIT © [3rdflr](https://github.com/3rdflr)

---
