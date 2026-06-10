#!/usr/bin/env python3
"""No-key search and URL fetching helper for local agent skills."""

from __future__ import annotations

import argparse
import html
import json
import re
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse


URL_RE = re.compile(r"https?://[^\s<>'\")\]]+")
TRAILING_URL_PUNCTUATION = ".,;:!?)\"]}"


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    source: str


@dataclass
class FetchResult:
    url: str
    title: str | None
    text: str
    chunks: list[str]
    source: str


class TextExtractor(HTMLParser):
    """Small dependency-free HTML to text fallback."""

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._title_depth = 0
        self._parts: list[str] = []
        self._title_parts: list[str] = []

    @property
    def text(self) -> str:
        return normalize_text(" ".join(self._parts))

    @property
    def title(self) -> str | None:
        title = normalize_text(" ".join(self._title_parts))
        return title or None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._title_depth += 1
        if tag in {"p", "br", "li", "div", "section", "article", "h1", "h2", "h3", "tr"}:
            self._parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title" and self._title_depth:
            self._title_depth -= 1
        if tag in {"p", "li", "div", "section", "article", "h1", "h2", "h3", "tr"}:
            self._parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._title_depth:
            self._title_parts.append(data)
        if not self._skip_depth:
            self._parts.append(data)


class DuckDuckGoResultParser(HTMLParser):
    """Extract basic results from DuckDuckGo's no-JS HTML page."""

    def __init__(self) -> None:
        super().__init__()
        self.results: list[SearchResult] = []
        self._active_link: str | None = None
        self._active_title: list[str] = []
        self._active_snippet: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        class_name = attr.get("class", "")
        if tag == "a" and "result__a" in class_name:
            self._active_link = clean_duckduckgo_url(attr.get("href") or "")
            self._active_title = []
        elif tag in {"a", "div"} and "result__snippet" in class_name:
            self._active_snippet = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._active_link and self._active_title:
            self.results.append(
                SearchResult(
                    title=normalize_text(" ".join(self._active_title)),
                    url=self._active_link,
                    snippet="",
                    source="duckduckgo-html",
                )
            )
            self._active_link = None
            self._active_title = []
        elif tag in {"a", "div"} and self._active_snippet is not None:
            snippet = normalize_text(" ".join(self._active_snippet))
            if snippet and self.results:
                self.results[-1].snippet = snippet
            self._active_snippet = None

    def handle_data(self, data: str) -> None:
        if self._active_link:
            self._active_title.append(data)
        if self._active_snippet is not None:
            self._active_snippet.append(data)


