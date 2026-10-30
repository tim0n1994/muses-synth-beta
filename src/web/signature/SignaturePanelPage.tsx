import { SignaturePanel } from "./SignaturePanel.js";

/**
 * Standalone page shell for the lazy route. Auth chrome and the MUSES_V07
 * feature gate are applied by the integrator when mounting module routes.
 */
export default function SignaturePanelPage(): React.JSX.Element {
  return (
    <main>
      <SignaturePanel />
    </main>
  );
}
