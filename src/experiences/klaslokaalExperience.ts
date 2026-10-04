import type { ExperienceConfig } from "../types/experience";

// Small low-poly room for 6-10 students with one object and one specialist video.
// Budget (Quest 2): shell ~140 triangles / 1 draw call, object ~53k triangles, one keyed video.
export const klaslokaalExperience: ExperienceConfig = {
  id: "iol-klaslokaal-demo",
  title: "Klaslokaal: turbine met specialist",
  description: "Kleine ruimte voor een klas met één turbine en een specialist die uitleg geeft.",
  modes: ["ar", "vr", "fallback"],
  tabletControlMode: "inspect",
  initialView: {
    mode: "inspect",
    target: [0, 1.1, -1.5],
    distance: 4.2,
    yaw: 0,
    pitch: -0.12
  },
  model: {
    url: "/assets/experiences/iol-cessna-demo/models/turbofan.glb",
    scale: 0.45,
    position: [0, 0, -1.5],
    rotation: [0, 0, 0],
    fitToDisplaySize: 1.5
  },
  environment: {
    vrGarageUrl: "/assets/experiences/iol-klaslokaal-demo/environments/room.glb",
    hideInAr: true,
    lighting: {
      toneMappingExposure: 1,
      hemisphereIntensity: 1.6,
      directionalIntensity: 1.2
    }
  },
  parts: [
    {
      id: "turbine-specialist-video",
      label: "Turbine Specialist",
      markerPosition: [1.5, 1.0, -1.2],
      explanation: "De specialist legt de turbine uit. De docent start de video voor de hele klas.",
      videoUrl: "/assets/chroma/turbine-mechanic-green-screen.mp4",
      videoActivationMode: "teacher"
    }
  ],
  introVideos: {
    default: "/assets/chroma/turbine-mechanic-green-screen.mp4"
  },
  assessmentUrl: "https://forms.office.com/"
};
