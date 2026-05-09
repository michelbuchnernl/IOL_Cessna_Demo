import {
  createDefaultChromaBillboardState,
  createDefaultObjectMarkerStates,
  normalizeChromaBillboardState,
  normalizeObjectMarkerState,
  normalizeObjectMarkerStates,
  normalizeParticipantPresence,
  type ChromaBillboardState,
  type ClientCommand,
  type ClientMessage,
  type ObjectMarkerState,
  type ObjectMarkerStates,
  type Participant,
  type ParticipantPresence,
  type Role,
  type SceneObjectId,
  type ServerMessage,
  type Vector3Tuple
} from "./protocol";

type SocketStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export interface ClassroomSocketState {
  status: SocketStatus;
  code?: string;
  participantId?: string;
  participants: Participant[];
  commands: Record<ClientCommand, boolean>;
  animationStep: number;
  objectScale: number;
  modelPosition: Vector3Tuple | null;
  chromaBillboard: ChromaBillboardState;
  objectMarkerStates: ObjectMarkerStates;
  teleportEnabled: boolean;
  error?: string;
}

const initialCommands: Record<ClientCommand, boolean> = {
  "start-experience": false,
  "shell-off": false,
  "play-introduction": false,
  "reveal-markers": false
};

export class ClassroomSocket extends EventTarget {
  private socket?: WebSocket;
  private state: ClassroomSocketState = {
    status: "idle",
    participants: [],
    commands: { ...initialCommands },
    animationStep: 0,
    objectScale: 1,
    modelPosition: null,
    chromaBillboard: createDefaultChromaBillboardState(),
    objectMarkerStates: createDefaultObjectMarkerStates(),
    teleportEnabled: false
  };

  constructor(private readonly endpoint = getDefaultWebSocketUrl()) {
    super();
  }

  get snapshot(): ClassroomSocketState {
    return structuredClone(this.state);
  }

  createSession(experienceId: string, participantName: string): void {
    this.connect(() => {
      this.send({ type: "create-session", experienceId, participantName });
    });
  }

  joinSession(code: string, experienceId: string, role: Role, participantName: string): void {
    this.connect(() => {
      this.send({ type: "join-session", code, experienceId, role, participantName });
    });
  }

  calibrate(origin: number[]): void {
    this.send({ type: "calibrate", origin });
  }

  sendTeacherCommand(command: ClientCommand): void {
    this.send({ type: "teacher-command", command });
  }

  setAnimationStep(step: number): void {
    this.send({ type: "set-animation-step", step });
  }

  setObjectScale(scale: number): void {
    this.send({ type: "set-object-scale", scale });
  }

  setModelPosition(position: Vector3Tuple): void {
    this.send({ type: "set-model-position", position });
  }

  setChromaBillboard(chromaBillboard: ChromaBillboardState): void {
    const state = normalizeChromaBillboardState(chromaBillboard);
    this.send({ type: "set-chroma-billboard", ...state });
  }

  setObjectMarkerState(objectId: SceneObjectId, state: ObjectMarkerState): void {
    this.send({ type: "set-object-marker-state", objectId, state: normalizeObjectMarkerState(state) });
  }

  setTeleportEnabled(enabled: boolean): void {
    this.send({ type: "set-teleport-enabled", enabled });
  }

  setParticipantPresence(presence: ParticipantPresence): void {
    const normalized = normalizeParticipantPresence(presence);
    if (!normalized) {
      return;
    }
    this.send({ type: "set-participant-presence", presence: normalized });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = undefined;
    this.state = {
      status: "idle",
      participants: [],
      commands: { ...initialCommands },
      animationStep: 0,
      objectScale: 1,
      modelPosition: null,
      chromaBillboard: createDefaultChromaBillboardState(),
      objectMarkerStates: createDefaultObjectMarkerStates(),
      teleportEnabled: false
    };
    this.emitChange();
  }

  private connect(onOpen: () => void): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      onOpen();
      return;
    }

    this.state = { ...this.state, status: "connecting", error: undefined };
    this.emitChange();
    this.socket = new WebSocket(this.endpoint);

    this.socket.addEventListener("open", () => {
      this.state = { ...this.state, status: "connected" };
      this.emitChange();
      onOpen();
    });

    this.socket.addEventListener("message", (event) => {
      this.handleMessage(JSON.parse(event.data) as ServerMessage);
    });

    this.socket.addEventListener("close", () => {
      this.state = { ...this.state, status: "disconnected" };
      this.emitChange();
    });

    this.socket.addEventListener("error", () => {
      this.state = { ...this.state, status: "error", error: "Could not connect to the classroom sync server." };
      this.emitChange();
    });
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.state = { ...this.state, status: "error", error: "Classroom sync server is not connected." };
      this.emitChange();
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "error") {
      this.state = { ...this.state, error: message.message };
      this.emitChange();
      return;
    }

    if (message.type === "session-created" || message.type === "joined-session") {
      this.state = { ...this.state, code: message.code, participantId: message.participantId };
      this.emitChange();
      return;
    }

    if (message.type === "session-state") {
      this.state = {
        ...this.state,
        code: message.code,
        participants: message.participants,
        commands: message.commands,
        animationStep: message.animationStep,
        objectScale: message.objectScale,
        modelPosition: message.modelPosition,
        chromaBillboard: normalizeChromaBillboardState(message.chromaBillboard),
        objectMarkerStates: normalizeObjectMarkerStates(message.objectMarkerStates),
        teleportEnabled: message.teleportEnabled,
        error: undefined
      };
      this.emitChange();
      return;
    }

    if (message.type === "participant-presence") {
      const nextParticipants = this.state.participants.map((participant) =>
        participant.id === message.participantId
          ? { ...participant, presence: normalizeParticipantPresence(message.presence) }
          : participant
      );
      this.state = {
        ...this.state,
        participants: nextParticipants
      };
      this.dispatchEvent(new CustomEvent("participant-presence", {
        detail: {
          participantId: message.participantId,
          presence: normalizeParticipantPresence(message.presence),
          participants: structuredClone(nextParticipants)
        }
      }));
      return;
    }

    this.dispatchEvent(new CustomEvent("teacher-command", { detail: message.command }));
  }

  private emitChange(): void {
    this.dispatchEvent(new CustomEvent("change", { detail: this.snapshot }));
  }
}

function getDefaultWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_CLASSROOM_WS_URL as string | undefined;
  if (configuredUrl) {
    return configuredUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/classroom-ws`;
}
