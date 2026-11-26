import assert from "node:assert/strict";
import { test } from "node:test";
import { zoomScrollOffset } from "./image-viewport-anchor.ts";

test("中央に収まる画像を拡大するとき、ポインターの下の位置を保つ", () => {
  assert.equal(
    zoomScrollOffset({
      boxSize: 500,
      extent: 400,
      padding: 12,
      currentScale: 1,
      nextScale: 2,
      scroll: 0,
      point: 162,
    }),
    50,
  );
});

test("スクロール中の拡大・縮小で、余白を含めてポインターの下の位置を保つ", () => {
  const position = {
    boxSize: 500,
    extent: 800,
    padding: 12,
    currentScale: 1,
    scroll: 80,
    point: 162,
  };
  assert.equal(zoomScrollOffset({ ...position, nextScale: 1.5 }), 195);
  assert.equal(zoomScrollOffset({ ...position, nextScale: 0.75 }), 22.5);
});

test("画像が表示範囲に収まる倍率へ縮小すると、負のスクロール位置にならない", () => {
  assert.equal(
    zoomScrollOffset({
      boxSize: 500,
      extent: 800,
      padding: 12,
      currentScale: 1,
      nextScale: 0.5,
      scroll: 30,
      point: 200,
    }),
    0,
  );
});

test("ボタンで等倍にするとき、表示範囲の中心にあった画像上の位置を保つ", () => {
  assert.equal(
    zoomScrollOffset({
      boxSize: 500,
      extent: 800,
      padding: 12,
      currentScale: 0.5,
      nextScale: 1,
      scroll: 0,
      point: 262,
    }),
    150,
  );
});

test("Git の画像差分では、共通のキャンバス寸法を基準に拡大位置を保つ", () => {
  assert.equal(
    zoomScrollOffset({
      boxSize: 500,
      extent: 1000,
      padding: 12,
      currentScale: 0.4,
      nextScale: 0.8,
      scroll: 0,
      point: 312,
    }),
    200,
  );
});
