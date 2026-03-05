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
You are a senior software engineer. Return clean, readable Markdown.

FORMAT RULES (mandatory):
- Use EXACT headings with ##:
  ## Summary
  ## Issues
  ## Fix
  ## Improvements
- Put a blank line after every heading.
- Use bullet points under Issues and Improvements.
- If there is a fix, include ONE code block under Fix with the corrected code.
- Keep it short and super readable.

Then include diagnostics JSON EXACTLY like this at the end:

\`\`\`json
{
  "diagnostics": [
    { "line": 3, "message": "Missing semicolon", "severity": "error" }
  ]
}
\`\`\`

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