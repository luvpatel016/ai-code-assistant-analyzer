"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Editor, { DiffEditor } from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { editor as MonacoEditorType } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

const LANGUAGES = ["C++", "Java", "Python", "JavaScript", "TypeScript", "C"] as const;

const TASKS = [
  "Find bugs and fix suggestions",
  "Explain the code simply",
  "Refactor for readability",
  "Optimize performance",
  "Generate test cases",
] as const;

type Language = (typeof LANGUAGES)[number];
type Task = (typeof TASKS)[number];

type Diagnostic = {
  line: number;
  message: string;
  severity?: "error" | "warning" | "info";
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

function stripJsonBlock(raw: string) {
  return raw.replace(/```json[\s\S]*?```/g, "").trim();
}

function safeParseDiagnostics(raw: string): Diagnostic[] {
  const match = raw.match(/```json([\s\S]*?)```/);
  if (!match) return [];

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    if (typeof parsed !== "object" || parsed === null) return [];
    const rec = parsed as Record<string, unknown>;

    const list = rec.diagnostics;
    if (!Array.isArray(list)) return [];

    const diags: Diagnostic[] = list
      .map((d: unknown): Diagnostic | null => {
        if (typeof d !== "object" || d === null) return null;
        const r = d as Record<string, unknown>;

        const line = Number(r.line);
        if (!Number.isFinite(line) || line < 1) return null;

        const message = String(r.message ?? "Issue");

        const sevRaw = r.severity;
        const severity: Diagnostic["severity"] =
          sevRaw === "warning" || sevRaw === "info" || sevRaw === "error" ? sevRaw : "error";

        return { line, message, severity };
      })
      .filter((x: Diagnostic | null): x is Diagnostic => x !== null)
      .slice(0, 10);

    return diags;
  } catch {
    return [];
  }
}

