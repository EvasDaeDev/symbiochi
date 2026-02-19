// content/icons.js
// Centralized icon sources + small helpers for UI.

// Reuse the same SVGs as action buttons (carrot / drop / cross / coin).
// Stored as full CSS-ready values so they can be injected as CSS variables.

export const ICON_URLS = {
  carrot: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath d='M5 2c.9 1.2 2.2 1.6 3.6 1.5C7.7 4.4 6.8 5.1 6.2 5.8c-1.6 1.8-2.3 3.7-1.7 4.7.7 1.1 2.8.8 4.7-.8 1.9-1.6 3-3.9 2.4-5.2-.4-1-1.5-1.6-2.9-1.6.2-.6.3-1.1.2-1.8-.9.7-1.9.9-3.1.9C5.5 1.8 5.2 1.9 5 2z' fill='%23f59e0b'/%3E%3Cpath d='M4.2 1.8c.7 1 1.6 1.6 2.8 1.8-.9.5-1.7.9-2.4 1.6-.2-.9-.3-2.2-.4-3.4z' fill='%2322c55e'/%3E%3C/svg%3E\")",
  drop:   "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Cpath d='M7 1.5c2.3 3.1 4.2 5.3 4.2 7.3A4.2 4.2 0 1 1 2.8 8.8C2.8 6.8 4.7 4.6 7 1.5z' fill='%2322d3ee' stroke='%230ea5b7' stroke-width='1'/%3E%3C/svg%3E\")",
  cross:  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Crect x='5.6' y='2.2' width='2.8' height='9.6' rx='0.6' fill='%23ef4444'/%3E%3Crect x='2.2' y='5.6' width='9.6' height='2.8' rx='0.6' fill='%23ef4444'/%3E%3C/svg%3E\")",
  coin:   "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 14 14'%3E%3Ccircle cx='7' cy='7' r='5.5' fill='%23fbbf24' stroke='%23a16207' stroke-width='1'/%3E%3Ccircle cx='7' cy='7' r='3.3' fill='none' stroke='%23fde68a' stroke-width='1'/%3E%3C/svg%3E\")",
};

// Apply icon URLs as CSS variables so both buttons and stat pills reuse the same source.
export function applyIconCssVars(){
  const r = document.documentElement;
  r.style.setProperty('--ico-carrot', ICON_URLS.carrot);
  r.style.setProperty('--ico-drop',   ICON_URLS.drop);
  r.style.setProperty('--ico-cross',  ICON_URLS.cross);
  r.style.setProperty('--ico-coin',   ICON_URLS.coin);
}

export function moodEmoji(p01){
  // p01 is 0..1 (or 0..1.4, we clamp)
  const p = Math.max(0, Math.min(1, Number.isFinite(p01) ? p01 : 0));
  if (p >= 0.75) return "😀";
  if (p >= 0.50) return "🙂";
  if (p >= 0.30) return "😐";
  if (p >= 0.15) return "🙁";
  return "😡";
}

export function stateEmoji(statusTxt){
  // Keep distinct from mood emojis.
  switch (String(statusTxt || "")){
    case "хорошо":
    case "норма":
      return "✨";
    case "плохо":
      return "🤕";
    case "критично":
	  return "🤢";
    case "анабиоз":
      return "❄️";
    case "усыхание":
      return "☠️";
    default:
      return "🌱";
  }
}
