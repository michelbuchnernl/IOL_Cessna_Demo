export type Role = "teacher" | "student";
export type Vector3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];
export type ChromaPlaybackMode = "loop" | "once";
export type SceneObjectId = "model" | "chroma";
export type ObjectMarkerState = "green" | "orange" | "red";
export type ObjectMarkerStates = Record<SceneObjectId, ObjectMarkerState>;

export interface PresenceJoint {
  position: Vector3Tuple;
  quaternion: QuaternionTuple;
}

export interface ParticipantPresence {
  head: PresenceJoint;
  leftHand: PresenceJoint | null;
  rightHand: PresenceJoint | null;
  inVr: boolean;
}

export interface ChromaKeySettings {
  similarity: number;
  smoothness: number;
  spill: number;
  opacity: number;
  brightness: number;
  contrast: number;
}

export interface ChromaBillboardState {
  visible: boolean;
  settings: ChromaKeySettings;
  position: Vector3Tuple | null;
  scale: number;
  height: number;
  playbackMode: ChromaPlaybackMode;
  playbackRevision: number;
}

export const DEFAULT_CHROMA_KEY_SETTINGS: ChromaKeySettings = {
  similarity: 0.36,
  smoothness: 0.08,
  spill: 0.45,
  opacity: 1,
  brightness: 1,
  contrast: 1
};

export const CHROMA_KEY_SETTING_LIMITS: Record<keyof ChromaKeySettings, { min: number; max: number }> = {
  similarity: { min: 0.05, max: 0.8 },
  smoothness: { min: 0, max: 0.4 },
  spill: { min: 0, max: 1 },
  opacity: { min: 0, max: 1 },
  brightness: { min: 0.5, max: 1.5 },
  contrast: { min: 0.5, max: 1.5 }
};

export const CHROMA_BILLBOARD_SCALE_LIMITS = {
  min: 0.25,
  max: 4
};

export const CHROMA_BILLBOARD_HEIGHT_LIMITS = {
  min: 0,
  max: 4
};

export function createDefaultChromaBillboardState(): ChromaBillboardState {
  return {
    visible: false,
    settings: { ...DEFAULT_CHROMA_KEY_SETTINGS },
    position: null,
    scale: 1,
    height: 1.4,
    playbackMode: "loop",
    playbackRevision: 0
  };
}

export function normalizeChromaKeySettings(value: unknown): ChromaKeySettings {
  const record = typeof value === "object" && value !== null ? value as Partial<Record<keyof ChromaKeySettings, unknown>> : {};
  return {
    similarity: normalizeChromaNumber(record.similarity, "similarity"),
    smoothness: normalizeChromaNumber(record.smoothness, "smoothness"),
    spill: normalizeChromaNumber(record.spill, "spill"),
    opacity: normalizeChromaNumber(record.opacity, "opacity"),
    brightness: normalizeChromaNumber(record.brightness, "brightness"),
    contrast: normalizeChromaNumber(record.contrast, "contrast")
  };
}

export function normalizeChromaBillboardState(value: unknown): ChromaBillboardState {
  const record = typeof value === "object" && value !== null ? value as Partial<Record<keyof ChromaBillboardState, unknown>> : {};
  return {
    visible: typeof record.visible === "boolean" ? record.visible : false,
    settings: normalizeChromaKeySettings(record.settings),
    position: normalizeVector3Tuple(record.position),
    scale: normalizeChromaScale(record.scale),
    height: normalizeChromaHeight(record.height),
    playbackMode: record.playbackMode === "once" ? "once" : "loop",
    playbackRevision: normalizePlaybackRevision(record.playbackRevision)
  };
}

export function normalizeChromaScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1;
  }
  return Math.min(CHROMA_BILLBOARD_SCALE_LIMITS.max, Math.max(CHROMA_BILLBOARD_SCALE_LIMITS.min, value));
}

export function normalizeChromaHeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 1.4;
  }
  return Math.min(CHROMA_BILLBOARD_HEIGHT_LIMITS.max, Math.max(CHROMA_BILLBOARD_HEIGHT_LIMITS.min, value));
}

