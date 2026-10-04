import {
  CHROMA_BILLBOARD_HEIGHT_LIMITS,
  CHROMA_BILLBOARD_SCALE_LIMITS,
  CHROMA_KEY_SETTING_LIMITS,
  DEFAULT_CHROMA_KEY_SETTINGS,
  createDefaultChromaBillboardState,
  normalizeChromaBillboardState,
  normalizeChromaHeight,
  normalizeChromaKeySettings,
  normalizeChromaScale,
  normalizeObjectMarkerState,
  normalizeVideoPrepState,
  normalizeVideoPrepStates,
  type ChromaBillboardState,
  type ChromaKeySettings,
  type ChromaPlaybackMode,
  type ObjectMarkerState,
  type PartMarkerPositions,
  type PartMarkerStates,
  type Participant,
  type ParticipantDeviceKind,
  type SceneObjectId,
  type VideoPrepState,
  type VideoPrepStates,
  type Vector3Tuple,
  type ClientCommand
} from "../net/protocol";
import { ClassroomSocket, type ClassroomSocketState } from "../net/ClassroomSocket";
import { detectXrCapabilities, getBestMode, type XrCapabilities } from "../scene/capabilities";
import { ExperienceScene } from "../scene/ExperienceScene";
import type { ExperienceConfig, ExperienceMode, ExperiencePartConfig, ExperienceVideoActivationMode, TabletControlMode } from "../types/experience";

type Screen = "select-experience" | "role" | "session";
type Role = "teacher" | "student";
type ChromaSettingKey = keyof ChromaKeySettings;
const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_KEY_ROWS = ["QWERTYUP", "ASDFGHJKL", "ZXCVBNM", "23456789"];
const NAME_KEY_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const MAX_PARTICIPANT_NAME_LENGTH = 18;
// v2: older versions stored the former key threshold default (0.36), which left the green backdrop visible.
const CHROMA_SETTINGS_STORAGE_KEY = "iol-cessna-demo:chroma-key-settings:v2";
const VIDEO_PREP_SETTINGS_STORAGE_KEY = "iol-cessna-demo:video-prep-settings:v2";
const APP_TITLE = "IOL Cessna Demo";
const APP_TAGLINE = "Single-experience WebXR classroom";

interface PersistentChromaMemory {
  settings: ChromaKeySettings;
  scale: number;
  height: number;
  playbackMode: ChromaPlaybackMode;
}

interface AppState {
  screen: Screen;
  selectedExperience?: ExperienceConfig;
  role?: Role;
  mode: ExperienceMode;
  capabilities: XrCapabilities;
  name: string;
  joinCode: string;
  socket: ClassroomSocketState;
  localCalibrated: boolean;
  xrError?: string;
  spawnSuggestion?: string;
  selectedPart?: ExperiencePartConfig;
  chromaPanelOpen: boolean;
  chromaSettings: ChromaKeySettings;
  chromaPosition: Vector3Tuple | null;
  chromaScale: number;
  chromaHeight: number;
  chromaPlaybackMode: ChromaPlaybackMode;
  chromaPlaybackRevision: number;
  partMarkerPositions: PartMarkerPositions;
  partMarkerStates: PartMarkerStates;
  videoPrepStates: VideoPrepStates;
  modelTransformLocked: boolean;
}

const initialChromaMemory = loadPersistentChromaMemory();
const initialVideoPrepMemory = loadPersistentVideoPrepMemory();

export class ClassroomApp {
  private readonly socket = new ClassroomSocket();
  private scene?: ExperienceScene;
  private loadedSceneKey?: string;
  private readonly pendingTeacherCommands = new Set<ClientCommand>();
  private videoPrepBootstrapSessionCode?: string;
  private rangeDragActive = false;
  private renderPending = false;
  private renderFrame?: number;
  private state: AppState = {
    screen: "select-experience",
    mode: "fallback",
    capabilities: { ar: false, vr: false, fallback: true, touch: false, ipad: false },
    name: "",
    joinCode: "",
    socket: this.socket.snapshot,
    localCalibrated: false,
    chromaPanelOpen: false,
    chromaSettings: initialChromaMemory.settings,
    chromaPosition: null,
    chromaScale: initialChromaMemory.scale,
    chromaHeight: initialChromaMemory.height,
    chromaPlaybackMode: initialChromaMemory.playbackMode,
    chromaPlaybackRevision: 0,
    partMarkerPositions: {},
    partMarkerStates: {},
    videoPrepStates: initialVideoPrepMemory,
    modelTransformLocked: true
  };

  constructor(
    private readonly root: HTMLElement,
    private readonly experiences: ExperienceConfig[]
  ) {}

  async start(): Promise<void> {
    this.state.capabilities = await detectXrCapabilities();
    if (this.experiences.length === 1) {
      this.selectExperience(this.experiences[0]);
      this.state.screen = "role";
    }
    this.socket.addEventListener("change", (event) => {
      this.state.socket = (event as CustomEvent<ClassroomSocketState>).detail;
      this.state.videoPrepStates = {
        ...this.state.videoPrepStates,
        ...normalizeVideoPrepStates(this.state.socket.videoPrepStates)
      };
      if (this.state.role === "teacher" && (this.state.socket.chromaBillboard.visible || this.state.socket.chromaBillboard.position)) {
        this.applyLocalChromaState(this.state.socket.chromaBillboard);
      }
      this.applySharedState();
      this.loadTeacherSharedScene();
      this.loadStudentMonitorScene();
      this.bootstrapTeacherVideoPrepState();
      this.requestRender();
    });
    this.socket.addEventListener("teacher-command", (event) => {
      const command = (event as CustomEvent<ClientCommand>).detail;
      if (!this.applyTeacherCommand(command)) {
        this.pendingTeacherCommands.add(command);
      }
    });
    this.socket.addEventListener("participant-presence", (event) => {
      const detail = (event as CustomEvent<{ participants: ClassroomSocketState["participants"] }>).detail;
      this.scene?.setParticipants(detail.participants, this.state.socket.participantId);
    });
    this.installRangeDragGuard();
    this.render();
  }

