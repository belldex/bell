export function BrandLogo({ size = 40 }: { size?: number; priority?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: "#101112",
        border: "1px solid currentColor",
        borderRadius: 7,
        color: "#AEB2B5",
        display: "inline-flex",
        flex: "none",
        font: `700 ${Math.round(size * 0.48)}px/1 var(--lp-font-display)`,
        height: size,
        justifyContent: "center",
        width: size,
      }}
    >
      B
    </span>
  );
}
