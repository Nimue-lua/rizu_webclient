import { SongSelectIcon } from "./SongSelectUi";

interface SongSelectHeaderProps {
  nickname: string;
  date_text: string;
  session_duration: string;
  onGlobalLeaderboard: () => void;
  onSettings: () => void;
}

export function SongSelectHeader({ nickname, date_text, session_duration, onGlobalLeaderboard, onSettings }: SongSelectHeaderProps) {
  return (
    <header className="song-select-header">
      <div className="game-brand"><img src="/rizu-logo.svg" alt="" /><span>RIZU.SU | WEBCLIENT | {__GIT_HASH__}</span></div>
      <div className="session-info"><time>{date_text}</time><span className="session-elapsed">{session_duration}</span><span className="online-status">OFFLINE</span></div>
      <nav className="header-actions" aria-label="Account and settings">
        <button className="global-leaderboard-button" type="button" onClick={onGlobalLeaderboard}><SongSelectIcon name="trophy" />Global Leaderboard</button>
        <div className="player-info"><span><strong>{nickname}</strong></span><i /></div>
        <div className="header-icon-dock">
          <button aria-label="Settings" onClick={onSettings}><SongSelectIcon name="settings" /></button>
          <button aria-label="Downloads"><SongSelectIcon name="download" /></button>
          <button aria-label="Command palette"><SongSelectIcon name="terminal" /></button>
          <button aria-label="Notifications"><SongSelectIcon name="bell" /></button>
        </div>
      </nav>
    </header>
  );
}
