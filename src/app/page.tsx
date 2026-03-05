"use client";

import React, { useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
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
  line: number; // 1-based
  message: string;
  severity?: "error" | "warning" | "info";
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

  // remove SECTION lines if the model includes them
  t = t.replace(/^SECTION\s+\d+.*$/gim, "").trim();

  // normalize headings if model outputs “Summary” etc.
  t = t.replace(/^\s*Summary\s*$/gim, "## Summary");
  t = t.replace(/^\s*Issues\s*$/gim, "## Issues");
  t = t.replace(/^\s*Improvements\s*$/gim, "## Improvements");
  t = t.replace(/^\s*Fix(ed)? Example.*$/gim, "## Fixed Example");

  // help convert "Line 4:" lines into bullets
  t = t.replace(/^(Line\s+\d+:\s+)/gim, "- $1");

  // reduce spammy blank lines
  t = t.replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

export default function Page() {
  const [code, setCode] = useState<string>(
    `#include <iostream>\nusing namespace std;\n\nint main() {\n  int x = 5;\n  if (x = 10) {\n    cout << "x is 10";\n  }\n  return 0;\n}\n`
  );
  const [language, setLanguage] = useState<Language>("C++");
  const [task, setTask] = useState<Task>(TASKS[0]);

  const [result, setResult] = useState<string>("");
  const [displayText, setDisplayText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

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

  async function analyze() {
    setLoading(true);
    setResult("");
    setDisplayText("");
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

      // live streaming: update output as we receive chunks
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        full += chunk;

        // show stream live
        setDisplayText(full);
      }

      // After streaming finishes:
      const diagnostics = safeParseDiagnostics(full);
      applyMarkers(diagnostics);

      const cleaned = prettifyMarkdown(stripJsonBlock(full));
      const finalText = cleaned || "No output returned.";

      setResult(finalText);
      setDisplayText(finalText);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const finalText = `## Error\n\n${msg}`;
      setResult(finalText);
      setDisplayText(finalText);
    } finally {
      setLoading(false);
    }
  }

  const selectStyle: React.CSSProperties = {
    backgroundColor: "#3a3a3a",
    color: "white",
    border: "1px solid #555",
    padding: "8px 10px",
    borderRadius: 10,
    outline: "none",
    cursor: "pointer",
  };

  return (
    <main
      style={{
        maxWidth: 980,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
        color: "white",
      }}
    >
      {/* Dropdown hover (dark red) */}
      <style jsx>{`
        select:hover {
          background-color: #7f1d1d !important;
          border-color: #7f1d1d !important;
        }
        select:focus {
          outline: none;
          border-color: #991b1b !important;
          box-shadow: 0 0 0 2px rgba(153, 27, 27, 0.35);
        }
        option {
          background-color: #3a3a3a;
          color: white;
        }
      `}</style>

      <h1 style={{ fontSize: 28, fontWeight: 750, marginBottom: 6 }}>
        AI Code Assistant Analyzer
      </h1>

      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Paste code, pick a task, and get an organized review + editor highlights.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
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

        <select value={task} onChange={(e) => setTask(e.target.value as Task)} style={selectStyle}>
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
            backgroundColor: "#2563eb",
            color: "white",
            border: "none",
            padding: "8px 14px",
            borderRadius: 10,
            cursor: loading || !code.trim() ? "not-allowed" : "pointer",
            opacity: loading || !code.trim() ? 0.7 : 1,
          }}
        >
          {loading ? "Analyzing..." : "Analyze"}
        </button>

        <button
          onClick={() => navigator.clipboard.writeText(result)}
          disabled={!result}
          style={{
            backgroundColor: "#111",
            color: "white",
            border: "1px solid #333",
            padding: "8px 14px",
            borderRadius: 10,
            cursor: result ? "pointer" : "not-allowed",
            opacity: result ? 1 : 0.6,
          }}
        >
          Copy Output
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <Editor
          height="360px"
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
          }}
        />
      </div>

      <h2 style={{ marginTop: 18, fontSize: 18 }}>Output</h2>

      <div
        style={{
          padding: 16,
          background: "#0a0a0a",
          borderRadius: 12,
          minHeight: 180,
          border: "1px solid #2a2a2a",
          lineHeight: 1.65,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h2: ({ children }) => (
              <h2 style={{ marginTop: 18, marginBottom: 8, fontSize: 18 }}>{children}</h2>
            ),
            ul: ({ children }) => (
              <ul style={{ paddingLeft: 18, marginTop: 6, marginBottom: 10 }}>{children}</ul>
            ),
            li: ({ children }) => <li style={{ marginBottom: 6 }}>{children}</li>,
            p: ({ children }) => <p style={{ marginTop: 8, marginBottom: 10 }}>{children}</p>,
            code: ({ children }) => (
              <code style={{ background: "#111", padding: "2px 6px", borderRadius: 8 }}>
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre
                style={{
                  background: "#0b0b0b",
                  padding: 12,
                  borderRadius: 12,
                  overflowX: "auto",
                  border: "1px solid #222",
                }}
              >
                {children}
              </pre>
            ),
          }}
        >
          {displayText || (loading ? "Generating..." : "Run the analyzer to see results.")}
        </ReactMarkdown>
      </div>
    </main>
  );
}