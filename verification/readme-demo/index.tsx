import { Composition, registerRoot } from "remotion";
import { Opening } from "./video.tsx";

const Root = () => (
  <Composition
    id="Opening"
    component={Opening}
    durationInFrames={1536}
    fps={30}
    width={3840}
    height={1760}
    defaultProps={{
      clips: [],
      switches: [],
      pointer: { width: 48, height: 48, xhot: 6, yhot: 2 },
      durationInFrames: 1536,
      roleEnd: 618,
      closingFrom: 1416,
      colors: { background: "transparent", foreground: "inherit" },
    }}
    calculateMetadata={({ props }) => ({
      durationInFrames: props.durationInFrames,
    })}
  />
);
registerRoot(Root);
