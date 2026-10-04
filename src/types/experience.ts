export type ExperienceMode = "ar" | "vr" | "fallback";
export type TabletControlMode = "inspect" | "explore";
export type ExperienceVideoActivationMode = "standard" | "teacher" | "student";

export type Vector3Tuple = [number, number, number];

export interface ExperienceModelConfig {
  url: string;
  scale: number;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  shellObjectNames?: string[];
  fitToDisplaySize?: number;
}

export interface ExperiencePropConfig extends ExperienceModelConfig {
  id: string;
}

export interface ExperienceEnvironmentConfig {
  vrGarageUrl?: string;
  skyboxUrl?: string;
  scale?: number;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  fitToSize?: number;
  brightness?: number;
  /** Hide the environment shell during an immersive AR session, so only the object and the videos overlay the real room. */
  hideInAr?: boolean;
  /** The hangar is lit by 20 lamps inside its GLB, so it renders at a very low exposure. Unlit-file rooms need their own values. */
  lighting?: {
    toneMappingExposure: number;
    hemisphereIntensity: number;
    directionalIntensity: number;
  };
}

export interface ExperiencePartConfig {
  id: string;
  label: string;
  markerPosition: Vector3Tuple;
  explanation: string;
  videoUrl?: string;
  videoActivationMode?: ExperienceVideoActivationMode;
}

export interface ExperienceInitialViewConfig {
  mode: "inspect" | "walk";
  target?: Vector3Tuple;
  position?: Vector3Tuple;
  distance?: number;
  yaw: number;
  pitch: number;
}

export interface ExperienceConfig {
  id: string;
  title: string;
  description: string;
  modes: ExperienceMode[];
  tabletControlMode?: TabletControlMode;
  initialView?: ExperienceInitialViewConfig;
  model: ExperienceModelConfig;
  props?: ExperiencePropConfig[];
  environment?: ExperienceEnvironmentConfig;
  parts: ExperiencePartConfig[];
  introVideos: Record<string, string>;
  assessmentUrl: string;
}
