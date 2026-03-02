# File Upload Feature Implementation Plan

## Overview
Add file upload capability to LLM Council Plus supporting PDF, Markdown (.md), CSV, and TXT files.

## Architecture Diagram

```mermaid
flowchart LR
    A[User selects file] --> B[ChatInterface.jsx]
    B --> C[File Preview Display]
    B --> D[api.sendMessageStream with fileContent]
    D --> E[POST /api/conversations/{id}/message/stream]
    E --> F[SendMessageRequest with file_content]
    F --> G[council.py: inject into prompts]
    G --> H[LLM Council Processing]
```

## Files to Modify

### 1. Backend Dependencies
**File:** [`pyproject.toml`](pyproject.toml)

The file currently has these dependencies (lines 7-15). We need to add PyPDF2:

```toml
[project]
name = "llm-council-plus"
version = "0.2.2"
description = "LLM Council Plus - Your Advanced AI Council"
readme = "README.md"
requires-python = ">=3.10"
dependencies = [
    "fastapi",
    "uvicorn[standard]",
    "python-dotenv",
    "httpx",
    "pydantic",
    "ddgs",
    "yake",
    "pypdf2",  # NEW: For PDF parsing
]
```

After updating, run: `uv sync` to install the new dependency.

---

### 2. Backend File Parser Module
**File:** `backend/file_parser.py` (NEW)

```python
"""File parsing utilities for uploaded documents."""

import io
from typing import Optional
import csv


def parse_pdf(file_content: bytes) -> str:
    """Extract text from PDF file content."""
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(file_content))
        text_parts = []
        for page in reader.pages:
            text_parts.append(page.extract_text() or "")
        return "\n\n".join(text_parts)
    except Exception as e:
        return f"[Error parsing PDF: {str(e)}]"


def parse_markdown(file_content: bytes) -> str:
    """Parse Markdown file content."""
    try:
        return file_content.decode('utf-8', errors='replace')
    except Exception as e:
        return f"[Error parsing Markdown: {str(e)}]"


def parse_csv(file_content: bytes) -> str:
    """Parse CSV file content into readable format."""
    try:
        content = file_content.decode('utf-8', errors='replace')
        lines = content.splitlines()
        if not lines:
            return "[Empty CSV file]"
        
        # Parse as CSV to validate and format
        reader = csv.reader(lines)
        rows = list(reader)
        
        # Format as readable text
        formatted = []
        for i, row in enumerate(rows[:50]):  # Limit to 50 rows for preview
            formatted.append(" | ".join(cell.strip() for cell in row))
        
        if len(rows) > 50:
            formatted.append(f"\n... and {len(rows) - 50} more rows")
        
        return "\n".join(formatted)
    except Exception as e:
        return f"[Error parsing CSV: {str(e)}]"


def parse_text(file_content: bytes) -> str:
    """Parse plain text file content."""
    try:
        return file_content.decode('utf-8', errors='replace')
    except Exception as e:
        return f"[Error parsing text file: {str(e)}]"


def parse_file(filename: str, file_content: bytes) -> tuple[str, str]:
    """
    Parse file based on extension.
    
    Returns:
        tuple: (parsed_content, file_type)
    """
    filename_lower = filename.lower()
    
    if filename_lower.endswith('.pdf'):
        return parse_pdf(file_content), "pdf"
    elif filename_lower.endswith('.md') or filename_lower.endswith('.markdown'):
        return parse_markdown(file_content), "markdown"
    elif filename_lower.endswith('.csv'):
        return parse_csv(file_content), "csv"
    elif filename_lower.endswith('.txt') or filename_lower.endswith('.text'):
        return parse_text(file_content), "text"
    else:
        # Try to parse as text for unknown extensions
        return parse_text(file_content), "text"


def format_file_for_prompt(filename: str, content: str, file_type: str) -> str:
    """Format file content for inclusion in LLM prompts."""
    header = f"--- File: {filename} ({file_type.upper()}) ---"
    footer = "--- End of file ---"
    
    # Truncate very long content (e.g., > 50KB)
    max_length = 50000
    if len(content) > max_length:
        content = content[:max_length] + f"\n\n[Content truncated. Original file length: {len(content)} characters]"
    
    return f"{header}\n\n{content}\n\n{footer}"
```

---

### 3. Backend API Updates
**File:** [`backend/main.py`](backend/main.py)

