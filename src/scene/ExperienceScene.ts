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
  normalizeVideoPrepState,
  normalizeVideoPrepStates,
  type ChromaBillboardState,
  type ChromaKeySettings,
  type ChromaPlaybackMode,
  type ClientCommand,
  type ObjectMarkerState,
  type ObjectMarkerStates,
  type PartMarkerStates,
  type Participant,
  type ParticipantDeviceKind,
  type ParticipantPresence,
  type PresenceJoint,
  type Role,
  type SceneObjectId,
  type Vector3Tuple,
  type VideoPrepState,
  type VideoPrepStates
} from "../net/protocol";

interface SceneOptions {
  container: HTMLElement;
  onMarkerSelected: (part: ExperiencePartConfig) => void;
  onChromaMarkerSelected: () => void;
  onTeacherCommand: (command: ClientCommand) => void;
  onAnimationStep: (direction: -1 | 1) => void;
  onScaleStep: (direction: -1 | 1) => void;
  onObjectScaleChange: (scale: number) => void;
  onModelPositionChange: (position: Vector3Tuple, options?: { force?: boolean }) => void;
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

interface ControllerThumbstickInput {
  source: XRInputSource;
  controller?: THREE.Object3D;
  axes: ThumbstickAxes;
  magnitude: number;
}

interface ControllerButtonInput {
  source?: XRInputSource;
  controller?: THREE.Object3D;
  pressed: boolean;
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
  leftController: THREE.Group;
  rightController: THREE.Group;
  label: THREE.Mesh;
  labelText: string;
  deviceKind: ParticipantDeviceKind;
}

interface PartVideoPreview {
  mesh: THREE.Mesh;
  video: HTMLVideoElement;
  texture: THREE.VideoTexture;
  material: THREE.ShaderMaterial;
}

interface PartVideoPlaybackOptions {
  autoPlay?: boolean;
  muted?: boolean;
}

type PlacementAssetId =
  | "cessna-video"
  | "boeing-video"
  | "turbine-video"
  | "turbine-model"
  | "student-spawn";

interface PlacementMenuItem {
  id: PlacementAssetId;
  label: string;
  partId?: string;
}

interface StudentSpawnAnchor {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  right: THREE.Vector3;
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
const RIGHT_CONTROLLER_A_BUTTON_INDEX = 4;
const RIGHT_CONTROLLER_B_BUTTON_INDEX = 5;
const THUMBSTICK_DEADZONE = 0.7;
const TURN_DEADZONE = 0.65;
const TELEPORT_ARC_SEGMENTS = 56;
const TELEPORT_ARC_STEP_SECONDS = 0.05;
const TELEPORT_ARC_SPEED = 8.2;
const TELEPORT_ARC_GRAVITY = -7.5;
const DESKTOP_MOVE_SPEED = 2.2;
const DESKTOP_RUN_MULTIPLIER = 3.6;
const DESKTOP_TURN_SPEED = 1.8;
const DESKTOP_LOOK_SENSITIVITY = 0.003;
const DESKTOP_MAX_PITCH = Math.PI / 2 - 0.08;
const DESKTOP_INSPECT_MOUSE_PIVOT_DISTANCE = 2.8;
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
const CHROMA_DANCER_VIDEO_URL = "/assets/chroma/turbine-mechanic-green-screen.mp4";
const PARTICIPANT_HEADSET_ASSET_URL = "/assets/avatars/vr-hmd/vr-hmd.glb";
const PARTICIPANT_HEADSET_TARGET_SIZE = 0.42;
const SCENE_TONE_MAPPING_EXPOSURE = 0.145;
const XR_FRAMEBUFFER_SCALE_FACTOR = 1;
const MAX_PIXEL_RATIO = 1.5;
const XR_FOVEATION = 0.45;
const TEXTURE_ANISOTROPY_LIMIT = 8;
const MATERIAL_TEXTURE_KEYS = [
  "map",
  "emissiveMap",
  "normalMap",
  "roughnessMap",
  "metalnessMap",
  "aoMap",
  "alphaMap",
  "bumpMap",
  "displacementMap",
  "lightMap"
];
const PLACEMENT_MENU_WIDTH = 1.46;
const PLACEMENT_MENU_ROW_HEIGHT = 0.18;
const PLACEMENT_MENU_HEADER_HEIGHT = 0.24;
const PLACEMENT_MENU_FOOTER_HEIGHT = 0.12;
const PLACEMENT_MENU_CANVAS_WIDTH = 900;
const PLACEMENT_MENU_CANVAS_ROW_HEIGHT = 118;
const PLACEMENT_MENU_CANVAS_HEADER_HEIGHT = 156;
const PLACEMENT_MENU_CANVAS_FOOTER_HEIGHT = 74;
const PLACEMENT_MENU_Y_OFFSET = 1.16;
const PLACEMENT_MENU_FORWARD_OFFSET = 0.08;
const PLACEMENT_TARGET_FLOOR_OFFSET = 0.045;
const PLACEMENT_LASER_MAX_DISTANCE = 100;
const PARTICIPANT_PRESENCE_SYNC_INTERVAL_MS = 100;
const REMOTE_HEAD_MIN_VISIBLE_HEIGHT = 0.45;
const REMOTE_HEAD_FROM_HAND_OFFSET = 0.55;
const REMOTE_HEAD_DEFAULT_HEIGHT = 1.55;
const REMOTE_HEAD_MAX_HAND_DISTANCE = 1.85;
const REMOTE_HEAD_MAX_HAND_VERTICAL_GAP = 1.35;
const REMOTE_CONTROLLER_FALLBACK_DOWN = 0.42;
const REMOTE_CONTROLLER_FALLBACK_FORWARD = 0.18;
const REMOTE_CONTROLLER_FALLBACK_SIDE = 0.24;
const REMOTE_PARTICIPANT_SPAWN_DISTANCE = 4;
const REMOTE_PARTICIPANT_SPAWN_SPREAD = 1.35;
const REMOTE_PARTICIPANT_SPAWN_HEAD_HEIGHT = 1.6;
const REMOTE_PARTICIPANT_SPAWN_CONTROLLER_HEIGHT = 1.08;
const REMOTE_PARTICIPANT_SPAWN_CONTROLLER_FORWARD = -0.26;
const REMOTE_PARTICIPANT_SPAWN_CONTROLLER_SIDE = 0.28;
const REMOTE_PARTICIPANT_MAX_HAND_OFFSET = 0.9;
const REMOTE_PARTICIPANT_LABEL_OFFSET = 0.5;
const KEYED_PERSON_TARGET_HEIGHT_METERS = 1.85;
const KEYED_VIDEO_SOURCE_WIDTH = 540;
const KEYED_VIDEO_SOURCE_HEIGHT = 960;
const PORTRAIT_VIDEO_HEIGHT = KEYED_PERSON_TARGET_HEIGHT_METERS;
const PORTRAIT_VIDEO_WIDTH = PORTRAIT_VIDEO_HEIGHT * (KEYED_VIDEO_SOURCE_WIDTH / KEYED_VIDEO_SOURCE_HEIGHT);
const PART_VIDEO_DEFAULT_HEIGHT = 1.6;
const PART_VIDEO_DEFAULT_WIDTH = PART_VIDEO_DEFAULT_HEIGHT * 9 / 16;
const PART_MARKER_RADIUS = 0.18;
const MIN_PLANE_GEOMETRY_SIZE = 0.001;

type ObjectRotationAxis = "yaw" | "pitch" | "roll";
type DesktopGrabTarget = "model" | "chroma";
type DesktopGrabMode = "free" | "distance";
type TouchPoint = { x: number; y: number };

function finitePositive(value: number, fallback: number): number {
  if (Number.isFinite(value) && value > 0) {
    return value;
  }
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }
  return MIN_PLANE_GEOMETRY_SIZE;
}

function createFinitePlaneGeometry(width: number, height: number, fallbackWidth = 1, fallbackHeight = fallbackWidth): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(
    finitePositive(width, fallbackWidth),
    finitePositive(height, fallbackHeight)
  );
}