export function createDefaultObjectMarkerStates(): ObjectMarkerStates {
  return {
    model: "green",
    chroma: "green"
  };
}

export function normalizeObjectMarkerStates(value: unknown): ObjectMarkerStates {
  const record = typeof value === "object" && value !== null ? value as Partial<Record<SceneObjectId, unknown>> : {};
  return {
    model: normalizeObjectMarkerState(record.model),
    chroma: normalizeObjectMarkerState(record.chroma)
  };
}

export function normalizeObjectMarkerState(value: unknown): ObjectMarkerState {
  return value === "orange" || value === "red" ? value : "green";
}

export type ClientCommand =
  | "start-experience"
  | "shell-off"
  | "play-introduction"
  | "reveal-markers";

export interface Participant {
  id: string;
  name: string;
  role: Role;
  calibrated: boolean;
  connectedAt: number;
  presence: ParticipantPresence | null;
}

export type ClientMessage =
  | {
      type: "create-session";
      experienceId: string;
      participantName: string;
    }
  | {
      type: "join-session";
      code: string;
      experienceId: string;
      role: Role;
      participantName: string;
    }
  | {
      type: "calibrate";
      origin: number[];
    }
  | {
      type: "set-participant-presence";
      presence: ParticipantPresence;
    }
  | {
      type: "teacher-command";
      command: ClientCommand;
    }
  | {
      type: "set-animation-step";
      step: number;
    }
  | {
      type: "set-object-scale";
      scale: number;
    }
  | {
      type: "set-model-position";
      position: Vector3Tuple;
    }
  | {
      type: "set-chroma-billboard";
      visible: boolean;
      settings: ChromaKeySettings;
      position: Vector3Tuple | null;
      scale: number;
      height: number;
      playbackMode: ChromaPlaybackMode;
      playbackRevision: number;
    }
  | {
      type: "set-object-marker-state";
      objectId: SceneObjectId;
      state: ObjectMarkerState;
    }
  | {
      type: "set-teleport-enabled";
      enabled: boolean;
    };

export type ServerMessage =
  | {
      type: "session-created";
      code: string;
      participantId: string;
    }
  | {
      type: "joined-session";
      code: string;
      participantId: string;
    }
  | {
      type: "session-state";
      code: string;
      experienceId: string;
      participants: Participant[];
      commands: Record<ClientCommand, boolean>;
      animationStep: number;
      objectScale: number;
      modelPosition: Vector3Tuple | null;
      chromaBillboard: ChromaBillboardState;
      objectMarkerStates: ObjectMarkerStates;
      teleportEnabled: boolean;
    }
  | {
      type: "teacher-command";
      command: ClientCommand;
    }
  | {
      type: "participant-presence";
      participantId: string;
      presence: ParticipantPresence | null;
    }
  | {
      type: "error";
      message: string;
    };

function normalizeChromaNumber(value: unknown, key: keyof ChromaKeySettings): number {
  const fallback = DEFAULT_CHROMA_KEY_SETTINGS[key];
  const limits = CHROMA_KEY_SETTING_LIMITS[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(limits.max, Math.max(limits.min, value));
}

function normalizeVector3Tuple(value: unknown): Vector3Tuple | null {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value as Vector3Tuple
    : null;
}

function normalizeQuaternionTuple(value: unknown): QuaternionTuple | null {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
    ? value as QuaternionTuple
    : null;
}

export function normalizePresenceJoint(value: unknown): PresenceJoint | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Partial<Record<keyof PresenceJoint, unknown>>;
  const position = normalizeVector3Tuple(record.position);
  const quaternion = normalizeQuaternionTuple(record.quaternion);
  return position && quaternion ? { position, quaternion } : null;
}

export function normalizeParticipantPresence(value: unknown): ParticipantPresence | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Partial<Record<keyof ParticipantPresence, unknown>>;
  const head = normalizePresenceJoint(record.head);
  if (!head) {
    return null;
  }

  return {
    head,
    leftHand: normalizePresenceJoint(record.leftHand),
    rightHand: normalizePresenceJoint(record.rightHand),
    inVr: typeof record.inVr === "boolean" ? record.inVr : false
  };
}

function normalizePlaybackRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}
