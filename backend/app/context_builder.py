from __future__ import annotations

import html
import json
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from html.parser import HTMLParser
from typing import Sequence
from unicodedata import combining, normalize
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import UploadFile

from app.schemas import AttachmentSummary, ChatWidget, CitationSource


URL_RE = re.compile(r"https?://[^\s<>'\")\]]+")
TRAILING_URL_PUNCTUATION = ".,;:!?)\"]}"
SEARCH_INTENT_RE = re.compile(
    r"\b(search|look up|latest|current|today|news|sources?|citations?|references?|web|internet|find)\b",
    re.IGNORECASE,
)
EXPLICIT_WEB_INTENT_RE = re.compile(
    r"\b(search|look up|news|sources?|citations?|references?|web|internet|find)\b",
    re.IGNORECASE,
)
VIETNAMESE_SEARCH_PHRASES = (
    "cung cap",
    "thong tin",
    "cho biet",
    "gioi thieu",
    "tim hieu",
    "tra cuu",
    "cap nhat",
    "moi nhat",
    "hien nay",
    "nguon",
    "dan chung",
    "trich dan",
    "website",
    "dia chi",
    "so dien thoai",
    "email",
    "ma truong",
    "tuyen sinh",
    "phan hieu",
    "dai hoc",
    "truong",
    "cong ty",
    "to chuc",
    "la gi",
    "o dau",
)
QUERY_STOP_WORDS = {
    "a",
    "an",
    "and",
    "about",
    "give",
    "me",
    "of",
    "on",
    "please",
    "provide",
    "tell",
    "the",
    "what",
    "which",
    "who",
    "cung",
    "cap",
    "cho",
    "toi",
    "minh",
    "biet",
    "thong",
    "tin",
    "ve",
    "cua",
    "la",
    "gi",
    "o",
    "dau",
    "hay",
    "vui",
    "long",
    "lam",
    "on",
}
EXTERNAL_FACT_RE = re.compile(
    r"\b(who|what|when|where|which|provide|tell me about|overview|profile|address|phone|email|website|"
    r"university|school|company|organization|admissions|tuition|campus)\b",
    re.IGNORECASE,
)
SEARCH_QUERY_PREFIX_RE = re.compile(
    r"^\s*(?:hãy|hay|vui lòng|vui long|làm ơn|lam on)?\s*"
    r"(?:(?:cung cấp|cung cap|cho tôi|cho toi|cho mình|cho minh|cho biết|cho biet|"
    r"giới thiệu|gioi thieu|tìm hiểu|tim hieu|tra cứu|tra cuu)\s+)?"
    r"(?:(?:thông tin|thong tin)\s+)?(?:về|ve|về\s+)?\s*",
    re.IGNORECASE,
)
WEATHER_RE = re.compile(r"\b(?:weather|temperature|forecast)\b(?:\s+(?:in|for|at))?\s+([A-Za-z][A-Za-z\s,.-]{1,80})?", re.IGNORECASE)
TIME_RE = re.compile(r"\b(?:time|clock)\b(?:\s+(?:in|for|at))?\s+([A-Za-z][A-Za-z\s,.-]{1,80})?", re.IGNORECASE)

MAX_URLS = 3
MAX_SEARCH_RESULTS = 8
MAX_FETCHED_SEARCH_RESULTS = 5
MAX_UPLOADS = 3
MAX_UPLOAD_BYTES = 8 * 1024 * 1024
MAX_SOURCE_CHARS = 5000


@dataclass
class PreparedContext:
    sources: list[CitationSource]
    widgets: list[ChatWidget]
    attachments: list[AttachmentSummary]
    source_prompt: str
    widget_prompt: str
    requires_sources: bool = False


class ReadableHtmlParser(HTMLParser):
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


class DuckDuckGoParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.results: list[CitationSource] = []
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
                CitationSource(
                    id=0,
                    title=normalize_text(" ".join(self._active_title)) or self._active_link,
                    url=self._active_link,
                    snippet="",
                    sourceType="web",
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


async def prepare_context(message: str, uploads: Sequence[UploadFile]) -> PreparedContext:
    sources: list[CitationSource] = []
    attachments: list[AttachmentSummary] = []
    urls = extract_urls(message)
    requires_sources = bool(urls or uploads)

    for url in urls[:MAX_URLS]:
        source = fetch_url_source(url)
        if source:
            sources.append(source)

    for upload in list(uploads)[:MAX_UPLOADS]:
        attachment, source = await extract_upload(upload)
        attachments.append(attachment)
        if source:
            sources.append(source)

    if not sources and should_search_web(message):
        requires_sources = True
        sources.extend(search_and_fetch_web(message))

    for index, source in enumerate(sources, start=1):
        source.id = index

    widgets = build_widgets(message)

    return PreparedContext(
        sources=sources,
        widgets=widgets,
        attachments=attachments,
        source_prompt=build_source_prompt(sources, requires_sources=requires_sources),
        widget_prompt=build_widget_prompt(widgets),
        requires_sources=requires_sources,
    )


def should_search_web(message: str) -> bool:
    cleaned = message.strip()
    if not cleaned:
        return False
    if is_widget_only_request(cleaned):
        return False
    normalized = strip_vietnamese_accents(cleaned)
    if SEARCH_INTENT_RE.search(cleaned) or any(phrase in normalized for phrase in VIETNAMESE_SEARCH_PHRASES):
        return True
    if EXTERNAL_FACT_RE.search(cleaned) and not looks_like_code_or_sql_task(cleaned):
        return True
    return has_vietnamese_letters(cleaned) and len(cleaned.split()) >= 4 and not looks_like_code_or_sql_task(cleaned)


def is_widget_only_request(message: str) -> bool:
    asks_for_widget = bool(WEATHER_RE.search(message) or TIME_RE.search(message))
    asks_for_time = bool(re.search(r"\bcurrent time\b|\bwhat time\b", message, re.IGNORECASE))
    return (asks_for_widget or asks_for_time) and not EXPLICIT_WEB_INTENT_RE.search(message)


def looks_like_code_or_sql_task(message: str) -> bool:
    lowered = message.lower()
    code_terms = {
        "sql",
        "dbt",
        "python",
        "javascript",
        "typescript",
        "react",
        "api",
        "pipeline",
        "schema",
        "query",
        "code",
        "debug",
        "error",
    }
    return any(term in lowered for term in code_terms) or "```" in message


def has_vietnamese_letters(value: str) -> bool:
    return bool(re.search(r"[ăâđêôơưáàảãạắằẳẵặấầẩẫậéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]", value, re.IGNORECASE))


def strip_vietnamese_accents(value: str) -> str:
    normalized = normalize("NFD", value.lower()).replace("đ", "d")
    return "".join(character for character in normalized if not combining(character))


def extract_urls(value: str) -> list[str]:
    urls: list[str] = []
    for match in URL_RE.findall(value):
        cleaned = match.rstrip(TRAILING_URL_PUNCTUATION)
        parsed = urllib.parse.urlparse(cleaned)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            urls.append(cleaned)
    return list(dict.fromkeys(urls))


def fetch_url_source(url: str) -> CitationSource | None:
    try:
        title, text = fetch_readable_url(url)
    except Exception:
        return None

    if not text:
        return None

    parsed = urllib.parse.urlparse(url)
    return CitationSource(
        id=0,
        title=title or parsed.netloc or url,
        url=url,
        snippet=text[:MAX_SOURCE_CHARS],
        sourceType="url",
    )


def fetch_readable_url(url: str) -> tuple[str | None, str]:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ClevelGo/1.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        raw = response.read(2_000_000)
        content_type = response.headers.get("content-type", "")

    encoding = "utf-8"
    match = re.search(r"charset=([\w.-]+)", content_type, flags=re.IGNORECASE)
    if match:
        encoding = match.group(1)

    decoded = raw.decode(encoding, errors="replace")
    if "html" in content_type or "<html" in decoded[:2000].lower():
        parser = ReadableHtmlParser()
        parser.feed(decoded)
        return parser.title, parser.text

    return None, normalize_text(decoded)


def search_web(query: str) -> list[CitationSource]:
    query_terms = meaningful_query_terms(build_search_query(query))
    results: list[CitationSource] = []
    seen_urls: set[str] = set()

    for search_query in build_search_queries(query):
        candidates = search_with_ddgs(search_query) + search_with_duckduckgo_html(search_query)
        for candidate in candidates:
            if not candidate.url or candidate.url in seen_urls:
                continue
            if query_terms and not result_matches_query(candidate, query_terms):
                continue
            seen_urls.add(candidate.url)
            results.append(candidate)

    return sorted(results, key=lambda source: rank_search_result(source, query_terms))[:MAX_SEARCH_RESULTS]


def build_search_query(message: str) -> str:
    cleaned = " ".join(message.strip().split())
    stripped = SEARCH_QUERY_PREFIX_RE.sub("", cleaned).strip(" .?!:")
    if len(stripped.split()) >= 2:
        return stripped
    return cleaned


def build_search_queries(message: str) -> list[str]:
    base_query = build_search_query(message)
    compact_query = remove_query_stop_words(base_query)
    variants = [compact_query, base_query]
    normalized = strip_vietnamese_accents(compact_query)
    if any(term in normalized for term in ("dai hoc", "truong", "phan hieu", "tuyen sinh")):
        variants.append(f"site:edu.vn {compact_query}")
    return list(dict.fromkeys(query for query in variants if query))


def remove_query_stop_words(query: str) -> str:
    kept: list[str] = []
    for token in query.split():
        normalized = strip_vietnamese_accents(token.strip(".,;:!?()[]{}\"'`")).lower()
        if normalized and normalized not in QUERY_STOP_WORDS:
            kept.append(token)
    return " ".join(kept).strip(" .?!:") or query


def meaningful_query_terms(query: str) -> set[str]:
    normalized = strip_vietnamese_accents(remove_query_stop_words(query))
    terms = {term for term in re.findall(r"[\w]+", normalized) if len(term) >= 3 and term not in QUERY_STOP_WORDS}
    return terms


def result_matches_query(source: CitationSource, terms: set[str]) -> bool:
    return result_match_count(source, terms) >= required_match_count(terms)


def result_match_count(source: CitationSource, terms: set[str]) -> int:
    if not terms:
        return 0
    haystack = strip_vietnamese_accents(" ".join([source.title, source.url or ""]))
    return sum(1 for term in terms if term in haystack)


def required_match_count(terms: set[str]) -> int:
    if len(terms) == 1:
        return 1
    if len(terms) <= 4:
        return 2
    return 3


def rank_search_result(source: CitationSource, terms: set[str]) -> tuple[int, int, int]:
    return (-result_match_count(source, terms), *source_rank(source))


def search_with_ddgs(query: str) -> list[CitationSource]:
    try:
        from ddgs import DDGS
    except ImportError:
        return []

    try:
        with DDGS() as ddgs:
            raw_results = ddgs.text(query, max_results=MAX_SEARCH_RESULTS, region="vn-vi")
    except Exception:
        return []

    results: list[CitationSource] = []
    for item in raw_results:
        url = clean_result_url(str(item.get("href") or item.get("url") or ""))
        title = normalize_text(str(item.get("title") or url))
        snippet = normalize_text(str(item.get("body") or item.get("snippet") or ""))
        if url and title:
            results.append(CitationSource(id=len(results), title=title, url=url, snippet=snippet, sourceType="web"))
    return results


def search_with_duckduckgo_html(query: str) -> list[CitationSource]:
    params = urllib.parse.urlencode({"q": query, "kl": "wt-wt"})
    request = urllib.request.Request(
        f"https://html.duckduckgo.com/html/?{params}",
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; ClevelGo/1.0)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            raw = response.read(1_000_000)
    except Exception:
        return []

    parser = DuckDuckGoParser()
    parser.feed(raw.decode("utf-8", errors="replace"))
    return parser.results[:MAX_SEARCH_RESULTS]


def search_and_fetch_web(query: str) -> list[CitationSource]:
    results = search_web(query)
    sources: list[CitationSource] = []
    seen_urls: set[str] = set()

    for result in sorted(results, key=source_rank)[:MAX_FETCHED_SEARCH_RESULTS]:
        if not result.url or result.url in seen_urls:
            continue
        seen_urls.add(result.url)

        fetched = fetch_url_source(result.url)
        if fetched:
            fetched.source_type = "web"
            sources.append(fetched)
            continue

        if result.snippet:
            sources.append(result)

    return sources


def source_rank(source: CitationSource) -> tuple[int, int]:
    if not source.url:
        return (4, source.id)
    hostname = urllib.parse.urlparse(source.url).hostname or ""
    hostname = hostname.lower().removeprefix("www.")
    if hostname.endswith(".edu.vn") or hostname.endswith(".gov.vn"):
        return (0, source.id)
    if hostname.endswith(".edu") or hostname.endswith(".gov"):
        return (1, source.id)
    if hostname.endswith(".org") or hostname.endswith(".org.vn"):
        return (2, source.id)
    return (3, source.id)


async def extract_upload(upload: UploadFile) -> tuple[AttachmentSummary, CitationSource | None]:
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    filename = upload.filename or "uploaded-file"
    mime_type = upload.content_type or "application/octet-stream"

    if len(data) > MAX_UPLOAD_BYTES:
        summary = "File was larger than the upload limit and was not read."
        return make_attachment(filename, mime_type, len(data), summary), None

    lowered = filename.lower()
    try:
        if mime_type == "application/pdf" or lowered.endswith(".pdf"):
            text = extract_pdf_text(data)
            summary = summarize_text("PDF", text)
        else:
            summary = "Unsupported file type. Upload a PDF file."
            return make_attachment(filename, mime_type, len(data), summary), None
    except Exception as exc:
        summary = f"Could not read file: {exc}"
        return make_attachment(filename, mime_type, len(data), summary), None

    attachment = make_attachment(filename, mime_type, len(data), summary)
    source = CitationSource(
        id=0,
        title=filename,
        url=None,
        snippet=text[:MAX_SOURCE_CHARS],
        sourceType="file",
    )
    return attachment, source


def make_attachment(filename: str, mime_type: str, size: int, summary: str) -> AttachmentSummary:
    return AttachmentSummary(id=str(uuid4()), name=filename, mimeType=mime_type, size=size, summary=summary[:600])


def extract_pdf_text(data: bytes) -> str:
    try:
        import fitz
    except ImportError as exc:
        raise RuntimeError("PDF support requires PyMuPDF to be installed") from exc

    pages: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as document:
        for page in document[:12]:
            pages.append(page.get_text("text") or "")
    return normalize_text("\n\n".join(pages))


def summarize_text(kind: str, text: str) -> str:
    if not text:
        return f"{kind} contained no extractable text."
    return f"{kind} text extracted: {text[:420]}"


def build_widgets(message: str) -> list[ChatWidget]:
    widgets: list[ChatWidget] = []
    weather_location = extract_widget_location(WEATHER_RE, message)
    if weather_location:
        weather = build_weather_widget(weather_location)
        if weather:
            widgets.append(weather)

    time_location = extract_widget_location(TIME_RE, message)
    if time_location or re.search(r"\bcurrent time\b|\bwhat time\b", message, re.IGNORECASE):
        time_widget = build_time_widget(time_location)
        if time_widget:
            widgets.append(time_widget)

    return widgets


def extract_widget_location(pattern: re.Pattern[str], message: str) -> str | None:
    match = pattern.search(message)
    if not match:
        return None
    location = (match.group(1) or "").strip(" .?!")
    if not location or location.lower() in {"now", "today", "outside"}:
        return None
    return location


def build_weather_widget(location: str) -> ChatWidget | None:
    geocode = geocode_location(location)
    if not geocode:
        return None
    query = urllib.parse.urlencode(
        {
            "latitude": geocode["latitude"],
            "longitude": geocode["longitude"],
            "current": "weather_code,temperature_2m,is_day,relative_humidity_2m,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min",
            "forecast_days": 4,
            "timezone": "auto",
        }
    )
    try:
        data = fetch_json(f"https://api.open-meteo.com/v1/forecast?{query}")
        current = data["current"]
    except Exception:
        return None

    condition = weather_condition(int(current.get("weather_code", 0)))
    forecast = build_forecast(data.get("daily") or {})
    name = str(geocode.get("name") or location)
    country = str(geocode.get("country") or "")
    return ChatWidget(
        widgetType="weather",
        title=f"Weather in {name}",
        data={
            "location": f"{name}, {country}".strip(", "),
            "temperature": float(current.get("temperature_2m", 0)),
            "temperatureUnit": "C",
            "condition": condition,
            "humidity": int(current.get("relative_humidity_2m", 0)),
            "windSpeed": float(current.get("wind_speed_10m", 0)),
            "windSpeedUnit": "km/h",
            "time": str(current.get("time") or ""),
            "forecast": forecast,
        },
    )


def build_forecast(daily: dict) -> list[dict[str, str | float]]:
    dates = daily.get("time") or []
    max_values = daily.get("temperature_2m_max") or []
    min_values = daily.get("temperature_2m_min") or []
    weather_codes = daily.get("weather_code") or []
    forecast: list[dict[str, str | float]] = []

    for index, date in enumerate(dates[:4]):
        try:
            max_temp = float(max_values[index])
            min_temp = float(min_values[index])
            condition = weather_condition(int(weather_codes[index]))
        except (IndexError, TypeError, ValueError):
            continue

        forecast.append(
            {
                "date": str(date),
                "condition": condition,
                "max": max_temp,
                "min": min_temp,
            }
        )

    return forecast


def build_time_widget(location: str | None) -> ChatWidget | None:
    label = location or "Local"
    timezone_name: str | None = None
    if location:
        geocode = geocode_location(location)
        timezone_name = str(geocode.get("timezone")) if geocode else None
        label = str(geocode.get("name") or location) if geocode else location

    try:
        now = datetime.now(ZoneInfo(timezone_name)) if timezone_name else datetime.now().astimezone()
    except ZoneInfoNotFoundError:
        now = datetime.now().astimezone()

    return ChatWidget(
        widgetType="time",
        title=f"Time in {label}",
        data={
            "location": label,
            "timezone": timezone_name or str(now.tzinfo),
            "date": now.strftime("%A, %B %d, %Y"),
            "time": now.strftime("%H:%M"),
        },
    )


def geocode_location(location: str) -> dict[str, str | float] | None:
    params = urllib.parse.urlencode({"name": location, "count": 1, "language": "en", "format": "json"})
    try:
        data = fetch_json(f"https://geocoding-api.open-meteo.com/v1/search?{params}")
    except Exception:
        return None
    results = data.get("results") or []
    return results[0] if results else None


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; ClevelGo/1.0)"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.loads(response.read(1_000_000).decode("utf-8", errors="replace"))


