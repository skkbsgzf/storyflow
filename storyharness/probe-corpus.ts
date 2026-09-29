import type { CorpusLayout } from "./src/config.js";
import path from "node:path";
export const CORPUS_LAYOUT: CorpusLayout = {
  projectsDir: "projects",
  receiptsDir: path.join("内部", "收据"),
  quarantineDir: path.join("内部", "storyharness", "backup"),
  sessionsDir: path.join("内部", "sessions"),
  lintTool: path.join("tools", "flow-lint.py"),
  lintCommand: "python",
};
