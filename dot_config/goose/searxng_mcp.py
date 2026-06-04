from mcp.server.fastmcp import FastMCP
import requests
import urllib.parse

mcp = FastMCP("SearXNG")

SEARXNG_URL = "http://localhost:8888"
DEFAULT_RESULTS = 5
MAX_RESULTS = 10
DEFAULT_SNIPPET_CHARS = 500
MAX_SNIPPET_CHARS = 1500

@mcp.tool()
def search(
    query: str,
    num_results: int = DEFAULT_RESULTS,
    snippet_chars: int = DEFAULT_SNIPPET_CHARS,
) -> str:
    """Search the web via SearXNG and return clean markdown snippets.

    Args:
        query: Search query string.
        num_results: Number of results to return (1–10, default 5).
        snippet_chars: Max characters per result snippet (50–1500, default 500).
    """
    num_results = max(1, min(num_results, MAX_RESULTS))
    snippet_chars = max(50, min(snippet_chars, MAX_SNIPPET_CHARS))

    try:
        params = urllib.parse.urlencode({"q": query, "format": "json"})
        response = requests.get(f"{SEARXNG_URL}/search?{params}", timeout=15)
        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        if not results:
            return "No results found."

        md_lines = []
        for res in results[:num_results]:
            title = res.get("title", "No Title")
            url = res.get("url", "")
            content = res.get("content", "")
            if len(content) > snippet_chars:
                content = content[:snippet_chars] + "..."
            md_lines.append(f"**{title}**\nURL: {url}\n{content}\n")

        return "\n".join(md_lines)
    except Exception as e:
        return f"Error performing search: {e}"

if __name__ == "__main__":
    mcp.run()
