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
  type ChromaBillboardState,
  type ChromaKeySettings,
  type ChromaPlaybackMode,
  type ObjectMarkerState,
  type SceneObjectId,
  type Vector3Tuple,
  type ClientCommand
} from "../net/protocol";
import { ClassroomSocket, type ClassroomSocketState } from "../net/ClassroomSocket";
import { detectXrCapabilities, getBestMode, type XrCapabilities } from "../scene/capabilities";
import { ExperienceScene } from "../scene/ExperienceScene";
import type { ExperienceConfig, ExperienceMode, ExperiencePartConfig, TabletControlMode } from "../types/experience";

type Screen = "select-experience" | "role" | "session";
type Role = "teacher" | "student";
type ChromaSettingKey = keyof ChromaKeySettings;
const SESSION_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHROMA_SETTINGS_STORAGE_KEY = "iol-cessna-demo:chroma-key-settings:v1";
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
  selectedPart?: ExperiencePartConfig;
  chromaPanelOpen: boolean;
  chromaSettings: ChromaKeySettings;
  chromaPosition: Vector3Tuple | null;
  chromaScale: number;
  chromaHeight: number;
  chromaPlaybackMode: ChromaPlaybackMode;
  chromaPlaybackRevision: number;
}

const initialChromaMemory = loadPersistentChromaMemory();