#### 3.1 Add imports at the top:
```python
from .file_parser import parse_file, format_file_for_prompt
```

#### 3.2 Update SendMessageRequest model (around line 36):
```python
class SendMessageRequest(BaseModel):
    """Request to send a message in a conversation."""
    content: str
    web_search: bool = False
    execution_mode: str = "full"  # 'chat_only', 'chat_ranking', 'full'
    file_content: Optional[str] = None  # Base64 encoded file content
    file_name: Optional[str] = None
    file_type: Optional[str] = None
```

#### 3.3 Add file upload endpoint (after line 311):
```python
@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload and parse a file, returning the extracted content."""
    # Validate file extension
    allowed_extensions = ['.pdf', '.md', '.markdown', '.csv', '.txt', '.text']
    filename_lower = file.filename.lower()
    
    if not any(filename_lower.endswith(ext) for ext in allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed types: {', '.join(allowed_extensions)}"
        )
    
    # Validate file size (10MB max)
    max_size = 10 * 1024 * 1024  # 10MB
    content = await file.read()
    
    if len(content) > max_size:
        raise HTTPException(
            status_code=400,
            detail="File too large. Maximum size is 10MB."
        )
    
    # Parse the file
    parsed_content, file_type = parse_file(file.filename, content)
    
    return {
        "success": True,
        "filename": file.filename,
        "file_type": file_type,
        "content": parsed_content,
        "content_length": len(parsed_content)
    }
```

#### 3.4 Update send_message_stream to handle file content (around line 126):
```python
async def event_generator():
    try:
        # Initialize variables for metadata
        stage1_results = []
        stage2_results = []
        stage3_result = None
        label_to_model = {}
        aggregate_rankings = {}
        
        # Combine user message with file content if present
        user_content = body.content
        if body.file_content and body.file_name:
            formatted_file = format_file_for_prompt(
                body.file_name, 
                body.file_content, 
                body.file_type or "text"
            )
            user_content = f"{formatted_file}\n\nUser question: {body.content}"
        
        # Add user message
        storage.add_user_message(conversation_id, body.content)
```

#### 3.5 Update streaming endpoint call (around line 189):
```python
async for item in stage1_collect_responses(user_content, search_context, request):
```

And similar updates for stage2 and stage3 calls.

#### 3.6 Add UploadFile import at the top:
```python
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
```

---

### 4. Frontend API Client Updates
**File:** [`frontend/src/api.js`](frontend/src/api.js)

#### 4.1 Add upload function (after line 91):
```javascript
  /**
   * Upload a file and get parsed content.
   * @param {File} file - The file to upload
   * @returns {Promise<Object>} - Parsed file content and metadata
   */
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Failed to upload file');
    }

    return response.json();
  },
```

#### 4.2 Update sendMessageStream to accept file data (around line 310):
```javascript
  async sendMessageStream(conversationId, options, onEvent, signal) {
    const { content, webSearch = false, executionMode = 'full', fileData = null } = options;
    const response = await fetch(
      `${API_BASE}/api/conversations/${conversationId}/message/stream?_t=${Date.now()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ 
          content, 
          web_search: webSearch, 
          execution_mode: executionMode,
          file_content: fileData?.content || null,
          file_name: fileData?.name || null,
          file_type: fileData?.type || null,
        }),
        signal,
        cache: 'no-store',
      }
    );
    // ... rest unchanged
  },
