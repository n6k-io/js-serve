import { describe, expect, test } from "bun:test";
import { DataArgError, resolveData } from "./data-args";

describe("resolveData", () => {
  test("bare URL attaches as db", () => {
    expect(resolveData({}, ["ws://h:7823/ws"])).toEqual({
      db: "ws://h:7823/ws",
    });
  });

  test("name=URL attaches as name", () => {
    expect(resolveData({}, ["nyc=wss://h/ws", "sales=ws://h2/ws"])).toEqual({
      nyc: "wss://h/ws",
      sales: "ws://h2/ws",
    });
  });

  test("a URL whose query contains = is still a bare URL", () => {
    expect(resolveData({}, ["ws://h/ws?a=b"])).toEqual({
      db: "ws://h/ws?a=b",
    });
  });

  test("--data overrides frontmatter for the same alias", () => {
    expect(
      resolveData({ nyc: "ws://a/ws", other: "ws://o/ws" }, ["nyc=ws://b/ws"]),
    ).toEqual({ nyc: "ws://b/ws", other: "ws://o/ws" });
  });

  test("bad alias is rejected", () => {
    expect(() => resolveData({}, ["1x=ws://h/ws"])).toThrow(DataArgError);
    expect(() => resolveData({ "a-b": "ws://h/ws" }, [])).toThrow(DataArgError);
  });

  test("non-ws URL is rejected", () => {
    expect(() => resolveData({}, ["http://h/ws"])).toThrow(DataArgError);
    expect(() => resolveData({}, ["db=localhost:7823"])).toThrow(DataArgError);
  });
});
