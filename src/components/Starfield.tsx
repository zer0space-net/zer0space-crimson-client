import { useEffect, useRef } from "react";

// The zer0space starfield, on a canvas behind everything. Drifting points with a
// faint crimson twinkle — decorative only, aria-hidden, and disabled under
// reduced-motion. Mirrors the dashboard's starfield in spirit.
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let stars: { x: number; y: number; z: number; r: number }[] = [];
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      canvas!.width = window.innerWidth * DPR;
      canvas!.height = window.innerHeight * DPR;
      const count = Math.min(220, Math.floor((window.innerWidth * window.innerHeight) / 9000));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas!.width,
        y: Math.random() * canvas!.height,
        z: Math.random() * 0.6 + 0.4,
        r: Math.random() * 1.3 + 0.3,
      }));
    }

    function frame() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      for (const s of stars) {
        s.y += s.z * 0.12 * DPR;
        if (s.y > canvas!.height) s.y = 0;
        const tw = 0.4 + Math.random() * 0.6;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r * DPR, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(229, 130, 150, ${0.18 * s.z * tw})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    if (!reduce) frame();
    else {
      // One static paint is enough when motion is disabled.
      for (const s of stars) {
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * DPR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(229, 130, 150, ${0.16 * s.z})`;
        ctx.fill();
      }
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas id="starfield" ref={ref} aria-hidden="true" />;
}
