import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  DesignSystemProvider,
  Inline,
  Progress,
  Stack,
  SwitchField,
} from "..";

export function DesignSystemHarness() {
  const [enabled, setEnabled] = useState(true);

  return (
    <DesignSystemProvider theme="system">
      <main className="muses-page">
        <Card
          description="Keyboard-focusable primitives using semantic HTML and Radix accessibility behavior."
          headingId="design-system-harness-title"
          title="Muses design system"
        >
          <Stack>
            <Inline>
              <Badge tone="accent">FOCUSING</Badge>
              <Badge tone="warning">UNKNOWN</Badge>
            </Inline>
            <Progress label="Confidence" value={72} />
            <SwitchField
              checked={enabled}
              label="Enable local audio effect"
              onCheckedChange={setEnabled}
            />
            <Inline>
              <Button variant="primary">Primary action</Button>
              <Button>Secondary action</Button>
            </Inline>
          </Stack>
        </Card>
      </main>
    </DesignSystemProvider>
  );
}
