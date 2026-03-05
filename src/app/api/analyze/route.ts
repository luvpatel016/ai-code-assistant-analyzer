import OpenAI from "openai";
import { NextResponse } from "next/server";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Body = {
  code: string;
  language: string;
  task: string;
};

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY. Check your .env.local or Vercel env vars." },
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

    // Safety: prevent huge pastes from slowing / breaking your app
    if (code.length > 10000) {
      return NextResponse.json(
        { error: "Code is too large. Please paste a smaller snippet (max ~10,000 characters)." },
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
- Do NOT return a wall of text.
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
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 600,
    });

    const output = response.output_text ?? "No response generated.";

    return NextResponse.json({ result: output });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}