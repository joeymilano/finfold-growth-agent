import "@fontsource/noto-serif-sc/900.css";

/**
 * Growth Almanac — hand-drawn press marks.
 *
 * Every stroke is a deliberately imperfect SVG path (wobble in the control
 * points, overshoot past the endpoints) so annotations read as ink on paper,
 * not as geometric UI decoration. Vermilion is the only accent; it is always
 * opaque, never blurred or gradient — that flatness is what keeps the print
 * illusion. Stroke widths scale with the `size` prop so marks stay legible
 * when wrapping inline display text.
 */

export function InkUnderline({ className, width = 220 }: { className?: string; width?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 220 14"
      width={width}
      height={(14 * width) / 220}
      preserveAspectRatio="none"
      className={className}
      fill="none"
    >
      {/* Two overlapping passes of a loaded brush: the second is shorter and
          heavier, like the wrist settling on the second stroke. */}
      <path
        d="M3 9.5C38 4.5 92 3.4 132 5.2 164 6.6 196 8.4 216 9.8"
        stroke="rgb(191 38 32)"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <path
        d="M26 11.8C64 8.6 118 8.2 158 9.6 176 10.2 190 11 200 11.8"
        stroke="rgb(191 38 32)"
        strokeWidth="2.6"
        strokeLinecap="round"
        opacity=".82"
      />
    </svg>
  );
}

export function InkCircle({ className, size = 128 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 128 64"
      width={size}
      height={(64 * size) / 128}
      className={className}
      fill="none"
      preserveAspectRatio="none"
    >
      {/* An ellipse drawn in one nervous gesture — the ends deliberately do
          not meet, like a reader circling a word with a felt pen. */}
      <path
        d="M63 5C30 4 7 15 5.5 31.5 4 49 30 60 63.5 59.5 98 59 122 47.5 122.5 30.5 123 14.5 98 4.5 66 5.4"
        stroke="rgb(191 38 32)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
      <path
        d="M66 6.8C72 6 79 5.6 86 6.2"
        stroke="rgb(191 38 32)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity=".8"
      />
    </svg>
  );
}

export function InkArrow({ className, width = 96 }: { className?: string; width?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 72"
      width={width}
      height={(72 * width) / 96}
      className={className}
      fill="none"
    >
      <path
        d="M6 8C22 30 40 46 66 54"
        stroke="rgb(191 38 32)"
        strokeWidth="3.6"
        strokeLinecap="round"
      />
      <path
        d="M52 49.5 68 55.5 60.5 40.5"
        stroke="rgb(191 38 32)"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 印章 — the vermilion seal. Rotated a hair off-axis, thick paper border
 * inside a solid red field, single 宋体 character. Used as the masthead
 * stamp; also small enough to badge the featured pricing plan.
 */
export function VermilionSeal({
  character = "增",
  size = 56,
  className,
  label
}: {
  character?: string;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      className={className}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: size,
        height: size,
        background: "rgb(191 38 32)",
        color: "rgb(250 247 240)",
        fontFamily: '"Noto Serif SC", serif',
        fontWeight: 900,
        fontSize: size * 0.52,
        lineHeight: 1,
        borderRadius: size * 0.12,
        boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.055)}px rgb(250 247 240), inset 0 0 0 ${Math.max(4, size * 0.09)}px rgb(191 38 32)`,
        transform: "rotate(-2.5deg)",
        userSelect: "none"
      }}
    >
      {character}
    </span>
  );
}
