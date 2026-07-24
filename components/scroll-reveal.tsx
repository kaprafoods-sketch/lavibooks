"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Scroll-reveal for the light pages. Finds block-level content (.card, h1, and
 * anything tagged [data-reveal]) and eases it up + fades it in as it enters the
 * viewport, with a small stagger per batch. Re-scans on route change.
 *
 * Choreography rules from the 3d-hero-frontend skill: no linear easing, reveal
 * (don't pop), respect prefers-reduced-motion, and never leave content stuck
 * hidden — a failsafe reveals anything the observer missed.
 *
 * The dark Command Center ([data-terminal]) is excluded — it runs its own
 * WebGL scroll-driven motion.
 */
export function ScrollReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!document.documentElement.classList.contains("reveal-ready")) return;

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("main .card, main h1, main [data-reveal]"),
    ).filter((el) => !el.closest("[data-terminal]"));

    if (nodes.length === 0) return;

    const reveal = (el: HTMLElement, delayMs = 0) => {
      el.style.transitionDelay = `${delayMs}ms`;
      el.classList.add("reveal-in");
    };

    const io = new IntersectionObserver(
      (entries) => {
        let i = 0;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const el = e.target as HTMLElement;
          io.unobserve(el);
          reveal(el, Math.min(i, 6) * 70); // stagger within the batch
          i++;
        }
      },
      { threshold: 0.06, rootMargin: "0px 0px -6% 0px" },
    );

    nodes.forEach((el) => {
      el.classList.remove("reveal-in");
      el.style.transitionDelay = "";
      io.observe(el);
    });

    // Failsafe: if anything is still hidden after 2.5s (observer edge cases,
    // tiny pages that never scroll), reveal it so nothing stays invisible.
    const failsafe = window.setTimeout(() => {
      nodes.forEach((el) => reveal(el));
    }, 2500);

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, [pathname]);

  return null;
}
