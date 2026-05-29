import { XMLParser } from "fast-xml-parser";
import { definePlugin, PluginKind, type Subject, type SubjectBackend, type SubjectListParams, type SubjectStatus } from "@launchapp-dev/animus-plugin-sdk";

const NAME = "animus-subject-arxiv-papers";
const VERSION = "0.1.0";
const SUBJECT_KIND = "arxiv.paper";
const DEFAULT_API_URL = "https://export.arxiv.org/api";
const DEFAULT_SEARCH_QUERY = "all:machine learning";

type SortBy = "relevance" | "lastUpdatedDate" | "submittedDate";
type SortOrder = "ascending" | "descending";

interface Config {
  apiUrl: string;
  searchQuery: string;
  idList?: string;
  sortBy: SortBy;
  sortOrder: SortOrder;
  localQuery?: string;
  start: number;
  limit: number;
}

interface ArxivAuthor {
  name?: string;
}

interface ArxivCategory {
  term?: string;
  scheme?: string;
}

interface ArxivLink {
  href?: string;
  rel?: string;
  type?: string;
  title?: string;
}

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  updated?: string;
  author?: ArxivAuthor | ArxivAuthor[];
  category?: ArxivCategory | ArxivCategory[];
  link?: ArxivLink | ArxivLink[];
  "arxiv:primary_category"?: ArxivCategory;
  "arxiv:doi"?: string;
  "arxiv:comment"?: string;
  "arxiv:journal_ref"?: string;
}

interface ArxivFeed {
  feed?: {
    entry?: ArxivEntry | ArxivEntry[];
    "opensearch:totalResults"?: string | number;
  };
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === "" ? undefined : raw;
}

function normalizeBaseUrl(raw: string | undefined, fallback: string): string {
  return (raw ?? fallback).replace(/\/+$/, "");
}

function readPositiveInt(raw: string | undefined, fallback: number, max: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(value, max);
}

function readNonNegativeInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function readSortBy(raw: string | undefined): SortBy {
  const value = raw ?? "submittedDate";
  if (value === "relevance" || value === "lastUpdatedDate" || value === "submittedDate") return value;
  throw new Error(`ARXIV_SORT_BY must be relevance, lastUpdatedDate, or submittedDate; got ${raw}`);
}

function readSortOrder(raw: string | undefined): SortOrder {
  const value = raw ?? "descending";
  if (value === "ascending" || value === "descending") return value;
  throw new Error(`ARXIV_SORT_ORDER must be ascending or descending; got ${raw}`);
}

function readConfig(): Config {
  return {
    apiUrl: normalizeBaseUrl(optionalEnv("ARXIV_API_URL"), DEFAULT_API_URL),
    searchQuery: optionalEnv("ARXIV_SEARCH_QUERY") ?? DEFAULT_SEARCH_QUERY,
    idList: optionalEnv("ARXIV_ID_LIST"),
    sortBy: readSortBy(optionalEnv("ARXIV_SORT_BY")),
    sortOrder: readSortOrder(optionalEnv("ARXIV_SORT_ORDER")),
    localQuery: optionalEnv("ARXIV_QUERY"),
    start: readNonNegativeInt(optionalEnv("ARXIV_START"), 0),
    limit: readPositiveInt(optionalEnv("ARXIV_LIMIT"), 50, 2000),
  };
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function decodePart(value: string): string {
  return decodeURIComponent(value);
}

function arrayify<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/\s+/g, " ").trim();
}

