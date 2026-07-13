import fs from "node:fs";
import path from "node:path";
import { generateVisionJson } from "./openaiClient.js";

function fallbackStyle(metadata, frameFiles) {
  const isVertical = metadata.height > metadata.width;
  return {
    source: "fallback",
    format: isVertical ? "vertical short-form video" : "landscape video",
    durationSeconds: metadata.durationSeconds,
    dimensions: {
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps
    },
    contentStructure: ["hook", "problem", "examples", "solution", "CTA"],
    hookStyle: "fast first-line statement that creates curiosity or tension",
    editingPace: "short scenes with frequent visual changes",
    captionStyle: {
      position: "lower third or center lower third",
      font: "bold sans-serif",
      emphasis: "highlight important keywords",
      animation: "word or phrase pop"
    },
    visualStyle: {
      mood: "high-contrast, modern, attention-focused",
      camera: "push-ins, zoom cuts, and simple motion",
      composition: "clear subject with readable negative space for captions"
    },
    audioStyle: {
      voiceover: "direct and concise",
      music: "energetic background bed",
      sfx: "small hits on transitions and keyword emphasis"
    },
    frameSamples: frameFiles.map((file) => path.basename(file)),
    notes: [
      "This fallback was created without AI vision/transcription.",
      "Add OPENAI_API_KEY for deeper style analysis."
    ]
  };
}

export async function analyzeReference({ projectDir, metadata, transcript }) {
  const framesDir = path.join(projectDir, "analysis", "frames");
  const frameFiles = fs.existsSync(framesDir)
    ? fs.readdirSync(framesDir).filter((file) => /\.(jpg|jpeg|png)$/i.test(file)).map((file) => path.join(framesDir, file))
    : [];

  const selectedFrames = frameFiles.slice(0, 18);
  const prompt = {
    task: "Deeply analyze this reference video from metadata, transcript, and sampled frames. Build a practical replication blueprint for creating a new original video that feels as close as possible to the reference style without copying protected expression, exact wording, creator identity, logos, or unique characters.",
    metadata,
    transcript,
    sampledFramesInOrder: selectedFrames.map((file, index) => ({
      index: index + 1,
      file: path.basename(file)
    })),
    analyzeFor: [
      "content category and platform format",
      "creator/persona/identity cues visible in the video",
      "script structure, hook pattern, pacing, tone, CTA",
      "visual style, color, lighting, shot type, location/background, subject placement",
      "caption typography, placement, color, keyword emphasis, animation inference",
      "editing type: cuts, zooms, b-roll, overlays, transitions, rhythm",
      "scene-by-scene beat map with approximate duration and purpose",
      "what must be matched to replicate the feel",
      "what must be changed to keep the new video original",
      "specific Remotion editing instructions"
    ],
    requiredJsonShape: {
      confidence: "number 0-1",
      contentType: "string",
      platformFormat: "string",
      identity: {
        persona: "string",
        visibleSubject: "string",
        brandOrCreatorCues: [],
        doNotCopy: []
      },
      scriptStyle: {
        hookPattern: "string",
        tone: "string",
        sentencePacing: "string",
        structure: [],
        ctaPattern: "string",
        reusableTemplate: []
      },
      visualStyle: {
        aspectRatio: "string",
        subjectPlacement: "string",
        environment: "string",
        colorPalette: [],
        lighting: "string",
        cameraFraming: "string",
        motion: "string"
      },
      captionStyle: {
        placement: "string",
        fontFeel: "string",
        colors: [],
        emphasisRules: [],
        animation: "string",
        safeArea: "string"
      },
      editingStyle: {
        cutSpeed: "string",
        averageShotLengthSeconds: "number",
        transitionStyle: "string",
        zoomStyle: "string",
        overlayStyle: "string",
        brollPattern: "string",
        rhythmNotes: []
      },
      sceneRhythm: [
        {
          beat: "number",
          timeRange: "string",
          purpose: "string",
          visual: "string",
          textOrCaption: "string",
          editingInstruction: "string"
        }
      ],
      remotionInstructions: {
        composition: "string",
        captionPreset: "string",
        transitions: [],
        cameraEffects: [],
        timingRules: [],
        overlays: []
      },
      replicationRules: {
        mustMatch: [],
        shouldMatch: [],
        mustChange: [],
        avoid: []
      },
      generatorGuidance: {
        imagePromptRules: [],
        videoPromptRules: [],
        negativePromptRules: []
      }
    }
  };

  const ai = await generateVisionJson({
    schemaName: "style_analysis",
    system: [
      "You are the Reference Intelligence Engine for a short-form content replication app.",
      "You analyze reference videos like a creative director, editor, script strategist, and motion designer.",
      "Be specific and operational. The output will drive image generation, video generation, and Remotion editing.",
      "Do not say generic things like cinematic or fast-paced unless you describe exactly how to reproduce it.",
      "Output only valid JSON."
    ].join(" "),
    text: JSON.stringify(prompt, null, 2),
    imagePaths: selectedFrames
  });

  return ai ?? fallbackStyle(metadata, frameFiles);
}
