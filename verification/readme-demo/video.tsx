import { Video } from "@remotion/media";
import { loadFont } from "@remotion/fonts";
import {
  AbsoluteFill,
  CanvasImage,
  Interactive,
  Sequence,
  staticFile,
  useCurrentFrame,
  interpolate,
  Easing,
} from "remotion";

type Point = [number, number];
type Clip = {
  id: string;
  name: string;
  src?: string;
  from: number;
  duration: number;
  rate?: number;
  cursor?: Point;
  cursorTo?: Point;
};
type Switch = {
  id: string;
  name: string;
  from: number;
  before: { src: string };
  after: { src: string };
  start: Point;
  target: Point;
};
export type Props = {
  clips: Clip[];
  switches: Switch[];
  pointer: { width: number; height: number; xhot: number; yhot: number };
  colors: { background: string; foreground: string };
  durationInFrames: number;
  roleEnd: number;
  closingFrom: number;
};
void loadFont({
  family: "Inter",
  url: staticFile("inter.woff2"),
  weight: "100 900",
});
const screenStyle = {
  position: "absolute" as const,
  left: 0,
  top: 160,
  width: 3840,
  height: 1600,
};
const captionStyle = {
  position: "absolute" as const,
  left: 60,
  top: 40,
  fontSize: 76,
  fontWeight: 500,
  letterSpacing: "-0.02em",
};
const ease = Easing.bezier(0.4, 0, 0.2, 1);
function Pointer({
  point,
  pointer,
  pressed = 0,
}: {
  point: Point;
  pointer: Props["pointer"];
  pressed?: number;
}) {
  return (
    <CanvasImage
      src={staticFile("pointer.png")}
      style={{
        position: "absolute",
        left: point[0] * 2 - pointer.xhot,
        top: point[1] * 2 + 160 - pointer.yhot,
        width: pointer.width,
        height: pointer.height,
        scale: 1 - pressed * 0.12,
        transformOrigin: `${pointer.xhot}px ${pointer.yhot}px`,
      }}
    />
  );
}
function SwitchScreen({
  interaction,
  pointer,
}: {
  interaction: Switch;
  pointer: Props["pointer"];
}) {
  const frame = useCurrentFrame();
  // 9 frames still, 18 frames eased movement, 3 frames click, 9 frames still.
  const progress = interpolate(frame, [9, 27], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const point = interaction.start.map(
    (value, i) => value + (interaction.target[i] - value) * progress,
  ) as Point;
  const pressed = interpolate(frame, [27, 28, 30], [0, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill>
      <CanvasImage
        src={staticFile(
          frame < 30 ? interaction.before.src : interaction.after.src,
        )}
        style={screenStyle}
      />
      <Pointer point={point} pointer={pointer} pressed={pressed} />
    </AbsoluteFill>
  );
}
function ScreenClip({
  clip,
  pointer,
}: {
  clip: Clip;
  pointer: Props["pointer"];
}) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 18], [0, 1], {
    easing: ease,
    extrapolateRight: "clamp",
  });
  const point = clip.cursor?.map(
    (value, i) =>
      value + ((clip.cursorTo ?? clip.cursor)![i] - value) * progress,
  ) as Point | undefined;
  return (
    <AbsoluteFill>
      <Video
        name={clip.name}
        src={staticFile(clip.src!)}
        playbackRate={clip.rate ?? 1}
        muted
        style={screenStyle}
      />
      {point && <Pointer point={point} pointer={pointer} />}
    </AbsoluteFill>
  );
}
export const Opening = (props: Props) => (
  <AbsoluteFill
    style={{
      backgroundColor: props.colors.background,
      color: props.colors.foreground,
      fontFamily: "Inter, sans-serif",
      overflow: "hidden",
    }}
  >
    {props.clips
      .filter((clip) => clip.src)
      .map((clip) => (
        <Sequence
          key={clip.id}
          name={clip.name}
          from={clip.from}
          durationInFrames={Math.round(clip.duration * 30)}
        >
          <ScreenClip clip={clip} pointer={props.pointer} />
        </Sequence>
      ))}
    {props.switches.map((interaction) => (
      <Sequence
        key={interaction.id}
        name={interaction.name}
        from={interaction.from}
        durationInFrames={39}
      >
        <SwitchScreen interaction={interaction} pointer={props.pointer} />
      </Sequence>
    ))}
    <Sequence name="Ask caption" durationInFrames={180}>
      <Interactive.Div name="Ask once" style={captionStyle}>
        Ask once.
      </Interactive.Div>
    </Sequence>
    <Sequence
      name="Roles caption"
      from={180}
      durationInFrames={props.roleEnd - 180}
    >
      <Interactive.Div name="Roles" style={captionStyle}>
        Each role runs on the CLI and model you choose.
      </Interactive.Div>
    </Sequence>
    <Sequence name="Closing" from={props.closingFrom} durationInFrames={120}>
      <AbsoluteFill
        style={{ alignItems: "center", justifyContent: "center", gap: 72 }}
      >
        <CanvasImage
          src={staticFile("iori-icon.svg")}
          style={{ width: 300, height: 300 }}
        />
        <Interactive.Div
          name="iori"
          style={{ fontSize: 164, fontWeight: 600, letterSpacing: "-.04em" }}
        >
          iori
        </Interactive.Div>
        <Interactive.Div name="Closing caption" style={{ fontSize: 86 }}>
          Open source. Runs on your machines.
        </Interactive.Div>
      </AbsoluteFill>
    </Sequence>
  </AbsoluteFill>
);
