// A completeness check, not an automated legal opinion. A human must audit
// the actual platform, bundled browser code and embedded native components.
export function assertNoticeReady(text, localPreview) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Third-party notices are missing.");
  }
  if (!localPreview && /^# Third-Party Notices[^\n]*\bDRAFT\b/im.test(text)) {
    throw new Error(
      "Third-party notices remain a draft; distribution blocked.",
    );
  }
}
