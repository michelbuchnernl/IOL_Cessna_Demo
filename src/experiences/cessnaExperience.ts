import type { ExperienceConfig } from "../types/experience";

export const cessnaExperience: ExperienceConfig = {
  id: "iol-cessna-demo",
  title: "IOL Cessna Demo",
  description: "Inspect a Cessna model in AR, VR, or fallback mode with the hangar environment and a keyed Cessna video.",
  modes: ["ar", "vr", "fallback"],
  tabletControlMode: "inspect",
  model: {
    url: "/assets/experiences/iol-cessna-demo/models/cessna.glb",
    scale: 1,
    position: [0, 0, -1.5],
    rotation: [0, Math.PI, 0],
    fitToDisplaySize: 2.8
  },
  environment: {
    vrGarageUrl: "/assets/experiences/iol-cessna-demo/environments/hangar.glb"
  },
  parts: [],
  introVideos: {
    default: "/assets/experiences/iol-cessna-demo/videos/cessna.mp4"
  },
  assessmentUrl: "https://forms.office.com/"
};
