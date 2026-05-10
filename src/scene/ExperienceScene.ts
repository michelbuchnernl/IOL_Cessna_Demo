import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";
import type {
  ExperienceConfig,
  ExperienceEnvironmentConfig,
  ExperienceMode,
  ExperienceModelConfig,
  ExperiencePartConfig,
  ExperienceVideoActivationMode,
  TabletControlMode
} from "../types/experience";
import {
  CHROMA_BILLBOARD_HEIGHT_LIMITS,
  CHROMA_BILLBOARD_SCALE_LIMITS,
  CHROMA_KEY_SETTING_LIMITS,
  createDefaultObjectMarkerStates,
  normalizeChromaBillboardState,
  DEFAULT_CHROMA_KEY_SETTINGS,
  normalizeChromaHeight,
  normalizeChromaKeySettings,
  normalizeChromaScale,
  normalizeObjectMarkerState,
  normalizeObjectMarkerStates,
  type ChromaBillboardState,
  type ChromaKeySettings,
  type ChromaPlaybackMode,
  type ClientCommand,
  type ObjectMarkerState,
  type ObjectMarkerStates,
  type Participant,
  type ParticipantPresence,
  type PresenceJoint,
  type Role,
  type SceneObjectId,
  type Vector3Tuple
} from "../net/protocol";

interface SceneOptions {
  container: HTMLElement;
  onMarkerSelected: (part: ExperiencePartConfig) => void;
  onChromaMarkerSelected: () => void;
  onTeacherCommand: (command: ClientCommand) => void;
  onAnimationStep: (direction: -1 | 1) => void;
  onScaleStep: (direction: -1 | 1) => void;
  onObjectScaleChange: (scale: number) => void;
  onModelPositionChange: (position: Vector3Tuple) => void;
  onPartMarkerPositionChange: (partId: string, position: Vector3Tuple) => void;
  onChromaTransformChange: (position: Vector3Tuple, scale: number) => void;
  onChromaBillboardStateChange: (state: ChromaBillboardState) => void;
  onObjectMarkerStateChange: (objectId: SceneObjectId, state: ObjectMarkerState) => void;
  onParticipantPresenceChange: (presence: ParticipantPresence) => void;
  onCalibrate: (origin: number[]) => void;
  onBackToMenu: () => void;
}

type XrButtonAction =
  | ClientCommand
  | "calibrate"
  | "back-menu"
  | "animation-previous-step"
  | "animation-next-step"
  | "scale-down"
  | "scale-up"
  | "chroma-scale-down"
  | "chroma-scale-up"
  | "chroma-height-down"
  | "chroma-height-up"
  | "chroma-restart"
  | "chroma-playback-toggle"
  | "chroma-panel-toggle"
  | "chroma-panel-close"
  | "chroma-hide"
  | "chroma-reset"
  | "chroma-similarity-down"
  | "chroma-similarity-up"
  | "chroma-smoothness-down"
  | "chroma-smoothness-up"
  | "chroma-spill-down"
  | "chroma-spill-up"
  | "chroma-opacity-down"
  | "chroma-opacity-up"
  | "chroma-brightness-down"
  | "chroma-brightness-up"
  | "chroma-contrast-down"
  | "chroma-contrast-up";

