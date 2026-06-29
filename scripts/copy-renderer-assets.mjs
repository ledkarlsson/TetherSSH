import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const rendererSource = path.join(root, "src", "renderer");
const rendererOut = path.join(root, "dist", "renderer");

await mkdir(rendererOut, { recursive: true });

await Promise.all([
  copyFile(path.join(rendererSource, "index.html"), path.join(rendererOut, "index.html")),
  copyFile(path.join(rendererSource, "styles.css"), path.join(rendererOut, "styles.css"))
]);