export class ClassroomApp {
  private readonly socket = new ClassroomSocket();
  private scene?: ExperienceScene;
  private loadedSceneKey?: string;
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
    chromaPlaybackRevision: 0
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
      if (this.state.role === "teacher" && (this.state.socket.chromaBillboard.visible || this.state.socket.chromaBillboard.position)) {
        this.applyLocalChromaState(this.state.socket.chromaBillboard);
      }
      this.applySharedState();
      this.loadTeacherSharedScene();
      this.loadStudentMonitorScene();
      this.render();
    });
    this.socket.addEventListener("teacher-command", (event) => {
      this.applyTeacherCommand((event as CustomEvent<ClientCommand>).detail);
    });
    this.render();
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
          <div class="modal-body">
            <h2>Choose role</h2>
            <p>${this.state.selectedExperience?.title ?? ""}</p>
            <label>
              Display name
              <input id="participant-name" value="${this.escape(this.state.name)}" placeholder="Student 1" autocomplete="name" enterkeyhint="done" />
            </label>
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
              ${SESSION_CODE_ALPHABET.split("").map((character) => `
                <button class="secondary-button code-key" data-action="code-key" data-code-key="${character}">${character}</button>
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
            <span>${this.escape(participant.name)} <small>${participant.role}</small></span>
            <strong class="${participant.calibrated ? "ok" : "muted"}">${participant.calibrated ? "calibrated" : "waiting"}</strong>
          </li>
        `).join("") || "<li><span>No one connected yet</span></li>"}
      </ul>
    `;
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
        <input data-action="object-scale" type="range" min="0.25" max="2" step="0.05" value="${this.state.socket.objectScale}" />
      </label>
    `;
  }

  private renderObjectStateControls(): string {
    if (this.state.role !== "teacher") {
      return "";
    }

    return `
      <label class="object-state-control">
        Cessna
        ${this.renderObjectStateSelect("model")}
      </label>
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

    return `
      <aside class="part-panel">
        <button class="close-button" data-action="close-part">×</button>
        <h2>${part.label}</h2>
        <p>${part.explanation}</p>
        ${part.videoUrl ? `<video controls playsinline preload="auto" src="${part.videoUrl}"></video>` : ""}
      </aside>
    `;
  }

  private renderChromaPanel(): string {
    if (this.state.role !== "teacher" || !this.state.chromaPanelOpen) {
      return "";
    }

    return `
      <aside class="chroma-panel">
        <button class="close-button" data-action="close-chroma-panel">×</button>
        <h2>Green Screen Turbine Video</h2>
        <p>Adjust the key until the green disappears without cutting into the Cessna footage. Values are remembered on this device.</p>
        <label class="chroma-control">
          <span>
            Video size
            <output data-chroma-value="scale">${this.state.chromaScale.toFixed(2)}</output>
          </span>
          <input data-action="chroma-scale" type="range" min="${CHROMA_BILLBOARD_SCALE_LIMITS.min}" max="${CHROMA_BILLBOARD_SCALE_LIMITS.max}" step="0.05" value="${this.state.chromaScale}" />
        </label>
        <label class="chroma-control">
          <span>
            Height
            <output data-chroma-value="height">${this.state.chromaHeight.toFixed(2)}</output>
          </span>
          <input data-action="chroma-height" type="range" min="${CHROMA_BILLBOARD_HEIGHT_LIMITS.min}" max="${CHROMA_BILLBOARD_HEIGHT_LIMITS.max}" step="0.05" value="${this.state.chromaHeight}" />
        </label>
        <label class="chroma-control">
          <span>Playback</span>
          <select data-action="chroma-playback">
            <option value="loop" ${this.state.chromaPlaybackMode === "loop" ? "selected" : ""}>Loop continuously</option>
            <option value="once" ${this.state.chromaPlaybackMode === "once" ? "selected" : ""}>Play once beginning to end</option>
          </select>
        </label>
        ${this.renderChromaSlider("similarity", "Key threshold", 0.01)}
        ${this.renderChromaSlider("smoothness", "Edge softness", 0.01)}
        ${this.renderChromaSlider("spill", "Green spill cleanup", 0.01)}
        ${this.renderChromaSlider("opacity", "Opacity", 0.01)}
        ${this.renderChromaSlider("brightness", "Brightness", 0.01)}
        ${this.renderChromaSlider("contrast", "Contrast", 0.01)}
        <div class="chroma-panel-actions">
          <button class="secondary-button" data-action="restart-chroma">Play From Start</button>
          <button class="secondary-button" data-action="reset-chroma">Reset</button>
          <button class="secondary-button" data-action="hide-chroma">Hide Video</button>
        </div>
      </aside>
    `;
  }

  private renderChromaSlider(key: ChromaSettingKey, label: string, step: number): string {
    const limits = CHROMA_KEY_SETTING_LIMITS[key];
    const value = this.state.chromaSettings[key];
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
        this.socket.sendTeacherCommand(command);
      });
    });

    this.root.querySelectorAll<HTMLElement>("[data-action]").forEach((button) => {
      button.addEventListener("click", () => this.handleAction(button.dataset.action ?? ""));
    });

    this.root.querySelectorAll<HTMLElement>("[data-code-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const character = button.dataset.codeKey ?? "";
        this.appendJoinCodeCharacter(character);
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
        this.socket.setObjectScale(Number(input.value));
      });
    });

    this.root.querySelectorAll<HTMLSelectElement>('select[data-action="object-marker-state"]').forEach((select) => {
      select.addEventListener("change", () => this.handleObjectMarkerStateInput(select));
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
        this.socket.joinSession(this.state.joinCode, this.state.selectedExperience.id, this.state.role, this.state.name || "Student");
      }
      this.render();
      return;
    }

    if (action === "create-teacher-session") {
      if (this.state.selectedExperience && this.state.role === "teacher") {
        this.socket.createSession(this.state.selectedExperience.id, this.state.name || "Teacher");
        this.loadSelectedExperience(this.state.mode, true);
      }
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

    if (action === "start-and-enter-vr") {
      this.applyTeacherCommand("start-experience");
      this.socket.sendTeacherCommand("start-experience");
      this.enterXr("vr");
      return;
    }

    if (action === "monitor-vr") {
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
      this.state.chromaPanelOpen = false;
      this.scene?.hideChromaBillboard();
      if (this.state.role === "teacher" && this.state.socket.code) {
        this.socket.setChromaBillboard(this.buildChromaBillboardState(false));
      }
      this.render();
      return;
    }

    if (action === "reset-chroma") {
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
      this.state.chromaPlaybackRevision += 1;
      this.scene?.setChromaBillboardState(this.buildChromaBillboardState(true));
      this.state.chromaPosition = this.scene?.getChromaBillboardState(true).position ?? this.state.chromaPosition;
      if (this.state.role === "teacher" && this.state.socket.code) {
        this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
      }
      return;
    }
  }

  private ensureScene(container: HTMLElement): void {
    if (!this.scene) {
      this.scene = new ExperienceScene({
        container,
        onMarkerSelected: (part) => {
          this.state.selectedPart = part;
          this.render();
        },
        onChromaMarkerSelected: () => {
          if (this.state.role !== "teacher") {
            return;
          }
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
          const nextScale = Math.min(2, Math.max(0.25, this.state.socket.objectScale + direction * 0.1));
          this.socket.setObjectScale(nextScale);
        },
        onObjectScaleChange: (scale) => {
          if (this.state.role === "teacher") {
            this.socket.setObjectScale(scale);
          }
        },
        onModelPositionChange: (position) => {
          if (this.state.role === "teacher") {
            this.socket.setModelPosition(position);
          }
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
    } else if (!container.contains(this.scene.domElement)) {
      container.append(this.scene.domElement);
    }
    this.scene.refreshViewport();

  }

  private applyTeacherCommand(command: ClientCommand): void {
    if (command === "start-experience") {
      this.scene?.startExperience();
    }
    if (command === "shell-off") {
      this.scene?.setShellVisible(false);
    }
    if (command === "play-introduction") {
      this.scene?.playIntroduction(this.state.selectedExperience?.introVideos.default);
    }
  }

  private applySharedState(): void {
    this.scene?.setAnimationStep(this.state.socket.animationStep);
    this.scene?.setObjectScale(this.state.socket.objectScale);
    if (this.state.socket.modelPosition) {
      this.scene?.setModelPosition(this.state.socket.modelPosition);
    }
    this.scene?.setChromaBillboardState(this.state.socket.chromaBillboard);
    this.scene?.setObjectMarkerStates(this.state.socket.objectMarkerStates);
    this.scene?.setMarkersVisible(this.state.socket.commands["reveal-markers"]);
    if (this.state.socket.commands["start-experience"]) {
      this.scene?.startExperience();
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
      chromaPlaybackRevision: 0
    };
    this.loadedSceneKey = undefined;
  }

  private selectExperience(experience: ExperienceConfig): void {
    this.state.selectedExperience = experience;
    this.state.mode = getBestMode(this.state.capabilities, experience.modes);
  }

  private updateNameFromInput(): void {
    const input = this.root.querySelector<HTMLInputElement>("#participant-name");
    this.state.name = input?.value.trim() ?? "";
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
        input.focus({ preventScroll: true });
        input.select?.();
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

  private handleChromaSettingInput(input: HTMLInputElement): void {
    const key = input.dataset.chromaSetting as ChromaSettingKey | undefined;
    if (!key || !(key in DEFAULT_CHROMA_KEY_SETTINGS)) {
      return;
    }

    this.state.chromaSettings = normalizeChromaKeySettings({
      ...this.state.chromaSettings,
      [key]: Number(input.value)
    });
    this.saveChromaMemory();
    this.scene?.setChromaSettings(this.state.chromaSettings);
    this.root.querySelector<HTMLOutputElement>(`[data-chroma-value="${key}"]`)?.replaceChildren(this.state.chromaSettings[key].toFixed(2));
    if (this.state.role === "teacher" && this.state.socket.code) {
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

  private handleChromaScaleInput(input: HTMLInputElement): void {
    this.state.chromaScale = normalizeChromaScale(Number(input.value));
    this.saveChromaMemory();
    this.scene?.setChromaBillboardScale(this.state.chromaScale);
    this.root.querySelector<HTMLOutputElement>('[data-chroma-value="scale"]')?.replaceChildren(this.state.chromaScale.toFixed(2));
    if (this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private handleChromaHeightInput(input: HTMLInputElement): void {
    this.state.chromaHeight = normalizeChromaHeight(Number(input.value));
    this.saveChromaMemory();
    this.scene?.setChromaBillboardHeight(this.state.chromaHeight);
    this.state.chromaPosition = this.scene?.getChromaBillboardState(true).position ?? this.state.chromaPosition;
    this.root.querySelector<HTMLOutputElement>('[data-chroma-value="height"]')?.replaceChildren(this.state.chromaHeight.toFixed(2));
    if (this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
    }
  }

  private handleChromaPlaybackInput(select: HTMLSelectElement): void {
    const nextMode: ChromaPlaybackMode = select.value === "once" ? "once" : "loop";
    if (nextMode !== this.state.chromaPlaybackMode) {
      this.state.chromaPlaybackRevision += 1;
    }
    this.state.chromaPlaybackMode = nextMode;
    this.saveChromaMemory();
    this.scene?.setChromaBillboardState(this.buildChromaBillboardState(true));
    if (this.state.role === "teacher" && this.state.socket.code) {
      this.socket.setChromaBillboard(this.buildChromaBillboardState(true));
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

  private saveChromaMemory(): void {
    savePersistentChromaMemory({
      settings: this.state.chromaSettings,
      scale: this.state.chromaScale,
      height: this.state.chromaHeight,
      playbackMode: this.state.chromaPlaybackMode
    });
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

function createDefaultPersistentChromaMemory(): PersistentChromaMemory {
  const defaultState = createDefaultChromaBillboardState();
  return {
    settings: defaultState.settings,
    scale: defaultState.scale,
    height: defaultState.height,
    playbackMode: defaultState.playbackMode
  };
}
