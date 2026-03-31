import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Audio is @deprecated in Remotion 4.x TS types but still renders correctly.
// require() breaks the deprecation chain so usage sites stay hint-free.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const Audio = (require("remotion") as any).Audio as (props: { src: string }) => React.ReactElement | null;

export interface SlideData {
  title: string;
  layout: "list" | "steps" | "cards" | "table";
  summary: string;
  bullets: string[];
  /** 0.0–1.0 reveal fractions per bullet, sentence-index based from backend */
  bulletTimings?: number[];
  /** Actual TTS audio length in seconds (without slide padding) */
  audioSec?: number;
  speakerNotes: string;
  audioBase64: string;
  durationInFrames: number;
}

interface SceneProps { slide: SlideData; index: number; total: number }

const TRANSITION = 20;

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = [
  { bg1: "#05091a", bg2: "#0f2d6b", accent: "#60a5fa", soft: "rgba(96,165,250,0.09)",  border: "rgba(96,165,250,0.20)",  text: "#eef5ff", sub: "#6e8eb8" },
  { bg1: "#011208", bg2: "#014a1e", accent: "#34d399", soft: "rgba(52,211,153,0.09)",  border: "rgba(52,211,153,0.20)",  text: "#e8fdf4", sub: "#4a9e7a" },
  { bg1: "#0d0519", bg2: "#2d176b", accent: "#c084fc", soft: "rgba(192,132,252,0.09)", border: "rgba(192,132,252,0.20)", text: "#f3eeff", sub: "#8a6aaa" },
  { bg1: "#150a00", bg2: "#6b3500", accent: "#fbbf24", soft: "rgba(251,191,36,0.09)",  border: "rgba(251,191,36,0.20)",  text: "#fff8e0", sub: "#9a7830" },
  { bg1: "#0f0514", bg2: "#4a1942", accent: "#f472b6", soft: "rgba(244,114,182,0.09)", border: "rgba(244,114,182,0.20)", text: "#fff0f6", sub: "#9a5070" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseBullet(b: string): { label: string; desc: string } {
  const idx = b.indexOf("|");
  if (idx === -1) return { label: "", desc: b.trim() };
  return { label: b.slice(0, idx).trim(), desc: b.slice(idx + 1).trim() };
}

function getRevealFrames(slide: SlideData): number[] {
  const n = slide.bullets.length;

  // Use actual audio duration as timing base.
  // durationInFrames includes ~1s padding after audio ends, which would shift
  // all bullets later if used as the span. audioSec × 30 is the real audio length.
  const FPS = 30;
  const GUARD = 6; // frames before first bullet can appear
  const audioFrames = slide.audioSec != null
    ? Math.max(60, Math.round(slide.audioSec * FPS))
    : slide.durationInFrames - TRANSITION;
  const span = audioFrames - GUARD;

  if (slide.bulletTimings && slide.bulletTimings.length >= n) {
    return slide.bulletTimings.map((f) => GUARD + Math.round(f * span));
  }
  if (n <= 1) return [GUARD + 14];
  return Array.from({ length: n }, (_, i) =>
    GUARD + 14 + Math.round((i / (n - 1)) * (span - 20))
  );
}

function activeBullet(frame: number, frames: number[]): number {
  let idx = -1;
  for (let j = 0; j < frames.length; j++) if (frame >= frames[j]) idx = j;
  return idx;
}

// ── Slide Shell ───────────────────────────────────────────────────────────────
function SlideShell({ slide, index, total, children }: SceneProps & { children: React.ReactNode }) {
  const frame    = useCurrentFrame();
  const { fps }  = useVideoConfig();
  const dur      = slide.durationInFrames;
  const t        = THEMES[index % THEMES.length];

  const enter   = spring({ frame, fps, config: { damping: 28, stiffness: 62 } });
  const fadeIn  = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [dur - TRANSITION, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale   = interpolate(enter, [0, 1], [0.978, 1]);
  const titleX  = interpolate(frame, [6, 24], [-20, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp) });
  const progress = interpolate(frame, [0, dur], [0, 100], { extrapolateRight: "clamp" });
  const audio   = `data:audio/wav;base64,${slide.audioBase64}`;

  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {slide.audioBase64 && <Audio src={audio} />}

      {/* Background */}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 58% 28%, ${t.bg2} 0%, ${t.bg1} 68%)` }} />

      {/* Top accent strip */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${t.accent}, ${t.accent}40 60%, transparent 100%)` }} />

      {/* Content */}
      <AbsoluteFill style={{ display: "flex", flexDirection: "column",
        padding: "36px 72px 44px", transform: `scale(${scale})` }}>

        {/* Slide counter */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, opacity: fadeIn }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: t.sub, letterSpacing: 1.2 }}>
            {String(index + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: 40, fontWeight: 900, color: t.text, lineHeight: 1.12,
          letterSpacing: -0.8, margin: 0, marginBottom: slide.summary ? 8 : 16, maxWidth: 1020,
          transform: `translateX(${titleX}px)` }}>
          {slide.title}
        </h1>

        {/* Summary */}
        {slide.summary && (
          <p style={{ fontSize: 15, color: t.sub, margin: 0, marginBottom: 16,
            lineHeight: 1.45, opacity: fadeIn }}>
            {slide.summary}
          </p>
        )}

        {/* Hairline divider */}
        <div style={{ height: 1, background: t.border, marginBottom: 20, opacity: 0.7 }} />

        {/* Layout content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {children}
        </div>
      </AbsoluteFill>

      {/* Progress bar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
        background: "rgba(255,255,255,0.05)" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: t.accent, opacity: 0.6 }} />
      </div>
    </AbsoluteFill>
  );
}

// ── List Layout ───────────────────────────────────────────────────────────────
function ListLayout({ slide, index, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t       = THEMES[index % THEMES.length];
  const frames  = getRevealFrames(slide);
  const curIdx  = activeBullet(frame, frames);

  return (
    <SlideShell slide={slide} index={index} total={total}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {slide.bullets.map((b, i) => {
          const { label, desc } = parseBullet(b);
          const sp     = spring({ frame: Math.max(0, frame - frames[i]), fps, config: { damping: 16, stiffness: 160 } });
          const op     = interpolate(sp, [0, 1], [0, 1]);
          const tx     = interpolate(sp, [0, 1], [-20, 0]);
          const isCur  = i === curIdx;
          const isPast = i < curIdx;

          return (
            <div key={i} style={{
              opacity: op * (isPast ? 0.42 : 1),
              transform: `translateX(${tx}px)`,
              display: "flex", alignItems: "flex-start", gap: 14,
              padding: "11px 16px",
              // Left border as pointer — transparent keeps layout stable, no horizontal jitter
              borderLeft: `3px solid ${isCur ? t.accent : "transparent"}`,
            }}>
              {/* Number badge */}
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: isCur ? t.accent : "transparent",
                border: `1.5px solid ${isCur ? t.accent : t.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                marginTop: 2,
              }}>
                <span style={{ fontSize: 11, fontWeight: 800,
                  color: isCur ? t.bg1 : t.sub }}>{i + 1}</span>
              </div>

              {/* Text */}
              <div style={{ flex: 1 }}>
                {label
                  ? <>
                      <div style={{ fontSize: 19, fontWeight: 800, color: t.accent,
                        lineHeight: 1.2, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 16, color: t.text, lineHeight: 1.6,
                        opacity: 0.88 }}>{desc}</div>
                    </>
                  : <div style={{ fontSize: 18, fontWeight: 500, color: t.text,
                      lineHeight: 1.6 }}>{desc}</div>
                }
              </div>
            </div>
          );
        })}
      </div>
    </SlideShell>
  );
}

// ── Steps Layout — vertical timeline ─────────────────────────────────────────
function StepsLayout({ slide, index, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t       = THEMES[index % THEMES.length];
  const items   = slide.bullets.map(parseBullet);
  const frames  = getRevealFrames(slide);
  const n       = items.length;

  return (
    <SlideShell slide={slide} index={index} total={total}>
      <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        {items.map(({ label, desc }, i) => {
          const sp  = spring({ frame: Math.max(0, frame - frames[i]), fps, config: { damping: 16, stiffness: 160 } });
          const op  = interpolate(sp, [0, 1], [0, 1]);
          const ty  = interpolate(sp, [0, 1], [10, 0]);
          const lineProg = interpolate(frame, [frames[i], frames[i] + 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          const isLast = i === n - 1;

          return (
            <div key={i} style={{ display: "flex", opacity: op, transform: `translateY(${ty}px)` }}>
              {/* Timeline column */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 46, flexShrink: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: "50%", background: t.accent,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: `0 0 0 4px ${t.soft}` }}>
                  <span style={{ fontSize: 14, fontWeight: 900, color: t.bg1 }}>{i + 1}</span>
                </div>
                {!isLast && (
                  <div style={{ width: 1.5, flex: 1, minHeight: 12,
                    background: `linear-gradient(to bottom, ${t.accent}88, ${t.border})`,
                    margin: "3px 0", opacity: lineProg }} />
                )}
              </div>

              {/* Content */}
              <div style={{ flex: 1, paddingLeft: 16, paddingBottom: isLast ? 0 : 16, paddingTop: 4 }}>
                {label
                  ? <>
                      <div style={{ fontSize: 18, fontWeight: 800, color: t.accent,
                        lineHeight: 1.2, marginBottom: 5 }}>{label}</div>
                      <div style={{ fontSize: 15, color: t.text, lineHeight: 1.6, opacity: 0.88 }}>{desc}</div>
                    </>
                  : <div style={{ fontSize: 17, fontWeight: 600, color: t.text,
                      lineHeight: 1.5, marginTop: 3 }}>{desc}</div>
                }
              </div>
            </div>
          );
        })}
      </div>
    </SlideShell>
  );
}

// ── Cards Layout ──────────────────────────────────────────────────────────────
function CardsLayout({ slide, index, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t       = THEMES[index % THEMES.length];
  const items   = slide.bullets.map(parseBullet);
  const frames  = getRevealFrames(slide);
  const rows: typeof items[] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));

  return (
    <SlideShell slide={slide} index={index} total={total}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "flex", gap: 12, flex: 1 }}>
            {row.map(({ label, desc }, ci) => {
              const i  = ri * 2 + ci;
              const sp = spring({ frame: Math.max(0, frame - frames[i]), fps, config: { damping: 16, stiffness: 160 } });
              const op = interpolate(sp, [0, 1], [0, 1]);
              const ty = interpolate(sp, [0, 1], [18, 0]);
              return (
                <div key={ci} style={{
                  flex: 1, opacity: op, transform: `translateY(${ty}px)`,
                  background: t.soft, border: `1px solid ${t.border}`,
                  borderRadius: 14, padding: "18px 20px",
                  display: "flex", flexDirection: "column",
                }}>
                  <div style={{ width: 24, height: 2.5, background: t.accent, borderRadius: 2, marginBottom: 12 }} />
                  <div style={{ fontSize: 20, fontWeight: 800, color: t.text,
                    lineHeight: 1.25, marginBottom: 8 }}>{label || desc}</div>
                  {label && (
                    <p style={{ fontSize: 14, color: t.sub, margin: 0, lineHeight: 1.6, flex: 1 }}>{desc}</p>
                  )}
                </div>
              );
            })}
            {row.length === 1 && <div style={{ flex: 1 }} />}
          </div>
        ))}
      </div>
    </SlideShell>
  );
}

// ── Table Layout ──────────────────────────────────────────────────────────────
function TableLayout({ slide, index, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t       = THEMES[index % THEMES.length];

  if (slide.bullets.length === 0) return <ListLayout slide={slide} index={index} total={total} />;

  const headers  = slide.bullets[0].split("|").map((h) => h.trim());
  const rows     = slide.bullets.slice(1).map((r) => r.split("|").map((c) => c.trim()));
  const colCount = headers.length;
  const tableOp  = interpolate(frame, [12, 26], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <SlideShell slide={slide} index={index} total={total}>
      <div style={{ opacity: tableOp, borderRadius: 12, overflow: "hidden",
        border: `1px solid ${t.border}`, flex: 1 }}>
        {/* Header */}
        <div style={{ display: "flex", background: t.accent }}>
          {headers.map((h, hi) => (
            <div key={hi} style={{ flex: 1, padding: "10px 18px",
              borderRight: hi < colCount - 1 ? `1px solid rgba(255,255,255,0.16)` : "none" }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: t.bg1, letterSpacing: 0.2 }}>{h}</span>
            </div>
          ))}
        </div>
        {/* Rows */}
        {rows.map((row, ri) => {
          const sp    = spring({ frame: Math.max(0, frame - (24 + ri * 14)), fps, config: { damping: 22, stiffness: 100 } });
          const rowOp = interpolate(sp, [0, 1], [0, 1]);
          const rowX  = interpolate(sp, [0, 1], [12, 0]);
          return (
            <div key={ri} style={{ display: "flex",
              background: ri % 2 === 0 ? t.soft : "transparent",
              borderTop: `1px solid ${t.border}`,
              opacity: rowOp, transform: `translateX(${rowX}px)` }}>
              {headers.map((_, ci) => (
                <div key={ci} style={{ flex: 1, padding: "11px 18px",
                  borderRight: ci < colCount - 1 ? `1px solid ${t.border}` : "none" }}>
                  <span style={{ fontSize: ci === 0 ? 15 : 14,
                    fontWeight: ci === 0 ? 700 : 400,
                    color: ci === 0 ? t.accent : t.text,
                    lineHeight: 1.45, opacity: ci === 0 ? 1 : 0.88 }}>
                    {row[ci] ?? ""}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </SlideShell>
  );
}

// ── Title Slide ───────────────────────────────────────────────────────────────
function TitleSlide({ slide, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur     = slide.durationInFrames;
  const t       = THEMES[0];

  const enter   = spring({ frame, fps, config: { damping: 26, stiffness: 58 } });
  const fadeIn  = interpolate(frame, [0, 18], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [dur - TRANSITION, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const scale   = interpolate(enter, [0, 1], [0.962, 1]);
  const titleX  = interpolate(frame, [8, 30], [-40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.exp) });
  const progress = interpolate(frame, [0, dur], [0, 100], { extrapolateRight: "clamp" });
  const audio   = `data:audio/wav;base64,${slide.audioBase64}`;

  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {slide.audioBase64 && <Audio src={audio} />}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 52% 42%, ${t.bg2} 0%, ${t.bg1} 70%)` }} />
      <div style={{ position: "absolute", top: "50%", left: "50%", width: 820, height: 820,
        borderRadius: "50%", background: `radial-gradient(circle, ${t.soft} 0%, transparent 65%)`,
        transform: "translate(-50%, -50%)" }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${t.accent}, ${t.accent}40, transparent)` }} />

      <AbsoluteFill style={{ display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "80px 120px", transform: `scale(${scale})` }}>

        {/* Badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 7,
          background: t.soft, border: `1px solid ${t.border}`,
          borderRadius: 26, padding: "6px 16px", marginBottom: 32, opacity: fadeIn }}>
          <div style={{ width: 5, height: 5, borderRadius: "50%", background: t.accent }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: t.accent,
            letterSpacing: 1.8, textTransform: "uppercase" }}>
            AI 학습 동영상 · {total}개 슬라이드
          </span>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: 64, fontWeight: 900, color: t.text, textAlign: "center",
          lineHeight: 1.1, letterSpacing: -1.6, margin: 0, marginBottom: 20, maxWidth: 960,
          transform: `translateX(${titleX}px)` }}>
          {slide.title}
        </h1>

        {/* Accent line */}
        <div style={{ width: interpolate(frame, [20, 44], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          height: 3, background: t.accent, borderRadius: 3, marginBottom: 26 }} />

        {/* Summary */}
        {slide.summary && (
          <p style={{ fontSize: 20, color: t.sub, textAlign: "center", margin: 0,
            marginBottom: 26, maxWidth: 760, lineHeight: 1.5, opacity: fadeIn }}>
            {slide.summary}
          </p>
        )}

        {/* Topic chips */}
        {slide.bullets.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 820 }}>
            {slide.bullets.map((b, i) => {
              const { label, desc } = parseBullet(b);
              const bOp = interpolate(frame, [32 + i * 8, 48 + i * 8], [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <div key={i} style={{ background: t.soft, border: `1px solid ${t.border}`,
                  borderRadius: 18, padding: "6px 16px", opacity: bOp }}>
                  <span style={{ fontSize: 14, color: t.text, fontWeight: 500 }}>{label || desc}</span>
                </div>
              );
            })}
          </div>
        )}
      </AbsoluteFill>

      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2,
        background: "rgba(255,255,255,0.05)" }}>
        <div style={{ height: "100%", width: `${progress}%`, background: t.accent, opacity: 0.6 }} />
      </div>
    </AbsoluteFill>
  );
}

// ── Presenter Avatar ──────────────────────────────────────────────────────────
function PresenterAvatar({ frame }: { frame: number }) {
  const t    = THEMES[0];
  const sway = Math.sin(frame / 52) * 2.2;
  const blink = frame % 90 >= 85;
  const eyeRy = blink ? 1 : 6.5;
  const talkH = 4 + Math.abs(Math.sin(frame / 5)) * 8;

  return (
    <svg width="180" height="220" viewBox="0 0 180 220"
      style={{ transform: `rotate(${sway}deg)`, transformOrigin: "90px 220px" }}>
      <ellipse cx="90" cy="202" rx="72" ry="32" fill={`${t.accent}18`} />
      <ellipse cx="90" cy="188" rx="48" ry="25" fill={`${t.accent}30`} />
      <rect x="76" y="137" width="28" height="28" rx="9" fill={`${t.accent}30`} />
      <ellipse cx="90" cy="107" rx="56" ry="61" fill={t.bg2} stroke={t.accent} strokeWidth="1.2" />
      <ellipse cx="90" cy="55"  rx="50" ry="24" fill={`${t.accent}25`} />
      <ellipse cx="68"  cy="99" rx="9" ry={eyeRy} fill={t.accent} opacity="0.9" />
      <ellipse cx="112" cy="99" rx="9" ry={eyeRy} fill={t.accent} opacity="0.9" />
      {!blink && <>
        <circle cx="70"  cy="99" r="4" fill={t.bg1} />
        <circle cx="114" cy="99" r="4" fill={t.bg1} />
        <circle cx="72"  cy="96.5" r="1.8" fill="white" opacity="0.7" />
        <circle cx="116" cy="96.5" r="1.8" fill="white" opacity="0.7" />
      </>}
      <rect x="55" y="91" width="26" height="17" rx="6" fill="none" stroke={t.accent} strokeWidth="1.2" opacity="0.35" />
      <rect x="99" y="91" width="26" height="17" rx="6" fill="none" stroke={t.accent} strokeWidth="1.2" opacity="0.35" />
      <line x1="81" y1="99.5" x2="99" y2="99.5" stroke={t.accent} strokeWidth="1.2" opacity="0.35" />
      <ellipse cx="90" cy="126" rx="14" ry={talkH / 2} fill={t.accent} opacity="0.8" />
      {talkH > 5 && <ellipse cx="90" cy="124" rx="10" ry={talkH / 3} fill={t.bg1} opacity="0.62" />}
    </svg>
  );
}

// ── Waveform ──────────────────────────────────────────────────────────────────
function Waveform({ frame, accent }: { frame: number; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, height: 28 }}>
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} style={{ width: 3.5, borderRadius: 3, background: accent, opacity: 0.78,
          height: 5 + Math.abs(Math.sin(frame / 6 + i * 0.8)) * 20 }} />
      ))}
    </div>
  );
}

// ── Presenter Scene ───────────────────────────────────────────────────────────
function PresenterScene({ slide, index, total }: SceneProps) {
  const frame   = useCurrentFrame();
  const { fps } = useVideoConfig();
  const dur     = slide.durationInFrames;
  const t       = THEMES[index % THEMES.length];

  const fadeIn  = interpolate(frame, [0, 16], [0, 1], { extrapolateRight: "clamp" });
  const fadeOut = interpolate(frame, [dur - TRANSITION, dur], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const frames  = getRevealFrames(slide);
  const curIdx  = activeBullet(frame, frames);
  const audio   = `data:audio/wav;base64,${slide.audioBase64}`;

  return (
    <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>
      {slide.audioBase64 && <Audio src={audio} />}
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 75% 28%, ${t.bg2} 0%, ${t.bg1} 70%)` }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: `linear-gradient(90deg, ${t.accent}, ${t.accent}40, transparent)` }} />

      {/* Avatar panel */}
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 320,
        background: `linear-gradient(155deg, ${t.bg2}ee 0%, ${t.bg1} 100%)`,
        borderRight: `1px solid ${t.border}`,
        display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 16px 20px" }}>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <PresenterAvatar frame={frame} />
        </div>
        <Waveform frame={frame} accent={t.accent} />
        <div style={{ marginTop: 12, background: t.soft, border: `1px solid ${t.border}`,
          borderRadius: 10, padding: "8px 12px", textAlign: "center",
          width: "100%", boxSizing: "border-box" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: t.accent }}>AI 강의</div>
          <div style={{ fontSize: 10, color: t.sub, marginTop: 1 }}>StudyU Learning</div>
        </div>
      </div>

      {/* Slide content */}
      <div style={{ position: "absolute", left: 320, top: 0, right: 0, bottom: 0,
        display: "flex", flexDirection: "column", padding: "28px 40px 36px" }}>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: t.sub, letterSpacing: 1 }}>{index + 1} / {total}</span>
        </div>

        <h1 style={{ fontSize: 27, fontWeight: 900, color: t.text, margin: 0,
          marginBottom: 5, lineHeight: 1.2, letterSpacing: -0.3 }}>{slide.title}</h1>
        {slide.summary && (
          <p style={{ fontSize: 12, color: t.sub, margin: 0, marginBottom: 10, lineHeight: 1.4 }}>
            {slide.summary}
          </p>
        )}
        <div style={{ height: 1, background: t.border, marginBottom: 16, opacity: 0.7 }} />

        {/* Bullets */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
          {slide.bullets.map((b, i) => {
            const { label, desc } = parseBullet(b);
            const sp     = spring({ frame: Math.max(0, frame - frames[i]), fps, config: { damping: 16, stiffness: 160 } });
            const op     = interpolate(sp, [0, 1], [0, 1]);
            const tx     = interpolate(sp, [0, 1], [-14, 0]);
            const isCur  = i === curIdx;
            const isPast = i < curIdx;

            return (
              <div key={i} style={{
                opacity: op * (isPast ? 0.42 : 1),
                transform: `translateX(${tx}px)`,
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "8px 12px",
                borderLeft: `2px solid ${isCur ? t.accent : "transparent"}`,
              }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: isCur ? t.accent : "transparent",
                  border: `1.5px solid ${isCur ? t.accent : t.border}`,
                  display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1 }}>
                  <span style={{ fontSize: 9, fontWeight: 800,
                    color: isCur ? t.bg1 : t.sub }}>{i + 1}</span>
                </div>
                <div style={{ flex: 1 }}>
                  {label
                    ? <>
                        <div style={{ fontSize: 12, fontWeight: 800, color: t.accent, marginBottom: 1 }}>{label}</div>
                        <div style={{ fontSize: 11, color: t.text, lineHeight: 1.5, opacity: 0.88 }}>{desc}</div>
                      </>
                    : <div style={{ fontSize: 12, fontWeight: 500, color: t.text, lineHeight: 1.5 }}>{desc}</div>
                  }
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────
function SlideScene({ slide, index, total, presenterMode }: SceneProps & { presenterMode: boolean }) {
  if (presenterMode) return <PresenterScene slide={slide} index={index} total={total} />;
  if (index === 0)   return <TitleSlide     slide={slide} index={index} total={total} />;
  switch (slide.layout) {
    case "steps": return <StepsLayout slide={slide} index={index} total={total} />;
    case "cards": return <CardsLayout slide={slide} index={index} total={total} />;
    case "table": return <TableLayout slide={slide} index={index} total={total} />;
    default:      return <ListLayout  slide={slide} index={index} total={total} />;
  }
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function SlideVideo({ slides, presenterMode }: { slides: SlideData[]; presenterMode?: boolean }) {
  let start = 0;
  const seqs = slides.map((slide, i) => {
    const from = start;
    start += slide.durationInFrames;
    return { slide, from, i };
  });
  return (
    <AbsoluteFill style={{ backgroundColor: "#05091a" }}>
      {seqs.map(({ slide, from, i }) => (
        <Sequence key={i} from={from} durationInFrames={slide.durationInFrames}>
          <SlideScene slide={slide} index={i} total={slides.length} presenterMode={!!presenterMode} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
