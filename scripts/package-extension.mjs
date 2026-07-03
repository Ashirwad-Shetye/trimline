import { mkdir, rm, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const version = packageJson.version;
const releasesDir = resolve(root, "releases");
const zipPath = resolve(releasesDir, `trimline-v${version}.zip`);

await mkdir(releasesDir, { recursive: true });
await rm(zipPath, { force: true });

await run("zip", ["-r", zipPath, "."], { cwd: resolve(root, "dist") });

console.log(`Created ${zipPath}`);

function run(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit" });
    child.on("error", (error) => {
      if (error.code === "ENOENT") {
        reject(new Error("The `zip` command is required to package the extension."));
        return;
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}
