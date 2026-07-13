import { describe, expect, it } from "vitest";
import { uploadCompletionStatus, uploadHostedReaction } from "./useContentFlow.js";

describe("upload completion status", () => {
  it("reports a clean upload", () => {
    expect(uploadCompletionStatus({ ok: true })).toBe("Upload complete");
  });

  it("surfaces a partial Supabase synchronization warning", () => {
    expect(uploadCompletionStatus({ supabaseWarning: "Storage unavailable" })).toBe("Upload saved; Supabase sync needs attention");
  });
});

describe("hosted reaction upload", () => {
  it("uploads the file directly to the signed Storage URL before completing metadata", async () => {
    const calls = [];
    const file = new File(["video"], "Maya.mp4", { type: "application/octet-stream" });
    const apiCall = async (url, options) => {
      calls.push({ type: "api", url, options });
      if (url.endsWith("/upload-url")) return {
        uploadUrl: "https://storage.example.test/signed",
        upload: { reactionId: "char-1", localPath: "clipper/reaction/maya.mp4", contentType: "video/mp4" }
      };
      return { ok: true };
    };
    const fetchImpl = async (url, options) => {
      calls.push({ type: "storage", url, options });
      return new Response(null, { status: 200 });
    };

    const result = await uploadHostedReaction({ project: "demo", file, apiCall, fetchImpl });

    expect(result).toEqual({ ok: true });
    expect(calls.map((call) => call.type)).toEqual(["api", "storage", "api"]);
    expect(calls[1].options.body).toBe(file);
    expect(calls[1].options.headers["Content-Type"]).toBe("video/mp4");
    expect(JSON.parse(calls[2].options.body)).toEqual({ upload: { reactionId: "char-1", localPath: "clipper/reaction/maya.mp4", contentType: "video/mp4" } });
  });
});
