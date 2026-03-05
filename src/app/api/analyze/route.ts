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
You are a senior software engineer helping a student.

Task: ${task}
Language: ${language}

Code:
\`\`\`
${code}
\`\`\`

Return:
1) Bugs/issues (bullets)
2) Explanation (simple)
3) Improvements/refactor
4) Time & space complexity (if applicable)
5) 3 test cases (if applicable)
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