export class ExperienceScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    depth: true,
    stencil: false,
    powerPreference: "high-performance"
  });
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
  private readonly placementLaser = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
    new THREE.LineBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.94,
      depthTest: false,
      depthWrite: false
    })
  );
  private readonly placementTarget = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.27, 48),
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      transparent: true,
      opacity: 0.96,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  private readonly placementMenu = new THREE.Group();
  private readonly placementButtons = new Map<THREE.Object3D, PlacementAssetId>();
  private placementMenuSurface?: THREE.Mesh;
  private placementMenuTexture?: THREE.CanvasTexture;
  private placementTargetPoint?: THREE.Vector3;
  private placementMenuTargetPoint?: THREE.Vector3;
  private placementPointerActive = false;
  private placementPointerId?: number;
  private placementPointerController?: THREE.Object3D;
  private studentSpawnAnchor?: StudentSpawnAnchor;
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
  private modelTransformLocked = false;
  private introBillboard?: THREE.Mesh;
  private introVideo?: HTMLVideoElement;
  private introTexture?: THREE.VideoTexture;
  private introMaterial?: THREE.ShaderMaterial;
  private partVideoBillboard?: THREE.Mesh;
  private partVideo?: HTMLVideoElement;
  private partVideoTexture?: THREE.VideoTexture;
  private partVideoMaterial?: THREE.ShaderMaterial;
  private activePartVideoPartId?: string;
  private readonly partVideoPreviews = new Map<string, PartVideoPreview>();
  private readonly partVideoSettings = new Map<string, ChromaKeySettings>();
  private readonly videoPrepStates = new Map<string, VideoPrepState>();
  private readonly videoPlaybackRevisions = new Map<string, number>();
  private readonly videoPlaybackPausedStates = new Map<string, boolean>();
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
  private partMarkerStates: PartMarkerStates = {};
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
  private readonly desktopGrabOffset = new THREE.Vector3();
  private readonly grabbedModelOffset = new THREE.Vector3();
  private readonly grabbedChromaOffset = new THREE.Vector3();
  private readonly grabbedMarkerOffset = new THREE.Vector3();
  private desktopYaw = 0;
  private desktopPitch = 0;
  private grabbedModelDistance = 1.6;
  private lastScaleSync = 0;
  private lastPositionSync = 0;
  private lastChromaTransformSync = 0;
  private readonly markersByPartId = new Map<string, THREE.Mesh>();
  private desktopGrabMarkerPartId?: string;
  private selectedPartMarkerId?: string;
  private grabbedMarkerController?: THREE.Object3D;
  private grabbedMarkerPartId?: string;
  private grabbedMarkerDistance = 1.6;
  private lastMarkerPositionSync = 0;
  private frameDelta = 0.016;
  private loadVersion = 0;
  private currentExperience?: ExperienceConfig;
  private rightAButtonReady = false;
  private rightAWasPressed = false;
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
  private activeGamepadController?: THREE.Object3D;
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

  private container: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private statsCanvas?: HTMLCanvasElement;
  private statsTexture?: THREE.CanvasTexture;
  private statsFrames = 0;
  private statsLastUpdate = performance.now();
  private readonly hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x4c5a6a, 0.15);
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 0.15);

  constructor(private readonly options: SceneOptions) {
    this.container = options.container;
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
    }
    this.dracoLoader.setDecoderPath("/libs/draco/gltf/");
    this.loader.setDRACOLoader(this.dracoLoader);

    this.camera.position.set(0, 1.55, 2.2);
    this.camera.rotation.order = "YXZ";
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = SCENE_TONE_MAPPING_EXPOSURE;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE_FACTOR);
    this.renderer.xr.setFoveation(XR_FOVEATION);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    options.container.append(this.renderer.domElement);
    this.refreshViewport();
    this.debugCanvas.width = 512;
    this.debugCanvas.height = 256;
    this.debugTexture = new THREE.CanvasTexture(this.debugCanvas);
    this.xrDebugPanel = this.createDebugPanel();

    this.scene.add(this.hemisphereLight);
    this.keyLight.position.set(3, 5, 2);
    this.scene.add(this.keyLight);
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
    this.placementLaser.visible = false;
    this.placementLaser.renderOrder = 30;
    this.placementTarget.rotation.x = -Math.PI / 2;
    this.placementTarget.visible = false;
    this.placementTarget.renderOrder = 31;
    this.placementMenu.visible = false;
    this.placementMenu.renderOrder = 32;
    this.scene.add(this.teleportArc, this.teleportTarget);
    this.scene.add(this.placementLaser, this.placementTarget, this.placementMenu);
    this.updateTeleportDebugPanel();
    if (new URLSearchParams(window.location.search).has("stats")) {
      this.createStatsPanel();
    }
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
    const lighting = experience.environment?.lighting;
    this.renderer.toneMappingExposure = lighting?.toneMappingExposure ?? SCENE_TONE_MAPPING_EXPOSURE;
    this.hemisphereLight.intensity = lighting?.hemisphereIntensity ?? 0.15;
    this.keyLight.intensity = lighting?.directionalIntensity ?? 0.15;
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
          this.removeZeroScaleNodes(gltf.scene);
          this.applyEnvironmentTransform(gltf.scene, experience.environment);
          this.applyEnvironmentBrightness(gltf.scene, experience.environment?.brightness ?? 1);
          this.applyTextureQuality(gltf.scene);
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
    this.initializeVideoPrepStates(experience.parts);
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
    this.syncModeWithXrSession(mode);
    if (this.environmentRoot) {
      this.environmentRoot.visible = !(mode === "ar" && this.currentExperience?.environment?.hideInAr);
    }
    session.addEventListener("end", () => {
      if (this.environmentRoot) {
        this.environmentRoot.visible = true;
      }
    }, { once: true });
    this.xrPanelAnchored = false;
    requestAnimationFrame(() => this.anchorXrPanelInFrontOfUser());
  }

  // A Quest reports AR support, so the teacher scene is loaded as "ar" even when the teacher enters VR.
  // Teleport and snap turn only run in "vr", so the scene mode must follow the session that was actually started.
  private syncModeWithXrSession(mode: Exclude<ExperienceMode, "fallback">): void {
    if (this.mode === mode) {
      return;
    }
    this.mode = mode;
    if (mode === "vr" && !this.environmentSkyboxTexture) {
      this.scene.background = new THREE.Color(0x182033);
    } else if (mode === "ar") {
      this.scene.background = null;
    }
    this.buildXrControlPanel();
  }

  setRole(role?: Role): void {
    this.role = role;
    this.xrMenuVisible = Boolean(role);
    this.buildXrControlPanel();
    this.xrControlPanel.visible = this.xrMenuVisible;
    if (role !== "teacher") {
      this.hideXrChromaPanel();
      this.cancelPlacementPointer();
      this.hidePlacementMenu();
    }
    this.xrPanelAnchored = false;
    this.updateChromaMarkerVisibility();
    this.updateModelStateMarkerVisibility();
    this.updateObjectStateLabels();
    this.applyObjectMarkerStates();
    this.updatePartMarkerVisibility();
    this.updatePartMarkerMaterials();
    this.updatePartVideoPreviewVisibility();
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

    const visibleParticipants = participants
      .filter((participant) => participant.id !== this.localParticipantId && Boolean(participant.presence))
      .sort((first, second) => first.connectedAt - second.connectedAt || first.id.localeCompare(second.id));
    const spawnedParticipants = visibleParticipants.filter((participant) => this.shouldUseRemoteParticipantSpawn(participant));
    const spawnIndexes = new Map(spawnedParticipants.map((participant, index) => [participant.id, index]));
    const activeIds = new Set<string>();
    for (const participant of visibleParticipants) {
      activeIds.add(participant.id);
      this.updateRemoteParticipant(participant, spawnIndexes.get(participant.id) ?? -1, spawnedParticipants.length);
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

  private shouldUseRemoteParticipantSpawn(participant: Participant): boolean {
    return this.role === "teacher" && participant.role === "student";
  }

  calibrateOrigin(): number[] {
    if (this.renderer.xr.isPresenting) {
      // Use only the floor position and the heading. Taking the full head pose would lift every object
      // by head height and tilt it with the head, because the hangar itself is not part of classroomRoot.
      const xrCamera = this.renderer.xr.getCamera();
      xrCamera.updateMatrixWorld();
      const headPosition = new THREE.Vector3();
      const headQuaternion = new THREE.Quaternion();
      xrCamera.matrixWorld.decompose(headPosition, headQuaternion, new THREE.Vector3());
      const heading = new THREE.Euler().setFromQuaternion(headQuaternion, "YXZ").y;
      this.localOrigin.compose(
        new THREE.Vector3(headPosition.x, 0, headPosition.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading),
        new THREE.Vector3(1, 1, 1)
      );
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
    if (!this.modelRoot || this.modelTransformLocked) {
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

  setModelTransformLocked(locked: boolean): void {
    this.modelTransformLocked = locked;
    if (!locked) {
      return;
    }

    if (this.desktopGrabTarget === "model") {
      this.desktopGrabActive = false;
      this.desktopGrabTarget = undefined;
      this.desktopGrabMode = "free";
    }
    this.grabbedModelController = undefined;
    this.objectRotationActive = false;
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
        const prepState = this.videoPrepStates.get(partId);
        if (prepState) {
          this.videoPrepStates.set(partId, normalizeVideoPrepState({
            ...prepState,
            position,
            height: position[1]
          }));
        }
        this.positionPartVideoPreview(partId, marker);
        if (partId === this.activePartVideoPartId) {
          this.positionPartVideoBillboard(marker);
        }
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

  setPartMarkerStates(states: PartMarkerStates): void {
    this.partMarkerStates = { ...states };
    for (const [partId, state] of Object.entries(this.partMarkerStates)) {
      const prepState = this.videoPrepStates.get(partId);
      if (prepState) {
        this.videoPrepStates.set(partId, normalizeVideoPrepState({ ...prepState, markerState: state }));
        this.applyVideoPrepState(partId, this.videoPrepStates.get(partId) as VideoPrepState);
      }
    }
    this.updatePartMarkerVisibility();
    this.updatePartMarkerMaterials();
  }

  setPartMarkerState(partId: string, state: ObjectMarkerState): void {
    const markerState = state === "orange" || state === "red" ? state : "green";
    this.partMarkerStates = {
      ...this.partMarkerStates,
      [partId]: markerState
    };
    const prepState = this.videoPrepStates.get(partId);
    if (prepState) {
      const nextState = normalizeVideoPrepState({ ...prepState, markerState });
      this.videoPrepStates.set(partId, nextState);
      this.applyVideoPrepState(partId, nextState);
    }
    this.updatePartMarkerVisibility();
    this.updatePartMarkerMaterials();
  }

  setVideoPrepStates(states: VideoPrepStates): void {
    for (const [partId, state] of Object.entries(normalizeVideoPrepStates(states))) {
      this.setVideoPrepState(partId, state);
    }
  }

  setVideoPrepState(partId: string, state: VideoPrepState): void {
    const prepState = normalizeVideoPrepState(state);
    this.videoPrepStates.set(partId, prepState);
    this.partVideoSettings.set(partId, prepState.settings);
    this.partMarkerStates = {
      ...this.partMarkerStates,
      [partId]: prepState.markerState
    };

    const marker = this.markersByPartId.get(partId);
    if (marker) {
      if (prepState.position) {
        marker.position.fromArray(prepState.position);
      } else {
        marker.position.y = prepState.height;
      }
      this.positionPartVideoPreview(partId, marker);
    }

    this.applyVideoPrepState(partId, prepState);
    this.updatePartMarkerVisibility();
    this.updatePartMarkerMaterials();
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

  playPartVideo(partId: string, fromStart = true, muted = false): boolean {
    const part = this.getPartFromId(partId);
    if (!part?.videoUrl) {
      return false;
    }

    this.showPartVideoBillboard(part, fromStart, { autoPlay: true, muted });
    return true;
  }

  setChromaSettings(settings: ChromaKeySettings): void {
    this.chromaSettings = normalizeChromaKeySettings(settings);
    this.applyChromaSettingsToMaterial();
    this.updateXrChromaPanelTexture();
  }

  setSelectedPartVideoChromaSettings(settings: ChromaKeySettings): boolean {
    if (!this.selectedPartMarkerId) {
      return false;
    }

    const chromaSettings = normalizeChromaKeySettings(settings);
    const part = this.getPartFromId(this.selectedPartMarkerId);
    const state = part
      ? this.getVideoPrepStateForPart(part)
      : normalizeVideoPrepState({
          ...this.videoPrepStates.get(this.selectedPartMarkerId),
          settings: chromaSettings
        });
    this.setVideoPrepState(this.selectedPartMarkerId, { ...state, settings: chromaSettings });
    return Boolean(part || this.partVideoPreviews.has(this.selectedPartMarkerId) || this.activePartVideoPartId === this.selectedPartMarkerId);
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

  setSelectedPartVideoScale(scale: number): boolean {
    const part = this.getPartFromId(this.selectedPartMarkerId);
    if (!part || !this.selectedPartMarkerId) {
      return false;
    }

    const clamped = normalizeChromaScale(scale);
    this.setVideoPrepState(this.selectedPartMarkerId, {
      ...this.getVideoPrepStateForPart(part),
      scale: clamped
    });
    return true;
  }

  setSelectedPartVideoHeight(height: number): boolean {
    const marker = this.selectedPartMarkerId ? this.markersByPartId.get(this.selectedPartMarkerId) : undefined;
    const part = this.getPartFromId(this.selectedPartMarkerId);
    if (!marker || !this.selectedPartMarkerId || !part) {
      return false;
    }

    marker.position.y = normalizeChromaHeight(height);
    const position = marker.position.toArray() as Vector3Tuple;
    this.setVideoPrepState(this.selectedPartMarkerId, {
      ...this.getVideoPrepStateForPart(part),
      position,
      height: position[1]
    });
    this.positionPartVideoPreview(this.selectedPartMarkerId, marker);
    if (this.activePartVideoPartId === this.selectedPartMarkerId) {
      this.positionPartVideoBillboard(marker);
    }
    this.emitPartMarkerPositionChange(this.selectedPartMarkerId, true);
    return true;
  }

  restartSelectedPartVideo(): boolean {
    const preview = this.selectedPartMarkerId ? this.partVideoPreviews.get(this.selectedPartMarkerId) : undefined;
    if (preview) {
      preview.video.currentTime = 0;
      preview.video.muted = false;
      preview.video.volume = 1;
      void preview.video.play().catch(() => undefined);
      return true;
    }

    const part = this.getPartFromId(this.selectedPartMarkerId);
    if (!part?.videoUrl) {
      return false;
    }

    if (this.activePartVideoPartId !== part.id) {
      this.showPartVideoBillboard(part, true, { autoPlay: true, muted: this.role !== "teacher" });
    } else if (this.partVideo) {
      this.partVideo.currentTime = 0;
      this.partVideo.muted = false;
      this.partVideo.volume = 1;
      void this.partVideo.play().catch(() => undefined);
    }
    return true;
  }

  playSelectedPartVideo(): boolean {
    const preview = this.selectedPartMarkerId ? this.partVideoPreviews.get(this.selectedPartMarkerId) : undefined;
    if (preview) {
      preview.video.muted = false;
      preview.video.volume = 1;
      void preview.video.play().catch(() => undefined);
      return true;
    }

    const part = this.getPartFromId(this.selectedPartMarkerId);
    if (!part?.videoUrl) {
      return false;
    }

    if (this.activePartVideoPartId !== part.id) {
      this.showPartVideoBillboard(part, false, { autoPlay: true, muted: false });
    } else if (this.partVideo) {
      this.partVideo.muted = false;
      this.partVideo.volume = 1;
      void this.partVideo.play().catch(() => undefined);
    }
    return true;
  }

  pauseSelectedPartVideo(): boolean {
    return this.pausePartVideo(this.selectedPartMarkerId);
  }

  pausePartVideo(partId: string | undefined): boolean {
    if (!partId) {
      return false;
    }

    const preview = this.partVideoPreviews.get(partId);
    if (preview) {
      preview.video.pause();
      return true;
    }

    if (this.activePartVideoPartId === partId && this.partVideo) {
      this.partVideo.pause();
      return true;
    }

    return false;
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
    const mesh = new THREE.Mesh(
      createFinitePlaneGeometry(PORTRAIT_VIDEO_WIDTH, PORTRAIT_VIDEO_HEIGHT, 1, KEYED_PERSON_TARGET_HEIGHT_METERS),
      material
    );
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

  pauseChromaBillboard(): void {
    this.chromaVideo?.pause();
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
    this.resizeObserver?.disconnect();
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
    const safeWidth = finitePositive(width, 0.28);
    const aspect = finitePositive(uiButtonAspects[action] ?? 4, 4);
    const height = Math.min(0.34, safeWidth / aspect);
    const material = textureUrl
      ? new THREE.MeshBasicMaterial({
          map: this.textureLoader.load(textureUrl),
          transparent: true,
          alphaTest: 0.01,
          depthWrite: false,
          side: THREE.DoubleSide
        })
      : this.createCanvasButtonMaterial(label);
    const labelMesh = new THREE.Mesh(createFinitePlaneGeometry(safeWidth, height, 0.28, 0.07), material);

    const hitTarget = new THREE.Mesh(
      new THREE.BoxGeometry(safeWidth + 0.06, height + 0.04, 0.08),
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
    const surface = new THREE.Mesh(
      createFinitePlaneGeometry(XR_CHROMA_PANEL_WIDTH, XR_CHROMA_PANEL_HEIGHT),
      material
    );
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

  private getPlacementMenuItems(): PlacementMenuItem[] {
    const parts = this.currentExperience?.parts ?? [];
    const findPart = (matcher: (part: ExperiencePartConfig) => boolean) => parts.find((part) => Boolean(part.videoUrl) && matcher(part));
    const cessnaPart = findPart((part) => part.id.includes("cessna") || part.label.toLowerCase().includes("cessna"));
    const boeingPart = findPart((part) => part.id.includes("boeing") || part.label.toLowerCase().includes("boeing"));
    const turbinePart = findPart((part) =>
      part.id.includes("turbofan") ||
      part.id.includes("turbine") ||
      part.label.toLowerCase().includes("turbofan") ||
      part.label.toLowerCase().includes("turbine")
    );
    const items: PlacementMenuItem[] = [];

    if (cessnaPart) {
      items.push({ id: "cessna-video", label: "Cessna Video", partId: cessnaPart.id });
    }
    if (boeingPart) {
      items.push({ id: "boeing-video", label: "Boeing Video", partId: boeingPart.id });
    }
    if (turbinePart) {
      items.push({ id: "turbine-video", label: "Turbine Video", partId: turbinePart.id });
    }
    if (this.modelRoot) {
      items.push({ id: "turbine-model", label: "Turbine" });
    }
    items.push({ id: "student-spawn", label: "Spawn point students" });
    return items;
  }

  private showPlacementMenu(targetWorldPoint: THREE.Vector3): void {
    const items = this.getPlacementMenuItems();
    if (items.length === 0) {
      return;
    }

    this.hidePlacementMenu();
    this.placementMenuTargetPoint = targetWorldPoint.clone();
    const width = PLACEMENT_MENU_WIDTH;
    const height = PLACEMENT_MENU_HEADER_HEIGHT + items.length * PLACEMENT_MENU_ROW_HEIGHT + PLACEMENT_MENU_FOOTER_HEIGHT;
    const canvasHeight = PLACEMENT_MENU_CANVAS_HEADER_HEIGHT +
      items.length * PLACEMENT_MENU_CANVAS_ROW_HEIGHT +
      PLACEMENT_MENU_CANVAS_FOOTER_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = PLACEMENT_MENU_CANVAS_WIDTH;
    canvas.height = canvasHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    this.drawPlacementMenuCanvas(context, items);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const surface = new THREE.Mesh(createFinitePlaneGeometry(width, height), material);
    surface.renderOrder = 32;
    this.placementMenu.add(surface);
    this.placementMenuSurface = surface;
    this.placementMenuTexture = texture;

    for (const [index, item] of items.entries()) {
      const button = new THREE.Mesh(
        new THREE.BoxGeometry(width - 0.16, PLACEMENT_MENU_ROW_HEIGHT * 0.78, 0.08),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false
        })
      );
      button.position.set(0, height / 2 - PLACEMENT_MENU_HEADER_HEIGHT - PLACEMENT_MENU_ROW_HEIGHT * (index + 0.5), 0.04);
      button.renderOrder = 33;
      this.placementMenu.add(button);
      this.placementButtons.set(button, item.id);
    }

    const cameraPosition = this.getActiveCameraWorldPosition();
    const menuPosition = targetWorldPoint.clone();
    menuPosition.y += PLACEMENT_MENU_Y_OFFSET;
    const towardCamera = cameraPosition.clone().sub(menuPosition).setY(0);
    if (towardCamera.lengthSq() > 0.001) {
      menuPosition.addScaledVector(towardCamera.normalize(), PLACEMENT_MENU_FORWARD_OFFSET);
    }
    const distanceToCamera = menuPosition.distanceTo(cameraPosition);
    this.placementMenu.scale.setScalar(Math.min(2.25, Math.max(1, distanceToCamera / 4.5)));
    this.placementMenu.position.copy(menuPosition);
    this.placementMenu.visible = true;
    this.updatePlacementMenuFacing();
  }

  private drawPlacementMenuCanvas(context: CanvasRenderingContext2D, items: PlacementMenuItem[]): void {
    const { width, height } = context.canvas;
    context.clearRect(0, 0, width, height);
    this.fillRoundRect(context, 0, 0, width, height, 34, "rgba(15, 23, 42, 0.95)");
    context.strokeStyle = "rgba(125, 211, 252, 0.6)";
    context.lineWidth = 4;
    this.strokeRoundRect(context, 3, 3, width - 6, height - 6, 34);

    context.fillStyle = "#f8fafc";
    context.font = "800 48px Arial";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText("Move asset here", 48, PLACEMENT_MENU_CANVAS_HEADER_HEIGHT * 0.42);
    context.fillStyle = "#bae6fd";
    context.font = "600 28px Arial";
    context.fillText("Select one item", 50, PLACEMENT_MENU_CANVAS_HEADER_HEIGHT * 0.72);

    for (const [index, item] of items.entries()) {
      const y = PLACEMENT_MENU_CANVAS_HEADER_HEIGHT + index * PLACEMENT_MENU_CANVAS_ROW_HEIGHT + 16;
      const fill = index % 2 === 0 ? "rgba(30, 41, 59, 0.94)" : "rgba(51, 65, 85, 0.9)";
      this.fillRoundRect(context, 42, y, width - 84, PLACEMENT_MENU_CANVAS_ROW_HEIGHT - 22, 20, fill);
      context.strokeStyle = "rgba(148, 163, 184, 0.28)";
      context.lineWidth = 2;
      this.strokeRoundRect(context, 42, y, width - 84, PLACEMENT_MENU_CANVAS_ROW_HEIGHT - 22, 20);
      context.fillStyle = "#f8fafc";
      context.font = item.label.length > 17 ? "800 34px Arial" : "800 39px Arial";
      context.fillText(item.label, 78, y + (PLACEMENT_MENU_CANVAS_ROW_HEIGHT - 22) / 2);
    }

    context.fillStyle = "#7dd3fc";
    context.font = "600 24px Arial";
    context.fillText("Alt + right mouse / A button sets this point", 50, height - 38);
  }

  private hidePlacementMenu(): void {
    for (const child of [...this.placementMenu.children]) {
      this.placementMenu.remove(child);
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) {
        mesh.geometry.dispose();
      }
      const material = mesh.material;
      if (Array.isArray(material)) {
        material.forEach((item) => item.dispose());
      } else if (material) {
        material.dispose();
      }
    }
    this.placementButtons.clear();
    this.placementMenuSurface = undefined;
    this.placementMenuTexture?.dispose();
    this.placementMenuTexture = undefined;
    this.placementMenuTargetPoint = undefined;
    this.placementMenu.scale.setScalar(1);
    this.placementMenu.visible = false;
  }

  private updatePlacementMenuFacing(): void {
    if (!this.placementMenu.visible) {
      return;
    }

    const cameraWorldPosition = this.getActiveCameraWorldPosition();
    const targetWorldPosition = this.placementMenu.getWorldPosition(new THREE.Vector3());
    this.placementMenu.lookAt(cameraWorldPosition.x, targetWorldPosition.y, cameraWorldPosition.z);
  }

  private getPlacementAssetFromRaycaster(): PlacementAssetId | undefined {
    if (!this.placementMenu.visible || this.placementButtons.size === 0) {
      return undefined;
    }

    const hit = this.raycaster.intersectObjects([...this.placementButtons.keys()], false)[0];
    return hit ? this.placementButtons.get(hit.object) : undefined;
  }

  private isRayBlockedByPlacementMenu(): boolean {
    return Boolean(
      this.placementMenu.visible &&
      this.placementMenuSurface &&
      this.raycaster.intersectObject(this.placementMenuSurface, false).length > 0
    );
  }

  private placeAssetAtPlacementTarget(assetId: PlacementAssetId): void {
    const targetWorldPoint = this.placementMenuTargetPoint?.clone();
    if (!targetWorldPoint) {
      return;
    }

    if (assetId === "student-spawn") {
      this.setStudentSpawnAnchor(targetWorldPoint);
      this.hidePlacementMenu();
      return;
    }

    if (assetId === "turbine-model") {
      this.placeModelAtWorldPoint(targetWorldPoint);
      this.hidePlacementMenu();
      return;
    }

    const item = this.getPlacementMenuItems().find((candidate) => candidate.id === assetId);
    if (item?.partId) {
      this.placePartVideoAtWorldPoint(item.partId, targetWorldPoint);
    }
    this.hidePlacementMenu();
  }

  private placeModelAtWorldPoint(targetWorldPoint: THREE.Vector3): void {
    if (!this.modelRoot) {
      return;
    }

    const localPoint = this.classroomRoot.worldToLocal(targetWorldPoint.clone());
    const nextPosition: Vector3Tuple = [localPoint.x, localPoint.y, localPoint.z];
    this.setModelPosition(nextPosition);
    this.options.onModelPositionChange(nextPosition, { force: true });
  }

  private placePartVideoAtWorldPoint(partId: string, targetWorldPoint: THREE.Vector3): void {
    const part = this.getPartFromId(partId);
    const marker = this.markersByPartId.get(partId);
    if (!part || !marker) {
      return;
    }

    const localPoint = this.classroomRoot.worldToLocal(targetWorldPoint.clone());
    const prepState = this.getVideoPrepStateForPart(part);
    const height = prepState.position?.[1] ?? marker.position.y ?? part.markerPosition[1];
    const nextPosition: Vector3Tuple = [localPoint.x, height, localPoint.z];
    marker.position.fromArray(nextPosition);
    this.setVideoPrepState(partId, { ...prepState, position: nextPosition, height });
    this.options.onPartMarkerPositionChange(partId, nextPosition);
  }

  private setStudentSpawnAnchor(targetWorldPoint: THREE.Vector3): void {
    const position = this.classroomRoot.worldToLocal(targetWorldPoint.clone());
    position.y = 0;
    const viewerPose = this.getRemoteParticipantViewerPose();
    const lookAt = viewerPose.position.clone();
    const forwardToTeacher = lookAt.clone().sub(position).setY(0);
    if (forwardToTeacher.lengthSq() < 0.001) {
      forwardToTeacher.copy(viewerPose.forward).multiplyScalar(-1);
    }
    forwardToTeacher.normalize();
    const right = new THREE.Vector3().crossVectors(forwardToTeacher, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 0.001) {
      right.copy(viewerPose.right);
    }
    right.normalize();

    this.studentSpawnAnchor = { position, lookAt, right };
    this.refreshStudentSpawnAnchor();
  }

  private refreshStudentSpawnAnchor(): void {
    const visuals = [...this.remoteParticipants.values()];
    for (const [index, visual] of visuals.entries()) {
      this.applyRemoteParticipantSpawn(visual, index, visuals.length);
    }
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

  private getActiveCameraWorldPosition(): THREE.Vector3 {
    const viewer = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    viewer.updateMatrixWorld(true);
    return viewer.getWorldPosition(new THREE.Vector3());
  }

  private startDesktopPlacementPointer(event: PointerEvent): void {
    this.hidePlacementMenu();
    this.hideTeleportPreview();
    this.placementPointerActive = true;
    this.placementPointerId = event.pointerId;
    this.placementPointerController = undefined;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.updatePlacementPointerFromPointerEvent(event);
  }

  private updatePlacementPointerFromPointerEvent(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.updatePlacementPointerFromRay(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  private updatePlacementPointerFromController(controller: THREE.Object3D): void {
    const origin = new THREE.Vector3();
    const direction = new THREE.Vector3(0, 0, -1);
    controller.updateMatrixWorld();
    origin.setFromMatrixPosition(controller.matrixWorld);
    direction.applyQuaternion(controller.getWorldQuaternion(new THREE.Quaternion())).normalize();
    this.updatePlacementPointerFromRay(origin, direction);
  }

  private updatePlacementPointerFromRay(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const normalizedDirection = direction.clone().normalize();
    const targetPoint = this.resolvePlacementTarget(origin, normalizedDirection);
    const start = origin.clone().addScaledVector(normalizedDirection, 0.08);
    const end = targetPoint ?? origin.clone().addScaledVector(normalizedDirection, 7);

    this.placementLaser.geometry.setFromPoints([start, end]);
    this.placementLaser.visible = true;
    this.placementTargetPoint = targetPoint?.clone();
    this.placementTarget.visible = Boolean(targetPoint);
    if (targetPoint) {
      this.placementTarget.position.copy(targetPoint);
      this.placementTarget.position.y += PLACEMENT_TARGET_FLOOR_OFFSET;
      const material = this.placementTarget.material as THREE.MeshBasicMaterial;
      material.color.set(0x7dd3fc);
    }
  }

  private resolvePlacementTarget(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | undefined {
    return this.resolveTeleportRay(origin, direction, PLACEMENT_LASER_MAX_DISTANCE).targetPoint;
  }

  private finishPlacementPointer(): void {
    const targetPoint = this.placementTargetPoint?.clone();
    this.cancelPlacementPointer();
    if (targetPoint) {
      this.showPlacementMenu(targetPoint);
    }
  }

  private cancelPlacementPointer(): void {
    this.placementPointerActive = false;
    this.placementPointerId = undefined;
    this.placementPointerController = undefined;
    this.placementTargetPoint = undefined;
    this.placementLaser.visible = false;
    this.placementTarget.visible = false;
  }

  private updateRightControllerPlacementButton(): void {
    const session = this.renderer.xr.getSession();
    if (!session || this.role !== "teacher") {
      this.rightAButtonReady = false;
      this.rightAWasPressed = false;
      if (this.placementPointerController) {
        this.cancelPlacementPointer();
      }
      return;
    }

    const button = this.getControllerButtonInput(RIGHT_CONTROLLER_A_BUTTON_INDEX);
    const isPressed = button.pressed;
    const controller = button.controller ?? this.findRightController();
    const thumbstick = this.getRightThumbstickAxes();
    const thumbstickInUse = Boolean(thumbstick && (Math.abs(thumbstick.x) > TURN_DEADZONE || Math.abs(thumbstick.y) > THUMBSTICK_DEADZONE));

    if (thumbstickInUse && this.placementPointerController) {
      this.cancelPlacementPointer();
    }

    if (!isPressed) {
      this.rightAButtonReady = true;
    }

    if (isPressed && controller && this.rightAButtonReady && !thumbstickInUse) {
      if (!this.rightAWasPressed) {
        this.hidePlacementMenu();
        this.hideTeleportPreview();
        this.placementPointerActive = true;
        this.placementPointerController = controller;
      }
      this.updatePlacementPointerFromController(controller);
    } else if (!isPressed && this.rightAWasPressed && this.placementPointerController) {
      this.finishPlacementPointer();
    }

    this.rightAWasPressed = isPressed;
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
    const panel = new THREE.Mesh(createFinitePlaneGeometry(0.72, 0.36), material);
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

  // hangar.glb contains a copy of the turbofan at scale 0: invisible, but still ~97k triangles and 3 draw calls per frame.
  private removeZeroScaleNodes(root: THREE.Object3D): void {
    const collapsed: THREE.Object3D[] = [];
    root.traverse((object) => {
      if (object !== root && (Math.abs(object.scale.x) < 1e-6 || Math.abs(object.scale.y) < 1e-6 || Math.abs(object.scale.z) < 1e-6)) {
        collapsed.push(object);
      }
    });
    for (const object of collapsed) {
      object.removeFromParent();
    }
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
          this.applyTextureQuality(root);
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
          this.applyTextureQuality(root);
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
        texture.anisotropy = Math.min(TEXTURE_ANISOTROPY_LIMIT, this.renderer.capabilities.getMaxAnisotropy());
        texture.needsUpdate = true;
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
      markerMaterial.depthTest = false;
      markerMaterial.depthWrite = false;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(PART_MARKER_RADIUS, 24, 24),
        markerMaterial
      );
      marker.position.fromArray(part.markerPosition);
      marker.visible = false;
      marker.renderOrder = 11;
      this.classroomRoot.add(marker);
      this.markers.set(marker, part);
      this.markersByPartId.set(part.id, marker);
      this.createPartVideoPreview(part, marker);
    }
    this.updatePartMarkerVisibility();
    this.updatePartVideoPreviewVisibility();
  }

  private initializeVideoPrepStates(parts: ExperiencePartConfig[]): void {
    for (const part of parts) {
      if (!part.videoUrl || this.videoPrepStates.has(part.id)) {
        continue;
      }
      const prepState = this.getVideoPrepStateForPart(part);
      this.videoPrepStates.set(part.id, prepState);
      this.partVideoSettings.set(part.id, prepState.settings);
      this.partMarkerStates = {
        ...this.partMarkerStates,
        [part.id]: prepState.markerState
      };
    }
    this.updatePartMarkerVisibility();
    this.updatePartMarkerMaterials();
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
    const mesh = new THREE.Mesh(createFinitePlaneGeometry(0.78, 0.2), material);
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
    this.updatePartVideoPreviewVisibility();
  }

  private shouldShowPartMarker(part: ExperiencePartConfig): boolean {
    const activationMode = this.getPartVideoActivationMode(part);
    if (activationMode === "student") {
      const state = this.partMarkerStates[part.id] ?? "green";
      if (this.role === "teacher") {
        return true;
      }
      return state === "green" && this.role === "student";
    }
    if (activationMode === "teacher") {
      const state = this.partMarkerStates[part.id] ?? "green";
      if (state === "red") {
        return false;
      }
      if (state === "orange") {
        return this.role === "teacher";
      }
      return this.role === "teacher" || this.role === "student";
    }
    return this.markersVisible;
  }

  private getPartVideoActivationMode(part: ExperiencePartConfig): ExperienceVideoActivationMode {
    return part.videoActivationMode ?? "standard";
  }

  private updatePartMarkerMaterials(): void {
    for (const [markerObject, part] of this.markers) {
      const marker = markerObject as THREE.Mesh;
      if (!(marker.material instanceof THREE.MeshStandardMaterial)) {
        continue;
      }
      const activationMode = this.getPartVideoActivationMode(part);
      if (activationMode !== "student" && activationMode !== "teacher") {
        marker.material.color.setHex(0xffc857);
        marker.material.emissive.setHex(0x7a4b00);
        continue;
      }
      const state = this.partMarkerStates[part.id] ?? "green";
      if (state === "red") {
        marker.material.color.setHex(0xef4444);
        marker.material.emissive.setHex(0x7f1d1d);
      } else if (state === "orange") {
        marker.material.color.setHex(0xf97316);
        marker.material.emissive.setHex(0x7c2d12);
      } else {
        marker.material.color.setHex(0x38bdf8);
        marker.material.emissive.setHex(0x0c4a6e);
      }
    }
  }

  private handlePartMarkerSelected(part: ExperiencePartConfig): void {
    this.selectedPartMarkerId = part.id;
    const activationMode = this.getPartVideoActivationMode(part);
    const teacherPreviewOnly = this.role === "teacher" && activationMode === "student";
    const prepState = this.getVideoPrepStateForPart(part);
    const canShowSelectedVideo = prepState.markerState !== "red" && (this.role === "teacher" || prepState.markerState === "green");
    // Teacher-controlled videos are started by the teacher's command. A student tapping the marker must not start one locally.
    const mayStartVideo = activationMode === "student" || (activationMode === "teacher" && this.role === "teacher");
    if (!teacherPreviewOnly && canShowSelectedVideo && mayStartVideo && part.videoUrl) {
      this.showPartVideoBillboard(part, true, {
        autoPlay: this.role !== "teacher",
        muted: this.role === "teacher"
      });
    }
    this.options.onMarkerSelected(part);
  }

  private createPartVideoPreview(part: ExperiencePartConfig, marker: THREE.Object3D): void {
    if (!part.videoUrl || this.getPartVideoActivationMode(part) !== "student") {
      return;
    }

    const video = document.createElement("video");
    video.src = part.videoUrl;
    video.crossOrigin = "anonymous";
    video.loop = true;
    video.muted = true;
    video.volume = 0;
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

    const prepState = this.getVideoPrepStateForPart(part);
    const material = this.createChromaKeyMaterial(texture, prepState.settings);
    material.uniforms.opacity.value = Math.min(material.uniforms.opacity.value, 0.72);
    const mesh = new THREE.Mesh(
      createFinitePlaneGeometry(PART_VIDEO_DEFAULT_WIDTH, PART_VIDEO_DEFAULT_HEIGHT),
      material
    );
    mesh.name = `Teacher preview billboard: ${part.label}`;
    mesh.scale.setScalar(prepState.scale);
    mesh.renderOrder = 6;
    this.classroomRoot.add(mesh);

    const preview = { mesh, video, texture, material };
    this.partVideoPreviews.set(part.id, preview);
    this.positionPartVideoPreview(part.id, marker);
    this.updatePartVideoPreviewVisibility();

    video.addEventListener("loadedmetadata", () => this.positionPartVideoPreview(part.id, marker), { once: true });
  }

  private positionPartVideoPreview(partId: string, marker?: THREE.Object3D): void {
    const preview = this.partVideoPreviews.get(partId);
    if (!preview) {
      return;
    }

    const source = marker ?? this.markersByPartId.get(partId);
    if (source) {
      preview.mesh.position.copy(source.position);
    }
  }

  private updatePartVideoPreviewVisibility(): void {
    for (const [partId, preview] of this.partVideoPreviews) {
      const marker = this.markersByPartId.get(partId);
      const state = this.partMarkerStates[partId] ?? "green";
      const shouldShow = this.role === "teacher" && Boolean(marker?.visible) && state !== "red";
      preview.mesh.visible = shouldShow;
      if (!shouldShow && !preview.video.paused) {
        preview.video.pause();
      }
    }
  }

  private updatePartVideoPreviewFacing(): void {
    for (const preview of this.partVideoPreviews.values()) {
      if (preview.mesh.visible) {
        this.applyUprightBillboardFacing(preview.mesh);
      }
    }
  }

  private getPartIdForPreviewMesh(mesh: THREE.Object3D): string | undefined {
    for (const [partId, preview] of this.partVideoPreviews) {
      if (preview.mesh === mesh) {
        return partId;
      }
    }
    return undefined;
  }

  private getPartFromId(partId: string | undefined): ExperiencePartConfig | undefined {
    if (!partId) {
      return undefined;
    }

    const marker = this.markersByPartId.get(partId);
    return marker ? this.markers.get(marker) : undefined;
  }

  private getVideoPrepStateForPart(part: ExperiencePartConfig): VideoPrepState {
    const existing = this.videoPrepStates.get(part.id);
    const marker = this.markersByPartId.get(part.id);
    const position = existing?.position ?? (marker ? marker.position.toArray() as Vector3Tuple : part.markerPosition);
    return normalizeVideoPrepState({
      settings: existing?.settings ?? this.partVideoSettings.get(part.id) ?? this.chromaSettings,
      position,
      scale: existing?.scale ?? 1,
      height: existing?.height ?? position[1] ?? part.markerPosition[1],
      playbackMode: existing?.playbackMode ?? (this.getPartVideoActivationMode(part) === "student" ? "once" : this.chromaPlaybackMode),
      playbackRevision: existing?.playbackRevision ?? 0,
      playbackPaused: existing?.playbackPaused ?? false,
      markerState: existing?.markerState ?? this.partMarkerStates[part.id] ?? "green"
    });
  }

  private applyVideoPrepState(partId: string, state: VideoPrepState): void {
    const prepState = normalizeVideoPrepState(state);
    const wasPausedBySharedState = this.videoPlaybackPausedStates.get(partId) === true;
    this.videoPlaybackPausedStates.set(partId, prepState.playbackPaused);
    const preview = this.partVideoPreviews.get(partId);
    if (preview) {
      this.applyChromaSettingsToShaderMaterial(preview.material, prepState.settings, 0.72);
      preview.mesh.scale.setScalar(prepState.scale);
      this.positionPartVideoPreview(partId);
      if (prepState.playbackPaused) {
        preview.video.pause();
      } else if (wasPausedBySharedState && preview.video.paused) {
        void preview.video.play().catch(() => undefined);
      }
    }

    if (this.activePartVideoPartId === partId) {
      if (this.partVideoMaterial) {
        this.applyChromaSettingsToShaderMaterial(this.partVideoMaterial, prepState.settings, prepState.settings.opacity);
      }
      if (this.partVideoBillboard) {
        this.partVideoBillboard.scale.setScalar(prepState.scale);
        this.positionPartVideoBillboard();
      }
      if (this.partVideo) {
        this.partVideo.loop = prepState.playbackMode === "loop";
        if (prepState.playbackPaused) {
          this.partVideo.pause();
        } else if (wasPausedBySharedState && this.partVideo.paused) {
          void this.partVideo.play().catch(() => undefined);
        }
      }
    }

    const part = this.getPartFromId(partId);
    if (!part || this.getPartVideoActivationMode(part) !== "teacher") {
      return;
    }

    const visibleForRole = prepState.markerState === "green" || (prepState.markerState === "orange" && this.role === "teacher");
    if (!visibleForRole) {
      if (this.activePartVideoPartId === partId) {
        this.removePartVideoBillboard();
      }
      return;
    }

    const lastRevision = this.videoPlaybackRevisions.get(partId) ?? 0;
    const shouldRestart = prepState.playbackRevision > 0 && prepState.playbackRevision !== lastRevision;
    if (shouldRestart) {
      this.videoPlaybackRevisions.set(partId, prepState.playbackRevision);
      this.showPartVideoBillboard(part, true, { autoPlay: true, muted: this.role !== "teacher" });
    }
  }

  // three.js raycasts ignore `visible`, so hidden markers and a hidden turbine would still be clickable.
  private intersectVisible(objects: THREE.Object3D[], recursive = false): THREE.Intersection[] {
    return this.raycaster.intersectObjects(objects, recursive).filter((hit) => this.isObjectVisibleInScene(hit.object));
  }

  private isObjectVisibleInScene(object: THREE.Object3D): boolean {
    for (let current: THREE.Object3D | null = object; current; current = current.parent) {
      if (!current.visible) {
        return false;
      }
    }
    return true;
  }

  private getPreviewHitFromCurrentRay(): THREE.Intersection | undefined {
    const previews = Array.from(this.partVideoPreviews.values(), (preview) => preview.mesh).filter((mesh) => mesh.visible);
    return previews.length > 0 ? this.raycaster.intersectObjects(previews, false)[0] : undefined;
  }

  private getPartFromCurrentRay(): ExperiencePartConfig | undefined {
    const markerHits = this.intersectVisible([...this.markers.keys()], false);
    if (markerHits[0]) {
      return this.markers.get(markerHits[0].object);
    }

    const previewHit = this.getPreviewHitFromCurrentRay();
    return this.getPartFromId(this.getPartIdForPreviewMesh(previewHit?.object as THREE.Object3D));
  }

  private getPartIdFromCurrentRay(): string | undefined {
    const markerHits = this.intersectVisible([...this.markersByPartId.values()], false);
    if (markerHits[0]) {
      const hitMesh = markerHits[0].object as THREE.Mesh;
      for (const [partId, mesh] of this.markersByPartId) {
        if (mesh === hitMesh) {
          return partId;
        }
      }
    }

    const previewHit = this.getPreviewHitFromCurrentRay();
    return this.getPartIdForPreviewMesh(previewHit?.object as THREE.Object3D);
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
      createFinitePlaneGeometry(9, 9),
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
      createFinitePlaneGeometry(floorSize, floorSize, 14),
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

  private applyTextureQuality(root: THREE.Object3D): void {
    const anisotropy = Math.min(TEXTURE_ANISOTROPY_LIMIT, this.renderer.capabilities.getMaxAnisotropy());
    if (anisotropy <= 1) {
      return;
    }

    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        this.applyMaterialTextureQuality(material, anisotropy);
      }
    });
  }

  private applyMaterialTextureQuality(material: THREE.Material | undefined, anisotropy: number): void {
    if (!material) {
      return;
    }

    const materialTextures = material as unknown as Record<string, THREE.Texture | null | undefined>;
    for (const key of MATERIAL_TEXTURE_KEYS) {
      const texture = materialTextures[key];
      if (!texture?.isTexture) {
        continue;
      }

      texture.anisotropy = Math.max(texture.anisotropy, anisotropy);
      texture.needsUpdate = true;
    }
  }

  private async loadParticipantHeadsetTemplate(): Promise<void> {
    if (this.participantHeadsetTemplate || this.participantHeadsetTemplatePromise) {
      return this.participantHeadsetTemplatePromise ?? Promise.resolve();
    }

    this.participantHeadsetTemplatePromise = new Promise((resolve) => {
      this.loader.load(
        PARTICIPANT_HEADSET_ASSET_URL,
        (gltf) => {
          this.applyTextureQuality(gltf.scene);
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
    this.prepareParticipantHeadsetMaterials(clone);
    clone.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(clone);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const largestAxis = Math.max(size.x, size.y, size.z);
    const scale = largestAxis > 0 ? PARTICIPANT_HEADSET_TARGET_SIZE / largestAxis : 1;
    clone.position.set(-center.x, -center.y, -center.z);

    const template = new THREE.Group();
    template.add(clone);
    template.scale.setScalar(scale);
    template.rotation.set(0, Math.PI * 1.75, Math.PI);
    return template;
  }

  private prepareParticipantHeadsetMaterials(root: THREE.Object3D): void {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      mesh.frustumCulled = false;
      mesh.renderOrder = 18;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const prepared = materials.map((material) => {
        const nextMaterial = material.clone();
        nextMaterial.side = THREE.DoubleSide;
        nextMaterial.depthTest = false;
        nextMaterial.depthWrite = false;
        if ("color" in nextMaterial && nextMaterial.color instanceof THREE.Color) {
          nextMaterial.color.lerp(new THREE.Color(0xffffff), 0.22);
        }
        if ("emissive" in nextMaterial && nextMaterial.emissive instanceof THREE.Color) {
          nextMaterial.emissive.set(0x1f2937);
          if ("emissiveIntensity" in nextMaterial && typeof nextMaterial.emissiveIntensity === "number") {
            nextMaterial.emissiveIntensity = Math.max(nextMaterial.emissiveIntensity, 0.28);
          }
        }
        return nextMaterial;
      });
      mesh.material = Array.isArray(mesh.material) ? prepared : prepared[0];
    });
  }

  private refreshRemoteParticipantHeadsets(): void {
    if (!this.participantHeadsetTemplate) {
      return;
    }

    for (const visual of this.remoteParticipants.values()) {
      visual.headAnchor.remove(visual.headModel);
      visual.headModel = this.createRemoteHeadModel(visual.deviceKind);
      visual.headAnchor.add(visual.headModel);
    }
  }

  private updateRemoteParticipant(participant: Participant, spawnIndex: number, spawnCount: number): void {
    if (!participant.presence) {
      return;
    }

    const visual = this.remoteParticipants.get(participant.id) ?? this.createRemoteParticipantVisual(participant);
    if (!this.remoteParticipants.has(participant.id)) {
      this.remoteParticipants.set(participant.id, visual);
      this.classroomRoot.add(visual.root);
    }

    const headJoint = this.getVisibleRemoteHeadJoint(participant.presence);
    const useSpawn = spawnIndex >= 0 && spawnCount > 0;
    let spawnedHeadPosition: THREE.Vector3 | undefined;
    if (useSpawn) {
      this.applyRemoteParticipantSpawn(visual, spawnIndex, spawnCount);
      spawnedHeadPosition = this.applySpawnedRemoteHead(visual.headAnchor, headJoint, visual.root);
    } else {
      visual.root.position.set(0, 0, 0);
      visual.root.quaternion.identity();
      this.applyPresenceJoint(visual.headAnchor, headJoint);
    }
    this.updateRemoteParticipantHeadModel(visual, participant);
    if (useSpawn && spawnedHeadPosition) {
      this.applySpawnedRemoteController(visual.leftController, participant.presence, "left", headJoint, spawnedHeadPosition, visual.root);
      this.applySpawnedRemoteController(visual.rightController, participant.presence, "right", headJoint, spawnedHeadPosition, visual.root);
    } else {
      this.applyPresenceToController(visual.leftController, participant.presence, "left");
      this.applyPresenceToController(visual.rightController, participant.presence, "right");
    }
    this.updateRemoteParticipantLabelText(visual, participant);
    visual.label.position.copy(visual.headAnchor.position).add(new THREE.Vector3(0, REMOTE_PARTICIPANT_LABEL_OFFSET, 0));
    visual.label.visible = true;
    visual.headModel.visible = true;
    this.applyUprightBillboardFacing(visual.label);
  }

  private createRemoteParticipantVisual(participant: Participant): RemoteParticipantVisual {
    const root = new THREE.Group();
    const headAnchor = new THREE.Group();
    root.add(headAnchor);
    const deviceKind = this.getParticipantDeviceKind(participant);
    const headModel = this.createRemoteHeadModel(deviceKind);
    headAnchor.add(headModel);

    const leftController = this.createRemoteControllerModel(0x38bdf8);
    const rightController = this.createRemoteControllerModel(0xf97316);
    root.add(leftController, rightController);

    const labelText = this.getParticipantLabelText(participant);
    const label = this.createObjectStateLabel(labelText);
    label.scale.setScalar(1.35);
    root.add(label);

    return { root, headAnchor, headModel, leftController, rightController, label, labelText, deviceKind };
  }

  private applyRemoteParticipantSpawn(visual: RemoteParticipantVisual, spawnIndex: number, spawnCount: number): void {
    if (this.studentSpawnAnchor) {
      const spreadOffset = (spawnIndex - (spawnCount - 1) / 2) * REMOTE_PARTICIPANT_SPAWN_SPREAD;
      const spawnPosition = this.studentSpawnAnchor.position
        .clone()
        .addScaledVector(this.studentSpawnAnchor.right, spreadOffset);
      spawnPosition.y = 0;
      visual.root.position.copy(spawnPosition);
      visual.root.lookAt(this.studentSpawnAnchor.lookAt.x, visual.root.position.y, this.studentSpawnAnchor.lookAt.z);
      return;
    }

    const viewerPose = this.getRemoteParticipantViewerPose();
    const spreadOffset = (spawnIndex - (spawnCount - 1) / 2) * REMOTE_PARTICIPANT_SPAWN_SPREAD;
    const spawnPosition = viewerPose.position
      .clone()
      .addScaledVector(viewerPose.forward, REMOTE_PARTICIPANT_SPAWN_DISTANCE)
      .addScaledVector(viewerPose.right, spreadOffset);
    spawnPosition.y = 0;
    visual.root.position.copy(spawnPosition);
    visual.root.lookAt(viewerPose.position.x, visual.root.position.y, viewerPose.position.z);
  }

  private getRemoteParticipantViewerPose(): { position: THREE.Vector3; forward: THREE.Vector3; right: THREE.Vector3 } {
    const viewer = this.renderer.xr.isPresenting ? this.renderer.xr.getCamera() : this.camera;
    viewer.updateMatrixWorld(true);

    const worldPosition = viewer.getWorldPosition(new THREE.Vector3());
    const worldQuaternion = viewer.getWorldQuaternion(new THREE.Quaternion());
    const origin = this.classroomRoot.worldToLocal(worldPosition.clone());
    const forwardWorld = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuaternion).setY(0);
    if (forwardWorld.lengthSq() < 0.001) {
      forwardWorld.set(0, 0, -1);
    }
    forwardWorld.normalize();
    const rightWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuaternion).setY(0);
    if (rightWorld.lengthSq() < 0.001) {
      rightWorld.crossVectors(forwardWorld, new THREE.Vector3(0, 1, 0));
    }
    rightWorld.normalize();

    const forward = this.classroomRoot.worldToLocal(worldPosition.clone().add(forwardWorld)).sub(origin).setY(0);
    const right = this.classroomRoot.worldToLocal(worldPosition.clone().add(rightWorld)).sub(origin).setY(0);
    if (forward.lengthSq() < 0.001) {
      forward.set(0, 0, -1);
    }
    if (right.lengthSq() < 0.001) {
      right.set(1, 0, 0);
    }

    return {
      position: origin,
      forward: forward.normalize(),
      right: right.normalize()
    };
  }

  private updateRemoteParticipantHeadModel(visual: RemoteParticipantVisual, participant: Participant): void {
    const deviceKind = this.getParticipantDeviceKind(participant);
    if (deviceKind === visual.deviceKind) {
      return;
    }

    visual.headAnchor.remove(visual.headModel);
    visual.headModel = this.createRemoteHeadModel(deviceKind);
    visual.deviceKind = deviceKind;
    visual.headAnchor.add(visual.headModel);
  }

  private createRemoteHeadModel(deviceKind: ParticipantDeviceKind): THREE.Group {
    const root = new THREE.Group();
    root.add(this.createParticipantDeviceMarker(deviceKind));
    if (deviceKind === "vr") {
      root.add(this.participantHeadsetTemplate?.clone(true) ?? this.createFallbackHeadsetMesh());
    } else if (deviceKind === "tablet") {
      root.add(this.createTabletParticipantModel());
    } else {
      root.add(this.createDesktopParticipantModel());
    }
    return root;
  }

  private createDesktopParticipantModel(): THREE.Group {
    const root = new THREE.Group();
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: 0x111827,
      emissiveIntensity: 0.24,
      roughness: 0.38,
      metalness: 0.12,
      depthTest: false,
      depthWrite: false
    });
    const screenMaterial = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false
    });

    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.035), frameMaterial);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.16), screenMaterial);
    frame.renderOrder = 18;
    screen.renderOrder = 19;
    screen.position.z = -0.019;
    const stand = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.025), frameMaterial.clone());
    stand.renderOrder = 18;
    stand.position.y = -0.17;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.025, 0.08), frameMaterial.clone());
    base.renderOrder = 18;
    base.position.y = -0.24;
    root.add(frame, screen, stand, base);
    return root;
  }

  private createTabletParticipantModel(): THREE.Group {
    const root = new THREE.Group();
    const shellMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: 0x1f2937,
      emissiveIntensity: 0.22,
      roughness: 0.4,
      metalness: 0.1,
      depthTest: false,
      depthWrite: false
    });
    const screenMaterial = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false
    });

    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.3, 0.026), shellMaterial);
    shell.renderOrder = 18;
    shell.rotation.z = -0.12;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.24), screenMaterial);
    screen.renderOrder = 19;
    screen.position.z = -0.014;
    screen.rotation.z = shell.rotation.z;
    root.add(shell, screen);
    return root;
  }

  private createParticipantDeviceMarker(deviceKind: ParticipantDeviceKind): THREE.Mesh {
    const color = deviceKind === "vr" ? 0x38bdf8 : deviceKind === "tablet" ? 0xf59e0b : 0x22c55e;
    const marker = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.25, 40),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.62,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide
      })
    );
    marker.position.z = -0.025;
    marker.renderOrder = 6;
    return marker;
  }

  private updateRemoteParticipantLabelText(visual: RemoteParticipantVisual, participant: Participant): void {
    const labelText = this.getParticipantLabelText(participant);
    if (labelText === visual.labelText) {
      return;
    }

    const nextLabel = this.createObjectStateLabel(labelText);
    nextLabel.scale.copy(visual.label.scale);
    nextLabel.position.copy(visual.label.position);
    nextLabel.quaternion.copy(visual.label.quaternion);
    visual.root.remove(visual.label);
    this.disposeSprite(visual.label);
    visual.label = nextLabel;
    visual.labelText = labelText;
    visual.root.add(visual.label);
  }

  private getParticipantLabelText(participant: Participant): string {
    const kind = this.getParticipantDeviceKind(participant);
    const tag = kind === "vr" ? "VR" : kind === "tablet" ? "TAB" : "PC";
    return `${participant.name} (${tag})`;
  }

  private getParticipantDeviceKind(participant: Participant): ParticipantDeviceKind {
    return participant.presence?.inVr ? "vr" : participant.deviceKind;
  }

  private createFallbackHeadsetMesh(): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.16, 0.16),
      new THREE.MeshStandardMaterial({
        color: 0x111827,
        emissive: 0x1f2937,
        emissiveIntensity: 0.32,
        roughness: 0.35,
        metalness: 0.18,
        depthTest: false,
        depthWrite: false
      })
    );
    mesh.renderOrder = 18;
    return mesh;
  }

  private createRemoteControllerModel(color: number): THREE.Group {
    const root = new THREE.Group();
    root.visible = false;

    const gripMaterial = new THREE.MeshStandardMaterial({
      color: 0x111827,
      emissive: 0x111827,
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0.1,
      depthTest: false,
      depthWrite: false
    });
    const accentMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false
    });

    const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.13, 5, 12), gripMaterial);
    grip.renderOrder = 18;
    grip.rotation.x = Math.PI / 9;
    grip.position.set(0, -0.06, 0.015);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.043, 16, 10), gripMaterial.clone());
    head.renderOrder = 18;
    head.scale.set(1.15, 0.7, 0.9);
    head.position.set(0, 0.035, -0.018);

    const trackingRing = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.006, 8, 32), accentMaterial);
    trackingRing.renderOrder = 19;
    trackingRing.rotation.x = Math.PI / 2;
    trackingRing.position.set(0, 0.055, -0.035);

    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.075, 16), accentMaterial.clone());
    pointer.renderOrder = 19;
    pointer.rotation.x = -Math.PI / 2;
    pointer.position.set(0, 0.02, -0.105);

    root.add(grip, head, trackingRing, pointer);
    return root;
  }

  private getVisibleRemoteHeadJoint(presence: ParticipantPresence): PresenceJoint {
    const handJoints = [presence.leftHand, presence.rightHand].filter((joint): joint is PresenceJoint => Boolean(joint));
    if (
      presence.inVr &&
      handJoints.length > 0 &&
      !this.isRemoteHeadPosePlausible(presence.head, handJoints)
    ) {
      return this.createHeadJointFromHands(presence, handJoints);
    }

    if (presence.head.position[1] >= REMOTE_HEAD_MIN_VISIBLE_HEIGHT) {
      return presence.head;
    }

    if (handJoints.length === 0) {
      return {
        position: [
          presence.head.position[0],
          REMOTE_HEAD_DEFAULT_HEIGHT,
          presence.head.position[2]
        ],
        quaternion: presence.head.quaternion
      };
    }

    return this.createHeadJointFromHands(presence, handJoints);
  }

  private isRemoteHeadPosePlausible(head: PresenceJoint, handJoints: PresenceJoint[]): boolean {
    const headPosition = new THREE.Vector3().fromArray(head.position);
    if (
      headPosition.y < REMOTE_HEAD_MIN_VISIBLE_HEIGHT ||
      headPosition.y > 3.2 ||
      !Number.isFinite(headPosition.lengthSq())
    ) {
      return false;
    }

    const maxHandHeight = Math.max(...handJoints.map((joint) => joint.position[1]));
    if (headPosition.y - maxHandHeight > REMOTE_HEAD_MAX_HAND_VERTICAL_GAP) {
      return false;
    }

    return handJoints.some((joint) => {
      const handPosition = new THREE.Vector3().fromArray(joint.position);
      return headPosition.distanceTo(handPosition) <= REMOTE_HEAD_MAX_HAND_DISTANCE;
    });
  }

  private createHeadJointFromHands(presence: ParticipantPresence, handJoints: PresenceJoint[]): PresenceJoint {
    const averagedHands = handJoints.reduce(
      (sum, joint) => {
        sum.x += joint.position[0];
        sum.y = Math.max(sum.y, joint.position[1]);
        sum.z += joint.position[2];
        return sum;
      },
      { x: 0, y: 0, z: 0 }
    );
    const divisor = handJoints.length;
    const fallbackY = Math.max(REMOTE_HEAD_DEFAULT_HEIGHT, averagedHands.y + REMOTE_HEAD_FROM_HAND_OFFSET);
    return {
      position: [
        averagedHands.x / divisor,
        fallbackY,
        averagedHands.z / divisor
      ],
      quaternion: presence.head.quaternion
    };
  }

  private applyPresenceToController(
    controller: THREE.Group,
    presence: ParticipantPresence,
    handedness: "left" | "right"
  ): void {
    const joint = handedness === "left" ? presence.leftHand : presence.rightHand;
    const visibleJoint = joint ?? (presence.inVr ? this.createFallbackControllerJoint(presence, handedness) : null);
    controller.visible = Boolean(visibleJoint && presence.inVr);
    this.setRemoteControllerOpacity(controller, joint ? 1 : 0.42);
    if (!visibleJoint || !presence.inVr) {
      return;
    }

    controller.position.fromArray(visibleJoint.position);
    controller.quaternion.fromArray(visibleJoint.quaternion);
  }

  private applySpawnedRemoteController(
    controller: THREE.Group,
    presence: ParticipantPresence,
    handedness: "left" | "right",
    headJoint: PresenceJoint,
    headLocalPosition: THREE.Vector3,
    root: THREE.Object3D
  ): void {
    const joint = handedness === "left" ? presence.leftHand : presence.rightHand;
    const visibleJoint = joint ?? (presence.inVr ? this.createFallbackControllerJoint(presence, handedness) : null);
    controller.visible = Boolean(visibleJoint && presence.inVr);
    this.setRemoteControllerOpacity(controller, joint ? 1 : 0.42);
    if (!visibleJoint || !presence.inVr) {
      return;
    }

    controller.position.copy(this.getSpawnedRemoteJointPosition(visibleJoint, headJoint, headLocalPosition));
    controller.quaternion.copy(this.getSpawnedRemoteJointQuaternion(visibleJoint, root));
  }

  private setRemoteControllerOpacity(controller: THREE.Object3D, opacity: number): void {
    controller.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        material.transparent = opacity < 1;
        material.opacity = opacity;
        material.depthTest = false;
        material.depthWrite = false;
      }
    });
  }

  private createFallbackControllerJoint(presence: ParticipantPresence, handedness: "left" | "right"): PresenceJoint {
    const headJoint = this.getVisibleRemoteHeadJoint(presence);
    const headPosition = new THREE.Vector3().fromArray(headJoint.position);
    const headQuaternion = new THREE.Quaternion().fromArray(headJoint.quaternion);
    const offset = new THREE.Vector3(
      handedness === "left" ? -REMOTE_CONTROLLER_FALLBACK_SIDE : REMOTE_CONTROLLER_FALLBACK_SIDE,
      -REMOTE_CONTROLLER_FALLBACK_DOWN,
      -REMOTE_CONTROLLER_FALLBACK_FORWARD
    ).applyQuaternion(headQuaternion);
    const position = headPosition.add(offset);
    return {
      position: [position.x, Math.max(0.55, position.y), position.z],
      quaternion: headJoint.quaternion
    };
  }

  private applyPresenceJoint(target: THREE.Object3D, joint: PresenceJoint): void {
    target.position.fromArray(joint.position);
    target.quaternion.fromArray(joint.quaternion);
  }

  private applySpawnedRemoteHead(target: THREE.Object3D, headJoint: PresenceJoint, root: THREE.Object3D): THREE.Vector3 {
    const headPosition = new THREE.Vector3(
      0,
      Math.min(2.15, Math.max(1.25, headJoint.position[1] || REMOTE_PARTICIPANT_SPAWN_HEAD_HEIGHT)),
      0
    );
    target.position.copy(headPosition);
    target.quaternion.copy(this.getSpawnedRemoteJointQuaternion(headJoint, root));
    return headPosition;
  }

  private getSpawnedRemoteJointPosition(
    joint: PresenceJoint,
    headJoint: PresenceJoint,
    headLocalPosition: THREE.Vector3
  ): THREE.Vector3 {
    const offset = new THREE.Vector3(
      joint.position[0] - headJoint.position[0],
      joint.position[1] - headJoint.position[1],
      joint.position[2] - headJoint.position[2]
    );
    offset.x = Math.min(REMOTE_PARTICIPANT_MAX_HAND_OFFSET, Math.max(-REMOTE_PARTICIPANT_MAX_HAND_OFFSET, offset.x));
    offset.y = Math.min(0.45, Math.max(-0.85, offset.y));
    offset.z = Math.min(REMOTE_PARTICIPANT_MAX_HAND_OFFSET, Math.max(-REMOTE_PARTICIPANT_MAX_HAND_OFFSET, offset.z));
    return headLocalPosition.clone().add(offset);
  }

  private getSpawnedRemoteJointQuaternion(joint: PresenceJoint, root: THREE.Object3D): THREE.Quaternion {
    root.updateMatrixWorld(true);
    const rootQuaternion = root.getWorldQuaternion(new THREE.Quaternion());
    return rootQuaternion.invert().multiply(new THREE.Quaternion().fromArray(joint.quaternion));
  }

  private disposeRemoteParticipantVisual(visual: RemoteParticipantVisual): void {
    visual.label.geometry.dispose();
    const labelMaterial = visual.label.material as THREE.MeshBasicMaterial;
    labelMaterial.map?.dispose();
    labelMaterial.dispose();
    for (const controller of [visual.leftController, visual.rightController]) {
      controller.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) {
          return;
        }
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          material.dispose();
        }
      });
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
    const matchedController = this.findControllerByHandedness(handedness);
    if (matchedController) {
      return this.capturePresenceJoint(this.controllerGrips.get(matchedController) ?? matchedController);
    }
    return null;
  }

  private findControllerByHandedness(handedness: XRHandedness): THREE.Object3D | undefined {
    for (const [controller, source] of this.controllerInputSources) {
      if (source.handedness !== handedness) {
        continue;
      }
      return controller;
    }

    const controllers = [this.renderer.xr.getController(0), this.renderer.xr.getController(1)];
    for (const controller of controllers) {
      const source = this.getInputSourceForController(controller);
      if (source?.handedness === handedness) {
        return controller;
      }
    }

    if (handedness !== "left" && handedness !== "right") {
      return undefined;
    }

    const connectedControllers = Array.from(this.controllerInputSources.keys());
    if (connectedControllers.length !== 2) {
      return undefined;
    }
    return connectedControllers[handedness === "left" ? 0 : 1];
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
    this.cancelPlacementPointer();
    this.hidePlacementMenu();
    this.studentSpawnAnchor = undefined;
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
    this.removePartVideoPreviews();
    this.partVideoSettings.clear();
    this.videoPrepStates.clear();
    this.videoPlaybackRevisions.clear();
    this.videoPlaybackPausedStates.clear();
    this.partMarkerStates = {};
    this.desktopGrabMarkerPartId = undefined;
    this.selectedPartMarkerId = undefined;
    this.grabbedMarkerController = undefined;
    this.grabbedMarkerPartId = undefined;
    this.removeModelStateMarker();
    this.removeChromaMarker();
    this.removeObjectStateLabels();
    this.hideChromaBillboard();
    this.hideXrChromaPanel();
    this.chromaPosition = undefined;
    this.removeIntroBillboard();
    this.removePartVideoBillboard();
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

  private showPartVideoBillboard(part: ExperiencePartConfig, fromStart: boolean, options: PartVideoPlaybackOptions = {}): void {
    if (!part.videoUrl) {
      return;
    }

    const prepState = this.getVideoPrepStateForPart(part);
    const canShow = prepState.markerState === "green" || (prepState.markerState === "orange" && this.role === "teacher");
    if (!canShow) {
      if (this.activePartVideoPartId === part.id) {
        this.removePartVideoBillboard();
      }
      return;
    }

    this.removePartVideoBillboard();
    const marker = this.markersByPartId.get(part.id);
    const autoPlay = (options.autoPlay ?? true) && !prepState.playbackPaused;
    const muted = options.muted ?? false;
    const video = document.createElement("video");
    video.src = part.videoUrl;
    video.crossOrigin = "anonymous";
    video.loop = prepState.playbackMode === "loop";
    video.muted = muted;
    video.volume = muted ? 0 : 1;
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

    const material = this.createChromaKeyMaterial(texture, prepState.settings);
    const mesh = new THREE.Mesh(
      createFinitePlaneGeometry(PART_VIDEO_DEFAULT_WIDTH, PART_VIDEO_DEFAULT_HEIGHT),
      material
    );
    mesh.name = `Part video billboard: ${part.label}`;
    mesh.scale.setScalar(prepState.scale);
    mesh.renderOrder = 9;
    this.classroomRoot.add(mesh);

    this.partVideo = video;
    this.partVideoTexture = texture;
    this.partVideoMaterial = material;
    this.partVideoBillboard = mesh;
    this.activePartVideoPartId = part.id;
    this.positionPartVideoBillboard(marker);
    this.updatePartVideoBillboardFacing();

    video.addEventListener("loadedmetadata", () => {
      if (this.partVideoBillboard === mesh) {
        this.positionPartVideoBillboard(marker);
      }
    }, { once: true });
    video.addEventListener("ended", () => {
      if (this.partVideo === video) {
        this.removePartVideoBillboard();
      }
    }, { once: true });
    if (fromStart) {
      video.currentTime = 0;
    }
    if (autoPlay) {
      void video.play().catch(() => undefined);
    }
  }

  private positionPartVideoBillboard(marker?: THREE.Object3D): void {
    if (!this.partVideoBillboard) {
      return;
    }

    const source = marker ?? (this.activePartVideoPartId ? this.markersByPartId.get(this.activePartVideoPartId) : undefined);
    if (source) {
      this.partVideoBillboard.position.copy(source.position);
      return;
    }

    const cameraWorldPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const cameraWorldDirection = this.camera.getWorldDirection(new THREE.Vector3());
    cameraWorldDirection.y = 0;
    if (cameraWorldDirection.lengthSq() < 0.001) {
      cameraWorldDirection.set(0, 0, -1);
    }
    cameraWorldDirection.normalize();
    const worldPosition = cameraWorldPosition.addScaledVector(cameraWorldDirection, 2);
    worldPosition.y = Math.max(1.4, worldPosition.y);
    this.partVideoBillboard.position.copy(this.classroomRoot.worldToLocal(worldPosition));
  }

  private removePartVideoBillboard(): void {
    if (this.partVideo) {
      this.partVideo.pause();
      this.partVideo.removeAttribute("src");
      this.partVideo.load();
      this.partVideo = undefined;
    }
    if (this.partVideoBillboard) {
      this.classroomRoot.remove(this.partVideoBillboard);
      this.partVideoBillboard.geometry.dispose();
      this.partVideoBillboard = undefined;
    }
    this.partVideoTexture?.dispose();
    this.partVideoTexture = undefined;
    this.partVideoMaterial?.dispose();
    this.partVideoMaterial = undefined;
    this.activePartVideoPartId = undefined;
  }

  private removePartVideoPreviews(): void {
    for (const preview of this.partVideoPreviews.values()) {
      preview.video.pause();
      preview.video.removeAttribute("src");
      preview.video.load();
      this.classroomRoot.remove(preview.mesh);
      preview.mesh.geometry.dispose();
      preview.texture.dispose();
      preview.material.dispose();
    }
    this.partVideoPreviews.clear();
  }

  private updateIntroBillboardFacing(): void {
    if (!this.introBillboard) {
      return;
    }
    this.applyUprightBillboardFacing(this.introBillboard);
  }

  private updatePartVideoBillboardFacing(): void {
    if (!this.partVideoBillboard) {
      return;
    }

    this.applyUprightBillboardFacing(this.partVideoBillboard);
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
    if (this.chromaMaterial) {
      this.applyChromaSettingsToShaderMaterial(this.chromaMaterial, this.chromaSettings, this.chromaSettings.opacity);
    }
  }

  private applyChromaSettingsToShaderMaterial(material: THREE.ShaderMaterial, settings: ChromaKeySettings, opacity: number): void {
    material.uniforms.similarity.value = settings.similarity;
    material.uniforms.smoothness.value = settings.smoothness;
    material.uniforms.spill.value = settings.spill;
    material.uniforms.opacity.value = opacity;
    material.uniforms.brightness.value = settings.brightness;
    material.uniforms.contrast.value = settings.contrast;
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
    // Keep the gap between the clicked point and the object's origin so the object does not jump to the cursor.
    const grabbed = target === "chroma" ? this.chromaBillboard : this.modelRoot;
    this.desktopGrabOffset.copy(grabbed ? grabbed.getWorldPosition(new THREE.Vector3()).sub(hitPoint) : new THREE.Vector3());
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

    if (event.button === 2 && event.altKey && this.role === "teacher" && !this.renderer.xr.isPresenting) {
      this.startDesktopPlacementPointer(event);
      event.preventDefault();
      return;
    }

    if (event.button === 2) {
      this.reanchorInspectMousePivot();
      this.desktopLookActive = true;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    if (event.button === 0 && this.placementMenu.visible) {
      const placementAsset = this.getPlacementAssetFromRaycaster();
      if (placementAsset) {
        this.placeAssetAtPlacementTarget(placementAsset);
        event.preventDefault();
        return;
      }
      if (this.isRayBlockedByPlacementMenu()) {
        event.preventDefault();
        return;
      }
    }

    if (event.button === 1 && this.role === "teacher") {
      const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
      if (chromaHit) {
        this.startDesktopDistanceGrab("chroma", chromaHit.point, event.pointerId);
        event.preventDefault();
        return;
      }

      const modelHit = this.modelRoot ? this.intersectVisible([this.modelRoot], true)[0] : undefined;
      if (modelHit && !this.modelTransformLocked) {
        this.startDesktopDistanceGrab("model", modelHit.point, event.pointerId);
        event.preventDefault();
        return;
      }
    }

    if (event.button === 0 && event.ctrlKey && this.role === "teacher") {
      const partId = this.getPartIdFromCurrentRay();
      if (partId) {
        this.selectedPartMarkerId = partId;
        this.desktopGrabMarkerPartId = partId;
        this.desktopGrabActive = true;
        this.desktopGrabMode = "free";
        const marker = this.markersByPartId.get(partId);
        const markerWorldPosition = marker?.getWorldPosition(new THREE.Vector3());
        const previewHit = this.getPreviewHitFromCurrentRay();
        const markerGrabPoint = previewHit?.point ?? markerWorldPosition ?? this.raycaster.ray.origin;
        this.desktopGrabDistance = Math.max(0.5, Math.min(10, this.raycaster.ray.origin.distanceTo(markerGrabPoint)));
        this.desktopGrabOffset.copy(markerWorldPosition ? markerWorldPosition.clone().sub(markerGrabPoint) : new THREE.Vector3());
        this.desktopGrabPointerId = event.pointerId;
        this.renderer.domElement.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
      if (chromaHit) {
        this.startDesktopObjectGrab("chroma", chromaHit.point, event.pointerId);
        event.preventDefault();
        return;
      }

      if (this.modelRoot && !this.modelTransformLocked) {
        const hit = this.intersectVisible([this.modelRoot], true)[0];
        if (hit) {
          this.startDesktopObjectGrab("model", hit.point, event.pointerId);
          event.preventDefault();
          return;
        }
      }
    }

    if (this.selectModelStateMarkerFromCurrentRay()) {
      return;
    }

    if (this.selectChromaMarkerFromCurrentRay()) {
      return;
    }

    const part = this.getPartFromCurrentRay();
    if (part) {
      this.handlePartMarkerSelected(part);
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
      const target = this.raycaster.ray.origin
        .clone()
        .addScaledVector(this.raycaster.ray.direction, this.desktopGrabDistance)
        .add(this.desktopGrabOffset);
      if (this.desktopGrabTarget === "chroma" && this.chromaBillboard) {
        this.chromaBillboard.position.copy(this.classroomRoot.worldToLocal(target));
        this.emitChromaTransformChange();
      } else if (this.desktopGrabTarget === "model" && this.modelRoot && !this.modelTransformLocked) {
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

    if (this.placementPointerActive && this.placementPointerId === event.pointerId) {
      this.updatePlacementPointerFromPointerEvent(event);
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

    if (this.placementPointerActive && this.placementPointerId === event.pointerId) {
      this.finishPlacementPointer();
      if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
        this.renderer.domElement.releasePointerCapture(event.pointerId);
      }
      event.preventDefault();
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

    // A plain wheel or touchpad scroll must never move anything. Depth changes need Shift.
    if (!event.shiftKey) {
      return;
    }

    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    event.preventDefault();
    event.stopPropagation();

    const partId = this.selectedPartMarkerId ?? this.getPartIdFromCurrentRay();
    const marker = partId ? this.markersByPartId.get(partId) : undefined;
    if (partId && marker) {
      this.selectedPartMarkerId = partId;
      this.moveObjectAlongPointerRay(marker, event.deltaY);
      this.positionPartVideoPreview(partId, marker);
      if (partId === this.activePartVideoPartId) {
        this.positionPartVideoBillboard(marker);
      }
      this.emitPartMarkerPositionChange(partId, true);
      return;
    }

    const chromaHit = this.chromaBillboard?.visible ? this.raycaster.intersectObject(this.chromaBillboard, false)[0] : undefined;
    if (chromaHit && this.chromaBillboard) {
      this.moveObjectAlongPointerRay(this.chromaBillboard, event.deltaY);
      this.emitChromaTransformChange(true);
      return;
    }

    // The turbine only moves when the pointer is actually on it and it is unlocked.
    const modelHit = this.modelRoot ? this.intersectVisible([this.modelRoot], true)[0] : undefined;
    if (modelHit && this.modelRoot && !this.modelTransformLocked) {
      this.moveObjectAlongPointerRay(this.modelRoot, event.deltaY);
      this.emitModelPositionChange(true);
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
    // Move along the line from the camera to the object itself, not along the cursor ray: the object's origin
    // is rarely under the cursor, so using the cursor ray makes it jump sideways and up.
    const towardObject = objectWorldPosition.clone().sub(this.raycaster.ray.origin);
    if (towardObject.lengthSq() < 1e-6) {
      return;
    }
    const nextWorldPosition = this.raycaster.ray.origin.clone().addScaledVector(towardObject.normalize(), nextDistance);
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
    const hits = this.intersectVisible([...this.markers.keys()], false);
    const part = hits[0] ? this.markers.get(hits[0].object) : undefined;
    if (part) {
      this.handlePartMarkerSelected(part);
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

    const placementAsset = this.getPlacementAssetFromRaycaster();
    if (placementAsset) {
      this.placeAssetAtPlacementTarget(placementAsset);
      return;
    }
    if (this.isRayBlockedByPlacementMenu()) {
      return;
    }

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

    const part = this.getPartFromCurrentRay();
    if (part) {
      this.handlePartMarkerSelected(part);
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
    if (this.isRightController(controller) || this.getInputSourceForController(controller)?.gamepad) {
      this.activeGamepadController = controller;
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
    if (this.placementMenu.visible) {
      panelTargets.push(...this.placementButtons.keys());
      if (this.placementMenuSurface) {
        panelTargets.push(this.placementMenuSurface);
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
          this.grabbedMarkerOffset.copy(mesh.getWorldPosition(new THREE.Vector3()).sub(markerHitsXr[0].point));
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
      this.grabbedChromaOffset.copy(chromaHit.object.getWorldPosition(new THREE.Vector3()).sub(chromaHit.point));
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
      this.grabbedModelOffset.copy(this.modelRoot.getWorldPosition(new THREE.Vector3()).sub(hit.point));
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
      if (event.data.gamepad && (event.data.handedness === "right" || !this.activeGamepadController)) {
        this.activeGamepadController = controller;
      }
      if (event.data.handedness === "right" || (event.data.gamepad && !this.teleportPreviewController)) {
        this.teleportPreviewController = controller;
        this.teleportDebugState.lastAttemptReason = event.data.handedness === "right" ? "right controller connected" : "gamepad controller connected";
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
    if (this.activeGamepadController === controller) {
      this.activeGamepadController = undefined;
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
    return this.intersectVisible(objects, recursive);
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
    if (source?.handedness === "right" || controller === this.teleportPreviewController || controller === this.activeGamepadController) {
      return true;
    }

    const rightSourceController = this.getControllerForInputSource(this.getRightInputSource());
    return Boolean(rightSourceController && rightSourceController === controller);
  }

  private updateGrabbedModelPosition(): void {
    if (!this.grabbedModelController || !this.modelRoot || this.modelTransformLocked) {
      if (this.modelTransformLocked) {
        this.grabbedModelController = undefined;
        this.objectRotationActive = false;
      }
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
      const scaleAxis = axes.x;
      const distanceAxis = axes.y;
      if (this.objectRotationActive) {
        this.rotateGrabbedModel(scaleAxis, distanceAxis);
        this.modelRoot.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedModelDistance).add(this.grabbedModelOffset)));
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

    this.modelRoot.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedModelDistance).add(this.grabbedModelOffset)));
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

    this.chromaBillboard.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedChromaDistance).add(this.grabbedChromaOffset)));
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
    marker.position.copy(this.classroomRoot.worldToLocal(origin.addScaledVector(direction, this.grabbedMarkerDistance).add(this.grabbedMarkerOffset)));
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

  private getControllerAxes(controller: THREE.Object3D): ThumbstickAxes | undefined {
    const source = this.getInputSourceForController(controller);
    return source ? this.readThumbstickAxes(source) : undefined;
  }

  private getGamepadInputSources(): XRInputSource[] {
    const session = this.renderer.xr.getSession();
    if (!session) {
      return [];
    }

    return Array.from(session.inputSources).filter((source) => Boolean(source.gamepad));
  }

  private getPreferredGamepadInputSources(): XRInputSource[] {
    const sources = this.getGamepadInputSources();
    const preferred: XRInputSource[] = [];
    const push = (source?: XRInputSource): void => {
      if (!source?.gamepad || preferred.includes(source)) {
        return;
      }
      preferred.push(source);
    };

    push(sources.find((source) => source.handedness === "right"));
    push(this.activeGamepadController ? this.getInputSourceForController(this.activeGamepadController) : undefined);
    push(this.teleportPreviewController ? this.getInputSourceForController(this.teleportPreviewController) : undefined);
    for (const source of sources.filter((inputSource) => inputSource.handedness === "none")) {
      push(source);
    }
    for (const source of sources) {
      push(source);
    }
    return preferred;
  }

  private readThumbstickAxes(source: XRInputSource): ThumbstickAxes | undefined {
    const axes = source.gamepad?.axes;
    if (!axes || axes.length < 2) {
      return undefined;
    }

    const axisPairs: Array<[number, number]> = axes.length >= 4
      ? [[2, 3], [0, 1]]
      : [[0, 1]];
    if (axes.length >= 6) {
      axisPairs.push([4, 5]);
    }

    let bestAxes: ThumbstickAxes | undefined;
    let bestMagnitude = -1;
    for (const [xIndex, yIndex] of axisPairs) {
      const x = Number(axes[xIndex] ?? 0);
      const y = Number(axes[yIndex] ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        continue;
      }
      const magnitude = Math.hypot(x, y);
      if (magnitude > bestMagnitude) {
        bestAxes = { x, y };
        bestMagnitude = magnitude;
      }
    }

    return bestAxes;
  }

  private getActiveThumbstickInput(): ControllerThumbstickInput | undefined {
    const candidates = this.getPreferredGamepadInputSources()
      .map((source): ControllerThumbstickInput | undefined => {
        const axes = this.readThumbstickAxes(source);
        if (!axes) {
          return undefined;
        }
        return {
          source,
          controller: this.getControllerForInputSource(source),
          axes,
          magnitude: Math.hypot(axes.x, axes.y)
        };
      })
      .filter((candidate): candidate is ControllerThumbstickInput => Boolean(candidate));

    if (candidates.length === 0) {
      return undefined;
    }

    const activeCandidate = candidates.reduce((best, candidate) => (
      candidate.magnitude > best.magnitude ? candidate : best
    ), candidates[0]);
    const chosen = activeCandidate.magnitude > 0.08 ? activeCandidate : candidates[0];
    if (chosen.controller) {
      this.activeGamepadController = chosen.controller;
    }
    return chosen;
  }

  private getControllerButtonInput(buttonIndex: number): ControllerButtonInput {
    const sources = this.getPreferredGamepadInputSources();
    for (const source of sources) {
      const button = source.gamepad?.buttons[buttonIndex];
      if (button?.pressed) {
        const controller = this.getControllerForInputSource(source);
        if (controller) {
          this.activeGamepadController = controller;
        }
        return { source, controller, pressed: true };
      }
    }

    const source = sources[0];
    return {
      source,
      controller: source ? this.getControllerForInputSource(source) : this.findRightController(),
      pressed: false
    };
  }

  private getRightInputSource(): XRInputSource | undefined {
    const sources = this.getPreferredGamepadInputSources();
    return sources.find((source) => source.handedness === "right")
      ?? sources.find((source) => source.handedness === "none")
      ?? sources[0];
  }

  private getControllerForInputSource(source?: XRInputSource): THREE.Object3D | undefined {
    if (!source) {
      return undefined;
    }

    for (const [controller, mappedSource] of this.controllerInputSources) {
      if (mappedSource === source) {
        return controller;
      }
    }

    if (source.handedness === "left" || source.handedness === "right") {
      for (const [controller, mappedSource] of this.controllerInputSources) {
        if (mappedSource.handedness === source.handedness) {
          return controller;
        }
      }
    }

    const connectedControllers = Array.from(this.controllerInputSources.keys());
    if (connectedControllers.length === 1) {
      return connectedControllers[0];
    }

    const session = this.renderer.xr.getSession();
    if (!session) {
      return undefined;
    }
    const sessionIndex = Array.from(session.inputSources).indexOf(source);
    if (sessionIndex >= 0 && sessionIndex <= 1) {
      return this.renderer.xr.getController(sessionIndex);
    }

    return undefined;
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

    const button = this.getControllerButtonInput(RIGHT_CONTROLLER_B_BUTTON_INDEX);
    const isPressed = button.pressed;
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

  // The app rebuilds its markup on state changes, so the canvas is re-parented into a new container.
  // Measure and observe whichever container currently holds the canvas, not the first one.
  setContainer(container: HTMLElement): void {
    if (this.container === container) {
      return;
    }
    this.container = container;
    this.resizeObserver?.disconnect();
    this.resizeObserver?.observe(container);
    this.refreshViewport();
  }

  private resize = (): void => {
    const bounds = this.container.getBoundingClientRect();
    const width = Math.floor(bounds.width || this.container.clientWidth);
    const height = Math.floor(bounds.height || this.container.clientHeight);
    if (width < 2 || height < 2) {
      return;
    }

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
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
    this.updateRightControllerPlacementButton();
    this.updateTeleportPreview();
    this.updateControllerRayVisibility();
    this.updateRightControllerMenuToggle();
    this.updateRightThumbstickTeleport();
    this.updateGrabbedModelPosition();
    this.updateGrabbedChromaPosition();
    this.updateGrabbedMarkerPosition();
    if (this.renderer.xr.isPresenting && this.role && this.xrMenuVisible && !this.xrPanelAnchored) {
      this.anchorXrPanelInFrontOfUser();
    }
    if (this.renderer.xr.isPresenting && this.xrChromaPanel.visible && !this.xrChromaPanelAnchored) {
      this.anchorXrChromaPanelInFrontOfUser();
    }
    this.updateIntroBillboardFacing();
    this.updateChromaBillboardFacing();
    this.updatePartVideoPreviewFacing();
    this.updatePartVideoBillboardFacing();
    this.updatePlacementMenuFacing();
    this.maybeSyncParticipantPresence();
    this.renderer.render(this.scene, this.camera);
    this.updateStatsPanel();
  };

  // Performance meter for headset testing: open the app with ?stats=1. In XR, calls and triangles count both eyes.
  private createStatsPanel(): void {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const texture = new THREE.CanvasTexture(canvas);
    const panel = new THREE.Mesh(
      createFinitePlaneGeometry(0.4, 0.2),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })
    );
    panel.position.set(-0.22, -0.2, -0.7);
    panel.renderOrder = 100;
    this.camera.add(panel);
    this.statsCanvas = canvas;
    this.statsTexture = texture;
  }

  private updateStatsPanel(): void {
    if (!this.statsCanvas || !this.statsTexture) {
      return;
    }

    this.statsFrames += 1;
    const now = performance.now();
    const elapsed = now - this.statsLastUpdate;
    if (elapsed < 500) {
      return;
    }

    const fps = (this.statsFrames * 1000) / elapsed;
    this.statsFrames = 0;
    this.statsLastUpdate = now;
    const context = this.statsCanvas.getContext("2d");
    if (!context) {
      return;
    }

    const { render, memory } = this.renderer.info;
    context.clearRect(0, 0, this.statsCanvas.width, this.statsCanvas.height);
    context.fillStyle = "rgba(6, 16, 23, 0.85)";
    context.fillRect(0, 0, this.statsCanvas.width, this.statsCanvas.height);
    context.fillStyle = fps >= 68 ? "#4ade80" : fps >= 45 ? "#facc15" : "#f87171";
    context.font = "700 72px Arial";
    context.fillText(`${Math.round(fps)} fps`, 24, 84);
    context.fillStyle = "#e2e8f0";
    context.font = "600 36px Arial";
    context.fillText(`calls ${render.calls}`, 24, 142);
    context.fillText(`tris ${Math.round(render.triangles / 1000)}k`, 24, 190);
    context.fillText(`tex ${memory.textures}  geo ${memory.geometries}`, 24, 238);
    this.statsTexture.needsUpdate = true;
  }

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

  private reanchorInspectMousePivot(): void {
    if (!this.isTabletInspectMode()) {
      return;
    }

    this.camera.updateMatrixWorld(true);
    const cameraWorldPosition = this.camera.getWorldPosition(new THREE.Vector3());
    const pivotDistance = Math.min(this.tabletOrbitDistance, DESKTOP_INSPECT_MOUSE_PIVOT_DISTANCE);
    this.tabletOrbitDistance = Math.min(TABLET_MAX_ZOOM, Math.max(TABLET_MIN_ZOOM, pivotDistance));
    const cameraOffset = new THREE.Vector3(0, 0, this.tabletOrbitDistance)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.desktopYaw);
    this.tabletOrbitTarget.copy(cameraWorldPosition).sub(cameraOffset);
    this.applyInspectCamera();
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
      const rightController = this.isRightController(controller);
      ray.visible = !(teleportAiming && rightController);
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

    if (this.activeGamepadController) {
      return this.activeGamepadController;
    }

    const inputController = this.getControllerForInputSource(this.getRightInputSource());
    if (inputController) {
      return inputController;
    }

    if (this.teleportPreviewController) {
      return this.teleportPreviewController;
    }

    return Array.from(this.controllerInputSources.keys())[0];
  }

  private getRightController(): THREE.Object3D {
    return this.findRightController() ?? this.renderer.xr.getController(1);
  }

  private getRightThumbstickAxes(): ThumbstickAxes | undefined {
    const input = this.getActiveThumbstickInput();
    if (!input) {
      return undefined;
    }
    if (input.controller) {
      this.teleportPreviewController = input.controller;
    }
    return input.axes;
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
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide
    });
  }
}
