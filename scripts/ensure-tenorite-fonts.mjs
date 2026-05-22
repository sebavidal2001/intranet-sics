import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const fontFiles = [
  "tenorite-regular.ttf",
  "tenorite-italic.ttf",
  "tenorite-bold.ttf",
  "tenorite-bolditalic.ttf",
];

const sourceDir = path.join(root, "public", "fonts");
const targetDirs = [
  sourceDir,
  path.join(root, ".next", "standalone", "public", "fonts"),
];

function assertSourceFonts() {
  const missing = fontFiles.filter((file) => !fs.existsSync(path.join(sourceDir, file)));
  if (missing.length > 0) {
    throw new Error(
      [
        "Font Tenorite mancanti in public/fonts:",
        ...missing.map((file) => `- ${file}`),
        "",
        "Aggiungi i .ttf al repository prima del deploy.",
      ].join("\n")
    );
  }
}

function copyFonts(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const file of fontFiles) {
    const source = path.join(sourceDir, file);
    const target = path.join(targetDir, file);
    if (!fs.existsSync(target)) {
      fs.copyFileSync(source, target);
    }
  }
}

assertSourceFonts();

for (const targetDir of targetDirs) {
  const standaloneRoot = path.join(root, ".next", "standalone");
  if (targetDir.includes(`${path.sep}.next${path.sep}standalone`) && !fs.existsSync(standaloneRoot)) {
    continue;
  }
  copyFonts(targetDir);
}

console.log("Tenorite fonts ready");
