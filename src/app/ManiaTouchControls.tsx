import type { MutableRefObject } from "react";
import type { ManiaPointerInput } from "../gameplay/GameplaySession";

interface ManiaTouchControlsProps {
  column_count: number;
  input_ref: MutableRefObject<ManiaPointerInput | null>;
}

export function ManiaTouchControls({ column_count, input_ref }: ManiaTouchControlsProps) {
  return <div className="gameplay-touch-zones" aria-label="Gameplay touch controls">
    {Array.from({ length: column_count }, (_, column) => (
      <button
        key={column}
        type="button"
        tabIndex={-1}
        aria-label={`Column ${column + 1}`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse") return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          input_ref.current?.pressPointer(event.pointerId, column, event.timeStamp);
        }}
        onPointerUp={(event) => {
          if (event.pointerType === "mouse") return;
          event.preventDefault();
          input_ref.current?.releasePointer(event.pointerId, event.timeStamp);
        }}
        onPointerCancel={(event) => input_ref.current?.releasePointer(event.pointerId, event.timeStamp)}
        onLostPointerCapture={(event) => input_ref.current?.releasePointer(event.pointerId, event.timeStamp)}
      />
    ))}
  </div>;
}
