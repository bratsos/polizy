import { createRoot } from "react-dom/client";
import "./app.css";
import { BootGate } from "./components/BootGate.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(<BootGate />);
