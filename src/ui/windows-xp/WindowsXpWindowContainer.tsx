import { useRef, useState, type ReactNode } from "react";
import { WindowsXpTaskbar } from "./WindowsXpTaskbar";
import { WindowsXpWindow } from "./WindowsXpWindow";

export interface WindowsXpApplication {
  id: string;
  title: string;
  content: ReactNode;
  defaultOpen?: boolean;
  initialPosition?: { x: number; y: number };
  initialSize?: { width: number; height: number };
  minSize?: { width: number; height: number };
  resizable?: boolean;
}

interface ApplicationState {
  id: string;
  open: boolean;
  visible: boolean;
  z_index: number;
}

export function WindowsXpWindowContainer({ applications, backgroundUrl }: {
  applications: WindowsXpApplication[];
  backgroundUrl?: string | null;
}) {
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
              <span className="windows-xp-program-icon" aria-hidden="true">R</span>
              <span>{application.title}</span>
            </button>
          ))}
        </div>
        {applications.map((application) => {
          const state = application_states.find((item) => item.id === application.id);
          if (!state?.open || !state.visible) return null;
          return (
            <WindowsXpWindow key={application.id} title={application.title}
              initialPosition={application.initialPosition} initialSize={application.initialSize}
              minSize={application.minSize} resizable={application.resizable}
              active={application.id === active_id} zIndex={state.z_index}
              onActivate={() => {
                if (application.id !== active_id) activate(application.id);
              }}
              onMinimize={() => updateApplication(application.id, { visible: false })}
              onClose={() => updateApplication(application.id, { open: false, visible: false })}>
              {application.content}
            </WindowsXpWindow>
          );
        })}
      </div>
      <WindowsXpTaskbar applications={applications.filter((application) =>
        application_states.some((state) => state.id === application.id && state.open)).map((application) => ({
          id: application.id,
          title: application.title,
          active: application.id === active_id,
        }))} onApplicationClick={(id) => {
          const state = application_states.find((item) => item.id === id);
          if (state?.visible && id === active_id) updateApplication(id, { visible: false });
          else activate(id);
        }} />
    </main>
  );
}
