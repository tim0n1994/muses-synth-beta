import { useCallback } from "react";

import { highlightAt, replayPositionAt } from "./timeline.js";
import type { JourneyNode, ReplayPlan } from "./types.js";

/**
 * ReplayTimeline — the timeline-review strip (V8): segments are drawn
 * proportional to their replay duration, event nodes are pinned at the
 * replay position their journey offset maps to, and the strip highlights
 * whatever the current playback position corresponds to (alignment is the
 * <=5s contract covered by __tests__/timeline.test.ts). Seeking maps a
 * click fraction back to a replay position for the audio decks.
 *
 * Stage 3 mounts this inside the replay surface; it is deliberately
 * self-contained (no registry/audio imports) so it can ship un-wired.
 */
export interface ReplayTimelineProps {
  readonly plan: ReplayPlan;
  readonly nodes: readonly JourneyNode[];
  /** Current playback position in replay seconds. */
  readonly positionSec: number;
  readonly onSeek?: (positionSec: number) => void;
}

const NODE_MARKERS: Readonly<Record<string, string>> = {
  flow_entered: "▲",
  bug_valley: "▼",
  tests_green: "✓",
  rest_started: "‖",
};

export const ReplayTimeline = ({
  plan,
  nodes,
  positionSec,
  onSeek,
}: ReplayTimelineProps) => {
  const total = Math.max(plan.totalDurationSec, 1);
  const highlight = highlightAt(plan, nodes, positionSec);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (onSeek === undefined) {
        return;
      }
      const bounds = event.currentTarget.getBoundingClientRect();
      const fraction = Math.min(
        Math.max((event.clientX - bounds.left) / bounds.width, 0),
        1,
      );
      onSeek(fraction * total);
    },
    [onSeek, total],
  );

  return (
    <div
      role="slider"
      aria-label="Replay timeline"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.min(Math.max(positionSec, 0), total)}
      tabIndex={0}
      onClick={handleClick}
      style={{
        position: "relative",
        display: "flex",
        width: "100%",
        height: "2.5rem",
        borderRadius: "0.375rem",
        overflow: "hidden",
        cursor: onSeek === undefined ? "default" : "pointer",
        background: "#f1f1f1",
      }}
    >
      {plan.segments.map((segment) => {
        const active = segment.segmentId === highlight.segmentId;
        return (
          <div
            key={segment.segmentId}
            title={`${segment.bucket} · ${segment.durationSec}s`}
            aria-label={`Segment ${segment.bucket}${active ? " (active)" : ""}`}
            style={{
              width: `${(segment.durationSec / total) * 100}%`,
              background: active ? "#5b8def" : "#c9d4e4",
              boxSizing: "border-box",
              borderLeft: "1px solid rgba(255,255,255,0.6)",
            }}
          />
        );
      })}
      {nodes.map((node) => (
        <span
          key={node.nodeId}
          title={`${node.type} at ${Math.round(node.offsetSec)}s into the session`}
          aria-label={`Node ${node.type}`}
          data-active={highlight.nodeIds.includes(node.nodeId)}
          style={{
            position: "absolute",
            left: `${(replayPositionAt(plan, node.offsetSec) / total) * 100}%`,
            top: 0,
            height: "100%",
            lineHeight: "2.5rem",
            fontSize: "0.9rem",
            color: highlight.nodeIds.includes(node.nodeId)
              ? "#1c2733"
              : "#7a8794",
            transform: "translateX(-50%)",
            pointerEvents: "none",
          }}
        >
          {NODE_MARKERS[node.type] ?? "•"}
        </span>
      ))}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: `${(Math.min(Math.max(positionSec, 0), total) / total) * 100}%`,
          top: 0,
          width: "2px",
          height: "100%",
          background: "#1c2733",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
