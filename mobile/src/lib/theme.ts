export type ThemeName = "dark" | "light";

export type Theme = {
  name: ThemeName;
  statusBarStyle: "light" | "dark";
  colors: {
    background: string;
    panel: string;
    panelMuted: string;
    border: string;
    borderSubtle: string;
    divider: string;
    button: string;
    buttonMuted: string;
    text: string;
    textMuted: string;
    textSubtle: string;
    placeholder: string;
    error: string;
  };
};

export const themes: Record<ThemeName, Theme> = {
  dark: {
    name: "dark",
    statusBarStyle: "light",
    colors: {
      background: "#0b0b0b",
      panel: "#111112",
      panelMuted: "#141416",
      border: "#222326",
      borderSubtle: "#232427",
      divider: "#1f2023",
      button: "#1c1d20",
      buttonMuted: "#191a1c",
      text: "#ffffff",
      textMuted: "#9aa0a6",
      textSubtle: "#7d828a",
      placeholder: "#7d828a",
      error: "#ffb4b4",
    },
  },
  light: {
    name: "light",
    statusBarStyle: "dark",
    colors: {
      background: "#fafafa",
      panel: "#ffffff",
      panelMuted: "#f3f4f6",
      border: "#e5e7eb",
      borderSubtle: "#d1d5db",
      divider: "#e5e7eb",
      button: "#e5e7eb",
      buttonMuted: "#f3f4f6",
      text: "#0b0b0b",
      textMuted: "#4b5563",
      textSubtle: "#6b7280",
      placeholder: "#6b7280",
      error: "#b91c1c",
    },
  },
};

