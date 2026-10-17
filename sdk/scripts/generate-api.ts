import openapiTS, { astToString } from "openapi-typescript";
import ts from "typescript";

type Node = Record<string, unknown>;
const METHODS = ["get", "post", "put", "delete", "patch"];

/** Every component `roots` reach, transitively, as its `#/components/<group>/<name>` reference. */
function reachable(spec: Node, roots: unknown[]): Set<string> {
  const components = spec.components as Record<string, Record<string, unknown>>;
  const reached = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "$ref" && typeof child === "string" && !reached.has(child)) {
          reached.add(child);
          const [, , group, name] = child.split("/");
          visit(components[group as string]?.[name as string]);
        } else visit(child);
      }
    }
  };
  roots.forEach(visit);
  return reached;
}

const operations = (spec: Node) => Object.entries(spec.paths as Record<string, Node>)
  .flatMap(([path, item]) => Object.entries(item).filter(([method]) => METHODS.includes(method)).map(([method, operation]) => ({ path, method, operation: operation as Node })));

/** The public contract: operations hidden from the docs (`x-excluded`) and the components only they
 * reach stay out of the package and its declarations. */
export function publicSpec(spec: Node): Node {
  const paths: Record<string, Node> = {};
  for (const [path, item] of Object.entries(spec.paths as Record<string, Node>)) {
    const kept = Object.fromEntries(Object.entries(item).filter(([method, operation]) => !METHODS.includes(method) || !(operation as Node)["x-excluded"]));
    if (Object.keys(kept).some(method => METHODS.includes(method))) paths[path] = kept;
  }
  const reached = reachable(spec, [paths, spec.security]);
  const components = spec.components as Record<string, Record<string, unknown>>;
  const pruned = Object.fromEntries(Object.entries(components).map(([group, entries]) => [group,
    group === "securitySchemes" ? entries : Object.fromEntries(Object.entries(entries).filter(([name]) => reached.has(`#/components/${group}/${name}`)))]));
  return { ...spec, paths, components: pruned };
}

/** Response enums grow without a new API version: a value the client does not know yet still type-checks. Request enums stay exact. */
const openString = ts.factory.createIntersectionTypeNode([
  ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
  ts.factory.createTypeLiteralNode([]),
]);

export async function generate(spec: Node): Promise<string> {
  // Schemas an answer or a stream frame reaches have open enums; those only requests use stay exact.
  const answers = reachable(spec, operations(spec).flatMap(({ operation }) => [operation.responses, operation["x-websocket"]]));
  const isAnswer = (path: string | undefined) => path !== undefined
    && (path.includes("/responses/") || answers.has(/^#\/components\/schemas\/[^/]+/.exec(path)?.[0] ?? ""));
  const nodes = await openapiTS(spec as never, {
    defaultNonNullable: false,
    transform(schema, options) {
      if (!Array.isArray(schema.enum) || !schema.enum.every(value => typeof value === "string") || !isAnswer(options.path)) return undefined;
      return ts.factory.createUnionTypeNode([...schema.enum.map(value => ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(value))), openString]);
    },
  });
  const routes: Record<string, { path: string; method: string; accept?: number[] }> = {};
  for (const { path, method, operation } of operations(spec)) {
    const id = operation.operationId;
    if (typeof id !== "string") throw new Error(`${method} ${path} has no operationId`);
    // A failure status whose body is no error envelope, as `/health`'s 503, is an answer.
    const accept = Object.entries(operation.responses as Record<string, Node>)
      .filter(([status, reply]) => Number(status) >= 400 && !("$ref" in reply) && JSON.stringify(reply.content ?? null) !== JSON.stringify({ "application/json": { schema: { $ref: "#/components/schemas/Error" } } }))
      .map(([status]) => Number(status));
    routes[id] = { path, method: method.toUpperCase(), ...(accept.length ? { accept } : {}) };
  }
  return `${astToString(nodes)}\nexport const routes = ${JSON.stringify(routes, null, 2)} as const;\n`;
}

if (import.meta.main) {
  const spec = Bun.YAML.parse(await Bun.file(new URL("../../docs/api/api-reference/openapi.yaml", import.meta.url)).text()) as Node;
  const output = await generate(publicSpec(spec));
  const target = Bun.file(new URL("../src/generated/api.ts", import.meta.url));
  if (process.argv.includes("--check")) {
    if (!await target.exists() || await target.text() !== output) throw new Error("API types are stale. Run bun run api:generate.");
  } else {
    await Bun.write(target, output);
  }
}
