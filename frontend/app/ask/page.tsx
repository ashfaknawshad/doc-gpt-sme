"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

const API = "http://localhost:8000";
const USER_ID = "00000000-0000-0000-0000-000000000001";

export default function Ask() {
  const search = useSearchParams();

  // Optional scopes from URL
  const vendor = search.get("vendor") ?? "";
  const doc = search.get("doc") ?? "";

  const [q, setQ] = useState("");
  const [resp, setResp] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!q.trim()) return;

    setLoading(true);
    setResp(null);
    setError(null);

    try {
      const payload = {
        user_id: USER_ID,
        question: q,
        vendor_name: vendor ? vendor : null,
        document_id: doc ? doc : null,
      };

      const res = await fetch(`${API}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(errorData.detail || `Request failed with status ${res.status}`);
      }

      const json = await res.json();
      setResp(json);
    } catch (err) {
      console.error("Ask error:", err);
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #e5e7eb",
        borderRadius: 12,
        padding: 24,
      }}
    >
      <h2 style={{ marginTop: 0 }}>Ask</h2>

      <div style={{ color: "#6b7280", fontSize: 13, marginBottom: 12 }}>
        {doc ? (
          <div>Scope: <b>this document</b> ({doc})</div>
        ) : vendor ? (
          <div>Scope: <b>vendor</b> ({vendor})</div>
        ) : (
          <div>Scope: <b>latest uploaded document</b></div>
        )}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. What is the total? What is the vendor name? When is it due?"
        style={{
          width: "100%",
          padding: 10,
          borderRadius: 8,
          border: "1px solid #e5e7eb",
          marginBottom: 10,
        }}
      />

      <button
        onClick={ask}
        disabled={loading || !q.trim()}
        style={{
          background: "#2563eb",
          color: "white",
          border: "none",
          padding: "10px 16px",
          borderRadius: 8,
          cursor: "pointer",
        }}
      >
        {loading ? "Thinking..." : "Ask"}
      </button>

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: "#fee", borderRadius: 8, color: "#c00" }}>
          Error: {error}
        </div>
      )}

      {resp && (
        <div style={{ marginTop: 18 }}>
          <h3>Answer</h3>
          <div style={{ fontSize: 16, lineHeight: 1.5 }}>
            {resp.answer}
          </div>

          <h3 style={{ marginTop: 18 }}>Citations</h3>
          {(!resp.citations || resp.citations.length === 0) ? (
            <div style={{ color: "#6b7280" }}>No citations returned.</div>
          ) : (
            <ul>
              {resp.citations.map((c: any, idx: number) => (
                <li key={idx} style={{ marginBottom: 10 }}>
                  <a
                    href={`/doc/${c.document_id}?page=${c.page_index}&highlight=${encodeURIComponent(
                      (c.span_ids || []).join(",")
                    )}`}
                    style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
                  >
                    Open source (doc {c.document_id}, page {c.page_index})
                  </a>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    span_ids: {(c.span_ids || []).slice(0, 6).join(",")}
                    {(c.span_ids || []).length > 6 ? " ..." : ""}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {resp.debug && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer" }}>Debug</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                {JSON.stringify(resp.debug, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
