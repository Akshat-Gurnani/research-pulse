import { describe, it, expect } from "vitest";
import { parseFeed, ArxivError, isSuspicious } from "@/lib/arxiv";

const ok = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults>1</opensearch:totalResults>
<entry><id>http://arxiv.org/abs/2510.01234v2</id><updated>2026-10-08T10:00:00Z</updated><published>2026-10-07T09:00:00Z</published>
<title>A  Test
 Paper</title><summary> Abstract text. </summary><author><name>A. One</name></author><arxiv:primary_category term="cs.AI"/><category term="cs.AI"/><category term="cs.CL"/></entry></feed>`;
const err = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>0</opensearch:totalResults>
<entry><id>http://arxiv.org/api/errors#incorrect_start</id><title>Error</title><summary>start must be less than total</summary></entry></feed>`;

describe("arXiv feed parsing", () => {
  it("parses id, version, categories, whitespace", () => {
    const { papers, total } = parseFeed(ok);
    expect(total).toBe(1); expect(papers[0]).toMatchObject({ arxiv_id: "2510.01234", latest_version: 2, title: "A Test Paper", primary_category: "cs.AI" });
    expect(papers[0].categories).toEqual(["cs.AI", "cs.CL"]);
  });
  it("rejects the fake Error entry", () => expect(() => parseFeed(err)).toThrow(ArxivError));
  it("rejects an HTML body", () => expect(() => parseFeed("<!DOCTYPE html><html></html>")).toThrow(/HTML/));
  it("suspicious-empty rule", () => {
    expect(isSuspicious(0, 1500, false)).toBe(true);
    expect(isSuspicious(0, 1500, true)).toBe(false);
    expect(isSuspicious(1400, 1500, false)).toBe(false);
  });
});