function toIso(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function shortArxivId(raw: string | undefined): string {
  const value = raw ?? "";
  const withoutUrl = value.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  return withoutUrl.trim();
}

function arxivSubjectId(id: string): string {
  return `${SUBJECT_KIND}:${encodePart(id)}`;
}

function parseArxivSubjectId(id: string): string {
  const raw = id.startsWith(`${SUBJECT_KIND}:`) ? id.slice(`${SUBJECT_KIND}:`.length) : id;
  const parsed = decodePart(raw).trim();
  if (!parsed) throw new Error(`expected id '${SUBJECT_KIND}:<arxiv-id>', got '${id}'`);
  return parsed;
}

function arxivId(entry: ArxivEntry): string {
  return shortArxivId(entry.id);
}

function authorsFromEntry(entry: ArxivEntry): string[] {
  return arrayify(entry.author).map((author) => cleanText(author.name)).filter((name): name is string => Boolean(name));
}

function categoriesFromEntry(entry: ArxivEntry): string[] {
  return arrayify(entry.category).map((category) => category.term).filter((term): term is string => Boolean(term));
}

function linksFromEntry(entry: ArxivEntry): ArxivLink[] {
  return arrayify(entry.link).filter((link) => Boolean(link.href));
}

function isWithdrawn(entry: ArxivEntry): boolean {
  const text = `${entry.title ?? ""} ${entry.summary ?? ""}`.toLowerCase();
  return text.includes("withdrawn");
}

function nativeStatus(entry: ArxivEntry): string {
  return isWithdrawn(entry) ? "withdrawn" : "paper";
}

function statusFromEntry(entry: ArxivEntry): SubjectStatus {
  return isWithdrawn(entry) ? "cancelled" : "done";
}

function priorityFromEntry(entry: ArxivEntry, now = Date.now()): number {
  if (isWithdrawn(entry)) return 1;
  const updatedAt = Date.parse(entry.updated ?? entry.published ?? "");
  if (!Number.isFinite(updatedAt)) return 3;
  const ageDays = Math.max(0, (now - updatedAt) / 86_400_000);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 2;
  return 3;
}

function labelsFromEntry(config: Config, entry: ArxivEntry): string[] {
  const labels = new Set<string>(["arxiv", nativeStatus(entry), `search:${config.searchQuery}`]);
  const primary = entry["arxiv:primary_category"]?.term;
  if (primary) labels.add(`primary:${primary}`);
  for (const category of categoriesFromEntry(entry)) labels.add(`category:${category}`);
  const year = toIso(entry.published)?.slice(0, 4);
  if (year) labels.add(`year:${year}`);
  for (const author of authorsFromEntry(entry).slice(0, 3)) labels.add(`author:${author}`);
  return [...labels];
}

function subjectFromEntry(config: Config, entry: ArxivEntry, fetchedAt = new Date().toISOString()): Subject {
  const id = arxivId(entry);
  const updatedAt = toIso(entry.updated) ?? toIso(entry.published) ?? fetchedAt;
  const authors = authorsFromEntry(entry);
  const categories = categoriesFromEntry(entry);
  const pdfLink = linksFromEntry(entry).find((link) => link.title === "pdf" || link.type === "application/pdf")?.href;
  return {
    id: arxivSubjectId(id),
    kind: SUBJECT_KIND,
    title: cleanText(entry.title) ?? `arXiv paper ${id}`,
    description: cleanText(entry.summary) ?? `arXiv paper ${id}`,
    status: statusFromEntry(entry),
    created_at: toIso(entry.published) ?? updatedAt,
    updated_at: updatedAt,
    labels: labelsFromEntry(config, entry),
    assignee: authors[0],
    url: entry.id,
    native_status: nativeStatus(entry),
    priority: priorityFromEntry(entry),
    custom: {
      arxiv_id: id,
      search_query: config.searchQuery,
      authors,
      categories,
      primary_category: entry["arxiv:primary_category"]?.term,
      doi: entry["arxiv:doi"],
      comment: entry["arxiv:comment"],
      journal_ref: entry["arxiv:journal_ref"],
      pdf_url: pdfLink,
      links: linksFromEntry(entry),
      raw: entry,
    },
  };
}

function matchesConfiguredFilters(config: Config, entry: ArxivEntry): boolean {
  if (!config.localQuery) return true;
  const needle = config.localQuery.toLowerCase();
  const haystack = [
    arxivId(entry),
    entry.title,
    entry.summary,
    entry["arxiv:doi"],
    entry["arxiv:comment"],
    entry["arxiv:journal_ref"],
    nativeStatus(entry),
    ...authorsFromEntry(entry),
    ...categoriesFromEntry(entry),
  ].join(" ").toLowerCase();
  return haystack.includes(needle);
}

function matchesFilters(config: Config, entry: ArxivEntry, params: SubjectListParams): boolean {
  if (!matchesConfiguredFilters(config, entry)) return false;
  const subject = subjectFromEntry(config, entry);
  if (params.status && params.status.length > 0 && !params.status.includes(subject.status)) return false;
  if (params.assignee && params.assignee.length > 0 && (!subject.assignee || !params.assignee.includes(subject.assignee))) return false;
  const labels = new Set(subject.labels ?? []);
  if (params.labels_all && !params.labels_all.every((label) => labels.has(label))) return false;
  if (params.labels_any && params.labels_any.length > 0 && !params.labels_any.some((label) => labels.has(label))) return false;
  if (params.updated_since && new Date(subject.updated_at) < new Date(params.updated_since)) return false;
  return true;
}

class ArxivPapersClient {
  private readonly parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    textNodeName: "#text",
    trimValues: true,
  });

  constructor(private readonly config: Config) {}

  async requestFeed(query: Record<string, string | number | undefined>): Promise<ArxivFeed> {
    const url = new URL(`${this.config.apiUrl}/query`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const response = await fetch(url, {
      headers: {
        Accept: "application/atom+xml, application/xml;q=0.9, */*;q=0.1",
        "User-Agent": `${NAME}/${VERSION} (https://github.com/launchapp-dev/${NAME})`,
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`arXiv API ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    return this.parser.parse(text) as ArxivFeed;
  }

  async list(): Promise<ArxivEntry[]> {
    const feed = await this.requestFeed({
      search_query: this.config.searchQuery,
      id_list: this.config.idList,
      start: this.config.start,
      max_results: this.config.limit,
      sortBy: this.config.sortBy,
      sortOrder: this.config.sortOrder,
    });
    return arrayify(feed.feed?.entry);
  }

  async get(id: string): Promise<ArxivEntry> {
    const feed = await this.requestFeed({ id_list: id, max_results: 1 });
    const entry = arrayify(feed.feed?.entry)[0];
    if (!entry) throw new Error(`arXiv paper not found: ${id}`);
    return entry;
  }
}

function buildBackend(): SubjectBackend {
  let cached: { client: ArxivPapersClient; config: Config } | null = null;
  const runtime = (): { client: ArxivPapersClient; config: Config } => {
    if (!cached) {
      const config = readConfig();
      cached = { client: new ArxivPapersClient(config), config };
    }
    return cached;
  };
  return {
    async list(params) {
      const { client, config } = runtime();
      const entries = await client.list();
      return {
        subjects: entries.filter((entry) => matchesFilters(config, entry, params)).map((entry) => subjectFromEntry(config, entry)),
        next_cursor: null,
        fetched_at: new Date().toISOString(),
      };
    },
    async get(params) {
      const { client, config } = runtime();
      return subjectFromEntry(config, await client.get(parseArxivSubjectId(params.id)));
    },
    schema() {
      return {
        kinds: [SUBJECT_KIND],
        status_values: ["ready", "in-progress", "blocked", "done", "cancelled"],
        supports_watch: false,
        supports_create: false,
        supports_pagination: false,
        native_status_values: ["paper", "withdrawn"],
        status_dispatch_hints: [
          { native_status: "paper", status: "done" },
          { native_status: "withdrawn", status: "cancelled" },
        ],
        custom_fields: ["arxiv_id", "search_query", "authors", "categories", "primary_category", "doi", "comment", "journal_ref", "pdf_url", "links", "raw"],
      };
    },
    async health() {
      try {
        const { client } = runtime();
        await client.list();
        return { status: "healthy", uptime_ms: null, memory_usage_bytes: null, last_error: null };
      } catch (err) {
        return { status: "unhealthy", uptime_ms: null, memory_usage_bytes: null, last_error: String(err) };
      }
    },
  };
}

export {
  ArxivPapersClient,
  arxivId,
  arxivSubjectId,
  authorsFromEntry,
  categoriesFromEntry,
  labelsFromEntry,
  matchesConfiguredFilters,
  matchesFilters,
  nativeStatus,
  parseArxivSubjectId,
  priorityFromEntry,
  shortArxivId,
  statusFromEntry,
  subjectFromEntry,
  toIso,
};

const plugin = definePlugin({
  kind: PluginKind.SubjectBackend,
  name: NAME,
  version: VERSION,
  description: "arXiv papers subject backend plugin for Animus",
  subject_kinds: [SUBJECT_KIND],
  env_required: [
    { name: "ARXIV_SEARCH_QUERY", description: `Optional arXiv search query. Defaults to ${DEFAULT_SEARCH_QUERY}.`, required: false },
    { name: "ARXIV_ID_LIST", description: "Optional comma-separated arXiv IDs to fetch or filter.", required: false },
    { name: "ARXIV_SORT_BY", description: "Optional sort field: relevance, lastUpdatedDate, or submittedDate. Defaults to submittedDate.", required: false },
    { name: "ARXIV_SORT_ORDER", description: "Optional sort order: ascending or descending. Defaults to descending.", required: false },
    { name: "ARXIV_API_URL", description: `Optional arXiv API base URL. Defaults to ${DEFAULT_API_URL}.`, required: false },
    { name: "ARXIV_QUERY", description: "Optional local text query applied to papers after fetch.", required: false },
    { name: "ARXIV_START", description: "Optional zero-based result offset. Defaults to 0.", required: false },
    { name: "ARXIV_LIMIT", description: "Optional maximum paper count from 1 to 2000. Defaults to 50.", required: false },
  ],
  impl: buildBackend(),
});

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("index.cjs") || entry.endsWith("index.js") || entry.endsWith(NAME);
}

if (isDirectRun()) {
  plugin.run().catch((err) => {
    process.stderr.write(`[${NAME}] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
