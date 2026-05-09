import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { randomUUID } from "node:crypto";
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
  type ObjectMarkerStates,
  type Participant,
  type ParticipantPresence,
  type Role,
  type SceneObjectId,
  type ServerMessage,
  type Vector3Tuple
} from "../src/net/protocol";

type LiveSocket = WebSocket & { isAlive?: boolean };

interface ClientRecord {
  socket: LiveSocket;
  participant: Participant;
  sessionCode: string;
}

interface SessionRecord {
  code: string;
  experienceId: string;
  participants: Map<string, Participant>;
  commands: Record<ClientCommand, boolean>;
  animationStep: number;
  objectScale: number;
  modelPosition: Vector3Tuple | null;
  chromaBillboard: ChromaBillboardState;
  objectMarkerStates: ObjectMarkerStates;
  teleportEnabled: boolean;
}

const port = Number(process.env.PORT ?? 8787);
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_SESSIONS = 1000;
const MAX_CLIENTS_PER_SESSION = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_NAME_LENGTH = 32;
const validCommands = new Set<ClientCommand>([
  "start-experience",
  "shell-off",
  "play-introduction",
  "reveal-markers"
]);
const validRoles = new Set<Role>(["teacher", "student"]);

const server = new WebSocketServer({ port, maxPayload: MAX_MESSAGE_BYTES });
const sessions = new Map<string, SessionRecord>();
const clients = new Map<WebSocket, ClientRecord>();

const initialCommands: Record<ClientCommand, boolean> = {
  "start-experience": false,
  "shell-off": false,
  "play-introduction": false,
  "reveal-markers": false
};

server.on("connection", (socket: LiveSocket) => {
  socket.isAlive = true;

  socket.on("pong", () => {
    socket.isAlive = true;
  });

  socket.on("message", (data) => {
    if (getMessageSize(data) > MAX_MESSAGE_BYTES) {
      send(socket, { type: "error", message: "Message is too large." });
      socket.close(1009, "Message is too large.");
      return;
    }

    try {
      const message = parseClientMessage(data);
      if (!message) {
        send(socket, { type: "error", message: "Invalid message." });
        return;
      }
      handleMessage(socket, message);
    } catch (error) {
      send(socket, { type: "error", message: error instanceof Error ? error.message : "Invalid message." });
    }
  });

  socket.on("close", () => {
    const client = clients.get(socket);
    if (!client) {
      return;
    }

    const session = sessions.get(client.sessionCode);
    session?.participants.delete(client.participant.id);
    clients.delete(socket);
    if (session && session.participants.size === 0) {
      sessions.delete(session.code);
    } else if (session) {
      broadcastState(session);
    }
  });
});

console.log(`Classroom sync server listening on ws://localhost:${port}`);

