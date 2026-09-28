import { useCallback, useEffect, useState } from "react";
import { enumerateMicrophones, type AudioInputDevice } from "./audio";

export type MicPermission = "prompt" | "granted" | "denied" | "unknown";

interface UseMicrophones {
  devices: AudioInputDevice[];
  permission: MicPermission;
  requestAccess: () => Promise<void>;
  refresh: () => Promise<void>;
}

async function queryPermission(): Promise<MicPermission> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    });
    return status.state as MicPermission;
  } catch {
    // L'API Permissions peut ne pas connaître "microphone" : on reste neutre.
    return "unknown";
  }
}

/** Liste les micros, suit l'autorisation, et se rafraîchit au branchement/débranchement. */
export function useMicrophones(): UseMicrophones {
  const [devices, setDevices] = useState<AudioInputDevice[]>([]);
  const [permission, setPermission] = useState<MicPermission>("unknown");

  const refresh = useCallback(async () => {
    try {
      setDevices(await enumerateMicrophones());
    } catch {
      setDevices([]);
    }
    setPermission(await queryPermission());
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // On libère aussitôt : l'appel ne sert qu'à débloquer l'autorisation + les labels.
      stream.getTracks().forEach((track) => track.stop());
      setPermission("granted");
    } catch {
      setPermission("denied");
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const onChange = (): void => void refresh();
    navigator.mediaDevices.addEventListener("devicechange", onChange);
    return () => navigator.mediaDevices.removeEventListener("devicechange", onChange);
  }, [refresh]);

  return { devices, permission, requestAccess, refresh };
}
