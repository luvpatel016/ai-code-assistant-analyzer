"use client";

import React, { useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { editor as MonacoEditor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";

const TASKS = [
  "Find bugs and fix suggestions",
  "Explain the code simply",
  "Refactor for readability",
  "Optimize performance",
  "Generate test cases",
] as const;

type Task = (typeof TASKS)[number];

type Diagnostic = {
  line: number; // 1-based
  message: string;
  severity?: "error" | "warning" | "info";
};

function splitMarkdownAndDiagnostics(text: string) {

  const match = text.match(/```json([\s\S]*?)```/);

  let diagnostics: Diagnostic[] = [];

  if (match) {
    const json = JSON.parse(match[1]);
    const diags = json.diagnostics ?? [];

    diagnostics = diags
      .map((d: unknown) => {
        if (typeof d !== "object" || d === null) return null;

        const rec = d as Record<string, unknown>;
        const line = Number(rec.line);
        const message = String(rec.message ?? "Issue");
        const sevRaw = rec.severity;

        const severity =
          sevRaw === "warning" || sevRaw === "info" || sevRaw === "error"
            ? sevRaw
            : "error";

        if (!Number.isFinite(line) || line < 1) return null;

        return { line, message, severity } satisfies Diagnostic;
      })
      .filter((x: Diagnostic | null): x is Diagnostic => x !== null);
  }

  return { markdown: text, diagnostics };
}

export default function Page() {
  const [code, setCode] = useState<string>("");
  const [language, setLanguage] = useState<string>("C++");
  const [task, setTask] = useState<Task>(TASKS[0]);
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const languageToMonaco = useMemo<Record<string, string>>(
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
    if (!editorRef.current || !monacoRef.current) return;
    const monaco = monacoRef.current;
    const model = editorRef.current.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(model, "ai-review", []);
  }

  function applyMarkers(diagnostics: Diagnostic[]) {
    if (!editorRef.current || !monacoRef.current) return;

    const monaco = monacoRef.current;
    const model = editorRef.current.getModel();
    if (!model) return;

    const markers = diagnostics.map((d) => {
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
    clearMarkers();

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, language, task }),
      });

      const data = (await res.json()) as unknown;

      function getField(obj: unknown, key: string): string | null {
        if (typeof obj !== "object" || obj === null) return null;
        const record = obj as Record<string, unknown>;
        const value = record[key];
        if (value === undefined || value === null) return null;
        return String(value);
      }

      if (!res.ok) {
        const errMsg = getField(data, "error") ?? "Request failed";
        throw new Error(errMsg);
      }

      const okMsg = getField(data, "result") ?? "No result returned.";

      // If your backend includes a JSON diagnostics block, we parse it.
      const { markdown, diagnostics } = splitMarkdownAndDiagnostics(okMsg);

      setResult(markdown);
      applyMarkers(diagnostics);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setResult("Error: " + msg);
    } finally {
      setLoading(false);
    }
  }

  const controlStyle: React.CSSProperties = {
    backgroundColor: "#111",
    color: "#fff",
    border: "1px solid #333",
    padding: "8px 10px",
    borderRadius: 8,
    outline: "none",
  };

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
        color: "white",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 6 }}>
        AI Code Assistant
      </h1>

      <p style={{ opacity: 0.8, marginTop: 0 }}>
        Paste your code, choose a task, and analyze it.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          style={controlStyle}
        >
          {["C++", "Java", "Python", "JavaScript", "TypeScript", "C"].map((lang) => (
            <option key={lang} value={lang} style={{ color: "#000" }}>
              {lang}
            </option>
          ))}
        </select>

        <select
          value={task}
          onChange={(e) => setTask(e.target.value as Task)}
          style={controlStyle}
        >
          {TASKS.map((t) => (
            <option key={t} value={t} style={{ color: "#000" }}>
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
            borderRadius: 8,
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
            borderRadius: 8,
            cursor: result ? "pointer" : "not-allowed",
            opacity: result ? 1 : 0.6,
          }}
        >
          Copy Output
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <Editor
          height="320px"
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
          borderRadius: 10,
          minHeight: 160,
          border: "1px solid #2a2a2a",
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {result || "Run the analyzer to see results."}
        </ReactMarkdown>
      </div>
    </main>
  );
}