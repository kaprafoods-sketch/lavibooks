import Link from "next/link";

/** LV monogram — Lavi Books. Original luxe-inspired mark (not a real brand's asset). */
export function Monogram({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md border border-gold/60 bg-ink-800 font-mono font-bold tracking-tight text-gold"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
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
      <span className="text-sm font-semibold tracking-widest text-neutral-100">
        LAVI&nbsp;BOOKS
      </span>
    </Link>
  );
}
