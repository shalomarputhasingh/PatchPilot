"use client";

import dynamic from "next/dynamic";
import { loader, type BeforeMount } from "@monaco-editor/react";

// Serve Monaco from our own origin (copied to /public/monaco by scripts/copy-monaco.mjs).
loader.config({ paths: { vs: "/monaco/vs" } });

const Editor = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), { ssr: false, loading: () => <EditorSkeleton /> });
const DiffEditor = dynamic(() => import("@monaco-editor/react").then((m) => m.DiffEditor), { ssr: false, loading: () => <EditorSkeleton /> });

export const THEME = "patchpilot";
export const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#0b0d0f",
      "editorGutter.background": "#0b0d0f",
      "editor.lineHighlightBackground": "#14181d",
      "editorLineNumber.foreground": "#4a5561",
      "editor.selectionBackground": "#3dff8b33",
      "diffEditor.insertedTextBackground": "#3dff8b22",
      "diffEditor.removedTextBackground": "#ff5c5c22",
    },
  });
};

function EditorSkeleton() {
  return <div className="h-full w-full animate-pulse bg-bg" aria-label="Loading editor" />;
}

export interface EditorPrefs {
  fontSize: number;
  wordWrap: boolean;
}

const base = (p: EditorPrefs) => ({
  fontFamily: "ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
  fontSize: p.fontSize,
  minimap: { enabled: false },
  lineNumbers: "on" as const,
  scrollBeyondLastLine: false,
  wordWrap: p.wordWrap ? ("on" as const) : ("off" as const),
  renderLineHighlight: "line" as const,
  padding: { top: 8, bottom: 8 },
  automaticLayout: true,
  tabSize: 4,
});

export function CodeEditor({ value, onChange, readOnly, prefs, label }: { value: string; onChange?: (v: string) => void; readOnly?: boolean; prefs: EditorPrefs; label: string }) {
  return (
    <div className="h-full w-full" role="group" aria-label={label}>
      <Editor
        language="python"
        theme={THEME}
        beforeMount={defineTheme}
        value={value}
        onChange={(v) => onChange?.(v ?? "")}
        options={{ ...base(prefs), readOnly: !!readOnly, domReadOnly: !!readOnly }}
      />
    </div>
  );
}

export function CodeDiff({ original, modified, prefs, sideBySide }: { original: string; modified: string; prefs: EditorPrefs; sideBySide: boolean }) {
  return (
    <div className="h-full w-full" role="group" aria-label="Original and repaired code diff">
      <DiffEditor
        language="python"
        theme={THEME}
        beforeMount={defineTheme}
        original={original}
        modified={modified}
        options={{ ...base(prefs), readOnly: true, originalEditable: false, renderSideBySide: sideBySide, enableSplitViewResizing: true, renderOverviewRuler: false }}
      />
    </div>
  );
}
