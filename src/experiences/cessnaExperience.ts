import type { ExperienceConfig } from "../types/experience";

export const cessnaExperience: ExperienceConfig = {
  id: "iol-cessna-demo",
  title: "IOL Hangar Demo",
  description: "Explore the complete hangar scene with a turbofan teaching prop and teacher- or student-triggered video activators.",
  modes: ["ar", "vr", "fallback"],
  tabletControlMode: "inspect",
  initialView: {
    mode: "inspect",
    target: [7.867, 1.795, 0.383],
    distance: 18,
    yaw: 6.559,
    pitch: -0.109
  },
  model: {
    url: "/assets/experiences/iol-cessna-demo/models/turbofan.glb",
    scale: 0.45,
    position: [8, 0, 1],
    rotation: [0, (90 - 136) * Math.PI / 180, 0]
  },
  environment: {
    vrGarageUrl: "/assets/experiences/iol-cessna-demo/environments/hangar.glb",
    brightness: 0.2
  },
  parts: [
    {
      id: "student-cessna-video",
      label: "Cessna Video",
      markerPosition: [0, 1.8, -10],
      explanation: "Teacher-controlled Cessna video for whole-class explanation.",
      videoUrl: "/assets/experiences/iol-cessna-demo/videos/cessna.mp4",
      videoActivationMode: "teacher"
    },
    {
      id: "student-turbofan-video",
      label: "Turbofan Video",
      markerPosition: [-4.2, 1.5, -5.4],
      explanation: "Student-activated turbofan video. Selecting the blue sphere plays the clip from beginning to end.",
      videoUrl: "/assets/experiences/iol-cessna-demo/videos/turbine.mp4",
      videoActivationMode: "student"
    },
    {
      id: "teacher-boeing-video",
      label: "Boeing Video",
      markerPosition: [4.2, 1.5, -5.4],
      explanation: "Student-activated Boeing video. Selecting the blue sphere plays the clip from beginning to end.",
      videoUrl: "/assets/experiences/iol-cessna-demo/videos/boeing.mp4",
      videoActivationMode: "student"
    }
  ],
  introVideos: {
    default: "/assets/experiences/iol-cessna-demo/videos/boeing.mp4"
  },
  assessmentUrl: "https://forms.office.com/"
};
