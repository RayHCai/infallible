// schema/contracts.schema.json (exported from Python) -> src/generated.ts
// Run via `pnpm contracts:gen` at the repo root, which exports the schema first.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { compile } from 'json-schema-to-typescript';
import { format, resolveConfig } from 'prettier';

const schemaPath = fileURLToPath(new URL('../schema/contracts.schema.json', import.meta.url));
const outPath = fileURLToPath(new URL('../src/generated.ts', import.meta.url));

/**
 * Pydantic titles every field ("Run Id", "Kind", ...); json-schema-to-typescript
 * turns each title into its own alias (RunId1, Kind2, ...). Keep titles only on
 * the named definitions so the output is just the real contract types.
 */
function stripNestedTitles(node, isDefinitionRoot = false) {
  if (Array.isArray(node)) return node.map((n) => stripNestedTitles(n));
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'title' && !isDefinitionRoot) continue;
    if (key === '$defs' || key === 'properties') {
      // Keys of these maps are names (a field may well be called "title"), not keywords.
      const isDefs = key === '$defs';
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, stripNestedTitles(sub, isDefs)]),
      );
    } else {
      out[key] = stripNestedTitles(value);
    }
  }
  return out;
}

const schema = stripNestedTitles(JSON.parse(await readFile(schemaPath, 'utf8')), true);
const ts = await compile(schema, 'InfallibleContracts', {
  additionalProperties: false,
  bannerComment:
    '/* eslint-disable */\n// GENERATED from packages/contracts (Python). Do not edit — run `pnpm contracts:gen`.',
  declareExternallyReferenced: true,
  enableConstEnums: false,
  format: false,
  strictIndexSignatures: true,
  unreachableDefinitions: true,
});

const options = (await resolveConfig(outPath)) ?? {};
await writeFile(outPath, await format(ts, { ...options, parser: 'typescript' }));
console.log(`wrote ${outPath}`);
