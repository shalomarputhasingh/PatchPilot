import { describe, expect, it } from "vitest";
import { applyPatch } from "@/lib/patch";

const SRC = `def calculate_discount(price, discount):\n    return price - price * discount\n\nprint(calculate_discount(100, 20))\n`;
const GOOD = `--- a/solution.py
+++ b/solution.py
@@ -1,4 +1,4 @@
 def calculate_discount(price, discount):
-    return price - price * discount
+    return price - price * discount / 100
 
 print(calculate_discount(100, 20))
`;

describe("applyPatch", () => {
  it("applies a valid diff and reports counts", () => {
    const r = applyPatch(SRC, GOOD);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.newSource).toContain("price * discount / 100");
      expect(r.added).toBe(1);
      expect(r.removed).toBe(1);
      expect(r.diff).toContain("+    return price - price * discount / 100");
    }
  });

  it("tolerates wrong hunk line numbers and fences when context is unique", () => {
    const r = applyPatch(SRC, "```diff\n" + GOOD.replace("-1,4 +1,4", "-40,4 +40,4") + "```");
    expect(r.ok).toBe(true);
  });

  it("rejects context that does not match the analyzed source", () => {
    const r = applyPatch(SRC, GOOD.replace("price * discount\n+", "price * DISCOUNT\n+"));
    expect(r).toMatchObject({ ok: false });
  });

  it("rejects multi-file patches, file creation and deletion", () => {
    expect(applyPatch(SRC, GOOD + "--- a/other.py\n+++ b/other.py\n@@ -1 +1 @@\n-a\n+b\n")).toMatchObject({ ok: false });
    expect(applyPatch(SRC, "--- /dev/null\n+++ b/new.py\n@@ -0,0 +1 @@\n+x\n")).toMatchObject({ ok: false });
    expect(applyPatch(SRC, "--- a/solution.py\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n")).toMatchObject({ ok: false });
  });

  it("rejects garbage, empty results and no-ops", () => {
    expect(applyPatch(SRC, "just replace it with return 80")).toMatchObject({ ok: false });
    expect(applyPatch("x = 1\n", "--- a/s\n+++ b/s\n@@ -1 +0,0 @@\n-x = 1\n")).toMatchObject({ ok: false });
    expect(applyPatch(SRC, "--- a/s\n+++ b/s\n@@ -1 +1 @@\n-def calculate_discount(price, discount):\n+def calculate_discount(price, discount):\n")).toMatchObject({ ok: false });
  });

  it("rejects whole-file rewrites of larger files", () => {
    const big = Array.from({ length: 20 }, (_, i) => `a${i} = ${i}`).join("\n") + "\n";
    const diff = "--- a/s\n+++ b/s\n@@ -1,20 +1,20 @@\n" + big.trim().split("\n").map((l) => `-${l}`).join("\n") + "\n" + big.trim().split("\n").map((l) => `+${l}x`).join("\n") + "\n";
    const r = applyPatch(big, diff);
    expect(r.ok).toBe(false);
  });

  it("rejects ambiguous hunks", () => {
    const src = "x = 1\nx = 1\n";
    expect(applyPatch(src, "--- a/s\n+++ b/s\n@@ -9 +9 @@\n-x = 1\n+x = 2\n")).toMatchObject({ ok: false });
  });
});
