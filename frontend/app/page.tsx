"use client";

import { useState } from "react";

const API = "http://localhost:8000";
const USER_ID = "00000000-0000-0000-0000-000000000001";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [vendor, setVendor] = useState("");
  const [docId, setDocId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    if (!file) return;

    setLoading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("user_id", USER_ID);
      fd.append("doc_type", "invoice");
      if (vendor) fd.append("vendor_name", vendor);

      const res = await fetch(`${API}/upload`, {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ detail: "Upload failed" }));
        throw new Error(errorData.detail || `Upload failed with status ${res.status}`);
      }

      const json = await res.json();
      setDocId(json.document_id);
    } catch (err) {
      console.error("Upload error:", err);
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={card}>
        <h2>Upload Invoice</h2>

        <label style={label}>Vendor</label>
        <input
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
          placeholder="Vendor A"
          style={input}
        />

        <label style={label}>Upload or Take Photo</label>
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          style={{ marginBottom: 20 }}
        />

        <button onClick={upload} disabled={!file || loading} style={button}>
          {loading ? "Processing..." : "Upload & Process"}
        </button>

        {error && (
          <div style={{ marginTop: 12, padding: 10, background: "#fee", borderRadius: 8, color: "#c00" }}>
            Error: {error}
          </div>
        )}

        {docId && (
          <div style={{ marginTop: 20 }}>
            <a href={`/doc/${docId}`} style={link}>
              Open Document
            </a>
            <br />
            <a href={`/ask?vendor=${encodeURIComponent(vendor)}`} style={link}>
              Ask About This Vendor
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const card = {
  background: "white",
  padding: 24,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
};

const label = {
  display: "block",
  marginBottom: 6,
  marginTop: 16,
  fontWeight: 500,
};

const input = {
  width: "100%",
  padding: 10,
  borderRadius: 8,
  border: "1px solid #e5e7eb",
};

const button = {
  background: "#2563eb",
  color: "white",
  border: "none",
  padding: "10px 16px",
  borderRadius: 8,
  cursor: "pointer",
};

const link = {
  color: "#2563eb",
  textDecoration: "none",
  fontWeight: 500,
};
