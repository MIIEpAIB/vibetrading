import Editor from "@monaco-editor/react";

interface StrategyCodeEditorProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
}

function monacoLanguage(language: string) {
  if (language === "pine") return "plaintext";
  if (language === "c++") return "cpp";
  return language;
}

export function StrategyCodeEditor({ value, language, onChange }: StrategyCodeEditorProps) {
  return (
    <div className="min-h-0 flex-1 overflow-hidden bg-[#1e1e1e]">
      <Editor
        height="100%"
        language={monacoLanguage(language)}
        theme="vs-dark"
        value={value}
        loading={<div className="p-4 font-mono text-sm text-zinc-300">Loading editor...</div>}
        options={{
          automaticLayout: true,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 13,
          minimap: { enabled: false },
          renderLineHighlight: "all",
          scrollBeyondLastLine: false,
          tabSize: 4,
          wordWrap: "on",
        }}
        onChange={(nextValue) => onChange(nextValue ?? "")}
      />
    </div>
  );
}