def normalize_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r" *\n+ *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    """LangChain-style fixed-size text chunks with overlap."""
    text = normalize_text(text)
    if not text:
        return []
    if chunk_size <= 0:
        return [text]
    overlap = max(0, min(overlap, chunk_size // 2))
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(len(text), start + chunk_size)
        chunks.append(text[start:end].strip())
        if end >= len(text):
            break
        start = max(start + 1, end - overlap)
    return [chunk for chunk in chunks if chunk]


def extract_urls(value: str) -> list[str]:
    urls: list[str] = []
    for match in URL_RE.findall(value):
        cleaned = match.rstrip(TRAILING_URL_PUNCTUATION)
        parsed = urlparse(cleaned)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            urls.append(cleaned)
    return list(dict.fromkeys(urls))


def clean_duckduckgo_url(value: str) -> str:
    value = html.unescape(value)
    parsed = urllib.parse.urlparse(value)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        query = urllib.parse.parse_qs(parsed.query)
        if query.get("uddg"):
            return query["uddg"][0]
    return value


def search_with_ddgs(query: str, args: argparse.Namespace) -> list[SearchResult]:
    from ddgs import DDGS  # type: ignore

    rows = DDGS(timeout=args.timeout, verify=not args.insecure).text(
        query=query,
        region=args.region,
        safesearch=args.safesearch,
        timelimit=args.timelimit,
        max_results=args.max_results,
        backend=args.backend,
    )
    return [
        SearchResult(
            title=str(row.get("title") or ""),
            url=str(row.get("href") or row.get("url") or ""),
            snippet=str(row.get("body") or row.get("content") or ""),
            source="ddgs",
        )
        for row in rows
        if row.get("href") or row.get("url")
    ]


def search_with_tavily_keyless(query: str, args: argparse.Namespace) -> list[SearchResult]:
    from tavily import TavilyClient  # type: ignore

    response = TavilyClient().search(query=query, max_results=args.max_results)
    rows = response.get("results", []) if isinstance(response, dict) else []
    return [
        SearchResult(
            title=str(row.get("title") or ""),
            url=str(row.get("url") or ""),
            snippet=str(row.get("content") or row.get("raw_content") or ""),
            source="tavily-keyless",
        )
        for row in rows
        if row.get("url")
    ]


def search_with_duckduckgo_html(query: str, args: argparse.Namespace) -> list[SearchResult]:
    params = urllib.parse.urlencode({"q": query, "kl": args.region})
    request = urllib.request.Request(
        f"https://html.duckduckgo.com/html/?{params}",
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ClevelGoSearchFetch/1.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        raw = response.read(args.max_bytes)
    parser = DuckDuckGoResultParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    return parser.results[: args.max_results]


def search(query: str, args: argparse.Namespace) -> dict[str, Any]:
    errors: list[str] = []
    for engine in (search_with_ddgs, search_with_tavily_keyless, search_with_duckduckgo_html):
        try:
            results = engine(query, args)
            if results:
                return {
                    "mode": "search",
                    "query": query,
                    "results": [asdict(result) for result in results],
                    "errors": errors,
                }
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{engine.__name__}: {exc}")
    return {"mode": "search", "query": query, "results": [], "errors": errors}


def fetch_with_ddgs(url: str, args: argparse.Namespace) -> FetchResult:
    from ddgs import DDGS  # type: ignore

    result = DDGS(timeout=args.timeout, verify=not args.insecure).extract(url, fmt="text_markdown")
    text = normalize_text(str(result.get("content") or ""))
    return FetchResult(
        url=url,
        title=None,
        text=text[: args.max_chars],
        chunks=chunk_text(text[: args.max_chars], args.chunk_size, args.chunk_overlap),
        source="ddgs.extract",
    )


def fetch_with_urllib(url: str, args: argparse.Namespace) -> FetchResult:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError(f"Unsupported URL: {url}")

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ClevelGoSearchFetch/1.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=args.timeout) as response:
        raw = response.read(args.max_bytes)
        content_type = response.headers.get("content-type", "")
    encoding = "utf-8"
    match = re.search(r"charset=([\w.-]+)", content_type, flags=re.IGNORECASE)
    if match:
        encoding = match.group(1)
    decoded = raw.decode(encoding, errors="replace")

    if "html" in content_type or "<html" in decoded[:2000].lower():
        parser = TextExtractor()
        parser.feed(decoded)
        title = parser.title
        text = parser.text
    else:
        title = None
        text = normalize_text(decoded)

    return FetchResult(
        url=url,
        title=title,
        text=text[: args.max_chars],
        chunks=chunk_text(text[: args.max_chars], args.chunk_size, args.chunk_overlap),
        source="urllib",
    )


def fetch(url: str, args: argparse.Namespace) -> dict[str, Any]:
    errors: list[str] = []
    for engine in (fetch_with_urllib, fetch_with_ddgs):
        try:
            result = engine(url, args)
            if result.text:
                return {"mode": "fetch", "result": asdict(result), "errors": errors}
        except (urllib.error.URLError, TimeoutError, ValueError, Exception) as exc:  # noqa: BLE001
            errors.append(f"{engine.__name__}: {exc}")
    return {"mode": "fetch", "result": None, "errors": errors}


def auto(value: str, args: argparse.Namespace) -> dict[str, Any]:
    urls = extract_urls(value)
    if urls:
        return {
            "mode": "auto",
            "input": value,
            "urls": urls,
            "fetches": [fetch(url, args) for url in urls[: args.max_urls]],
        }
    return search(value, args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Search the web or fetch URL content without a paid API key.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """\
            Examples:
              search_fetch.py search "open source web search tools"
              search_fetch.py fetch https://example.com
              search_fetch.py auto "Please inspect https://example.com"
            """,
        ),
    )
    parser.add_argument("mode", choices=["auto", "search", "fetch"])
    parser.add_argument("input", help="Search query or URL-containing text")
    parser.add_argument("--max-results", type=int, default=5)
    parser.add_argument("--max-urls", type=int, default=3)
    parser.add_argument("--region", default="us-en")
    parser.add_argument("--safesearch", default="moderate", choices=["on", "moderate", "off"])
    parser.add_argument("--timelimit", default=None, help="d, w, m, y, or provider-specific date range")
    parser.add_argument("--backend", default="auto", help="ddgs backend such as auto, duckduckgo, bing, wikipedia")
    parser.add_argument("--timeout", type=int, default=10)
    parser.add_argument("--max-bytes", type=int, default=2_000_000)
    parser.add_argument("--max-chars", type=int, default=12000)
    parser.add_argument("--chunk-size", type=int, default=3000)
    parser.add_argument("--chunk-overlap", type=int, default=250)
    parser.add_argument("--insecure", action="store_true", help="Disable TLS verification for DDGS calls")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if args.mode == "search":
        payload = search(args.input, args)
    elif args.mode == "fetch":
        payload = fetch(args.input, args)
    else:
        payload = auto(args.input, args)
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
