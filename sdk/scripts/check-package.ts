// The package as an integrator receives it: packed, linted, then imported from a fresh project by
// Node and Bun, and bundled for a browser within its size budget.
import { $ } from "bun";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

/** The browser bundle of the main and protocol entries, minified and gzipped. */
const BUDGET_BYTES = 34_600;

const root = resolve(import.meta.dir, "..");
const work = mkdtempSync(join(tmpdir(), "lamarge-sdk-"));
try {
  await $`bun pm pack --destination ${work} --quiet`.cwd(root);
  const tarball = (await $`ls ${work}`.text()).split("\n").find(name => name.endsWith(".tgz"));
  if (!tarball) throw new Error("bun pm pack wrote no tarball");
  const packed = join(work, tarball);

  await $`bunx publint ${packed} --strict`.cwd(root);
  // ESM only: Node's require(esm) is not part of the promise, so CommonJS resolution is not checked.
  await $`bunx attw ${packed} --profile esm-only`.cwd(root);

  const project = join(work, "consumer");
  const installed = join(project, "node_modules", "@lamarge", "sdk");
  mkdirSync(installed, { recursive: true });
  await $`tar -xzf ${packed} -C ${installed} --strip-components=1`;
  // The optional peer of the Aster entry, as the integrator provides it, and the dependencies an
  // install brings.
  const { dependencies = {} } = await Bun.file(join(root, "package.json")).json() as { dependencies?: Record<string, string> };
  for (const name of ["viem", ...Object.keys(dependencies)]) {
    mkdirSync(join(project, "node_modules", name, ".."), { recursive: true });
    symlinkSync(join(root, "node_modules", name), join(project, "node_modules", name));
  }
  await Bun.write(join(project, "package.json"), JSON.stringify({ type: "module" }));
  const { exports } = await Bun.file(join(installed, "package.json")).json() as { exports: Record<string, unknown> };
  const entries = Object.keys(exports).filter(key => key !== "./package.json").map(key => join("@lamarge/sdk", key));
  await Bun.write(join(project, "imports.js"), `${entries.map((entry, index) => `import * as e${index} from "${entry}";`).join("\n")}
  for (const entry of [${entries.map((_, index) => `e${index}`).join(", ")}]) if (Object.keys(entry).length === 0) throw new Error("empty entry");
  const { createClient } = e${entries.indexOf("@lamarge/sdk")};
  createClient({ apiUrl: "https://api.lamarge.trade" });
  `);
  await $`node imports.js`.cwd(project);
  await $`bun imports.js`.cwd(project);

  await Bun.write(join(project, "browser.js"), `export * from "@lamarge/sdk";\nexport * as protocol from "@lamarge/sdk/protocol";\n`);
  const bundle = await Bun.build({ entrypoints: [join(project, "browser.js")], target: "browser", minify: true });
  if (!bundle.success) throw new AggregateError(bundle.logs, "The browser bundle failed");
  const size = gzipSync(new Uint8Array(await (bundle.outputs[0] as Blob).arrayBuffer())).byteLength;
  if (size > BUDGET_BYTES) throw new Error(`The browser bundle is ${size} bytes gzipped, over its ${BUDGET_BYTES}-byte budget`);
  console.log(`${tarball}: publint, attw, Node, Bun and browser imports pass; browser bundle ${size} bytes gzipped (budget ${BUDGET_BYTES})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
