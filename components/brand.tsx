import Link from "next/link";

/**
 * LV monogram — Lavi Books. Original luxe-inspired mark (NOT the real Louis
 * Vuitton wordmark/asset). Light-theme: black mark on white.
 */
export function Monogram({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center border border-black bg-white font-heading font-bold tracking-tight text-black"
      style={{ width: size, height: size, fontSize: size * 0.42, borderRadius: 8 }}
      aria-label="Lavi Books"
    >
      LV
    </span>
  );
}

export function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Monogram size={32} />
      <span className="font-heading text-sm font-semibold tracking-[0.2em] text-neutral-100">
        LAVI&nbsp;BOOKS
      </span>
    </Link>
  );
}
