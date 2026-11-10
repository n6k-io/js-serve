import { describe, expect, test } from "bun:test";
import { PagesError, diffPages, parsePages, type PagesConfig } from "./pages";

const YML = `
apps:
  nyc-taxi:
    gateway: { url: ws://127.0.0.1:54321/ws, token: tok, catalogs: [remote, memory] }
    pages:
      queens-pickups: /abs/nyc/queens.mdx
      rel: pages/rel.mdx
`;

describe("parsePages", () => {
  test("parses apps, gateway and pages", () => {
    expect(parsePages(YML, "/home/u/.n6k/pages.yml")).toEqual({
      "nyc-taxi": {
        gateway: {
          url: "ws://127.0.0.1:54321/ws",
          token: "tok",
          catalogs: ["remote", "memory"],
        },
        pages: {
          "queens-pickups": "/abs/nyc/queens.mdx",
          rel: "/home/u/.n6k/pages/rel.mdx",
        },
      },
    });
  });

  test("empty file is no apps", () => {
    expect(parsePages("", "/p.yml")).toEqual({});
  });

  test.each([
    ["bad yaml", "apps: [", /p\.yml/],
    ["missing gateway", "apps:\n  a:\n    pages: {}", /apps\.a\.gateway/],
    [
      "non-ws url",
      "apps:\n  a:\n    gateway: { url: http://x, token: t, catalogs: [] }",
      /not ws/,
    ],
    [
      "bad catalog",
      "apps:\n  a:\n    gateway: { url: ws://x, token: t, catalogs: [1x] }",
      /catalogs\[0\]/,
    ],
    [
      "bad page name",
      "apps:\n  a:\n    gateway: { url: ws://x, token: t, catalogs: [] }\n    pages: { 'a/b': /x.mdx }",
      /must match/,
    ],
    [
      "non-mdx page",
      "apps:\n  a:\n    gateway: { url: ws://x, token: t, catalogs: [] }\n    pages: { p: /x.tsx }",
      /not an \.mdx/,
    ],
  ])("%s fails", (_label, text, message) => {
    expect(() => parsePages(text, "/p.yml")).toThrow(PagesError);
    expect(() => parsePages(text, "/p.yml")).toThrow(message);
  });
});

function config(pages: Record<string, string>, token = "t"): PagesConfig {
  return { a: { gateway: { url: "ws://x", token, catalogs: ["db"] }, pages } };
}

describe("diffPages", () => {
  test("added, removed and changed file", () => {
    const prev = config({ keep: "/k.mdx", gone: "/g.mdx", moved: "/m.mdx" });
    const next = config({ keep: "/k.mdx", moved: "/m2.mdx", fresh: "/f.mdx" });
    expect(diffPages(prev, next)).toEqual({
      added: [{ app: "a", page: "fresh" }],
      removed: [{ app: "a", page: "gone" }],
      changed: [{ app: "a", page: "moved" }],
    });
  });

  test("gateway change marks every page of the app changed", () => {
    expect(
      diffPages(config({ p: "/p.mdx" }), config({ p: "/p.mdx" }, "t2")),
    ).toEqual({ added: [], removed: [], changed: [{ app: "a", page: "p" }] });
  });

  test("removed app removes its pages", () => {
    expect(diffPages(config({ p: "/p.mdx" }), {})).toEqual({
      added: [],
      removed: [{ app: "a", page: "p" }],
      changed: [],
    });
  });
});
