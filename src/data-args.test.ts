import { describe, expect, test } from "bun:test";
import { DataArgError, resolveData } from "./data-args";

describe("resolveData", () => {
  test("bare URL attaches as db", () => {
    expect(resolveData({}, ["ws://h:7823/ws"])).toEqual({
      db: { url: "ws://h:7823/ws", token: "" },
    });
  });

  test("name=URL attaches as name", () => {
    expect(resolveData({}, ["nyc=wss://h/ws", "sales=ws://h2/ws"])).toEqual({
      nyc: { url: "wss://h/ws", token: "" },
      sales: { url: "ws://h2/ws", token: "" },
    });
  });

  test("a URL whose query contains = is still a bare URL", () => {
    expect(resolveData({}, ["ws://h/ws?a=b"])).toEqual({
      db: { url: "ws://h/ws?a=b", token: "" },
    });
  });

  test("--data overrides frontmatter for the same alias", () => {
    expect(
      resolveData({ nyc: "ws://a/ws", other: "ws://o/ws" }, ["nyc=ws://b/ws"]),
    ).toEqual({
      nyc: { url: "ws://b/ws", token: "" },
      other: { url: "ws://o/ws", token: "" },
    });
  });

  test("bad alias is rejected", () => {
    expect(() => resolveData({}, ["1x=ws://h/ws"])).toThrow(DataArgError);
    expect(() => resolveData({ "a-b": "ws://h/ws" }, [])).toThrow(DataArgError);
  });

  test("non-ws URL is rejected", () => {
    expect(() => resolveData({}, ["http://h/ws"])).toThrow(DataArgError);
    expect(() => resolveData({}, ["db=localhost:7823"])).toThrow(DataArgError);
  });

  test("--data token rides userinfo and is stripped from the URL", () => {
    expect(resolveData({}, ["nyc=ws://s%40cret@h:1/ws"])).toEqual({
      nyc: { url: "ws://h:1/ws", token: "s@cret" },
    });
    expect(resolveData({}, ["ws://tok@h/ws"])).toEqual({
      db: { url: "ws://h/ws", token: "tok" },
    });
  });

  test("user:password is rejected", () => {
    expect(() => resolveData({}, ["ws://u:p@h/ws"])).toThrow(DataArgError);
  });

  test("frontmatter credentials are rejected", () => {
    expect(() => resolveData({ nyc: "ws://tok@h/ws" }, [])).toThrow(
      DataArgError,
    );
  });
});
