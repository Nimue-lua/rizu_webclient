import { useLayoutEffect, useRef, useState, type PointerEvent, type PropsWithChildren } from "react";

interface WindowFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

interface WindowInteraction {
  kind: "drag" | "resize";
  direction?: ResizeDirection;
  pointer_id: number;
  start_x: number;
  start_y: number;
  start_frame: WindowFrame;
  bounds_width: number;
  bounds_height: number;
}

interface WindowsXpWindowProps extends PropsWithChildren {
  title: string;
  className?: string;
  active?: boolean;
  zIndex?: number;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  resizable?: boolean;
  onActivate?: () => void;
  onMinimize?: () => void;
  onClose?: () => void;
}

const resize_directions: ResizeDirection[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function WindowsXpWindow({ title, children, className = "", active = true, zIndex = 1,
  initialPosition = { x: 24, y: 24 },
  initialSize = { width: 360, height: 160 }, minSize = { width: 200, height: 100 },
  resizable = true, onActivate, onMinimize, onClose }: WindowsXpWindowProps) {
  const window_ref = useRef<HTMLElement>(null);
  const interaction_ref = useRef<WindowInteraction>(null);
  const [frame, setFrame] = useState<WindowFrame>({ ...initialPosition, ...initialSize });

  useLayoutEffect(() => {
    const bounds = window_ref.current?.parentElement;
    if (!bounds) return;
    setFrame((current) => {
      const width = Math.min(current.width, bounds.clientWidth);
      const height = Math.min(current.height, bounds.clientHeight);
      return {
        x: clamp(current.x, 0, bounds.clientWidth - width),
        y: clamp(current.y, 0, bounds.clientHeight - height),
        width,
        height,
      };
    });
  }, []);

  const startInteraction = (event: PointerEvent<HTMLElement>, kind: WindowInteraction["kind"],
    direction?: ResizeDirection) => {
    if (event.button !== 0) return;
    const bounds = window_ref.current?.parentElement;
    if (!bounds) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    interaction_ref.current = {
      kind,
      direction,
      pointer_id: event.pointerId,
      start_x: event.clientX,
      start_y: event.clientY,
      start_frame: frame,
      bounds_width: bounds.clientWidth,
      bounds_height: bounds.clientHeight,
    };
  };

  const moveInteraction = (event: PointerEvent<HTMLElement>) => {
    const interaction = interaction_ref.current;
    if (!interaction || interaction.pointer_id !== event.pointerId) return;
    const dx = event.clientX - interaction.start_x;
    const dy = event.clientY - interaction.start_y;
    const start = interaction.start_frame;

    if (interaction.kind === "drag") {
      setFrame({ ...start,
        x: clamp(start.x + dx, 0, interaction.bounds_width - start.width),
        y: clamp(start.y + dy, 0, interaction.bounds_height - start.height),
      });
      return;
    }

    const direction = interaction.direction ?? "se";
    let { x, y, width, height } = start;
    if (direction.includes("e")) width = clamp(start.width + dx, minSize.width, interaction.bounds_width - start.x);
    if (direction.includes("s")) height = clamp(start.height + dy, minSize.height, interaction.bounds_height - start.y);
    if (direction.includes("w")) {
      width = clamp(start.width - dx, minSize.width, start.x + start.width);
      x = start.x + start.width - width;
    }
    if (direction.includes("n")) {
      height = clamp(start.height - dy, minSize.height, start.y + start.height);
      y = start.y + start.height - height;
    }
    setFrame({ x, y, width, height });
  };

  const stopInteraction = (event: PointerEvent<HTMLElement>) => {
    if (interaction_ref.current?.pointer_id === event.pointerId) interaction_ref.current = null;
  };

  return (
    <section ref={window_ref} className={`window windows-xp-window${active ? " active" : " inactive"} ${className}`}
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, zIndex }}
      onPointerDownCapture={onActivate}>
      <div className="title-bar windows-xp-window-title-bar"
        onPointerDown={(event) => {
          if ((event.target as Element).closest(".title-bar-controls")) return;
          startInteraction(event, "drag");
        }}
        onPointerMove={moveInteraction} onPointerUp={stopInteraction} onPointerCancel={stopInteraction}>
        <div className="title-bar-text">{title}</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Minimize" onClick={onMinimize} />
          <button type="button" aria-label="Maximize" disabled />
          <button type="button" aria-label="Close" onClick={onClose} />
        </div>
      </div>
      <div className="window-body windows-xp-window-body">{children}</div>
      {resizable && resize_directions.map((direction) => (
        <div key={direction} className={`windows-xp-resize-handle resize-${direction}`}
          onPointerDown={(event) => startInteraction(event, "resize", direction)}
          onPointerMove={moveInteraction} onPointerUp={stopInteraction} onPointerCancel={stopInteraction} />
      ))}
    </section>
  );
}