function prettifyMarkdown(raw: string) {
  let t = raw.trim();

  t = t.replace(/^SECTION\s+\d+.*$/gim, "").trim();
  t = t.replace(/^\s*Summary\s*$/gim, "## Summary");
  t = t.replace(/^\s*Issues\s*$/gim, "## Issues");
  t = t.replace(/^\s*Improvements\s*$/gim, "## Improvements");
  t = t.replace(/^\s*Fix(ed)? Example.*$/gim, "## Fixed Example");
  t = t.replace(/^(Line\s+\d+:\s+)/gim, "- $1");
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

function extractFixedCode(raw: string) {
  const fixedSectionMatch = raw.match(/## Fixed Example[\s\S]*?```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/i);
  if (fixedSectionMatch?.[1]) {
    return fixedSectionMatch[1].trim();
  }

  const anyCodeBlockMatch = raw.match(/```[a-zA-Z0-9+#-]*\n([\s\S]*?)```/);
  if (anyCodeBlockMatch?.[1]) {
    return anyCodeBlockMatch[1].trim();
  }

  return "";
}

function getRobotMood(errorCount: number, loading: boolean, chatLoading: boolean) {
  const count = Math.min(errorCount, 10);

  if (loading || chatLoading) {
    return {
      eyeColor: "#38bdf8",
      glow: "0 0 14px rgba(56,189,248,1)",
      border: "rgba(96,165,250,0.35)",
      face: "neutral",
      bubble: "I’m watching the code closely...",
      aura: "0 0 30px rgba(59,130,246,0.18)",
      label: "Scanning",
    };
  }

  if (count === 0) {
    return {
      eyeColor: "#22c55e",
      glow: "0 0 14px rgba(34,197,94,0.95)",
      border: "rgba(34,197,94,0.28)",
      face: "happy",
      bubble: "Hey, I’m here to help.",
      aura: "0 0 26px rgba(34,197,94,0.16)",
      label: "Calm",
    };
  }

  if (count <= 2) {
    return {
      eyeColor: "#facc15",
      glow: "0 0 16px rgba(250,204,21,0.95)",
      border: "rgba(250,204,21,0.28)",
      face: "concerned",
      bubble: "A couple issues. Nothing too crazy.",
      aura: "0 0 28px rgba(250,204,21,0.14)",
      label: "Concerned",
    };
  }

  if (count <= 5) {
    return {
      eyeColor: "#fb923c",
      glow: "0 0 18px rgba(251,146,60,1)",
      border: "rgba(251,146,60,0.3)",
      face: "annoyed",
      bubble: "Okay... this code is getting messy.",
      aura: "0 0 34px rgba(251,146,60,0.18)",
      label: "Annoyed",
    };
  }

  if (count <= 9) {
    return {
      eyeColor: "#ef4444",
      glow: "0 0 22px rgba(239,68,68,1)",
      border: "rgba(239,68,68,0.36)",
      face: "angry",
      bubble: "We’ve got a serious bug situation here.",
      aura: "0 0 40px rgba(239,68,68,0.24)",
      label: "Angry",
    };
  }

  return {
    eyeColor: "#dc2626",
    glow: "0 0 28px rgba(220,38,38,1)",
    border: "rgba(220,38,38,0.42)",
    face: "furious",
    bubble: "10+ issues? Yeah... I’m not happy.",
    aura: "0 0 50px rgba(220,38,38,0.32)",
    label: "Furious",
  };
}

function RobotAssistant({
  loading,
  chatLoading,
  errorCount,
}: {
  loading: boolean;
  chatLoading: boolean;
  errorCount: number;
}) {
  const mood = getRobotMood(errorCount, loading, chatLoading);

  const mouthStyles: Record<string, React.CSSProperties> = {
    happy: {
      width: 26,
      height: 12,
      borderBottom: "4px solid #cbd5e1",
      borderRadius: "0 0 999px 999px",
    },
    neutral: {
      width: 26,
      height: 4,
      background: "#cbd5e1",
      borderRadius: 999,
    },
    concerned: {
      width: 20,
      height: 4,
      background: "#e5e7eb",
      borderRadius: 999,
      transform: "translateX(-50%) rotate(-8deg)",
    },
    annoyed: {
      width: 22,
      height: 4,
      background: "#fecaca",
      borderRadius: 999,
    },
    angry: {
      width: 24,
      height: 4,
      background: "#fecaca",
      borderRadius: 999,
    },
    furious: {
      width: 28,
      height: 4,
      background: "#fee2e2",
      borderRadius: 999,
    },
  };

  return (
    <div
      style={{
        background: "rgba(8, 14, 30, 0.82)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 24,
        padding: 18,
        boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: 18,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 130,
            height: 160,
            animation: "robotFloat 2.6s ease-in-out infinite",
            filter: mood.aura,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: "50%",
              transform: "translateX(-50%)",
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: mood.eyeColor,
              boxShadow: mood.glow,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              width: 4,
              height: 18,
              background: "#64748b",
              borderRadius: 999,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 28,
              left: "50%",
              transform: "translateX(-50%)",
              width: 88,
              height: 68,
              borderRadius: 20,
              background: "linear-gradient(180deg, #1e293b, #0f172a)",
              border: `2px solid ${mood.border}`,
              boxShadow: mood.aura,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: errorCount >= 6 && !loading && !chatLoading ? 18 : 22,
                left: 17,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: mood.eyeColor,
                boxShadow: mood.glow,
                transform: errorCount >= 6 && !loading && !chatLoading ? "rotate(-14deg)" : "none",
                animation:
                  loading || chatLoading
                    ? "robotBlink 0.8s ease-in-out infinite"
                    : errorCount >= 6
                      ? "robotPulse 1s ease-in-out infinite"
                      : "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: errorCount >= 6 && !loading && !chatLoading ? 18 : 22,
                right: 17,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: mood.eyeColor,
                boxShadow: mood.glow,
                transform: errorCount >= 6 && !loading && !chatLoading ? "rotate(14deg)" : "none",
                animation:
                  loading || chatLoading
                    ? "robotBlink 0.8s ease-in-out infinite 0.2s"
                    : errorCount >= 6
                      ? "robotPulse 1s ease-in-out infinite 0.2s"
                      : "none",
              }}
            />
            {errorCount >= 6 && !loading && !chatLoading && (
              <>
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    left: 13,
                    width: 20,
                    height: 3,
                    background: "#fca5a5",
                    borderRadius: 999,
                    transform: "rotate(18deg)",
                    opacity: 0.9,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    right: 13,
                    width: 20,
                    height: 3,
                    background: "#fca5a5",
                    borderRadius: 999,
                    transform: "rotate(-18deg)",
                    opacity: 0.9,
                  }}
                />
              </>
            )}
            <div
              style={{
                position: "absolute",
                bottom: mood.face === "happy" ? 10 : 13,
                left: "50%",
                transform:
                  mouthStyles[mood.face].transform ?? "translateX(-50%)",
                ...mouthStyles[mood.face],
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              top: 100,
              left: "50%",
              transform: "translateX(-50%)",
              width: 72,
              height: 42,
              borderRadius: 18,
              background: "linear-gradient(180deg, #172554, #0f172a)",
              border: `2px solid ${mood.border}`,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 100,
              left: 16,
              width: 18,
              height: 42,
              borderRadius: 999,
              background: "#1e293b",
              transform: "rotate(22deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 100,
              right: 16,
              width: 18,
              height: 42,
              borderRadius: 999,
              background: "#1e293b",
              transform: "rotate(-22deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 40,
              width: 14,
              height: 34,
              borderRadius: 999,
              background: "#1e293b",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              right: 40,
              width: 14,
              height: 34,
              borderRadius: 999,
              background: "#1e293b",
            }}
          />
        </div>
      </div>

      <div
        style={{
          background: "rgba(15, 23, 42, 0.95)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 18,
          padding: "14px 16px",
          color: "white",
          fontSize: 14,
          lineHeight: 1.6,
          boxShadow: "0 10px 25px rgba(0,0,0,0.22)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 10,
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <div style={{ fontWeight: 800, color: "#bfdbfe" }}>Debug AI</div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
              color: errorCount >= 6 ? "#fca5a5" : "#cbd5e1",
            }}
          >
            {mood.label}
          </div>
        </div>
        <div>{mood.bubble}</div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            background: "rgba(15, 23, 42, 0.82)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 16,
            padding: 12,
            fontSize: 13,
            color: "#cbd5e1",
          }}
        >
          Error pressure:
          <div style={{ marginTop: 8, lineHeight: 1.7 }}>
            • 0 = calm green
            <br />
            • 1–2 = warning yellow
            <br />
            • 3–5 = annoyed orange
            <br />
            • 6+ = angry red
            <br />
            • 10+ = furious glow
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [code, setCode] = useState<string>(
    `#include <iostream>
using namespace std;

int main() {
  int x = 5;
  if (x = 10) {
    cout << "x is 10";
  }
  return 0;
}
`
  );

  const [language, setLanguage] = useState<Language>("C++");
  const [task, setTask] = useState<Task>(TASKS[0]);
  const [result, setResult] = useState<string>("");
  const [displayText, setDisplayText] = useState<string>("");
  const [fixedCode, setFixedCode] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [dots, setDots] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);

  const [chatInput, setChatInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const languageToMonaco = useMemo<Record<Language, string>>(
    () => ({
      "C++": "cpp",
      C: "c",
      Java: "java",
      Python: "python",
      JavaScript: "javascript",
      TypeScript: "typescript",
    }),
    []
  );

  const monacoLanguage = languageToMonaco[language] ?? "plaintext";
  const lineCount = code.split("\n").length;
  const errorCount = diagnostics.filter((d) => d.severity === "error").length || diagnostics.length;

  useEffect(() => {
    if (!loading) {
      setDots("");
      return;
    }

    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
    }, 400);

    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const container = chatContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    });

    chatEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [chatHistory, chatLoading]);

  function clearMarkers() {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    monaco.editor.setModelMarkers(model, "ai-review", []);
  }

  function applyMarkers(nextDiagnostics: Diagnostic[]) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const markers = nextDiagnostics.map((d: Diagnostic) => {
      const safeLine = Math.max(1, Math.min(d.line, model.getLineCount()));
      const severity =
        d.severity === "warning"
          ? monaco.MarkerSeverity.Warning
          : d.severity === "info"
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Error;

      return {
        startLineNumber: safeLine,
        startColumn: 1,
        endLineNumber: safeLine,
        endColumn: model.getLineMaxColumn(safeLine),
        message: d.message || "Issue",
        severity,
      };
    });

    monaco.editor.setModelMarkers(model, "ai-review", markers);
  }

  async function readStreamAsText(res: Response) {
    if (!res.body) {
      throw new Error("No response body (stream missing).");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
    }

    return full;
  }

  async function analyze() {
    setLoading(true);
    setResult("");
    setDisplayText("");
    setFixedCode("");
    setDiagnostics([]);
    clearMarkers();

    let full = "";

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language, task }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({} as unknown));
        const msg =
          typeof err === "object" && err !== null && "error" in err
            ? String((err as Record<string, unknown>).error ?? "Request failed")
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }

      if (!res.body) {
        throw new Error("No response body (stream missing).");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setDisplayText(full);
      }

      const nextDiagnostics = safeParseDiagnostics(full);
      setDiagnostics(nextDiagnostics);
      applyMarkers(nextDiagnostics);

      const cleaned = prettifyMarkdown(stripJsonBlock(full));
      const finalText = cleaned || "No output returned.";
      const extractedFixedCode = extractFixedCode(finalText);

      setResult(finalText);
      setDisplayText(finalText);
      setFixedCode(extractedFixedCode);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const finalText = `## Error\n\n${msg}`;
      setResult(finalText);
      setDisplayText(finalText);
      setFixedCode("");
      setDiagnostics([{ line: 1, message: msg, severity: "error" }]);
    } finally {
      setLoading(false);
    }
  }

  async function copyOutput() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
  }

  async function copyFixedCode() {
    if (!fixedCode) return;
    await navigator.clipboard.writeText(fixedCode);
  }

  function applyFixToEditor() {
    if (!fixedCode) return;
    setCode(fixedCode);
  }

  async function askAI() {
    const question = chatInput.trim();
    if (!question || chatLoading) return;

    const nextHistory = [...chatHistory, { role: "user" as const, content: question }];
    setChatHistory(nextHistory);
    setChatInput("");
    setChatLoading(true);

    requestAnimationFrame(() => {
      chatContainerRef.current?.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    });

    try {
      const chatTask = `
Answer the user's question about the code and the ongoing conversation.

Instructions:
- Answer clearly and directly.
- Use the prior conversation for context when useful.
- Respect the user's coding style preferences when possible.
- If asked "who created you" or anything meaning the same thing, respond with exactly:
My creator is Luv Patel, the creator of Debug AI.
- If the user asks for a fix, include a corrected example when helpful.
- Do not mention SECTION 1 or SECTION 2.
      `.trim();

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          task: chatTask,
          chatHistory: nextHistory,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({} as unknown));
        const msg =
          typeof err === "object" && err !== null && "error" in err
            ? String((err as Record<string, unknown>).error ?? "Request failed")
            : `Request failed (${res.status})`;
        throw new Error(msg);
      }

      const full = await readStreamAsText(res);
      const cleaned = prettifyMarkdown(stripJsonBlock(full)) || "No answer returned.";

      setChatHistory((prev) => [...prev, { role: "assistant", content: cleaned }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: `## Error\n\n${msg}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: "#374151",
    color: "white",
    border: "1px solid #4b5563",
    padding: "10px 12px",
    borderRadius: 12,
    outline: "none",
    cursor: "pointer",
    fontSize: 14,
    minWidth: 180,
  };

  const secondaryButtonStyle: React.CSSProperties = {
    background: "rgba(17, 24, 39, 0.9)",
    color: "white",
    border: "1px solid rgba(255,255,255,0.08)",
    padding: "10px 14px",
    borderRadius: 12,
    cursor: "pointer",
    opacity: 1,
    fontWeight: 600,
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, #1f2a44 0%, #0b1020 35%, #050816 70%, #000000 100%)",
        padding: "36px 16px 60px",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        color: "white",
      }}
    >
      <style jsx>{`
        select:hover {
          background-color: #4b5563 !important;
          border-color: #6b7280 !important;
        }

        select:focus {
          outline: none;
          border-color: #60a5fa !important;
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.2);
        }

        option {
          background-color: #374151;
          color: white;
        }

        .glass-card {
          background: rgba(10, 15, 30, 0.72);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 10px 35px rgba(0, 0, 0, 0.35);
        }

        @keyframes robotFloat {
          0%,
          100% {
            transform: translateY(0px);
          }
          50% {
            transform: translateY(-8px);
          }
        }

        @keyframes robotBlink {
          0%,
          100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(0.75);
            opacity: 0.7;
          }
        }

        @keyframes robotPulse {
          0%,
          100% {
            transform: scale(1);
            filter: brightness(1);
          }
          50% {
            transform: scale(1.08);
            filter: brightness(1.25);
          }
        }

        @media (max-width: 1100px) {
          .debug-layout {
            grid-template-columns: 1fr !important;
          }

          .debug-sidebar {
            position: static !important;
            top: auto !important;
          }
        }
      `}</style>

      <div
        className="debug-layout"
        style={{
          maxWidth: 1450,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 360px",
          gap: 22,
          alignItems: "start",
        }}
      >
        <div
          className="glass-card"
          style={{
            borderRadius: 24,
            padding: 24,
          }}
        >
          <h1
            style={{
              fontSize: 32,
              fontWeight: 800,
              marginBottom: 8,
              letterSpacing: "-0.02em",
            }}
          >
            Debug AI
          </h1>

          <p
            style={{
              opacity: 0.82,
              marginTop: 0,
              marginBottom: 10,
              fontSize: 15,
            }}
          >
            Paste code, choose a task, and get a streamed AI review with markdown output,
            inline diagnostics, side-by-side fix comparison, and follow-up AI chat.
          </p>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 12px",
              borderRadius: 999,
              background: "rgba(37, 99, 235, 0.12)",
              border: "1px solid rgba(96, 165, 250, 0.2)",
              fontSize: 13,
              color: "#c7d2fe",
              marginBottom: 20,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#22c55e",
                display: "inline-block",
                boxShadow: "0 0 12px rgba(34,197,94,0.8)",
              }}
            />
            Debug AI • GPT-4.1-mini • Streaming Enabled • Diff View Ready
          </div>

          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 4,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as Language)}
              style={selectStyle}
            >
              {LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>

            <select
              value={task}
              onChange={(e) => setTask(e.target.value as Task)}
              style={selectStyle}
            >
              {TASKS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button
              onClick={analyze}
              disabled={loading || !code.trim()}
              style={{
                background: "linear-gradient(90deg, #2563eb, #4f46e5)",
                color: "white",
                border: "none",
                padding: "10px 16px",
                borderRadius: 12,
                cursor: loading || !code.trim() ? "not-allowed" : "pointer",
                opacity: loading || !code.trim() ? 0.72 : 1,
                fontWeight: 700,
                boxShadow: "0 0 24px rgba(79,70,229,0.35)",
              }}
            >
              {loading ? `Analyzing${dots}` : "Analyze"}
            </button>

            <button onClick={copyOutput} disabled={!result} style={secondaryButtonStyle}>
              Copy Output
            </button>
          </div>

          <div style={{ marginTop: 18 }}>
            <Editor
              height="420px"
              language={monacoLanguage}
              theme="vs-dark"
              value={code}
              onChange={(value) => setCode(value || "")}
              onMount={(editor, monaco) => {
                editorRef.current = editor;
                monacoRef.current = monaco;
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: "on",
                scrollBeyondLastLine: false,
                padding: { top: 14, bottom: 14 },
                smoothScrolling: true,
                cursorBlinking: "smooth",
                roundedSelection: true,
              }}
            />
          </div>

          <div
            style={{
              marginTop: 8,
              opacity: 0.62,
              fontSize: 12,
            }}
          >
            {lineCount} lines • {language} • {task} • {diagnostics.length} diagnostics
          </div>

          <h2 style={{ marginTop: 24, fontSize: 19, fontWeight: 700 }}>Output</h2>

          <div
            style={{
              padding: 18,
              background: "rgba(3, 7, 18, 0.9)",
              borderRadius: 16,
              minHeight: 220,
              border: "1px solid rgba(255,255,255,0.08)",
              lineHeight: 1.7,
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)",
            }}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => (
                  <h2
                    style={{
                      marginTop: 18,
                      marginBottom: 8,
                      fontSize: 19,
                      fontWeight: 800,
                    }}
                  >
                    {children}
                  </h2>
                ),
                ul: ({ children }) => (
                  <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 12 }}>{children}</ul>
                ),
                li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
                p: ({ children }) => <p style={{ marginTop: 8, marginBottom: 10 }}>{children}</p>,
                code: ({ children }) => (
                  <code
                    style={{
                      background: "#111827",
                      padding: "2px 6px",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre
                    style={{
                      background: "#020617",
                      padding: 14,
                      borderRadius: 14,
                      overflowX: "auto",
                      border: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {children}
                  </pre>
                ),
              }}
            >
              {displayText || (loading ? `Analyzing${dots}` : "Run the analyzer to see results.")}
            </ReactMarkdown>
          </div>

          {fixedCode && (
            <>
              <div
                style={{
                  marginTop: 28,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h2 style={{ fontSize: 19, fontWeight: 700, margin: 0 }}>
                  Suggested Fix Diff View
                </h2>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={copyFixedCode} style={secondaryButtonStyle}>
                    Copy Fixed Code
                  </button>

                  <button
                    onClick={applyFixToEditor}
                    style={{
                      background: "linear-gradient(90deg, #059669, #10b981)",
                      color: "white",
                      border: "none",
                      padding: "10px 14px",
                      borderRadius: 12,
                      cursor: "pointer",
                      fontWeight: 700,
                      boxShadow: "0 0 20px rgba(16,185,129,0.25)",
                    }}
                  >
                    Apply Fix to Editor
                  </button>
                </div>
              </div>

              <p
                style={{
                  marginTop: 8,
                  opacity: 0.72,
                  fontSize: 14,
                }}
              >
                Compare your original code against the AI-suggested improved version.
              </p>

              <div
                style={{
                  marginTop: 14,
                  borderRadius: 16,
                  overflow: "hidden",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#020617",
                }}
              >
                <DiffEditor
                  height="420px"
                  theme="vs-dark"
                  language={monacoLanguage}
                  original={code}
                  modified={fixedCode}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    fontSize: 14,
                    wordWrap: "on",
                    scrollBeyondLastLine: false,
                    renderOverviewRuler: true,
                    diffWordWrap: "on",
                    automaticLayout: true,
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div
          className="debug-sidebar"
          style={{
            position: "sticky",
            top: 24,
            alignSelf: "start",
            display: "grid",
            gap: 16,
          }}
        >
          <RobotAssistant loading={loading} chatLoading={chatLoading} errorCount={errorCount} />

          <div
            style={{
              background: "rgba(8, 14, 30, 0.82)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 24,
              padding: 18,
              boxShadow: "0 18px 45px rgba(0,0,0,0.35)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, marginTop: 0, marginBottom: 8 }}>
              Ask Debug AI
            </h2>

            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                opacity: 0.74,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Ask questions about the code right here. The AI replies below the robot.
            </p>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void askAI();
                  }
                }}
                placeholder="Ask anything about this code..."
                style={{
                  width: "100%",
                  minHeight: 92,
                  resize: "vertical",
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#0f172a",
                  color: "white",
                  outline: "none",
                  fontSize: 14,
                  lineHeight: 1.5,
                }}
              />

              <button
                onClick={() => void askAI()}
                disabled={chatLoading || !chatInput.trim()}
                style={{
                  background: "linear-gradient(90deg, #2563eb, #3b82f6)",
                  color: "white",
                  border: "none",
                  padding: "12px 16px",
                  borderRadius: 12,
                  cursor: chatLoading || !chatInput.trim() ? "not-allowed" : "pointer",
                  opacity: chatLoading || !chatInput.trim() ? 0.72 : 1,
                  fontWeight: 700,
                  width: "100%",
                }}
              >
                {chatLoading ? "Thinking..." : "Ask AI"}
              </button>
            </div>

            <div
              ref={chatContainerRef}
              style={{
                marginTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                maxHeight: 520,
                overflowY: "auto",
                paddingRight: 4,
                scrollBehavior: "smooth",
              }}
            >
              {chatHistory.length === 0 ? (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "rgba(3, 7, 18, 0.75)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    opacity: 0.76,
                    fontSize: 13,
                    lineHeight: 1.7,
                  }}
                >
                  Try asking:
                  <div style={{ marginTop: 8 }}>
                    • Why is line 5 wrong?
                    <br />
                    • Keep using namespace std; and fix only the bug
                    <br />
                    • Who created you?
                  </div>
                </div>
              ) : (
                chatHistory.map((msg, index) => (
                  <div
                    key={index}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background:
                        msg.role === "user"
                          ? "rgba(37, 99, 235, 0.14)"
                          : "rgba(3, 7, 18, 0.85)",
                      border:
                        msg.role === "user"
                          ? "1px solid rgba(96, 165, 250, 0.22)"
                          : "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.05em",
                        textTransform: "uppercase",
                        opacity: 0.7,
                        marginBottom: 8,
                      }}
                    >
                      {msg.role === "user" ? "You" : "Debug AI"}
                    </div>

                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h2: ({ children }) => (
                          <h2
                            style={{
                              marginTop: 12,
                              marginBottom: 8,
                              fontSize: 16,
                              fontWeight: 800,
                            }}
                          >
                            {children}
                          </h2>
                        ),
                        ul: ({ children }) => (
                          <ul style={{ paddingLeft: 18, marginTop: 8, marginBottom: 10 }}>
                            {children}
                          </ul>
                        ),
                        li: ({ children }) => <li style={{ marginBottom: 5 }}>{children}</li>,
                        p: ({ children }) => (
                          <p style={{ marginTop: 8, marginBottom: 10, lineHeight: 1.6 }}>
                            {children}
                          </p>
                        ),
                        code: ({ children }) => (
                          <code
                            style={{
                              background: "#111827",
                              padding: "2px 6px",
                              borderRadius: 8,
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            {children}
                          </code>
                        ),
                        pre: ({ children }) => (
                          <pre
                            style={{
                              background: "#020617",
                              padding: 12,
                              borderRadius: 14,
                              overflowX: "auto",
                              border: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            {children}
                          </pre>
                        ),
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ))
              )}

              {chatLoading && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    background: "rgba(3, 7, 18, 0.85)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                      opacity: 0.7,
                      marginBottom: 8,
                    }}
                  >
                    Debug AI
                  </div>
                  <p style={{ margin: 0, opacity: 0.85 }}>Thinking...</p>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}