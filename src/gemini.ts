/**
 * Gemini Flash integration for AI-powered diff summaries.
 * Opt-in: only runs when GEMINI_API_KEY is provided.
 * Fails silently — never blocks the main output.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const MAX_DIFF_LINES = 150;
const MAX_REMOVED_LINES = 60;
const TIMEOUT_MS = 10_000;

function buildPrompt(filename: string, addedLines: string[], removedLines: string[]): string {
  const added = addedLines.slice(0, MAX_DIFF_LINES).join('\n');
  const removed = removedLines.slice(0, MAX_REMOVED_LINES).join('\n');

  const removedBlock = removed.length > 0
    ? `\n변경 전 코드 (제거됨):\n\`\`\`\n${removed}\n\`\`\`\n`
    : '';

  return `너는 시니어 개발자야. 아래는 "${filename}" 파일의 PR diff야.

변경 후 코드 (추가됨):
\`\`\`
${added}
\`\`\`
${removedBlock}
모바일에서 PR을 빠르게 리뷰하는 개발자를 위해 아래 형식으로 한국어로 작성해.

출력 형식 (반드시 이 구조를 따를 것):
**변경 의도**: (한 줄. 이 변경이 왜 필요했는지, 어떤 문제/목적인지)
**As-Is**: (기존 동작을 동사 중심으로 1~2줄. 버그라면 어떤 특성이 문제였는지 포함)
**To-Be**: (변경 후 동작을 동사 중심으로 1~2줄. 새로 생긴 이득이나 해결점 포함)

규칙:
- 코드를 출력하지 말 것. 논리 흐름과 동작 변화만 서술
- 기술 용어(함수명, 속성명, API 경로)는 그대로 사용
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
