# @n6k.io/serve

Serve a single `.mdx` page in the browser with live data from
[n6kd](https://github.com/n6k-io/n6kd) or pykit `n6k database`.

```sh
n6k-serve page.mdx                                  # no data
n6k-serve page.mdx --data ws://localhost:8080/ws    # attached as `db`
n6k-serve page.mdx --data nyc=ws://localhost:8080/ws --data sales=ws://localhost:7823/ws
n6k-serve page.mdx --port 3000                      # default 3000
```

Or in the page's frontmatter (`--data` wins for the same alias):

```yaml
---
attach:
  nyc: ws://localhost:8080/ws
---
<Metric label="Trips" query="SELECT count(*) FROM nyc.trips" />
```

The alias is the catalog name on the server: `nyc=ws://…` attaches the
server's `nyc` catalog as `nyc`. A bare URL attaches the server's `db` catalog.

Every `@n6k.io/ui` component is available in the page without an import. The
page reloads when the file is saved.
