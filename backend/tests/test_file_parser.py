"""Tests for file parser module."""

import pytest
from backend.file_parser import (
    parse_pdf,
    parse_markdown,
    parse_csv,
    parse_text,
    parse_file,
    format_file_for_prompt,
)


class TestParseMarkdown:
    """Tests for Markdown parsing."""
    
    def test_parse_simple_markdown(self):
        content = b"# Hello World\n\nThis is a test markdown file."
        result = parse_markdown(content)
        assert result == "# Hello World\n\nThis is a test markdown file."
    
    def test_parse_markdown_with_unicode(self):
        content = "# Héllo Wörld\n\nThis has unicode: émojis 🎉".encode('utf-8')
        result = parse_markdown(content)
        assert "Héllo Wörld" in result
        assert "🎉" in result
    
    def test_parse_invalid_encoding(self):
        # Invalid UTF-8 sequences should be replaced
        content = b"Hello \xff\xfe World"
        result = parse_markdown(content)
        assert "Hello" in result
        assert "World" in result


class TestParseCSV:
    """Tests for CSV parsing."""
    
    def test_parse_simple_csv(self):
        content = b"name,age,city\nAlice,30,NYC\nBob,25,LA"
        result = parse_csv(content)
        assert "name | age | city" in result
        assert "Alice | 30 | NYC" in result
        assert "Bob | 25 | LA" in result
    
    def test_parse_empty_csv(self):
        content = b""
        result = parse_csv(content)
        assert result == "[Empty CSV file]"
    
    def test_parse_csv_with_quotes(self):
        content = b'"Product Name","Price"\n"Widget",10.99'
        result = parse_csv(content)
        assert "Product Name | Price" in result
        assert "Widget | 10.99" in result
    
    def test_csv_row_limit(self):
        # Test that only first 50 rows are shown (including header)
        rows = ["col1,col2"] + [f"data{i},value{i}" for i in range(100)]
        content = "\n".join(rows).encode('utf-8')
        result = parse_csv(content)
        # Header + data0-48 = 50 rows shown total
        # data48 is the last row shown, data49 is the first one truncated
        assert "data47" in result
        assert "data48" in result
        assert "data49" not in result
        assert "more rows" in result.lower()


class TestParseText:
    """Tests for text file parsing."""
    
    def test_parse_simple_text(self):
        content = b"Hello World\n\nThis is plain text."
        result = parse_text(content)
        assert result == "Hello World\n\nThis is plain text."
    
    def test_parse_text_with_unicode(self):
        content = "Unicode: ñ, é, ü, ö, ä, å, ø, ß".encode('utf-8')
        result = parse_text(content)
        assert "ñ" in result
        assert "ü, ö, ä" in result


class TestParseFile:
    """Tests for the main parse_file function."""
    
    def test_parse_pdf_file(self):
        content = b"%PDF-1.4 fake pdf content"
        result, file_type = parse_file("document.pdf", content)
        assert file_type == "pdf"
        assert isinstance(result, str)
    
    def test_parse_markdown_file(self):
        content = b"# Title\n\nContent"
        result, file_type = parse_file("readme.md", content)
        assert file_type == "markdown"
        assert "# Title" in result
    
    def test_parse_csv_file(self):
        content = b"a,b,c\n1,2,3"
        result, file_type = parse_file("data.csv", content)
        assert file_type == "csv"
        assert "a | b | c" in result
    
    def test_parse_text_file(self):
        content = b"Plain text content"
        result, file_type = parse_file("notes.txt", content)
        assert file_type == "text"
        assert result == "Plain text content"
    
    def test_parse_unknown_extension(self):
        # Unknown extensions should try to parse as text
        content = b"Some content"
        result, file_type = parse_file("unknown.xyz", content)
        assert file_type == "text"
        assert result == "Some content"
    
    def test_case_insensitive_extensions(self):
        content = b"# Title"
        result, file_type = parse_file("README.MD", content)
        assert file_type == "markdown"
        
        result, file_type = parse_file("data.CSV", content)
        assert file_type == "csv"


class TestFormatFileForPrompt:
    """Tests for formatting file content for prompts."""
    
    def test_format_simple_content(self):
        result = format_file_for_prompt("test.txt", "Hello World", "text")
        assert "--- File: test.txt (TEXT) ---" in result
        assert "Hello World" in result
        assert "--- End of file ---" in result
    
    def test_format_truncates_long_content(self):
        long_content = "A" * 60000  # 60KB of content
        result = format_file_for_prompt("large.txt", long_content, "text")
        assert "Content truncated" in result
        assert len(result) < 55000  # Should be truncated
    
    def test_format_preserves_short_content(self):
        short_content = "Short content"
        result = format_file_for_prompt("short.txt", short_content, "text")
        assert "Short content" in result
        assert "truncated" not in result.lower()


class TestParsePDF:
    """Tests for PDF parsing (mocked since we don't have real PDFs)."""
    
    def test_parse_invalid_pdf(self):
        # Invalid PDF content should return error message
        content = b"Not a real PDF"
        result = parse_pdf(content)
        # Check for various possible error messages
        assert (
            "[Error parsing PDF" in result or 
            result == "" or 
            "EOF marker not found" in result or
            "pypdf not installed" in result
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
