/**
 * Gemini Flash integration for AI-powered diff summaries.
 * Opt-in: only runs when GEMINI_API_KEY is provided.
 * Fails silently — never blocks the main output.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const MAX_DIFF_LINES = 150;
const TIMEOUT_MS = 10_000;

function buildPrompt(filename: string, addedLines: string[], removedLines: string[]): string {
  const added = addedLines.slice(0, MAX_DIFF_LINES).join('\n');
  const removed = removedLines.slice(0, 40).join('\n');

  const removedBlock = removed.length > 0
    ? `\n제거된 코드:\n\`\`\`\n${removed}\n\`\`\`\n`
    : '';

  return `너는 시니어 개발자야. 아래는 "${filename}" 파일의 PR diff야.

추가된 코드:
\`\`\`
${added}
\`\`\`
${removedBlock}
모바일에서 PR을 빠르게 리뷰하는 개발자를 위해 한국어로 1~2줄로 요약해.

규칙:
- 코드 라인이 아니라 **비즈니스 로직의 변화**를 서술해
- API 호출, 상태 변경, UI 피드백(confirm/alert), 에러 처리 같은 부수 효과가 있으면 반드시 포함해
- 변경 전후의 동작 차이를 명확히 해 (예: "기존엔 X였지만 이제 Y를 추가로 수행")
- 기술 용어(함수명, API 경로)는 그대로 사용
- 파일명 반복 금지. 요약 문장만 출력해.`;
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
          maxOutputTokens: 500,
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
