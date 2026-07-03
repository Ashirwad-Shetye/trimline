import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = resolve(root, "assets/brand/trimline-logo.svg");
const outputDir = resolve(root, "public/icons");
const sizes = [16, 32, 48, 128];

await mkdir(outputDir, { recursive: true });

await Promise.all(
  sizes.map((size) =>
    sharp(source)
      .resize(size, size)
      .png()
      .toFile(resolve(outputDir, `icon-${size}.png`))
  )
);

console.log(`Generated ${sizes.length} Trimline icons.`);
