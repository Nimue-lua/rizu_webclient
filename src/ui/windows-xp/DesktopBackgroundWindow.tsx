import { useRef, type ChangeEvent } from "react";

export function DesktopBackgroundWindow({ backgroundUrl, onBackgroundChange }: {
  backgroundUrl: string | null;
  onBackgroundChange: (file: File | null) => void;
}) {
  const input_ref = useRef<HTMLInputElement>(null);

  const selectImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    onBackgroundChange(file);
    event.target.value = "";
  };

  return (
    <section className="windows-xp-background-settings">
      <p>Select an image to use as your desktop background.</p>
      <fieldset>
        <legend>Preview</legend>
        <div className="windows-xp-background-monitor">
          <div style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
            {!backgroundUrl && <span>No background selected</span>}
          </div>
        </div>
      </fieldset>
      <input ref={input_ref} className="windows-xp-background-file" type="file" accept="image/*"
        onChange={selectImage} />
      <div className="windows-xp-background-actions">
        <button type="button" onClick={() => input_ref.current?.click()}>Browse...</button>
        <button type="button" disabled={!backgroundUrl} onClick={() => onBackgroundChange(null)}>Remove</button>
      </div>
      <p className="windows-xp-background-help">The selected image is fitted to fill the desktop.</p>
    </section>
  );
}
