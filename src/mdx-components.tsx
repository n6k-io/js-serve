import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import * as n6k from "@n6k.io/ui/components";

// MDX component scope. The build auto-discovers this file, so every name
// returned here is usable as a bare tag in any `.mdx` page — no import needed.
// Spread the n6k component set, then add your own components or restyle the
// markdown elements. A tag that isn't registered here (or imported in the page)
// fails when the page is rendered.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...n6k,
    h1: (props: ComponentProps<"h1">) => (
      <h1 className="pb-4 text-4xl font-black tracking-tight" {...props} />
    ),
    h2: (props: ComponentProps<"h2">) => (
      <h2 className="pb-3 text-2xl font-bold tracking-tight" {...props} />
    ),
    ...components,
  } as unknown as MDXComponents;
}