def build_source_prompt(sources: list[CitationSource], *, requires_sources: bool = False) -> str:
    if not sources and requires_sources:
        return (
            "Source Context\n\n"
            "No verified source context could be fetched for this request. "
            "Do not answer external factual details from memory. "
            "Say that you could not verify the information from web sources and ask the user for an official link or file."
        )
    if not sources:
        return ""
    blocks = [
        "Source Context",
        "Use only these fetched sources for external factual claims. Cite every factual claim with bracket numbers like [1] or [2].",
        "Do not use memory to fill missing facts. If a detail is not present in these excerpts, say it is not found in the sources.",
        "Do not invent names, addresses, phone numbers, emails, dates, codes, departments, or citations. Do not cite widgets.",
    ]
    for source in sources:
        label = source.url or source.title
        blocks.append(f"[{source.id}] {source.title}\nType: {source.source_type}\nLocation: {label}\nExcerpt:\n{source.snippet}")
    return "\n\n".join(blocks)


def build_widget_prompt(widgets: list[ChatWidget]) -> str:
    if not widgets:
        return ""
    blocks = ["Widget Data", "Use this structured widget data when relevant, but do not cite it as a source."]
    for widget in widgets:
        blocks.append(f"{widget.title}: {widget.data}")
    return "\n\n".join(blocks)


def clean_duckduckgo_url(value: str) -> str:
    value = html.unescape(value)
    parsed = urllib.parse.urlparse(value)
    if parsed.netloc.endswith("duckduckgo.com") and parsed.path.startswith("/l/"):
        query = urllib.parse.parse_qs(parsed.query)
        if query.get("uddg"):
            return query["uddg"][0]
    return value


def clean_result_url(value: str) -> str:
    cleaned = clean_duckduckgo_url(value.strip())
    parsed = urllib.parse.urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return ""
    return cleaned


def weather_condition(code: int) -> str:
    if code == 0:
        return "Clear"
    if code in {1, 2}:
        return "Partly cloudy"
    if code == 3:
        return "Cloudy"
    if code in {45, 48}:
        return "Fog"
    if code in {51, 53, 55, 56, 57}:
        return "Drizzle"
    if code in {61, 63, 65, 66, 67, 80, 81, 82}:
        return "Rain"
    if code in {71, 73, 75, 77, 85, 86}:
        return "Snow"
    if code in {95, 96, 99}:
        return "Thunderstorm"
    return "Unknown"


def normalize_text(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"[ \t\r\f\v]+", " ", value)
    value = re.sub(r" *\n+ *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()
