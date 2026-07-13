import { generateJson } from "./openaiClient.js";

function fallbackContent(topic, style) {
  const cleanTopic = topic || "AI content creation";
  return {
    source: "fallback",
    topic: cleanTopic,
    ideas: [
      {
        id: "idea-1",
        title: `Most People Use ${cleanTopic} Wrong`,
        angle: "Expose a common mistake and give a simple better framework.",
        hook: `Most people use ${cleanTopic} like a shortcut, but the best results come from direction.`,
        cta: "Save this structure for your next post."
      },
      {
        id: "idea-2",
        title: `The 5-Second Framework for ${cleanTopic}`,
        angle: "Turn a complicated workflow into a repeatable formula.",
        hook: `If your ${cleanTopic} feels random, use this 5-second framework.`,
        cta: "Use this as your next content checklist."
      },
      {
        id: "idea-3",
        title: `Before You Generate Another Video, Do This`,
        angle: "Teach the planning step before generation.",
        hook: "Before you generate another video, decide the shot before the prompt.",
        cta: "Save this before opening your generator."
      }
    ],
    selectedIdeaId: "idea-1",
    styleUsed: style.format
  };
}

export async function generateContentIdeas({ topic, styleAnalysis }) {
  const ai = await generateJson({
    schemaName: "content_ideas",
    system: [
      "You are the Creative Replicator for a short-form video system.",
      "Use the provided reference blueprint as the creative grammar.",
      "Replicate the reference's structure, hook mechanics, tone, pacing, visual logic, and CTA pattern.",
      "Do not copy exact wording, creator identity, protected characters, logos, or unique original examples.",
      "Output only valid JSON."
    ].join(" "),
    user: JSON.stringify({
      topic,
      styleAnalysis,
      request: [
        "Generate 5 original content ideas using the same content logic and pacing.",
        "Each idea must include title, angle, hook, CTA, whyItMatchesReference, and whatChangesForOriginality.",
        "Prefer ideas that can be shot/generated with the same scene rhythm and edit pattern in styleAnalysis.sceneRhythm."
      ].join(" ")
    }, null, 2)
  });

  return ai ?? fallbackContent(topic, styleAnalysis);
}

export async function generateScriptPlan({ topic, styleAnalysis, contentIdeas }) {
  const selected = contentIdeas.ideas?.find((idea) => idea.id === contentIdeas.selectedIdeaId) ?? contentIdeas.ideas?.[0];
  const ai = await generateJson({
    schemaName: "script_plan",
    system: [
      "You write scene-by-scene scripts for vertical videos that must closely follow a reference blueprint.",
      "Match the reference's hook pattern, sentence length, beat count, scene rhythm, caption style, and CTA behavior.",
      "Make the content original by changing wording, examples, subjects, products, and specific claims.",
      "Output only valid JSON."
    ].join(" "),
    user: JSON.stringify({
      topic,
      styleAnalysis,
      selectedIdea: selected,
      request: [
        "Create a scene-by-scene script plan with voiceover, caption text, highlighted words, visual purpose, duration, and CTA.",
        "Use styleAnalysis.sceneRhythm as the timing skeleton when available.",
        "For every scene include referenceBeatMatched, durationSeconds, voiceover, caption, highlightWords, visualPurpose, cameraInstruction, editInstruction, and captionInstruction.",
        "The final plan should feel like the reference video's cousin, not a generic video."
      ].join(" ")
    }, null, 2)
  });

  if (ai) return ai;

  return {
    source: "fallback",
    title: selected?.title ?? `Content idea for ${topic}`,
    totalDurationSeconds: 30,
    scenes: [
      {
        scene: 1,
        durationSeconds: 3,
        purpose: "hook",
        voiceover: selected?.hook ?? `Most people use ${topic} wrong.`,
        caption: selected?.hook ?? `Most people use ${topic} wrong.`,
        highlightWords: ["wrong"],
        visualPurpose: "show the target audience facing the core problem"
      },
      {
        scene: 2,
        durationSeconds: 6,
        purpose: "problem",
        voiceover: "The mistake is asking for output before deciding the direction.",
        caption: "Direction comes before output",
        highlightWords: ["Direction"],
        visualPurpose: "show messy prompts transforming into a clear shot plan"
      },
      {
        scene: 3,
        durationSeconds: 8,
        purpose: "framework",
        voiceover: "Use this structure: subject, action, camera, lighting, mood.",
        caption: "Subject. Action. Camera. Lighting. Mood.",
        highlightWords: ["Camera", "Mood"],
        visualPurpose: "show the framework as clean visual labels around a cinematic scene"
      },
      {
        scene: 4,
        durationSeconds: 8,
        purpose: "example",
        voiceover: "Instead of a vague prompt, describe the actual shot you want to see.",
        caption: "Describe the shot, not the idea",
        highlightWords: ["shot"],
        visualPurpose: "show a vague prompt becoming a detailed cinematic video prompt"
      },
      {
        scene: 5,
        durationSeconds: 5,
        purpose: "CTA",
        voiceover: selected?.cta ?? "Save this for your next post.",
        caption: selected?.cta ?? "Save this for your next post.",
        highlightWords: ["Save"],
        visualPurpose: "end with the framework visible and strong motion"
      }
    ]
  };
}