```

---

### 5. Frontend ChatInterface Component
**File:** [`frontend/src/components/ChatInterface.jsx`](frontend/src/components/ChatInterface.jsx)

#### 5.1 Add new imports:
```javascript
import { useState, useEffect, useRef } from 'react';
```

#### 5.2 Add new state for file upload:
```javascript
export default function ChatInterface({
    conversation,
    onSendMessage,
    onAbort,
    isLoading,
    councilConfigured,
    onOpenSettings,
    councilModels = [],
    chairmanModel = null,
    executionMode,
    onExecutionModeChange,
    searchProvider = 'duckduckgo',
}) {
    const [input, setInput] = useState('');
    const [webSearch, setWebSearch] = useState(false);
    const [uploadedFile, setUploadedFile] = useState(null); // NEW: file upload state
    const [isUploading, setIsUploading] = useState(false); // NEW: upload loading state
    const fileInputRef = useRef(null); // NEW: hidden file input ref
    const messagesEndRef = useRef(null);
    const messagesContainerRef = useRef(null);
    // ... rest of component
```

#### 5.3 Add file handling functions (before handleSubmit):
```javascript
    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Validate file type
        const allowedTypes = ['.pdf', '.md', '.markdown', '.csv', '.txt', '.text'];
        const fileName = file.name.toLowerCase();
        const isAllowed = allowedTypes.some(ext => fileName.endsWith(ext));
        
        if (!isAllowed) {
            alert(`File type not allowed. Allowed types: PDF, Markdown, CSV, TXT`);
            return;
        }

        // Validate file size (10MB)
        const maxSize = 10 * 1024 * 1024;
        if (file.size > maxSize) {
            alert('File too large. Maximum size is 10MB.');
            return;
        }

        setIsUploading(true);
        try {
            const result = await api.uploadFile(file);
            setUploadedFile({
                name: file.name,
                type: result.file_type,
                content: result.content,
                size: file.size,
            });
        } catch (error) {
            console.error('File upload error:', error);
            alert(`Failed to upload file: ${error.message}`);
        } finally {
            setIsUploading(false);
            // Reset file input
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleFileRemove = () => {
        setUploadedFile(null);
    };

    const triggerFileInput = () => {
        fileInputRef.current?.click();
    };

    const formatFileSize = (bytes) => {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    };
```

#### 5.4 Update handleSubmit to pass file data:
```javascript
    const handleSubmit = (e) => {
        e.preventDefault();
        if ((input.trim() || uploadedFile) && !isLoading) {
            onSendMessage(input, webSearch, uploadedFile);
            setInput('');
            setUploadedFile(null); // Clear uploaded file after sending
        }
    };
```

#### 5.5 Add hidden file input and file preview to JSX (in the form):

After the existing imports, add the Paperclip icon component or use an SVG:

```javascript
// Paperclip icon SVG component
const PaperclipIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
);

// File icon based on type
const FileIcon = ({ type }) => {
    const iconStyle = { width: '16px', height: '16px' };
    switch (type) {
        case 'pdf':
            return <span style={iconStyle}>📄</span>;
        case 'csv':
            return <span style={iconStyle}>📊</span>;
        case 'markdown':
            return <span style={iconStyle}>📝</span>;
        default:
            return <span style={iconStyle}>📃</span>;
    }
};
```

#### 5.6 Update the form input section (around line 235-278):

```jsx
                <form className="input-container" onSubmit={handleSubmit}>
                    {/* Hidden file input */}
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                        style={{ display: 'none' }}
                        accept=".pdf,.md,.markdown,.csv,.txt,.text"
                        disabled={isLoading || isUploading}
                    />
                    
                    {/* File preview - shown when file is uploaded */}
                    {uploadedFile && (
                        <div className="file-preview">
                            <FileIcon type={uploadedFile.type} />
                            <span className="file-name">{uploadedFile.name}</span>
                            <span className="file-size">({formatFileSize(uploadedFile.size)})</span>
                            <button 
                                type="button" 
                                className="file-remove-btn"
                                onClick={handleFileRemove}
                                disabled={isLoading}
                                title="Remove file"
                            >
                                ×
                            </button>
                        </div>
                    )}
                    
                    <div className="input-row-top">
                        <label className={`search-toggle ${webSearch ? 'active' : ''}`} title="Toggle Web Search">
                            <input
                                type="checkbox"
                                className="search-checkbox"
                                checked={webSearch}
                                onChange={() => setWebSearch(!webSearch)}
                                disabled={isLoading}
                            />
                            <span className="search-icon">🌐</span>
                            {webSearch && <span className="search-label">Search On</span>}
                        </label>

                        {/* Upload button */}
                        <button
                            type="button"
                            className={`upload-button ${uploadedFile ? 'has-file' : ''} ${isUploading ? 'uploading' : ''}`}
                            onClick={triggerFileInput}
                            disabled={isLoading || isUploading}
                            title="Attach file (PDF, MD, CSV, TXT)"
                        >
                            {isUploading ? (
                                <span className="upload-spinner">⏳</span>
                            ) : (
                                <PaperclipIcon />
                            )}
                        </button>

                        <textarea
                            className="message-input"
                            placeholder={isLoading ? "Consulting..." : uploadedFile ? "Ask about the uploaded file..." : "Ask the Council..."}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            disabled={isLoading}
                            rows={1}
                            style={{ height: 'auto', minHeight: '24px' }}
                        />

                        {isLoading ? (
                            <button type="button" className="send-button stop-button" onClick={onAbort} title="Stop Generation">
                                ⏹
                            </button>
                        ) : (
                            <button 
                                type="submit" 
                                className="send-button" 
                                disabled={!input.trim() && !uploadedFile}
                            >
                                ➤
                            </button>
                        )}
                    </div>

                    <div className="input-row-bottom">
                        <ExecutionModeToggle
                            value={executionMode}
                            onChange={onExecutionModeChange}
                            disabled={isLoading}
                        />
                    </div>
                </form>
```

---

### 6. Frontend CSS Updates
**File:** [`frontend/src/components/ChatInterface.css`](frontend/src/components/ChatInterface.css)

Add styles for upload button and file preview (before the mobile responsive section):

```css
/* Upload Button */
.upload-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.2s;
    background: rgba(99, 102, 241, 0.15);
    margin-bottom: 6px;
    position: relative;
    border: 1px solid rgba(99, 102, 241, 0.3);
    opacity: 0.7;
    color: #818cf8;
}

