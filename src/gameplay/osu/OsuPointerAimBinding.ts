import type { OsuPointerInput } from "../GameplaySession";

type PointerMovementEvent = "pointermove" | "pointerrawupdate";
type PointerBounds = { left: number; top: number; width: number; height: number };

export interface OsuPointerAimBindingDependencies {
  event_target: Pick<EventTarget, "addEventListener" | "removeEventListener">;
  get_bounds: () => PointerBounds;
  observe_resize: (callback: () => void) => () => void;
}

export function osuPointerMovementEvent(raw_enabled: boolean, raw_supported: boolean): PointerMovementEvent {
  return raw_enabled && raw_supported ? "pointerrawupdate" : "pointermove";
}

export function bindOsuPointerAim(input: OsuPointerInput, event_type: PointerMovementEvent,
  dependencies: OsuPointerAimBindingDependencies): () => void {
  let bounds = dependencies.get_bounds();
  const refreshBounds = () => { bounds = dependencies.get_bounds(); };
  const stop_observing = dependencies.observe_resize(refreshBounds);
  const aim = (event: Event) => {
    const pointer_event = event as PointerEvent;
    if (pointer_event.pointerType !== "mouse" && pointer_event.pointerType !== "pen") return;
    input.aimPointer(pointer_event.pointerId, pointer_event.clientX, pointer_event.clientY, bounds, pointer_event.timeStamp);
  };

  dependencies.event_target.addEventListener(event_type, aim);
  return () => {
    dependencies.event_target.removeEventListener(event_type, aim);
    stop_observing();
  };
}
