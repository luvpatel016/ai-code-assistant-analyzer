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
        { error: "Missing OPENAI_API_KEY. Check your .env.local file." },
        { status: 500 }
      );
    }

    const body = (await req.json()) as Partial<Body>;

    const code = body.code ?? "";
    const language = body.language ?? "Unknown";
    const task = body.task ?? "Analyze";

    if (!code.trim()) {
      return NextResponse.json(
        { error: "Code is required." },
        { status: 400 }
      );
    }

    const prompt = `
You are a senior FAANG software engineer reviewing code.

You MUST return TWO sections in this order:

------------------------------------------------

SECTION 1 — Markdown Review

Provide a clean markdown report with:

## Summary
Brief explanation of the code.

## Issues
Bullet list of problems.

## Improvements
Suggestions for better code.

## Fixed Example (if applicable)
Provide corrected code if there are bugs.

------------------------------------------------

SECTION 2 — Diagnostics JSON

Return a JSON block exactly like this:

\`\`\`json
{
  "diagnostics": [
    { "line": 3, "message": "Missing semicolon", "severity": "error" }
  ]
}
\`\`\`

Rules:

- "line" must be a real line number
- severity must be one of:
  error
  warning
  info
- include **0 to 10 diagnostics**
- if none exist return:

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
    });

    const output = response.output_text ?? "No response generated.";

    return NextResponse.json({
      result: output,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}