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
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    const prompt = `
You are a senior software engineer reviewing code.

Respond ONLY in clean Markdown format.

Task: ${task}
Language: ${language}

Code:
\`\`\`
${code}
\`\`\`

Return your response using the following sections:

## Summary
Briefly explain what the code does.

## Issues Found
- List bugs or problems
- Mention approximate line numbers if possible
- If there are no issues, say "No major issues found."

## Fix Suggestions
- Provide clear bullet point improvements.

## Improved Code
Provide the corrected or improved version of the code inside ONE fenced code block.

## Test Cases
Only include this section when the task is "Generate test cases".
Provide multiple test cases including edge cases.

Do NOT return a wall of text.
Always structure the response using headings and bullet points.
`;

    const response = await client.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    return NextResponse.json({ result: response.output_text ?? "" });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}