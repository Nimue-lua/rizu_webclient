import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, Play } from "lucide-react";
import type { ResolvedDanCourse } from "../../dan/DanCourse";
import { SongSelectHeader } from "./song-select/SongSelectHeader";

const started_at = Date.now();

function sessionDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return [hours, minutes, seconds % 60].map((value) => String(value).padStart(2, "0")).join(":");
}

function courseDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;
}

export function DanSelectScreen({ courses, selected, mode, onMode, onSelect, onStart, onExit, nickname,
  online_count, onSettings }: {
  courses: readonly ResolvedDanCourse[];
  selected: string | null;
  mode: "osu" | "mania";
  onMode: (mode: "osu" | "mania") => void;
  onSelect: (id: string) => void;
  onStart: (course: ResolvedDanCourse) => void;
  onExit: () => void;
  nickname: string;
  online_count: number | null;
  onSettings: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const course = courses.find((candidate) => candidate.id === selected) ?? courses[0] ?? null;
  useEffect(() => {
    const resize = () => {
      const scale = window.innerHeight / 1080;
      document.documentElement.style.setProperty("--ui-scale", String(scale));
      document.documentElement.style.setProperty("--logical-width", `${window.innerWidth / scale}px`);
    };
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    window.addEventListener("resize", resize);
    resize();
    return () => { window.clearInterval(timer); window.removeEventListener("resize", resize); };
  }, []);
  const date_text = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(",", "");
  return <main className="dan-select-screen">
    <SongSelectHeader nickname={nickname} online_count={online_count} date_text={date_text}
      session_duration={sessionDuration(Math.floor((now.getTime() - started_at) / 1_000))} onSettings={onSettings} />
    <div className="dan-select-layout">
      <aside className="dan-sidebar">
        <div className="dan-sidebar-heading"><button type="button" onClick={onExit} aria-label="Back"><ArrowLeft /></button>
          <h1>Dan Courses</h1></div>
        <div className="dan-mode-picker">
          <button type="button" className={mode === "osu" ? "active" : ""} onClick={() => onMode("osu")}>osu!standard</button>
          <button type="button" className={mode === "mania" ? "active" : ""} onClick={() => onMode("mania")}>4K Mania</button>
        </div>
        <nav className="dan-course-list" aria-label="Dan courses">
        {courses.map((candidate, index) => <button type="button" key={candidate.id}
          className={course?.id === candidate.id ? "active" : ""} onClick={() => onSelect(candidate.id)}>
          <span>{String(index + 1).padStart(2, "0")}</span><strong>{candidate.name}</strong>
        </button>)}
        </nav>
      </aside>
      {course ? <section className="dan-course-detail">
        <div className="dan-course-title"><div><h2>{course.name}</h2></div></div>
        <div className="dan-stage-grid">
          {course.stages.map((stage, index) => <article className="dan-stage-card" key={stage.chart.id}>
            {stage.chart.background_url && <img src={stage.chart.background_url} alt="" />}
            <span>STAGE {index + 1}</span><div><strong>{stage.song.title}</strong><p>{stage.song.artist}</p>
              <small>{stage.chart.name}</small></div>
          </article>)}
        </div>
        <div className="dan-course-actions">
          <div className="dan-course-stat"><small>Total length</small>
            <strong>{courseDuration(course.stages.reduce((total, stage) => total + stage.chart.duration_seconds, 0))}</strong>
          </div>
          <div className="dan-course-stat dan-course-goal"><small>Clear goal</small>
            <strong>{(course.goal_accuracy * 100).toFixed(0)}%</strong>
          </div>
          <button className="dan-start" type="button" onClick={() => onStart(course)}>
            Start course <Play aria-hidden="true" fill="currentColor" />
          </button>
        </div>
      </section> : <section className="dan-course-detail dan-unavailable"><LockKeyhole />
        <h2>No courses yet</h2><p>There are no {mode === "osu" ? "osu!standard" : "4K Mania"} courses available.</p></section>}
    </div>
  </main>;
}
