// Self-host Monaco (no third-party CDN at runtime): copies min/vs from the npm package into public/monaco.
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs";
const src = "node_modules/monaco-editor/min/vs";
if (!existsSync(src)) {
  console.error("monaco-editor is not installed; run npm install");
  process.exit(1);
}
rmSync("public/monaco", { recursive: true, force: true });
mkdirSync("public/monaco", { recursive: true });
cpSync(src, "public/monaco/vs", { recursive: true });
