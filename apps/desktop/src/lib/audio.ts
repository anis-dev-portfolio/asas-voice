/** Périphérique d'entrée audio (micro) tel qu'affiché dans l'UI. */
export interface AudioInputDevice {
  deviceId: string;
  label: string;
}

/**
 * Liste les micros disponibles. Les labels ne sont renseignés par le navigateur
 * qu'après une autorisation getUserMedia ; sinon on met un libellé générique.
 */
export async function enumerateMicrophones(): Promise<AudioInputDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Micro ${index + 1}`,
    }));
}

/** Ouvre un flux micro sur le périphérique donné (ou le défaut système si null). */
export async function openMicStream(deviceId: string | null): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    } catch (err) {
      // Le micro choisi a disparu (débranché, désactivé) : on se replie sur le micro par
      // défaut du système plutôt que de casser la dictée jusqu'à un changement manuel.
      const name = err instanceof DOMException ? err.name : "";
      if (name !== "OverconstrainedError" && name !== "NotFoundError") throw err;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
