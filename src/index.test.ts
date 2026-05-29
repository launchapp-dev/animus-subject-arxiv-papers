import { describe, expect, it } from "vitest";
import {
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
} from "./index";

const config = {
  apiUrl: "https://export.arxiv.org/api",
  searchQuery: "all:machine learning",
  sortBy: "submittedDate" as const,
  sortOrder: "descending" as const,
  start: 0,
  limit: 50,
};

const entry = {
  id: "http://arxiv.org/abs/2605.30350v1",
  title: "DynaFLIP: Rethinking Robotics Perception",
  summary: "A paper about tri-modal dynamics guided representation learning.",
  published: "2026-05-28T17:59:53Z",
  updated: "2026-05-28T17:59:53Z",
  author: [{ name: "Ada Lovelace" }, { name: "Grace Hopper" }],
  category: [{ term: "cs.RO" }, { term: "cs.LG" }],
  link: [
    { href: "http://arxiv.org/abs/2605.30350v1", rel: "alternate", type: "text/html" },
    { href: "http://arxiv.org/pdf/2605.30350v1", title: "pdf", type: "application/pdf" },
  ],
  "arxiv:primary_category": { term: "cs.RO" },
  "arxiv:doi": "10.1234/example",
  "arxiv:comment": "12 pages",
};

describe("arXiv paper helpers", () => {
  it("builds ids", () => {
    expect(shortArxivId("http://arxiv.org/abs/2605.30350v1")).toBe("2605.30350v1");
    expect(arxivSubjectId("2605.30350v1")).toBe("arxiv.paper:2605.30350v1");
    expect(parseArxivSubjectId("arxiv.paper:2605.30350v1")).toBe("2605.30350v1");
  });

  it("maps entries to subjects", () => {
    const subject = subjectFromEntry(config, entry);
    expect(subject.id).toBe("arxiv.paper:2605.30350v1");
    expect(subject.kind).toBe("arxiv.paper");
    expect(subject.status).toBe("done");
    expect(subject.native_status).toBe("paper");
    expect(subject.assignee).toBe("Ada Lovelace");
    expect(subject.custom?.primary_category).toBe("cs.RO");
    expect(subject.custom?.pdf_url).toBe("http://arxiv.org/pdf/2605.30350v1");
  });

  it("extracts authors, categories, status, and priority", () => {
    expect(arxivId(entry)).toBe("2605.30350v1");
    expect(authorsFromEntry(entry)).toEqual(["Ada Lovelace", "Grace Hopper"]);
    expect(categoriesFromEntry(entry)).toEqual(["cs.RO", "cs.LG"]);
    expect(nativeStatus(entry)).toBe("paper");
    expect(statusFromEntry(entry)).toBe("done");
    expect(priorityFromEntry(entry, Date.parse("2026-05-29T00:00:00Z"))).toBe(1);
  });

  it("marks withdrawn papers as cancelled", () => {
    const withdrawn = { ...entry, summary: "This article has been withdrawn by the authors." };
    expect(nativeStatus(withdrawn)).toBe("withdrawn");
    expect(statusFromEntry(withdrawn)).toBe("cancelled");
    expect(priorityFromEntry(withdrawn)).toBe(1);
  });

  it("labels and filters entries", () => {
    expect(labelsFromEntry(config, entry)).toEqual([
      "arxiv",
      "paper",
      "search:all:machine learning",
      "primary:cs.RO",
      "category:cs.RO",
      "category:cs.LG",
      "year:2026",
      "author:Ada Lovelace",
      "author:Grace Hopper",
    ]);
    expect(matchesConfiguredFilters({ ...config, localQuery: "robotics" }, entry)).toBe(true);
    expect(matchesConfiguredFilters({ ...config, localQuery: "does-not-match" }, entry)).toBe(false);
    expect(matchesFilters(config, entry, { labels_all: ["arxiv", "category:cs.LG"] })).toBe(true);
  });

  it("normalizes timestamps", () => {
    expect(toIso("2026-05-28T17:59:53Z")).toBe("2026-05-28T17:59:53.000Z");
    expect(toIso(undefined)).toBeUndefined();
  });
});
