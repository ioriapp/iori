import {
  MAX_FRAME_BYTES,
  type CliDefinitionAttachment,
  type CliDefinitionReason,
} from "@iori/protocol";
import { connection } from "./connection.ts";

/** The frame size bounds each transfer, not the file's size or count. */
export async function uploadDefinitionFiles(
  host: string,
  files: File[],
  remember: (id: string) => void,
): Promise<CliDefinitionAttachment[]> {
  const attached: CliDefinitionAttachment[] = [];
  const chunkBytes = Math.floor(MAX_FRAME_BYTES / 2 / 3) * 3;
  for (const file of files) {
    const uploadId = crypto.randomUUID();
    remember(uploadId);
    for (
      let offset = 0;
      offset < file.size || offset === 0;
      offset += chunkBytes
    ) {
      const blob = file.slice(offset, offset + chunkBytes);
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onload = () =>
          resolve((reader.result as string).split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });
      const result = await connection.requestHost(
        host,
        "cli.definition.file.write",
        { uploadId, data, first: offset === 0 },
      );
      if (!result?.ok) throw new Error(result?.error.code ?? "internal_error");
    }
    attached.push({ name: file.name, uploadId });
  }
  return attached;
}

/** Ask the WebView's own image decoder; no SVG is inserted as markup. */
export async function definitionImageReadable(file: File): Promise<boolean> {
  if (!/\.(svg|png)$/iu.test(file.name)) return false;
  const url = URL.createObjectURL(
    new Blob([file], {
      type: /\.svg$/iu.test(file.name) ? "image/svg+xml" : "image/png",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Validate chosen icons with the same decoder in uploads and JSON editors. */
export async function definitionImageReason(
  text: string,
  files: File[] = [],
): Promise<CliDefinitionReason | undefined> {
  let value: { icon?: { light?: unknown; dark?: unknown } } | undefined;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  for (const theme of ["light", "dark"] as const) {
    const name = value?.icon?.[theme];
    const image = files.find((file) => file.name === name);
    if (image && !(await definitionImageReadable(image)))
      return { kind: "values", field: `icon.${theme}`, values: ["SVG", "PNG"] };
  }
}
