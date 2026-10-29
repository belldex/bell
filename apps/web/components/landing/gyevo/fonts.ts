import localFont from "next/font/local";

export const quicksandUi = localFont({
  src: [
    { path: "../../../app/fonts/gyevo/quicksand-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--lp-font-ui",
  display: "swap",
});

export const quicksandDisplay = localFont({
  src: [
    { path: "../../../app/fonts/gyevo/quicksand-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../../app/fonts/gyevo/quicksand-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--lp-font-display",
  display: "swap",
  preload: false,
});

export const jetbrainsMono = localFont({
  src: [
    { path: "../../../app/fonts/gyevo/jetbrains-mono-latin-400-normal.woff2", weight: "400" },
    { path: "../../../app/fonts/gyevo/jetbrains-mono-latin-500-normal.woff2", weight: "500" },
  ],
  variable: "--lp-font-mono",
  display: "swap",
});
