"use client";

import React, { useState } from "react";

const TASKS = [
  "Find bugs and fix suggestions",
  "Explain the code simply",
  "Refactor for readability",
  "Optimize performance",
  "Generate test cases",
] as const;

type Task = (typeof TASKS)[number];

export default function Page() {
  const [code, setCode] = useState<string>("");
  const [language, setLanguage] = useState<string>("C++");
  const [task, setTask] = useState<Task>(TASKS[0]);
  const [result, setResult] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);

  async function analyze() {
    setLoading(true);
    setResult("");

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          language,
          task,
        }),
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
      setResult(okMsg);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setResult("Error: " + msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>AI Code Assistant</h1>

      <p style={{ opacity: 0.8 }}>
        Paste your code, choose a task, and analyze it.
      </p>

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <select
  value={language}
  onChange={(e) => setLanguage(e.target.value)}
  style={{
    backgroundColor: "#111",
    color: "#fff",
    border: "1px solid #333",
    padding: "6px 10px",
    borderRadius: "6px"
  }}
>
          {["C++", "Java", "Python", "JavaScript", "TypeScript", "C"].map(
            (lang) => (
              <option key={lang} value={lang}>
                {lang}
              </option>
            )
          )}
        </select>

        <select
          value={task}
          onChange={(e) => setTask(e.target.value as Task)}
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
    backgroundColor: "#2563eb",
    color: "white",
    border: "none",
    padding: "8px 14px",
    borderRadius: "6px",
    cursor: "pointer"
  }}
>
  {loading ? "Analyzing..." : "Analyze"}
</button>
      </div>

      <textarea
  value={code}
  onChange={(e) => setCode(e.target.value)}
  placeholder="Paste your code here..."
  rows={14}
  style={{
    width: "100%",
    marginTop: 14,
    padding: 12,
    fontFamily: "monospace",
    fontSize: 14,
    backgroundColor: "#111",
    color: "#010101",
    borderRadius: "8px",
    border: "1px solid #333"
  }}
/>

      <h2 style={{ marginTop: 18, fontSize: 18 }}>Output</h2>

      <pre
        style={{
          whiteSpace: "pre-wrap",
          padding: 12,
          background: "#000000",
          color: "white",
          borderRadius: 10,
          minHeight: 160,
        }}
      >
        {result || "—"}
      </pre>
    </main>
  );
}