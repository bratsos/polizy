import { createRoot } from "react-dom/client";
import "./app.css";
import { BootGate } from "./components/BootGate.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

// BootGate renders the loading screen immediately, then boots a real Postgres in
// the browser (PGlite/WASM, persisted in IndexedDB) before showing the app.
createRoot(root).render(<BootGate />);
