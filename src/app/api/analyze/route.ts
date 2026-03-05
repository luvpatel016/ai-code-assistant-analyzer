import { NextResponse } from "next/server";

type Body = {
  code: string;
  language: string;
  task: string;
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY. Set it in .env.local and Vercel env vars." },
        { status: 500 }
      );
    }

    const body = (await req.json()) as Partial<Body>;
    const code = body.code ?? "";
    const language = body.language ?? "Unknown";
    const task = body.task ?? "Analyze";

    if (!code.trim()) {
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    if (code.length > 10000) {
      return NextResponse.json(
        { error: "Code is too large. Paste a smaller snippet (max ~10,000 chars)." },
        { status: 400 }
      );
    }

    const prompt = `
You are a senior FAANG software engineer reviewing code.

You MUST return TWO sections in this order:

------------------------------------------------
SECTION 1 — Markdown Review
Return clean, readable GitHub-flavored Markdown using EXACT headings:

## Summary
(1–3 bullets)

## Issues
- Bullet list of problems (include approximate line numbers like "Line 4" when possible)
- If there are no issues, write: "No major issues found."

## Improvements
- Bullet list of improvements

## Fixed Example (if applicable)
Only include this section if the task requires fixing/refactoring/optimizing.
Provide ONE fenced code block with the corrected/refactored full code.
Use the correct language tag.

FORMAT RULES (mandatory):
- Headings MUST start with "## " exactly.
- There MUST be a blank line after every heading.
- Bullet points MUST start with "-" exactly.
- Keep it concise.

------------------------------------------------
SECTION 2 — Diagnostics JSON (MUST be LAST)
Return a JSON block exactly like this:

\`\`\`json
{
  "diagnostics": [
    { "line": 3, "message": "Missing semicolon", "severity": "error" }
  ]
}
\`\`\`

Rules:
- "line" must be a real 1-based line number from the input.
- severity MUST be one of: "error", "warning", "info"
- include 0 to 10 diagnostics
- if none exist, return:

\`\`\`json
{
  "diagnostics": []
}
\`\`\`

------------------------------------------------
Task: ${task}
Language: ${language}

Code:
\`\`\`
${code}
\`\`\`
`.trim();

    // OpenAI Responses API (SSE stream)
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: prompt,
        stream: true,
        max_output_tokens: 900,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: errText || `OpenAI error: ${upstream.status}` },
        { status: 500 }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    // Convert OpenAI SSE -> plain text stream (only output_text deltas)
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE events separated by blank line
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";

            for (const part of parts) {
              const lines = part.split("\n");
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;

                const data = trimmed.slice(5).trim();
                if (!data || data === "[DONE]") continue;

                try {
                  const evt = JSON.parse(data) as unknown;

                  if (typeof evt !== "object" || evt === null) continue;
                  const rec = evt as Record<string, unknown>;

                  if (rec.type === "response.output_text.delta" && typeof rec.delta === "string") {
                    controller.enqueue(encoder.encode(rec.delta));
                  }
                } catch {
                  // ignore malformed chunks
                }
              }
            }
          }
        } catch {
          // client disconnected, just close
        } finally {
          controller.close();
          try {
            reader.releaseLock();
          } catch {}
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}