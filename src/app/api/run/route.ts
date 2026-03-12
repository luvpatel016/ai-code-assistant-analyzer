import { NextResponse } from "next/server";

type RunBody = {
  code: string;
  language: string;
};

function mapLanguage(language: string) {
  const normalized = language.toLowerCase();

  if (normalized === "c++") return "cpp";
  if (normalized === "javascript") return "javascript";
  if (normalized === "typescript") return "typescript";
  if (normalized === "python") return "python";
  if (normalized === "java") return "java";
  if (normalized === "c") return "c";

  return normalized;
}

function getFileName(language: string) {
  const normalized = language.toLowerCase();

  if (normalized === "c++") return "main.cpp";
  if (normalized === "c") return "main.c";
  if (normalized === "java") return "Main.java";
  if (normalized === "python") return "main.py";
  if (normalized === "javascript") return "main.js";
  if (normalized === "typescript") return "main.ts";

  return "main.txt";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<RunBody>;
    const code = body.code ?? "";
    const language = body.language ?? "";

    if (!code.trim()) {
      return NextResponse.json({ error: "Code is required." }, { status: 400 });
    }

    if (!language.trim()) {
      return NextResponse.json({ error: "Language is required." }, { status: 400 });
    }

    const pistonLanguage = mapLanguage(language);

    const upstream = await fetch("https://emkc.org/api/v2/piston/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: pistonLanguage,
        version: "*",
        files: [
          {
            name: getFileName(language),
            content: code,
          },
        ],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: errText || `Runner error: ${upstream.status}` },
        { status: 500 }
      );
    }

    const data = (await upstream.json()) as {
      compile?: { output?: string };
      run?: { output?: string; stderr?: string; stdout?: string };
    };

    const compileOutput = data.compile?.output ?? "";
    const runOutput = data.run?.output ?? data.run?.stdout ?? data.run?.stderr ?? "";
    const combined = [compileOutput, runOutput].filter(Boolean).join("\n");

    return NextResponse.json({
      output: combined || "Program finished with no output.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Execution error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}