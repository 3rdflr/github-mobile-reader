/**
 * Gemini Flash integration for AI-powered diff summaries.
 * Opt-in: only runs when GEMINI_API_KEY is provided.
 * Fails silently — never blocks the main output.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const MAX_DIFF_LINES = 120;
const MAX_REMOVED_LINES = 60;
const TIMEOUT_MS = 10_000;

/**
 * Remove noise lines before sending to Gemini.
 * Keeps only lines with logic: state changes, conditions, API calls, returns.
 * Drops: className/style props, pure comments, import/export, blank lines.
 */
function filterForGemini(lines: string[]): string[] {
  return lines.filter((l) => {
    const t = l.trim();
    if (t.length === 0) return false;
    if (/^\/\//.test(t) || /^\{?\/\*/.test(t)) return false;
    if (/^import\s/.test(t) || /^export\s+(default\s+)?type\s/.test(t)) return false;
    if (/className=['"`]/.test(t) && !/useState|useEffect|fetch|return|if |=/.test(t)) return false;
    if (/^style=/.test(t)) return false;
    return true;
  });
}

function buildPrompt(filename: string, addedLines: string[], removedLines: string[]): string {
  const added = filterForGemini(addedLines).slice(0, MAX_DIFF_LINES).join('\n');
  const removed = filterForGemini(removedLines).slice(0, MAX_REMOVED_LINES).join('\n');

  const removedBlock = removed.length > 0
    ? `\n변경 전 코드:\n\`\`\`typescript\n${removed}\n\`\`\`\n`
    : '';

  return `너는 GitHub PR 코드 리뷰 전문가야. 아래는 "${filename}" 파일의 핵심 변경 코드야.

변경 후 코드:
\`\`\`typescript
${added}
\`\`\`
${removedBlock}
모바일에서 PR을 빠르게 리뷰하는 개발자를 위해 아래 형식으로 한국어로 작성해.

출력 형식 (반드시 이 구조를 따를 것):
**변경 의도**: (한 줄. 이 변경이 왜 필요했는지)

**As-Is**:
\`\`\`typescript
// 핵심 로직만, 최대 3줄. 불필요한 코드는 ... 으로 생략
\`\`\`

**To-Be**:
\`\`\`typescript
// 핵심 로직만, 최대 3줄. 변경된 이유를 짧은 주석으로 포함
\`\`\`

규칙:
- 코드 블록에는 핵심 상태 변경, 조건문, API 호출만 남길 것
- className/style/import 등 스타일·설정 코드는 절대 포함하지 말 것
- 가로가 긴 줄은 줄여서 표현할 것 (모바일 화면 너비 고려)
- 파일명 반복 금지
- 항목 레이블(**변경 의도**, **As-Is**, **To-Be**)은 반드시 포함할 것`;
}

/**
 * Call Gemini Flash to summarise the added lines of a diff.
 * Returns a 1-3 sentence Korean summary, or null on any failure.
 */
export async function summarizeWithGemini(
  filename: string,
  diffText: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const rawLines = diffText.split('\n');
    const addedLines = rawLines
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.substring(1));
    const removedLines = rawLines
      .filter((l) => l.startsWith('-') && !l.startsWith('---'))
      .map((l) => l.substring(1));

    if (addedLines.length === 0) return null;

    const prompt = buildPrompt(filename, addedLines, removedLines);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const resp = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 800,
          temperature: 0.2,
        },
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) return null;

    const json = await resp.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    return text || null;
  } catch {
    // Network error, timeout, JSON parse error — all silently ignored
    return null;
  }
}
