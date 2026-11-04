import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = path.join(import.meta.dirname, "sources/linux-runtime");
const sources = {
  "type2-runtime.txt":
    "https://raw.githubusercontent.com/AppImage/type2-runtime/dd6cebedcbddde9c82f89b011e8e1d40b6e43868/LICENSE",
  "musl.txt": "https://raw.githubusercontent.com/ifduyue/musl/v1.2.5/COPYRIGHT",
  "libfuse.txt":
    "https://raw.githubusercontent.com/libfuse/libfuse/fuse-3.15.0/LGPL2.txt",
  "squashfuse.txt":
    "https://raw.githubusercontent.com/vasi/squashfuse/0.5.2/LICENSE",
  "zstd.txt": "https://raw.githubusercontent.com/facebook/zstd/v1.5.6/LICENSE",
  "zlib.txt": "https://raw.githubusercontent.com/madler/zlib/v1.3.1/LICENSE",
  "mimalloc.txt":
    "https://raw.githubusercontent.com/microsoft/mimalloc/v2.1.7/LICENSE",
};
await mkdir(directory, { recursive: true });
for (const [name, url] of Object.entries(sources)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  await writeFile(path.join(directory, name), await response.text());
  console.log(`${name}: ${url}`);
}
