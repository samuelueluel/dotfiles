import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillPathCandidates = [
  resolve(new URL("../../../dot_agents/skills/document-analysis/SKILL.md", import.meta.url).pathname),
  resolve(new URL("../../../.agents/skills/document-analysis/SKILL.md", import.meta.url).pathname),
];
let skillPath;
for (const candidate of skillPathCandidates) {
  try {
    await access(candidate);
    skillPath = candidate;
    break;
  } catch {}
}
assert.ok(skillPath, "document-analysis skill not found in source or deployed layout");
const skill = await readFile(skillPath, "utf8");

test("document-analysis skill mandates automatic full enrichment", () => {
  assert.match(skill, /Immediately call `document_analysis_enrich`.*`stage="all"`/s);
  assert.match(skill, /never wait for the user to ask for OCR or vision/);
  const enrichStep = skill.indexOf("Immediately call `document_analysis_enrich`");
  const qualityStep = skill.indexOf("Call `document_analysis_show` with `artifact=\"quality\"`");
  const normalizedStep = skill.indexOf("Call `document_analysis_show` with `artifact=\"normalized\"`");
  assert.ok(enrichStep >= 0 && enrichStep < qualityStep && qualityStep < normalizedStep);
  assert.match(skill, /VISUAL ANALYSIS IS INCOMPLETE — run serve-vlm/);
  assert.match(skill, /stop substantive analysis/);
});

test("document-analysis skill permits pihat artifact interaction but keeps preprocessing local", () => {
  assert.match(skill, /pihat.*normalized, OCR.*visual artifacts/s);
  assert.match(skill, /The cloud model reads the returned output, but never does the preprocessing itself/);
  assert.match(skill, /pipeline is strictly local/);
  assert.match(skill, /never fall back to cloud tools/);
});

test("document-analysis skill distinguishes native and formula OCR routing", () => {
  assert.match(skill, /Image-only PDFs send every page through MinerU; mixed PDFs only send weak pages/);
  assert.match(skill, /When MinerU runs, its formula detector can turn equations into LaTeX in the OCR output/);
  assert.match(skill, /`ocr: not_needed`/);
  assert.match(skill, /Do not force full OCR just to get LaTeX unless the native text has an actual defect/);
});
