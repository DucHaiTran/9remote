// Materialize a chat attachment on the host so the CLI can read it, mirroring what
// pasting into the terminal achieves. What the CLI gets depends on the engine: an
// image may ride as a base64 content block, as a file flag, or as a bare path it
// reads itself (each verified against the real CLI). Anything else is always written
// to disk and handed over as its path, which the CLI reads like any other file.
import fs from "node:fs";
import path from "node:path";
import { UPLOAD_DIR } from "../terminal/constants.js";

// The directory must exist before the first write — nothing else creates it.
try { if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

// Mirrors InputHandler's guard — a client-supplied name is written to disk, so it
// may never steer the path.
const safeFilename = (name) => (name || "paste").replace(/[^a-zA-Z0-9._-]/g, "_");

export function stageAttachment(attachment) {
  const { filename, type, content } = attachment;
  const filePath = path.join(UPLOAD_DIR, `${Date.now()}_${safeFilename(filename)}`);
  fs.writeFileSync(filePath, Buffer.from(content, "base64"));
  // Noted on the caller's object: the user bubble is emitted after the adapter staged it,
  // and the path is what lets a client open the picture again (attachmentMeta).
  attachment.stagedPath = filePath;
  // The path is returned for images too: engines that take an image as a file
  // argument (codex --image, opencode --file) have no other way to name it.
  if (typeof type === "string" && type.startsWith("image/")) {
    return { kind: "image", mediaType: type, data: content, path: filePath };
  }
  return { kind: "file", path: filePath };
}

// Staged files the CLI has to read itself, as a space-joined path list; "" when
// there are none. Images are skipped by default — an engine that can see them
// carries them its own way (a content block, a flag), never as a bare path.
// includeImages is for engines with no image channel at all, where the path is the
// only way to hand the picture over.
export function stagedPaths(staged, includeImages = false) {
  return (staged || [])
    .filter((a) => a.kind === "file" || (includeImages && a.kind === "image"))
    .map((a) => a.path)
    .join(" ");
}

// What the clients get to render under the user's bubble. Base64 stays out: this
// rides the replay log, which the pane rebuilds in full on every connect.
export function attachmentMeta(attachments) {
  if (!Array.isArray(attachments) || attachments.length === 0) return null;
  return attachments.map((a) => {
    const isImage = typeof a.type === "string" && a.type.startsWith("image/");
    return {
      filename: a.filename || "file",
      isImage,
      ...(isImage && a.stagedPath ? { path: a.stagedPath } : {})
    };
  });
}

// A typed turn read back from the CLI's transcript carries its pictures inline as base64.
// Each is written out once (named by the turn's uuid, so a re-read finds it) and described
// like a live attachment, so a reopened pane shows the same thumbnails. null when none.
const REPLAY_IMAGE_DIR = path.join(UPLOAD_DIR, "transcript");
const IMAGE_EXT_BY_TYPE = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
export function transcriptImageMeta(record) {
  const content = record?.message?.content;
  if (!Array.isArray(content)) return null;
  const blocks = content.filter((c) => c?.type === "image" && c.source?.type === "base64" && c.source.data);
  if (!blocks.length) return null;
  fs.mkdirSync(REPLAY_IMAGE_DIR, { recursive: true });
  return blocks.map((block, i) => {
    const ext = IMAGE_EXT_BY_TYPE[block.source.media_type] || "jpg";
    const file = path.join(REPLAY_IMAGE_DIR, `${safeFilename(record.uuid || "turn")}-${i}.${ext}`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(block.source.data, "base64"));
    return { filename: `image-${i + 1}.${ext}`, isImage: true, path: file };
  });
}

// Turn a prompt plus staged files into the plain text a non-block CLI takes.
export function buildAttachedPrompt(text, staged, includeImages = false) {
  return [stagedPaths(staged, includeImages), text].filter(Boolean).join(" ");
}

/**
 * Build the stream-json user message: staged images ride as content blocks, staged
 * files contribute their path to the text. Returns null when nothing was staged,
 * so the caller can fall back to the plain text message.
 */
export function buildAttachedMessage(text, staged) {
  if (!staged?.length) return null;

  const images = staged.filter((a) => a.kind === "image");
  const content = [
    ...images.map((a) => ({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } })),
    { type: "text", text: buildAttachedPrompt(text, staged) },
  ];
  return { type: "user", message: { role: "user", content } };
}
