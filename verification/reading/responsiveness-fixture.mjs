import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// A build/dependency tree comparable to the native reproduction. Git ignores
// it, but Files must watch it: users can open generated and ignored files.
export async function prepareReadingTree(root) {
  await writeFile(join(root, ".gitignore"), "/generated/\n");
  await mkdir(join(root, "inside"));
  await writeFile(join(root, "inside", "small.txt"), "nested reading marker\n");
  await mkdir(join(root, "generated"));
  for (let directory = 0; directory < 200; directory++) {
    const folder = join(root, "generated", String(directory));
    await mkdir(folder);
    await Promise.all(
      Array.from({ length: 1000 }, (_, file) =>
        writeFile(join(folder, `${file}.txt`), "generated\n"),
      ),
    );
  }
}
