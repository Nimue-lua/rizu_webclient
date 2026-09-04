import { useEffect, useRef, type InputHTMLAttributes, type PointerEvent } from "react";

interface RangeInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>,
  "max" | "min" | "onChange" | "step" | "type" | "value"> {
  readonly max: number;
  readonly min: number;
  readonly step: number;
  readonly value: number;
  readonly onValueChange: (value: number) => void;
}

interface MouseDrag {
  readonly pointer_id: number;
  readonly start_x: number;
  readonly start_value: number;
  readonly width: number;
}

function steppedValue(value: number, direction: -1 | 1, min: number, max: number, step: number): number {
  return Math.min(max, Math.max(min, Number((value + direction * step).toFixed(10))));
}

export function useHoverRangeKeys(value: number, min: number, max: number, step: number,
  onValueChange: (value: number) => void) {
  const hovered_ref = useRef(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hovered_ref.current || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
      event.preventDefault();
      event.stopPropagation();
      onValueChange(steppedValue(value, event.key === "ArrowLeft" ? -1 : 1, min, max, step));
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [max, min, onValueChange, step, value]);

  return {
    onPointerEnter: (event: PointerEvent<HTMLInputElement>) => {
      if (event.pointerType === "mouse") hovered_ref.current = true;
    },
    onPointerLeave: (event: PointerEvent<HTMLInputElement>) => {
      if (event.pointerType === "mouse") hovered_ref.current = false;
    },
  };
}

export function RangeInput({ max, min, step, value, onValueChange, ...props }: RangeInputProps) {
  const drag_ref = useRef<MouseDrag | null>(null);
  const hover_key_handlers = useHoverRangeKeys(value, min, max, step, onValueChange);
  const updateDrag = (event: PointerEvent<HTMLInputElement>) => {
    const drag = drag_ref.current;
    if (!drag || drag.pointer_id !== event.pointerId) return;

    const raw_value = drag.start_value + (event.clientX - drag.start_x) / drag.width * (max - min);
    const stepped_value = min + Math.round((raw_value - min) / step) * step;
    onValueChange(Math.min(max, Math.max(min, Number(stepped_value.toFixed(10)))));
  };
  const stopDrag = (event: PointerEvent<HTMLInputElement>) => {
    if (drag_ref.current?.pointer_id !== event.pointerId) return;
    drag_ref.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <input {...props} {...hover_key_handlers} type="range" min={min} max={max} step={step} value={value}
    onChange={(event) => onValueChange(Number(event.target.value))}
    onPointerDown={(event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag_ref.current = {
        pointer_id: event.pointerId,
        start_x: event.clientX,
        start_value: value,
        width: event.currentTarget.getBoundingClientRect().width,
      };
    }}
    onPointerMove={updateDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} />;
}
