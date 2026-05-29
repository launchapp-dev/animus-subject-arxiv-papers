# animus-subject-arxiv-papers

Animus subject backend for arXiv papers.

The plugin queries the arXiv Atom API, maps papers into Animus subjects, and supports local filtering by status, assignee, labels, and update time.

## Configuration

All settings are optional.

| Environment variable | Description |
| --- | --- |
| `ARXIV_SEARCH_QUERY` | arXiv search query. Defaults to `all:machine learning`. |
| `ARXIV_ID_LIST` | Comma-separated arXiv IDs to fetch or filter. |
| `ARXIV_SORT_BY` | `relevance`, `lastUpdatedDate`, or `submittedDate`. Defaults to `submittedDate`. |
| `ARXIV_SORT_ORDER` | `ascending` or `descending`. Defaults to `descending`. |
| `ARXIV_API_URL` | API base URL. Defaults to `https://export.arxiv.org/api`. |
| `ARXIV_QUERY` | Local text query applied after fetch. |
| `ARXIV_START` | Zero-based result offset. Defaults to `0`. |
| `ARXIV_LIMIT` | Maximum papers to fetch, 1-2000. Defaults to `50`. |

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run manifest
```

## Install

```bash
animus plugin install launchapp-dev/animus-subject-arxiv-papers
```
