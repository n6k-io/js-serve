import type { ComponentProps } from "react";
import type { MDXComponents } from "mdx/types";
import * as n6k from "@n6k.io/ui/components";
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@n6k.io/ui/components/ui/select";

// Passed to the build as `mdxComponents`. A tag that is neither
// here nor imported by the page still builds and fails at render.
// `Controls` is the name @n6k.io/build's remark-controls emits for `::X[…]`.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...n6k,
    Controls: n6k.controls,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    h1: (props: ComponentProps<"h1">) => (
      <h1 className="pb-4 text-4xl font-black tracking-tight" {...props} />
    ),
    h2: (props: ComponentProps<"h2">) => (
      <h2 className="pb-3 text-2xl font-bold tracking-tight" {...props} />
    ),
    ...components,
  } as unknown as MDXComponents;
}
