import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetPath } from "./assets.js";
import {
  orbitPoints,
  type OrbitState,
} from "../../../packages/sim-core/src/index.js";
import {
  groundPoint,
  type Workspace,
  type Sample,
} from "../../../packages/sim-core/src/advanced.js";

const point = ([x, y, z]: number[]) =>
  new THREE.Vector3(x / 1000, z / 1000, -y / 1000);
export function FlightScene({
  workspace,
  selected,
  prediction,
  view,
  onSelect,
}: {
  workspace: Workspace;
  selected: string;
  prediction: Sample[];
  view: "orbit" | "ground";
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    current = useRef({ workspace, selected, prediction }),
    [failed, setFailed] = useState(false);
  current.current = { workspace, selected, prediction };
  useEffect(() => {
    if (view !== "orbit") return;
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#090c14");
    renderer.domElement.setAttribute(
      "aria-label",
      "Earth orbital view. Drag to rotate. Scroll to zoom.",
    );
    renderer.domElement.setAttribute("role", "img");
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);
    camera.position.set(15, 10, 23);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.minDistance = 9;
    controls.maxDistance = 140;
    const loader = new THREE.TextureLoader(),
      earth = loader.load(assetPath("earth/surface.jpg")),
      clouds = loader.load(assetPath("earth/clouds.jpg"));
    earth.anisotropy = renderer.capabilities.getMaxAnisotropy();
    earth.colorSpace = THREE.SRGBColorSpace;
    const planet = new THREE.Group();
    planet.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(6.371, 128, 96),
        new THREE.MeshPhongMaterial({
          map: earth,
          color: 0xffffff,
          shininess: 8,
          specular: 0x15222c,
        }),
      ),
    );
    planet.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(6.395, 96, 64),
        new THREE.MeshPhongMaterial({
          map: clouds,
          transparent: true,
          opacity: 0.2,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    scene.add(planet);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(6.48, 96, 64),
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader:
          "varying vec3 n;varying vec3 p;void main(){n=normalize(normalMatrix*normal);vec4 q=modelViewMatrix*vec4(position,1.0);p=q.xyz;gl_Position=projectionMatrix*q;}",
        fragmentShader:
          "varying vec3 n;varying vec3 p;void main(){float rim=pow(1.0-abs(dot(normalize(n),normalize(-p))),3.2);gl_FragColor=vec4(.12,.37,.8,rim*.7);}",
      }),
    );
    scene.add(atmosphere);
    scene.add(new THREE.AmbientLight("#b9c9ed", 0.55));
    const sun = new THREE.DirectionalLight("#eff5ff", 3.1);
    sun.position.set(-15, 8, 16);
    scene.add(sun);
    const positions: number[] = [];
    let seed = 329;
    for (let i = 0; i < 950; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      const u = seed / 4294967296;
      seed = (1664525 * seed + 1013904223) >>> 0;
      const v = seed / 4294967296;
      positions.push(
        95 * Math.sqrt(1 - (2 * v - 1) ** 2) * Math.cos(2 * Math.PI * u),
        95 * (2 * v - 1),
        95 * Math.sqrt(1 - (2 * v - 1) ** 2) * Math.sin(2 * Math.PI * u),
      );
    }
    const stars = new THREE.BufferGeometry();
    stars.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    scene.add(
      new THREE.Points(
        stars,
        new THREE.PointsMaterial({
          color: "#6c7897",
          size: 0.055,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );
    const group = new THREE.Group();
    scene.add(group);
    let lastTime = -1,
      lastSelected = "",
      lastPrediction: Sample[] | null = null;
    const labels = new Map<string, HTMLButtonElement>();
    const clickable: THREE.Object3D[] = [];
    const disposeGroup = () => {
      while (group.children.length) {
        const object = group.children[0] as THREE.Mesh;
        object.geometry?.dispose();
        if (Array.isArray(object.material))
          object.material.forEach((m) => m.dispose());
        else object.material?.dispose();
        group.remove(object);
      }
      clickable.length = 0;
    };
    const rebuild = () => {
      const {
        workspace: w,
        selected: id,
        prediction: future,
      } = current.current;
      disposeGroup();
      for (const vehicle of w.vehicles) {
        const { spec, state } = vehicle;
        const orbitState: OrbitState = {
          ...state,
          time: w.time,
          spent: state.deltaV,
          burns: 0,
          impacted: state.entered,
        };
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(
            orbitPoints(orbitState, 200).map(point),
          ),
          new THREE.LineBasicMaterial({
            color: spec.color,
            transparent: true,
            opacity: spec.id === id ? 0.7 : 0.24,
          }),
        );
        group.add(line);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(spec.id === id ? 0.075 : 0.05, 16, 16),
          new THREE.MeshBasicMaterial({ color: spec.color }),
        );
        marker.position.copy(point(state.position));
        marker.userData.id = spec.id;
        group.add(marker);
        clickable.push(marker);
        if (spec.id === id) {
          const halo = new THREE.LineLoop(
            new THREE.BufferGeometry().setFromPoints(
              Array.from(
                { length: 64 },
                (_, i) =>
                  new THREE.Vector3(
                    0.18 * Math.cos((i / 64) * Math.PI * 2),
                    0.18 * Math.sin((i / 64) * Math.PI * 2),
                    0,
                  ),
              ),
            ),
            new THREE.LineBasicMaterial({
              color: spec.color,
              transparent: true,
              opacity: 0.55,
            }),
          );
          halo.position.copy(marker.position);
          halo.quaternion.copy(camera.quaternion);
          group.add(halo);
        }
        if (!labels.has(spec.id)) {
          const label = document.createElement("button");
          label.className = "flight-object-label";
          label.textContent = spec.name;
          label.addEventListener("click", () => onSelect(spec.id));
          element.appendChild(label);
          labels.set(spec.id, label);
        }
        const label = labels.get(spec.id)!;
        label.classList.toggle("selected", spec.id === id);
        label.style.setProperty("--vehicle-color", spec.color);
        const points = future.filter((s) => s.vehicleId === spec.id);
        if (points.length > 1) {
          const path = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              point(state.position),
              ...points.map((s) => point(s.position)),
            ]),
            new THREE.LineDashedMaterial({
              color: spec.color,
              dashSize: 0.12,
              gapSize: 0.09,
              transparent: true,
              opacity: 0.7,
            }),
          );
          path.computeLineDistances();
          group.add(path);
        }
      }
      for (const [id, label] of labels)
        if (!w.vehicles.some((v) => v.spec.id === id)) {
          label.remove();
          labels.delete(id);
        }
      const jd = (Date.parse(w.epoch) + w.time * 1000) / 86400000 + 2440587.5;
      planet.rotation.y =
        ((280.46061837 + 360.98564736629 * (jd - 2451545)) * Math.PI) / 180 +
        Math.PI / 2;
      lastTime = w.time;
      lastSelected = id;
      lastPrediction = future;
    };
    const resize = new ResizeObserver(() => {
      if (!element.clientHeight) return;
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
    });
    resize.observe(element);
    const projected = new THREE.Vector3();
    renderer.setAnimationLoop(() => {
      if (document.hidden) return;
      const now = current.current;
      if (
        lastTime !== now.workspace.time ||
        lastSelected !== now.selected ||
        lastPrediction !== now.prediction
      )
        rebuild();
      controls.update();
      renderer.render(scene, camera);
      for (const v of now.workspace.vehicles) {
        const label = labels.get(v.spec.id);
        if (!label) continue;
        const p = point(v.state.position);
        projected.copy(p).project(camera);
        const ray = camera.position.clone().sub(p);
        const hidden =
          projected.z > 1 ||
          (p.dot(ray) < 0 &&
            p.clone().cross(ray).length() / ray.length() < 6.38);
        label.style.visibility = hidden ? "hidden" : "visible";
        const labelX = Math.max(
            12,
            Math.min(
              element.clientWidth - label.offsetWidth - 12,
              (projected.x * 0.5 + 0.5) * element.clientWidth + 12,
            ),
          ),
          labelY = Math.max(
            90,
            Math.min(
              element.clientHeight - 60,
              (-projected.y * 0.5 + 0.5) * element.clientHeight - 12,
            ),
          );
        label.style.transform = `translate(${labelX}px,${labelY}px)`;
      }
    });
    const lost = (e: Event) => {
      e.preventDefault();
      setFailed(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", lost);
    return () => {
      resize.disconnect();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      controls.dispose();
      disposeGroup();
      labels.forEach((l) => l.remove());
      earth.dispose();
      clouds.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        if (Array.isArray(m.material)) m.material.forEach((x) => x.dispose());
        else m.material?.dispose();
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [view, onSelect]);
  if (view === "ground")
    return (
      <div className="ground-view">
        <img
          src={assetPath("earth/surface.jpg")}
          alt="Earth surface photographic composite"
        />
        <svg
          viewBox="0 0 720 360"
          role="img"
          aria-label="Predicted geocentric ground tracks"
        >
          {workspace.vehicles.map((v) => {
            const positions = [
                ...workspace.history.filter(
                  (p) => p.vehicleId === v.spec.id && p.time < workspace.time,
                ),
                { position: v.state.position, time: workspace.time },
                ...prediction.filter((p) => p.vehicleId === v.spec.id),
              ],
              segments: string[] = [];
            let last = 0;
            positions.forEach((p, i) => {
              const g = groundPoint(p.position, workspace.epoch, p.time),
                x = (g.longitude + 180) * 2,
                y = (90 - g.latitude) * 2;
              if (i === 0 || Math.abs(x - last) > 360)
                segments.push(`M${x},${y}`);
              else segments.push(`L${x},${y}`);
              last = x;
            });
            const g = groundPoint(
              v.state.position,
              workspace.epoch,
              workspace.time,
            );
            return (
              <g key={v.spec.id}>
                <path
                  d={segments.join(" ")}
                  fill="none"
                  stroke={v.spec.color}
                  strokeWidth="1.2"
                />
                <circle
                  cx={(g.longitude + 180) * 2}
                  cy={(90 - g.latitude) * 2}
                  r="3"
                  fill={v.spec.color}
                />
                <text
                  x={(g.longitude + 180) * 2 + 6}
                  y={(90 - g.latitude) * 2 - 6}
                  fill="white"
                  fontSize="8"
                >
                  {v.spec.name}
                </text>
              </g>
            );
          })}
        </svg>
        <span className="ground-caption">
          Geocentric latitude · UTC approximates UT1
        </span>
      </div>
    );
  return (
    <div className="flight-scene" ref={host}>
      {failed && (
        <div className="scene-fallback">
          3D rendering is unavailable. Open Ground track to inspect the
          trajectory.
        </div>
      )}
    </div>
  );
}
