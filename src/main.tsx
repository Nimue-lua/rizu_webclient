import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./ui/default/app.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing application root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