interface XrButtonDefinition {
  root: THREE.Group;
  hitTarget: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

interface ThumbstickAxes {
  x: number;
  y: number;
}

interface TeleportDebugState {
  enabled: boolean;
  rightControllerDetected: boolean;
  thumbstickX: number;
  thumbstickY: number;
  targetFound: boolean;
  targetValid: boolean;
  targetPoint?: THREE.Vector3;
  lastAttemptReason: string;
}

interface TeleportResolution {
  targetPoint?: THREE.Vector3;
  blockedPoint?: THREE.Vector3;
  blockedReason?: string;
}

interface RemoteParticipantVisual {
  root: THREE.Group;
  headAnchor: THREE.Group;
  headModel: THREE.Object3D;
  leftController: THREE.Mesh;
  rightController: THREE.Mesh;
  label: THREE.Mesh;
}

const uiButtonTextures: Partial<Record<XrButtonAction, string>> = {
  "back-menu": "/assets/ui-buttons/xr-classroom/home.png",
  calibrate: "/assets/ui-buttons/xr-classroom/calibrate-zero-spot.png",
  "start-experience": "/assets/ui-buttons/xr-classroom/start-lesson.png",
  "shell-off": "/assets/ui-buttons/xr-classroom/crosssection.png",
  "play-introduction": "/assets/ui-buttons/xr-classroom/play.png",
  "reveal-markers": "/assets/ui-buttons/xr-classroom/show-labels.png",
  "animation-previous-step": "/assets/ui-buttons/xr-classroom/previous-step.png",
  "animation-next-step": "/assets/ui-buttons/xr-classroom/next-step.png",
  "scale-down": "/assets/ui-buttons/xr-classroom/slider-scale.png",
  "scale-up": "/assets/ui-buttons/xr-classroom/slider-scale.png"
};

const uiButtonAspects: Partial<Record<XrButtonAction, number>> = {
  "back-menu": 147 / 176,
  calibrate: 125 / 197,
  "start-experience": 243 / 124,
  "shell-off": 125 / 197,
  "play-introduction": 125 / 197,
  "reveal-markers": 125 / 197,
  "animation-previous-step": 243 / 124,
  "animation-next-step": 243 / 124,
  "scale-down": 125 / 197,
  "scale-up": 125 / 197
};

const ANIMATION_STEPS = 7;
const XR_PANEL_DISTANCE = 2;
const RIGHT_CONTROLLER_B_BUTTON_INDEX = 5;
const THUMBSTICK_DEADZONE = 0.7;
const TURN_DEADZONE = 0.65;
const TELEPORT_ARC_SEGMENTS = 56;
const TELEPORT_ARC_STEP_SECONDS = 0.05;
const TELEPORT_ARC_SPEED = 8.2;
const TELEPORT_ARC_GRAVITY = -7.5;
const DESKTOP_MOVE_SPEED = 2.2;
const DESKTOP_RUN_MULTIPLIER = 1.8;
const DESKTOP_TURN_SPEED = 1.8;
const DESKTOP_LOOK_SENSITIVITY = 0.003;
const DESKTOP_MAX_PITCH = Math.PI / 2 - 0.08;
const TOUCH_LOOK_SENSITIVITY = 0.004;
const TOUCH_MOVE_SENSITIVITY = 0.0065;
const TOUCH_PINCH_SENSITIVITY = 0.01;
const TABLET_ORBIT_SENSITIVITY = 0.01;
const TABLET_PAN_SENSITIVITY = 0.0016;
const TABLET_MIN_ZOOM = 0.8;
const TABLET_MAX_ZOOM = 18;
const TABLET_DOUBLE_TAP_MS = 320;
const TABLET_TAP_MOVE_THRESHOLD = 14;
const TABLET_JOYSTICK_RADIUS = 64;
const TABLET_JOYSTICK_DEADZONE = 12;
const TABLET_JOYSTICK_EASING = 0.18;
const TABLET_MOVE_SPEED = 2.4;
const TABLET_LOOK_SENSITIVITY = 0.0032;
const PLAYER_COLLISION_RADIUS = 0.28;
const PLAYER_COLLISION_HEIGHTS = [0.45, 1.2];
const OBJECT_DISTANCE_SPEED = 1.8;
const OBJECT_SCALE_SPEED = 0.65;
const XR_SNAP_TURN_ANGLE = Math.PI / 6;
const OBJECT_ROTATION_SPEED = 1.35;
const CHROMA_XR_SCALE_STEP = 0.1;
const CHROMA_XR_HEIGHT_STEP = 0.1;
const XR_CHROMA_PANEL_DISTANCE = 1.65;
const XR_CHROMA_PANEL_WIDTH = 1.42;
const XR_CHROMA_PANEL_HEIGHT = 1.86;
const CHROMA_XR_SETTING_STEPS: Record<keyof ChromaKeySettings, number> = {
  similarity: 0.02,
  smoothness: 0.02,
  spill: 0.04,
  opacity: 0.04,
  brightness: 0.05,
  contrast: 0.05
};
const CHROMA_XR_SETTING_ACTIONS: Partial<Record<XrButtonAction, { key: keyof ChromaKeySettings; direction: -1 | 1 }>> = {
  "chroma-similarity-down": { key: "similarity", direction: -1 },
  "chroma-similarity-up": { key: "similarity", direction: 1 },
  "chroma-smoothness-down": { key: "smoothness", direction: -1 },
  "chroma-smoothness-up": { key: "smoothness", direction: 1 },
  "chroma-spill-down": { key: "spill", direction: -1 },
  "chroma-spill-up": { key: "spill", direction: 1 },
  "chroma-opacity-down": { key: "opacity", direction: -1 },
  "chroma-opacity-up": { key: "opacity", direction: 1 },
  "chroma-brightness-down": { key: "brightness", direction: -1 },
  "chroma-brightness-up": { key: "brightness", direction: 1 },
  "chroma-contrast-down": { key: "contrast", direction: -1 },
  "chroma-contrast-up": { key: "contrast", direction: 1 }
};
const DESKTOP_DISTANCE_DRAG_SPEED = 0.015;
const DESKTOP_WHEEL_DISTANCE_SPEED = 0.0025;
const DESKTOP_MIN_OBJECT_DISTANCE = 0.35;
const DESKTOP_MAX_OBJECT_DISTANCE = 14;
const CHROMA_DANCER_VIDEO_URL = "/assets/chroma/cessna-green-screen.mp4";
const PARTICIPANT_HEADSET_ASSET_URL = "/assets/avatars/vr-goggles/scene.gltf";
const PARTICIPANT_PRESENCE_SYNC_INTERVAL_MS = 100;
const KEYED_PERSON_TARGET_HEIGHT_METERS = 1.85;
const KEYED_VIDEO_SOURCE_WIDTH = 716;
const KEYED_VIDEO_SOURCE_HEIGHT = 1284;
const PORTRAIT_VIDEO_HEIGHT = KEYED_PERSON_TARGET_HEIGHT_METERS;
const PORTRAIT_VIDEO_WIDTH = PORTRAIT_VIDEO_HEIGHT * (KEYED_VIDEO_SOURCE_WIDTH / KEYED_VIDEO_SOURCE_HEIGHT);

type ObjectRotationAxis = "yaw" | "pitch" | "roll";
type DesktopGrabTarget = "model" | "chroma";
type DesktopGrabMode = "free" | "distance";
type TouchPoint = { x: number; y: number };

export class ExperienceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly dracoLoader = new DRACOLoader();
  private readonly loader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly markers = new Map<THREE.Object3D, ExperiencePartConfig>();
  private readonly xrButtons = new Map<THREE.Object3D, XrButtonAction>();
  private readonly xrChromaButtons = new Map<THREE.Object3D, XrButtonAction>();
  private readonly xrButtonMaterials = new Map<XrButtonAction, THREE.MeshBasicMaterial>();
  private readonly controllerRays = new Map<THREE.Object3D, THREE.Line>();
  private readonly controllerInputSources = new Map<THREE.Object3D, XRInputSource>();
  private readonly controllerModelFactory = new XRControllerModelFactory();
  private readonly controllerGrips = new Map<THREE.Object3D, THREE.Object3D>();
  private readonly teleportSurfaces: THREE.Object3D[] = [];
  private readonly teleportFloorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly clock = new THREE.Clock();
  private readonly classroomRoot = new THREE.Group();
  private readonly userRig = new THREE.Group();
  private readonly xrControlPanel = new THREE.Group();
  private readonly xrChromaPanel = new THREE.Group();
  private readonly debugCanvas = document.createElement("canvas");
  private readonly debugTexture: THREE.CanvasTexture;
  private readonly xrDebugPanel: THREE.Mesh;
  private readonly teleportArc: THREE.Line;
  private readonly teleportTarget = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.2, 40),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.98,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  private shellObjects: THREE.Object3D[] = [];
  private collisionObjects: THREE.Object3D[] = [];
  private navigationBounds?: THREE.Box3;
  private modelRoot?: THREE.Object3D;
  private propRoots: THREE.Object3D[] = [];
  private pendingModelPosition?: Vector3Tuple;
  private environmentRoot?: THREE.Object3D;
  private environmentSkyboxTexture?: THREE.Texture;
  private modelMixer?: THREE.AnimationMixer;
  private propMixers: THREE.AnimationMixer[] = [];
  private modelActions: THREE.AnimationAction[] = [];
  private animationStep = 0;
  private modelBaseScale = 1;
  private objectScale = 1;
  private introBillboard?: THREE.Mesh;
  private introVideo?: HTMLVideoElement;
  private introTexture?: THREE.VideoTexture;
  private introMaterial?: THREE.ShaderMaterial;
  private chromaMarker?: THREE.Mesh;
  private modelStateMarker?: THREE.Mesh;
  private readonly objectStateLabels = new Map<SceneObjectId, THREE.Mesh>();
  private readonly remoteParticipants = new Map<string, RemoteParticipantVisual>();
  private chromaBillboard?: THREE.Mesh;
  private chromaVideo?: HTMLVideoElement;
  private chromaTexture?: THREE.VideoTexture;
  private chromaMaterial?: THREE.ShaderMaterial;
  private chromaSettings: ChromaKeySettings = { ...DEFAULT_CHROMA_KEY_SETTINGS };
  private chromaPosition?: Vector3Tuple;
  private chromaScale = 1;
  private chromaHeight = 1.4;
  private chromaPlaybackMode: ChromaPlaybackMode = "loop";
  private chromaPlaybackRevision = 0;
  private xrChromaPanelSurface?: THREE.Mesh;
  private xrChromaPanelCanvas?: HTMLCanvasElement;
  private xrChromaPanelTexture?: THREE.CanvasTexture;
  private objectMarkerStates: ObjectMarkerStates = createDefaultObjectMarkerStates();
  private modelObjectLabel = "Object";
  private chromaBillboardRequestedVisible = false;
  private localOrigin = new THREE.Matrix4();
  private localParticipantId?: string;
  private participantHeadsetTemplate?: THREE.Object3D;
  private participantHeadsetTemplatePromise?: Promise<void>;
  private lastParticipantPresenceSyncAt = 0;
  private markersVisible = false;
  private experienceStarted = false;
  private suppressPointerSelectionUntil = 0;
  private mode: ExperienceMode = "fallback";
  private role?: Role;
  private xrPanelAnchored = false;
  private xrChromaPanelAnchored = false;
  private xrMenuVisible = false;
  private teleportTargetPoint?: THREE.Vector3;
  private teleportTargetValid = false;
  private readonly pressedKeys = new Set<string>();
  private desktopLookActive = false;
  private desktopGrabActive = false;
  private desktopGrabTarget?: DesktopGrabTarget;
  private desktopGrabMode: DesktopGrabMode = "free";
  private desktopGrabPointerId?: number;
  private readonly activeTouchPoints = new Map<number, TouchPoint>();
  private touchPrimaryPointerId?: number;
  private touchLookActive = false;
  private lastTouchCentroid?: TouchPoint;
  private lastTouchDistance?: number;
  private lastTapTimestamp = 0;
  private touchTapMoved = false;
  private touchTapStart?: TouchPoint;
  private tabletControlMode: TabletControlMode = "explore";
  private readonly tabletOrbitTarget = new THREE.Vector3();
  private tabletOrbitDistance = 2.8;
  private tabletLookPointerId?: number;
  private tabletJoystickPointerId?: number;
  private tabletLookLastPoint?: TouchPoint;
  private readonly tabletJoystickTarget = new THREE.Vector2();
  private readonly tabletJoystickCurrent = new THREE.Vector2();
  private desktopGrabDistance = 1.6;
  private desktopYaw = 0;
  private desktopPitch = 0;
  private grabbedModelDistance = 1.6;
  private lastScaleSync = 0;
  private lastPositionSync = 0;
  private lastChromaTransformSync = 0;
  private readonly markersByPartId = new Map<string, THREE.Mesh>();
  private desktopGrabMarkerPartId?: string;
  private grabbedMarkerController?: THREE.Object3D;
  private grabbedMarkerPartId?: string;
  private grabbedMarkerDistance = 1.6;
  private lastMarkerPositionSync = 0;
  private frameDelta = 0.016;
  private loadVersion = 0;
  private currentExperience?: ExperienceConfig;
  private rightBWasPressed = false;
  private rightThumbstickWasActive = false;
  private rightThumbstickTurnWasActive = false;
  private teleportAimConsumed = false;
  private lastStableTeleportTargetPoint?: THREE.Vector3;
  private lastStableTeleportTargetValid = false;
  private grabbedModelController?: THREE.Object3D;
  private grabbedChromaController?: THREE.Object3D;
  private grabbedModelDuringSelect = false;
  private grabbedChromaDistance = 1.6;
  private teleportPreviewController?: THREE.Object3D;
  private objectRotationActive = false;
  private objectRotationAxis: ObjectRotationAxis = "roll";
  private readonly teleportDebugState: TeleportDebugState = {
      enabled: true,
    rightControllerDetected: false,
    thumbstickX: 0,
    thumbstickY: 0,
    targetFound: false,
    targetValid: false,
    targetPoint: undefined,
    lastAttemptReason: "idle"
  };

  constructor(private readonly options: SceneOptions) {
    this.dracoLoader.setDecoderPath("/libs/draco/gltf/");
    this.loader.setDRACOLoader(this.dracoLoader);

    this.camera.position.set(0, 1.55, 2.2);
    this.camera.rotation.order = "YXZ";
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.16;
    this.renderer.xr.enabled = true;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    options.container.append(this.renderer.domElement);
    this.refreshViewport();
    this.debugCanvas.width = 512;
    this.debugCanvas.height = 256;
    this.debugTexture = new THREE.CanvasTexture(this.debugCanvas);
    this.xrDebugPanel = this.createDebugPanel();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4c5a6a, 0.15));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.15);
    keyLight.position.set(3, 5, 2);
    this.scene.add(keyLight);
    this.scene.add(this.classroomRoot);
    this.scene.add(this.userRig);
    this.userRig.add(this.camera);
    this.camera.add(this.xrDebugPanel);
    this.scene.add(this.xrControlPanel);
    this.scene.add(this.xrChromaPanel);
    this.xrControlPanel.position.set(0, 1.2, -1.6);
    this.xrControlPanel.visible = false;
    this.xrChromaPanel.visible = false;
    this.teleportArc = this.createTeleportArc();
    this.teleportTarget.rotation.x = -Math.PI / 2;
    this.teleportTarget.visible = false;
    this.teleportTarget.renderOrder = 10;
    this.scene.add(this.teleportArc, this.teleportTarget);
    this.updateTeleportDebugPanel();
    void this.loadParticipantHeadsetTemplate();


    const controllerOne = this.renderer.xr.getController(0);
    const controllerTwo = this.renderer.xr.getController(1);
    controllerOne.addEventListener("select", this.handleControllerSelect);
    controllerTwo.addEventListener("select", this.handleControllerSelect);
    controllerOne.addEventListener("selectstart", this.handleControllerSelectStart);
    controllerTwo.addEventListener("selectstart", this.handleControllerSelectStart);
    controllerOne.addEventListener("selectend", this.handleControllerSelectEnd);
    controllerTwo.addEventListener("selectend", this.handleControllerSelectEnd);
    controllerOne.addEventListener("squeezestart", this.handleControllerSqueezeStart);
    controllerTwo.addEventListener("squeezestart", this.handleControllerSqueezeStart);
    controllerOne.addEventListener("squeezeend", this.handleControllerSqueezeEnd);
    controllerTwo.addEventListener("squeezeend", this.handleControllerSqueezeEnd);
    controllerOne.addEventListener("connected", this.handleControllerConnected);
    controllerTwo.addEventListener("connected", this.handleControllerConnected);
    controllerOne.addEventListener("disconnected", this.handleControllerDisconnected);
    controllerTwo.addEventListener("disconnected", this.handleControllerDisconnected);
    const controllerOneRay = this.createControllerRay();
    const controllerTwoRay = this.createControllerRay();
    controllerOne.add(controllerOneRay);
    controllerTwo.add(controllerTwoRay);
    this.controllerRays.set(controllerOne, controllerOneRay);
    this.controllerRays.set(controllerTwo, controllerTwoRay);
    const controllerOneGrip = this.renderer.xr.getControllerGrip(0);
    const controllerTwoGrip = this.renderer.xr.getControllerGrip(1);
    controllerOneGrip.add(this.controllerModelFactory.createControllerModel(controllerOneGrip));
    controllerTwoGrip.add(this.controllerModelFactory.createControllerModel(controllerTwoGrip));
    this.controllerGrips.set(controllerOne, controllerOneGrip);
    this.controllerGrips.set(controllerTwo, controllerTwoGrip);
    this.userRig.add(controllerOne, controllerTwo);
    this.userRig.add(controllerOneGrip, controllerTwoGrip);

    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.addEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.addEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.addEventListener("pointerleave", this.handlePointerUp);
    this.renderer.domElement.addEventListener("wheel", this.handleWheel, { passive: false });
    this.renderer.domElement.addEventListener("contextmenu", this.preventContextMenu);
    this.renderer.domElement.addEventListener("auxclick", this.preventAuxClick);
    this.renderer.setAnimationLoop(this.render);
    this.buildXrControlPanel();
    this.buildXrChromaPanel();
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  refreshViewport(): void {
    this.resize();
    requestAnimationFrame(this.resize);
  }

  async loadExperience(experience: ExperienceConfig, mode: ExperienceMode): Promise<void> {
    const loadVersion = this.loadVersion + 1;
    this.loadVersion = loadVersion;
    this.mode = mode;
    this.currentExperience = experience;
    this.tabletControlMode = experience.tabletControlMode ?? "explore";
    this.modelObjectLabel = this.getModelObjectLabel(experience);
    this.clearExperience();
    this.scene.background = mode === "vr" ? new THREE.Color(0x182033) : null;
    this.loadSkybox(experience.environment?.skyboxUrl, loadVersion);

    if (experience.environment?.vrGarageUrl) {
      this.loader.load(
        experience.environment.vrGarageUrl,
        (gltf) => {
          if (loadVersion !== this.loadVersion) {
            return;
          }
          this.environmentRoot = gltf.scene;
          this.applyEnvironmentTransform(gltf.scene, experience.environment);
          this.applyEnvironmentBrightness(gltf.scene, experience.environment?.brightness ?? 1);
          this.scene.add(gltf.scene);
          this.addTeleportFloor(gltf.scene);
          this.registerCollisionObjects(gltf.scene);
        },
        undefined,
        (error) => {
          console.error(`Could not load environment ${experience.environment?.vrGarageUrl}`, error);
          if (loadVersion === this.loadVersion) {
            this.addFallbackGarage();
          }
        }
      );
    }

    await this.loadModel(experience, loadVersion);
    if (loadVersion !== this.loadVersion) {
      return;
    }
    await this.loadPropModels(experience.props ?? [], loadVersion);
    if (loadVersion !== this.loadVersion) {
      return;
    }
    this.resetTabletControlsForExperience();
    this.createMarkers(experience.parts);
    this.createModelStateMarker();
    this.createChromaMarker();
    this.applyObjectMarkerStates();
    this.preloadVideos(experience);
  }

  async enterXr(mode: Exclude<ExperienceMode, "fallback">): Promise<void> {
    if (!navigator.xr) {
      throw new Error("WebXR is not available in this browser.");
    }

    const sessionMode = mode === "ar" ? "immersive-ar" : "immersive-vr";
    const supported = await navigator.xr.isSessionSupported(sessionMode);
    if (!supported) {
      throw new Error(`${mode.toUpperCase()} is not supported on this device or browser.`);
    }

    this.renderer.xr.setReferenceSpaceType("local-floor");
    const sessionInit: XRSessionInit =
      mode === "ar"
        ? {
            requiredFeatures: ["local-floor"],
            optionalFeatures: ["dom-overlay", "hand-tracking"],
            domOverlay: { root: document.body }
          }
        : {
            optionalFeatures: ["local-floor", "hand-tracking"]
          };
    const session = await navigator.xr.requestSession(sessionMode, sessionInit);
    await this.renderer.xr.setSession(session);
    this.xrPanelAnchored = false;
    requestAnimationFrame(() => this.anchorXrPanelInFrontOfUser());
  }

  setRole(role?: Role): void {
    this.role = role;
    this.xrMenuVisible = Boolean(role);
    this.buildXrControlPanel();
    this.xrControlPanel.visible = this.xrMenuVisible;
    if (role !== "teacher") {
      this.hideXrChromaPanel();
    }
    this.xrPanelAnchored = false;
    this.updateChromaMarkerVisibility();
    this.updateModelStateMarkerVisibility();
    this.updateObjectStateLabels();
    this.applyObjectMarkerStates();
    this.updatePartMarkerVisibility();
  }

  setLocalParticipantId(participantId?: string): void {
    this.localParticipantId = participantId;
  }

  suppressPointerSelection(durationMs = 450): void {
    this.suppressPointerSelectionUntil = performance.now() + Math.max(0, durationMs);
  }

  setParticipants(participants: Participant[], localParticipantId?: string): void {
    if (localParticipantId) {
      this.localParticipantId = localParticipantId;
    }

    const activeIds = new Set<string>();
    for (const participant of participants) {
      if (participant.id === this.localParticipantId || !participant.presence || !participant.calibrated) {
        continue;
      }

      activeIds.add(participant.id);
      this.updateRemoteParticipant(participant);
    }

    for (const [participantId, visual] of this.remoteParticipants) {
      if (activeIds.has(participantId)) {
        continue;
      }

      this.classroomRoot.remove(visual.root);
      this.disposeRemoteParticipantVisual(visual);
      this.remoteParticipants.delete(participantId);
    }
  }

  calibrateOrigin(): number[] {
    if (this.renderer.xr.isPresenting) {
      const xrCamera = this.renderer.xr.getCamera();
      xrCamera.updateMatrixWorld();
      this.localOrigin.copy(xrCamera.matrixWorld);
    } else {
      this.localOrigin.identity();
    }
    this.localOrigin.decompose(this.classroomRoot.position, this.classroomRoot.quaternion, this.classroomRoot.scale);
    return Array.from(this.localOrigin.elements);
  }

  startExperience(): void {
    this.experienceStarted = true;
    if (this.modelRoot) {
      this.modelRoot.visible = true;
    }
    this.applyObjectMarkerStates();
    this.updatePartMarkerVisibility();
  }

  setAnimationStep(step: number): void {
    this.animationStep = Math.min(ANIMATION_STEPS, Math.max(0, Math.round(step)));
  }

  getAnimationStep(): number {
    return this.animationStep;
  }

  setObjectScale(scale: number): void {
    if (!this.modelRoot) {
      return;
    }

    const clamped = Math.min(2, Math.max(0.25, scale));
    this.objectScale = clamped;
    this.modelRoot.scale.setScalar(this.modelBaseScale * clamped);
    this.repositionChromaMarker();
    this.repositionModelStateMarker();
  }

  setModelPosition(position: Vector3Tuple): void {
    this.pendingModelPosition = position;
    if (!this.modelRoot) {
      return;
    }

    this.modelRoot.position.fromArray(position);
    this.pendingModelPosition = undefined;
    this.repositionChromaMarker();
    this.repositionModelStateMarker();
  }

  getViewSuggestion(): string {
    const number = (value: number) => Number(value.toFixed(3));
    const tuple = (vector: THREE.Vector3): Vector3Tuple => [
      number(vector.x),
      number(vector.y),
      number(vector.z)
    ];
    const cameraWorldPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const suggestion = this.isTabletInspectMode()
      ? {
          mode: "inspect",
          target: tuple(this.tabletOrbitTarget),
          distance: number(this.tabletOrbitDistance),
          yaw: number(this.desktopYaw),
          pitch: number(this.desktopPitch)
        }
      : {
          mode: "walk",
          position: tuple(this.userRig.position),
          cameraWorldPosition: tuple(cameraWorldPosition),
          yaw: number(this.desktopYaw),
          pitch: number(this.desktopPitch)
        };

    return `initialView: ${JSON.stringify(suggestion, null, 2)}`;
  }

  setShellVisible(visible: boolean): void {
    for (const object of this.shellObjects) {
      object.visible = visible;
    }
  }

  revealMarkers(): void {
    this.markersVisible = true;
    for (const marker of this.markers.keys()) {
      marker.visible = true;
    }
    this.updatePartMarkerVisibility();
  }

  setMarkersVisible(visible: boolean): void {
    this.markersVisible = visible;
    this.updatePartMarkerVisibility();
  }

  setObjectMarkerStates(states: ObjectMarkerStates): void {
    this.objectMarkerStates = normalizeObjectMarkerStates(states);
    this.applyObjectMarkerStates();
  }

  setPartMarkerPositions(positions: Record<string, Vector3Tuple>): void {
    for (const [partId, position] of Object.entries(positions)) {
      const marker = this.markersByPartId.get(partId);
      if (marker) {
        marker.position.fromArray(position);
      }
    }
  }

  setObjectMarkerState(objectId: SceneObjectId, state: ObjectMarkerState): void {
    this.objectMarkerStates = {
      ...this.objectMarkerStates,
      [objectId]: normalizeObjectMarkerState(state)
    };
    this.applyObjectMarkerStates();
  }

  exitXr(): void {
    const session = this.renderer.xr.getSession();
    if (session) {
      void session.end();
    }
  }

  playIntroduction(url?: string): void {
    if (!url) {
      return;
    }
    this.showChromaBillboard();
    this.restartChromaBillboard();
  }

  setChromaSettings(settings: ChromaKeySettings): void {
    this.chromaSettings = normalizeChromaKeySettings(settings);
    this.applyChromaSettingsToMaterial();
    this.updateXrChromaPanelTexture();
  }

  setChromaBillboardState(state: ChromaBillboardState): void {
    const chromaState = normalizeChromaBillboardState(state);
    const shouldRestart = chromaState.visible && chromaState.playbackRevision !== this.chromaPlaybackRevision;
    this.setChromaSettings(chromaState.settings);
    this.setChromaBillboardScale(chromaState.scale);
    this.setChromaPlaybackMode(chromaState.playbackMode);
    this.chromaPlaybackRevision = chromaState.playbackRevision;
    this.setChromaBillboardPosition(chromaState.position);
    this.setChromaBillboardHeight(chromaState.height);
    this.setChromaBillboardVisible(chromaState.visible);
    if (shouldRestart) {
      this.restartChromaBillboard();
    }
  }

  getChromaBillboardState(visible = Boolean(this.chromaBillboard)): ChromaBillboardState {
    return normalizeChromaBillboardState({
      visible,
      settings: this.chromaSettings,
      position: this.getCurrentChromaPosition(),
      scale: this.chromaScale,
      height: this.chromaHeight,
      playbackMode: this.chromaPlaybackMode,
      playbackRevision: this.chromaPlaybackRevision
    });
  }

  setChromaBillboardPosition(position: Vector3Tuple | null): void {
    if (!position) {
      this.chromaPosition = undefined;
      if (this.chromaBillboard) {
        this.chromaBillboard.position.copy(this.getChromaBillboardPosition());
        this.chromaPosition = this.chromaBillboard.position.toArray() as Vector3Tuple;
      }
      this.repositionChromaMarker();
      return;
    }

    this.chromaPosition = position;
    if (this.chromaBillboard) {
      this.chromaBillboard.position.fromArray(position);
    }
    this.repositionChromaMarker();
  }

  setChromaBillboardScale(scale: number): void {
    this.chromaScale = normalizeChromaScale(scale);
    if (this.chromaBillboard) {
      this.applyChromaBillboardScale();
    }
    this.repositionChromaMarker();
    this.updateXrChromaPanelTexture();
  }

  setChromaBillboardHeight(height: number): void {
    this.chromaHeight = normalizeChromaHeight(height);
    if (this.chromaBillboard) {
      this.chromaBillboard.position.y = this.chromaHeight;
      this.chromaPosition = this.chromaBillboard.position.toArray() as Vector3Tuple;
    }
    this.repositionChromaMarker();
    this.updateXrChromaPanelTexture();
  }

  setChromaPlaybackMode(mode: ChromaPlaybackMode): void {
    this.chromaPlaybackMode = mode === "once" ? "once" : "loop";
    if (this.chromaVideo) {
      this.chromaVideo.loop = this.chromaPlaybackMode === "loop";
    }
    this.updateXrChromaPanelTexture();
  }

  setChromaBillboardVisible(visible: boolean): void {
    this.chromaBillboardRequestedVisible = visible;
    if (visible) {
      this.showChromaBillboard();
      return;
    }
    this.hideChromaBillboard();
  }

  showChromaBillboard(): void {
    this.chromaBillboardRequestedVisible = true;
    if (this.chromaBillboard && this.chromaVideo) {
      this.applyObjectMarkerStates();
      this.applyChromaBillboardScale();
      this.chromaVideo.loop = this.chromaPlaybackMode === "loop";
      void this.playChromaVideo(false).catch(() => undefined);
      return;
    }

    const video = document.createElement("video");
    video.src = CHROMA_DANCER_VIDEO_URL;
    video.crossOrigin = "anonymous";
    video.loop = this.chromaPlaybackMode === "loop";
    video.muted = false;
    video.volume = 1;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "true");
    video.disablePictureInPicture = true;
    video.preload = "auto";

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = this.createChromaKeyMaterial(texture, this.chromaSettings);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PORTRAIT_VIDEO_WIDTH, PORTRAIT_VIDEO_HEIGHT), material);
    mesh.name = "Chroma dancer billboard";
    mesh.position.copy(this.getChromaBillboardPosition());
    mesh.position.y = this.chromaHeight;
    mesh.scale.set(this.chromaScale, this.chromaScale, this.chromaScale);
    mesh.renderOrder = 8;
    this.classroomRoot.add(mesh);

    this.chromaVideo = video;
    this.chromaTexture = texture;
    this.chromaMaterial = material;
    this.chromaBillboard = mesh;
    this.chromaPosition = mesh.position.toArray() as Vector3Tuple;
    this.repositionChromaMarker();
    this.updateChromaBillboardFacing();
    this.applyObjectMarkerStates();
    this.updateXrChromaPanelTexture();

    void this.playChromaVideo(this.chromaPlaybackMode === "once").catch(() => undefined);
  }

  restartChromaBillboard(): void {
    this.showChromaBillboard();
    void this.playChromaVideo(true).catch(() => undefined);
  }

  hideChromaBillboard(): void {
    this.chromaBillboardRequestedVisible = false;
    this.grabbedChromaController = undefined;
    if (this.desktopGrabTarget === "chroma") {
      this.desktopGrabActive = false;
      this.desktopGrabTarget = undefined;
      this.desktopGrabMode = "free";
    }
    if (this.chromaVideo) {
      this.chromaVideo.pause();
      this.chromaVideo.removeAttribute("src");
      this.chromaVideo.load();
      this.chromaVideo = undefined;
    }
    if (this.chromaBillboard) {
      this.chromaPosition = this.chromaBillboard.position.toArray() as Vector3Tuple;
      this.classroomRoot.remove(this.chromaBillboard);
      this.chromaBillboard.geometry.dispose();
      this.chromaBillboard = undefined;
      this.repositionChromaMarker();
    }
    this.chromaTexture?.dispose();
    this.chromaTexture = undefined;
    this.chromaMaterial?.dispose();
    this.chromaMaterial = undefined;
    this.updateXrChromaPanelTexture();
  }

  private showXrChromaPanel(): void {
    if (this.role !== "teacher") {
      return;
    }

    this.updateXrChromaPanelTexture();
    this.xrChromaPanel.visible = true;
    this.xrChromaPanelAnchored = false;
    this.anchorXrChromaPanelInFrontOfUser();
  }

  private hideXrChromaPanel(): void {
    this.xrChromaPanel.visible = false;
    this.xrChromaPanelAnchored = false;
  }

  dispose(): void {
    this.hideChromaBillboard();
    this.removeChromaMarker();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.renderer.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.renderer.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("pointerleave", this.handlePointerUp);
    this.renderer.domElement.removeEventListener("wheel", this.handleWheel);
    this.renderer.domElement.removeEventListener("contextmenu", this.preventContextMenu);
    this.renderer.domElement.removeEventListener("auxclick", this.preventAuxClick);
    this.renderer.xr.getController(0).removeEventListener("select", this.handleControllerSelect);
    this.renderer.xr.getController(1).removeEventListener("select", this.handleControllerSelect);
    this.renderer.xr.getController(0).removeEventListener("selectstart", this.handleControllerSelectStart);
    this.renderer.xr.getController(1).removeEventListener("selectstart", this.handleControllerSelectStart);
    this.renderer.xr.getController(0).removeEventListener("selectend", this.handleControllerSelectEnd);
    this.renderer.xr.getController(1).removeEventListener("selectend", this.handleControllerSelectEnd);
    this.renderer.xr.getController(0).removeEventListener("squeezestart", this.handleControllerSqueezeStart);
    this.renderer.xr.getController(1).removeEventListener("squeezestart", this.handleControllerSqueezeStart);
    this.renderer.xr.getController(0).removeEventListener("squeezeend", this.handleControllerSqueezeEnd);
    this.renderer.xr.getController(1).removeEventListener("squeezeend", this.handleControllerSqueezeEnd);
    this.renderer.xr.getController(0).removeEventListener("connected", this.handleControllerConnected);
    this.renderer.xr.getController(1).removeEventListener("connected", this.handleControllerConnected);
    this.renderer.xr.getController(0).removeEventListener("disconnected", this.handleControllerDisconnected);
    this.renderer.xr.getController(1).removeEventListener("disconnected", this.handleControllerDisconnected);
    this.renderer.setAnimationLoop(null);
    this.dracoLoader.dispose();
    this.renderer.dispose();
  }

  private buildXrControlPanel(): void {
    this.xrControlPanel.clear();
    this.xrButtons.clear();
    this.xrButtonMaterials.clear();

    const isTeacher = this.role === "teacher";
    const showCalibrate = this.mode !== "ar";
    const buttons: Array<[string, XrButtonAction, number, number, number]> = isTeacher
      ? [
          ...(showCalibrate ? [["Calibrate", "calibrate", -0.48, 0.42, 0.28] as [string, XrButtonAction, number, number, number]] : []),
          ["Start", "start-experience", 0, 0.42, 0.5],
          ["Menu", "back-menu", 0.48, 0.42, 0.28],
          ["Smaller", "scale-down", -0.48, -0.26, 0.28],
          ["Bigger", "scale-up", 0.48, -0.26, 0.28],
          ["Shell Off", "shell-off", -0.48, -0.58, 0.28],
          ["Markers", "reveal-markers", 0, -0.58, 0.28],
          ["Intro", "play-introduction", 0.48, -0.58, 0.28],
          ["MP4 Panel", "chroma-panel-toggle", -0.48, -0.9, 0.34],
          ["Video -", "chroma-scale-down", 0, -0.9, 0.28],
          ["Video +", "chroma-scale-up", 0.48, -0.9, 0.28],
          ["Lower", "chroma-height-down", -0.48, -1.22, 0.28],
          ["Higher", "chroma-height-up", 0, -1.22, 0.28],
          ["Loop/Once", "chroma-playback-toggle", 0.48, -1.22, 0.34]
        ]
      : [
          ...(showCalibrate ? [["Calibrate", "calibrate", -0.24, 0, 0.28] as [string, XrButtonAction, number, number, number]] : []),
          ["Menu", "back-menu", 0.24, 0, 0.28]
        ];

    for (const [label, action, x, y, width] of buttons) {
      const button = this.createXrButton(label, action, width);
      button.root.position.set(x, y, 0);
      this.xrControlPanel.add(button.root);
      this.xrButtons.set(button.hitTarget, action);
      this.xrButtonMaterials.set(action, button.material);
    }
  }

  private createXrButton(label: string, action: XrButtonAction, width: number): XrButtonDefinition {
    const root = new THREE.Group();
    const textureUrl = uiButtonTextures[action];
    const aspect = uiButtonAspects[action] ?? 4;
    const height = Math.min(0.34, width / aspect);
    const material = textureUrl
      ? new THREE.MeshBasicMaterial({
          map: this.textureLoader.load(textureUrl),
          transparent: true,
          alphaTest: 0.01,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      : this.createCanvasButtonMaterial(label);
    const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);

    const hitTarget = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.06, height + 0.04, 0.08),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.001,
        depthWrite: false
      })
    );
    hitTarget.position.z = 0.02;

    root.add(hitTarget, labelMesh);
    return { root, hitTarget, material };
  }

  private createCanvasButtonMaterial(label: string): THREE.MeshBasicMaterial {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not create XR button texture.");
    }

    context.fillStyle = "#38bdf8";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#061017";
    context.font = "700 44px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2);

    return new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      side: THREE.DoubleSide
    });
  }

  private buildXrChromaPanel(): void {
    this.xrChromaPanel.clear();
    this.xrChromaButtons.clear();

    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1344;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const surface = new THREE.Mesh(new THREE.PlaneGeometry(XR_CHROMA_PANEL_WIDTH, XR_CHROMA_PANEL_HEIGHT), material);
    surface.renderOrder = 20;
    this.xrChromaPanel.add(surface);

    this.xrChromaPanelSurface = surface;
    this.xrChromaPanelCanvas = canvas;
    this.xrChromaPanelTexture = texture;

    for (const row of this.getXrChromaControlRows()) {
      this.addXrChromaPanelHitTarget(row.downAction, 0.45, row.y, 0.12, 0.1);
      this.addXrChromaPanelHitTarget(row.upAction, 0.59, row.y, 0.12, 0.1);
    }
    this.addXrChromaPanelHitTarget("chroma-panel-close", 0.59, 0.79, 0.13, 0.11);
    this.addXrChromaPanelHitTarget("chroma-restart", -0.43, -0.84, 0.28, 0.12);
    this.addXrChromaPanelHitTarget("chroma-playback-toggle", -0.12, -0.84, 0.28, 0.12);
    this.addXrChromaPanelHitTarget("chroma-hide", 0.19, -0.84, 0.22, 0.12);
    this.addXrChromaPanelHitTarget("chroma-reset", 0.46, -0.84, 0.22, 0.12);
    this.updateXrChromaPanelTexture();
  }

  private addXrChromaPanelHitTarget(action: XrButtonAction, x: number, y: number, width: number, height: number): void {
    const hitTarget = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 0.08),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.001,
        depthWrite: false
      })
    );
    hitTarget.position.set(x, y, 0.04);
    this.xrChromaPanel.add(hitTarget);
    this.xrChromaButtons.set(hitTarget, action);
  }

  private getXrChromaControlRows(): Array<{
    label: string;
    value: number;
    min: number;
    max: number;
    y: number;
    downAction: XrButtonAction;
    upAction: XrButtonAction;
  }> {
    return [
      {
        label: "Video size",
        value: this.chromaScale,
        min: CHROMA_BILLBOARD_SCALE_LIMITS.min,
        max: CHROMA_BILLBOARD_SCALE_LIMITS.max,
        y: 0.52,
        downAction: "chroma-scale-down",
        upAction: "chroma-scale-up"
      },
      {
        label: "Height",
        value: this.chromaHeight,
        min: CHROMA_BILLBOARD_HEIGHT_LIMITS.min,
        max: CHROMA_BILLBOARD_HEIGHT_LIMITS.max,
        y: 0.35,
        downAction: "chroma-height-down",
        upAction: "chroma-height-up"
      },
      {
        label: "Key threshold",
        value: this.chromaSettings.similarity,
        min: CHROMA_KEY_SETTING_LIMITS.similarity.min,
        max: CHROMA_KEY_SETTING_LIMITS.similarity.max,
        y: 0.18,
        downAction: "chroma-similarity-down",
        upAction: "chroma-similarity-up"
      },
      {
        label: "Edge softness",
        value: this.chromaSettings.smoothness,
        min: CHROMA_KEY_SETTING_LIMITS.smoothness.min,
        max: CHROMA_KEY_SETTING_LIMITS.smoothness.max,
        y: 0.01,
        downAction: "chroma-smoothness-down",
        upAction: "chroma-smoothness-up"
      },
      {
        label: "Spill cleanup",
        value: this.chromaSettings.spill,
        min: CHROMA_KEY_SETTING_LIMITS.spill.min,
        max: CHROMA_KEY_SETTING_LIMITS.spill.max,
        y: -0.16,
        downAction: "chroma-spill-down",
        upAction: "chroma-spill-up"
      },
      {
        label: "Opacity",
        value: this.chromaSettings.opacity,
        min: CHROMA_KEY_SETTING_LIMITS.opacity.min,
        max: CHROMA_KEY_SETTING_LIMITS.opacity.max,
        y: -0.33,
        downAction: "chroma-opacity-down",
        upAction: "chroma-opacity-up"
      },
      {
        label: "Brightness",
        value: this.chromaSettings.brightness,
        min: CHROMA_KEY_SETTING_LIMITS.brightness.min,
        max: CHROMA_KEY_SETTING_LIMITS.brightness.max,
        y: -0.5,
        downAction: "chroma-brightness-down",
        upAction: "chroma-brightness-up"
      },
      {
        label: "Contrast",
        value: this.chromaSettings.contrast,
        min: CHROMA_KEY_SETTING_LIMITS.contrast.min,
        max: CHROMA_KEY_SETTING_LIMITS.contrast.max,
        y: -0.67,
        downAction: "chroma-contrast-down",
        upAction: "chroma-contrast-up"
      }
    ];
  }

  private updateXrChromaPanelTexture(): void {
    const canvas = this.xrChromaPanelCanvas;
    const texture = this.xrChromaPanelTexture;
    if (!canvas || !texture) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const toX = (x: number) => (0.5 + x / XR_CHROMA_PANEL_WIDTH) * canvas.width;
    const toY = (y: number) => (0.5 - y / XR_CHROMA_PANEL_HEIGHT) * canvas.height;
    const toW = (width: number) => width / XR_CHROMA_PANEL_WIDTH * canvas.width;
    const toH = (height: number) => height / XR_CHROMA_PANEL_HEIGHT * canvas.height;

    context.clearRect(0, 0, canvas.width, canvas.height);
    this.fillRoundRect(context, 18, 18, canvas.width - 36, canvas.height - 36, 34, "rgba(6, 31, 24, 0.96)");
    context.strokeStyle = "rgba(134, 239, 172, 0.42)";
    context.lineWidth = 3;
    this.strokeRoundRect(context, 18, 18, canvas.width - 36, canvas.height - 36, 34);

    context.textBaseline = "middle";
    context.textAlign = "left";
    context.fillStyle = "#f0fdf4";
    context.font = "700 48px Arial";
    context.fillText("MP4 Controls", toX(-0.57), toY(0.79));
    context.fillStyle = "#bbf7d0";
    context.font = "600 28px Arial";
    context.fillText("Green screen key", toX(-0.57), toY(0.69));
    this.drawXrPanelButton(context, "X", 0.59, 0.79, 0.13, 0.11, "#334155", "#e2e8f0");

    for (const row of this.getXrChromaControlRows()) {
      const normalized = Math.min(1, Math.max(0, (row.value - row.min) / (row.max - row.min || 1)));
      context.fillStyle = "#f0fdf4";
      context.font = "700 30px Arial";
      context.textAlign = "left";
      context.fillText(row.label, toX(-0.57), toY(row.y - 0.01));
      context.fillStyle = "#86efac";
      context.font = "700 28px Arial";
      context.textAlign = "right";
      context.fillText(row.value.toFixed(2), toX(0.35), toY(row.y - 0.01));

      const trackX = toX(-0.2);
      const trackY = toY(row.y + 0.055);
      const trackWidth = toW(0.54);
      const trackHeight = toH(0.028);
      this.fillRoundRect(context, trackX, trackY, trackWidth, trackHeight, 12, "rgba(15, 23, 42, 0.86)");
      this.fillRoundRect(context, trackX, trackY, trackWidth * normalized, trackHeight, 12, "#22c55e");
      this.drawXrPanelButton(context, "-", 0.45, row.y, 0.12, 0.1, "#14532d", "#dcfce7");
      this.drawXrPanelButton(context, "+", 0.59, row.y, 0.12, 0.1, "#14532d", "#dcfce7");
    }

    this.drawXrPanelButton(context, "Restart", -0.43, -0.84, 0.28, 0.12, "#1f2937", "#f8fafc");
    this.drawXrPanelButton(context, this.chromaPlaybackMode === "loop" ? "Loop" : "Once", -0.12, -0.84, 0.28, 0.12, "#1f2937", "#f8fafc");
    this.drawXrPanelButton(context, "Hide", 0.19, -0.84, 0.22, 0.12, "#1f2937", "#f8fafc");
    this.drawXrPanelButton(context, "Reset", 0.46, -0.84, 0.22, 0.12, "#1f2937", "#f8fafc");

    texture.needsUpdate = true;
  }

  private drawXrPanelButton(
    context: CanvasRenderingContext2D,
    label: string,
    centerX: number,
    centerY: number,
    width: number,
    height: number,
    fill: string,
    text: string
  ): void {
    const x = (0.5 + (centerX - width / 2) / XR_CHROMA_PANEL_WIDTH) * context.canvas.width;
    const y = (0.5 - (centerY + height / 2) / XR_CHROMA_PANEL_HEIGHT) * context.canvas.height;
    const w = width / XR_CHROMA_PANEL_WIDTH * context.canvas.width;
    const h = height / XR_CHROMA_PANEL_HEIGHT * context.canvas.height;
    this.fillRoundRect(context, x, y, w, h, 14, fill);
    context.strokeStyle = "rgba(134, 239, 172, 0.32)";
    context.lineWidth = 2;
    this.strokeRoundRect(context, x, y, w, h, 14);
    context.fillStyle = text;
    context.font = label.length > 5 ? "700 25px Arial" : "800 34px Arial";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, x + w / 2, y + h / 2);
  }

  private fillRoundRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fill: string
  ): void {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fillStyle = fill;
    context.fill();
  }

  private strokeRoundRect(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.stroke();
  }

  private createControllerRay(): THREE.Line {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -5)
    ]);
    const material = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
    return new THREE.Line(geometry, material);
  }

  private createTeleportArc(): THREE.Line {
    const points = Array.from({ length: TELEPORT_ARC_SEGMENTS }, () => new THREE.Vector3());
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    return line;
  }

  private createDebugPanel(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({
      map: this.debugTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.36), material);
    panel.position.set(0, 0.14, -0.85);
    panel.visible = false;
    return panel;
  }

  private updateTeleportDebugPanel(): void {
    this.xrDebugPanel.visible = false;
    const context = this.debugCanvas.getContext("2d");
    if (!context) {
      return;
    }

    context.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
    context.fillStyle = "rgba(6, 16, 23, 0.82)";
    context.fillRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
    context.strokeStyle = "rgba(56, 189, 248, 0.95)";
    context.lineWidth = 4;
    context.strokeRect(2, 2, this.debugCanvas.width - 4, this.debugCanvas.height - 4);

    context.fillStyle = "#e2e8f0";
    context.font = "700 28px Arial";
    context.fillText("Teleport Debug", 20, 36);

    context.font = "22px Arial";
    const lines = [
      `enabled: ${this.canUseTeleport()}`,
      `right controller: ${this.teleportDebugState.rightControllerDetected ? "yes" : "no"}`,
      `thumbstick: ${this.teleportDebugState.thumbstickX.toFixed(2)}, ${this.teleportDebugState.thumbstickY.toFixed(2)}`,
      `target found: ${this.teleportDebugState.targetFound ? "yes" : "no"}`,
      `target valid: ${this.teleportDebugState.targetValid ? "yes" : "no"}`,
      `target: ${this.formatVector(this.teleportDebugState.targetPoint)}`,
      `last: ${this.teleportDebugState.lastAttemptReason}`
    ];

    lines.forEach((line, index) => {
      context.fillText(line, 20, 74 + index * 24);
    });

    this.debugTexture.needsUpdate = true;
  }

  private formatVector(point?: THREE.Vector3): string {
    if (!point) {
      return "-";
    }

    return `${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)}`;
  }

  private async loadModel(experience: ExperienceConfig, loadVersion: number): Promise<void> {
    return new Promise((resolve) => {
      this.loader.load(
        experience.model.url,
        (gltf) => {
          if (loadVersion !== this.loadVersion) {
            resolve();
            return;
          }
          const root = gltf.scene;
          root.position.fromArray(experience.model.position);
          root.rotation.set(...experience.model.rotation);
          root.scale.setScalar(experience.model.scale);
          this.modelBaseScale = experience.model.fitToDisplaySize
            ? this.fitModelToDisplaySize(root, experience.model.scale, experience.model.fitToDisplaySize)
            : experience.model.scale;
          root.visible = true;
          this.modelRoot = root;
          this.applyPendingModelPosition();
          this.modelMixer = undefined;
          this.modelActions = [];
          this.animationStep = 0;
          if (gltf.animations.length > 0) {
            this.modelMixer = new THREE.AnimationMixer(root);
            const sortedClips = [...gltf.animations].sort((first, second) => first.name.localeCompare(second.name));
            for (const clip of sortedClips) {
              const action = this.modelMixer.clipAction(clip);
              action.reset();
              action.enabled = true;
              action.setLoop(THREE.LoopRepeat, Infinity);
              action.clampWhenFinished = false;
              action.timeScale = 1;
              action.weight = 1;
              action.play();
              this.modelActions.push(action);
            }
            this.modelMixer.update(0);
          }
          this.shellObjects = [];
          const shellNames = new Set(experience.model.shellObjectNames ?? []);
          root.traverse((object) => {
            if (shellNames.has(object.name)) {
              this.shellObjects.push(object);
            }
          });
          this.classroomRoot.add(root);
          this.registerCollisionObjects(root);
          resolve();
        },
        undefined,
        () => {
          if (loadVersion !== this.loadVersion) {
            resolve();
            return;
          }
          this.addPlaceholderModel(experience);
          resolve();
        }
      );
    });
  }

  private async loadPropModels(props: ExperienceModelConfig[], loadVersion: number): Promise<void> {
    await Promise.all(props.map((prop) => this.loadPropModel(prop, loadVersion)));
  }

  private async loadPropModel(prop: ExperienceModelConfig, loadVersion: number): Promise<void> {
    return new Promise((resolve) => {
      this.loader.load(
        prop.url,
        (gltf) => {
          if (loadVersion !== this.loadVersion) {
            resolve();
            return;
          }

          const root = gltf.scene;
          root.position.fromArray(prop.position);
          root.rotation.set(...prop.rotation);
          root.scale.setScalar(prop.scale);
          if (prop.fitToDisplaySize) {
            this.fitModelToDisplaySize(root, prop.scale, prop.fitToDisplaySize);
          }
          root.visible = true;
          this.propRoots.push(root);
          this.classroomRoot.add(root);

          if (gltf.animations.length > 0) {
            const mixer = new THREE.AnimationMixer(root);
            for (const clip of gltf.animations) {
              const action = mixer.clipAction(clip);
              action.reset();
              action.setLoop(THREE.LoopRepeat, Infinity);
              action.play();
            }
            this.propMixers.push(mixer);
          }

          resolve();
        },
        undefined,
        (error) => {
          console.error(`Could not load prop model ${prop.url}`, error);
          resolve();
        }
      );
    });
  }

  private addPlaceholderModel(experience: ExperienceConfig): void {
    const group = new THREE.Group();
    group.position.fromArray(experience.model.position);
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.45, 1),
      new THREE.MeshStandardMaterial({ color: 0x1f8a70, roughness: 0.55 })
    );
    base.position.y = 0.45;
    const shell = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.5, 0.9),
      new THREE.MeshStandardMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.86 })
    );
    shell.name = "Shell";
    shell.position.y = 0.92;
    group.add(base, shell);
    group.visible = true;
    this.modelRoot = group;
    this.applyPendingModelPosition();
    this.shellObjects = [shell];
    this.classroomRoot.add(group);
  }

  private loadSkybox(url: string | undefined, loadVersion: number): void {
    if (!url) {
      return;
    }

    this.textureLoader.load(
      url,
      (texture) => {
        if (loadVersion !== this.loadVersion) {
          texture.dispose();
          return;
        }

        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        this.environmentSkyboxTexture?.dispose();
        this.environmentSkyboxTexture = texture;
        this.scene.background = texture;
      },
      undefined,
      (error) => {
        console.error(`Could not load skybox ${url}`, error);
      }
    );
  }

  private createMarkers(parts: ExperiencePartConfig[]): void {
    for (const part of parts) {
      const activationMode = this.getPartVideoActivationMode(part);
      const markerMaterial = activationMode === "student"
        ? new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0c4a6e })
        : new THREE.MeshStandardMaterial({ color: 0xffc857, emissive: 0x7a4b00 });
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 24, 24),
        markerMaterial
      );
      marker.position.fromArray(part.markerPosition);
      marker.visible = false;
      this.classroomRoot.add(marker);
      this.markers.set(marker, part);
      this.markersByPartId.set(part.id, marker);
    }
    this.updatePartMarkerVisibility();
  }

  private createModelStateMarker(): void {
    this.removeModelStateMarker();
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: this.getObjectMarkerColor("model"),
        emissive: this.getObjectMarkerEmissive("model"),
        roughness: 0.28,
        metalness: 0.08
      })
    );
    marker.name = "Teacher object marker: model";
    marker.position.copy(this.getModelStateMarkerPosition());
    marker.visible = this.role === "teacher";
    this.classroomRoot.add(marker);
    this.modelStateMarker = marker;
  }

  private removeModelStateMarker(): void {
    if (!this.modelStateMarker) {
      return;
    }

    this.classroomRoot.remove(this.modelStateMarker);
    this.modelStateMarker.geometry.dispose();
    const material = this.modelStateMarker.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material.dispose();
    }
    this.modelStateMarker = undefined;
  }

  private createChromaMarker(): void {
    this.removeChromaMarker();
    const marker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.14, 0),
      new THREE.MeshStandardMaterial({
        color: this.getObjectMarkerColor("chroma"),
        emissive: this.getObjectMarkerEmissive("chroma"),
        roughness: 0.28,
        metalness: 0.08
      })
    );
    marker.name = "Teacher chroma dancer marker";
    marker.position.copy(this.getChromaMarkerPosition());
    marker.visible = this.role === "teacher";
    this.classroomRoot.add(marker);
    this.chromaMarker = marker;
  }

  private removeChromaMarker(): void {
    if (!this.chromaMarker) {
      return;
    }

    this.classroomRoot.remove(this.chromaMarker);
    this.chromaMarker.geometry.dispose();
    const material = this.chromaMarker.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material.dispose();
    }
    this.chromaMarker = undefined;
  }

  private updateChromaMarkerVisibility(): void {
    if (this.chromaMarker) {
      this.chromaMarker.visible = this.role === "teacher";
    }
  }

  private updateModelStateMarkerVisibility(): void {
    if (this.modelStateMarker) {
      this.modelStateMarker.visible = this.role === "teacher";
    }
  }

  private repositionChromaMarker(): void {
    if (this.chromaMarker) {
      this.chromaMarker.position.copy(this.getChromaMarkerPosition());
    }
    this.updateObjectStateLabels();
  }

  private repositionModelStateMarker(): void {
    if (this.modelStateMarker) {
      this.modelStateMarker.position.copy(this.getModelStateMarkerPosition());
    }
    this.updateObjectStateLabels();
  }

  private getModelStateMarkerPosition(): THREE.Vector3 {
    if (!this.modelRoot) {
      return new THREE.Vector3(-0.9, 1.35, -1.2);
    }

    this.modelRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.modelRoot);
    if (bounds.isEmpty()) {
      return new THREE.Vector3(-0.9, 1.35, -1.2);
    }

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const worldPosition = new THREE.Vector3(
      bounds.min.x - Math.max(0.35, size.x * 0.08),
      Math.max(bounds.min.y + 1.1, Math.min(bounds.max.y + 0.35, center.y + size.y * 0.35)),
      center.z
    );
    return this.classroomRoot.worldToLocal(worldPosition);
  }

  private getChromaMarkerPosition(): THREE.Vector3 {
    const source = this.chromaBillboard?.position ?? (this.chromaPosition ? new THREE.Vector3().fromArray(this.chromaPosition) : undefined);
    if (source) {
      return source.clone().add(new THREE.Vector3(0, Math.max(0.25, 0.18 * this.chromaScale), 0));
    }

    return new THREE.Vector3(1.1, this.chromaHeight + 0.25, -1.4);
  }

  private getChromaBillboardPosition(): THREE.Vector3 {
    if (this.chromaPosition) {
      return new THREE.Vector3().fromArray(this.chromaPosition);
    }

    if (this.chromaMarker) {
      return this.chromaMarker.position.clone();
    }

    const cameraWorldPosition = new THREE.Vector3();
    const cameraWorldDirection = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(cameraWorldPosition);
    this.camera.getWorldDirection(cameraWorldDirection);
    cameraWorldDirection.y = 0;
    if (cameraWorldDirection.lengthSq() < 0.001) {
      cameraWorldDirection.set(0, 0, -1);
    }
    cameraWorldDirection.normalize();
    const worldPosition = cameraWorldPosition.addScaledVector(cameraWorldDirection, 2.2);
    worldPosition.y = Math.max(1.25, cameraWorldPosition.y);
    return this.classroomRoot.worldToLocal(worldPosition);
  }

  private applyObjectMarkerStates(): void {
    this.applyModelObjectState();
    this.applyChromaObjectState();
    this.updateObjectStateMarkerMaterials();
    this.updateObjectStateLabels();
  }

  private applyModelObjectState(): void {
    if (!this.modelRoot) {
      return;
    }

    const state = this.objectMarkerStates.model;
    this.modelRoot.visible = state === "green" || (state === "orange" && this.role === "teacher");
  }

  private applyChromaObjectState(): void {
    if (!this.chromaBillboard) {
      return;
    }

    const state = this.objectMarkerStates.chroma;
    this.chromaBillboard.visible =
      this.chromaBillboardRequestedVisible &&
      (state === "green" || (state === "orange" && this.role === "teacher"));
    if (!this.chromaBillboard.visible && this.chromaVideo && !this.chromaVideo.paused) {
      this.chromaVideo.pause();
    }
  }

  private updateObjectStateMarkerMaterials(): void {
    this.updateObjectStateMarkerMaterial(this.modelStateMarker, "model");
    this.updateObjectStateMarkerMaterial(this.chromaMarker, "chroma");
  }

  private updateObjectStateMarkerMaterial(marker: THREE.Mesh | undefined, objectId: SceneObjectId): void {
    if (!marker || !(marker.material instanceof THREE.MeshStandardMaterial)) {
      return;
    }

    marker.material.color.setHex(this.getObjectMarkerColor(objectId));
    marker.material.emissive.setHex(this.getObjectMarkerEmissive(objectId));
  }

  private updateObjectStateLabels(): void {
    this.updateObjectStateLabel("model", this.modelObjectLabel, this.modelStateMarker?.position);
    this.updateObjectStateLabel("chroma", "Green-screen video", this.chromaMarker?.position);
  }

  private updateObjectStateLabel(objectId: SceneObjectId, label: string, position?: THREE.Vector3): void {
    const existing = this.objectStateLabels.get(objectId);
    const shouldShow = this.role === "teacher" && this.objectMarkerStates[objectId] === "red" && Boolean(position);
    if (!shouldShow) {
      if (existing) {
        this.classroomRoot.remove(existing);
        this.disposeSprite(existing);
        this.objectStateLabels.delete(objectId);
      }
      return;
    }

    const sprite = existing ?? this.createObjectStateLabel(label);
    if (!existing) {
      this.classroomRoot.add(sprite);
      this.objectStateLabels.set(objectId, sprite);
    }
    sprite.position.copy(position as THREE.Vector3).add(new THREE.Vector3(0, 0.24, 0));
    this.updateObjectStateLabelFacing(sprite);
  }

  private createObjectStateLabel(text: string): THREE.Mesh {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(15, 23, 42, 0.88)";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "rgba(248, 113, 113, 0.95)";
      context.lineWidth = 8;
      context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
      context.fillStyle = "#fecaca";
      context.font = "700 42px sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text.slice(0, 28), canvas.width / 2, canvas.height / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.2), material);
    mesh.renderOrder = 20;
    return mesh;
  }

  private removeObjectStateLabels(): void {
    for (const sprite of this.objectStateLabels.values()) {
      this.classroomRoot.remove(sprite);
      this.disposeSprite(sprite);
    }
    this.objectStateLabels.clear();
  }

  private disposeSprite(sprite: THREE.Mesh): void {
    sprite.geometry.dispose();
    const material = sprite.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }

  private updateObjectStateLabelsFacing(): void {
    for (const label of this.objectStateLabels.values()) {
      this.updateObjectStateLabelFacing(label);
    }
  }

  private updatePartMarkerVisibility(): void {
    for (const [marker, part] of this.markers) {
      marker.visible = this.shouldShowPartMarker(part);
    }
  }

  private shouldShowPartMarker(part: ExperiencePartConfig): boolean {
    const activationMode = this.getPartVideoActivationMode(part);
    if (activationMode === "student") {
      return this.experienceStarted && this.role === "student";
    }
    if (activationMode === "teacher") {
      return this.experienceStarted && this.role === "teacher";
    }
    return this.markersVisible;
  }

  private getPartVideoActivationMode(part: ExperiencePartConfig): ExperienceVideoActivationMode {
    return part.videoActivationMode ?? "standard";
  }

  private updateRemoteParticipantLabelsFacing(): void {
    for (const visual of this.remoteParticipants.values()) {
      this.applyUprightBillboardFacing(visual.label);
    }
  }

  private updateObjectStateLabelFacing(label: THREE.Object3D): void {
    this.applyUprightBillboardFacing(label);
  }

  private getObjectMarkerColor(objectId: SceneObjectId): number {
    const state = this.objectMarkerStates[objectId];
    if (state === "orange") {
      return 0xf97316;
    }
    if (state === "red") {
      return 0xef4444;
    }
    return 0x22c55e;
  }

  private getObjectMarkerEmissive(objectId: SceneObjectId): number {
    const state = this.objectMarkerStates[objectId];
    if (state === "orange") {
      return 0x7c2d12;
    }
    if (state === "red") {
      return 0x7f1d1d;
    }
    return 0x15803d;
  }

  private getNextObjectMarkerState(objectId: SceneObjectId): ObjectMarkerState {
    const state = this.objectMarkerStates[objectId];
    if (state === "green") {
      return "orange";
    }
    if (state === "orange") {
      return "red";
    }
    return "green";
  }

  private getModelObjectLabel(experience: ExperienceConfig): string {
    const text = `${experience.title} ${experience.description}`.toLowerCase();
    if (text.includes("turbofan") || text.includes("turbine")) {
      return "Turbofan";
    }
    if (text.includes("cessna")) {
      return "Cessna";
    }
    if (text.includes("air") || text.includes("noaa")) {
      return "Aircraft";
    }
    return experience.title.slice(0, 28);
  }

  private preloadVideos(experience: ExperienceConfig): void {
    const urls = [
      CHROMA_DANCER_VIDEO_URL,
      ...Object.values(experience.introVideos),
      ...experience.parts.flatMap((part) => part.videoUrl ? [part.videoUrl] : [])
    ];
    for (const url of urls) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "video";
      link.href = url;
      document.head.append(link);
    }
  }

  private addFallbackGarage(): void {
    const group = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      new THREE.MeshStandardMaterial({ color: 0x2d3748, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    group.add(floor);
    this.teleportSurfaces.push(floor);
    this.teleportFloorPlane.constant = -floor.position.y;

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 });
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(9, 3, 0.12), wallMaterial);
    backWall.position.set(0, 1.5, -4.5);
    group.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 9), wallMaterial);
    leftWall.position.set(-4.5, 1.5, 0);
    group.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3, 9), wallMaterial);
    rightWall.position.set(4.5, 1.5, 0);
    group.add(rightWall);

    const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    for (let index = -3; index <= 3; index += 2) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 8.2), stripeMaterial);
      stripe.position.set(index, 0.01, 0);
      group.add(stripe);
    }

    this.environmentRoot = group;
    this.scene.add(group);
  }

  private addTeleportFloor(environment?: THREE.Object3D): void {
    const bounds = environment ? new THREE.Box3().setFromObject(environment) : undefined;
    const size = bounds?.getSize(new THREE.Vector3());
    const environmentFootprint = size && Number.isFinite(size.x) && Number.isFinite(size.z)
      ? Math.max(size.x, size.z) + 2
      : 14;
    const floorSize = Math.min(80, Math.max(14, environmentFootprint));
    const floorY = bounds && Number.isFinite(bounds.min.y) ? bounds.min.y + 0.01 : 0;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(floorSize, floorSize),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = floorY;
    this.scene.add(floor);
    this.teleportSurfaces.push(floor);
    this.teleportFloorPlane.constant = -floorY;
  }

  private applyEnvironmentTransform(root: THREE.Object3D, environment?: ExperienceEnvironmentConfig): void {
    if (!environment) {
      return;
    }

    root.position.fromArray(environment.position ?? [0, 0, 0]);
    root.rotation.set(...(environment.rotation ?? [0, 0, 0]));
    root.scale.setScalar(environment.scale ?? 1);

    if (!environment.fitToSize) {
      return;
    }

    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const largestFootprint = Math.max(size.x, size.z);
    if (!Number.isFinite(largestFootprint) || largestFootprint <= 0) {
      return;
    }

    const fittedScale = root.scale.x * (environment.fitToSize / largestFootprint);
    root.scale.setScalar(fittedScale);
    root.updateMatrixWorld(true);

    const fittedBounds = new THREE.Box3().setFromObject(root);
    const center = fittedBounds.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= fittedBounds.min.y;
  }

  private registerCollisionObjects(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    const rootBounds = new THREE.Box3().setFromObject(root);
    if (!rootBounds.isEmpty()) {
      this.navigationBounds = this.navigationBounds ? this.navigationBounds.union(rootBounds) : rootBounds.clone();
    }

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) {
        return;
      }

      const bounds = new THREE.Box3().setFromObject(mesh);
      const size = bounds.getSize(new THREE.Vector3());
      if (bounds.isEmpty() || size.y < 0.25) {
        return;
      }

      this.collisionObjects.push(mesh);
    });
  }

  private applyEnvironmentBrightness(root: THREE.Object3D, brightness: number): void {
    if (!Number.isFinite(brightness) || brightness <= 0 || brightness === 1) {
      return;
    }

    root.traverse((object) => {
      const light = object as THREE.Light;
      if ((light as THREE.Object3D).isObject3D && "intensity" in light && typeof light.intensity === "number") {
        light.intensity *= brightness;
      }
    });
  }

  private async loadParticipantHeadsetTemplate(): Promise<void> {
    if (this.participantHeadsetTemplate || this.participantHeadsetTemplatePromise) {
      return this.participantHeadsetTemplatePromise ?? Promise.resolve();
    }

    this.participantHeadsetTemplatePromise = new Promise((resolve) => {
      this.loader.load(
        PARTICIPANT_HEADSET_ASSET_URL,
        (gltf) => {
          this.participantHeadsetTemplate = this.createParticipantHeadsetTemplate(gltf.scene);
          this.refreshRemoteParticipantHeadsets();
          resolve();
        },
        undefined,
        () => {
          resolve();
        }
      );
    });

    return this.participantHeadsetTemplatePromise;
  }

  private createParticipantHeadsetTemplate(root: THREE.Object3D): THREE.Object3D {
    const clone = root.clone(true);
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    clone.position.sub(center);
    clone.position.y -= bounds.min.y;
    const largestAxis = Math.max(size.x, size.y, size.z);
    const targetSize = 0.24;
    const scale = largestAxis > 0 ? targetSize / largestAxis : 1;
    clone.scale.setScalar(scale);
    clone.rotation.set(0, Math.PI, 0);
    clone.position.y -= 0.08;
    return clone;
  }

  private refreshRemoteParticipantHeadsets(): void {
    if (!this.participantHeadsetTemplate) {
      return;
    }

    for (const visual of this.remoteParticipants.values()) {
      visual.headAnchor.remove(visual.headModel);
      visual.headModel = this.participantHeadsetTemplate.clone(true);
      visual.headAnchor.add(visual.headModel);
    }
  }

  private updateRemoteParticipant(participant: Participant): void {
    if (!participant.presence) {
      return;
    }

    const visual = this.remoteParticipants.get(participant.id) ?? this.createRemoteParticipantVisual(participant);
    if (!this.remoteParticipants.has(participant.id)) {
      this.remoteParticipants.set(participant.id, visual);
      this.classroomRoot.add(visual.root);
    }

    this.applyPresenceJoint(visual.headAnchor, participant.presence.head);
    this.applyPresenceToController(visual.leftController, participant.presence.leftHand, participant.presence.inVr);
    this.applyPresenceToController(visual.rightController, participant.presence.rightHand, participant.presence.inVr);
    visual.label.position.copy(visual.headAnchor.position).add(new THREE.Vector3(0, 0.24, 0));
    this.applyUprightBillboardFacing(visual.label);
  }

  private createRemoteParticipantVisual(participant: Participant): RemoteParticipantVisual {
    const root = new THREE.Group();
    const headAnchor = new THREE.Group();
    root.add(headAnchor);
    const headModel = this.participantHeadsetTemplate?.clone(true) ?? this.createFallbackHeadsetMesh();
    headAnchor.add(headModel);

    const leftController = this.createRemoteControllerMesh(0x38bdf8);
    const rightController = this.createRemoteControllerMesh(0xf97316);
    root.add(leftController, rightController);

    const label = this.createObjectStateLabel(`${participant.name} (${participant.role})`);
    root.add(label);

    return { root, headAnchor, headModel, leftController, rightController, label };
  }

  private createFallbackHeadsetMesh(): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.1, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.18 })
    );
  }

  private createRemoteControllerMesh(color: number): THREE.Mesh {
    return new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.12, 0.045),
      new THREE.MeshStandardMaterial({ color, roughness: 0.38, metalness: 0.1 })
    );
  }

  private applyPresenceToController(mesh: THREE.Mesh, joint: PresenceJoint | null, visible: boolean): void {
    mesh.visible = Boolean(joint && visible);
    if (!joint || !visible) {
      return;
    }

    mesh.position.fromArray(joint.position);
    mesh.quaternion.fromArray(joint.quaternion);
  }

  private applyPresenceJoint(target: THREE.Object3D, joint: PresenceJoint): void {
    target.position.fromArray(joint.position);
    target.quaternion.fromArray(joint.quaternion);
  }

  private disposeRemoteParticipantVisual(visual: RemoteParticipantVisual): void {
    visual.label.geometry.dispose();
    const labelMaterial = visual.label.material as THREE.MeshBasicMaterial;
    labelMaterial.map?.dispose();
    labelMaterial.dispose();
    for (const mesh of [visual.leftController, visual.rightController]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }

  private getCurrentParticipantPresence(): ParticipantPresence {
    const headObject = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    return {
      head: this.capturePresenceJoint(headObject),
      leftHand: this.renderer.xr.isPresenting ? this.captureControllerPresence("left") : null,
      rightHand: this.renderer.xr.isPresenting ? this.captureControllerPresence("right") : null,
      inVr: this.renderer.xr.isPresenting
    };
  }

  private captureControllerPresence(handedness: XRHandedness): PresenceJoint | null {
    for (const [controller, source] of this.controllerInputSources) {
      if (source.handedness !== handedness) {
        continue;
      }
      return this.capturePresenceJoint(controller);
    }
    return null;
  }

  private capturePresenceJoint(object: THREE.Object3D): PresenceJoint {
    const position = this.classroomRoot.worldToLocal(object.getWorldPosition(new THREE.Vector3()));
    const quaternion = object.getWorldQuaternion(new THREE.Quaternion());
    return {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w]
    };
  }

  private maybeSyncParticipantPresence(): void {
    if (!this.role) {
      return;
    }

    const now = performance.now();
    if (now - this.lastParticipantPresenceSyncAt < PARTICIPANT_PRESENCE_SYNC_INTERVAL_MS) {
      return;
    }

    this.lastParticipantPresenceSyncAt = now;
    this.options.onParticipantPresenceChange(this.getCurrentParticipantPresence());
  }

  private clearExperience(): void {
    if (this.modelRoot) {
      this.classroomRoot.remove(this.modelRoot);
      this.modelRoot = undefined;
    }
    for (const root of this.propRoots) {
      this.classroomRoot.remove(root);
    }
    this.propRoots = [];
    this.pendingModelPosition = undefined;
    this.collisionObjects = [];
    this.navigationBounds = undefined;
    if (this.environmentRoot) {
      this.scene.remove(this.environmentRoot);
      this.environmentRoot = undefined;
    }
    this.environmentSkyboxTexture?.dispose();
    this.environmentSkyboxTexture = undefined;
    for (const visual of this.remoteParticipants.values()) {
      this.classroomRoot.remove(visual.root);
      this.disposeRemoteParticipantVisual(visual);
    }
    this.remoteParticipants.clear();
    for (const surface of this.teleportSurfaces) {
      surface.removeFromParent();
    }
    this.teleportSurfaces.length = 0;
    this.teleportFloorPlane.constant = 0;
    this.modelMixer = undefined;
    this.propMixers = [];
    this.modelActions = [];
    this.animationStep = 0;
    this.modelBaseScale = 1;
    this.markersVisible = false;
    this.experienceStarted = false;
    this.hideTeleportPreview();
    this.lastStableTeleportTargetPoint = undefined;
    this.lastStableTeleportTargetValid = false;
    this.teleportDebugState.targetPoint = undefined;
    this.teleportDebugState.targetFound = false;
    this.teleportDebugState.targetValid = false;
    this.tabletJoystickTarget.set(0, 0);
    this.tabletJoystickCurrent.set(0, 0);
    this.tabletLookPointerId = undefined;
    this.tabletJoystickPointerId = undefined;
    for (const marker of this.markers.keys()) {
      this.classroomRoot.remove(marker);
    }
    this.markers.clear();
    this.markersByPartId.clear();
    this.desktopGrabMarkerPartId = undefined;
    this.grabbedMarkerController = undefined;
    this.grabbedMarkerPartId = undefined;
    this.removeModelStateMarker();
    this.removeChromaMarker();
    this.removeObjectStateLabels();
    this.hideChromaBillboard();
    this.hideXrChromaPanel();
    this.chromaPosition = undefined;
    this.removeIntroBillboard();
  }

  private fadeOutIntro(mesh: THREE.Mesh): void {
    const material = mesh.material as THREE.ShaderMaterial;
    const start = performance.now();
    const fade = () => {
      const progress = Math.min((performance.now() - start) / 800, 1);
      material.uniforms.opacity.value = 1 - progress;
      if (progress < 1) {
        requestAnimationFrame(fade);
      } else {
        this.removeIntroBillboard();
      }
    };
    fade();
  }

  private removeIntroBillboard(): void {
    if (this.introVideo) {
      this.introVideo.pause();
      this.introVideo.removeAttribute("src");
      this.introVideo.load();
      this.introVideo = undefined;
    }
    if (this.introBillboard) {
      this.classroomRoot.remove(this.introBillboard);
      this.introBillboard.geometry.dispose();
      this.introBillboard = undefined;
    }
    this.introTexture?.dispose();
    this.introTexture = undefined;
    this.introMaterial?.dispose();
    this.introMaterial = undefined;
  }

  private updateIntroBillboardFacing(): void {
    if (!this.introBillboard) {
      return;
    }
    this.applyUprightBillboardFacing(this.introBillboard);
  }

  private applyUprightBillboardFacing(target: THREE.Object3D, flipY = false): void {
    this.camera.updateMatrixWorld(true);
    const cameraWorldPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const targetWorldPosition = target.getWorldPosition(new THREE.Vector3());
    target.lookAt(cameraWorldPosition.x, targetWorldPosition.y, cameraWorldPosition.z);
    if (flipY) {
      target.rotateY(Math.PI);
    }
  }

  private applyChromaSettingsToMaterial(): void {
    if (!this.chromaMaterial) {
      return;
    }

    this.chromaMaterial.uniforms.similarity.value = this.chromaSettings.similarity;
    this.chromaMaterial.uniforms.smoothness.value = this.chromaSettings.smoothness;
    this.chromaMaterial.uniforms.spill.value = this.chromaSettings.spill;
    this.chromaMaterial.uniforms.opacity.value = this.chromaSettings.opacity;
    this.chromaMaterial.uniforms.brightness.value = this.chromaSettings.brightness;
    this.chromaMaterial.uniforms.contrast.value = this.chromaSettings.contrast;
  }

  private async playChromaVideo(fromStart: boolean): Promise<void> {
    if (!this.chromaVideo) {
      return;
    }

    if (fromStart) {
      this.chromaVideo.currentTime = 0;
    }
    await this.chromaVideo.play();
  }

  private getCurrentChromaPosition(): Vector3Tuple | null {
    if (this.chromaBillboard) {
      this.chromaPosition = this.chromaBillboard.position.toArray() as Vector3Tuple;
      this.chromaHeight = this.chromaBillboard.position.y;
    }
    return this.chromaPosition ? [...this.chromaPosition] as Vector3Tuple : null;
  }

  private startDesktopObjectGrab(target: DesktopGrabTarget, hitPoint: THREE.Vector3, pointerId: number): void {
    const cameraWorldPosition = new THREE.Vector3();
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(cameraWorldPosition);
    this.desktopGrabActive = true;
    this.desktopGrabTarget = target;
    this.desktopGrabMode = "free";
    this.desktopGrabPointerId = pointerId;
    this.desktopGrabDistance = Math.min(
      DESKTOP_MAX_OBJECT_DISTANCE,
      Math.max(DESKTOP_MIN_OBJECT_DISTANCE, cameraWorldPosition.distanceTo(hitPoint))
    );
    this.renderer.domElement.setPointerCapture(pointerId);
  }

  private startDesktopDistanceGrab(target: DesktopGrabTarget, hitPoint: THREE.Vector3, pointerId: number): void {
    this.startDesktopObjectGrab(target, hitPoint, pointerId);
    this.desktopGrabMode = "distance";
  }

  private updateChromaBillboardFacing(): void {
    if (!this.chromaBillboard?.visible) {
      if (this.chromaVideo && !this.chromaVideo.paused) {
        this.chromaVideo.pause();
      }
      return;
    }

    this.applyUprightBillboardFacing(this.chromaBillboard, true);
    this.applyChromaBillboardScale();
    if (this.chromaVideo && this.chromaVideo.paused && this.chromaBillboardRequestedVisible) {
      void this.playChromaVideo(false).catch(() => undefined);
    }
  }

  private applyChromaBillboardScale(): void {
    if (!this.chromaBillboard) {
      return;
    }
    const mirror = this.shouldMirrorChromaBillboard() ? -1 : 1;
    this.chromaBillboard.scale.set(this.chromaScale * mirror, this.chromaScale, this.chromaScale);
  }

  private shouldMirrorChromaBillboard(): boolean {
    if (!this.chromaBillboard || !this.modelRoot) {
      return false;
    }
    this.chromaBillboard.updateMatrixWorld(true);
    const modelWorldPosition = this.modelRoot.getWorldPosition(new THREE.Vector3());
    const billboardWorldPosition = this.chromaBillboard.getWorldPosition(new THREE.Vector3());
    const billboardWorldQuaternion = this.chromaBillboard.getWorldQuaternion(new THREE.Quaternion());
    const modelInBillboardSpace = modelWorldPosition
      .clone()
      .sub(billboardWorldPosition)
      .applyQuaternion(billboardWorldQuaternion.invert());
    return modelInBillboardSpace.x < 0;
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.handleTouchPointerDown(event);
      return;
    }

    if (performance.now() < this.suppressPointerSelectionUntil) {
      event.preventDefault();
      return;
    }

    if (event.button === 2) {
      this.desktopLookActive = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (event.button === 1 && this.role === "teacher") {
      const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
      if (chromaHit) {
        this.startDesktopDistanceGrab("chroma", chromaHit.point, event.pointerId);
        event.preventDefault();
        return;
      }

      const modelHit = this.modelRoot ? this.raycaster.intersectObject(this.modelRoot, true)[0] : undefined;
      if (modelHit) {
        this.startDesktopDistanceGrab("model", modelHit.point, event.pointerId);
        event.preventDefault();
        return;
      }
    }

    if (event.button === 0 && event.ctrlKey && this.role === "teacher") {
      const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
      if (chromaHit) {
        this.startDesktopObjectGrab("chroma", chromaHit.point, event.pointerId);
        event.preventDefault();
        return;
      }

      if (this.modelRoot) {
        const hit = this.raycaster.intersectObject(this.modelRoot, true)[0];
        if (hit) {
          this.startDesktopObjectGrab("model", hit.point, event.pointerId);
          event.preventDefault();
          return;
        }
      }

      if (this.role === "teacher") {
        const markerHits = this.raycaster.intersectObjects([...this.markersByPartId.values()], false);
        if (markerHits.length > 0) {
          const hitMesh = markerHits[0].object as THREE.Mesh;
          for (const [partId, mesh] of this.markersByPartId) {
            if (mesh === hitMesh) {
              this.desktopGrabMarkerPartId = partId;
              this.desktopGrabActive = true;
              this.desktopGrabMode = "free";
              this.desktopGrabDistance = Math.max(0.5, Math.min(10, this.raycaster.ray.origin.distanceTo(markerHits[0].point)));
              this.desktopGrabPointerId = event.pointerId;
              this.renderer.domElement.setPointerCapture(event.pointerId);
              event.preventDefault();
              return;
            }
          }
        }
      }
    }

    if (this.selectModelStateMarkerFromCurrentRay()) {
      return;
    }

    if (this.selectChromaMarkerFromCurrentRay()) {
      return;
    }

    const hits = this.raycaster.intersectObjects([...this.markers.keys()], false);
    const part = hits[0] ? this.markers.get(hits[0].object) : undefined;
    if (part) {
      this.options.onMarkerSelected(part);
      return;
    }

    const action = this.getDesktopButtonAction();
    if (action) {
      this.handleXrButtonAction(action);
      return;
    }

    this.hideTeleportPreview();
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.handleTouchPointerMove(event);
      return;
    }

    if (this.desktopGrabActive) {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      if (this.desktopGrabMode === "distance") {
        this.desktopGrabDistance = Math.min(
          DESKTOP_MAX_OBJECT_DISTANCE,
          Math.max(DESKTOP_MIN_OBJECT_DISTANCE, this.desktopGrabDistance - event.movementY * DESKTOP_DISTANCE_DRAG_SPEED)
        );
      }
      const target = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, this.desktopGrabDistance);
      if (this.desktopGrabTarget === "chroma" && this.chromaBillboard) {
        this.chromaBillboard.position.copy(this.classroomRoot.worldToLocal(target));
        this.emitChromaTransformChange();
      } else if (this.desktopGrabTarget === "model" && this.modelRoot) {
        this.modelRoot.position.copy(this.classroomRoot.worldToLocal(target));
        this.emitModelPositionChange();
      } else if (this.desktopGrabMarkerPartId) {
        const marker = this.markersByPartId.get(this.desktopGrabMarkerPartId);
        if (marker) {
          marker.position.copy(this.classroomRoot.worldToLocal(target));
          this.emitPartMarkerPositionChange(this.desktopGrabMarkerPartId);
        }
      }
      event.preventDefault();
      return;
    }

    if (!this.desktopLookActive || this.renderer.xr.isPresenting) {
      return;
    }

    this.desktopYaw += event.movementX * DESKTOP_LOOK_SENSITIVITY;
    this.desktopPitch -= event.movementY * DESKTOP_LOOK_SENSITIVITY;
    this.desktopPitch = Math.min(DESKTOP_MAX_PITCH, Math.max(-DESKTOP_MAX_PITCH, this.desktopPitch));
    this.applyDesktopLook();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "touch") {
      this.handleTouchPointerUp(event);
      return;
    }

    if (this.desktopGrabActive && this.desktopGrabTarget === "chroma") {
      this.emitChromaTransformChange(true);
    }
    if (this.desktopGrabActive && this.desktopGrabTarget === "model") {
      this.emitModelPositionChange(true);
    }
    if (this.desktopGrabActive && this.desktopGrabMarkerPartId) {
      this.emitPartMarkerPositionChange(this.desktopGrabMarkerPartId, true);
      this.desktopGrabMarkerPartId = undefined;
    }
    this.desktopLookActive = false;
    this.desktopGrabActive = false;
    this.desktopGrabTarget = undefined;
    this.desktopGrabMode = "free";
    this.desktopGrabPointerId = undefined;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

  private handleWheel = (event: WheelEvent): void => {
    if (this.role !== "teacher" || this.renderer.xr.isPresenting) {
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
    if (chromaHit && this.chromaBillboard) {
      this.moveObjectAlongPointerRay(this.chromaBillboard, event.deltaY);
      this.emitChromaTransformChange(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const modelHit = this.modelRoot ? this.raycaster.intersectObject(this.modelRoot, true)[0] : undefined;
    if ((modelHit || this.modelRoot) && this.modelRoot) {
      this.moveObjectAlongPointerRay(this.modelRoot, event.deltaY);
      this.emitModelPositionChange(true);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };

  private moveObjectAlongPointerRay(object: THREE.Object3D, wheelDelta: number): void {
    object.updateMatrixWorld(true);
    const objectWorldPosition = object.getWorldPosition(new THREE.Vector3());
    const currentDistance = this.raycaster.ray.origin.distanceTo(objectWorldPosition);
    const nextDistance = Math.min(
      DESKTOP_MAX_OBJECT_DISTANCE,
      Math.max(DESKTOP_MIN_OBJECT_DISTANCE, currentDistance + wheelDelta * DESKTOP_WHEEL_DISTANCE_SPEED)
    );
    const nextWorldPosition = this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, nextDistance);
    object.position.copy(this.classroomRoot.worldToLocal(nextWorldPosition));
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (this.isTypingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();
    if (this.isDesktopControlKey(key)) {
      this.pressedKeys.add(key);
      event.preventDefault();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.key.toLowerCase());
  };

  private preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private preventAuxClick = (event: MouseEvent): void => {
    if (event.button === 1) {
      event.preventDefault();
    }
  };

  private handleTouchPointerDown(event: PointerEvent): void {
    this.activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.touchTapMoved = false;
    this.touchTapStart = { x: event.clientX, y: event.clientY };

    if (this.isTabletExploreMode()) {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      if (!this.tabletJoystickPointerId && this.isInTabletJoystickZone(event.clientX, event.clientY, bounds)) {
        this.tabletJoystickPointerId = event.pointerId;
        this.updateTabletJoystick(event.clientX, event.clientY, bounds);
      } else if (!this.tabletLookPointerId) {
        this.tabletLookPointerId = event.pointerId;
        this.tabletLookLastPoint = { x: event.clientX, y: event.clientY };
      }
      event.preventDefault();
      return;
    }

    if (this.activeTouchPoints.size === 1) {
      this.touchPrimaryPointerId = event.pointerId;
      this.touchLookActive = true;
      this.lastTouchCentroid = { x: event.clientX, y: event.clientY };
      this.lastTouchDistance = undefined;
    } else {
      this.touchLookActive = false;
      this.lastTouchCentroid = this.getTouchCentroid();
      this.lastTouchDistance = this.getTouchDistance();
    }
    event.preventDefault();
  }

  private handleTouchPointerMove(event: PointerEvent): void {
    if (!this.activeTouchPoints.has(event.pointerId) || this.renderer.xr.isPresenting || !this.role) {
      return;
    }

    this.activeTouchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.touchTapStart && Math.hypot(event.clientX - this.touchTapStart.x, event.clientY - this.touchTapStart.y) > TABLET_TAP_MOVE_THRESHOLD) {
      this.touchTapMoved = true;
    }

    if (this.isTabletExploreMode()) {
      const bounds = this.renderer.domElement.getBoundingClientRect();
      if (event.pointerId === this.tabletJoystickPointerId) {
        this.updateTabletJoystick(event.clientX, event.clientY, bounds);
        event.preventDefault();
        return;
      }
      if (event.pointerId === this.tabletLookPointerId && this.tabletLookLastPoint) {
        this.desktopYaw += (event.clientX - this.tabletLookLastPoint.x) * TABLET_LOOK_SENSITIVITY;
        this.desktopPitch -= (event.clientY - this.tabletLookLastPoint.y) * TABLET_LOOK_SENSITIVITY;
        this.desktopPitch = Math.min(DESKTOP_MAX_PITCH, Math.max(-DESKTOP_MAX_PITCH, this.desktopPitch));
        this.applyDesktopLook();
        this.tabletLookLastPoint = { x: event.clientX, y: event.clientY };
        event.preventDefault();
        return;
      }
    }

    if (this.isTabletInspectMode() && this.activeTouchPoints.size === 1 && this.touchPrimaryPointerId === event.pointerId) {
      const previous = this.lastTouchCentroid;
      this.lastTouchCentroid = { x: event.clientX, y: event.clientY };
      if (previous) {
        this.desktopYaw += (event.clientX - previous.x) * TABLET_ORBIT_SENSITIVITY;
        this.desktopPitch -= (event.clientY - previous.y) * TABLET_ORBIT_SENSITIVITY;
        this.desktopPitch = Math.min(DESKTOP_MAX_PITCH, Math.max(-DESKTOP_MAX_PITCH, this.desktopPitch));
        this.applyInspectCamera();
      }
      event.preventDefault();
      return;
    }

    if (this.isTabletInspectMode() && this.activeTouchPoints.size >= 2) {
      const centroid = this.getTouchCentroid();
      const distance = this.getTouchDistance();
      if (centroid && this.lastTouchCentroid) {
        this.panInspectTarget(centroid.x - this.lastTouchCentroid.x, centroid.y - this.lastTouchCentroid.y);
      }
      if (distance !== undefined && this.lastTouchDistance !== undefined) {
        this.tabletOrbitDistance = Math.min(
          TABLET_MAX_ZOOM,
          Math.max(TABLET_MIN_ZOOM, this.tabletOrbitDistance - (distance - this.lastTouchDistance) * 0.01)
        );
        this.applyInspectCamera();
      }
      this.lastTouchCentroid = centroid;
      this.lastTouchDistance = distance;
      event.preventDefault();
      return;
    }

    if (this.activeTouchPoints.size === 1 && this.touchLookActive && this.touchPrimaryPointerId === event.pointerId) {
      const previous = this.lastTouchCentroid;
      this.lastTouchCentroid = { x: event.clientX, y: event.clientY };
      if (previous) {
        this.desktopYaw += (event.clientX - previous.x) * TOUCH_LOOK_SENSITIVITY;
        this.desktopPitch -= (event.clientY - previous.y) * TOUCH_LOOK_SENSITIVITY;
        this.desktopPitch = Math.min(DESKTOP_MAX_PITCH, Math.max(-DESKTOP_MAX_PITCH, this.desktopPitch));
        this.applyDesktopLook();
      }
      event.preventDefault();
      return;
    }

    if (this.activeTouchPoints.size >= 2) {
      const centroid = this.getTouchCentroid();
      const distance = this.getTouchDistance();
      if (centroid && this.lastTouchCentroid) {
        const deltaX = centroid.x - this.lastTouchCentroid.x;
        const deltaY = centroid.y - this.lastTouchCentroid.y;
        this.moveFromScreenDeltas(deltaX, deltaY, TOUCH_MOVE_SENSITIVITY);
      }
      if (distance !== undefined && this.lastTouchDistance !== undefined) {
        const pinchDelta = distance - this.lastTouchDistance;
        this.moveForwardFromPinch(pinchDelta * TOUCH_PINCH_SENSITIVITY);
      }
      this.lastTouchCentroid = centroid;
      this.lastTouchDistance = distance;
      event.preventDefault();
    }
  }

  private handleTouchPointerUp(event: PointerEvent): void {
    this.activeTouchPoints.delete(event.pointerId);
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }

    if (this.isTabletExploreMode()) {
      if (event.pointerId === this.tabletJoystickPointerId) {
        this.tabletJoystickPointerId = undefined;
        this.tabletJoystickTarget.set(0, 0);
      }
      if (event.pointerId === this.tabletLookPointerId) {
        this.tabletLookPointerId = undefined;
        this.tabletLookLastPoint = undefined;
      }
      if (!this.touchTapMoved && this.activeTouchPoints.size === 0) {
        this.handleTouchSceneTap(event.clientX, event.clientY);
      }
      return;
    }

    if (this.isTabletInspectMode() && !this.touchTapMoved && this.activeTouchPoints.size === 0) {
      const now = performance.now();
      if (now - this.lastTapTimestamp <= TABLET_DOUBLE_TAP_MS) {
        this.resetTabletControlsForExperience();
      } else {
        this.handleTouchSceneTap(event.clientX, event.clientY);
      }
      this.lastTapTimestamp = now;
    } else if (!this.touchTapMoved && this.activeTouchPoints.size === 0) {
      this.handleTouchSceneTap(event.clientX, event.clientY);
    }

    if (this.activeTouchPoints.size === 0) {
      this.touchPrimaryPointerId = undefined;
      this.touchLookActive = false;
      this.lastTouchCentroid = undefined;
      this.lastTouchDistance = undefined;
      return;
    }

    if (this.activeTouchPoints.size === 1) {
      const [remainingPointerId, remainingPoint] = this.activeTouchPoints.entries().next().value as [number, TouchPoint];
      this.touchPrimaryPointerId = remainingPointerId;
      this.touchLookActive = true;
      this.lastTouchCentroid = { ...remainingPoint };
      this.lastTouchDistance = undefined;
      return;
    }

    this.touchLookActive = false;
    this.lastTouchCentroid = this.getTouchCentroid();
    this.lastTouchDistance = this.getTouchDistance();
  }

  private getTouchCentroid(): TouchPoint | undefined {
    if (this.activeTouchPoints.size === 0) {
      return undefined;
    }

    let x = 0;
    let y = 0;
    for (const point of this.activeTouchPoints.values()) {
      x += point.x;
      y += point.y;
    }
    return { x: x / this.activeTouchPoints.size, y: y / this.activeTouchPoints.size };
  }

  private getTouchDistance(): number | undefined {
    if (this.activeTouchPoints.size < 2) {
      return undefined;
    }

    const points = [...this.activeTouchPoints.values()];
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.hypot(dx, dy);
  }

  private handleTouchSceneTap(clientX: number, clientY: number): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.selectModelStateMarkerFromCurrentRay()) {
      return;
    }
    if (this.selectChromaMarkerFromCurrentRay()) {
      return;
    }
    const hits = this.raycaster.intersectObjects([...this.markers.keys()], false);
    const part = hits[0] ? this.markers.get(hits[0].object) : undefined;
    if (part) {
      this.options.onMarkerSelected(part);
    }
  }

  private isTabletInspectMode(): boolean {
    return this.mode === "fallback" && this.tabletControlMode === "inspect";
  }

  private isTabletExploreMode(): boolean {
    return this.mode === "fallback" && this.tabletControlMode === "explore";
  }

  private isInTabletJoystickZone(clientX: number, clientY: number, bounds: DOMRect): boolean {
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    return localX <= bounds.width * 0.38 && localY >= bounds.height * 0.48;
  }

  private updateTabletJoystick(clientX: number, clientY: number, bounds: DOMRect): void {
    const centerX = bounds.left + 112;
    const centerY = bounds.bottom - 112;
    const deltaX = clientX - centerX;
    const deltaY = clientY - centerY;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance <= TABLET_JOYSTICK_DEADZONE) {
      this.tabletJoystickTarget.set(0, 0);
      return;
    }

    const clamped = Math.min(TABLET_JOYSTICK_RADIUS, distance);
    const normalized = clamped / TABLET_JOYSTICK_RADIUS;
    this.tabletJoystickTarget.set((deltaX / distance) * normalized, (deltaY / distance) * normalized);
  }

  private panInspectTarget(deltaX: number, deltaY: number): void {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    this.tabletOrbitTarget.addScaledVector(right, -deltaX * TABLET_PAN_SENSITIVITY * this.tabletOrbitDistance);
    this.tabletOrbitTarget.addScaledVector(up, deltaY * TABLET_PAN_SENSITIVITY * this.tabletOrbitDistance);
    this.applyInspectCamera();
  }

  private resetTabletControlsForExperience(): void {
    if (this.isTabletInspectMode() && this.modelRoot) {
      const initialView = this.currentExperience?.initialView;
      if (initialView?.mode === "inspect" && initialView.target && initialView.distance) {
        this.tabletOrbitTarget.fromArray(initialView.target);
        this.desktopYaw = initialView.yaw;
        this.desktopPitch = initialView.pitch;
        this.tabletOrbitDistance = Math.min(TABLET_MAX_ZOOM, Math.max(TABLET_MIN_ZOOM, initialView.distance));
        this.applyInspectCamera();
        return;
      }

      this.modelRoot.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(this.modelRoot);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      this.tabletOrbitTarget.copy(center);
      this.desktopYaw = Math.PI;
      this.desktopPitch = -0.22;
      this.tabletOrbitDistance = Math.min(TABLET_MAX_ZOOM, Math.max(2.4, Math.max(size.x, size.y, size.z) * 3));
      this.applyInspectCamera();
      return;
    }

    const initialView = this.currentExperience?.initialView;
    this.desktopYaw = initialView?.mode === "walk" ? initialView.yaw : 0;
    this.desktopPitch = initialView?.mode === "walk" ? initialView.pitch : 0;
    this.camera.position.set(0, 1.55, 2.2);
    this.userRig.position.fromArray(initialView?.mode === "walk" && initialView.position ? initialView.position : [0, 0, 0]);
    this.applyDesktopLook();
  }

  private applyInspectCamera(): void {
    this.userRig.position.copy(this.tabletOrbitTarget);
    this.userRig.rotation.y = this.desktopYaw;
    this.camera.position.set(0, 0, this.tabletOrbitDistance);
    this.camera.rotation.x = this.desktopPitch;
  }

  private moveFromScreenDeltas(deltaX: number, deltaY: number, sensitivity: number): void {
    const cameraWorldDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraWorldDirection);
    const forward = cameraWorldDirection.setY(0);
    if (forward.lengthSq() < 0.001) {
      forward.set(Math.sin(this.desktopYaw), 0, -Math.cos(this.desktopYaw));
    }
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3()
      .addScaledVector(right, -deltaX * sensitivity)
      .addScaledVector(forward, -deltaY * sensitivity);
    this.moveUserRigWithCollision(move);
  }

  private moveForwardFromPinch(amount: number): void {
    if (Math.abs(amount) < 0.001) {
      return;
    }

    const cameraWorldDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraWorldDirection);
    const forward = cameraWorldDirection.setY(0);
    if (forward.lengthSq() < 0.001) {
      forward.set(Math.sin(this.desktopYaw), 0, -Math.cos(this.desktopYaw));
    }
    forward.normalize();
    this.moveUserRigWithCollision(forward.multiplyScalar(amount));
  }

  private teleportTo(point: THREE.Vector3): void {
    this.userRig.position.x = point.x;
    this.userRig.position.z = point.z;
  }

  private handleControllerSelect = (event: THREE.Event): void => {
    if (this.grabbedModelDuringSelect) {
      this.grabbedModelDuringSelect = false;
      return;
    }

    const controller = event.target as THREE.Object3D;
    if (this.isRightController(controller) && this.teleportTarget.visible) {
      if (this.teleportTargetPoint && this.teleportTargetValid) {
        this.teleportTo(this.teleportTargetPoint);
        this.teleportAimConsumed = true;
        this.hideTeleportPreview();
        this.teleportDebugState.lastAttemptReason = "teleport executed";
        return;
      }

      this.teleportDebugState.lastAttemptReason = "invalid target";
      return;
    }

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.updateMatrixWorld();
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    this.raycaster.set(origin, direction);

    const action = this.getXrButtonActionFromRaycaster();
    if (action) {
      this.handleXrButtonAction(action);
      return;
    }

    if (this.isRayBlockedByXrChromaPanel()) {
      return;
    }

    if (this.selectModelStateMarkerFromController(controller)) {
      return;
    }

    if (this.selectChromaMarkerFromController(controller)) {
      return;
    }

    const markerHits = this.raycaster.intersectObjects([...this.markers.keys()], false);
    const part = markerHits[0] ? this.markers.get(markerHits[0].object) : undefined;
    if (part) {
      this.options.onMarkerSelected(part);
      return;
    }

  };

  private getDesktopButtonAction(): XrButtonAction | undefined {
    return this.getXrButtonActionFromRaycaster();
  }

  private getXrButtonActionFromRaycaster(): XrButtonAction | undefined {
    const targets: THREE.Object3D[] = [];
    if (this.xrControlPanel.visible) {
      targets.push(...this.xrButtons.keys());
    }
    if (this.xrChromaPanel.visible) {
      targets.push(...this.xrChromaButtons.keys());
    }
    if (targets.length === 0) {
      return undefined;
    }

    const buttonHits = this.raycaster.intersectObjects(targets, false);
    const object = buttonHits[0]?.object;
    return object ? this.xrButtons.get(object) ?? this.xrChromaButtons.get(object) : undefined;
  }

  private isRayBlockedByXrChromaPanel(): boolean {
    return Boolean(
      this.xrChromaPanel.visible &&
      this.xrChromaPanelSurface &&
      this.raycaster.intersectObject(this.xrChromaPanelSurface, false).length > 0
    );
  }

  private handleXrButtonAction(action: XrButtonAction): void {
    if (action === "calibrate") {
      this.flashXrButton(action);
      this.options.onCalibrate(this.calibrateOrigin());
      return;
    }
    if (action === "back-menu") {
      this.flashXrButton(action);
      this.options.onBackToMenu();
      return;
    }
    if (action === "animation-previous-step" || action === "animation-next-step") {
      this.flashXrButton(action);
      this.options.onAnimationStep(action === "animation-next-step" ? 1 : -1);
      return;
    }
    if (action === "scale-down" || action === "scale-up") {
      this.flashXrButton(action);
      this.options.onScaleStep(action === "scale-up" ? 1 : -1);
      return;
    }
    if (action === "chroma-panel-toggle") {
      this.flashXrButton(action);
      if (this.xrChromaPanel.visible) {
        this.hideXrChromaPanel();
        return;
      }
      this.showChromaBillboard();
      this.showXrChromaPanel();
      this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
      return;
    }
    if (action === "chroma-panel-close") {
      this.hideXrChromaPanel();
      return;
    }
    if (action === "chroma-hide") {
      this.hideXrChromaPanel();
      this.hideChromaBillboard();
      this.options.onChromaBillboardStateChange(this.getChromaBillboardState(false));
      return;
    }
    if (action === "chroma-reset") {
      this.flashXrButton(action);
      this.resetChromaControls();
      return;
    }
    const chromaSettingAction = CHROMA_XR_SETTING_ACTIONS[action];
    if (chromaSettingAction) {
      this.adjustChromaSetting(chromaSettingAction.key, chromaSettingAction.direction);
      return;
    }
    if (action === "chroma-scale-down" || action === "chroma-scale-up") {
      this.flashXrButton(action);
      this.adjustChromaScale(action === "chroma-scale-up" ? CHROMA_XR_SCALE_STEP : -CHROMA_XR_SCALE_STEP);
      return;
    }
    if (action === "chroma-height-down" || action === "chroma-height-up") {
      this.flashXrButton(action);
      this.adjustChromaHeight(action === "chroma-height-up" ? CHROMA_XR_HEIGHT_STEP : -CHROMA_XR_HEIGHT_STEP);
      return;
    }
    if (action === "chroma-restart") {
      this.flashXrButton(action);
      this.chromaPlaybackRevision += 1;
      this.restartChromaBillboard();
      this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
      return;
    }
    if (action === "chroma-playback-toggle") {
      this.flashXrButton(action);
      this.setChromaPlaybackMode(this.chromaPlaybackMode === "loop" ? "once" : "loop");
      this.chromaPlaybackRevision += 1;
      this.restartChromaBillboard();
      this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
      return;
    }
    if (this.role === "teacher" && this.isTeacherCommandAction(action)) {
      this.flashXrButton(action);
      this.options.onTeacherCommand(action);
      return;
    }
  }

  private isTeacherCommandAction(action: XrButtonAction): action is ClientCommand {
    return action === "start-experience" ||
      action === "shell-off" ||
      action === "play-introduction" ||
      action === "reveal-markers";
  }

  private handleControllerSelectStart = (event: THREE.Event): void => {
    const controller = event.target as THREE.Object3D;
    if (this.isRightController(controller)) {
      this.teleportPreviewController = controller;
    }
    if (this.role !== "teacher" || !this.isRightController(controller)) {
      return;
    }

    const panelTargets: THREE.Object3D[] = [];
    if (this.xrControlPanel.visible) {
      panelTargets.push(...this.xrButtons.keys());
    }
    if (this.xrChromaPanel.visible) {
      panelTargets.push(...this.xrChromaButtons.keys());
      if (this.xrChromaPanelSurface) {
        panelTargets.push(this.xrChromaPanelSurface);
      }
    }
    if (panelTargets.length > 0 && this.raycastFromController(controller, panelTargets, false).length > 0) {
      return;
    }

    if (this.chromaMarker && this.chromaMarker.visible && this.raycastFromController(controller, [this.chromaMarker], false).length > 0) {
      return;
    }

    const markerHitsXr = this.raycastFromController(controller, [...this.markersByPartId.values()], false);
    if (markerHitsXr.length > 0 && this.role === "teacher") {
      const hitMesh = markerHitsXr[0].object as THREE.Mesh;
      for (const [partId, mesh] of this.markersByPartId) {
        if (mesh === hitMesh) {
          this.grabbedMarkerController = controller;
          this.grabbedMarkerPartId = partId;
          this.grabbedModelDuringSelect = true;
          const controllerPosition = new THREE.Vector3();
          controller.getWorldPosition(controllerPosition);
          this.grabbedMarkerDistance = Math.max(0.35, Math.min(8, controllerPosition.distanceTo(markerHitsXr[0].point)));
          this.updateGrabbedMarkerPosition();
          return;
        }
      }
    }

    const chromaHit = this.chromaBillboard?.visible ? this.raycastFromController(controller, [this.chromaBillboard], false)[0] : undefined;
    if (chromaHit) {
      this.grabbedChromaController = controller;
      this.grabbedModelDuringSelect = true;
      const controllerPosition = new THREE.Vector3();
      controller.getWorldPosition(controllerPosition);
      this.grabbedChromaDistance = Math.max(0.35, Math.min(8, controllerPosition.distanceTo(chromaHit.point)));
      this.updateGrabbedChromaPosition();
      return;
    }

    if (!this.modelRoot) {
      return;
    }

    const hit = this.raycastFromController(controller, [this.modelRoot], true)[0];
    if (hit) {
      this.grabbedModelController = controller;
      this.grabbedModelDuringSelect = true;
      const controllerPosition = new THREE.Vector3();
      controller.getWorldPosition(controllerPosition);
      this.grabbedModelDistance = Math.max(0.35, Math.min(8, controllerPosition.distanceTo(hit.point)));
      this.updateGrabbedModelPosition();
      return;
    }

  };

  private handleControllerSelectEnd = (): void => {
    if (this.grabbedModelController && this.modelRoot) {
      this.emitModelPositionChange(true);
    }
    if (this.grabbedChromaController && this.chromaBillboard) {
      this.emitChromaTransformChange(true);
    }
    if (this.grabbedMarkerController && this.grabbedMarkerPartId) {
      this.emitPartMarkerPositionChange(this.grabbedMarkerPartId, true);
    }
    this.grabbedModelController = undefined;
    this.grabbedChromaController = undefined;
    this.grabbedMarkerController = undefined;
    this.grabbedMarkerPartId = undefined;
    this.objectRotationActive = false;
  };

  private handleControllerSqueezeStart = (event: THREE.Event): void => {
    const controller = event.target as THREE.Object3D;
    if (controller !== this.grabbedModelController || !this.modelRoot) {
      return;
    }

    this.objectRotationActive = true;
    this.objectRotationAxis = this.getNextObjectRotationAxis();
  };

  private handleControllerSqueezeEnd = (): void => {
    this.objectRotationActive = false;
  };

  private handleControllerConnected = (event: THREE.Event & { data?: XRInputSource }): void => {
    const controller = event.target as THREE.Object3D;
    if (event.data) {
      this.controllerInputSources.set(controller, event.data);
      if (event.data.handedness === "right") {
        this.teleportPreviewController = controller;
        this.teleportDebugState.lastAttemptReason = "right controller connected";
      }
    }
    this.teleportDebugState.rightControllerDetected = Boolean(this.findRightController());
    this.updateTeleportDebugPanel();
  };

  private handleControllerDisconnected = (event: THREE.Event): void => {
    const controller = event.target as THREE.Object3D;
    this.controllerInputSources.delete(controller);
    if (this.teleportPreviewController === controller) {
      this.teleportPreviewController = undefined;
    }
    this.teleportDebugState.rightControllerDetected = Boolean(this.findRightController());
    this.updateTeleportDebugPanel();
  };

  private raycastFromController(
    controller: THREE.Object3D,
    objects: THREE.Object3D[],
    recursive = false,
  ): THREE.Intersection[] {
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.updateMatrixWorld();
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    this.raycaster.set(origin, direction);
    return this.raycaster.intersectObjects(objects, recursive);
  }

  private selectModelStateMarkerFromCurrentRay(): boolean {
    if (this.role !== "teacher" || !this.modelStateMarker || !this.modelStateMarker.visible) {
      return false;
    }

    if (this.raycaster.intersectObject(this.modelStateMarker, false).length === 0) {
      return false;
    }

    this.cycleObjectMarkerState("model");
    return true;
  }

  private selectModelStateMarkerFromController(controller: THREE.Object3D): boolean {
    if (this.role !== "teacher" || !this.modelStateMarker || !this.modelStateMarker.visible) {
      return false;
    }

    if (this.raycastFromController(controller, [this.modelStateMarker], false).length === 0) {
      return false;
    }

    this.cycleObjectMarkerState("model");
    return true;
  }

  private cycleObjectMarkerState(objectId: SceneObjectId): void {
    const state = this.getNextObjectMarkerState(objectId);
    this.setObjectMarkerState(objectId, state);
    this.options.onObjectMarkerStateChange(objectId, state);
  }

  private selectChromaMarkerFromCurrentRay(): boolean {
    if (this.role !== "teacher" || !this.chromaMarker || !this.chromaMarker.visible) {
      return false;
    }

    if (this.raycaster.intersectObject(this.chromaMarker, false).length === 0) {
      return false;
    }

    this.cycleObjectMarkerState("chroma");
    this.options.onChromaMarkerSelected();
    return true;
  }

  private selectChromaMarkerFromController(controller: THREE.Object3D): boolean {
    if (this.role !== "teacher" || !this.chromaMarker || !this.chromaMarker.visible) {
      return false;
    }

    if (this.raycastFromController(controller, [this.chromaMarker], false).length === 0) {
      return false;
    }

    this.cycleObjectMarkerState("chroma");
    this.showChromaBillboard();
    this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
    return true;
  }

  private isRightController(controller: THREE.Object3D): boolean {
    const source = this.getInputSourceForController(controller);
    return source?.handedness === "right" || controller === this.teleportPreviewController;
  }

  private updateGrabbedModelPosition(): void {
    if (!this.grabbedModelController || !this.modelRoot) {
      return;
    }

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    this.grabbedModelController.updateMatrixWorld();
    origin.setFromMatrixPosition(this.grabbedModelController.matrixWorld);
    direction
      .applyQuaternion(this.grabbedModelController.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    const axes = this.getControllerAxes(this.grabbedModelController);
    if (axes) {
      const scaleAxis = axes[2] ?? 0;
      const distanceAxis = axes[3] ?? 0;
      if (this.objectRotationActive) {
        this.rotateGrabbedModel(scaleAxis, distanceAxis);
        this.modelRoot.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedModelDistance)));
        this.emitModelPositionChange();
        return;
      }
      if (Math.abs(distanceAxis) > 0.12) {
        this.grabbedModelDistance = Math.max(0.35, Math.min(10, this.grabbedModelDistance - distanceAxis * OBJECT_DISTANCE_SPEED * this.frameDelta));
      }
      if (Math.abs(scaleAxis) > 0.12) {
        const nextScale = Math.min(2, Math.max(0.25, this.objectScale + scaleAxis * OBJECT_SCALE_SPEED * this.frameDelta));
        this.setObjectScale(nextScale);
        const now = performance.now();
        if (now - this.lastScaleSync > 120) {
          this.options.onObjectScaleChange(nextScale);
          this.lastScaleSync = now;
        }
      }
    }

    this.modelRoot.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedModelDistance)));
    this.emitModelPositionChange();
  }

  private updateGrabbedChromaPosition(): void {
    if (!this.grabbedChromaController || !this.chromaBillboard) {
      return;
    }

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    this.grabbedChromaController.updateMatrixWorld();
    origin.setFromMatrixPosition(this.grabbedChromaController.matrixWorld);
    direction
      .applyQuaternion(this.grabbedChromaController.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    this.chromaBillboard.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedChromaDistance)));
    this.emitChromaTransformChange();
  }

  private updateGrabbedMarkerPosition(): void {
    if (!this.grabbedMarkerController || !this.grabbedMarkerPartId) {
      return;
    }
    const marker = this.markersByPartId.get(this.grabbedMarkerPartId);
    if (!marker) {
      return;
    }
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    this.grabbedMarkerController.updateMatrixWorld();
    origin.setFromMatrixPosition(this.grabbedMarkerController.matrixWorld);
    direction.applyQuaternion(this.grabbedMarkerController.getWorldQuaternion(new THREE.Quaternion())).normalize();
    marker.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedMarkerDistance)));
    this.emitPartMarkerPositionChange(this.grabbedMarkerPartId);
  }

  private emitPartMarkerPositionChange(partId: string, force = false): void {
    const marker = this.markersByPartId.get(partId);
    if (!marker) {
      return;
    }
    const now = performance.now();
    if (!force && now - this.lastMarkerPositionSync < 80) {
      return;
    }
    const { x, y, z } = marker.position;
    this.options.onPartMarkerPositionChange(partId, [x, y, z]);
    this.lastMarkerPositionSync = now;
  }

  private emitModelPositionChange(force = false): void {
    if (!this.modelRoot) {
      return;
    }

    const now = performance.now();
    if (!force && now - this.lastPositionSync < 80) {
      return;
    }

    const { x, y, z } = this.modelRoot.position;
    this.options.onModelPositionChange([x, y, z]);
    this.lastPositionSync = now;
  }

  private emitChromaTransformChange(force = false): void {
    if (!this.chromaBillboard) {
      return;
    }

    const now = performance.now();
    if (!force && now - this.lastChromaTransformSync < 80) {
      return;
    }

    this.chromaPosition = this.chromaBillboard.position.toArray() as Vector3Tuple;
    this.chromaHeight = this.chromaBillboard.position.y;
    this.repositionChromaMarker();
    this.options.onChromaTransformChange(this.chromaPosition, this.chromaScale);
    this.lastChromaTransformSync = now;
  }

  private adjustChromaSetting(key: keyof ChromaKeySettings, direction: -1 | 1): void {
    this.setChromaSettings({
      ...this.chromaSettings,
      [key]: this.chromaSettings[key] + CHROMA_XR_SETTING_STEPS[key] * direction
    });
    this.showChromaBillboard();
    this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
  }

  private resetChromaControls(): void {
    this.setChromaSettings({ ...DEFAULT_CHROMA_KEY_SETTINGS });
    this.setChromaBillboardScale(1);
    this.setChromaBillboardHeight(1.4);
    this.setChromaPlaybackMode("loop");
    this.showChromaBillboard();
    this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
  }

  private adjustChromaScale(delta: number): void {
    this.setChromaBillboardScale(this.chromaScale + delta);
    this.showChromaBillboard();
    this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
  }

  private adjustChromaHeight(delta: number): void {
    this.setChromaBillboardHeight(this.chromaHeight + delta);
    this.showChromaBillboard();
    this.options.onChromaBillboardStateChange(this.getChromaBillboardState(true));
  }

  private applyPendingModelPosition(): void {
    if (!this.modelRoot || !this.pendingModelPosition) {
      return;
    }

    this.modelRoot.position.fromArray(this.pendingModelPosition);
    this.pendingModelPosition = undefined;
    this.repositionChromaMarker();
  }

  private getNextObjectRotationAxis(): ObjectRotationAxis {
    if (this.objectRotationAxis === "yaw") {
      return "pitch";
    }
    if (this.objectRotationAxis === "pitch") {
      return "roll";
    }
    return "yaw";
  }

  private rotateGrabbedModel(horizontalAxis: number, verticalAxis: number): void {
    if (!this.modelRoot) {
      return;
    }

    const axisInput = Math.abs(horizontalAxis) > 0.12 ? horizontalAxis : -verticalAxis;
    if (Math.abs(axisInput) <= 0.12) {
      return;
    }

    const amount = axisInput * OBJECT_ROTATION_SPEED * this.frameDelta;
    if (this.objectRotationAxis === "yaw") {
      this.modelRoot.rotateY(amount);
      return;
    }
    if (this.objectRotationAxis === "pitch") {
      this.modelRoot.rotateX(amount);
      return;
    }
    this.modelRoot.rotateZ(amount);
  }

  private getControllerAxes(controller: THREE.Object3D): readonly number[] | undefined {
    return this.getInputSourceForController(controller)?.gamepad?.axes;
  }

  private getInputSourceForController(controller: THREE.Object3D): XRInputSource | undefined {
    const mappedSource = this.controllerInputSources.get(controller);
    if (mappedSource) {
      return mappedSource;
    }

    const session = this.renderer.xr.getSession();
    if (!session) {
      return undefined;
    }

    const controllerIndex = controller === this.renderer.xr.getController(1) ? 1 : 0;
    return Array.from(session.inputSources)[controllerIndex];
  }

  private anchorXrPanelInFrontOfUser(): void {
    if (!this.role) {
      return;
    }

    const xrCamera = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    xrCamera.updateMatrixWorld();

    const cameraPosition = new THREE.Vector3();
    const cameraQuaternion = new THREE.Quaternion();
    xrCamera.getWorldPosition(cameraPosition);
    xrCamera.getWorldQuaternion(cameraQuaternion);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
    forward.y = 0;
    if (forward.lengthSq() < 0.01) {
      forward.set(0, 0, -1);
    }
    forward.normalize();

    this.xrControlPanel.position.copy(cameraPosition).addScaledVector(forward, XR_PANEL_DISTANCE);
    this.xrControlPanel.position.y = Math.max(1.05, cameraPosition.y - 0.28);
    this.xrControlPanel.lookAt(cameraPosition.x, this.xrControlPanel.position.y, cameraPosition.z);
    this.xrPanelAnchored = true;
  }

  private anchorXrChromaPanelInFrontOfUser(): void {
    if (this.role !== "teacher" || !this.xrChromaPanel.visible) {
      return;
    }

    const xrCamera = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    xrCamera.updateMatrixWorld();

    const cameraPosition = new THREE.Vector3();
    const cameraQuaternion = new THREE.Quaternion();
    xrCamera.getWorldPosition(cameraPosition);
    xrCamera.getWorldQuaternion(cameraQuaternion);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cameraQuaternion);
    forward.y = 0;
    if (forward.lengthSq() < 0.01) {
      forward.set(0, 0, -1);
    }
    forward.normalize();

    this.xrChromaPanel.position.copy(cameraPosition).addScaledVector(forward, XR_CHROMA_PANEL_DISTANCE);
    this.xrChromaPanel.position.y = Math.max(1.12, cameraPosition.y - 0.05);
    this.xrChromaPanel.lookAt(cameraPosition.x, this.xrChromaPanel.position.y, cameraPosition.z);
    this.xrChromaPanelAnchored = true;
  }

  private flashXrButton(action: XrButtonAction): void {
    const material = this.xrButtonMaterials.get(action);
    if (!material) {
      return;
    }

    material.color.set(0xfacc15);
    window.setTimeout(() => {
      material.color.set(0xffffff);
    }, 160);
  }

  private updateRightControllerMenuToggle(): void {
    const session = this.renderer.xr.getSession();
    if (!session || !this.role) {
      this.rightBWasPressed = false;
      return;
    }

    const rightSource = Array.from(session.inputSources).find((source) => source.handedness === "right" && source.gamepad);
    const button = rightSource?.gamepad?.buttons[RIGHT_CONTROLLER_B_BUTTON_INDEX];
    const isPressed = Boolean(button?.pressed);
    if (isPressed && !this.rightBWasPressed) {
      this.xrMenuVisible = !this.xrMenuVisible;
      this.xrControlPanel.visible = this.xrMenuVisible;
      if (this.xrMenuVisible) {
        this.xrPanelAnchored = false;
        this.anchorXrPanelInFrontOfUser();
      } else {
        this.xrPanelAnchored = false;
      }
    }
    this.rightBWasPressed = isPressed;
  }

  private updateRightThumbstickTeleport(): void {
    const session = this.renderer.xr.getSession();
    if (!session || this.mode !== "vr" || !this.renderer.xr.isPresenting || this.grabbedModelController) {
      this.rightThumbstickWasActive = false;
      this.rightThumbstickTurnWasActive = false;
      this.teleportDebugState.rightControllerDetected = Boolean(this.findRightController());
      this.teleportDebugState.thumbstickX = 0;
      this.teleportDebugState.thumbstickY = 0;
      if (!session) {
        this.teleportDebugState.lastAttemptReason = "no session";
      }
      return;
    }

    const rightController = this.findRightController();
    this.teleportDebugState.rightControllerDetected = Boolean(rightController);
    const thumbstick = this.getRightThumbstickAxes();
    if (!thumbstick) {
      this.rightThumbstickWasActive = false;
      this.teleportDebugState.thumbstickX = 0;
      this.teleportDebugState.thumbstickY = 0;
      this.teleportDebugState.lastAttemptReason = rightController ? "no thumbstick axes" : "no right controller";
      return;
    }

    const { x, y } = thumbstick;
    this.teleportDebugState.thumbstickX = x;
    this.teleportDebugState.thumbstickY = y;
    const turnIntent = Math.abs(x) > TURN_DEADZONE && Math.abs(x) > Math.abs(y);
    if (turnIntent && !this.rightThumbstickTurnWasActive) {
      this.userRig.rotation.y -= Math.sign(x) * XR_SNAP_TURN_ANGLE;
      this.desktopYaw = this.userRig.rotation.y;
      this.teleportDebugState.lastAttemptReason = x > 0 ? "snap turn right" : "snap turn left";
    }
    this.rightThumbstickTurnWasActive = turnIntent;

    const forwardTeleport = y < -THUMBSTICK_DEADZONE && Math.abs(y) >= Math.abs(x);
    if (!forwardTeleport) {
      this.teleportAimConsumed = false;
    }
    this.rightThumbstickWasActive = this.canUseTeleport() && forwardTeleport;
    if (forwardTeleport && this.teleportAimConsumed) {
      this.teleportDebugState.lastAttemptReason = "await thumbstick release";
      return;
    }
    if (forwardTeleport && !this.teleportAimConsumed) {
      this.teleportDebugState.lastAttemptReason = "aim and press trigger";
      return;
    }
    if (!forwardTeleport && !turnIntent && this.canUseTeleport()) {
      this.teleportDebugState.lastAttemptReason = "teleport armed";
    }
  }

  private resize = (): void => {
    const bounds = this.options.container.getBoundingClientRect();
    const width = Math.floor(bounds.width || this.options.container.clientWidth);
    const height = Math.floor(bounds.height || this.options.container.clientHeight);
    if (width < 2 || height < 2) {
      return;
    }

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private render = (): void => {
    const delta = Math.min(0.05, this.clock.getDelta());
    this.frameDelta = delta;
    const elapsed = this.clock.getElapsedTime();
    for (const marker of this.markers.keys()) {
      marker.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.08);
    }
    if (this.chromaMarker) {
      this.chromaMarker.scale.setScalar(1 + Math.sin(elapsed * 5.2) * 0.1);
    }
    if (this.modelStateMarker) {
      this.modelStateMarker.scale.setScalar(1 + Math.sin(elapsed * 4.7) * 0.1);
    }
    if (this.modelMixer) {
      this.modelMixer.update(delta);
    }
    for (const mixer of this.propMixers) {
      mixer.update(delta);
    }
    this.updateObjectStateLabelsFacing();
    this.updateRemoteParticipantLabelsFacing();
    this.updateDesktopControls(delta);
    this.updateTabletExploreControls(delta);
    this.updateTeleportPreview();
    this.updateControllerRayVisibility();
    this.updateRightControllerMenuToggle();
    this.updateRightThumbstickTeleport();
    this.updateGrabbedModelPosition();
    this.updateGrabbedChromaPosition();
    this.updateGrabbedMarkerPosition();
    this.updateTeleportDebugPanel();
    if (this.renderer.xr.isPresenting && this.role && this.xrMenuVisible && !this.xrPanelAnchored) {
      this.anchorXrPanelInFrontOfUser();
    }
    if (this.renderer.xr.isPresenting && this.xrChromaPanel.visible && !this.xrChromaPanelAnchored) {
      this.anchorXrChromaPanelInFrontOfUser();
    }
    this.updateIntroBillboardFacing();
    this.updateChromaBillboardFacing();
    this.maybeSyncParticipantPresence();
    this.renderer.render(this.scene, this.camera);
  };

  private updateDesktopControls(delta: number): void {
    if (this.renderer.xr.isPresenting || !this.role) {
      return;
    }

    const turnDirection = Number(this.pressedKeys.has("arrowleft")) - Number(this.pressedKeys.has("arrowright"));
    if (turnDirection !== 0) {
      this.desktopYaw += turnDirection * DESKTOP_TURN_SPEED * delta;
      this.applyDesktopLook();
    }

    const forwardInput =
      Number(this.pressedKeys.has("w") || this.pressedKeys.has("arrowup")) -
      Number(this.pressedKeys.has("s") || this.pressedKeys.has("arrowdown"));
    const strafeInput = Number(this.pressedKeys.has("d")) - Number(this.pressedKeys.has("a"));
    if (forwardInput === 0 && strafeInput === 0) {
      return;
    }

    const speed = DESKTOP_MOVE_SPEED * (this.pressedKeys.has("shift") ? DESKTOP_RUN_MULTIPLIER : 1);
    const cameraWorldDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraWorldDirection);
    const forward = cameraWorldDirection.setY(0);
    if (forward.lengthSq() < 0.001) {
      forward.set(Math.sin(this.desktopYaw), 0, -Math.cos(this.desktopYaw));
    }
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3()
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, strafeInput);
    if (move.lengthSq() > 0.001) {
      move.normalize().multiplyScalar(speed * delta);
      this.moveUserRigWithCollision(move);
    }
  }

  private updateTabletExploreControls(delta: number): void {
    if (!this.isTabletExploreMode() || this.renderer.xr.isPresenting || !this.role) {
      this.tabletJoystickCurrent.lerp(new THREE.Vector2(0, 0), TABLET_JOYSTICK_EASING);
      return;
    }

    this.tabletJoystickCurrent.lerp(this.tabletJoystickTarget, TABLET_JOYSTICK_EASING);
    if (this.tabletJoystickCurrent.lengthSq() < 0.0001) {
      return;
    }

    const cameraWorldDirection = new THREE.Vector3();
    this.camera.getWorldDirection(cameraWorldDirection);
    const forward = cameraWorldDirection.setY(0);
    if (forward.lengthSq() < 0.001) {
      forward.set(Math.sin(this.desktopYaw), 0, -Math.cos(this.desktopYaw));
    }
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const move = new THREE.Vector3()
      .addScaledVector(right, this.tabletJoystickCurrent.x)
      .addScaledVector(forward, -this.tabletJoystickCurrent.y);
    if (move.lengthSq() > 0.001) {
      move.normalize().multiplyScalar(TABLET_MOVE_SPEED * delta * Math.min(1, this.tabletJoystickCurrent.length()));
      this.moveUserRigWithCollision(move);
    }
  }

  private moveUserRigWithCollision(move: THREE.Vector3): void {
    const xMove = new THREE.Vector3(move.x, 0, 0);
    if (this.canMoveBy(xMove)) {
      this.userRig.position.add(xMove);
    }

    const zMove = new THREE.Vector3(0, 0, move.z);
    if (this.canMoveBy(zMove)) {
      this.userRig.position.add(zMove);
    }
  }

  private canMoveBy(move: THREE.Vector3): boolean {
    if (move.lengthSq() < 0.000001) {
      return true;
    }

    if (this.role === "teacher" && !this.renderer.xr.isPresenting) {
      return true;
    }

    if (this.mode === "vr" && !this.renderer.xr.isPresenting) {
      return true;
    }

    const target = this.userRig.position.clone().add(move);
    if (this.navigationBounds) {
      const insetBounds = this.navigationBounds.clone().expandByScalar(-PLAYER_COLLISION_RADIUS);
      if (
        target.x < insetBounds.min.x ||
        target.x > insetBounds.max.x ||
        target.z < insetBounds.min.z ||
        target.z > insetBounds.max.z
      ) {
        return false;
      }
    }

    if (this.collisionObjects.length === 0) {
      return true;
    }

    const direction = move.clone().normalize();
    const side = new THREE.Vector3(-direction.z, 0, direction.x);
    const rayOrigins: THREE.Vector3[] = [];
    for (const height of PLAYER_COLLISION_HEIGHTS) {
      const base = this.userRig.position.clone();
      base.y += height;
      rayOrigins.push(base, base.clone().addScaledVector(side, PLAYER_COLLISION_RADIUS), base.clone().addScaledVector(side, -PLAYER_COLLISION_RADIUS));
    }

    for (const origin of rayOrigins) {
      this.raycaster.set(origin, direction);
      this.raycaster.far = move.length() + PLAYER_COLLISION_RADIUS;
      const hit = this.raycaster.intersectObjects(this.collisionObjects, false)[0];
      this.raycaster.far = Infinity;
      if (hit) {
        return false;
      }
    }

    return true;
  }

  private applyDesktopLook(): void {
    this.userRig.rotation.y = this.desktopYaw;
    this.camera.rotation.x = this.desktopPitch;
  }

  private isDesktopControlKey(key: string): boolean {
    return ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key);
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable;
  }

  private canUseTeleport(): boolean {
    return this.mode === "vr" && this.renderer.xr.isPresenting;
  }

  private updateTeleportPreview(): void {
    const forwardTeleport = this.isTeleportAimActive();
    if (!this.canUseTeleport() || this.grabbedModelController || !forwardTeleport) {
      this.hideTeleportPreview();
      return;
    }

    const controller = this.findRightController();
    if (!controller) {
      this.teleportDebugState.rightControllerDetected = false;
      this.teleportDebugState.lastAttemptReason = "no right controller";
      this.hideTeleportPreview();
      return;
    }

    this.teleportPreviewController = controller;
    this.teleportDebugState.rightControllerDetected = true;
    controller.updateMatrixWorld();
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const velocity = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion()))
      .multiplyScalar(TELEPORT_ARC_SPEED);
    const gravity = new THREE.Vector3(0, TELEPORT_ARC_GRAVITY, 0);
    const points: THREE.Vector3[] = [origin.clone()];
    const previousStableTarget = this.lastStableTeleportTargetPoint?.clone();
    const previousStableValid = this.lastStableTeleportTargetValid;
    this.teleportTargetPoint = undefined;
    this.teleportTargetValid = false;
    this.teleportDebugState.targetFound = false;
    this.teleportDebugState.targetValid = false;
    this.teleportDebugState.targetPoint = undefined;
    let blockedBySurface = false;

    let previous = origin.clone();
    for (let index = 1; index < TELEPORT_ARC_SEGMENTS; index += 1) {
      const time = index * TELEPORT_ARC_STEP_SECONDS;
      const next = origin
        .clone()
        .addScaledVector(velocity, time)
        .addScaledVector(gravity, 0.5 * time * time);
      const segment = next.clone().sub(previous);
      const segmentLength = segment.length();

      if (segmentLength > 0.001) {
        const resolution = this.resolveTeleportSegment(previous, next);
        if (resolution.targetPoint) {
          const targetPoint = resolution.targetPoint;
          points.push(targetPoint.clone());
          this.teleportTargetPoint = targetPoint;
          this.teleportTargetValid = this.canTeleportToPoint(targetPoint);
          this.teleportDebugState.targetFound = true;
          this.teleportDebugState.targetValid = this.teleportTargetValid;
          this.teleportDebugState.targetPoint = targetPoint.clone();
          break;
        }

        if (resolution.blockedPoint) {
          points.push(resolution.blockedPoint.clone());
          this.teleportDebugState.lastAttemptReason = resolution.blockedReason ?? "blocked by wall";
          blockedBySurface = true;
          break;
        }
      }

      points.push(next);
      previous = next;
    }

    this.teleportArc.geometry.setFromPoints(points);
    this.teleportArc.visible = true;
    if (!this.teleportTargetPoint && previousStableTarget && !blockedBySurface) {
      this.teleportTargetPoint = previousStableTarget;
      this.teleportTargetValid = previousStableValid;
      this.teleportDebugState.targetFound = true;
      this.teleportDebugState.targetValid = previousStableValid;
      this.teleportDebugState.targetPoint = previousStableTarget.clone();
      this.teleportDebugState.lastAttemptReason = "reused stable target";
    }
    this.teleportTarget.visible = Boolean(this.teleportTargetPoint);
    if (this.teleportTargetPoint) {
      this.lastStableTeleportTargetPoint = this.teleportTargetPoint.clone();
      this.lastStableTeleportTargetValid = this.teleportTargetValid;
      this.teleportTarget.position.copy(this.teleportTargetPoint);
      this.teleportTarget.position.y += 0.08;
      (this.teleportTarget.material as THREE.MeshBasicMaterial).color.set(this.teleportTargetValid ? 0x22c55e : 0xef4444);
    } else {
      this.lastStableTeleportTargetPoint = undefined;
      this.lastStableTeleportTargetValid = false;
      this.teleportDebugState.lastAttemptReason = "no floor hit";
    }
  }

  private hideTeleportPreview(): void {
    this.teleportArc.visible = false;
    this.teleportTarget.visible = false;
    this.teleportTargetPoint = undefined;
    this.teleportTargetValid = false;
    this.lastStableTeleportTargetPoint = undefined;
    this.lastStableTeleportTargetValid = false;
    this.teleportDebugState.targetFound = false;
    this.teleportDebugState.targetValid = false;
    this.teleportDebugState.targetPoint = undefined;
  }

  private updateControllerRayVisibility(): void {
    const teleportAiming = this.isTeleportAimActive();

    for (const [controller, ray] of this.controllerRays) {
      ray.visible = !(teleportAiming && this.isRightController(controller));
    }
  }

  private isTeleportAimActive(): boolean {
    if (!this.canUseTeleport() || this.grabbedModelController || this.teleportAimConsumed) {
      return false;
    }

    const thumbstick = this.getRightThumbstickAxes();
    return Boolean(thumbstick && thumbstick.y < -THUMBSTICK_DEADZONE && Math.abs(thumbstick.y) >= Math.abs(thumbstick.x));
  }

  private findRightController(): THREE.Object3D | undefined {
    for (const [controller, source] of this.controllerInputSources) {
      if (source.handedness === "right") {
        return controller;
      }
    }

    if (this.teleportPreviewController) {
      return this.teleportPreviewController;
    }

    return undefined;
  }

  private getRightController(): THREE.Object3D {
    return this.findRightController() ?? this.renderer.xr.getController(1);
  }

  private getRightThumbstickAxes(): ThumbstickAxes | undefined {
    const source = this.getInputSourceForController(this.getRightController())
      ?? Array.from(this.controllerInputSources.values()).find((inputSource) => inputSource.handedness === "right" && inputSource.gamepad);
    const axes = source?.gamepad?.axes;
    if (!axes || axes.length < 2) {
      return undefined;
    }

    if (axes.length >= 4) {
      return { x: axes[2] ?? 0, y: axes[3] ?? 0 };
    }

    return { x: axes[0] ?? 0, y: axes[1] ?? 0 };
  }

  private getTeleportPointForController(controller: THREE.Object3D): THREE.Vector3 | undefined {
    if (!this.canUseTeleport() || this.grabbedModelController) {
      return undefined;
    }

    if (controller === this.teleportPreviewController && this.teleportTargetPoint && this.teleportTargetValid) {
      return this.teleportTargetPoint.clone();
    }

    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.updateMatrixWorld();
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    return this.resolveTeleportRay(origin, direction, 100).targetPoint;
  }

  private resolveTeleportSegment(start: THREE.Vector3, end: THREE.Vector3): TeleportResolution {
    const segment = end.clone().sub(start);
    const segmentLength = segment.length();
    if (segmentLength <= 0.001) {
      return {};
    }

    const sceneHit = this.findNearestTeleportSceneHit(start, segment, segmentLength);
    const floorHit = this.getFloorPointOnSegment(start, end);
    const sceneDistance = sceneHit ? start.distanceTo(sceneHit.point) : Infinity;
    const floorDistance = floorHit ? start.distanceTo(floorHit) : Infinity;

    if (sceneHit && this.isWalkableTeleportSurface(sceneHit) && sceneDistance <= floorDistance) {
      const targetPoint = this.getTeleportTargetPointFromHit(sceneHit);
      return {
        targetPoint: this.canTeleportToPoint(targetPoint) ? targetPoint : undefined,
        blockedReason: "invalid target"
      };
    }

    if (floorHit && floorDistance <= sceneDistance) {
      const targetPoint = this.getTeleportTargetPointFromHit(floorHit);
      return {
        targetPoint: this.canTeleportToPoint(targetPoint) ? targetPoint : undefined,
        blockedReason: "invalid target"
      };
    }

    if (sceneHit) {
      return {
        blockedPoint: sceneHit.point.clone(),
        blockedReason: this.isWalkableTeleportSurface(sceneHit) ? "invalid target" : "blocked by wall"
      };
    }

    return {};
  }

  private resolveTeleportRay(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): TeleportResolution {
    const sceneHit = this.findNearestTeleportSceneHit(origin, direction, maxDistance);
    const floorHit = this.getFloorPointAlongRay(origin, direction);
    const sceneDistance = sceneHit ? origin.distanceTo(sceneHit.point) : Infinity;
    const floorDistance = floorHit ? origin.distanceTo(floorHit) : Infinity;

    if (sceneHit && this.isWalkableTeleportSurface(sceneHit) && sceneDistance <= floorDistance) {
      const targetPoint = this.getTeleportTargetPointFromHit(sceneHit);
      return { targetPoint: this.canTeleportToPoint(targetPoint) ? targetPoint : undefined };
    }

    if (floorHit && floorDistance <= sceneDistance) {
      const targetPoint = this.getTeleportTargetPointFromHit(floorHit);
      return { targetPoint: this.canTeleportToPoint(targetPoint) ? targetPoint : undefined };
    }

    if (sceneHit) {
      return {
        blockedPoint: sceneHit.point.clone(),
        blockedReason: this.isWalkableTeleportSurface(sceneHit) ? "invalid target" : "blocked by wall"
      };
    }

    return {};
  }

  private findNearestTeleportSceneHit(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): THREE.Intersection | undefined {
    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.collisionObjects, false);
    this.raycaster.far = Infinity;
    return hits.find((hit) => this.isTeleportHitCandidate(hit));
  }

  private findTeleportBlocker(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): THREE.Intersection | undefined {
    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.collisionObjects, false);
    this.raycaster.far = Infinity;
    return hits.find((hit) => this.isTeleportHitCandidate(hit) && !this.isWalkableTeleportSurface(hit));
  }

  private findWalkableSurfaceHit(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): THREE.Intersection | undefined {
    this.raycaster.set(origin, direction.clone().normalize());
    this.raycaster.far = maxDistance;
    const hits = this.raycaster.intersectObjects(this.collisionObjects, false);
    this.raycaster.far = Infinity;
    return hits.find((hit) => this.isTeleportHitCandidate(hit) && this.isWalkableTeleportSurface(hit));
  }

  private isTeleportHitCandidate(hit: THREE.Intersection): boolean {
    if (!hit.object.visible) {
      return false;
    }

    if (this.modelRoot && (hit.object === this.modelRoot || this.modelRoot.children.includes(hit.object) || this.modelRoot.getObjectById(hit.object.id))) {
      return false;
    }

    return true;
  }

  private getFloorPointOnSegment(start: THREE.Vector3, end: THREE.Vector3): THREE.Vector3 | undefined {
    return this.teleportFloorPlane.intersectLine(new THREE.Line3(start, end), new THREE.Vector3()) ?? undefined;
  }

  private getFloorPointAlongRay(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | undefined {
    return this.raycaster.ray.set(origin, direction).intersectPlane(this.teleportFloorPlane, new THREE.Vector3()) ?? undefined;
  }

  private isWalkableTeleportSurface(hit: THREE.Intersection): boolean {
    if (!hit.face || !(hit.object instanceof THREE.Mesh)) {
      return false;
    }

    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
    return worldNormal.y >= 0.7;
  }

  private getTeleportTargetPointFromHit(hit: THREE.Intersection | THREE.Vector3): THREE.Vector3 {
    return hit instanceof THREE.Vector3 ? hit.clone() : hit.point.clone();
  }

  private canTeleportToPoint(point: THREE.Vector3): boolean {
    return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
  }

  private fitModelToDisplaySize(root: THREE.Object3D, configuredScale: number, displaySize: number): number {
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const largestAxis = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(largestAxis) || largestAxis <= 0) {
      return configuredScale;
    }

    const normalizedScale = configuredScale * (displaySize / largestAxis);
    root.scale.setScalar(normalizedScale);

    root.updateMatrixWorld(true);
    const fittedBounds = new THREE.Box3().setFromObject(root);
    const center = fittedBounds.getCenter(new THREE.Vector3());
    root.position.x += root.position.x - center.x;
    root.position.z += root.position.z - center.z;
    root.position.y += 0.92 - fittedBounds.min.y;
    return normalizedScale;
  }

  private createChromaKeyMaterial(texture: THREE.VideoTexture, settings = DEFAULT_CHROMA_KEY_SETTINGS): THREE.ShaderMaterial {
    const chromaSettings = normalizeChromaKeySettings(settings);
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        keyColor: { value: new THREE.Color(0x00ff00) },
        similarity: { value: chromaSettings.similarity },
        smoothness: { value: chromaSettings.smoothness },
        spill: { value: chromaSettings.spill },
        opacity: { value: chromaSettings.opacity },
        brightness: { value: chromaSettings.brightness },
        contrast: { value: chromaSettings.contrast }
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform vec3 keyColor;
        uniform float similarity;
        uniform float smoothness;
        uniform float spill;
        uniform float opacity;
        uniform float brightness;
        uniform float contrast;
        varying vec2 vUv;

        void main() {
          vec4 videoColor = texture2D(map, vUv);
          vec3 color = videoColor.rgb;
          float distanceToKey = distance(color, keyColor);
          float alpha = smoothstep(similarity, similarity + smoothness, distanceToKey) * opacity;
          float greenExcess = max(0.0, color.g - max(color.r, color.b));
          color.g -= greenExcess * spill;
          color = (color - 0.5) * contrast + 0.5;
          color *= brightness;
          gl_FragColor = vec4(clamp(color, 0.0, 1.0), alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }
}
