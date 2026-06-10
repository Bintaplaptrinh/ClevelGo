---
name: search-and-fetch
description: |
  Free local web search and URL fetching workflow for agents. Use when a user asks
  to search the web without paid API keys, look up public information, gather
  sources, or provides an http/https URL to inspect, summarize, fetch, extract,
  or cite.
license: MIT
metadata:
  author: Clevel Go
  version: "1.0.0"
---

# Search And Fetch

Use this skill when the task needs public web search or when the user input contains an `http://` or `https://` link.

## Tool

Run the local helper from the workspace root:

```bash
python frontend/.agents/tools/search_fetch/search_fetch.py auto "<user input>"
```

Modes:

- `auto`: fetches URL content when links are present; otherwise runs search.
- `fetch`: extracts readable content from a specific URL.
- `search`: returns search results for a query.

Useful options:

- `--max-results 5` limits search results.
- `--max-chars 12000` limits extracted page text.
- `--backend duckduckgo` or `--backend auto` selects the DDGS backend.
- `--timelimit d|w|m|y` constrains supported search engines by recency.

## Workflow

1. If the user provides one or more URLs, call `auto` or `fetch` before answering.
2. If the user asks for current or unknown public information without a URL, call `search`.
3. Use returned `chunks` as page context and cite returned `url` values in the answer.
4. If DDGS is installed and works, the tool uses it first. Otherwise it tries Tavily keyless if installed, then falls back to dependency-free DuckDuckGo HTML search.
5. Do not ask the user for a Tavily API key for normal search/fetch tasks.

## Notes

- `ddgs` and Tavily are optional providers, not required repo folders.
- Tavily is used only in no-key mode as a fallback for search when installed.
- LangChain is represented by local document-style normalization and chunking, avoiding a large dependency install.
- Only fetch public URLs the user provided or URLs needed for the search task.
