"""Locate the recorded cursor in every source frame or exported video frame.

Editing-only dependency: pip install opencv-python-headless==4.12.0.88
The cursor template is the original capture SVG rendered with its alpha channel.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


def locate(image, template, mask, previous=None):
    height, width = template.shape[:2]
    if previous is not None:
        x, y = previous
        left, top = max(0, x - 80), max(0, y - 80)
        region = image[top : y + height + 80, left : x + width + 80]
        score, _, point, _ = cv2.minMaxLoc(
            cv2.matchTemplate(region, template, cv2.TM_SQDIFF_NORMED, mask=mask)
        )
        if score < 0.01:
            return score, (point[0] + left, point[1] + top)
    score, _, point, _ = cv2.minMaxLoc(
        cv2.matchTemplate(image, template, cv2.TM_SQDIFF_NORMED, mask=mask)
    )
    return score, point


def scan_capture(capture, template, mask):
    scenes = []
    for scene in capture["scenes"]:
        frames = []
        previous = None
        for index, frame in enumerate(scene["frames"]):
            score, point = locate(cv2.imread(frame["path"]), template, mask, previous)
            found = score < 0.04
            previous = point if found else None
            frames.append({"index": index, "point": point if found else None,
                           "score": score, "time": frame["time"], "path": frame["path"]})
        scenes.append({"name": scene["name"], "frames": frames})
        print(scene["name"], len(frames), "frames; cursor in",
              sum(f["point"] is not None for f in frames), flush=True)
    return {"method": "Original alpha-masked cursor template in every frame",
            "threshold": 0.04, "scenes": scenes}


def scan_video(path, template, mask, candidates, threshold, screen_top=160):
    video = cv2.VideoCapture(str(path), cv2.CAP_FFMPEG, [cv2.CAP_PROP_N_THREADS, 1])
    width = int(video.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(video.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale = width / 3840
    if scale != 1:
        template = cv2.resize(template, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
        mask = cv2.resize(mask, (template.shape[1], template.shape[0]), interpolation=cv2.INTER_NEAREST)
    points = sorted({(round(x * scale), round((y + screen_top) * scale)) for x, y in candidates})
    frames = []
    while True:
        ok, image = video.read()
        if not ok:
            break
        best = (float("inf"), None)
        for x, y in points:
            margin = max(2, round(4 * scale))
            left, top = max(0, x - margin), max(0, y - margin)
            region = image[top : y + template.shape[0] + margin,
                           left : x + template.shape[1] + margin]
            score, _, point, _ = cv2.minMaxLoc(
                cv2.matchTemplate(region, template, cv2.TM_SQDIFF_NORMED, mask=mask)
            )
            if score < best[0]:
                best = (score, (point[0] + left, point[1] + top))
        frames.append({"index": len(frames), "score": best[0],
                       "point": best[1] if best[0] < threshold else None})
        if len(frames) % 300 == 0:
            print(path.name, len(frames), "frames examined", flush=True)
    video.release()
    return {"path": str(path), "width": width, "height": height,
            "frames": frames, "threshold": threshold,
            "residualFrames": [f["index"] for f in frames if f["point"] is not None]}


def audit_edit(edit, source):
    uncovered = []
    examined = 0

    def covered(point, patches, elapsed):
        if point is None:
            return True
        for patch in patches:
            if "until" in patch and elapsed >= patch["until"]:
                continue
            if "after" in patch and elapsed < patch["after"]:
                continue
            x, y = patch["at"]
            width, height = edit["patches"][patch["name"]]["sourceRect"][2:]
            if x <= point[0] and y <= point[1] and x + width >= point[0] + 50 and y + height >= point[1] + 50:
                return True
        return False

    for clip in edit["clips"]:
        if "source" not in clip:
            continue
        scene = next(s for s in source["scenes"] if s["name"] == clip["source"])
        for frame in scene["frames"]:
            elapsed = (frame["time"] - scene["frames"][0]["time"]) / 1000 - clip["trim"]
            if elapsed < 0 or elapsed > clip["duration"] * clip.get("rate", 1):
                continue
            examined += 1
            if not covered(frame["point"], clip["patches"], elapsed):
                uncovered.append({"clip": clip["id"], "sourceFrame": frame["index"], "point": frame["point"]})
    for switch in edit["interactions"]:
        for side in ["before", "after"]:
            image = switch[side]
            scene, index = image["frame"]
            frame = source["scenes"][scene]["frames"][index]
            examined += 1
            if not covered(frame["point"], image["patches"], 0):
                uncovered.append({"switch": switch["id"], "side": side, "point": frame["point"]})
    contaminated = []
    for name, patch in edit["patches"].items():
        scene, index = patch["frame"]
        point = source["scenes"][scene]["frames"][index]["point"]
        if point is None:
            continue
        x, y, width, height = patch["sourceRect"]
        if x < point[0] + 50 and y < point[1] + 50 and x + width > point[0] and y + height > point[1]:
            contaminated.append(name)
    return {"sourceFramesExamined": examined, "uncovered": uncovered,
            "patchesContainingOriginalCursor": contaminated,
            "safe": not uncovered and not contaminated}


def main():
    cv2.setNumThreads(1)
    parser = argparse.ArgumentParser()
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--capture", type=Path)
    parser.add_argument("--video", type=Path)
    parser.add_argument("--positions", type=Path)
    parser.add_argument("--edit", type=Path)
    parser.add_argument("--prepared", type=Path)
    parser.add_argument("--screen-top", type=int, default=160)
    parser.add_argument("--threshold", type=float, default=0.04)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    rgba = cv2.imread(str(args.template), cv2.IMREAD_UNCHANGED)
    template = rgba[:, :, :3]
    mask = (rgba[:, :, 3] > 160).astype(np.uint8) * 255
    if args.capture:
        result = scan_capture(json.loads(args.capture.read_text()), template, mask)
    elif args.edit:
        result = audit_edit(json.loads(args.edit.read_text()), json.loads(args.positions.read_text()))
        print("Mask coverage:", result, flush=True)
    else:
        source = json.loads(args.positions.read_text())
        candidates = {tuple(f["point"]) for s in source["scenes"] for f in s["frames"] if f["point"]}
        if args.prepared:
            props = json.loads((args.prepared / "props.json").read_text())
            names = [c["src"] for c in props["clips"] if c.get("src")]
            names += [s[side]["src"] for s in props["switches"] for side in ["before", "after"]]
            results = []
            for name in names:
                item = scan_video(args.prepared / "public" / name, template, mask, candidates, args.threshold, 0)
                results.append(item)
                print(name, len(item["frames"]), "frames; residual cursor in", len(item["residualFrames"]), flush=True)
            result = {"results": results, "safe": all(not r["residualFrames"] for r in results)}
        else:
            result = scan_video(args.video, template, mask, candidates, args.threshold, args.screen_top)
            print(result["width"], result["height"], len(result["frames"]),
                  "frames; residual cursor in", len(result["residualFrames"]), flush=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if not result.get("safe", not result.get("residualFrames", [])):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
