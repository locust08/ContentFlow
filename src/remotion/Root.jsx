import React from "react";
import { AbsoluteFill, Composition, Img, Loop, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio, Video } from "@remotion/media";

const defaultProps = {
  format: {
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 30
  },
  scenes: [],
  audioUrl: "",
  mode: "legacy",
  ugcVideoUrl: "",
  clipper: {},
  subtitles: []
};

const fitText = (text) => {
  if (!text) return 54;
  if (text.length > 95) return 38;
  if (text.length > 65) return 44;
  if (text.length > 42) return 50;
  return 58;
};

const Caption = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 180
    }
  });
  const opacity = interpolate(frame, [0, 8, Math.max(9, scene.durationSeconds * fps - 8), scene.durationSeconds * fps], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  const words = String(scene.caption || "").split(/(\s+)/);
  const highlights = new Set((scene.highlightWords || []).map((word) => String(word).toLowerCase()));

  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        bottom: 210,
        transform: `scale(${scale})`,
        transformOrigin: "center",
        opacity,
        textAlign: "center"
      }}
    >
      <div
        style={{
          display: "inline",
          color: "white",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 900,
          fontSize: fitText(scene.caption),
          lineHeight: 1.08,
          letterSpacing: 0,
          textShadow: "0 4px 18px rgba(0,0,0,0.78), 0 2px 4px rgba(0,0,0,0.9)"
        }}
      >
        {words.map((word, index) => {
          const normalized = word.replace(/[^\w]/g, "").toLowerCase();
          const highlighted = highlights.has(normalized) || highlights.has(word.trim().toLowerCase());
          return (
            <span key={`${word}-${index}`} style={{ color: highlighted ? "#ffd43b" : "white" }}>
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const SubtitleCaption = ({ subtitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const localFrame = frame - Math.round((subtitle.start || 0) * fps);
  const durationFrames = Math.max(1, Math.round(((subtitle.end || subtitle.start + 2) - (subtitle.start || 0)) * fps));
  const opacity = interpolate(localFrame, [0, 5, Math.max(6, durationFrames - 5), durationFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const scale = interpolate(localFrame, [0, 6], [0.96, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const highlights = new Set((subtitle.highlightWords || []).map((word) => String(word).toLowerCase()));

  return (
    <div
      style={{
        position: "absolute",
        left: 70,
        right: 70,
        bottom: 190,
        textAlign: "center",
        opacity,
        transform: `scale(${scale})`,
        transformOrigin: "center"
      }}
    >
      <div
        style={{
          display: "inline",
          color: "white",
          fontFamily: "Arial, Helvetica, sans-serif",
          fontWeight: 900,
          fontSize: fitText(subtitle.text),
          lineHeight: 1.08,
          letterSpacing: 0,
          textTransform: "uppercase",
          textShadow: "0 4px 18px rgba(0,0,0,0.78), 0 2px 4px rgba(0,0,0,0.9)"
        }}
      >
        {String(subtitle.text || "").split(/(\s+)/).map((word, index) => {
          const normalized = word.replace(/[^\w]/g, "").toLowerCase();
          const highlighted = highlights.has(normalized) || highlights.has(word.trim().toLowerCase());
          return (
            <span key={`${word}-${index}`} style={{ color: highlighted ? "#ffd43b" : "white" }}>
              {word}
            </span>
          );
        })}
      </div>
    </div>
  );
};

const UgcVideo = ({ ugcVideoUrl = "", subtitles = [] }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const activeSubtitles = subtitles.filter((subtitle) => {
    const start = Math.round((subtitle.start || 0) * fps);
    const end = Math.round((subtitle.end || 0) * fps);
    return frame >= start && frame <= end;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d0d" }}>
      {ugcVideoUrl ? (
        <Video
          src={ugcVideoUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
          volume={1}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.03), rgba(0,0,0,0) 48%, rgba(0,0,0,0.34))"
        }}
      />
      {activeSubtitles.map((subtitle, index) => (
        <SubtitleCaption key={`${subtitle.start}-${index}`} subtitle={subtitle} />
      ))}
    </AbsoluteFill>
  );
};

const ReactionOverlay = ({ clipper = {} }) => {
  const { fps } = useVideoConfig();
  if (!clipper.reactionUrl) return null;
  const frameStyle = {
    position: "absolute",
    left: 54,
    top: 86,
    width: 250,
    height: 250,
    borderRadius: 8,
    overflow: "hidden",
    border: "4px solid rgba(255,255,255,0.92)",
    boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
    backgroundColor: "#111"
  };
  const mediaStyle = {
    width: "100%",
    height: "100%",
    objectFit: "cover"
  };

  return (
    <div style={frameStyle}>
      {clipper.reactionType === "video" ? (
        <Loop durationInFrames={Math.max(1, Math.round(Number(clipper.reactionDurationSeconds || 3) * fps))}>
          <Video src={clipper.reactionUrl} style={mediaStyle} objectFit="cover" muted />
        </Loop>
      ) : (
        <Img src={clipper.reactionUrl} style={mediaStyle} />
      )}
    </div>
  );
};

const ClipperVideo = ({ clipper = {}, subtitles = [] }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const startFrame = Math.max(0, Math.round(Number(clipper.start || 0) * fps));
  const endFrame = Math.max(startFrame + 1, Math.round(Number(clipper.end || clipper.start + 45) * fps));
  const activeSubtitles = subtitles.filter((subtitle) => {
    const start = Math.round((subtitle.start || 0) * fps);
    const end = Math.round((subtitle.end || 0) * fps);
    return frame >= start && frame <= end;
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#05050a" }}>
      {clipper.sourceVideoUrl ? (
        <Video
          src={clipper.sourceVideoUrl}
          trimBefore={startFrame}
          trimAfter={endFrame}
          objectFit="cover"
          style={{
            width: "100%",
            height: "100%"
          }}
          volume={1}
        />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0) 45%, rgba(0,0,0,0.42))"
        }}
      />
      <ReactionOverlay clipper={clipper} />
      {activeSubtitles.map((subtitle, index) => (
        <SubtitleCaption key={`${subtitle.start}-${index}`} subtitle={subtitle} />
      ))}
    </AbsoluteFill>
  );
};

const Scene = ({ scene }) => {
  const mediaStyle = {
    width: "100%",
    height: "100%",
    objectFit: "cover"
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d0d" }}>
      {scene.videoUrl ? (
        <Video src={scene.videoUrl} style={mediaStyle} volume={1} />
      ) : scene.imageUrl ? (
        <Img src={scene.imageUrl} style={mediaStyle} />
      ) : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.05) 50%, rgba(0,0,0,0.48))"
        }}
      />
      <Caption scene={scene} />
    </AbsoluteFill>
  );
};

export const ContentMachineVideo = ({ scenes = [], audioUrl = "", mode = "legacy", ugcVideoUrl = "", clipper = {}, subtitles = [] }) => {
  const { fps } = useVideoConfig();
  let cursor = 0;

  if (mode === "ugc") {
    return <UgcVideo ugcVideoUrl={ugcVideoUrl} subtitles={subtitles} />;
  }

  if (mode === "clipper") {
    return <ClipperVideo clipper={clipper} subtitles={subtitles} />;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#0d0d0d" }}>
      {audioUrl ? <Audio src={audioUrl} /> : null}
      {scenes.map((scene) => {
        const from = Math.round(cursor * fps);
        const durationInFrames = Math.max(1, Math.round(scene.durationSeconds * fps));
        cursor += scene.durationSeconds;
        return (
          <Sequence key={`${scene.scene}-${from}`} from={from} durationInFrames={durationInFrames}>
            <Scene scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="ContentMachine"
      component={ContentMachineVideo}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={900}
      defaultProps={defaultProps}
      calculateMetadata={({ props }) => {
        const fps = props.format?.fps || 30;
        const width = props.format?.width || 1080;
        const height = props.format?.height || 1920;
        const durationSeconds = props.scenes?.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0)
          || (props.mode === "ugc" ? props.format?.durationSeconds : 0)
          || props.format?.durationSeconds
          || 30;
        return {
          fps,
          width,
          height,
          durationInFrames: Math.max(1, Math.ceil(durationSeconds * fps))
        };
      }}
    />
  );
};
