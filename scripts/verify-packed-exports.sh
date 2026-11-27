#!/bin/sh

# Packs the package, installs the tarball into an empty ESM project and imports every
# subpath in the published `exports` map, so an export that points at a file missing
# from the tarball fails here instead of in a consumer's build.

set -eu

repository_directory="$(pwd)"
consumer_directory="$(mktemp -d -t payload-ecommerce-esm-XXXXXX)"
trap 'rm -rf "$consumer_directory"' EXIT

package_tarball="$(pnpm pack --pack-destination "$consumer_directory" | tail -n 1)"

cd "$consumer_directory"
node --input-type=module --eval \
  "import { writeFileSync } from 'node:fs'; writeFileSync('package.json', JSON.stringify({ name: 'payload-ecommerce-esm-consumer', private: true, type: 'module' }))"
npm_config_cache="$consumer_directory/npm-cache" npm install \
  --offline \
  --ignore-scripts \
  --legacy-peer-deps \
  "$package_tarball"

# The main entry point imports Payload at runtime (for its error classes). The install
# above is offline and skips peer dependencies, so the consumer borrows the repository's
# own copy, the same way a host application would provide it.
ln -s "$repository_directory/node_modules/payload" node_modules/payload

node --input-type=module --eval '
  import { existsSync } from "node:fs"
  import { readFile } from "node:fs/promises"
  import { join } from "node:path"

  const packageDirectory = "node_modules/@xtr-dev/payload-ecommerce"
  const packageJson = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"))

  const expectedSubpaths = ["."]
  const publishedSubpaths = Object.keys(packageJson.exports).sort()
  if (JSON.stringify(publishedSubpaths) !== JSON.stringify(expectedSubpaths)) {
    throw new Error(`Expected exports ${expectedSubpaths.join(", ")} but the tarball has ${publishedSubpaths.join(", ")}`)
  }

  // Every condition of every export (import, types, default) has to point at a packed file.
  for (const [subpath, conditions] of Object.entries(packageJson.exports)) {
    for (const [condition, target] of Object.entries(conditions)) {
      if (!existsSync(join(packageDirectory, target))) {
        throw new Error(`Export "${subpath}" (${condition}) points at ${target}, which is not in the tarball`)
      }
    }
  }

  // The source tree is not published, so main and types must have been rewritten to dist as well.
  for (const field of ["main", "types"]) {
    if (!existsSync(join(packageDirectory, packageJson[field]))) {
      throw new Error(`"${field}" points at ${packageJson[field]}, which is not in the tarball`)
    }
  }

  const importSpecifiers = publishedSubpaths.map((subpath) =>
    subpath === "." ? packageJson.name : `${packageJson.name}/${subpath.slice(2)}`,
  )
  await Promise.all(importSpecifiers.map((specifier) => import(specifier)))
'
