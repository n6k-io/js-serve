# @n6k.io/serve

Serve `.mdx` pages in the browser with live data from
[n6kd](https://github.com/n6k-io/n6kd) or pykit `n6k database`.

```sh
n6k-serve page page.mdx                                # no data
n6k-serve page page.mdx --data n6k://localhost:8080    # attached as `db`
n6k-serve page page.mdx --data nyc=n6k://localhost:8080 --data sales=n6k://localhost:7823
n6k-serve page page.mdx --data nyc:trips=n6k://localhost:8080   # server catalog `trips` as `nyc`
n6k-serve page page.mdx --data nyc=n6k://<token>@localhost:8080 # token sent to the server
n6k-serve page page.mdx --port 3000                    # default 3000
```

`n6k://host[:port][/prefix][?query]` connects to
`ws://host[:port][/prefix]/ws[?query]`; `n6ks://` uses `wss://`. A `ws://` or
`wss://` URL is used as written.

```sh

```

A token in `--data` is removed from the URL and sent as the connection token.
Frontmatter `attach:` URLs may not carry one.

```sh
n6k-serve page page.mdx --data nyc=n6k://localhost:8080 --oidc-login
```

`--oidc-login` signs in to every source without a token, using the server's
`/.well-known/oauth-protected-resource` and the OAuth device flow (as
`n6kd auth login`). The refresh token stays in n6k-serve; the page fetches a
fresh access token on each connect. A source whose server does not offer
sign-in is an error. The sign-in is saved in the OS credential store and reused
on the next start.

With `--oidc-login`, n6k-serve prints a URL with a per-launch `?secret=`. Open
that URL: it sets a cookie, and the page and the token route refuse requests
without it. After a restart, open the newly printed URL.

```sh
n6k-serve logout                      # list saved sign-ins
n6k-serve logout n6k://localhost:8080 # sign out of the sign-in that server uses
n6k-serve logout --all                # sign out of all
```

Or in the page's frontmatter (`--data` wins for the same alias):

```yaml
---
attach:
  nyc: n6k://localhost:8080
  rides: { path: n6k://localhost:8080, catalog: trips }
---
<Metric label="Trips" query="SELECT count(*) FROM nyc.trips" />
```

The server catalog defaults to the alias: `nyc=n6k://…` attaches the server's
`nyc` catalog as `nyc`, and `nyc:trips=n6k://…` (or `catalog: trips`) attaches
`trips` as `nyc`. A bare URL attaches the server's `db` catalog. Entries whose
path is not a URL are app paths and are ignored by n6k-serve.

Every `@n6k.io/ui` component and control is available in the page without an
import. Controls are declared with directives, e.g.
`::Slider[n]{label="N" min=1 max=10 default=5}`, and read as `{n}`. The page
reloads when the file is saved.

## MCP

```sh
claude mcp add n6k-serve -- bunx @n6k.io/serve mcp
claude mcp add n6k-serve -- bunx @n6k.io/serve mcp --port 4000
```

`mcp` serves pages at `/<page>/` and is driven over stdio by one MCP client.
It takes only `--port`, `--host` and `--origin`. Data
sources and pages are set with MCP tools (see `tools/list`); frontmatter
`attach:` is ignored. The process exits when stdin closes.
