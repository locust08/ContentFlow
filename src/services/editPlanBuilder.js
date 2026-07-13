export function buildEditPlan({ metadata, styleAnalysis, scriptPlan }) {
  let cursor = 0;
  const scenes = scriptPlan.scenes.map((scene) => {
    const start = cursor;
    cursor += scene.durationSeconds;
    return {
      scene: scene.scene,
      startSeconds: start,
      durationSeconds: scene.durationSeconds,
      video: `assets/videos/scene-${String(scene.scene).padStart(2, "0")}.mp4`,
      image: `assets/images/scene-${String(scene.scene).padStart(2, "0")}.png`,
      voiceover: scene.voiceover,
      caption: scene.caption,
      highlightWords: scene.highlightWords ?? [],
      transition: scene.scene === 1 ? "none" : "fast-zoom-cut",
      purpose: scene.purpose,
      referenceBeatMatched: scene.referenceBeatMatched ?? null,
      cameraInstruction: scene.cameraInstruction ?? "",
      editInstruction: scene.editInstruction ?? "",
      captionInstruction: scene.captionInstruction ?? ""
    };
  });

  return {
    source: "generated",
    format: {
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: cursor || metadata.durationSeconds
    },
    style: {
      captionPreset: styleAnalysis.remotionInstructions?.captionPreset || "bold-keyword-highlight",
      transitionPreset: styleAnalysis.editingStyle?.transitionStyle || "fast-zoom-cut",
      musicPreset: "energetic-modern",
      referenceFormat: styleAnalysis.format || styleAnalysis.platformFormat || "vertical short-form video",
      remotionInstructions: styleAnalysis.remotionInstructions || {},
      captionStyle: styleAnalysis.captionStyle || {},
      editingStyle: styleAnalysis.editingStyle || {}
    },
    scenes
  };
}
