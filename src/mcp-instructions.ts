export const INSTRUCTIONS = `n6k-serve renders MDX pages in the browser with live data.

Pages
- set_page takes an absolute .mdx path or inline mdx and returns the page URL, or the build error.
- Every @n6k.io/ui component and control is in scope without imports. Find them with search_components and read props with describe_component.

Data
- set_data(alias, url, token) attaches the gateway's catalog named \`alias\`. Queries run in DuckDB (wasm) in the browser; reference tables as \`alias.table\`.
- Components read data via props such as \`data\` (a relation), \`value\` (a measure expression, e.g. \`sum(amount)\`) or \`query\` (full SQL).
- set_data and remove_data rebuild and reload every page.

Controls
- Leaf form declares state and renders the control:
  ::Slider[sims]{label="Simulations" min=1000 max=500000 default=100000}
  ::Select[category]{label="Category" options="Hardware,Software,Services" empty="All"}
- Container form supplies its own markup:
  :::Select[month]{default="2020-09"}
  <SelectTrigger><SelectValue /></SelectTrigger>
  <SelectContent><SelectItem value="2020-09">Sep 2020</SelectItem></SelectContent>
  :::
- The bracketed name is a variable usable in expressions, e.g. filters={{ category }} or query={\`SELECT … LIMIT \${sims}\`}.
- Attributes are strings coerced to numbers/booleans; \`options\` and \`default\` split on commas; an option "value:label" sets a separate label.`;
