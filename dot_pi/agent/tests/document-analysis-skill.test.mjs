import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const skillPath = resolve(new URL("../../../dot_agents/skills/document-analysis/SKILL.md", import.meta.url).pathname);
const skill = await readFile(skillPath, "utf8");

test("document-analysis skill mandates automatic full enrichment", () => {
  assert.match(skill, /Immediately call `document_analysis_enrich`.*`stage="all"`/s);
  assert.match(skill, /never wait for the user to say.*run OCR.*run vision/s);
  const enrichStep = skill.indexOf("Immediately call `document_analysis_enrich`");
  const qualityStep = skill.indexOf("Call `document_analysis_show` for `quality`");
  const normalizedStep = skill.indexOf("Call `document_analysis_show` for `normalized`");
  assert.ok(enrichStep >= 0 && enrichStep < qualityStep && qualityStep < normalizedStep);
  assert.match(skill, /VISUAL ANALYSIS IS INCOMPLETE — run serve-vlm/);
  assert.match(skill, /stop substantive analysis/);
});

test("document-analysis skill permits pihat artifact interaction but keeps preprocessing local", () => {
  assert.match(skill, /pihat.*normalized, OCR.*visual artifacts/s);
  assert.match(skill, /applies no custom output truncation/);
  assert.match(skill, /pipeline is strictly local/);
  assert.match(skill, /never use cloud processing as fallback/);
});
