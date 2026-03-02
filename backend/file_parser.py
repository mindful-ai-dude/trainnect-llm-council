"""File parsing utilities for uploaded documents."""

import io
from typing import Optional, Tuple
import csv

# Check if pypdf is available
try:
    from pypdf import PdfReader
    PYPDF_AVAILABLE = True
except ImportError:
    PYPDF_AVAILABLE = False
    PdfReader = None


def parse_pdf(file_content: bytes) -> str:
    """Extract text from PDF file content."""
    if not PYPDF_AVAILABLE:
        return "[Error: pypdf not installed. Run: uv sync]"
    
    try:
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


def parse_file(filename: str, file_content: bytes) -> Tuple[str, str]:
    """
    Parse file based on extension.
    
    Args:
        filename: The name of the file
        file_content: The raw bytes of the file
        
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
