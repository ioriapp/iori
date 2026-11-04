import { execFileSync } from "node:child_process";
import path from "node:path";
import { writeFile } from "node:fs/promises";
import { adb } from "./remote.mjs";
import { waitFor } from "../ui.mjs";

// Read pixels in memory, retain only our CLI's notification, and press its
// measured title. Other apps' notification text is never emitted or saved.
export async function clickAndroidCliNotification(packageName, screenshot) {
  const localTool = path.resolve(".local/tools/ocr");
  const executable =
    process.env.IORI_VERIFICATION_TESSERACT ??
    path.join(localTool, "usr/bin/tesseract");
  const env = {
    ...process.env,
    LD_LIBRARY_PATH:
      path.join(localTool, "usr/lib/x86_64-linux-gnu") +
      ":" +
      (process.env.LD_LIBRARY_PATH ?? ""),
    TESSDATA_PREFIX:
      process.env.TESSDATA_PREFIX ??
      path.join(localTool, "usr/share/tesseract-ocr/5/tessdata"),
  };
  adb(["shell", "cmd", "statusbar", "expand-notifications"]);
  let previous;
  const target = await waitFor(() => {
    const png = adb(["exec-out", "screencap", "-p"], { encoding: null });
    const rows = execFileSync(
      executable,
      ["stdin", "stdout", "-l", "eng", "tsv"],
      { input: png, env, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] },
    )
      .split(/\r?\n/u)
      .slice(1)
      .map((line) => line.split("\t"));
    const title = rows.find((row) => /^Codex[.,]?$/u.test(row[11] ?? ""));
    if (!title) return undefined;
    const position = title.slice(6, 10).join(",");
    if (position !== previous) {
      previous = position;
      return undefined;
    }
    return {
      png,
      left: Number(title[6]),
      top: Number(title[7]),
      width: Number(title[8]),
      height: Number(title[9]),
    };
  });
  const cropped = execFileSync(
    "python3",
    [
      "-c",
      `from PIL import Image
import io,sys
im=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGB')
x=max(1,int(sys.argv[1])-12); y=int(sys.argv[2])+int(sys.argv[3])//2
base=im.getpixel((x,y))
def differs(row):
 return max(abs(a-b) for a,b in zip(base,im.getpixel((x,row))))>20
upper=y
while upper>2 and not all(differs(v) for v in range(upper-2,upper+1)): upper-=1
lower=y
while lower<im.height-3 and not all(differs(v) for v in range(lower,lower+3)): lower+=1
im.crop((0,upper,im.width,lower+1)).save(sys.stdout.buffer,format='PNG')`,
      String(target.left),
      String(target.top),
      String(target.height),
    ],
    { input: target.png },
  );
  await writeFile(screenshot, cropped);
  adb([
    "shell",
    "input",
    "tap",
    String(Math.round(target.left + target.width)),
    String(Math.round(target.top + target.height * 1.8)),
  ]);
  await waitFor(
    () => adb(["shell", "dumpsys", "activity", "activities"]),
    (value) =>
      value
        .split(/\r?\n/u)
        .some(
          (line) =>
            /mResumedActivity|topResumedActivity/u.test(line) &&
            line.includes(packageName),
        ),
  );
}
