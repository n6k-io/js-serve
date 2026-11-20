import { describe, expect, test } from "bun:test";
import { DataArgError, resolveData } from "./data-args";

const ws = (url: string, catalog: string, token = "") => ({
  url,
  catalog,
  token,
});

describe("resolveData", () => {
  test("bare URL attaches as db", () => {
    expect(resolveData({}, ["ws://h:7823/ws"])).toEqual({
      db: ws("ws://h:7823/ws", "db"),
    });
  });

  test("name=URL attaches as name", () => {
    expect(resolveData({}, ["nyc=wss://h/ws", "sales=ws://h2/ws"])).toEqual({
      nyc: ws("wss://h/ws", "nyc"),
      sales: ws("ws://h2/ws", "sales"),
    });
  });

  test("n6k(s):// becomes ws(s)://…/ws", () => {
    expect(resolveData({}, ["n6k://h:53707", "s=n6ks://h/pre?a=b"])).toEqual({
      db: ws("ws://h:53707/ws", "db"),
      s: ws("wss://h/pre/ws?a=b", "s"),
    });
  });

  test("alias:catalog=URL attaches catalog as alias", () => {
    expect(resolveData({}, ["foo:bar=n6k://h:1"])).toEqual({
      foo: ws("ws://h:1/ws", "bar"),
    });
    expect(() => resolveData({}, ["a:b:c=n6k://h"])).toThrow(DataArgError);
    expect(() => resolveData({}, ["a:1x=n6k://h"])).toThrow(DataArgError);
  });

  test("a URL whose query contains = is still a bare URL", () => {
    expect(resolveData({}, ["ws://h/ws?a=b"])).toEqual({
      db: ws("ws://h/ws?a=b", "db"),
    });
  });

  test("frontmatter catalogs carry through", () => {
    expect(
      resolveData({ foo: { url: "n6k://h:1", catalog: "bar" } }, []),
    ).toEqual({ foo: ws("ws://h:1/ws", "bar") });
  });

  test("--data overrides frontmatter for the same alias", () => {
    expect(
      resolveData(
        {
          nyc: { url: "ws://a/ws", catalog: "nyc" },
          other: { url: "ws://o/ws", catalog: "other" },
        },
        ["nyc=ws://b/ws"],
      ),
    ).toEqual({
      nyc: ws("ws://b/ws", "nyc"),
      other: ws("ws://o/ws", "other"),
    });
  });

  test("bad alias is rejected", () => {
    expect(() => resolveData({}, ["1x=ws://h/ws"])).toThrow(DataArgError);
    expect(() =>
      resolveData({ "a-b": { url: "ws://h/ws", catalog: "a" } }, []),
    ).toThrow(DataArgError);
  });

  test("non-ws/n6k URL is rejected", () => {
    expect(() => resolveData({}, ["http://h/ws"])).toThrow(DataArgError);
    expect(() => resolveData({}, ["db=localhost:7823"])).toThrow(DataArgError);
  });

  test("--data token rides userinfo and is stripped from the URL", () => {
    expect(resolveData({}, ["nyc=ws://s%40cret@h:1/ws"])).toEqual({
      nyc: ws("ws://h:1/ws", "nyc", "s@cret"),
    });
    expect(resolveData({}, ["n6k://tok@h"])).toEqual({
      db: ws("ws://h/ws", "db", "tok"),
    });
  });

  test("user:password is rejected", () => {
    expect(() => resolveData({}, ["ws://u:p@h/ws"])).toThrow(DataArgError);
  });

  test("frontmatter credentials are rejected", () => {
    expect(() =>
      resolveData({ nyc: { url: "ws://tok@h/ws", catalog: "nyc" } }, []),
    ).toThrow(DataArgError);
  });
});
