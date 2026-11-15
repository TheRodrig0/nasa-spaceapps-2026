import {
  AppBase,
  AppOptions,
  BinaryHandler,
  CameraComponentSystem,
  Color,
  ContainerHandler,
  createGraphicsDevice,
  Entity,
  FILLMODE_FILL_WINDOW,
  JsonHandler,
  LightComponentSystem,
  MaterialHandler,
  ModelComponentSystem,
  RenderComponentSystem,
  RESOLUTION_AUTO,
  SHADOW_PCF3_32F,
  TextureHandler,
} from 'playcanvas';

/**
 * PlayCanvas application subclass configured for full-window auto-resolution rendering.
 */
export class CrewSandboxApp extends AppBase {
  constructor(canvas: HTMLCanvasElement, options: AppOptions) {
    super(canvas);
    this.init(options);
    this.setCanvasFillMode(FILLMODE_FILL_WINDOW);
    this.setCanvasResolution(RESOLUTION_AUTO);
    this.resizeCanvas();
  }
}

/**
 * Creates, configures, and starts the PlayCanvas application on the given canvas.
 */
export async function createCrewSandboxApp(canvas: HTMLCanvasElement): Promise<CrewSandboxApp> {
  const graphicsDevice = await createGraphicsDevice(canvas);
  const options = new AppOptions();
  options.graphicsDevice = graphicsDevice;
  options.componentSystems = [
    RenderComponentSystem,
    ModelComponentSystem,
    CameraComponentSystem,
    LightComponentSystem,
  ];
  options.resourceHandlers = [
    ContainerHandler,
    TextureHandler,
    BinaryHandler,
    MaterialHandler,
    JsonHandler,
  ];

  const app = new CrewSandboxApp(canvas, options);
  app.start();
  return app;
}

/**
 * Configures Mars ambient lighting and attaches the directional MarsSun light to app.root.
 */
export function createMarsSun(app: AppBase): Entity {
  app.scene.ambientLight = new Color(0.45, 0.26, 0.2).linear();

  const sun = new Entity('MarsSun', app);
  sun.addComponent('light', {
    type: 'directional',
    color: new Color(1.0, 0.88, 0.76),
    intensity: 1.75,
    castShadows: true,
    shadowResolution: 2048,
    shadowDistance: 1600,
    shadowBias: 0.14,
    normalOffsetBias: 0.05,
    shadowType: SHADOW_PCF3_32F,
  });
  sun.setEulerAngles(48, 32, 0);
  app.root.addChild(sun);
  return sun;
}

/**
 * Creates and attaches the MainCamera entity with tactical isometric framing, extended far clip, and Mars sky clearColor.
 */
export function createMainCamera(app: AppBase): Entity {
  const camera = new Entity('MainCamera', app);
  camera.addComponent('camera', {
    clearColor: new Color(0.18, 0.09, 0.07),
    farClip: 5500,
    fov: 38,
  });
  app.root.addChild(camera);
  return camera;
}
