"use strict";

try {
  const savedTheme = localStorage.getItem("jpw.theme");
  if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
} catch {}

const themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
const currentTheme = () =>
  document.documentElement.dataset.theme || (themeMedia.matches ? "dark" : "light");

document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");

  function updateThemeToggle() {
    const dark = currentTheme() === "dark";
    themeToggle.textContent = dark ? "☀ Light" : "☾ Dark";
    themeToggle.setAttribute("aria-label", `Switch to ${dark ? "light" : "dark"} theme`);
  }

  themeToggle.addEventListener("click", () => {
    const theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("jpw.theme", theme);
    } catch {
      // Theme still changes for this page when storage is unavailable.
    }
    updateThemeToggle();
  });

  themeMedia.addEventListener("change", () => {
    if (!document.documentElement.dataset.theme) updateThemeToggle();
  });
  updateThemeToggle();
});
