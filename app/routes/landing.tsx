/**
 * Public landing page at "/".
 * An arcane hunter's codex set in the game's enchanted forest: the painted
 * forest backdrop and fireflies from the game itself, a turning sigil-map of
 * the world (the eight lands, the Blighted ring, the Rift at its eye),
 * how-it-works chapters, and the biomes as forest-framed cards.
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "@clerk/react";
import { GAME_PATHS } from "~/lib/gameRoutes";
import { Fireflies } from "~/components/ui/fireflies";
import {
  FELLOWSHIP,
  GAME_NAME,
  MAIN_BIOMES,
  PILLARS,
  TAGLINE,
} from "~/components/landing/landingContent";
import swordIcon from "~/assets/icons/sword.svg";
import ingotIcon from "~/assets/icons/ingot.png";
import potionIcon from "~/assets/icons/alchemyPotion.svg";
import shieldIcon from "~/assets/icons/shield.svg";
import chestIcon from "~/assets/icons/chest.svg";
import bowIcon from "~/assets/icons/bow.svg";

/** Element accents, drawn from the game's palette (app/app.css). */
const ELEMENT_COLOR: Record<string, string> = {
  earth: "#3ddc84", // forest-glow
  light: "#f0d060", // gold-light
  dark: "#a78bfa", // mystic-glow
  water: "#4fc3f7", // potion-blue
  fire: "#e5824f",
  wind: "#9fe0c0",
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
const PILLAR_ICONS: Record<string, string> = { hunt: swordIcon, craft: ingotIcon, rebirth: potionIcon };
const FELLOWSHIP_ICONS = [shieldIcon, chestIcon, bowIcon];

/** A game icon tinted gold through a CSS mask. */
function GlyphIcon({ src, className = "" }: { src: string; className?: string }) {
  return (
    <span
      className={`gw-glyph ${className}`}
      style={{ maskImage: `url("${src}")`, WebkitMaskImage: `url("${src}")` }}
      aria-hidden
    />
  );
}

/** Gold filigree that sits on the seam between two sections. */
function Flourish() {
  return (
    <svg
      viewBox="0 0 400 40"
      className="gw-flourish pointer-events-none absolute left-1/2 top-0 z-10 w-[min(420px,80vw)] -translate-x-1/2 -translate-y-1/2"
      aria-hidden
    >
      <defs>
        <linearGradient id="gw-fl" x1="0" x2="1">
          <stop offset="0" stopColor="#d4a017" stopOpacity="0" />
          <stop offset=".35" stopColor="#d4a017" />
          <stop offset=".5" stopColor="#f0d060" />
          <stop offset=".65" stopColor="#d4a017" />
          <stop offset="1" stopColor="#d4a017" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="url(#gw-fl)" strokeWidth="1.3" strokeLinecap="round">
        <path d="M10 20 H160" />
        <path d="M390 20 H240" />
        <path d="M160 20 C170 20 172 8 181 9 C189 10 188 21 180 20 C176 19 176 15 179 14" />
        <path d="M240 20 C230 20 228 8 219 9 C211 10 212 21 220 20 C224 19 224 15 221 14" />
        <path d="M160 20 C170 20 172 32 181 31 C186 30 187 26 184 25" />
        <path d="M240 20 C230 20 228 32 219 31 C214 30 213 26 216 25" />
      </g>
      <path d="M200 7 L213 20 L200 33 L187 20 Z" fill="#0a2818" stroke="#f0d060" strokeWidth="1.3" />
      <path d="M200 14 L206 20 L200 26 L194 20 Z" fill="#3ddc84" className="gw-flourish-gem" />
      <circle cx="140" cy="20" r="1.8" fill="#f0d060" />
      <circle cx="260" cy="20" r="1.8" fill="#f0d060" />
    </svg>
  );
}

function Sigil() {
  const outer = MAIN_BIOMES.map((b) => b.name.toUpperCase()).join("  ✦  ") + "  ✦  ";
  return (
    <svg viewBox="0 0 500 500" className="gw-sigil h-auto w-full max-w-[520px]" aria-hidden>
      <defs>
        <path id="gw-ring-outer" d="M250 250 m-205 0 a205 205 0 1 1 410 0 a205 205 0 1 1 -410 0" />
        <path id="gw-ring-mid" d="M250 250 m-140 0 a140 140 0 1 1 280 0 a140 140 0 1 1 -280 0" />
        <radialGradient id="gw-backing" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0a2818" stopOpacity=".95" />
          <stop offset="80%" stopColor="#0a2818" stopOpacity=".85" />
          <stop offset="100%" stopColor="#0a2818" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="gw-eye" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd9c2" />
          <stop offset="30%" stopColor="#cc3333" />
          <stop offset="75%" stopColor="#5a0f0f" />
          <stop offset="100%" stopColor="#0a2818" stopOpacity="0" />
        </radialGradient>
        <filter id="gw-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <circle cx="250" cy="250" r="248" fill="url(#gw-backing)" />

      {/* Fine tick ring, like a compass bezel */}
      <g stroke="#d4a017" strokeOpacity=".45">
        {Array.from({ length: 96 }, (_, i) => {
          const a = (i / 96) * Math.PI * 2;
          const long = i % 12 === 0;
          const r1 = 236;
          const r2 = long ? 246 : 241;
          return (
            <line key={i} x1={250 + Math.cos(a) * r1} y1={250 + Math.sin(a) * r1} x2={250 + Math.cos(a) * r2} y2={250 + Math.sin(a) * r2} strokeWidth={long ? 1.4 : 0.8} />
          );
        })}
      </g>

      {/* Outer ring: the eight lands, each marked in its element's color */}
      <g className="gw-spin" style={{ animationDuration: "140s" }}>
        <circle cx="250" cy="250" r="228" fill="none" stroke="#d4a017" strokeOpacity=".6" />
        <circle cx="250" cy="250" r="190" fill="none" stroke="#d4a017" strokeOpacity=".4" />
        <text fill="#f5e6c8" fontSize="13" letterSpacing="3.2" className="font-heading">
          <textPath href="#gw-ring-outer" textLength="1270">{outer}</textPath>
        </text>
        {MAIN_BIOMES.map((b, i) => {
          const a = (i / 8) * Math.PI * 2;
          const color = ELEMENT_COLOR[b.element] ?? "#f0d060";
          const x = 250 + Math.cos(a) * 228;
          const y = 250 + Math.sin(a) * 228;
          return (
            <g key={b.tier}>
              <circle cx={x} cy={y} r="7" fill={color} opacity=".45" filter="url(#gw-soft)" />
              <circle cx={x} cy={y} r="3.6" fill={color} />
            </g>
          );
        })}
        {/* A spark travelling the outer ring */}
        <circle cx="250" cy="22" r="3" fill="#fff6d8" className="gw-spark" />
      </g>

      {/* Middle ring: the Blighted (the game's mystic purple) */}
      <g className="gw-spin gw-spin--rev" style={{ animationDuration: "90s" }}>
        <circle cx="250" cy="250" r="160" fill="none" stroke="#a78bfa" strokeOpacity=".55" strokeDasharray="2 6" />
        <circle cx="250" cy="250" r="122" fill="none" stroke="#a78bfa" strokeOpacity=".35" />
        <text fill="#c4b5fd" fontSize="12" letterSpacing="5" className="font-heading">
          <textPath href="#gw-ring-mid" textLength="870">
            THE BLIGHTED  ·  WHAT WAS FAIR IS TWISTED  ·  THE BLIGHTED  ·  WHAT WAS FAIR IS TWISTED  ·
          </textPath>
        </text>
      </g>

      {/* Star of rays */}
      <g className="gw-spin" style={{ animationDuration: "60s" }} stroke="#3ddc84" strokeOpacity=".35">
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const r1 = 62;
          const r2 = i % 2 ? 100 : 118;
          return (
            <line key={i} x1={250 + Math.cos(a) * r1} y1={250 + Math.sin(a) * r1} x2={250 + Math.cos(a) * r2} y2={250 + Math.sin(a) * r2} />
          );
        })}
      </g>

      {/* The Rift: the eye */}
      <circle cx="250" cy="250" r="86" fill="#cc3333" opacity=".18" filter="url(#gw-soft)" className="gw-eye" />
      <circle cx="250" cy="250" r="70" fill="url(#gw-eye)" className="gw-eye" />
      <path d="M250 205 C262 230 262 270 250 295 C238 270 238 230 250 205 Z" fill="#0a2818" />
      <ellipse cx="243" cy="232" rx="2.4" ry="5" fill="#fff" opacity=".5" />
    </svg>
  );
}

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const { isSignedIn } = useAuth();

  const playLabel = isSignedIn ? "Continue your hunt" : "Play free";
  const navLabel = isSignedIn ? "Continue" : "Play now";

  // Sticky nav gains a backdrop once the page scrolls.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Sections fade up as they enter view. Without JS or with reduced motion
  // everything is simply visible.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Hero entrance. If animations stall (background tab, throttled frame),
    // the fallback makes sure the hero is never left invisible.
    root.classList.add("gw-anim");
    const settle = window.setTimeout(() => root.classList.add("gw-settled"), 2500);
    if (!("IntersectionObserver" in window)) return () => window.clearTimeout(settle);
    root.classList.add("gw-reveal-on");
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => {
      window.clearTimeout(settle);
      io.disconnect();
    };
  }, []);

  return (
    <div ref={rootRef} className="gw-landing forest-bg relative min-h-screen overflow-x-hidden text-parchment">
      <style>{LANDING_CSS}</style>
      <Fireflies count={30} />

      {/* ── Sticky nav ──────────────────────────────── */}
      <nav className={`gw-nav fixed inset-x-0 top-0 z-40 ${scrolled ? "is-scrolled" : ""}`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-8">
          <a href="#top" className="font-heading text-lg tracking-[0.2em] text-gold glow-gold">
            {GAME_NAME.toUpperCase()}
          </a>
          <Link to={GAME_PATHS.combat} className="gw-btn-ghost px-4 py-1.5 text-sm">
            {navLabel}
          </Link>
        </div>
      </nav>

      <div className="relative z-10">
        {/* ── Hero ───────────────────────────────────── */}
        <header id="top" className="gw-hero relative overflow-hidden px-4 pb-24 pt-20 sm:px-8">
          <div className="gw-rays" aria-hidden>
            <span /><span /><span /><span />
          </div>

          <div className="relative mx-auto mt-6 grid max-w-6xl items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
            <div className="order-2 text-center lg:order-1 lg:text-left">
              <p className="gw-rise text-[11px] uppercase tracking-[0.28em] text-forest-glow/80 sm:text-xs sm:tracking-[0.45em]" style={{ ["--d" as string]: ".05s" }}>
                Free idle RPG · Play in your browser
              </p>
              <h1 className="gw-title gw-rise mt-4 font-heading text-6xl leading-[0.95] sm:text-8xl" style={{ ["--d" as string]: ".15s" }}>
                {GAME_NAME}
              </h1>
              <div className="gw-rule gw-rise mx-auto my-6 lg:mx-0" style={{ ["--d" as string]: ".3s" }} aria-hidden />
              <p className="gw-rise font-[Playfair_Display_Variable,serif] text-xl italic text-gold-light sm:text-2xl" style={{ ["--d" as string]: ".4s" }}>
                {TAGLINE}
              </p>
              <p className="gw-rise mx-auto mt-5 max-w-md leading-relaxed text-parchment-dark lg:mx-0" style={{ ["--d" as string]: ".5s" }}>
                Hunt monsters, craft gear from what they drop, and keep getting stronger even while
                you're offline. Fight your way through eight lands to the Rift at the heart of the world.
              </p>
              <div className="gw-rise mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center lg:justify-start" style={{ ["--d" as string]: ".65s" }}>
                <Link to={GAME_PATHS.combat} className="gw-btn px-8 py-3 font-semibold">
                  {playLabel}
                </Link>
                <a href="#lands" className="gw-btn-ghost px-8 py-3">Explore the world</a>
              </div>
              <ul className="gw-rise mt-8 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-parchment-dark lg:justify-start" style={{ ["--d" as string]: ".8s" }}>
                <li className="gw-fact">20 tiers to conquer</li>
                <li className="gw-fact">Progress while offline</li>
                <li className="gw-fact">Guilds, trading &amp; PvP</li>
              </ul>
            </div>
            <div className="gw-rise order-1 flex justify-center lg:order-2" style={{ ["--d" as string]: ".2s" }}>
              <Sigil />
            </div>
          </div>

          <a href="#how" className="gw-scroll-cue absolute bottom-12 left-1/2 hidden -translate-x-1/2 sm:block" aria-label="Scroll to how the hunt works">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#f0d060" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </a>
        </header>

        {/* ── How it works ───────────────────────────── */}
        <section id="how" className="gw-page relative px-4 py-24 sm:px-8">
          <Flourish />
          <h2 data-reveal className="text-center font-heading text-4xl text-gold glow-gold sm:text-5xl">How the hunt works</h2>
          <div className="mx-auto mt-12 max-w-4xl space-y-6">
            {PILLARS.map((p, i) => (
              <div key={p.key} data-reveal style={{ ["--d" as string]: `${i * 0.08}s` }}>
                <article className="forest-card gw-chapter relative grid items-center gap-5 p-6 sm:grid-cols-[96px_1fr] sm:gap-8 sm:p-8">
                  <span className="gw-corners" aria-hidden />
                  <div className="gw-medallion mx-auto sm:mx-0">
                    <GlyphIcon src={PILLAR_ICONS[p.key]} className="h-10 w-10" />
                  </div>
                  <div className="text-center sm:text-left">
                    <p className="font-heading text-xs tracking-[0.35em] text-gold/80">CHAPTER {ROMAN[i]}</p>
                    <h3 className="mt-1 font-heading text-3xl text-gold-light sm:text-4xl">{p.title}</h3>
                    <p className="mt-3 text-lg leading-relaxed text-parchment-dark">{p.body}</p>
                  </div>
                </article>
              </div>
            ))}
          </div>
        </section>

        {/* ── The lands ──────────────────────────────── */}
        <section id="lands" className="gw-lands relative px-4 py-24 sm:px-8">
          <Flourish />
          <div className="mx-auto max-w-6xl">
            <div data-reveal>
              <h2 className="text-center font-heading text-4xl text-gold glow-gold sm:text-5xl">Eight lands to conquer</h2>
              <p className="mx-auto mt-3 max-w-xl text-center text-parchment-dark">
                Each land has its own monsters, its own materials and a fearsome apex predator. Gear up to push deeper.
              </p>
            </div>

            <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {MAIN_BIOMES.map((b, i) => (
                <div key={b.tier} data-reveal style={{ ["--d" as string]: `${(i % 4) * 0.07}s` }}>
                  <div
                    className="forest-card gw-card relative flex aspect-[3/4.4] flex-col items-center justify-between p-4 text-center"
                    style={{ ["--el" as string]: ELEMENT_COLOR[b.element] ?? "#d4a017" }}
                  >
                    <span className="gw-corners" aria-hidden />
                    <span className="font-heading text-sm tracking-[0.3em] text-gold">{ROMAN[i]}</span>
                    <span className="gw-gem" aria-hidden>
                      <span className="gw-gem-core" />
                      <span className="gw-gem-glint" />
                    </span>
                    <div>
                      <h3 className="font-heading text-lg leading-tight text-parchment sm:text-xl">{b.name}</h3>
                      <p className="mt-1 text-[11px] uppercase tracking-wider text-parchment-dark/70">Apex</p>
                      <p className="gw-card-apex text-xs text-parchment-dark">{b.apex}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div data-reveal>
                <div className="gw-banner gw-banner--blight relative h-full overflow-hidden p-7">
                  <span className="gw-motes" aria-hidden />
                  <p className="relative text-xs uppercase tracking-[0.3em] text-mystic-glow">Tiers 9–16 · After the eight lands</p>
                  <h3 className="relative mt-2 font-heading text-3xl text-[#d9cdfd] glow-purple">The Blighted</h3>
                  <p className="relative mt-2 text-[#c9bfe6]">Every land returns corrupted. The same monsters, tougher and meaner, dropping upgraded materials.</p>
                </div>
              </div>
              <div data-reveal style={{ ["--d" as string]: ".08s" }}>
                <div className="gw-banner gw-banner--rift relative h-full overflow-hidden p-7">
                  <svg className="gw-crack absolute inset-0 h-full w-full" viewBox="0 0 400 160" preserveAspectRatio="none" aria-hidden>
                    <path d="M400 18 L330 44 L352 60 L282 86 L300 98 L236 122 L250 132 L200 160" fill="none" stroke="#ff5a4a" strokeWidth="1.6" />
                    <path d="M330 44 L306 30 M282 86 L262 76 M236 122 L214 116" fill="none" stroke="#ff5a4a" strokeWidth="1" />
                  </svg>
                  <p className="relative text-xs uppercase tracking-[0.3em] text-blood-light">Tiers 17–20 · The endgame</p>
                  <h3 className="relative mt-2 font-heading text-3xl text-[#ffc9c9] glow-red">The Rift</h3>
                  <p className="relative mt-2 text-[#e3b3b3]">The deadliest monsters from every land in one place, and the only source of Rift Shards.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Hunt with others ───────────────────────── */}
        <section className="gw-page relative px-4 py-24 sm:px-8">
          <Flourish />
          <div className="mx-auto max-w-5xl">
            <h2 data-reveal className="text-center font-heading text-4xl text-gold glow-gold sm:text-5xl">Hunt with others</h2>
            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              {FELLOWSHIP.map((f, i) => (
                <div key={f.title} data-reveal style={{ ["--d" as string]: `${i * 0.08}s` }}>
                  <div className="forest-panel gw-panel relative h-full p-6 text-center">
                    <div className="gw-medallion gw-medallion--sm mx-auto mb-4">
                      <GlyphIcon src={FELLOWSHIP_ICONS[i]} className="h-6 w-6" />
                    </div>
                    <h3 className="font-heading text-2xl text-gold-light">{f.title}</h3>
                    <p className="mt-2 text-parchment-dark">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Final call ─────────────────────────────── */}
        <section className="gw-finale relative px-4 py-32 text-center">
          <Flourish />
          <div data-reveal>
            <p className="text-xs uppercase tracking-[0.45em] text-forest-glow/80">Free to play · No download</p>
            <h2 className="gw-title mt-4 font-heading text-5xl sm:text-7xl">Your hunt starts tonight.</h2>
            <p className="mx-auto mt-4 max-w-md text-parchment-dark">
              Make an account, name your hunter and start playing on desktop or mobile.
            </p>
            <div className="gw-halo relative mt-10 inline-block">
              <Link to={GAME_PATHS.combat} className="gw-btn relative inline-block px-10 py-3.5 font-semibold">
                {isSignedIn ? "Continue your hunt" : "Start hunting"}
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-gold/15 bg-forest-deep/95 px-4 py-8 text-center text-sm text-moss">
          © {new Date().getFullYear()} {GAME_NAME}
        </footer>
      </div>
    </div>
  );
}

const LANDING_CSS = `
html { scroll-behavior: smooth; }
#how, #lands { scroll-margin-top: 56px; }

/* Nav */
.gw-nav { transition: background .3s, box-shadow .3s, backdrop-filter .3s; }
.gw-nav.is-scrolled {
  background: rgba(10,40,24,.82);
  backdrop-filter: blur(10px);
  box-shadow: 0 1px 0 rgba(212,160,23,.18), 0 10px 30px -20px #000;
}

/* Backgrounds */
.gw-hero {
  background: linear-gradient(90deg, rgba(10,40,24,.94) 0%, rgba(10,40,24,.78) 45%, rgba(10,40,24,.25) 100%);
}
.gw-hero::after {
  content: ""; position: absolute; inset: auto 0 0 0; height: 120px; pointer-events: none;
  background: linear-gradient(180deg, transparent, rgba(10,40,24,.9));
}
@media (max-width: 1023px) {
  .gw-hero { background: linear-gradient(180deg, rgba(10,40,24,.8) 0%, rgba(10,40,24,.45) 18%, rgba(10,40,24,.85) 55%, rgba(10,40,24,.95) 100%); }
}
.gw-page { background: rgba(10,40,24,.9); border-top: 1px solid rgba(212,160,23,.18); }
.gw-lands { background: linear-gradient(180deg, rgba(15,51,33,.82), rgba(10,40,24,.92)); border-top: 1px solid rgba(212,160,23,.18); }
.gw-finale {
  border-top: 1px solid rgba(212,160,23,.18);
  background:
    radial-gradient(50% 60% at 50% 60%, rgba(240,208,96,.12), transparent 70%),
    linear-gradient(180deg, rgba(10,40,24,.9), rgba(10,40,24,.5));
}

/* Light shafts through the canopy */
.gw-rays { position: absolute; top: -20%; left: 40%; width: 50%; height: 140%; pointer-events: none; mix-blend-mode: screen; }
.gw-rays span {
  position: absolute; top: 0; width: 70px; height: 100%;
  background: linear-gradient(180deg, rgba(240,208,96,0) 0%, rgba(240,208,96,.16) 35%, rgba(240,208,96,0) 90%);
  filter: blur(12px); transform-origin: top center;
  animation: gw-sway 9s ease-in-out infinite alternate;
}
.gw-rays span:nth-child(1) { left: 10%; transform: rotate(14deg); animation-delay: -2s; }
.gw-rays span:nth-child(2) { left: 35%; width: 110px; transform: rotate(9deg); animation-delay: -5s; opacity: .8; }
.gw-rays span:nth-child(3) { left: 58%; transform: rotate(5deg); animation-delay: -1s; }
.gw-rays span:nth-child(4) { left: 78%; width: 40px; transform: rotate(2deg); animation-delay: -7s; opacity: .7; }
@media (max-width: 1023px) { .gw-rays { left: 10%; width: 90%; } }

/* Title with a slow gold shimmer */
.gw-title {
  background:
    linear-gradient(110deg, transparent 40%, rgba(255,250,230,.85) 50%, transparent 60%) 0 0 / 250% 100% no-repeat,
    linear-gradient(180deg, #fff6d8 0%, #f0d060 45%, #d4a017 75%, #8b6914 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 18px rgba(212,160,23,.35));
  animation: gw-shimmer 7s ease-in-out infinite;
}
.gw-rule {
  width: 180px; height: 10px;
  background:
    radial-gradient(circle, #f0d060 0 3px, transparent 4px) center/10px 10px no-repeat,
    linear-gradient(90deg, transparent, #d4a017 30%, #3ddc84 50%, #d4a017 70%, transparent) center/100% 1px no-repeat;
}
.gw-fact { display: inline-flex; align-items: center; gap: .5rem; }
.gw-fact::before { content: ""; width: 7px; height: 7px; transform: rotate(45deg); background: #3ddc84; box-shadow: 0 0 8px #3ddc84; }

/* Buttons */
.gw-btn {
  background: linear-gradient(180deg, #f0d060, #d4a017 60%, #8b6914);
  color: #0a2818;
  clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%);
  transition: filter .2s, transform .2s;
}
.gw-btn:hover { filter: brightness(1.12); transform: translateY(-1px); }
.gw-btn:focus-visible, .gw-btn-ghost:focus-visible { outline: 2px solid #f0d060; outline-offset: 4px; }
.gw-btn-ghost {
  color: #f0d060; background: #1a4a30cc;
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0 50%);
  transition: background .2s;
}
.gw-btn-ghost:hover { background: #2d6b4a; }
.gw-halo::before {
  content: ""; position: absolute; inset: -18px -30px; border-radius: 999px; pointer-events: none;
  background: radial-gradient(closest-side, rgba(240,208,96,.35), transparent);
  animation: gw-halo 3.2s ease-in-out infinite;
}
.gw-scroll-cue { animation: gw-bob 2.4s ease-in-out infinite; opacity: .8; }

/* Sigil */
.gw-sigil { filter: drop-shadow(0 0 40px rgba(61,220,132,.18)); }
.gw-spin { transform-origin: 250px 250px; animation: gw-spin linear infinite; }
.gw-spin--rev { animation-direction: reverse; }
.gw-eye { transform-origin: 250px 250px; animation: gw-breathe 4s ease-in-out infinite; }
.gw-spark { filter: drop-shadow(0 0 6px #f0d060); animation: gw-twinkle 2s ease-in-out infinite; }

/* Ornaments */
.gw-flourish { filter: drop-shadow(0 0 6px rgba(212,160,23,.35)); }
.gw-flourish-gem { animation: gw-twinkle 3s ease-in-out infinite; }
.gw-corners {
  position: absolute; inset: 7px; pointer-events: none; z-index: 2; --c: rgba(240,208,96,.7); --s: 14px;
  background:
    linear-gradient(var(--c),var(--c)) top left / var(--s) 1px no-repeat,
    linear-gradient(var(--c),var(--c)) top left / 1px var(--s) no-repeat,
    linear-gradient(var(--c),var(--c)) top right / var(--s) 1px no-repeat,
    linear-gradient(var(--c),var(--c)) top right / 1px var(--s) no-repeat,
    linear-gradient(var(--c),var(--c)) bottom left / var(--s) 1px no-repeat,
    linear-gradient(var(--c),var(--c)) bottom left / 1px var(--s) no-repeat,
    linear-gradient(var(--c),var(--c)) bottom right / var(--s) 1px no-repeat,
    linear-gradient(var(--c),var(--c)) bottom right / 1px var(--s) no-repeat;
}
.gw-glyph {
  display: inline-block;
  background: linear-gradient(180deg, #fff6d8, #f0d060 40%, #d4a017);
  mask-size: contain; mask-repeat: no-repeat; mask-position: center;
  -webkit-mask-size: contain; -webkit-mask-repeat: no-repeat; -webkit-mask-position: center;
}
.gw-medallion {
  display: grid; place-items: center; width: 88px; height: 88px; border-radius: 50%;
  background: radial-gradient(circle at 50% 40%, #1a4a30, #0a2818 70%);
  border: 2px solid rgba(212,160,23,.55);
  box-shadow: 0 0 0 4px rgba(10,40,24,.9), 0 0 0 5px rgba(212,160,23,.3), 0 0 24px rgba(212,160,23,.25), inset 0 0 14px rgba(61,220,132,.15);
}
.gw-medallion--sm { width: 56px; height: 56px; box-shadow: 0 0 0 3px rgba(10,40,24,.9), 0 0 0 4px rgba(212,160,23,.3), 0 0 16px rgba(212,160,23,.2); }
.gw-chapter { transition: box-shadow .3s; }
.gw-chapter:hover { box-shadow: 0 0 24px rgba(212,160,23,.18); }
.gw-panel { transition: border-color .3s, transform .3s; }
.gw-panel:hover { border-color: rgba(212,160,23,.35); transform: translateY(-3px); }

/* Land cards */
.gw-card {
  background:
    radial-gradient(80% 50% at 50% 100%, color-mix(in oklab, var(--el) 16%, transparent), transparent 70%),
    linear-gradient(135deg, rgba(10,40,24,.95), rgba(15,51,33,.9), rgba(10,40,24,.95)) !important;
  transition: transform .3s, box-shadow .3s;
}
.gw-card:hover { transform: translateY(-5px); box-shadow: 0 16px 44px -16px var(--el); }
.gw-card:hover .gw-gem { transform: rotate(45deg) scale(1.08); }
.gw-card:hover .gw-card-apex { color: var(--el); }
.gw-gem {
  position: relative; display: grid; place-items: center;
  width: 46%; aspect-ratio: 1; transform: rotate(45deg);
  border: 1px solid var(--el);
  background: radial-gradient(circle, color-mix(in oklab, var(--el) 55%, transparent) 0%, transparent 72%);
  box-shadow: 0 0 26px -4px var(--el), inset 0 0 18px -6px var(--el);
  transition: transform .3s;
}
.gw-gem::before { content: ""; position: absolute; inset: 14%; border: 1px solid color-mix(in oklab, var(--el) 60%, transparent); }
.gw-gem-core {
  width: 30%; aspect-ratio: 1;
  background: linear-gradient(135deg, #fff, var(--el) 60%);
  box-shadow: 0 0 14px var(--el);
}
.gw-gem-glint {
  position: absolute; top: 10%; left: 10%; width: 4px; height: 4px; border-radius: 50%; background: #fff;
  box-shadow: 0 0 8px 2px #fff; animation: gw-twinkle 3.5s ease-in-out infinite;
}
.gw-card-apex { transition: color .3s; }

/* Blighted & Rift */
.gw-banner { border: 2px solid; }
.gw-banner--blight {
  border-color: rgba(167,139,250,.4);
  background: linear-gradient(135deg, rgba(40,28,74,.92), rgba(18,14,36,.95));
  box-shadow: 0 0 12px rgba(167,139,250,.25), inset 0 0 8px rgba(167,139,250,.05);
}
.gw-motes {
  position: absolute; inset: 0; pointer-events: none; opacity: .55;
  background-image:
    radial-gradient(2px 2px at 20% 30%, #c4b5fd, transparent),
    radial-gradient(1.5px 1.5px at 70% 60%, #c4b5fd, transparent),
    radial-gradient(2px 2px at 85% 25%, #a78bfa, transparent),
    radial-gradient(1.5px 1.5px at 40% 80%, #a78bfa, transparent),
    radial-gradient(2px 2px at 55% 15%, #c4b5fd, transparent);
  background-size: 220px 160px;
  animation: gw-drift 18s linear infinite;
}
.gw-banner--rift {
  border-color: rgba(204,51,51,.5);
  background: linear-gradient(135deg, rgba(60,14,14,.92), rgba(26,8,8,.95));
  box-shadow: 0 0 15px rgba(204,51,51,.3), inset 0 0 10px rgba(204,51,51,.05);
}
.gw-crack { opacity: .35; filter: drop-shadow(0 0 4px #ff5a4a); animation: gw-flicker 4s ease-in-out infinite; }

/* Entrance + scroll reveal */
.gw-anim .gw-rise { animation: gw-rise .9s cubic-bezier(.2,.7,.2,1) both; animation-delay: var(--d, 0s); }
.gw-settled .gw-rise { animation: none; opacity: 1; transform: none; }
[data-reveal] { transition: opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1); transition-delay: var(--d, 0s); }
.gw-reveal-on [data-reveal]:not(.is-in) { opacity: 0; transform: translateY(24px); }

@keyframes gw-spin { to { transform: rotate(360deg); } }
@keyframes gw-breathe { 50% { transform: scale(1.08); opacity: .85; } }
@keyframes gw-twinkle { 50% { opacity: .25; } }
@keyframes gw-sway { from { opacity: .5; margin-left: -12px; } to { opacity: 1; margin-left: 12px; } }
@keyframes gw-shimmer { 0%, 55% { background-position: 150% 0, 0 0; } 100% { background-position: -60% 0, 0 0; } }
@keyframes gw-halo { 50% { opacity: .45; transform: scale(1.06); } }
@keyframes gw-bob { 50% { transform: translateY(6px); } }
@keyframes gw-drift { to { background-position: 220px -160px; } }
@keyframes gw-flicker { 0%, 100% { opacity: .3; } 45% { opacity: .55; } 50% { opacity: .2; } 55% { opacity: .5; } }
@keyframes gw-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .gw-landing *, .gw-landing *::before { animation: none !important; }
}
`;
