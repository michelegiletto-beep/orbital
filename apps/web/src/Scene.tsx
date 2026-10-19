import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetPath } from "./assets.js";
import {
  MODEL,
  orbitPoints,
  norm,
  scale,
  add,
  cross,
  type OrbitState,
} from "../../../packages/sim-core/src/index.js";

const vertex = `varying vec3 vNormal;varying vec2 vUv;void main(){vNormal=normalize(normalMatrix*normal);vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
const fragment = `uniform sampler2D earth;varying vec3 vNormal;varying vec2 vUv;void main(){vec3 n=normalize(vNormal);vec3 color=texture2D(earth,vUv).rgb;float light=max(dot(n,normalize(vec3(-.75,.55,1.))),0.);color*=.1+light*1.03;float rim=pow(1.-max(dot(n,vec3(0.,0.,1.)),0.),3.);color+=vec3(.025,.13,.26)*rim;gl_FragColor=vec4(color,1.);}`;
type Props = {
  targetAltitude?: number;
  state: OrbitState;
  forecast: OrbitState | null;
  view: number;
  onReady: (ready: boolean) => void;
  xrRequest: number;
  onXR: (message: string) => void;
};
export function Scene({
  state,
  forecast,
  view,
  onReady,
  xrRequest,
  onXR,
  targetAltitude = MODEL.targetAltitude,
}: Props) {
  const host = useRef<HTMLDivElement>(null),
    label = useRef<HTMLDivElement>(null);
  const runtime = useRef<{
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    vehicle: THREE.Group;
    path: THREE.Line;
    prediction: THREE.Line;
    altitude: THREE.Line;
    target: THREE.Line;
    frame: number;
  } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
    } catch {
      onReady(false);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor("#08161d");
    renderer.xr.enabled = true;
    renderer.domElement.setAttribute(
      "aria-label",
      "Three dimensional orbit view. Drag to rotate. Scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2("#08161d", 0.014);
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 200);
    camera.position.set(17, 13, 23);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 13;
    controls.maxDistance = 42;
    controls.enablePan = false;
    controls.maxPolarAngle = Math.PI * 0.94;
    const textures = new THREE.TextureLoader();
    const surface = textures.load(assetPath("earth/surface.jpg"));
    surface.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const cloudMap = textures.load(assetPath("earth/clouds.jpg"));
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(6.371, 128, 96),
      new THREE.ShaderMaterial({
        uniforms: { earth: { value: surface } },
        vertexShader: vertex,
        fragmentShader: fragment,
      }),
    );
    planet.rotation.y = Math.PI * 0.55;
    scene.add(planet);
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(6.39, 96, 64),
      new THREE.ShaderMaterial({
        uniforms: { clouds: { value: cloudMap } },
        transparent: true,
        depthWrite: false,
        vertexShader: vertex,
        fragmentShader:
          "uniform sampler2D clouds;varying vec3 vNormal;varying vec2 vUv;void main(){float density=texture2D(clouds,vUv).r;float light=max(dot(normalize(vNormal),normalize(vec3(-.75,.55,1.))),0.);gl_FragColor=vec4(vec3(.82,.87,.94)*(.15+light*.9),density*.65);}",
      }),
    );
    clouds.rotation.y = planet.rotation.y;
    scene.add(clouds);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(6.47, 64, 48),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        vertexShader:
          "varying vec3 n;void main(){n=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
        fragmentShader:
          "varying vec3 n;void main(){float a=pow(1.-abs(dot(normalize(n),vec3(0.,0.,1.))),5.);gl_FragColor=vec4(.3,.65,.7,a*.25);}",
      }),
    );
    scene.add(atmosphere);
    const gridMaterial = new THREE.LineBasicMaterial({
      color: "#a3b9d3",
      transparent: true,
      opacity: 0.06,
    });
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const y = 6.39 * Math.sin((latitude * Math.PI) / 180),
        r = 6.39 * Math.cos((latitude * Math.PI) / 180);
      const points = Array.from(
        { length: 161 },
        (_, i) =>
          new THREE.Vector3(
            r * Math.cos((i / 160) * Math.PI * 2),
            y,
            r * Math.sin((i / 160) * Math.PI * 2),
          ),
      );
      scene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          gridMaterial,
        ),
      );
    }
    for (let longitude = 0; longitude < 180; longitude += 30) {
      const points = Array.from({ length: 161 }, (_, i) => {
        const a = (i / 160) * Math.PI * 2,
          b = (longitude * Math.PI) / 180;
        return new THREE.Vector3(
          6.39 * Math.cos(a) * Math.cos(b),
          6.39 * Math.sin(a),
          6.39 * Math.cos(a) * Math.sin(b),
        );
      });
      scene.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          gridMaterial,
        ),
      );
    }
    const points = Array.from(
      { length: 241 },
      (_, i) =>
        new THREE.Vector3(
          ((MODEL.radius + MODEL.targetAltitude) / 1000) *
            Math.cos((i / 240) * Math.PI * 2),
          0,
          ((MODEL.radius + MODEL.targetAltitude) / 1000) *
            Math.sin((i / 240) * Math.PI * 2),
        ),
    );
    const target = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: "#77918f",
        dashSize: 0.1,
        gapSize: 0.1,
        transparent: true,
        opacity: 0.5,
      }),
    );
    target.computeLineDistances();
    scene.add(target);
    const path = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({
        color: "#c5dcd1",
        transparent: true,
        opacity: 0.85,
      }),
    );
    scene.add(path);
    const prediction = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: "#e4b78b",
        dashSize: 0.13,
        gapSize: 0.07,
        transparent: true,
        opacity: 0.8,
      }),
    );
    scene.add(prediction);
    const altitude = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: "#9cb2ae",
        dashSize: 0.06,
        gapSize: 0.07,
        transparent: true,
        opacity: 0.5,
      }),
    );
    scene.add(altitude);
    const vehicle = new THREE.Group();
    const core = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.15, 0.16),
      new THREE.MeshStandardMaterial({
        color: "#e2b384",
        metalness: 0.45,
        roughness: 0.5,
      }),
    );
    vehicle.add(core);
    for (const sign of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.012, 0.16),
        new THREE.MeshStandardMaterial({
          color: "#647f92",
          metalness: 0.5,
          roughness: 0.4,
        }),
      );
      panel.position.x = sign * 0.2;
      vehicle.add(panel);
    }
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 12, 12),
      new THREE.MeshBasicMaterial({ color: "#ffd4a5" }),
    );
    vehicle.add(marker);
    scene.add(vehicle);
    scene.add(new THREE.AmbientLight("#bdd7d4", 2));
    const light = new THREE.DirectionalLight("#ffffff", 3);
    light.position.set(-12, 15, 20);
    scene.add(light);
    const starPositions = [];
    let seed = 83721;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < 650; i++) {
      const theta = rand() * Math.PI * 2,
        z = rand() * 2 - 1,
        r = 70;
      starPositions.push(
        r * Math.sqrt(1 - z * z) * Math.cos(theta),
        r * z,
        r * Math.sqrt(1 - z * z) * Math.sin(theta),
      );
    }
    const starsGeometry = new THREE.BufferGeometry();
    starsGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(starPositions, 3),
    );
    scene.add(
      new THREE.Points(
        starsGeometry,
        new THREE.PointsMaterial({
          color: "#99b8c0",
          size: 0.055,
          transparent: true,
          opacity: 0.65,
        }),
      ),
    );
    const resize = new ResizeObserver(() => {
      const w = element.clientWidth,
        h = element.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resize.observe(element);
    runtime.current = {
      scene,
      renderer,
      camera,
      controls,
      vehicle,
      path,
      prediction,
      altitude,
      target,
      frame: 0,
    };
    const projected = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      controls.update();
      renderer.render(scene, camera);
      if (label.current) {
        projected.copy(vehicle.position).project(camera);
        const hidden =
          projected.z > 1 || vehicle.position.dot(camera.position) < 0;
        label.current.style.opacity = hidden ? "0" : "1";
        label.current.style.transform = `translate(${(projected.x * 0.5 + 0.5) * element.clientWidth + 15}px,${(-projected.y * 0.5 + 0.5) * element.clientHeight - 10}px)`;
      }
    });
    onReady(true);
    const canvas = renderer.domElement;
    const lost = (event: Event) => {
      event.preventDefault();
      onReady(false);
    };
    canvas.addEventListener("webglcontextlost", lost);
    return () => {
      resize.disconnect();
      canvas.removeEventListener("webglcontextlost", lost);
      renderer.setAnimationLoop(null);
      controls.dispose();
      surface.dispose();
      cloudMap.dispose();
      scene.traverse((object) => {
        const item = object as THREE.Mesh;
        item.geometry?.dispose();
        const material = item.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      renderer.dispose();
      element.removeChild(canvas);
      runtime.current = null;
    };
  }, [onReady]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    r.vehicle.position.set(...scale(state.position, 0.001));
    r.vehicle.lookAt(...scale(state.velocity, 100));
    const replace = (line: THREE.Line, points: THREE.Vector3[]) => {
      line.geometry.dispose();
      line.geometry = new THREE.BufferGeometry().setFromPoints(points);
      line.computeLineDistances();
    };
    const axisX = scale(state.position, 1 / norm(state.position)),
      normal = cross(state.position, state.velocity),
      axisY = cross(scale(normal, 1 / norm(normal)), axisX);
    replace(
      r.target,
      Array.from({ length: 241 }, (_, i) => {
        const a = (i / 240) * Math.PI * 2;
        return new THREE.Vector3(
          ...scale(
            add(scale(axisX, Math.cos(a)), scale(axisY, Math.sin(a))),
            (MODEL.radius + targetAltitude) / 1000,
          ),
        );
      }),
    );
    replace(
      r.path,
      orbitPoints(state).map((v) => new THREE.Vector3(...scale(v, 0.001))),
    );
    replace(r.altitude, [
      new THREE.Vector3(...scale(state.position, 0.001)),
      new THREE.Vector3(
        ...scale(state.position, MODEL.radius / norm(state.position) / 1000),
      ),
    ]);
    replace(
      r.prediction,
      forecast
        ? orbitPoints(forecast).map(
            (v) => new THREE.Vector3(...scale(v, 0.001)),
          )
        : [],
    );
  }, [state, forecast, targetAltitude]);
  useEffect(() => {
    const r = runtime.current;
    if (!r) return;
    const positions = [
      [17, 13, 23],
      [0, 30, 0.01],
      [23, 4, 22],
    ];
    r.camera.position.set(...(positions[view % 3] as [number, number, number]));
    r.controls.update();
  }, [view]);
  useEffect(() => {
    if (!xrRequest) return;
    const r = runtime.current;
    if (!r) return;
    void (async () => {
      try {
        const xr = navigator.xr;
        if (!xr || !(await xr.isSessionSupported("immersive-vr"))) {
          onXR(
            "Connect a compatible headset and open this page in a secure context.",
          );
          return;
        }
        const session = await xr.requestSession("immersive-vr", {
          optionalFeatures: ["local-floor"],
        });
        r.renderer.xr.setReferenceSpaceType("local");
        await r.renderer.xr.setSession(session);
        onXR("");
      } catch {
        onXR("Immersive sessions are unavailable on this device.");
      }
    })();
  }, [xrRequest, onXR]);
  return (
    <div className="scene-host" ref={host}>
      <div className="vehicle-label" ref={label}>
        SPACECRAFT 01
      </div>
    </div>
  );
}
