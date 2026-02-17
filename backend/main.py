import os
from dotenv import load_dotenv
load_dotenv()
import re
import uuid
from typing import Any, Dict, List, Optional
import requests
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client
from openai import OpenAI
from pydantic import BaseModel



DEEPSEEK_API_KEY = os.environ["DEEPSEEK_API_KEY"]

llm_client = OpenAI(
    api_key=DEEPSEEK_API_KEY,
    base_url="https://api.deepseek.com"
)


SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]  # use service role for MVP
OCR_WORKER_URL = os.environ["OCR_WORKER_URL"]      # from Colab (ngrok URL)

sb = create_client(SUPABASE_URL, SUPABASE_KEY)



app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def embed_via_worker(texts: List[str], mode: str) -> List[List[float]]:
    """
    mode = "passage" or "query"
    Uses Colab worker for embeddings to avoid local model downloads.
    """
    payload = {"texts": texts, "mode": mode}
    r = requests.post(f"{OCR_WORKER_URL}/embed", json=payload, timeout=180)
    r.raise_for_status()
    return r.json()["embeddings"]


def guess_totals(spans: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    MVP heuristic: look for lines containing Total / Amount Due / Balance etc.
    Returns {total: float?, total_span_ids: [...]}.
    """
    total_patterns = [
        r"\btotal\b",
        r"\bamount due\b",
        r"\bbalance\b",
        r"\bgrand total\b",
        r"\bnet total\b",
    ]
    money_re = re.compile(r"([0-9]{1,3}(?:[, ]?[0-9]{3})*(?:\.[0-9]{2})?)")

    candidates = []
    for s in spans:
        t = (s["text"] or "").lower()
        if any(re.search(p, t) for p in total_patterns):
            m = money_re.findall(s["text"])
            if m:
                # take the last amount in the line
                amt_str = m[-1].replace(" ", "").replace(",", "")
                try:
                    amt = float(amt_str)
                    candidates.append((amt, s["id"]))
                except:
                    pass

    if not candidates:
        return {}

    # pick the largest as "total" (simple but often works for invoices)
    amt, sid = sorted(candidates, key=lambda x: x[0])[-1]
    return {"total": amt, "total_span_ids": [sid]}

@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    user_id: str = Form(...),          # MVP: pass a static UUID from frontend
    doc_type: str = Form("invoice"),
    vendor_name: Optional[str] = Form(None),
):
    try:
        # 1) upload file to Supabase Storage
        content = await file.read()
        doc_id = str(uuid.uuid4())
        path = f"{user_id}/{doc_id}/{file.filename}"

        storage_result = sb.storage.from_("docs").upload(
            path,
            content,
            {"content-type": file.content_type or "application/octet-stream"},
        )
        
        # Check if upload failed
        if hasattr(storage_result, 'error') and storage_result.error:
            raise Exception(f"Storage upload failed: {storage_result.error}")
            
        file_url = sb.storage.from_("docs").get_public_url(path)

        # 2) vendor upsert (simple)
        vendor_id = None
        if vendor_name:
            existing = sb.table("vendors").select("id").eq("user_id", user_id).eq("name", vendor_name).execute().data
            if existing:
                vendor_id = existing[0]["id"]
            else:
                vendor_result = sb.table("vendors").insert({"user_id": user_id, "name": vendor_name}).execute()
                if vendor_result.data:
                    vendor_id = vendor_result.data[0]["id"]

        # 3) create document row
        doc_result = sb.table("documents").insert({
            "id": doc_id,
            "user_id": user_id,
            "vendor_id": vendor_id,
            "doc_type": doc_type,
            "filename": file.filename,
            "file_url": file_url,
            "mime": file.content_type
        }).execute()
        
        if not doc_result.data:
            raise Exception("Failed to create document record")

        # 4) ingest now (sync MVP)
        ingest_document(doc_id=doc_id, user_id=user_id, vendor_id=vendor_id, file_bytes=content, mime=file.content_type)

        return {"document_id": doc_id, "file_url": file_url}
    
    except Exception as e:
        import traceback
        print(f"Upload error: {e}")
        print(traceback.format_exc())
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))

def ingest_document(doc_id: str, user_id: str, vendor_id: Optional[str], file_bytes: bytes, mime: Optional[str]):
    try:
        # Clear existing data (for re-ingestion)
        sb.table("ocr_spans").delete().eq("document_id", doc_id).execute()
        sb.table("chunks").delete().eq("document_id", doc_id).execute()
        sb.table("doc_pages").delete().eq("document_id", doc_id).execute()
        sb.table("invoices").delete().eq("document_id", doc_id).execute()

        # Call OCR worker (Colab) with file bytes
        resp = requests.post(
            f"{OCR_WORKER_URL}/ocr",
            files={"file": ("upload", file_bytes, mime or "application/octet-stream")},
            timeout=300,
        )
        resp.raise_for_status()
        ocr = resp.json()

        # ocr: {pages:[{page_index,width,height,image_png_base64,spans:[...]}]}
        # For MVP, store page images into storage too:
        import base64
        
        for p in ocr["pages"]:
            page_index = p["page_index"]

            # upload page image (from base64 returned by worker)
            page_path = f"{user_id}/{doc_id}/pages/{page_index}.png"

            png_b64 = p.get("image_b64_png")
            if png_b64:
                img_bytes = base64.b64decode(png_b64)
                sb.storage.from_("docs").upload(
                    page_path,
                    img_bytes,
                    {"content-type": "image/png"}
                )
                page_url = sb.storage.from_("docs").get_public_url(page_path)
            else:
                page_url = ""

            # Insert page metadata
            sb.table("doc_pages").insert({
                "document_id": doc_id,
                "page_index": page_index,
                "image_url": page_url,
                "width": p.get("width"),
                "height": p.get("height"),
            }).execute()

            # Insert spans
            span_rows = []
            for s in p["spans"]:
                sid = str(uuid.uuid4())
                span_rows.append({
                    "id": sid,
                    "document_id": doc_id,
                    "page_index": page_index,
                    "text": s["text"],
                    "bbox": s.get("bbox"),
                    "polygon": s.get("polygon"),
                    "label": s.get("label"),
                    "confidence": s.get("confidence"),
                })
                s["__dbid"] = sid  # attach back for later chunk span_ids
            if span_rows:
                sb.table("ocr_spans").insert(span_rows).execute()

            # Chunking (super simple MVP):
            # - header: first ~12 lines
            # - totals: last ~12 lines
            # - body: rest
            spans = p["spans"]
            header = spans[:12]
            totals = spans[-12:] if len(spans) > 24 else spans
            body = spans[12:-12] if len(spans) > 24 else []

            chunks = []
            def make_chunk(chunk_type: str, span_list: List[Dict[str, Any]]):
                if not span_list:
                    return
                text = "\n".join([x["text"] for x in span_list if x["text"].strip()])
                span_ids = [x["__dbid"] for x in span_list]
                chunks.append({"chunk_type": chunk_type, "text": text, "span_ids": span_ids})

            make_chunk("header", header)
            make_chunk("totals", totals)
            make_chunk("body", body)

            # embed and insert chunks
            texts = [c["text"] for c in chunks]
            vecs = embed_via_worker(texts, mode="passage") if texts else []

            for c, v in zip(chunks, vecs):
                sb.table("chunks").insert({
                    "document_id": doc_id,
                    "page_index": page_index,
                    "chunk_type": c["chunk_type"],
                    "text": c["text"],
                    "span_ids": c["span_ids"],
                    "vendor_id": vendor_id,
                    "embedding": v,
                }).execute()

        # heuristic invoice extraction (after all pages processed)
        # For MVP: just total + provenance from first page
        if ocr["pages"]:
            first_page_spans = ocr["pages"][0]["spans"]
            spans_for_guess = [{"id": x.get("__dbid"), "text": x["text"]} for x in first_page_spans if x.get("__dbid")]
            guessed = guess_totals(spans_for_guess)
            if guessed.get("total"):
                sb.table("invoices").insert({
                    "document_id": doc_id,
                    "vendor_id": vendor_id,
                    "total": guessed["total"],
                    "total_span_ids": guessed["total_span_ids"],
                }).execute()
                
    except requests.RequestException as e:
        print(f"OCR worker request failed: {e}")
        raise Exception(f"OCR processing failed: {str(e)}")
    except Exception as e:
        import traceback
        print(f"Ingestion error for doc {doc_id}: {e}")
        print(traceback.format_exc())
        raise

class AskRequest(BaseModel):
    user_id: str
    question: str
    vendor_name: str | None = None
    document_id: str | None = None


@app.post("/ask")
async def ask(req: AskRequest):
    user_id = req.user_id
    question = req.question.strip()
    vendor_name = (req.vendor_name or "").strip() or None
    document_id = (req.document_id or "").strip() or None

    # 1) Resolve vendor_id (optional)
    vendor_id = None
    if vendor_name:
        v = (
            sb.table("vendors")
            .select("id")
            .eq("user_id", user_id)
            .eq("name", vendor_name)
            .execute()
            .data
        )
        if v:
            vendor_id = v[0]["id"]
        else:
            # If vendor is specified but doesn't exist, return friendly message
            return {
                "answer": f"I couldn't find any vendor named '{vendor_name}' in your saved documents.",
                "citations": [],
                "debug": {"scope": "vendor_not_found"}
            }

    # 2) Default scope: if no document_id provided, use latest uploaded document
    #    This makes "upload → ask" always answer from the new doc.
    if not document_id:
        latest = (
            sb.table("documents")
            .select("id")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
        )
        if latest:
            document_id = latest[0]["id"]

    # 3) Embed query (via Colab worker)
    qvec = embed_via_worker([question], mode="query")[0]

    # 4) Retrieve chunks (RAG Retrieval)
    matches = sb.rpc("match_chunks_v2", {
        "query_embedding": qvec,
        "match_count": 8,
        "filter_vendor": vendor_id,
        "filter_document": document_id,
        "filter_user": user_id
    }).execute().data

    if not matches:
        scope_msg = "this document" if document_id else "your documents"
        if vendor_name:
            scope_msg = f"{vendor_name} documents"
        return {
            "answer": f"No relevant information found in {scope_msg}.",
            "citations": [],
            "debug": {"scope": scope_msg}
        }

    # 5) Build context for LLM
    context_blocks = []
    for m in matches:
        context_blocks.append(
            f"""[EVIDENCE]
document_id: {m['document_id']}
page_index: {m['page_index']}
span_ids: {m['span_ids']}
text:
{m['text']}
"""
        )

    context_text = "\n\n".join(context_blocks)

    system_prompt = """
You are an invoice/receipt analysis assistant.

Rules:
- Use ONLY the provided EVIDENCE blocks.
- If the answer is not in evidence, say you don't know.
- Return ONLY valid JSON with this exact schema:

{
  "answer": "string",
  "citations": [
    {
      "document_id": "uuid",
      "page_index": number,
      "span_ids": ["uuid", "uuid"]
    }
  ]
}

Citations:
- span_ids MUST come from the EVIDENCE block you used.
- Cite the minimal spans needed to support the answer.
"""

    user_prompt = f"""
User question:
{question}

EVIDENCE:
{context_text}
"""

    # 6) Call DeepSeek
    completion = llm_client.chat.completions.create(
        model="deepseek-chat",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0
    )

    raw_output = completion.choices[0].message.content

    # 7) Parse JSON safely
    try:
        import json
        parsed = json.loads(raw_output)

        # Optional sanity checks (MVP guardrails)
        if "answer" not in parsed:
            parsed["answer"] = str(raw_output)
        if "citations" not in parsed or not isinstance(parsed["citations"], list):
            parsed["citations"] = []

        parsed["debug"] = {
            "scope": {
                "document_id": document_id,
                "vendor_name": vendor_name,
                "vendor_id": vendor_id
            },
            "top_scores": [m["score"] for m in matches[:3]]
        }
        return parsed

    except Exception:
        # Fallback if DeepSeek returns non-JSON
        return {
            "answer": raw_output,
            "citations": [],
            "debug": {"note": "LLM output was not valid JSON"}
        }



@app.get("/documents")
async def list_documents(user_id: str):
    docs = sb.table("documents").select("id,doc_type,filename,file_url,created_at").eq("user_id", user_id).order("created_at", desc=True).execute().data
    return {"documents": docs}

@app.get("/documents/{doc_id}/pages/{page_index}/spans")
async def get_spans(doc_id: str, page_index: int):
    spans = sb.table("ocr_spans").select("id,text,bbox,polygon,label,confidence").eq("document_id", doc_id).eq("page_index", page_index).execute().data
    page = sb.table("doc_pages").select("image_url,width,height").eq("document_id", doc_id).eq("page_index", page_index).execute().data
    return {"page": page[0] if page else None, "spans": spans}
