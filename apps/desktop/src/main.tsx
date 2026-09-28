import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/global.css";
import "./styles/app.css";

// Pas de menu contextuel du navigateur (« Actualiser », « Imprimer »…) dans une app de
// bureau — sauf dans les champs de saisie et le texte sélectionnable (copier / coller).
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, .selectable")) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
