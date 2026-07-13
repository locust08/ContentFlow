import { generateJson } from "./openaiClient.js";

export async function generateImagePrompts({ styleAnalysis, scriptPlan }) {
  const ai = await generateJson({
    schemaName: "image_prompts",
    system: [
      "You create production-ready image generation prompts for a reference-replication video system.",
      "Prompts must follow the reference blueprint's visual style, subject placement, color, lighting, framing, and caption-safe areas.",
      "Keep images original; do not copy a real creator, logo, exact character, or exact frame.",
      "Output only valid JSON."
    ].join(" "),
    user: JSON.stringify({
      styleAnalysis,
      scriptPlan,
      request: [
        "For each scene, create a 9:16 image prompt suitable as a first frame, background, or image-to-video source.",
        "Each prompt must include: referenceStyleMatched, subject, environment, composition, lighting, camera/framing, motion readiness, caption-safe negative space, and avoid list.",
        "Use styleAnalysis.generatorGuidance.imagePromptRules and visualStyle."
      ].join(" ")
    }, null, 2)
  });

  if (ai) return ai;

  return {
    source: "fallback",
    prompts: scriptPlan.scenes.map((scene) => ({
      scene: scene.scene,
      aspectRatio: "9:16",
      prompt: `Vertical 9:16 cinematic image for scene ${scene.scene}: ${scene.visualPurpose}. Modern high-contrast lighting, clear subject, realistic detail, negative space for bold captions, polished short-form content style.`
    }))
  };
}

export async function generateVideoPrompts({ styleAnalysis, scriptPlan, imagePrompts }) {
  const ai = await generateJson({
    schemaName: "video_prompts",
    system: [
      "You create production-ready image-to-video prompts for a reference-replication system.",
      "The prompts must tell the video model exactly how to move the camera and subject according to the reference edit rhythm.",
      "Avoid vague generic cinematic language unless paired with specific action and camera details.",
      "Output only valid JSON."
    ].join(" "),
    user: JSON.stringify({
      styleAnalysis,
      scriptPlan,
      imagePrompts,
      request: [
        "For each scene, create a libtv/Veo-style video prompt with action, camera movement, lighting, duration, aspect ratio, edit intention, and avoid list.",
        "Use scriptPlan.cameraInstruction and editInstruction when available.",
        "Use styleAnalysis.editingStyle, remotionInstructions, and generatorGuidance.videoPromptRules.",
        "The prompt should preserve the generated image as first-frame identity and only add controlled motion."
      ].join(" ")
    }, null, 2)
  });

  if (ai) return ai;

  return {
    source: "fallback",
    prompts: scriptPlan.scenes.map((scene) => ({
      scene: scene.scene,
      durationSeconds: scene.durationSeconds,
      aspectRatio: "9:16",
      sourceImage: `assets/images/scene-${String(scene.scene).padStart(2, "0")}.png`,
      prompt: `Vertical 9:16 cinematic video. ${scene.visualPurpose}. Slow controlled camera movement, subtle push-in, realistic motion, high-contrast modern lighting, clean composition with space for captions. Mood: focused and energetic.`,
      avoid: ["warped faces", "unreadable text", "extra fingers", "rapid flicker", "logo artifacts"]
    }))
  };
}
