import { expect, test } from "bun:test";
import { PagesSite } from "./pages-site";
import type { PagesConfig } from "./pages";

const gateway = { url: "ws://127.0.0.1:1/ws", token: "t", catalogs: [] };

test("removed pages notify so a re-added key is rebuilt", () => {
  const changed: string[] = [];
  const site = new PagesSite((key) => changed.push(key));
  const with_ = (file: string): PagesConfig => ({
    app: { gateway, pages: { a: file } },
  });
  site.update(with_("/one.mdx"));
  site.update({ app: { gateway, pages: {} } });
  expect(changed).toEqual(["app/a"]);
  site.update(with_("/two.mdx"));
  expect(site.page("app/a")?.file).toBe("/two.mdx");
});
