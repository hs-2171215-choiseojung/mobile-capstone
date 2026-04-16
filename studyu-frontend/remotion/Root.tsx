import { Composition } from "remotion";
import { type SlideData } from "./SlideVideo";
import { SlideVideo } from "./SlideVideo";

const DEFAULT_SLIDES: SlideData[] = [
  {
    title: "미리보기",
    summary: "",
    bullets: ["슬라이드 1"],
    speakerNotes: "",
    audioBase64: "",
    durationInFrames: 90,
    layout: "list",
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SlideVideoAny = SlideVideo as any;

export function RemotionRoot() {
  const totalFrames = DEFAULT_SLIDES.reduce((sum, s) => sum + s.durationInFrames, 0);

  return (
    <Composition
      id="SlideVideo"
      component={SlideVideoAny}
      durationInFrames={totalFrames || 90}
      fps={30}
      width={1280}
      height={720}
      defaultProps={{ slides: DEFAULT_SLIDES }}
      calculateMetadata={async ({ props }) => {
        const slides = (props as { slides: SlideData[] }).slides;
        const total = slides.reduce(
          (sum: number, s: SlideData) => sum + s.durationInFrames,
          0
        );
        return { durationInFrames: total || 90 };
      }}
    />
  );
}
