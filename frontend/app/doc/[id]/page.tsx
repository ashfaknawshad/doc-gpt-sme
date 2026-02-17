"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";

const API = "http://localhost:8000";

type Span = {
  id: string;
  text: string;
  bbox?: number[]; // [x1,y1,x2,y2]
  polygon?: number[][]; // [[x,y] x4]
  label?: string | null;
  confidence?: number | null;
};

export default function DocPage() {
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  const pageIndex = Number(search.get("page") ?? "0");
  const highlightParam = search.get("highlight") ?? "";

  const [page, setPage] = useState<any>(null);
  const [spans, setSpans] = useState<Span[]>([]);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse highlight IDs from URL
  const highlightIdList = useMemo(() => {
    return (highlightParam || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [highlightParam]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    
    fetch(`${API}/documents/${params.id}/pages/${pageIndex}/spans`)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`Failed to load spans: ${r.status}`);
        }
        return r.json();
      })
      .then((j) => {
        setPage(j.page);
        setSpans(j.spans || []);
        setHighlightIds(new Set(highlightIdList)); // auto-highlight from URL
      })
      .catch((e) => {
        console.error("Failed to load spans:", e);
        setError(e instanceof Error ? e.message : "Failed to load document");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [params.id, pageIndex, highlightIdList]);

  const imgUrl = page?.image_url;

  function toggleHighlight(spanId: string) {
    const next = new Set(highlightIds);
    next.has(spanId) ? next.delete(spanId) : next.add(spanId);
    setHighlightIds(next);
  }

  return (
    <div style={{ padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Document {params.id}</h3>

      <div style={{ marginBottom: 12 }}>
        <a
          href={`/ask?doc=${params.id}`}
          style={{ color: "#2563eb", textDecoration: "none", fontWeight: 600 }}
        >
          Ask about this doc
        </a>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, background: "#fee", borderRadius: 8, color: "#c00" }}>
          Error: {error}
        </div>
      )}

      {loading && (
        <div style={{ padding: 20, textAlign: "center", color: "#6b7280" }}>
          Loading document...
        </div>
      )}

      {!loading && !error && (
        <div
          style={{
            background: "white",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 12,
          }}
        >
        <div style={{ color: "#6b7280", fontSize: 12, marginBottom: 8 }}>
          Page {pageIndex}
          {highlightIdList.length > 0 ? (
            <> • Highlighting {highlightIdList.length} span(s)</>
          ) : null}
        </div>

        {/* Image + overlay */}
        <div style={{ position: "relative", display: "inline-block" }}>
          {imgUrl ? (
            <img
              src={imgUrl}
              alt="document page"
              style={{
                maxWidth: "95vw",
                height: "auto",
                borderRadius: 8,
                display: "block",
              }}
              onError={(e) => {
                console.error("Image failed to load:", imgUrl);
              }}
            />
          ) : (
            <div
              style={{
                padding: 12,
                border: "1px dashed #e5e7eb",
                borderRadius: 8,
                color: "#6b7280",
                maxWidth: 600,
              }}
            >
              No page image URL found. (Check backend doc_pages.image_url upload)
            </div>
          )}

          {/* SVG overlay (only if we know page dimensions and have an image) */}
          {imgUrl && page?.width && page?.height ? (
            <svg
              viewBox={`0 0 ${page.width} ${page.height}`}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {spans.map((s) => {
                const poly = s.polygon;
                if (!poly || poly.length < 4) return null;

                const points = poly.map((p) => p.join(",")).join(" ");
                const isHL = highlightIds.has(s.id);

                return (
                  <polygon
                    key={s.id}
                    points={points}
                    fill={isHL ? "rgba(255,255,0,0.35)" : "rgba(0,0,0,0)"}
                    stroke={isHL ? "rgba(255,255,0,0.8)" : "rgba(0,0,0,0)"}
                    strokeWidth="2"
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
        </div>
      )}

      {/* Debug list */}
      <div style={{ marginTop: 16 }}>
        <h4 style={{ marginBottom: 8 }}>Tap to highlight spans (debug)</h4>

        <div
          style={{
            maxHeight: 260,
            overflow: "auto",
            border: "1px solid #e5e7eb",
            background: "white",
            borderRadius: 12,
            padding: 8,
          }}
        >
          {spans.length === 0 ? (
            <div style={{ color: "#6b7280", padding: 8 }}>
              No spans loaded yet.
            </div>
          ) : (
            spans.slice(0, 120).map((s) => (
              <div
                key={s.id}
                style={{
                  cursor: "pointer",
                  padding: "6px 8px",
                  borderRadius: 8,
                  marginBottom: 4,
                  background: highlightIds.has(s.id)
                    ? "rgba(255,255,0,0.25)"
                    : "transparent",
                }}
                onClick={() => toggleHighlight(s.id)}
                title={s.id}
              >
                {s.text}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
