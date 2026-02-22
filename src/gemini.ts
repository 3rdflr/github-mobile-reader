/**
 * Gemini Flash integration for AI-powered diff summaries.
 * Opt-in: only runs when GEMINI_API_KEY is provided.
 * Fails silently — never blocks the main output.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const MAX_DIFF_LINES = 150;
const TIMEOUT_MS = 10_000;

function buildPrompt(filename: string, addedLines: string[]): string {
  const capped = addedLines.slice(0, MAX_DIFF_LINES);
  const code = capped.join('\n');
  return `아래는 "${filename}" 파일의 코드 변경 내용(추가된 라인)입니다.

\`\`\`
${code}
\`\`\`

변경 내용을 한국어로 1~3줄로 요약하세요.
- 무엇이 추가/수정/제거됐는지
- 기술적 용어(함수명, API명)는 그대로 사용
- 파일명 반복 금지. 변경 내용만 출력하세요.`;
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
    // Extract only added lines (strip the leading '+')
    const addedLines = diffText
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.substring(1));

    if (addedLines.length === 0) return null;

    const prompt = buildPrompt(filename, addedLines);

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
