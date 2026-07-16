import assert from "node:assert/strict";
import test from "node:test";
import { buildUgcReplicationMessage } from "../src/services/libtvClient.js";

test("builds LibTV instructions from the approved script instead of a hardcoded product demo", () => {
  const prompt = buildUgcReplicationMessage({
    referenceUrl: "https://example.com/reference.mp4",
    productUrl: "https://example.com/product.png",
    characterUrl: "https://example.com/character.png",
    blueprint: {
      visualStyle: { framing: "handheld selfie" },
      editingStyle: { pace: "fast" },
      sceneRhythm: [{ beat: "hook", seconds: 3 }]
    },
    script: {
      selectedHookId: "hook-2",
      hooks: [
        { id: "hook-1", text: "The old hook" },
        { id: "hook-2", text: "My skin finally stopped feeling tight." },
        { id: "hook-3", text: "A third hook" }
      ],
      scenes: [
        {
          visualAction: "Creator shows dry skin in natural window light.",
          audioSpokenWord: "My skin finally stopped feeling tight.",
          startSeconds: 0,
          endSeconds: 4
        },
        {
          visualAction: "Creator applies one drop and shows the texture close to camera.",
          audioSpokenWord: "One drop feels light and calm.",
          startSeconds: 4,
          endSeconds: 10
        }
      ]
    },
    campaignBrief: {
      brand: "GlowSkin",
      product: "Barrier Serum",
      approvedClaims: ["helps skin feel hydrated"],
      restrictedClaims: ["cures eczema"]
    }
  });

  assert.match(prompt, /My skin finally stopped feeling tight/);
  assert.match(prompt, /Creator applies one drop/);
  assert.match(prompt, /helps skin feel hydrated/);
  assert.match(prompt, /cures eczema/);
  assert.match(prompt, /Kling O3/);
  assert.match(prompt, /Do NOT add subtitles/);
  assert.doesNotMatch(prompt, /phone pairing/i);
  assert.doesNotMatch(prompt, /product case/i);
});

test("keeps a generic scene structure for legacy projects without an approved script", () => {
  const prompt = buildUgcReplicationMessage({
    referenceUrl: "reference",
    productUrl: "product",
    characterUrl: "character",
    blueprint: { scriptStyle: { tone: "casual" } }
  });

  assert.match(prompt, /derive the scene order from the reference blueprint/i);
  assert.doesNotMatch(prompt, /phone pairing/i);
});
