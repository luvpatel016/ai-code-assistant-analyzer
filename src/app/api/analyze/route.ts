import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type Body = {
  code: string;
  language: string;
  task: string;
  chatHistory?: ChatMessage[];
};

function buildDirectMarkdownResponse(message: string) {
  return `## Summary

- ${message}

## Issues

- No major issues found.

## Improvements

- Ask another question about the code or Debug AI.

\`\`\`json
{
  "diagnostics": []
}
\`\`\``;
}

function isCreatorQuestion(text: string) {
  const normalized = text.toLowerCase().replace(/[^\w\s]/g, "").trim();

  const phrases = [
    "who created you",
    "who made you",
    "whos your creator",
    "who is your creator",
    "who created debug ai",
    "who made debug ai",
    "who built you",
    "who built debug ai",
    "who is your maker",
  ];

  return phrases.some((phrase) => normalized.includes(phrase));
}

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
    const chatHistory = Array.isArray(body.chatHistory) ? body.chatHistory.slice(-12) : [];

    const latestUserMessage =
      [...chatHistory].reverse().find((msg) => msg.role === "user")?.content ?? "";

    const creatorCheckText = `${task}\n${latestUserMessage}`;

    if (isCreatorQuestion(creatorCheckText)) {
      return new NextResponse(
        buildDirectMarkdownResponse("My creator is Luv Patel, the creator of Debug AI."),
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
          },
        }
      );
    }

    if (!code.trim()) {
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    if (code.length > 10000) {
      return NextResponse.json(
        { error: "Code is too large. Paste a smaller snippet (max ~10,000 chars)." },
        { status: 400 }
      );
    }

    const conversationContext =
      chatHistory.length > 0
        ? chatHistory
            .map((msg, index) => `${index + 1}. ${msg.role.toUpperCase()}: ${msg.content}`)
            .join("\n\n")
        : "No previous conversation.";

    const prompt = `
You are Debug AI, an AI coding assistant for reviewing code and answering code questions.

IDENTITY RULE:
- If the user asks who created you, who made you, who your creator is, or anything with the same meaning, respond with exactly:
My creator is Luv Patel, the creator of Debug AI.

IMPORTANT CODE STYLE RULES:
- Respect the user's coding style when possible.
- If the user uses \`using namespace std;\`, keep it unless it causes a real correctness, safety, or compilation issue.
- Do NOT rewrite the whole program just to match your own preferences.
- Prefer minimal edits.
- Keep the user's naming style, structure, and formatting when reasonable.
- Only change style when it is necessary for correctness, safety, clarity, or performance.

IMPORTANT RESPONSE RULES:
- Use the past conversation context when helpful.
- Answer clearly, directly, and helpfully.
- If the task is asking a question about the code, answer the question directly first.
- If the task asks for a fix, refactor, or optimization, include a fixed example when appropriate.
- Approximate line numbers are helpful when possible.

You MUST return TWO sections in this exact order.

------------------------------------------------
SECTION 1 — Markdown Review

Return clean, readable GitHub-flavored Markdown using EXACT headings:

## Summary
(1–3 bullets)

## Issues
- Bullet list of problems
- Include approximate line numbers like "Line 4" when possible
- If there are no issues, write exactly: "No major issues found."

## Improvements
- Bullet list of improvements

## Fixed Example (if applicable)
Only include this section if the task requires fixing, refactoring, optimizing, or giving a corrected version.
Provide ONE fenced code block with the corrected or refactored full code.
Use the correct language tag.

FORMAT RULES:
- Headings MUST start with "## " exactly
- There MUST be a blank line after every heading
- Bullet points MUST start with "-" exactly
- Keep it concise and professional

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
- "line" must be a real 1-based line number from the input
- severity MUST be one of: "error", "warning", "info"
- include 0 to 10 diagnostics
- if none exist, return exactly:

\`\`\`json
{
  "diagnostics": []
}
\`\`\`

------------------------------------------------
Task:
${task}

Language:
${language}

Previous conversation:
${conversationContext}

Code:
\`\`\`${language.toLowerCase()}
${code}
\`\`\`
`.trim();

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
        max_output_tokens: 1200,
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

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstream.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

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
                  // Ignore malformed chunks
                }
              }
            }
          }
        } catch {
          // Client disconnected or stream closed unexpectedly
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