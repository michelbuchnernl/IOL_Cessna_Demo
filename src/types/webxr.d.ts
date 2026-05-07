interface Navigator {
  xr?: XRSystem;
}

interface XRSystem {
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, options?: XRSessionInit): Promise<XRSession>;
}

type XRSessionMode = "inline" | "immersive-vr" | "immersive-ar";

interface XRSessionInit {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  domOverlay?: {
    root: Element;
  };
}

interface XRSession {}
