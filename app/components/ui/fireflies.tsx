import { useEffect, useRef } from "react";

interface Firefly {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  brightness: number;
  phase: number;
  speed: number;
}

export function Fireflies({ count = 25 }: { count?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const firefliesRef = useRef<Firefly[]>([]);
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    // Initialize fireflies
    firefliesRef.current = Array.from({ length: count }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.4,
      size: 1.5 + Math.random() * 2,
      brightness: Math.random(),
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5,
    }));

    const animate = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const f of firefliesRef.current) {
        // Drift
        f.x += f.vx * f.speed;
        f.y += f.vy * f.speed;

        // Gentle wobble
        f.vx += (Math.random() - 0.5) * 0.05;
        f.vy += (Math.random() - 0.5) * 0.05;
        f.vx *= 0.99;
        f.vy *= 0.99;

        // Wrap around
        if (f.x < -20) f.x = canvas.width + 20;
        if (f.x > canvas.width + 20) f.x = -20;
        if (f.y < -20) f.y = canvas.height + 20;
        if (f.y > canvas.height + 20) f.y = -20;

        // Pulsing glow
        const pulse = Math.sin(time * 0.002 * f.speed + f.phase) * 0.5 + 0.5;
        const alpha = 0.15 + pulse * 0.6;

        // Outer glow
        const gradient = ctx.createRadialGradient(
          f.x, f.y, 0,
          f.x, f.y, f.size * 6
        );
        gradient.addColorStop(0, `rgba(212, 180, 50, ${alpha * 0.8})`);
        gradient.addColorStop(0.3, `rgba(150, 200, 80, ${alpha * 0.3})`);
        gradient.addColorStop(1, "rgba(61, 220, 132, 0)");

        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * 6, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Inner bright core
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 240, 150, ${alpha})`;
        ctx.fill();
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [count]);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      aria-hidden="true"
    />
  );
}
