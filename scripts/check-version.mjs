import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const manifestJson = JSON.parse(readFileSync(resolve(root, "public/manifest.json"), "utf8"));

if (packageJson.version !== manifestJson.version) {
  console.error(`Version mismatch: package.json is ${packageJson.version}, public/manifest.json is ${manifestJson.version}.`);
  process.exit(1);
}