const heartbeat = setInterval(() => {
  for (const socket of server.clients as Set<LiveSocket>) {
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

server.on("close", () => {
  clearInterval(heartbeat);
});

function handleMessage(socket: WebSocket, message: ClientMessage): void {
  if (message.type === "create-session") {
    if (sessions.size >= MAX_SESSIONS) {
      send(socket, { type: "error", message: "Server is at session capacity." });
      return;
    }

    const code = generateCode();
    const participant = createParticipant(message.participantName, "teacher");
    const session: SessionRecord = {
      code,
      experienceId: message.experienceId,
      participants: new Map([[participant.id, participant]]),
      commands: { ...initialCommands },
      animationStep: 0,
      objectScale: 1,
      modelPosition: null,
      chromaBillboard: createDefaultChromaBillboardState(),
      objectMarkerStates: createDefaultObjectMarkerStates(),
      teleportEnabled: false
    };
    sessions.set(code, session);
    clients.set(socket, { socket, participant, sessionCode: code });
    send(socket, { type: "session-created", code, participantId: participant.id });
    broadcastState(session);
    return;
  }

  if (message.type === "join-session") {
    const code = message.code.trim().toUpperCase();
    const session = sessions.get(code);
    if (!session) {
      send(socket, { type: "error", message: "Session code was not found." });
      return;
    }
    if (session.experienceId !== message.experienceId) {
      send(socket, { type: "error", message: "This code belongs to a different experience." });
      return;
    }
    if (session.participants.size >= MAX_CLIENTS_PER_SESSION) {
      send(socket, { type: "error", message: "This session is full." });
      return;
    }
    const participant = createParticipant(message.participantName, message.role === "teacher" ? "teacher" : "student");
    session.participants.set(participant.id, participant);
    clients.set(socket, { socket, participant, sessionCode: code });
    send(socket, { type: "joined-session", code, participantId: participant.id });
    broadcastState(session);
    for (const [command, active] of Object.entries(session.commands) as [ClientCommand, boolean][]) {
      if (active) {
        send(socket, { type: "teacher-command", command });
      }
    }
    return;
  }

  const client = clients.get(socket);
  if (!client) {
    send(socket, { type: "error", message: "Join or create a session first." });
    return;
  }

  const session = sessions.get(client.sessionCode);
  if (!session) {
    send(socket, { type: "error", message: "Session no longer exists." });
    return;
  }

  if (message.type === "calibrate") {
    client.participant.calibrated = true;
    session.participants.set(client.participant.id, client.participant);
    broadcastState(session);
    return;
  }

  if (message.type === "set-participant-presence") {
    client.participant.presence = normalizeParticipantPresence(message.presence);
    session.participants.set(client.participant.id, client.participant);
    broadcast(session, {
      type: "participant-presence",
      participantId: client.participant.id,
      presence: client.participant.presence
    });
    return;
  }

  if (message.type === "teacher-command") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.commands[message.command] =
      message.command === "reveal-markers"
        ? !session.commands[message.command]
        : true;
    broadcast(session, { type: "teacher-command", command: message.command });
    broadcastState(session);
    return;
  }

  if (message.type === "set-animation-step") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.animationStep = Math.min(7, Math.max(0, Math.round(message.step)));
    broadcastState(session);
    return;
  }

  if (message.type === "set-object-scale") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.objectScale = Math.min(2, Math.max(0.25, message.scale));
    broadcastState(session);
    return;
  }

  if (message.type === "set-model-position") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.modelPosition = message.position;
    broadcastState(session);
    return;
  }

  if (message.type === "set-chroma-billboard") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.chromaBillboard = normalizeChromaBillboardState(message);
    broadcastState(session);
    return;
  }

  if (message.type === "set-object-marker-state") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.objectMarkerStates = {
      ...session.objectMarkerStates,
      [message.objectId]: normalizeObjectMarkerState(message.state)
    };
    broadcastState(session);
    return;
  }

  if (message.type === "set-teleport-enabled") {
    if (client.participant.role !== "teacher") {
      send(socket, { type: "error", message: "Only the teacher can control the shared session." });
      return;
    }
    session.teleportEnabled = message.enabled;
    broadcastState(session);
  }
}

function createParticipant(name: string, role: "teacher" | "student"): Participant {
  const sanitizedName = sanitizeName(name);
  return {
    id: randomUUID(),
    name: sanitizedName || (role === "teacher" ? "Teacher" : "Student"),
    role,
    calibrated: false,
    connectedAt: Date.now(),
    presence: null
  };
}

function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (sessions.has(code));
  return code;
}

function broadcastState(session: SessionRecord): void {
  broadcast(session, {
    type: "session-state",
    code: session.code,
    experienceId: session.experienceId,
    participants: [...session.participants.values()],
    commands: session.commands,
    animationStep: session.animationStep,
    objectScale: session.objectScale,
    modelPosition: session.modelPosition,
    chromaBillboard: session.chromaBillboard,
    objectMarkerStates: session.objectMarkerStates,
    teleportEnabled: session.teleportEnabled
  });
}

