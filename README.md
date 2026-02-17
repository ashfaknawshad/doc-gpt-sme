# SME GPT MVP

AI-powered document intelligence system for invoices, receipts, and business documents. Upload documents, get instant OCR processing, and ask natural language questions about your documents.

## 🏗️ Architecture

The system consists of three components:

1. **Frontend** (Next.js) - User interface for uploading documents and asking questions
2. **Backend** (FastAPI) - API server handling document management and RAG (Retrieval-Augmented Generation)
3. **OCR Worker** (Colab) - GPU-powered OCR and embedding service using Tesseract + sentence-transformers

## 📋 Prerequisites

- Python 3.9+
- Node.js 18+
- Supabase account (for database and storage)
- DeepSeek API key (for LLM)
- Google Colab account (for OCR worker)

## 🚀 Setup Guide

### 1. Colab OCR Worker Setup (Do This First!)

The OCR worker runs in Google Colab and provides OCR + embedding services to avoid local GPU/model requirements.

#### Step 1: Create Colab Notebook

1. Go to [Google Colab](https://colab.research.google.com/)
2. Create a new notebook
3. Paste this code in the first cell:

```python
# Install dependencies
!pip install pytesseract pillow pdf2image sentence-transformers fastapi pyngrok uvicorn python-multipart

# Install Tesseract OCR
!apt-get install -y tesseract-ocr

# Create OCR worker
%%writefile ocr_app.py
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from pdf2image import convert_from_bytes
import pytesseract
import io
import base64
from sentence_transformers import SentenceTransformer
from typing import List
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load embedding model once at startup
embed_model = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2')

@app.post("/ocr")
async def ocr_document(file: UploadFile = File(...)):
    """Process document with OCR, return text + coordinates"""
    content = await file.read()
    
    # Detect if PDF or image
    if file.content_type == "application/pdf" or file.filename.endswith('.pdf'):
        images = convert_from_bytes(content, dpi=200)
    else:
        images = [Image.open(io.BytesIO(content))]
    
    pages = []
    for idx, img in enumerate(images):
        # Convert to RGB if needed
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        # Get detailed OCR data
        ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        
        width, height = img.size
        spans = []
        
        # Group words into spans
        for i in range(len(ocr_data['text'])):
            text = ocr_data['text'][i].strip()
            if not text:
                continue
                
            x, y, w, h = (
                ocr_data['left'][i],
                ocr_data['top'][i],
                ocr_data['width'][i],
                ocr_data['height'][i]
            )
            
            spans.append({
                "text": text,
                "bbox": [x, y, x + w, y + h],
                "polygon": [
                    [x, y],
                    [x + w, y],
                    [x + w, y + h],
                    [x, y + h]
                ],
                "confidence": float(ocr_data['conf'][i]) if ocr_data['conf'][i] != -1 else None
            })
        
        # Convert image to base64 PNG for frontend display
        img_buffer = io.BytesIO()
        img.save(img_buffer, format='PNG')
        img_b64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        
        pages.append({
            "page_index": idx,
            "width": width,
            "height": height,
            "image_b64_png": img_b64,
            "spans": spans
        })
    
    return {"pages": pages}

class EmbedRequest(BaseModel):
    texts: List[str]
    mode: str = "passage"  # "passage" or "query"

@app.post("/embed")
async def embed_texts(req: EmbedRequest):
    """Generate embeddings for texts"""
    # Add instruction prefix based on mode
    if req.mode == "query":
        texts = [f"query: {t}" for t in req.texts]
    else:
        texts = [f"passage: {t}" for t in req.texts]
    
    embeddings = embed_model.encode(texts, convert_to_numpy=True)
    return {"embeddings": embeddings.tolist()}

@app.get("/")
async def health():
    return {"status": "ok", "service": "ocr-worker"}

# Start server with ngrok
from pyngrok import ngrok
import nest_asyncio
import uvicorn

nest_asyncio.apply()

# Start ngrok tunnel
public_url = ngrok.connect(8000)
print("=" * 60)
print(f"🚀 OCR WORKER RUNNING!")
print(f"📡 Public URL: {public_url}")
print(f"⚠️  COPY THIS URL TO YOUR BACKEND .env FILE:")
print(f"    OCR_WORKER_URL={public_url}")
print("=" * 60)

uvicorn.run(app, host="0.0.0.0", port=8000)
```

4. Run the cell
5. **Copy the ngrok URL** that appears (e.g., `https://abc123.ngrok.io`)
6. Keep this Colab notebook running! Your backend needs this URL.

> **Note:** The free ngrok URL changes each time you restart Colab. Update your backend `.env` file accordingly.

### 2. Backend Setup

#### Step 1: Install Python Dependencies

```bash
cd backend
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
```

#### Step 2: Configure Environment Variables

Create `backend/.env` file with:

```env
# DeepSeek API (for LLM question answering)
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# Supabase Database & Storage
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here

# OCR Worker URL (from Colab ngrok URL)
OCR_WORKER_URL=https://your-ngrok-url.ngrok.io
```

**Where to get these:**
- **DeepSeek API Key**: Sign up at [https://platform.deepseek.com](https://platform.deepseek.com)
- **Supabase**: Create project at [https://supabase.com](https://supabase.com), get URL and service key from Settings → API
- **OCR_WORKER_URL**: From your Colab notebook output (Step 1)

#### Step 3: Run Database Migrations

Run this SQL in your Supabase SQL Editor to create the required tables:

```sql
-- See schema.sql for full database schema
-- (Or create schema.sql with your current Supabase schema)
```

#### Step 4: Start Backend Server

```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at `http://localhost:8000`

### 3. Frontend Setup

#### Step 1: Install Dependencies

```bash
cd frontend
npm install
```

#### Step 2: Configure API URL (Optional)

The frontend is configured to use `http://localhost:8000` by default. If your backend runs on a different URL, update it in `frontend/app/doc/[id]/page.tsx` and `frontend/app/ask/page.tsx`.

#### Step 3: Start Development Server

```bash
npm run dev
```

Frontend will be available at `http://localhost:3000`

## 📖 Usage Guide

### Uploading Documents

1. Open `http://localhost:3000`
2. Click "Upload" or navigate to upload page
3. Select a PDF, PNG, or JPG document (invoice, receipt, etc.)
4. Fill in optional metadata (vendor name, document type)
5. Click "Upload" - the system will:
   - Upload file to Supabase storage
   - Send to OCR worker for text extraction
   - Generate embeddings
   - Store structured data in database

### Asking Questions

1. After upload, click "Ask about this doc"
2. Or navigate to `/ask?doc=<document_id>`
3. Type natural language questions like:
   - "What is the total amount?"
   - "Who is the vendor?"
   - "What items are on this invoice?"
   - "When was this invoice issued?"
4. The system will:
   - Embed your question
   - Retrieve relevant document chunks using vector similarity
   - Generate an answer using DeepSeek LLM
   - Provide citations with span IDs for verification

### Viewing Document Details

1. Navigate to `/doc/<document_id>?page=0`
2. View the OCR'd text overlaid on the document image
3. Click on text spans to highlight them
4. Use URL parameter `highlight=span1,span2` to auto-highlight specific spans

## 🧪 Testing the System

### Test OCR Worker

```bash
curl -X POST http://your-ngrok-url.ngrok.io/ocr \
  -F "file=@test-invoice.pdf"
```

### Test Backend Upload

```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@test-invoice.pdf" \
  -F "user_id=test-user-123" \
  -F "doc_type=invoice" \
  -F "vendor_name=ACME Corp"
```

### Test Question Answering

```bash
curl -X POST http://localhost:8000/ask \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "test-user-123",
    "question": "What is the total?",
    "document_id": "your-doc-id"
  }'
```

## 🛠️ System Flow

```
1. User uploads document (Frontend)
   ↓
2. Backend receives file → uploads to Supabase Storage
   ↓
3. Backend sends file to OCR Worker (Colab)
   ↓
4. OCR Worker processes with Tesseract → returns text + coordinates
   ↓
5. Backend stores OCR spans, creates chunks, generates embeddings
   ↓
6. User asks question (Frontend)
   ↓
7. Backend embeds question, retrieves relevant chunks (pgvector)
   ↓
8. Backend sends context to DeepSeek LLM
   ↓
9. LLM returns answer with citations
   ↓
10. Frontend displays answer + highlights cited spans
```

## 🔧 Troubleshooting

### Colab Disconnects
- Colab free tier disconnects after 12 hours or inactivity
- Restart the notebook and update `OCR_WORKER_URL` in backend `.env`
- Consider Colab Pro for longer sessions

### Backend Can't Reach OCR Worker
- Verify Colab is running and ngrok tunnel is active
- Check `OCR_WORKER_URL` in backend `.env` matches Colab output
- Test with: `curl https://your-ngrok-url.ngrok.io/`

### Frontend Build Errors
- Ensure Node.js 18+ is installed
- Delete `node_modules` and `.next`, run `npm install` again
- Check for syntax errors in `.tsx` files

### Database Errors
- Verify Supabase credentials in `.env`
- Check that all tables are created
- Ensure pgvector extension is enabled in Supabase

## 📝 Project Structure

```
smegpt-mvp/
├── backend/
│   ├── main.py              # FastAPI server
│   ├── requirements.txt     # Python dependencies
│   ├── .env                 # Environment variables (create this)
│   └── .gitignore
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # Home page
│   │   ├── ask/
│   │   │   └── page.tsx     # Q&A interface
│   │   └── doc/
│   │       └── [id]/
│   │           └── page.tsx # Document viewer
│   ├── package.json
│   └── .gitignore
└── README.md
```

## 🚀 Deployment Considerations

- **Backend**: Deploy on Railway, Render, or Fly.io
- **Frontend**: Deploy on Vercel or Netlify
- **OCR Worker**: For production, deploy on a GPU server (not Colab)
  - Use Modal, Replicate, or your own GPU instance
  - Keep the same API interface

## 📄 License

MIT

## 🤝 Contributing

This is an MVP. Contributions welcome!
