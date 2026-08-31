import { SongSelectIcon } from "./SongSelectUi";

interface SongSelectHeaderProps {
  nickname: string;
  date_text: string;
  session_duration: string;
  onSettings: () => void;
  onOpenLibrarySources: () => void;
  onRefreshLibrary: () => void;
  library_scanning: boolean;
}

export function SongSelectHeader({ nickname, date_text, session_duration, onSettings,
  onOpenLibrarySources, onRefreshLibrary, library_scanning }: SongSelectHeaderProps) {
  return (
    <header className="song-select-header">
      <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU.SU | WEBCLIENT | {__GIT_HASH__}</span></div>
      <div className="session-info"><time>{date_text}</time><span className="session-elapsed">{session_duration}</span><span className="online-status">OFFLINE</span></div>
      <nav className="header-actions" aria-label="Account and settings">
        <div className="player-info"><span><strong>{nickname}</strong></span><i /></div>
        <div className="header-icon-dock">
          <button aria-label="Settings" onClick={onSettings}><SongSelectIcon name="settings" /></button>
          <button aria-label="Library sources" title="Library sources" onClick={onOpenLibrarySources}><SongSelectIcon name="folder" /></button>
          <button className={library_scanning ? "scanning" : ""} aria-label="Refresh library" title={library_scanning ? "Refresh library (scan in progress)" : "Refresh library"} onClick={onRefreshLibrary}><SongSelectIcon name="refresh" /></button>
          <button aria-label="Notifications"><SongSelectIcon name="bell" /></button>
        </div>
      </nav>
    </header>
  );
}
