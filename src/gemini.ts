/**
 * Gemini Flash integration for AI-powered diff summaries.
 * Opt-in: only runs when GEMINI_API_KEY is provided.
 * Fails silently — never blocks the main output.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

const MAX_DIFF_LINES = 150;
const TIMEOUT_MS = 10_000;

function buildPrompt(filename: string, addedLines: string[]): string {
  const capped = addedLines.slice(0, MAX_DIFF_LINES);
  const code = capped.join('\n');
  return `다음은 코드 변경 내용입니다.
파일명: ${filename}

\`\`\`
${code}
\`\`\`

위 변경 사항을 한국어로 1~3줄로 간결하게 요약해주세요.
- 이 파일/함수가 무엇을 하는지 핵심만
- 주요 변경 내용 (추가/제거/수정된 기능)
- 기술적 용어(함수명, API명, 라이브러리명)는 그대로 사용
요약 텍스트만 출력하세요. 마크다운, 설명, 접두어 없이.`;
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
          maxOutputTokens: 200,
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