function broadcast(session: SessionRecord, message: ServerMessage): void {
  for (const client of clients.values()) {
    if (client.sessionCode === session.code) {
      send(client.socket, message);
    }
  }
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function parseClientMessage(data: RawData): ClientMessage | undefined {
  const parsed = JSON.parse(rawDataToString(data)) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return undefined;
  }

  if (parsed.type === "create-session") {
    return validString(parsed.experienceId, 80) && typeof parsed.participantName === "string"
      ? {
          type: "create-session",
          experienceId: parsed.experienceId,
          participantName: parsed.participantName
        }
      : undefined;
  }

  if (parsed.type === "join-session") {
    return validString(parsed.code, 8) &&
      validString(parsed.experienceId, 80) &&
      validRoles.has(parsed.role as Role) &&
      typeof parsed.participantName === "string"
      ? {
          type: "join-session",
          code: parsed.code.toUpperCase(),
          experienceId: parsed.experienceId,
          role: parsed.role as Role,
          participantName: parsed.participantName
        }
      : undefined;
  }

  if (parsed.type === "calibrate") {
    return Array.isArray(parsed.origin) &&
      parsed.origin.length === 16 &&
      parsed.origin.every((value) => typeof value === "number" && Number.isFinite(value))
      ? { type: "calibrate", origin: parsed.origin }
      : undefined;
  }

  if (parsed.type === "teacher-command") {
    return validCommands.has(parsed.command as ClientCommand)
      ? { type: "teacher-command", command: parsed.command as ClientCommand }
      : undefined;
  }

  if (parsed.type === "set-participant-presence") {
    const presence = normalizeParticipantPresence(parsed.presence);
    return presence
      ? {
          type: "set-participant-presence",
          presence
        }
      : undefined;
  }

  if (parsed.type === "set-animation-step") {
    return typeof parsed.step === "number" && Number.isFinite(parsed.step)
      ? { type: "set-animation-step", step: parsed.step }
      : undefined;
  }

  if (parsed.type === "set-object-scale") {
    return typeof parsed.scale === "number" && Number.isFinite(parsed.scale)
      ? { type: "set-object-scale", scale: parsed.scale }
      : undefined;
  }

  if (parsed.type === "set-model-position") {
    return Array.isArray(parsed.position) &&
      parsed.position.length === 3 &&
      parsed.position.every((value) => typeof value === "number" && Number.isFinite(value))
      ? { type: "set-model-position", position: parsed.position as Vector3Tuple }
      : undefined;
  }

  if (parsed.type === "set-chroma-billboard") {
    if (typeof parsed.visible !== "boolean" || !isRecord(parsed.settings)) {
      return undefined;
    }

    const chromaBillboard = normalizeChromaBillboardState(parsed);
    return {
      type: "set-chroma-billboard",
      visible: chromaBillboard.visible,
      settings: chromaBillboard.settings,
      position: chromaBillboard.position,
      scale: chromaBillboard.scale,
      height: chromaBillboard.height,
      playbackMode: chromaBillboard.playbackMode,
      playbackRevision: chromaBillboard.playbackRevision
    };
  }

  if (parsed.type === "set-object-marker-state") {
    const objectIds = new Set<SceneObjectId>(["model", "chroma"]);
    return objectIds.has(parsed.objectId as SceneObjectId)
      ? {
          type: "set-object-marker-state",
          objectId: parsed.objectId as SceneObjectId,
          state: normalizeObjectMarkerState(parsed.state)
        }
      : undefined;
  }

  if (parsed.type === "set-teleport-enabled") {
    return typeof parsed.enabled === "boolean"
      ? { type: "set-teleport-enabled", enabled: parsed.enabled }
      : undefined;
  }

  return undefined;
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return Buffer.concat(data).toString("utf8");
}

function getMessageSize(data: RawData): number {
  if (typeof data === "string") {
    return Buffer.byteLength(data);
  }
  if (Buffer.isBuffer(data)) {
    return data.byteLength;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }
  return data.reduce((total, item) => total + item.byteLength, 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

function sanitizeName(name: string): string {
  return name
    .trim()
    .replace(/[^\p{L}\p{N} _.-]/gu, "")
    .slice(0, MAX_NAME_LENGTH);
}
