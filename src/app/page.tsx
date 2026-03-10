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

function RobotAssistant({ loading }: { loading: boolean }) {
  return (
    <div
      style={{
        position: "sticky",
        top: 24,
        alignSelf: "start",
      }}
    >
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
              width: 120,
              height: 150,
              animation: "robotFloat 2.6s ease-in-out infinite",
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
                background: "#60a5fa",
                boxShadow: "0 0 14px rgba(96,165,250,0.8)",
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
                width: 84,
                height: 64,
                borderRadius: 20,
                background: "linear-gradient(180deg, #1e293b, #0f172a)",
                border: "2px solid rgba(96,165,250,0.35)",
                boxShadow: "0 0 24px rgba(59,130,246,0.18)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 22,
                  left: 18,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#38bdf8",
                  boxShadow: loading
                    ? "0 0 12px rgba(56,189,248,1)"
                    : "0 0 10px rgba(56,189,248,0.8)",
                  animation: loading ? "robotBlink 0.8s ease-in-out infinite" : "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 22,
                  right: 18,
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: "#38bdf8",
                  boxShadow: loading
                    ? "0 0 12px rgba(56,189,248,1)"
                    : "0 0 10px rgba(56,189,248,0.8)",
                  animation: loading ? "robotBlink 0.8s ease-in-out infinite 0.2s" : "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 28,
                  height: 4,
                  borderRadius: 999,
                  background: "#93c5fd",
                  opacity: 0.9,
                }}
              />
            </div>
            <div
              style={{
                position: "absolute",
                top: 96,
                left: "50%",
                transform: "translateX(-50%)",
                width: 68,
                height: 40,
                borderRadius: 18,
                background: "linear-gradient(180deg, #172554, #0f172a)",
                border: "2px solid rgba(96,165,250,0.22)",
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 98,
                left: 14,
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
                top: 98,
                right: 14,
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
                left: 38,
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
                right: 38,
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
          <div style={{ fontWeight: 800, marginBottom: 6, color: "#bfdbfe" }}>Debug AI</div>
          <div>
            {loading ? "I’m analyzing your code right now..." : "Hey, I’m here to help."}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
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
            Ask me things like:
            <div style={{ marginTop: 8, lineHeight: 1.7 }}>
              • Why is this line wrong?
              <br />
              • Fix only the bug
              <br />
              • Keep my coding style
            </div>
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

  const [chatInput, setChatInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState<boolean>(false);

  const editorRef = useRef<MonacoEditorType.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const chatSectionRef = useRef<HTMLDivElement | null>(null);
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

    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: "smooth",
      });
    }

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

  function applyMarkers(diagnostics: Diagnostic[]) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const markers = diagnostics.map((d: Diagnostic) => {
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

      const diagnostics = safeParseDiagnostics(full);
      applyMarkers(diagnostics);

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
      chatSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
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
            transform: scale(0.8);
            opacity: 0.7;
          }
        }

        @media (max-width: 1024px) {
          .debug-layout {
            grid-template-columns: 1fr !important;
          }

          .debug-robot-panel {
            order: -1;
          }
        }
      `}</style>

      <div
        className="debug-layout"
        style={{
          maxWidth: 1420,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
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
            Debug AI • GPT-4.1-mini • Streaming Enabled • Diff View Ready • Chat Enabled
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
            {lineCount} lines • {language} • {task}
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

          <div ref={chatSectionRef} style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>
              Ask Debug AI About This Code
            </h2>

            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                opacity: 0.72,
                fontSize: 14,
              }}
            >
              Ask follow-up questions about the code, bugs, fixes, or past messages in this chat.
            </p>

            <div
              style={{
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "stretch",
              }}
            >
              <input
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
                  flex: 1,
                  minWidth: 260,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#0f172a",
                  color: "white",
                  outline: "none",
                  fontSize: 14,
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
                  minWidth: 110,
                }}
              >
                {chatLoading ? "Thinking..." : "Ask AI"}
              </button>
            </div>

            <div
              ref={chatContainerRef}
              style={{
                marginTop: 18,
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
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(3, 7, 18, 0.75)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    opacity: 0.7,
                    fontSize: 14,
                  }}
                >
                  No questions yet. Try asking:
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
                      padding: 16,
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
                        fontSize: 12,
                        fontWeight: 700,
                        letterSpacing: "0.03em",
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
                              marginTop: 14,
                              marginBottom: 8,
                              fontSize: 18,
                              fontWeight: 800,
                            }}
                          >
                            {children}
                          </h2>
                        ),
                        ul: ({ children }) => (
                          <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 12 }}>
                            {children}
                          </ul>
                        ),
                        li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
                        p: ({ children }) => (
                          <p style={{ marginTop: 8, marginBottom: 10, lineHeight: 1.7 }}>
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
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ))
              )}

              {chatLoading && (
                <div
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    background: "rgba(3, 7, 18, 0.85)",
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: "0.03em",
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

        <div className="debug-robot-panel">
          <RobotAssistant loading={loading || chatLoading} />
        </div>
      </div>
    </main>
  );
}