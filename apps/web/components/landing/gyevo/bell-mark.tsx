export function BrandLogo({ size = 40 }: { size?: number; priority?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        background: "#171717",
        border: "1px solid currentColor",
        borderRadius: 7,
        color: "#C7444F",
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
