import { useRef, useState, type ReactNode } from "react";
import { appSettings, settings, useSetting } from "../../config/Settings";
import { WindowsXpTaskbar } from "./WindowsXpTaskbar";
import { WindowsXpWindow, type WindowFrame } from "./WindowsXpWindow";

export interface WindowsXpApplication {
  id: string;
  title: string;
  content: ReactNode;
  iconUrl?: string;
  defaultOpen?: boolean;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  resizable?: boolean;
  onClose?: () => void;
}

interface ApplicationState {
  id: string;
  open: boolean;
  visible: boolean;
  z_index: number;
}

function storedWindowFrames(serialized: string): Record<string, WindowFrame> {
  try {
    const frames: unknown = JSON.parse(serialized);
    if (typeof frames !== "object" || frames === null || Array.isArray(frames)) return {};
    return Object.fromEntries(Object.entries(frames).filter((entry): entry is [string, WindowFrame] => {
      const frame = entry[1] as Partial<WindowFrame> | null;
      return frame !== null && typeof frame === "object" && Number.isFinite(frame.x) && Number.isFinite(frame.y)
        && Number.isFinite(frame.width) && Number.isFinite(frame.height) && frame.width! > 0 && frame.height! > 0;
    }));
  } catch {
    return {};
  }
}

export function WindowsXpWindowContainer({ applications, backgroundUrl }: {
  applications: WindowsXpApplication[];
  backgroundUrl?: string | null;
}) {
  const serialized_frames = useSetting(settings.windows_xp_window_frames);
  const stored_frames = storedWindowFrames(serialized_frames);
  const next_z_index = useRef(applications.length + 1);
  const [application_states, setApplicationStates] = useState<ApplicationState[]>(() =>
    applications.map((application, index) => ({
      id: application.id,
      open: application.defaultOpen ?? false,
      visible: application.defaultOpen ?? false,
      z_index: index + 1,
    })),
  );

  const updateApplication = (id: string, update: Partial<ApplicationState>) => {
    setApplicationStates((states) => states.map((state) => state.id === id ? { ...state, ...update } : state));
  };

  const activate = (id: string) => {
    updateApplication(id, { open: true, visible: true, z_index: next_z_index.current++ });
  };

  const active_id = application_states
    .filter((state) => state.open && state.visible)
    .sort((left, right) => right.z_index - left.z_index)[0]?.id ?? null;

  return (
    <main className="windows-xp-shell">
      <div className="windows-xp-desktop" style={backgroundUrl ? { backgroundImage: `url(${backgroundUrl})` } : undefined}>
        <div className="windows-xp-desktop-icons">
          {applications.map((application) => (
            <button key={application.id} className="windows-xp-desktop-icon" type="button"
              onDoubleClick={() => activate(application.id)}>
              {application.iconUrl
                ? <img className="windows-xp-program-icon" src={application.iconUrl} alt="" />
                : <span className="windows-xp-program-icon windows-xp-program-icon-fallback" aria-hidden="true">R</span>}
              <span>{application.title}</span>
            </button>
          ))}
        </div>
        {applications.map((application) => {
          const state = application_states.find((item) => item.id === application.id);
          if (!state?.open || !state.visible) return null;
          const stored_frame = stored_frames[application.id];
          return (
            <WindowsXpWindow key={application.id} title={application.title} iconUrl={application.iconUrl}
              initialPosition={stored_frame ?? application.initialPosition}
              initialSize={stored_frame ?? application.initialSize}
              minSize={application.minSize} resizable={application.resizable}
              active={application.id === active_id} zIndex={state.z_index}
              onFrameChange={(frame) => {
                const frames = storedWindowFrames(appSettings.get(settings.windows_xp_window_frames));
                appSettings.set(settings.windows_xp_window_frames, JSON.stringify({ ...frames, [application.id]: frame }));
              }}
              onActivate={() => {
                if (application.id !== active_id) activate(application.id);
              }}
              onMinimize={() => updateApplication(application.id, { visible: false })}
              onClose={() => {
                updateApplication(application.id, { open: false, visible: false });
                application.onClose?.();
              }}>
              {application.content}
            </WindowsXpWindow>
          );
        })}
      </div>
      <WindowsXpTaskbar applications={applications.filter((application) =>
        application_states.some((state) => state.id === application.id && state.open)).map((application) => ({
          id: application.id,
          title: application.title,
          iconUrl: application.iconUrl,
          active: application.id === active_id,
        }))} onApplicationClick={(id) => {
          const state = application_states.find((item) => item.id === id);
          if (state?.visible && id === active_id) updateApplication(id, { visible: false });
          else activate(id);
        }} />
    </main>
  );
}
