import { useEffect, useState } from "react";

interface TaskbarApplication {
  id: string;
  title: string;
  iconUrl?: string;
  active: boolean;
}

export function WindowsXpTaskbar({ applications, onApplicationClick }: {
  applications: TaskbarApplication[];
  onApplicationClick: (id: string) => void;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <footer className="windows-xp-taskbar">
      <button className="windows-xp-start-button" type="button">
        <span className="windows-xp-start-icon" aria-hidden="true">
          <i /><i /><i /><i />
        </span>
        Start
      </button>
      <div className="windows-xp-task-list">
        {applications.map((application) => (
          <button key={application.id} className={`windows-xp-task-button${application.active ? " active" : ""}`}
            type="button" onClick={() => onApplicationClick(application.id)}>
            {application.iconUrl && <img src={application.iconUrl} alt="" />}
            <span>{application.title}</span>
          </button>
        ))}
      </div>
      <time className="windows-xp-taskbar-clock" dateTime={now.toISOString()}>
        {now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
      </time>
    </footer>
  );
}
