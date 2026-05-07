import type { ExperienceConfig } from "../types/experience";

export const cessnaExperience: ExperienceConfig = {
  id: "ios-cessna-demo",
  title: "IOS Cessna Demo",
  description: "Inspect a Cessna model in AR, VR, or fallback mode with the hangar environment and a keyed Cessna video.",
  modes: ["ar", "vr", "fallback"],
  tabletControlMode: "inspect",
  model: {
    url: "/assets/experiences/ios-cessna-demo/models/cessna.glb",
    scale: 1,
    position: [0, 0, -1.5],
    rotation: [0, Math.PI, 0],
    fitToDisplaySize: 2.8
  },
  environment: {
    vrGarageUrl: "/assets/experiences/ios-cessna-demo/environments/hangar.glb"
  },
  parts: [],
  introVideos: {
    default: "/assets/experiences/ios-cessna-demo/videos/cessna.mp4"
  },
  assessmentUrl: "https://forms.office.com/"
};
