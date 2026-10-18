# Daily-use bug notes

Copy this block for each issue. Keep video URLs/session tokens, personal notes,
absolute course paths and private file names out of shared reports.

## Short title

- **Date:** YYYY-MM-DD
- **App version:** 0.2.0
- **Environment:** Ubuntu version, light/dark theme, installed/dev build; renderer flag if used
- **What I did:** numbered steps, including whether playback was paused
- **What happened:**
- **What I expected:**
- **Severity:** Critical / High / Medium / Low
- **Repeatability:** Always / Sometimes / Once
- **Evidence:** sanitized screenshot or error message
- **Workaround / follow-up:**

Severity guide: Critical = data loss/security issue; High = core task blocked;
Medium = task works with a workaround; Low = cosmetic or minor inconvenience.

---

## Known issue: blank picture during seeking

- **What happened:** black/white picture during skips or scrubbing on the affected Linux setup.
- **Status:** user confirmed the renderer workaround; Linux startup now defaults it to 1
  unless already set. Fully quit and launch the rebuilt app normally.
- **Override:** `WEBKIT_DISABLE_DMABUF_RENDERER=0 courseshelf` opts out for one launch.
- **Details:** [release troubleshooting](release.md#player-keyboard-and-fullscreen-checks).