.upload-button:hover {
    background: rgba(99, 102, 241, 0.25);
    opacity: 1;
    transform: scale(1.05);
}

.upload-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
}

.upload-button.has-file {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.5);
    color: #22c55e;
    opacity: 1;
}

.upload-button.uploading {
    opacity: 0.6;
    cursor: wait;
}

.upload-spinner {
    animation: spin 1s linear infinite;
    display: inline-block;
}

/* Tooltip for upload button */
.upload-button::after {
    content: "Attach file (PDF, MD, CSV, TXT)";
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%) translateY(-8px);
    background: var(--bg-dark);
    color: var(--text-secondary);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s;
    pointer-events: none;
    border: 1px solid var(--border-glass);
}

.upload-button:hover::after {
    opacity: 1;
    visibility: visible;
}

/* File Preview */
.file-preview {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    margin-bottom: 8px;
    font-size: 13px;
    color: var(--text-secondary);
}

.file-name {
    font-weight: 500;
    color: var(--text-primary);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.file-size {
    color: var(--text-muted);
    font-size: 11px;
}

.file-remove-btn {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    margin-left: auto;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.2s;
}

.file-remove-btn:hover:not(:disabled) {
    opacity: 1;
}

.file-remove-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
}

/* Mobile responsive for file preview */
@media (max-width: 768px) {
    .file-preview {
        padding: 6px 10px;
        font-size: 12px;
    }
    
    .file-name {
        max-width: 150px;
    }
}
```

---

### 7. Frontend App.jsx Updates
**File:** [`frontend/src/App.jsx`](frontend/src/App.jsx)

#### 7.1 Update handleSendMessage signature:
```javascript
const handleSendMessage = async (content, webSearch, fileData = null) => {
```

#### 7.2 Update api.sendMessageStream call:
```javascript
await api.sendMessageStream(
    currentConversationId,
    { content, webSearch, executionMode, fileData },
    (eventType, event) => {
        // ... rest unchanged
    },
    abortControllerRef.current?.signal
);
```

---

## Implementation Order

1. **Backend First:**
   - Update `pyproject.toml` with PyPDF2
   - Create `backend/file_parser.py`
   - Update `backend/main.py` with upload endpoint and file handling

2. **Frontend API:**
   - Update `frontend/src/api.js` with uploadFile and modified sendMessageStream

3. **Frontend UI:**
   - Update `frontend/src/components/ChatInterface.jsx` with upload UI
   - Update `frontend/src/components/ChatInterface.css` with styles
   - Update `frontend/src/App.jsx` to pass file data

4. **Testing:**
   - Test PDF upload
   - Test Markdown upload
   - Test CSV upload
   - Test TXT upload
   - Test file size validation
   - Test file type validation
   - Test error handling

## Security Considerations

1. File size limit: 10MB maximum
2. File type whitelist: Only PDF, MD, CSV, TXT allowed
3. File content is processed server-side, never stored permanently
4. File content is base64 encoded for JSON transport

## Error Handling

- Invalid file type: 400 error with clear message
- File too large: 400 error with size limit info
- Parse errors: Returned as error text in response
- Network errors: Handled by existing error handling in api.js