  // render() replaces the whole markup. Sync updates arrive many times per second, so they are coalesced to one render
  // per frame, and held back while a slider is being dragged (a replaced slider drops the drag after one step).
  private requestRender(): void {
    if (this.rangeDragActive) {
      this.renderPending = true;
      return;
    }
    if (this.renderFrame !== undefined) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = undefined;
      if (this.rangeDragActive) {
        this.renderPending = true;
        return;
      }
      this.render();
    });
  }

  private installRangeDragGuard(): void {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.type === "range") {
        this.rangeDragActive = true;
      }
    }, true);
    const release = () => {
      if (!this.rangeDragActive) {
        return;
      }
      this.rangeDragActive = false;
      if (this.renderPending) {
        this.renderPending = false;
        this.requestRender();
      }
    };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  }

  private render(): void {
    const isSelectScreen = this.state.screen === "select-experience";
    const layoutClass = isSelectScreen ? "layout layout-select" : "layout";
    this.root.innerHTML = `
      <section class="${layoutClass}">
        <aside class="side-panel">${this.renderSidePanel()}</aside>
        ${isSelectScreen ? "" : `
        <section class="stage">
          <div class="scene-shell">
            <div id="scene-container" class="scene-container"></div>
          </div>
          ${this.renderOverlay()}
        </section>
        `}
      </section>
    `;

    this.bindEvents();
    this.applyInputFocus();
    const sceneContainer = this.root.querySelector<HTMLElement>("#scene-container");
    if (sceneContainer) {
      this.ensureScene(sceneContainer);
    }
  }

  private renderSidePanel(): string {
    if (this.state.screen === "select-experience") {
      return `
        <div class="brand">
          <span class="brand-mark"></span>
          <div>
            <h1>${APP_TITLE}</h1>
            <p>${APP_TAGLINE}</p>
          </div>
        </div>
        <div class="capabilities">${this.renderCapabilities()}</div>
        <h2>Experiences</h2>
        <div class="experience-list">
          ${this.experiences.map((experience) => this.renderExperienceCard(experience)).join("")}
        </div>
      `;
    }

    const experience = this.state.selectedExperience;
    return `
      <button class="ghost-button" data-action="back">Back</button>
      <div class="brand compact">
        <span class="brand-mark"></span>
        <div>
          <h1>${experience?.title ?? "Experience"}</h1>
          <p>${this.state.mode.toUpperCase()} mode</p>
        </div>
      </div>
      <div class="capabilities">${this.renderCapabilities()}</div>
      ${this.state.screen === "session" ? this.renderSessionPanel() : ""}
    `;
  }

  private renderCapabilities(): string {
    return `
      <span class="${this.state.capabilities.ar ? "ok" : "muted"}">AR ${this.state.capabilities.ar ? "available" : "unavailable"}</span>
      <span class="${this.state.capabilities.vr ? "ok" : "muted"}">VR ${this.state.capabilities.vr ? "available" : "unavailable"}</span>
      <span class="${this.state.capabilities.touch ? "ok" : "muted"}">Touch ${this.state.capabilities.touch ? "detected" : "not detected"}</span>
      <span class="${this.state.capabilities.ipad ? "ok" : "muted"}">iPad ${this.state.capabilities.ipad ? "detected" : "not detected"}</span>
      <span class="ok">Fallback ready</span>
    `;
  }

  private renderExperienceCard(experience: ExperienceConfig): string {
    const mode = getBestMode(this.state.capabilities, experience.modes);
    return `
      <button class="experience-card" data-experience-id="${experience.id}">
        <span>${experience.title}</span>
        <small>${experience.description}</small>
        <strong>${mode.toUpperCase()}</strong>
      </button>
    `;
  }

  private renderOverlay(): string {
    if (this.state.screen === "role") {
      return `
        <div class="modal">
          <div class="modal-body modal-body-keyboard">
            <h2>Choose role</h2>
            <p>${this.state.selectedExperience?.title ?? ""}</p>
            <label>
              Display name
              <input id="participant-name" type="text" maxlength="${MAX_PARTICIPANT_NAME_LENGTH}" value="${this.escape(this.state.name)}" placeholder="Student 1" inputmode="text" autocapitalize="words" autocomplete="name" enterkeyhint="done" />
            </label>
            <div class="name-pad">
              ${NAME_KEY_ROWS.map((row) => `
                <div class="name-pad-row">
                  ${row.split("").map((character) => `
                    <button class="secondary-button name-key" data-name-key="${character}">${character}</button>
                  `).join("")}
                </div>
              `).join("")}
              <div class="name-pad-actions">
                <button class="secondary-button" data-name-key=" ">Space</button>
                <button class="secondary-button" data-action="name-backspace">Backspace</button>
                <button class="secondary-button" data-action="name-clear">Clear</button>
              </div>
            </div>
            <div class="role-grid">
              <button class="primary-button" data-role="teacher">Teacher</button>
              <button class="secondary-button" data-role="student">Student</button>
            </div>
          </div>
        </div>
      `;
    }

    if (this.state.screen !== "session") {
      return "";
    }

    if (!this.state.socket.code && this.state.role) {
      if (this.state.role === "teacher") {
        return `
          <div class="modal">
            <div class="modal-body">
              <h2>Teacher session</h2>
              <p>Create a new teacher session or join an existing one by code.</p>
              <label>
                Session code
                <input id="join-code" maxlength="4" value="${this.escape(this.state.joinCode)}" placeholder="A1B2" inputmode="text" autocapitalize="characters" autocomplete="off" enterkeyhint="go" />
              </label>
              <div class="role-grid">
                <button class="primary-button" data-action="create-teacher-session">Create New</button>
                <button class="secondary-button" data-action="join">Join By Code</button>
              </div>
              ${this.renderError()}
            </div>
          </div>
        `;
      }

      const useCodePad = this.state.capabilities.touch || this.state.capabilities.vr;
      return `
        <div class="modal">
          <div class="modal-body modal-body-wide">
            <h2>Join session</h2>
            ${useCodePad ? "" : `<label>
              Session code
              <input id="join-code" maxlength="4" value="${this.escape(this.state.joinCode)}" placeholder="A1B2" inputmode="text" autocapitalize="characters" autocomplete="off" enterkeyhint="go" />
            </label>`}
            <div class="join-code-display" aria-live="polite">${this.renderJoinCodeSlots()}</div>
            <div class="code-pad">
              ${CODE_KEY_ROWS.map((row) => `
                <div class="code-pad-row">
                  ${row.split("").map((character) => `
                    <button class="secondary-button code-key" data-code-key="${character}">${character}</button>
                  `).join("")}
                </div>
              `).join("")}
            </div>
            <div class="code-pad-actions">
              <button class="secondary-button" data-action="code-backspace">Backspace</button>
              <button class="secondary-button" data-action="code-clear">Clear</button>
            </div>
            <button class="primary-button full" data-action="join">Join</button>
            ${this.renderError()}
          </div>
        </div>
      `;
    }

    return `
      <div class="hud ${this.state.mode === "ar" ? "hud-ar" : ""}">
        ${this.renderXrControls()}
        ${this.state.mode === "ar" ? "" : `<button class="secondary-button" data-action="calibrate">Calibrate</button>`}
        <button class="secondary-button" data-action="back">Menu</button>
        ${this.renderScaleControl()}
        ${this.renderObjectStateControls()}
        ${this.renderTeacherControls()}
        <a class="assessment-link" href="${this.state.selectedExperience?.assessmentUrl ?? "#"}" target="_blank" rel="noreferrer">Assessment</a>
      </div>
      ${this.renderTabletControlsOverlay()}
      ${this.renderTouchGuidance()}
      ${this.renderXrError()}
      ${this.renderSpawnSuggestion()}
      ${this.renderSelectedPart()}
      ${this.renderChromaPanel()}
    `;
  }

  private renderTouchGuidance(): string {
    if (!this.state.capabilities.touch || this.state.mode !== "fallback" || !this.state.selectedExperience) {
      return "";
    }

    const tabletMode = this.state.selectedExperience.tabletControlMode ?? "explore";
    const text = tabletMode === "inspect"
      ? "Drag: orbit. Pinch: zoom. Two-finger drag: pan. Double tap: reset. Tap objects: inspect."
      : "Left stick: move. Drag right side: look around. Movement stays in bounds.";
    return `
      <p class="xr-error">${text}</p>
    `;
  }

  private renderTabletControlsOverlay(): string {
    if (!this.state.capabilities.touch || this.state.mode !== "fallback" || !this.state.selectedExperience) {
      return "";
    }

    const tabletMode: TabletControlMode = this.state.selectedExperience.tabletControlMode ?? "explore";
    if (tabletMode === "inspect") {
      return `
        <div class="tablet-overlay tablet-overlay-inspect" aria-hidden="true">
          <div class="tablet-pill">Inspect Mode</div>
          <div class="tablet-action-row">
            <div class="tablet-hint-chip">Drag</div>
            <div class="tablet-hint-chip">Pinch</div>
            <div class="tablet-hint-chip">Two-finger pan</div>
          </div>
        </div>
      `;
    }

    return `
      <div class="tablet-overlay tablet-overlay-explore" aria-hidden="true">
        <div class="tablet-joystick-visual">
          <div class="tablet-joystick-inner"></div>
        </div>
        <div class="tablet-look-zone">Look</div>
      </div>
    `;
  }

  private renderJoinCodeSlots(): string {
    return Array.from({ length: 4 }, (_, index) => {
      const value = this.state.joinCode[index] ?? "";
      return `<span class="join-code-slot">${value || "·"}</span>`;
    }).join("");
  }

  private renderXrControls(): string {
    const modes = this.state.selectedExperience?.modes ?? [];
    const controls: string[] = [];

    if (modes.includes("vr") && this.state.capabilities.vr) {
      const action = this.state.role === "teacher" && !this.state.socket.commands["start-experience"] ? "start-and-enter-vr" : "enter-vr";
      const label = action === "start-and-enter-vr" ? "Start + Enter VR" : "Enter VR";
      controls.push(`<button class="primary-button" data-action="${action}">${label}</button>`);
    }

    if (modes.includes("vr")) {
      const label = this.state.role === "teacher" ? "VR on Monitor" : "Monitor View";
      controls.push(`<button class="secondary-button" data-action="monitor-vr">${label}</button>`);
    }

    if (modes.includes("ar") && this.state.capabilities.ar) {
      controls.push(`<button class="secondary-button" data-action="enter-ar">Enter AR</button>`);
    }

    if (controls.length === 0) {
      controls.push(`<span class="fallback-pill">Fallback mode</span>`);
    }

    return controls.join("");
  }

  private renderXrError(): string {
    return this.state.xrError ? `<p class="xr-error">${this.escape(this.state.xrError)}</p>` : "";
  }

  private renderSpawnSuggestion(): string {
    if (!this.state.spawnSuggestion) {
      return "";
    }

    return `
      <aside class="spawn-suggestion">
        <button class="close-button" data-action="clear-spawn-suggestion">×</button>
        <h2>Captured View</h2>
        <p>Copied to clipboard. Paste this into the experience config when the view feels right.</p>
        <pre>${this.escape(this.state.spawnSuggestion)}</pre>
      </aside>
    `;
  }

  private renderSessionPanel(): string {
    const code = this.state.socket.code ?? "----";
    const participants = this.state.socket.participants;
    return `
      <div class="session-code">
        <span>Session</span>
        <strong>${code}</strong>
      </div>
      <div class="status-row">
        <span>Sync</span>
        <strong>${this.state.socket.status}</strong>
      </div>
      ${this.renderError()}
      <h2>Participants</h2>
      <ul class="participant-list">
        ${participants.map((participant) => `
          <li>
            <span>${this.escape(this.getParticipantDisplayName(participant))} <small>${participant.role}</small></span>
            <strong class="${participant.calibrated ? "ok" : "muted"}">${participant.calibrated ? "calibrated" : "waiting"}</strong>
          </li>
        `).join("") || "<li><span>No one connected yet</span></li>"}
      </ul>
    `;
  }

  private getParticipantDisplayName(participant: Participant): string {
    return `${participant.name} (${this.getParticipantDeviceLabel(participant)})`;
  }

  private getParticipantDeviceLabel(participant: Participant): "VR" | "PC" | "TAB" {
    const kind = participant.presence?.inVr ? "vr" : participant.deviceKind;
    if (kind === "vr") {
      return "VR";
    }
    return kind === "tablet" ? "TAB" : "PC";
  }

  private getLocalParticipantDeviceKind(): ParticipantDeviceKind {
    if (this.state.capabilities.vr) {
      return "vr";
    }
    return this.state.capabilities.ipad || this.state.capabilities.touch ? "tablet" : "pc";
  }

  private renderTeacherControls(): string {
    if (this.state.role !== "teacher") {
      return "";
    }

    const commands = this.state.socket.commands;
    return `
      <button class="primary-button" data-command="start-experience">${commands["start-experience"] ? "Experience Started" : "Start Experience"}</button>
      <button class="secondary-button" data-command="shell-off">${commands["shell-off"] ? "Shell Hidden" : "Shell Off"}</button>
      <button class="secondary-button" data-command="play-introduction">Restart Video</button>
      <button class="secondary-button" data-command="reveal-markers">${commands["reveal-markers"] ? "Markers Revealed" : "Reveal Markers"}</button>
      <button class="secondary-button" data-action="capture-view">Capture View</button>
    `;
  }

  private renderAnimationControls(): string {
    if (this.state.role !== "teacher") {
      return "";
    }

    return `
      <button class="secondary-button step-button" data-action="animation-previous-step" aria-label="Previous animation step">‹</button>
      <span class="step-count">Step ${this.state.socket.animationStep}/7</span>
      <button class="secondary-button step-button" data-action="animation-next-step" aria-label="Next animation step">›</button>
    `;
  }

  private renderScaleControl(): string {
    if (this.state.role !== "teacher") {
      return "";
    }

    return `
      <label class="scale-control">
        Size
        <input data-action="object-scale" type="range" min="0.25" max="2" step="0.05" value="${this.state.socket.objectScale}" ${this.state.modelTransformLocked ? "disabled" : ""} />
      </label>
    `;
  }

  private renderObjectStateControls(): string {
    if (this.state.role !== "teacher") {
      return "";
    }

    return `
      <label class="object-state-control">
        Turbofan
        ${this.renderObjectStateSelect("model")}
      </label>
      <button class="secondary-button" data-action="toggle-model-lock">${this.state.modelTransformLocked ? "Unlock Turbofan" : "Lock Turbofan"}</button>
      <label class="object-state-control">
        Turbine Video
        ${this.renderObjectStateSelect("chroma")}
      </label>
    `;
  }

  private renderObjectStateSelect(objectId: SceneObjectId): string {
    const state = this.state.socket.objectMarkerStates[objectId];
    return `
      <select data-action="object-marker-state" data-object-id="${objectId}">
        <option value="green" ${state === "green" ? "selected" : ""}>Green: visible</option>
        <option value="orange" ${state === "orange" ? "selected" : ""}>Orange: teacher only</option>
        <option value="red" ${state === "red" ? "selected" : ""}>Red: hidden label</option>
      </select>
    `;
  }

  private renderSelectedPart(): string {
    const part = this.state.selectedPart;
    if (!part) {
      return "";
    }

    const videoActivationMode = this.getPartVideoActivationMode(part);
    const controls = videoActivationMode === "standard";
    const activationText = videoActivationMode === "student"
      ? "Student-activated video"
      : videoActivationMode === "teacher"
        ? "Teacher-controlled video"
        : "";

    return `
      <aside class="part-panel">
        <button class="close-button" data-action="close-part">×</button>
        <h2>${part.label}</h2>
        <p>${part.explanation}</p>
        ${activationText ? `<p>${activationText}</p>` : ""}
        ${part.videoUrl && controls ? `<video controls playsinline preload="auto" src="${part.videoUrl}"></video>` : ""}
      </aside>
    `;
  }

  private renderChromaPanel(): string {
    if (this.state.role !== "teacher" || !this.state.chromaPanelOpen) {
      return "";
    }

    const prepState = this.getCurrentChromaPanelState();
    return `
      <aside class="chroma-panel">
        <button class="close-button" data-action="close-chroma-panel">×</button>
        <h2>Green Screen Video</h2>
        <p>Adjust the key until the green disappears without cutting into the footage. Values are remembered on this device.</p>
        ${this.renderSelectedPartMarkerStateControl()}
        <label class="chroma-control">
          <span>
            Video size
            <output data-chroma-value="scale">${prepState.scale.toFixed(2)}</output>
          </span>
          <input data-action="chroma-scale" type="range" min="${CHROMA_BILLBOARD_SCALE_LIMITS.min}" max="${CHROMA_BILLBOARD_SCALE_LIMITS.max}" step="0.05" value="${prepState.scale}" />
        </label>
        <label class="chroma-control">
          <span>
            Height
            <output data-chroma-value="height">${prepState.height.toFixed(2)}</output>
          </span>
          <input data-action="chroma-height" type="range" min="${CHROMA_BILLBOARD_HEIGHT_LIMITS.min}" max="${CHROMA_BILLBOARD_HEIGHT_LIMITS.max}" step="0.05" value="${prepState.height}" />
        </label>
        <label class="chroma-control">
          <span>Playback</span>
          <select data-action="chroma-playback">
            <option value="loop" ${prepState.playbackMode === "loop" ? "selected" : ""}>Loop continuously</option>
            <option value="once" ${prepState.playbackMode === "once" ? "selected" : ""}>Play once beginning to end</option>
          </select>
        </label>
        ${this.renderChromaSlider("similarity", "Key threshold", 0.01)}
        ${this.renderChromaSlider("smoothness", "Edge softness", 0.01)}
        ${this.renderChromaSlider("spill", "Green spill cleanup", 0.01)}
        ${this.renderChromaSlider("opacity", "Opacity", 0.01)}
        ${this.renderChromaSlider("brightness", "Brightness", 0.01)}
        ${this.renderChromaSlider("contrast", "Contrast", 0.01)}
        <div class="chroma-panel-actions">
          <button class="secondary-button" data-action="play-selected-video">Play</button>
          <button class="secondary-button" data-action="pause-selected-video">Pause</button>
          <button class="secondary-button" data-action="restart-chroma">Play From Start</button>
          <button class="secondary-button" data-action="reset-chroma">Reset</button>
          <button class="secondary-button" data-action="hide-chroma">Hide Video</button>
        </div>
      </aside>
    `;
  }

  private renderSelectedPartMarkerStateControl(): string {
    const part = this.state.selectedPart;
    if (!part?.videoUrl) {
      return "";
    }

    const activationMode = this.getPartVideoActivationMode(part);
    const state = this.getVideoPrepState(part).markerState;
    const label = activationMode === "student" ? "Student access" : "Video visibility";
    return `
      <label class="chroma-control">
        <span>${label}</span>
        <select data-action="part-marker-state" data-part-id="${part.id}">
          <option value="green" ${state === "green" ? "selected" : ""}>Green: visible</option>
          <option value="orange" ${state === "orange" ? "selected" : ""}>Orange: teacher only</option>
          <option value="red" ${state === "red" ? "selected" : ""}>Red: hidden</option>
        </select>
      </label>
    `;
  }

  private renderChromaSlider(key: ChromaSettingKey, label: string, step: number): string {
    const limits = CHROMA_KEY_SETTING_LIMITS[key];
    const value = this.getCurrentChromaPanelState().settings[key];
    return `
      <label class="chroma-control">
        <span>
          ${label}
          <output data-chroma-value="${key}">${value.toFixed(2)}</output>
        </span>
        <input
          data-action="chroma-setting"
          data-chroma-setting="${key}"
          type="range"
          min="${limits.min}"
          max="${limits.max}"
          step="${step}"
          value="${value}"
        />
      </label>
    `;
  }

  private renderError(): string {
    return this.state.socket.error ? `<p class="error">${this.escape(this.state.socket.error)}</p>` : "";
  }

  private bindEvents(): void {
    this.root.querySelectorAll<HTMLElement>("[data-experience-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const experience = this.experiences.find((item) => item.id === button.dataset.experienceId);
        if (!experience) {
          return;
        }
        this.selectExperience(experience);
        this.state.screen = "role";
        this.render();
      });
    });

    this.root.querySelectorAll<HTMLElement>("[data-role]").forEach((button) => {
      button.addEventListener("click", () => {
        this.updateNameFromInput();
        this.state.role = button.dataset.role as Role;
        this.scene?.setRole(this.state.role);
        this.state.screen = "session";
        if (this.state.role === "teacher" && this.state.selectedExperience) {
          // Teacher session creation or join choice is handled in the session modal.
        }
        this.render();
      });
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-command]").forEach((button) => {
      button.addEventListener("click", () => {
        const command = button.dataset.command as ClientCommand;
        if (command === "start-experience") {
          this.applyTeacherCommand(command);
        }
        if (command === "play-introduction") {
          const teacherVideoPart = this.getTeacherVideoPart();
          if (teacherVideoPart) {
            this.state.selectedPart = teacherVideoPart;
            this.state.chromaPanelOpen = true;
            this.setVideoPrepState(teacherVideoPart, {
              ...this.getVideoPrepState(teacherVideoPart),
              playbackPaused: false,
              markerState: "green"
            });
          }
        }
        this.socket.sendTeacherCommand(command);
        if (command === "play-introduction") {
          this.render();
        }
      });
    });

    this.root.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => this.handleAction(button.dataset.action ?? ""));
    });

    const participantNameInput = this.root.querySelector<HTMLInputElement>("#participant-name");
    if (participantNameInput) {
      participantNameInput.value = this.state.name;
      participantNameInput.addEventListener("input", () => {
        this.state.name = this.normalizeParticipantName(participantNameInput.value, true);
      });
      participantNameInput.addEventListener("pointerup", () => {
        this.focusTextInput(participantNameInput);
      });
      participantNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          participantNameInput.blur();
        }
      });
    }

    this.root.querySelectorAll<HTMLElement>("[data-code-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const character = button.dataset.codeKey ?? "";
        this.appendJoinCodeCharacter(character);
      });
    });

    this.root.querySelectorAll<HTMLElement>("[data-name-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const character = button.dataset.nameKey ?? "";
        this.appendNameCharacter(character);
      });
    });

    const joinCodeInput = this.root.querySelector<HTMLInputElement>("#join-code");
    if (joinCodeInput) {
      joinCodeInput.value = this.state.joinCode;
      joinCodeInput.addEventListener("input", () => {
        joinCodeInput.value = joinCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
        this.state.joinCode = joinCodeInput.value;
        this.render();
      });
      joinCodeInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          this.handleAction("join");
        }
      });
    }

    this.root.querySelectorAll<HTMLInputElement>('input[data-action="object-scale"]').forEach((input) => {
      input.addEventListener("input", () => {
        if (this.state.modelTransformLocked) {
          input.value = String(this.state.socket.objectScale);
          return;
        }
        this.socket.setObjectScale(Number(input.value));
      });
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-action="object-marker-state"]').forEach((select) => {
      select.addEventListener("change", () => this.handleObjectMarkerStateInput(select));
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-action="part-marker-state"]').forEach((select) => {
      select.addEventListener("change", () => this.handlePartMarkerStateInput(select));
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-action="chroma-setting"]').forEach((input) => {
      input.addEventListener("input", () => this.handleChromaSettingInput(input));
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-action="chroma-scale"]').forEach((input) => {
      input.addEventListener("input", () => this.handleChromaScaleInput(input));
    });

    this.root.querySelectorAll<HTMLInputElement>('input[data-action="chroma-height"]').forEach((input) => {
      input.addEventListener("input", () => this.handleChromaHeightInput(input));
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-action="chroma-playback"]').forEach((select) => {
      select.addEventListener("change", () => this.handleChromaPlaybackInput(select));
    });

    const selectedVideo = this.root.querySelector<HTMLVideoElement>('.part-panel video[data-auto-play="true"]');
    if (selectedVideo && this.state.selectedPart?.videoUrl) {
      selectedVideo.currentTime = 0;
      void selectedVideo.play().catch(() => undefined);
      if (this.getPartVideoActivationMode(this.state.selectedPart) === "student") {
        selectedVideo.addEventListener("ended", () => {
          this.state.selectedPart = undefined;
          this.render();
        }, { once: true });
      }
    }
  }

  private handleAction(action: string): void {
    if (action === "back") {
      this.returnToMenu();
      this.render();
      return;
    }

    if (action === "join") {
      const input = this.root.querySelector<HTMLInputElement>("#join-code");
      if (input) {
        this.state.joinCode = input.value.trim().toUpperCase();
      }
      if (this.state.selectedExperience && this.state.role) {
        this.socket.joinSession(this.state.joinCode, this.state.selectedExperience.id, this.state.role, this.state.name || "Student", this.getLocalParticipantDeviceKind());
      }
      this.render();
      return;
    }

    if (action === "create-teacher-session") {
      if (this.state.selectedExperience && this.state.role === "teacher") {
        this.socket.createSession(this.state.selectedExperience.id, this.state.name || "Teacher", this.getLocalParticipantDeviceKind());
        this.loadSelectedExperience(this.state.mode, true);
      }
      this.render();
      return;
    }

    if (action === "edit-name") {
      this.promptForParticipantName();
      return;
    }

    if (action === "name-backspace") {
      this.state.name = this.state.name.slice(0, -1);
      this.render();
      return;
    }

    if (action === "name-clear") {
      this.state.name = "";
      this.render();
      return;
    }

    if (action === "code-backspace") {
      this.state.joinCode = this.state.joinCode.slice(0, -1);
      this.render();
      return;
    }

    if (action === "code-clear") {
      this.state.joinCode = "";
      this.render();
      return;
    }

    if (action === "calibrate") {
      const origin = this.scene?.calibrateOrigin() ?? [];
      this.state.localCalibrated = true;
      this.socket.calibrate(origin);
      this.render();
      return;
    }

    if (action === "capture-view") {
      this.captureViewSuggestion();
      return;
    }

    if (action === "clear-spawn-suggestion") {
      this.state.spawnSuggestion = undefined;
      this.render();
      return;
    }

    if (action === "toggle-model-lock") {
      this.state.modelTransformLocked = !this.state.modelTransformLocked;
      this.scene?.setModelTransformLocked(this.state.modelTransformLocked);
      this.render();
      return;
    }

    if (action === "start-and-enter-vr") {
      this.applyTeacherCommand("start-experience");
      this.socket.sendTeacherCommand("start-experience");
      this.enterXr("vr");
      return;
    }

    if (action === "monitor-vr") {
      this.scene?.suppressPointerSelection();
      if (this.state.selectedExperience) {
        this.loadSelectedExperience("vr", false);
      }
      if (this.state.role === "teacher") {
        this.applyTeacherCommand("start-experience");
        this.socket.sendTeacherCommand("start-experience");
      }
      this.render();
      return;
    }

    if (action === "animation-previous-step" || action === "animation-next-step") {
      const direction = action === "animation-next-step" ? 1 : -1;
      const nextStep = Math.min(7, Math.max(0, this.state.socket.animationStep + direction));
      this.socket.setAnimationStep(nextStep);
      return;
    }

    if (action === "enter-vr" || action === "enter-ar") {
      const mode = action === "enter-vr" ? "vr" : "ar";
      this.enterXr(mode);
      return;
    }

    if (action === "close-part") {
      this.state.selectedPart = undefined;
      this.render();
      return;
    }

    if (action === "close-chroma-panel") {
      this.state.chromaPanelOpen = false;
      this.render();
      return;
    }

    if (action === "hide-chroma") {
      const selectedVideoPart = this.getSelectedVideoPart();
      if (selectedVideoPart) {
        this.setVideoPrepState(selectedVideoPart, {
          ...this.getVideoPrepState(selectedVideoPart),
          playbackPaused: true,
          markerState: "red"
        });
        this.state.chromaPanelOpen = false;
        this.render();
        return;
      }
      this.state.chromaPanelOpen = false;
      this.scene?.hideChromaBillboard();
      if (this.state.role === "teacher" && this.state.socket.code) {
        this.socket.setChromaBillboard(this.buildChromaBillboardState(false));
      }
      this.render();
      return;
    }

    if (action === "reset-chroma") {
      const selectedVideoPart = this.getSelectedVideoPart();
      if (selectedVideoPart) {
        const current = this.getVideoPrepState(selectedVideoPart);
        this.setVideoPrepState(selectedVideoPart, {
          ...this.createDefaultVideoPrepState(selectedVideoPart),
          markerState: current.markerState,
          playbackRevision: current.playbackRevision,
          playbackPaused: true
        });
        this.scene?.pausePartVideo(selectedVideoPart.id);
        this.render();
        return;
      }
      this.state.chromaSettings = { ...DEFAULT_CHROMA_KEY_SETTINGS };
      this.state.chromaScale = 1;
      this.state.chromaHeight = 1.4;
      this.state.chromaPlaybackMode = "loop";
      this.saveChromaMemory();
      this.scene?.setChromaSettings(this.state.chromaSettings);
      this.scene?.setChromaBillboardScale(this.state.chromaScale);
      this.scene?.setChromaBillboardHeight(this.state.chromaHeight);
      this.scene?.setChromaPlaybackMode(this.state.chromaPlaybackMode);
      if (this.state.role === "teacher" && this.state.socket.code) {
        this.socket.setChromaBillboard(this.buildChromaBillboardState(this.state.socket.chromaBillboard.visible));
      }
      this.render();
      return;
    }

    if (action === "restart-chroma") {
      const selectedVideoPart = this.getSelectedVideoPart();
      if (selectedVideoPart) {
        const current = this.getVideoPrepState(selectedVideoPart);
        this.setVideoPrepState(selectedVideoPart, {
          ...current,
          playbackRevision: current.playbackRevision + 1,
          playbackPaused: false
        });
        this.scene?.playPartVideo(selectedVideoPart.id, true, this.state.role !== "teacher");
        this.render();
        return;
      }
      this.state.chromaPlaybackRevision += 1;
      if (this.state.role === "teacher" && this.state.selectedPart?.videoUrl && this.scene?.restartSelectedPartVideo()) {
        return;
      }
      this.scene?.setChromaBillboardState(this.buildChromaBillboardState(true));
      this.state.chromaPosition = this.scene?.getChromaBillboardState(true).position ?? this.state.chromaPosition;
      if (this.state.role === "teacher" && this.state.socket.code) {
        this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
      }
      return;
    }

    if (action === "play-selected-video") {
      const selectedVideoPart = this.getSelectedVideoPart();
      if (this.state.role === "teacher" && selectedVideoPart) {
        this.setVideoPrepState(selectedVideoPart, {
          ...this.getVideoPrepState(selectedVideoPart),
          playbackPaused: false
        });
        this.scene?.playPartVideo(selectedVideoPart.id, false, false);
        return;
      }
      this.scene?.restartChromaBillboard();
      return;
    }

    if (action === "pause-selected-video") {
      const selectedVideoPart = this.getSelectedVideoPart();
      if (this.state.role === "teacher" && selectedVideoPart) {
        this.setVideoPrepState(selectedVideoPart, {
          ...this.getVideoPrepState(selectedVideoPart),
          playbackPaused: true
        });
        this.scene?.pausePartVideo(selectedVideoPart.id);
        return;
      }
      this.scene?.pauseChromaBillboard();
      return;
    }
  }

  private ensureScene(container: HTMLElement): void {
    if (!this.scene) {
      this.scene = new ExperienceScene({
        container,
        onMarkerSelected: (part) => {
          this.state.selectedPart = part;
          if (this.state.role === "teacher" && part.videoUrl) {
            this.setVideoPrepState(part, this.getVideoPrepState(part), false);
            this.state.chromaPanelOpen = true;
          }
          this.render();
        },
        onChromaMarkerSelected: () => {
          if (this.state.role !== "teacher") {
            return;
          }
          this.state.selectedPart = undefined;
          this.state.chromaPanelOpen = true;
          this.scene?.setChromaBillboardState(this.buildChromaBillboardState(true));
          if (this.state.socket.code) {
            this.socket.setChromaBillboard(this.scene?.getChromaBillboardState(true) ?? this.buildChromaBillboardState(true));
          }
          this.render();
        },
        onTeacherCommand: (command) => {
          this.socket.sendTeacherCommand(command);
        },
        onAnimationStep: (direction) => {
          const nextStep = Math.min(7, Math.max(0, this.state.socket.animationStep + direction));
          this.socket.setAnimationStep(nextStep);
        },
        onScaleStep: (direction) => {
          if (this.state.modelTransformLocked) {
            return;
          }
          const nextScale = Math.min(2, Math.max(0.25, this.state.socket.objectScale + direction * 0.1));
          this.socket.setObjectScale(nextScale);
        },
        onObjectScaleChange: (scale) => {
          if (this.state.role === "teacher" && !this.state.modelTransformLocked) {
            this.socket.setObjectScale(scale);
          }
        },
        onModelPositionChange: (position, options) => {
          if (this.state.role === "teacher" && (!this.state.modelTransformLocked || options?.force)) {
            this.socket.setModelPosition(position);
          }
        },
        onPartMarkerPositionChange: (partId, position) => {
          const part = this.getPartById(partId);
          if (part?.videoUrl && this.state.role === "teacher") {
            this.setVideoPrepState(part, {
              ...this.getVideoPrepState(part),
              position,
              height: normalizeChromaHeight(position[1])
            });
            return;
          }
          this.socket.setPartMarkerPosition(partId, position);
        },
        onChromaTransformChange: (position, scale) => {
          if (this.state.role === "teacher") {
            this.state.chromaPosition = position;
            this.state.chromaScale = scale;
            this.state.chromaHeight = normalizeChromaHeight(position[1]);
            this.saveChromaMemory();
            this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
          }
        },
        onChromaBillboardStateChange: (state) => {
          if (this.state.role === "teacher") {
            this.applyLocalChromaState(state);
            this.socket.setChromaBillboard(state);
            this.render();
          }
        },
        onObjectMarkerStateChange: (objectId, state) => {
          if (this.state.role === "teacher") {
            this.socket.setObjectMarkerState(objectId, state);
          }
        },
        onParticipantPresenceChange: (presence) => {
          if (this.state.socket.code) {
            this.socket.setParticipantPresence(presence);
          }
        },
        onCalibrate: (origin) => {
          this.state.localCalibrated = true;
          this.socket.calibrate(origin);
          this.render();
        },
        onBackToMenu: () => {
          this.returnToMenu();
          this.render();
        }
      });
      this.scene.setRole(this.state.role);
      this.scene.setModelTransformLocked(this.state.modelTransformLocked);
      this.scene.setLocalParticipantId(this.state.socket.participantId);
    } else if (!container.contains(this.scene.domElement)) {
      container.append(this.scene.domElement);
    }
    this.scene.setContainer(container);
    this.scene.refreshViewport();
    this.scene.setModelTransformLocked(this.state.modelTransformLocked);
    this.scene.setLocalParticipantId(this.state.socket.participantId);
    this.scene.setParticipants(this.state.socket.participants, this.state.socket.participantId);

  }

  private applyTeacherCommand(command: ClientCommand): boolean {
    if (command === "start-experience") {
      this.scene?.startExperience();
      return Boolean(this.scene);
    }
    if (command === "shell-off") {
      this.scene?.setShellVisible(false);
      return Boolean(this.scene);
    }
    if (command === "play-introduction") {
      this.scene?.startExperience();
      const teacherVideoPart = this.getTeacherVideoPart();
      if (teacherVideoPart?.videoUrl && this.scene?.playPartVideo(teacherVideoPart.id, true, this.state.role !== "teacher")) {
        return true;
      }
      if (!this.scene || !this.state.selectedExperience?.introVideos.default) {
        return false;
      }
      this.scene.playIntroduction(this.state.selectedExperience.introVideos.default);
      return true;
    }
    return true;
  }

  private applySharedState(): void {
    this.scene?.setLocalParticipantId(this.state.socket.participantId);
    this.scene?.setParticipants(this.state.socket.participants, this.state.socket.participantId);
    this.scene?.setAnimationStep(this.state.socket.animationStep);
    this.scene?.setObjectScale(this.state.socket.objectScale);
    if (this.state.socket.modelPosition) {
      this.scene?.setModelPosition(this.state.socket.modelPosition);
    }
    this.scene?.setChromaBillboardState(this.state.socket.chromaBillboard);
    this.scene?.setVideoPrepStates(this.state.socket.code ? this.state.socket.videoPrepStates : this.state.videoPrepStates);
    this.scene?.setObjectMarkerStates(this.state.socket.objectMarkerStates);
    this.scene?.setMarkersVisible(this.state.socket.commands["reveal-markers"]);
    this.scene?.setPartMarkerPositions(this.state.socket.partMarkerPositions);
    this.scene?.setPartMarkerStates(this.state.socket.partMarkerStates);
    if (this.state.socket.commands["start-experience"]) {
      this.scene?.startExperience();
    }
    this.flushPendingTeacherCommands();
  }

  private flushPendingTeacherCommands(): void {
    if (!this.scene || this.pendingTeacherCommands.size === 0) {
      return;
    }

    for (const command of [...this.pendingTeacherCommands]) {
      if (this.applyTeacherCommand(command)) {
        this.pendingTeacherCommands.delete(command);
      }
    }
  }

  private loadStudentMonitorScene(): void {
    if (this.state.role !== "student" || !this.state.socket.code || !this.state.selectedExperience) {
      return;
    }

    const mode = this.state.selectedExperience.modes.includes("vr") ? "vr" : this.state.mode;
    this.loadSelectedExperience(mode, false);
  }

  private loadTeacherSharedScene(): void {
    if (this.state.role !== "teacher" || !this.state.socket.code || !this.state.selectedExperience) {
      return;
    }

    if (this.loadedSceneKey) {
      return;
    }

    this.loadSelectedExperience(this.state.mode, false);
  }

  private loadSelectedExperience(mode: ExperienceMode, startAfterLoad: boolean): void {
    if (!this.scene || !this.state.selectedExperience) {
      return;
    }

    const sceneKey = `${this.state.selectedExperience.id}:${mode}`;
    const shouldAutoStart = startAfterLoad || mode === "fallback";
    this.state.mode = mode;
    if (this.loadedSceneKey === sceneKey) {
      if (shouldAutoStart || this.state.socket.commands["start-experience"]) {
        this.scene.startExperience();
      }
      return;
    }

    this.loadedSceneKey = sceneKey;
    void this.scene.loadExperience(this.state.selectedExperience, mode).then(() => {
      this.applySharedState();
      if (shouldAutoStart || this.state.socket.commands["start-experience"]) {
        this.scene?.startExperience();
      }
      this.flushPendingTeacherCommands();
    });
  }

  private enterXr(mode: Exclude<ExperienceMode, "fallback">): void {
    this.state.xrError = undefined;
    this.scene?.enterXr(mode).catch((error: unknown) => {
      this.state.xrError = error instanceof Error ? error.message : `Could not enter ${mode.toUpperCase()}.`;
      this.render();
    });
  }

  private returnToMenu(): void {
    this.scene?.exitXr();
    this.scene?.setRole(undefined);
    this.socket.disconnect();
    const singleExperience = this.experiences.length === 1 ? this.experiences[0] : undefined;
    this.state = {
      ...this.state,
      screen: singleExperience ? "role" : "select-experience",
      selectedExperience: singleExperience,
      role: undefined,
      mode: singleExperience ? getBestMode(this.state.capabilities, singleExperience.modes) : "fallback",
      joinCode: "",
      socket: this.socket.snapshot,
      localCalibrated: false,
      xrError: undefined,
      selectedPart: undefined,
      chromaPanelOpen: false,
      chromaPosition: null,
      chromaHeight: initialChromaMemory.height,
      chromaPlaybackRevision: 0,
      partMarkerPositions: {},
      partMarkerStates: {},
      videoPrepStates: initialVideoPrepMemory,
      modelTransformLocked: true
    };
    this.loadedSceneKey = undefined;
    this.videoPrepBootstrapSessionCode = undefined;
  }

  private selectExperience(experience: ExperienceConfig): void {
    this.state.selectedExperience = experience;
    this.state.mode = getBestMode(this.state.capabilities, experience.modes);
  }

  private updateNameFromInput(): void {
    const input = this.root.querySelector<HTMLInputElement>("#participant-name");
    this.state.name = this.normalizeParticipantName(input?.value ?? "");
  }

  private promptForParticipantName(): void {
    const nextName = window.prompt("Name", this.state.name || "");
    if (nextName === null) {
      return;
    }

    this.state.name = this.normalizeParticipantName(nextName);
    this.render();
  }

  private focusTextInput(input: HTMLInputElement): void {
    input.focus({ preventScroll: true });
    input.select?.();
  }

  private applyInputFocus(): void {
    const targetId =
      this.state.screen === "role"
        ? "#participant-name"
        : this.state.screen === "session" && this.state.role === "student" && !this.state.socket.code
          ? "#join-code"
          : undefined;
    if (!targetId) {
      return;
    }

    const input = this.root.querySelector<HTMLInputElement>(targetId);
    if (!input) {
      return;
    }

    if (!this.state.capabilities.touch) {
      requestAnimationFrame(() => {
        this.focusTextInput(input);
      });
    }
  }

  private appendJoinCodeCharacter(character: string): void {
    if (!SESSION_CODE_ALPHABET.includes(character) || this.state.joinCode.length >= 4) {
      return;
    }

    this.state.joinCode = `${this.state.joinCode}${character}`.slice(0, 4);
    this.render();
  }

  private appendNameCharacter(character: string): void {
    if (!character || this.state.name.length >= MAX_PARTICIPANT_NAME_LENGTH) {
      return;
    }

    const nextName = character === " "
      ? `${this.state.name} `
      : `${this.state.name}${character.toUpperCase()}`;
    this.state.name = this.normalizeParticipantName(nextName, true);
    this.render();
  }

  private normalizeParticipantName(value: string, preserveTrailingSpace = false): string {
    const compact = value
      .replace(/[^A-Za-z0-9 -]/g, "")
      .replace(/\s+/g, " ")
      .slice(0, MAX_PARTICIPANT_NAME_LENGTH);
    return preserveTrailingSpace ? compact : compact.trim();
  }

  private handleChromaSettingInput(input: HTMLInputElement): void {
    const key = input.dataset.chromaSetting as ChromaSettingKey | undefined;
    if (!key || !(key in DEFAULT_CHROMA_KEY_SETTINGS)) {
      return;
    }

    const selectedVideoPart = this.getSelectedVideoPart();
    if (selectedVideoPart) {
      const current = this.getVideoPrepState(selectedVideoPart);
      const settings = normalizeChromaKeySettings({
        ...current.settings,
        [key]: Number(input.value)
      });
      this.setVideoPrepState(selectedVideoPart, { ...current, settings });
      this.root.querySelector<HTMLOutputElement>(`[data-chroma-value="${key}"]`)?.replaceChildren(settings[key].toFixed(2));
      return;
    }

    this.state.chromaSettings = normalizeChromaKeySettings({
      ...this.state.chromaSettings,
      [key]: Number(input.value)
    });
    this.saveChromaMemory();
    const handledPartVideo = this.state.role === "teacher" && Boolean(this.state.selectedPart?.videoUrl)
      ? this.scene?.setSelectedPartVideoChromaSettings(this.state.chromaSettings)
      : false;
    if (!handledPartVideo) {
      this.scene?.setChromaSettings(this.state.chromaSettings);
    }
    this.root.querySelector<HTMLOutputElement>(`[data-chroma-value="${key}"]`)?.replaceChildren(this.state.chromaSettings[key].toFixed(2));
    if (!handledPartVideo && this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private handleObjectMarkerStateInput(select: HTMLSelectElement): void {
    const objectId = select.dataset.objectId as SceneObjectId | undefined;
    const state = select.value as ObjectMarkerState;
    if (objectId !== "model" && objectId !== "chroma") {
      return;
    }

    this.scene?.setObjectMarkerState(objectId, state);
    if (this.state.role === "teacher") {
      this.socket.setObjectMarkerState(objectId, state);
    }
  }

  private handlePartMarkerStateInput(select: HTMLSelectElement): void {
    const partId = select.dataset.partId;
    const state = normalizeObjectMarkerState(select.value);
    if (!partId) {
      return;
    }

    const part = this.getPartById(partId);
    if (part?.videoUrl && this.state.role === "teacher") {
      this.setVideoPrepState(part, {
        ...this.getVideoPrepState(part),
        markerState: state
      });
      this.render();
      return;
    }

    this.scene?.setPartMarkerState(partId, state);
    if (this.state.role === "teacher") {
      this.socket.setPartMarkerState(partId, state);
    }
  }

  private handleChromaScaleInput(input: HTMLInputElement): void {
    const selectedVideoPart = this.getSelectedVideoPart();
    if (selectedVideoPart) {
      const scale = normalizeChromaScale(Number(input.value));
      this.setVideoPrepState(selectedVideoPart, {
        ...this.getVideoPrepState(selectedVideoPart),
        scale
      });
      this.root.querySelector<HTMLOutputElement>('[data-chroma-value="scale"]')?.replaceChildren(scale.toFixed(2));
      return;
    }

    this.state.chromaScale = normalizeChromaScale(Number(input.value));
    this.saveChromaMemory();
    const handledPartVideo = this.state.role === "teacher" && Boolean(this.state.selectedPart?.videoUrl)
      ? this.scene?.setSelectedPartVideoScale(this.state.chromaScale)
      : false;
    if (!handledPartVideo) {
      this.scene?.setChromaBillboardScale(this.state.chromaScale);
    }
    this.root.querySelector<HTMLOutputElement>('[data-chroma-value="scale"]')?.replaceChildren(this.state.chromaScale.toFixed(2));
    if (!handledPartVideo && this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private handleChromaHeightInput(input: HTMLInputElement): void {
    const selectedVideoPart = this.getSelectedVideoPart();
    if (selectedVideoPart) {
      const current = this.getVideoPrepState(selectedVideoPart);
      const height = normalizeChromaHeight(Number(input.value));
      const position = current.position
        ? [current.position[0], height, current.position[2]] as Vector3Tuple
        : [selectedVideoPart.markerPosition[0], height, selectedVideoPart.markerPosition[2]] as Vector3Tuple;
      this.setVideoPrepState(selectedVideoPart, {
        ...current,
        position,
        height
      });
      this.root.querySelector<HTMLOutputElement>('[data-chroma-value="height"]')?.replaceChildren(height.toFixed(2));
      return;
    }

    this.state.chromaHeight = normalizeChromaHeight(Number(input.value));
    this.saveChromaMemory();
    const handledPartVideo = this.state.role === "teacher" && Boolean(this.state.selectedPart?.videoUrl)
      ? this.scene?.setSelectedPartVideoHeight(this.state.chromaHeight)
      : false;
    if (!handledPartVideo) {
      this.scene?.setChromaBillboardHeight(this.state.chromaHeight);
      this.state.chromaPosition = this.scene?.getChromaBillboardState(true).position ?? this.state.chromaPosition;
    }
    this.root.querySelector<HTMLOutputElement>('[data-chroma-value="height"]')?.replaceChildren(this.state.chromaHeight.toFixed(2));
    if (!handledPartVideo && this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private handleChromaPlaybackInput(select: HTMLSelectElement): void {
    const nextMode: ChromaPlaybackMode = select.value === "once" ? "once" : "loop";
    const selectedVideoPart = this.getSelectedVideoPart();
    if (selectedVideoPart) {
      const current = this.getVideoPrepState(selectedVideoPart);
      this.setVideoPrepState(selectedVideoPart, {
        ...current,
        playbackMode: nextMode,
        playbackRevision: nextMode !== current.playbackMode ? current.playbackRevision + 1 : current.playbackRevision
      });
      return;
    }

    if (nextMode !== this.state.chromaPlaybackMode) {
      this.state.chromaPlaybackRevision += 1;
    }
    this.state.chromaPlaybackMode = nextMode;
    this.saveChromaMemory();
    this.scene?.setChromaBillboardState(this.buildChromaBillboardState(true));
    if (!(this.state.role === "teacher" && this.state.selectedPart?.videoUrl) && this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private getSelectedVideoPart(): ExperiencePartConfig | undefined {
    return this.state.selectedPart?.videoUrl ? this.state.selectedPart : undefined;
  }

  private getPartById(partId: string): ExperiencePartConfig | undefined {
    return this.state.selectedExperience?.parts.find((part) => part.id === partId);
  }

  private getTeacherVideoPart(): ExperiencePartConfig | undefined {
    return this.state.selectedExperience?.parts.find((part) =>
      Boolean(part.videoUrl) && this.getPartVideoActivationMode(part) === "teacher"
    );
  }

  private getCurrentChromaPanelState(): VideoPrepState {
    const selectedVideoPart = this.getSelectedVideoPart();
    if (selectedVideoPart) {
      return this.getVideoPrepState(selectedVideoPart);
    }

    return normalizeVideoPrepState({
      settings: this.state.chromaSettings,
      position: this.state.chromaPosition,
      scale: this.state.chromaScale,
      height: this.state.chromaHeight,
      playbackMode: this.state.chromaPlaybackMode,
      playbackRevision: this.state.chromaPlaybackRevision,
      markerState: this.state.socket.objectMarkerStates.chroma
    });
  }

  private getVideoPrepState(part: ExperiencePartConfig): VideoPrepState {
    const current = this.state.videoPrepStates[part.id];
    const socketState = this.state.socket.videoPrepStates[part.id];
    const sessionState = this.state.socket.code
      ? socketState ?? (this.state.role === "teacher" ? current : undefined)
      : current;
    const base = normalizeVideoPrepState({
      ...this.createDefaultVideoPrepState(part),
      ...(sessionState ?? {})
    });
    return {
      ...base,
      settings: normalizeChromaKeySettings(base.settings),
      position: base.position ?? part.markerPosition,
      height: base.position?.[1] ?? base.height
    };
  }

  private createDefaultVideoPrepState(part: ExperiencePartConfig): VideoPrepState {
    const activationMode = this.getPartVideoActivationMode(part);
    return normalizeVideoPrepState({
      settings: { ...DEFAULT_CHROMA_KEY_SETTINGS },
      position: part.markerPosition,
      scale: 1,
      height: part.markerPosition[1],
      playbackMode: activationMode === "student" ? "once" : "loop",
      playbackRevision: 0,
      playbackPaused: false,
      markerState: this.state.socket.partMarkerStates[part.id] ?? "green"
    });
  }

  private setVideoPrepState(part: ExperiencePartConfig, nextState: VideoPrepState, sync = true): void {
    const normalizedState = normalizeVideoPrepState({
      ...nextState,
      position: nextState.position ?? part.markerPosition,
      height: nextState.position?.[1] ?? nextState.height
    });
    this.state.videoPrepStates = {
      ...this.state.videoPrepStates,
      [part.id]: normalizedState
    };
    this.saveVideoPrepMemory();
    this.scene?.setVideoPrepState(part.id, normalizedState);
    if (this.state.role === "teacher" && sync && this.state.socket.code) {
      this.socket.setVideoPrepState(part.id, normalizedState);
    }
  }

  private bootstrapTeacherVideoPrepState(): void {
    if (this.state.role !== "teacher" || !this.state.socket.code || !this.state.selectedExperience) {
      return;
    }
    if (this.videoPrepBootstrapSessionCode === this.state.socket.code) {
      return;
    }

    this.videoPrepBootstrapSessionCode = this.state.socket.code;
    for (const part of this.state.selectedExperience.parts) {
      if (!part.videoUrl || this.state.socket.videoPrepStates[part.id]) {
        continue;
      }

      const state = normalizeVideoPrepState({
        ...this.getVideoPrepState(part),
        markerState: this.state.socket.partMarkerStates[part.id] ?? "green",
        playbackPaused: false
      });
      this.state.videoPrepStates = {
        ...this.state.videoPrepStates,
        [part.id]: state
      };
      this.scene?.setVideoPrepState(part.id, state);
      this.socket.setVideoPrepState(part.id, state);
    }
  }

  private buildChromaBillboardState(visible = this.state.socket.chromaBillboard.visible): ChromaBillboardState {
    const sceneState = this.scene?.getChromaBillboardState(visible);
    const position = sceneState?.position ?? this.state.chromaPosition;
    return normalizeChromaBillboardState({
      visible,
      settings: this.state.chromaSettings,
      position,
      scale: this.state.chromaScale,
      height: this.state.chromaHeight,
      playbackMode: this.state.chromaPlaybackMode,
      playbackRevision: this.state.chromaPlaybackRevision
    });
  }

  private applyLocalChromaState(state: ChromaBillboardState): void {
    const chromaState = normalizeChromaBillboardState(state);
    this.state.chromaSettings = chromaState.settings;
    this.state.chromaPosition = chromaState.position;
    this.state.chromaScale = chromaState.scale;
    this.state.chromaHeight = chromaState.height;
    this.state.chromaPlaybackMode = chromaState.playbackMode;
    this.state.chromaPlaybackRevision = chromaState.playbackRevision;
    this.saveChromaMemory();
  }

  private getPartVideoActivationMode(part: ExperiencePartConfig): ExperienceVideoActivationMode {
    return part.videoActivationMode ?? "standard";
  }

  private saveChromaMemory(): void {
    savePersistentChromaMemory({
      settings: this.state.chromaSettings,
      scale: this.state.chromaScale,
      height: this.state.chromaHeight,
      playbackMode: this.state.chromaPlaybackMode
    });
  }

  private saveVideoPrepMemory(): void {
    savePersistentVideoPrepMemory(this.state.videoPrepStates);
  }

  private captureViewSuggestion(): void {
    const suggestion = this.scene?.getViewSuggestion();
    if (!suggestion) {
      this.state.spawnSuggestion = "Scene is not ready yet.";
      this.render();
      return;
    }

    this.state.spawnSuggestion = suggestion;
    void navigator.clipboard?.writeText(suggestion).catch(() => undefined);
    this.render();
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const entities: Record<string, string> = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return entities[character] ?? character;
    });
  }
}

function loadPersistentChromaMemory(): PersistentChromaMemory {
  if (typeof window === "undefined") {
    return createDefaultPersistentChromaMemory();
  }

  try {
    const raw = window.localStorage.getItem(CHROMA_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return createDefaultPersistentChromaMemory();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && "settings" in parsed) {
      const record = parsed as Partial<PersistentChromaMemory>;
      return {
        settings: normalizeChromaKeySettings(record.settings),
        scale: normalizeChromaScale(record.scale),
        height: normalizeChromaHeight(record.height),
        playbackMode: record.playbackMode === "once" ? "once" : "loop"
      };
    }

    return {
      ...createDefaultPersistentChromaMemory(),
      settings: normalizeChromaKeySettings(parsed)
    };
  } catch {
    return createDefaultPersistentChromaMemory();
  }
}

function savePersistentChromaMemory(memory: PersistentChromaMemory): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CHROMA_SETTINGS_STORAGE_KEY, JSON.stringify({
      settings: normalizeChromaKeySettings(memory.settings),
      scale: normalizeChromaScale(memory.scale),
      height: normalizeChromaHeight(memory.height),
      playbackMode: memory.playbackMode === "once" ? "once" : "loop"
    }));
  } catch {
    // Storage can be unavailable in private browsing or locked-down tablets.
  }
}

function loadPersistentVideoPrepMemory(): VideoPrepStates {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(VIDEO_PREP_SETTINGS_STORAGE_KEY);
    return raw ? normalizeVideoPrepStates(JSON.parse(raw) as unknown) : {};
  } catch {
    return {};
  }
}

function savePersistentVideoPrepMemory(states: VideoPrepStates): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(VIDEO_PREP_SETTINGS_STORAGE_KEY, JSON.stringify(normalizeVideoPrepStates(states)));
  } catch {
    // Storage can be unavailable in private browsing or locked-down tablets.
  }
}

function createDefaultPersistentChromaMemory(): PersistentChromaMemory {
  const defaultState = createDefaultChromaBillboardState();
  return {
    settings: defaultState.settings,
    scale: defaultState.scale,
    height: defaultState.height,
    playbackMode: defaultState.playbackMode
  };
}
