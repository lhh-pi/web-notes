"""Tests for the storage layer using a temporary directory."""

import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from backend import config
from backend.models import Highlight, HighlightColor, TextAnchor
from backend.storage import (
    delete_highlight,
    get_notes,
    list_domains,
    save_highlight,
    update_highlight,
)


@pytest.fixture
def temp_storage():
    """Create a temporary storage directory and patch config to use it."""
    with tempfile.TemporaryDirectory() as tmpdir:
        storage_path = Path(tmpdir) / "notes"
        storage_path.mkdir()
        index_file = storage_path / ".index.json"
        with (
            patch.object(config, "NOTE_STORAGE_PATH", storage_path),
            patch.object(config, "INDEX_FILE", index_file),
        ):
            yield storage_path


class TestSaveAndGet:
    """Tests for save_highlight and get_notes."""

    def test_create_new_page_note(self, temp_storage):
        url = "https://example.com/article"
        highlight = Highlight(
            text="Hello world",
            color=HighlightColor.YELLOW,
            note="A test note",
            anchor=TextAnchor(prefix="start", suffix="end", xpath="/p[1]"),
        )
        page = save_highlight(
            url=url,
            title="Test Article",
            domain="example.com",
            highlight=highlight,
        )
        assert page.url == url
        assert page.title == "Test Article"
        assert len(page.highlights) == 1
        assert page.highlights[0].text == "Hello world"

    def test_get_existing_notes(self, temp_storage):
        url = "https://example.com/article"
        highlight = Highlight(text="Hello")
        save_highlight(url=url, title="Test", domain="example.com", highlight=highlight)

        result = get_notes(url)
        assert result is not None
        assert result.url == url
        assert len(result.highlights) == 1

    def test_get_nonexistent_notes(self, temp_storage):
        result = get_notes("https://no-such-url.com")
        assert result is None

    def test_append_second_highlight(self, temp_storage):
        url = "https://example.com/article"
        h1 = Highlight(id="h1", text="First")
        h2 = Highlight(id="h2", text="Second")
        save_highlight(url=url, title="Test", domain="example.com", highlight=h1)
        page = save_highlight(url=url, title="Test", domain="example.com", highlight=h2)

        assert len(page.highlights) == 2

    def test_update_existing_highlight_by_id(self, temp_storage):
        url = "https://example.com/article"
        h1 = Highlight(id="same-id", text="Original")
        save_highlight(url=url, title="Test", domain="example.com", highlight=h1)

        h2 = Highlight(id="same-id", text="Updated", note="New note")
        page = save_highlight(url=url, title="Test", domain="example.com", highlight=h2)

        assert len(page.highlights) == 1
        assert page.highlights[0].text == "Updated"
        assert page.highlights[0].note == "New note"


class TestUpdate:
    """Tests for update_highlight."""

    def test_update_note(self, temp_storage):
        url = "https://example.com/article"
        h = Highlight(id="h1", text="Text", note="Old note")
        save_highlight(url=url, title="Test", domain="example.com", highlight=h)

        result = update_highlight(url, "h1", note_text="New note")
        assert result is not None
        assert result.highlights[0].note == "New note"

    def test_update_color(self, temp_storage):
        url = "https://example.com/article"
        h = Highlight(id="h1", text="Text", color=HighlightColor.YELLOW)
        save_highlight(url=url, title="Test", domain="example.com", highlight=h)

        result = update_highlight(url, "h1", color="blue")
        assert result is not None
        assert result.highlights[0].color == HighlightColor.BLUE

    def test_update_nonexistent_highlight(self, temp_storage):
        result = update_highlight("https://example.com", "no-id", note_text="x")
        assert result is None


class TestDelete:
    """Tests for delete_highlight."""

    def test_delete_highlight(self, temp_storage):
        url = "https://example.com/article"
        h1 = Highlight(id="h1", text="First")
        h2 = Highlight(id="h2", text="Second")
        save_highlight(url=url, title="Test", domain="example.com", highlight=h1)
        save_highlight(url=url, title="Test", domain="example.com", highlight=h2)

        result = delete_highlight(url, "h1")
        assert result is not None
        assert len(result.highlights) == 1
        assert result.highlights[0].id == "h2"

    def test_delete_last_highlight_removes_file(self, temp_storage):
        url = "https://example.com/article"
        h = Highlight(id="h1", text="Only one")
        save_highlight(url=url, title="Test", domain="example.com", highlight=h)

        delete_highlight(url, "h1")
        result = get_notes(url)
        assert result is None  # File should be removed

    def test_delete_nonexistent(self, temp_storage):
        result = delete_highlight("https://no-url.com", "no-id")
        assert result is None


class TestListDomains:
    """Tests for list_domains."""

    def test_list_empty(self, temp_storage):
        assert list_domains() == []

    def test_list_domains(self, temp_storage):
        h = Highlight(text="test")
        save_highlight(
            url="https://github.com/page",
            title="GH",
            domain="github.com",
            highlight=h,
        )
        save_highlight(
            url="https://blog.example.com/post",
            title="Blog",
            domain="blog.example.com",
            highlight=h,
        )
        domains = list_domains()
        assert "github.com" in domains
        assert "blog.example.com" in domains
