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

    setChatHistory((prev) => [...prev, { role: "user", content: question }]);
    setChatInput("");
    setChatLoading(true);

    try {
      const chatTask = `
Answer the user's question about the code.

User question:
${question}

Instructions:
- Answer clearly and directly.
- Focus on the user's exact question.
- You may reference the current code and the prior review.
- If the user asks for a fix, include a corrected example when helpful.
- Respect the user's coding style preferences when possible.
- Do not mention SECTION 1 or SECTION 2.
- You may still include diagnostics JSON at the end if relevant.
      `.trim();

      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          task: chatTask,
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
      `}</style>

      <div style={{ maxWidth: 1150, margin: "0 auto" }}>
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
            AI Code Assistant Analyzer
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
            AI Model: GPT-4.1-mini • Streaming Enabled • Diff View Ready • Chat Enabled
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

          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 19, fontWeight: 700, marginBottom: 10 }}>
              Ask AI About This Code
            </h2>

            <p
              style={{
                marginTop: 0,
                marginBottom: 12,
                opacity: 0.72,
                fontSize: 14,
              }}
            >
              Ask follow-up questions about the code, the bugs, the fixes, or why something works.
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
              style={{
                marginTop: 18,
                display: "flex",
                flexDirection: "column",
                gap: 12,
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
                  No questions yet. Try asking something like:
                  <div style={{ marginTop: 8 }}>
                    • Why is line 5 wrong?
                    <br />
                    • Can you explain this code simply?
                    <br />
                    • Keep using namespace std; and fix only the bug
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
                      {msg.role === "user" ? "You" : "AI"}
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
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}