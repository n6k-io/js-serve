import docs from "@n6k.io/ui/docs.json";

type Prop = { type: string; required: boolean; description: string };
type Doc = { description: string; file: string; props: Record<string, Prop> };

export type ComponentDoc = {
  name: string;
  kind: "component" | "control";
  description: string;
  props: Record<string, Prop>;
  usage?: string;
};

export type ComponentSummary = Pick<ComponentDoc, "name" | "kind"> & {
  summary: string;
};

function entries(
  kind: ComponentDoc["kind"],
  group: Record<string, Doc>,
): ComponentDoc[] {
  return Object.entries(group).map(([name, { description, props }]) => ({
    name,
    kind,
    description,
    props,
    ...(kind === "control" && {
      usage: `::${name}[var]{…props}, or :::${name}[var]{…props} children ::: to supply children; declares state \`var\`, read as {var}`,
    }),
  }));
}

const ALL: ComponentDoc[] = [
  ...entries("component", docs.components),
  ...entries("control", docs.controls),
];

export function searchComponents(query = ""): ComponentSummary[] {
  const q = query.toLowerCase();
  return ALL.filter(
    (d) =>
      d.name.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q),
  ).map(({ name, kind, description }) => ({
    name,
    kind,
    summary: description.split("\n", 1)[0],
  }));
}

export class UnknownComponentError extends Error {}

export function describeComponent(name: string): ComponentDoc {
  const found = ALL.find((d) => d.name === name);
  if (found) return found;
  const q = name.toLowerCase();
  const near = ALL.filter(
    (d) => d.name.toLowerCase().includes(q) || q.includes(d.name.toLowerCase()),
  ).map((d) => d.name);
  throw new UnknownComponentError(
    `no component ${name}${near.length > 0 ? `; did you mean ${near.join(", ")}` : ""}`,
  );
}
