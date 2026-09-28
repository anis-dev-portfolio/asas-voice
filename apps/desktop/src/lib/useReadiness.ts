import { useMemo } from "react";
import { computeReadiness, type Readiness } from "./readiness";
import { useRecording } from "../store/recording";
import { useSettings } from "../store/settings";
import { useSystem } from "../store/system";

/** Verdict « prêt à dicter » calculé à partir des sondes réelles (voir lib/readiness). */
export function useReadiness(): Readiness {
  const service = useSystem((s) => s.service);
  const health = useSystem((s) => s.health);
  const transcriptionCheck = useSystem((s) => s.checks.transcription ?? null);
  const correctionCheck = useSystem((s) => s.checks.correction ?? null);
  const verifying = useSystem((s) => Boolean(s.verifying.transcription || s.verifying.correction));
  const micPermission = useSystem((s) => s.micPermission);
  const micCount = useSystem((s) => s.micCount);
  const shortcutOk = useRecording((s) => s.shortcutOk);
  // Correction effective = réglage activé ET clé présente (sinon elle est simplement éteinte).
  const correctionEnabled =
    useSettings((s) => s.claudePostProcess) && Boolean(health?.hasAnthropicKey);

  return useMemo(
    () =>
      computeReadiness({
        service,
        health,
        transcriptionCheck,
        correctionCheck,
        verifying,
        micPermission,
        micCount,
        shortcutOk,
        correctionEnabled,
      }),
    [
      service,
      health,
      transcriptionCheck,
      correctionCheck,
      verifying,
      micPermission,
      micCount,
      shortcutOk,
      correctionEnabled,
    ],
  );
}
