interface TaskbarApplication {
  id: string;
  title: string;
  active: boolean;
}

export function WindowsXpTaskbar({ applications, onApplicationClick }: {
  applications: TaskbarApplication[];
  onApplicationClick: (id: string) => void;
}) {
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
            type="button" onClick={() => onApplicationClick(application.id)}>{application.title}</button>
        ))}
      </div>
      <time className="windows-xp-taskbar-clock">12:00 PM</time>
    </footer>
  );
}
