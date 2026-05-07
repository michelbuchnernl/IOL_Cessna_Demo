export type ExperienceMode = "ar" | "vr" | "fallback";
export type TabletControlMode = "inspect" | "explore";

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
}

export interface ExperiencePartConfig {
  id: string;
  label: string;
  markerPosition: Vector3Tuple;
  explanation: string;
  videoUrl?: string;
}

export interface ExperienceConfig {
  id: string;
  title: string;
  description: string;
  modes: ExperienceMode[];
  tabletControlMode?: TabletControlMode;
  model: ExperienceModelConfig;
  props?: ExperiencePropConfig[];
  environment?: ExperienceEnvironmentConfig;
  parts: ExperiencePartConfig[];
  introVideos: Record<string, string>;
  assessmentUrl: string;
}
