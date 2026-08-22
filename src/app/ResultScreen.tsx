import { useEffect } from "react";

interface ResultScreenProps {
  onExit: () => void;
}

export function ResultScreen({ onExit }: ResultScreenProps) {
  useEffect(() => {
    const handle_key_down = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        onExit();
      }
    };

    window.addEventListener("keydown", handle_key_down);
    return () => window.removeEventListener("keydown", handle_key_down);
  }, [onExit]);

  return (
    <main className="screen result-screen">
      <span>TODO</span>
    </main>
  );
}
