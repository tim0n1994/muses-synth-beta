import type { ChangeEvent } from "react";
import { useI18n } from "../../i18n";
import { Button, Card, Inline, Stack, SwitchField } from "../../design-system";
import type { AudioControlProps } from "../component-props";
import type { RegistryRenderEnvelope } from "../types";

export function AudioControl({ id, props, runtime }: RegistryRenderEnvelope) {
  const { t } = useI18n();
  const value = props as AudioControlProps;
  const headingId = `${id}-heading`;
  const disabled = value.disabledReason !== undefined;
  const volumeId = `${id}-volume`;

  const onPlayingChange = (playing: boolean) => {
    runtime.onAction?.({
      componentId: id,
      name: playing ? "audio.play" : "audio.pause",
    });
  };

  const onMute = () => {
    runtime.onAction?.({
      componentId: id,
      name: value.muted ? "audio.unmute" : "audio.mute",
    });
  };

  const onVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    runtime.onAction?.({
      componentId: id,
      name: "audio.volume",
      payload: { volume: Number(event.currentTarget.value) },
    });
  };

  return (
    <Card
      headingId={headingId}
      title={value.title ?? t("registry.audioControl.title")}
    >
      <div className="muses-audio-controls">
        <Stack gap="var(--muses-space-2)">
          <strong>
            {value.trackTitle ?? t("registry.audioControl.noTrack")}
          </strong>
          {value.disabledReason !== undefined && (
            <span className="muses-muted" role="status">
              {value.disabledReason}
            </span>
          )}
        </Stack>
        <SwitchField
          checked={value.playing}
          disabled={disabled}
          label={
            value.playing
              ? t("registry.audioControl.playing")
              : t("registry.audioControl.paused")
          }
          onCheckedChange={onPlayingChange}
        />
        <div className="muses-field">
          <label className="muses-field__label" htmlFor={volumeId}>
            {t("registry.audioControl.volume", { percent: value.volume })}
          </label>
          <input
            className="muses-range"
            disabled={disabled}
            id={volumeId}
            max={100}
            min={0}
            onChange={onVolumeChange}
            onKeyDown={(event) => {
              // jsdom does not apply the native range-input ArrowRight/Left
              // default action, so expose the keyboard change explicitly.
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") {
                return;
              }
              const current = Number(event.currentTarget.value);
              const delta = event.key === "ArrowRight" ? 1 : -1;
              const volume = Math.max(0, Math.min(100, current + delta));
              runtime.onAction?.({
                componentId: id,
                name: "audio.volume",
                payload: { volume },
              });
            }}
            type="range"
            value={value.volume}
          />
        </div>
        <Inline>
          <Button disabled={disabled} onClick={onMute}>
            {value.muted
              ? t("registry.audioControl.unmute")
              : t("registry.audioControl.mute")}
          </Button>
        </Inline>
      </div>
    </Card>
  );
}
