import { SongSelectIcon } from "./SongSelectUi";

interface SongSelectHeaderProps {
  nickname: string;
  date_text: string;
  session_duration: string;
  onGlobalLeaderboard: () => void;
  onSettings: () => void;
  onAddLocalLibrary: () => void;
  onRefreshLibrary: () => void;
  library_scanning: boolean;
}

export function SongSelectHeader({ nickname, date_text, session_duration, onGlobalLeaderboard, onSettings,
  onAddLocalLibrary, onRefreshLibrary, library_scanning }: SongSelectHeaderProps) {
  return (
    <header className="song-select-header">
      <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU.SU | WEBCLIENT | {__GIT_HASH__}</span></div>
      <div className="session-info"><time>{date_text}</time><span className="session-elapsed">{session_duration}</span><span className="online-status">OFFLINE</span></div>
      <nav className="header-actions" aria-label="Account and settings">
        <button className="global-leaderboard-button" type="button" onClick={onGlobalLeaderboard}><SongSelectIcon name="trophy" />Global Leaderboard</button>
        <div className="player-info"><span><strong>{nickname}</strong></span><i /></div>
        <div className="header-icon-dock">
          <button aria-label="Settings" onClick={onSettings}><SongSelectIcon name="settings" /></button>
          <button aria-label="Add local chart folder" title="Add local chart folder" onClick={onAddLocalLibrary}><SongSelectIcon name="download" /></button>
          <button className={library_scanning ? "scanning" : ""} aria-label="Refresh library" title={library_scanning ? "Refresh library (scan in progress)" : "Refresh library"} onClick={onRefreshLibrary}><SongSelectIcon name="refresh" /></button>
          <button aria-label="Notifications"><SongSelectIcon name="bell" /></button>
        </div>
      </nav>
    </header>
  );
}
