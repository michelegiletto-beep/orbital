import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetPath } from "./assets.js";
import type { RelativeState } from "../../../packages/sim-core/src/proximity.js";
export function ProximityScene({
  state,
  range,
  recovery,
  targetRate = recovery ? 0.8 : 0,
}: {
  state: Pick<RelativeState, "position" | "time" | "angle" | "captured">;
  range: number;
  recovery: boolean;
  targetRate?: number;
}) {
  const host = useRef<HTMLDivElement>(null),
    objects = useRef<{
      vehicle: THREE.Group;
      target: THREE.Group;
      controls: OrbitControls;
    } | null>(null);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor("#06111e");
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "Spacecraft and target near Earth. Vehicle scale is exaggerated.",
    );
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1000);
    camera.position.set(0, 8, 34);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-2, 0, 0);
    controls.enableDamping = true;
    controls.minDistance = 6;
    controls.maxDistance = 60;
    const metal = new THREE.MeshStandardMaterial({
        color: "#d6dce2",
        metalness: 0.65,
        roughness: 0.4,
      }),
      dark = new THREE.MeshStandardMaterial({
        color: "#1c3b5e",
        metalness: 0.55,
        roughness: 0.35,
      }),
      gold = new THREE.MeshStandardMaterial({
        color: "#c1a175",
        metalness: 0.7,
        roughness: 0.5,
      });
    const cylinder = (r: number, length: number, material: THREE.Material) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, length, 32),
        material,
      );
      m.rotation.z = Math.PI / 2;
      return m;
    };
    const target = new THREE.Group();
    target.position.x = 4;
    const body = cylinder(recovery ? 0.55 : 0.7, recovery ? 1.3 : 2.5, metal);
    target.add(body);
    const port = cylinder(0.34, 0.25, dark);
    port.position.x = recovery ? -0.75 : -1.35;
    target.add(port);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.37, 0.045, 12, 40),
      gold,
    );
    ring.rotation.y = Math.PI / 2;
    ring.position.x = port.position.x - 0.15;
    target.add(ring);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 7, 0.12), metal);
    target.add(strut);
    for (const direction of [-1, 1]) {
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 2.3, 0.055),
        dark,
      );
      panel.position.y = direction * 2.5;
      target.add(panel);
      for (let i = 0; i < 6; i++) {
        const line = new THREE.Mesh(
          new THREE.BoxGeometry(1.69, 0.012, 0.06),
          metal,
        );
        line.position.set(0, direction * 2.5 - 1.1 + i * 0.44, 0.01);
        target.add(line);
      }
    }
    const vehicle = new THREE.Group();
    vehicle.add(cylinder(0.4, 1.1, gold));
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.5, 32), metal);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 0.8;
    vehicle.add(nose);
    for (const d of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.8, 0.04), dark);
      panel.position.y = d * 1.4;
      vehicle.add(panel);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), metal);
      arm.position.y = d * 0.65;
      vehicle.add(arm);
    }
    scene.add(target, vehicle);
    objects.current = { vehicle, target, controls };
    const corridorMaterial = new THREE.LineBasicMaterial({
      color: "#5d8da9",
      transparent: true,
      opacity: 0.24,
    });
    for (let i = 0; i < 7; i++) {
      const ring = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(
          Array.from(
            { length: 64 },
            (_, j) =>
              new THREE.Vector3(
                0,
                Math.cos((j / 64) * Math.PI * 2) * 0.7,
                Math.sin((j / 64) * Math.PI * 2) * 0.7,
              ),
          ),
        ),
        corridorMaterial,
      );
      ring.position.x = 2.5 - i * 2;
      scene.add(ring);
    }
    const texture = new THREE.TextureLoader().load(
      assetPath("earth/surface.jpg"),
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(35, 96, 64),
      new THREE.MeshBasicMaterial({ map: texture, color: "#344d69" }),
    );
    earth.position.set(8, -37, -35);
    earth.rotation.set(0.1, 2, 0.2);
    scene.add(earth);
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(35.15, 64, 48),
      new THREE.MeshBasicMaterial({
        color: "#80b9fa",
        transparent: true,
        opacity: 0.06,
        side: THREE.BackSide,
      }),
    );
    atmosphere.position.copy(earth.position);
    scene.add(atmosphere);
    scene.add(new THREE.HemisphereLight("#e2efff", "#39506c", 2));
    const light = new THREE.DirectionalLight("#fff1d9", 4);
    light.position.set(-5, 9, 15);
    scene.add(light);
    const resize = new ResizeObserver(() => {
      camera.aspect = element.clientWidth / element.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(element.clientWidth, element.clientHeight);
    });
    resize.observe(element);
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    return () => {
      objects.current = null;
      resize.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      texture.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((a) => a.dispose());
        else m?.dispose();
      });
      renderer.dispose();
      element.removeChild(renderer.domElement);
    };
  }, [recovery]);
  useEffect(() => {
    const o = objects.current;
    if (!o) return;
    const k = 10 / range;
    o.vehicle.position.set(
      4 - (recovery ? 1.9 : 2.5) + state.position[1] * k,
      state.position[0] * k,
      state.position[2] * k,
    );
    o.target.rotation.x = (state.time * targetRate * Math.PI) / 180;
    o.vehicle.rotation.x = o.target.rotation.x + (state.angle * Math.PI) / 180;
    if (state.captured) {
      o.vehicle.rotation.x = o.target.rotation.x;
      o.vehicle.position.x = 4 - (recovery ? 1.9 : 2.5);
    }
    o.controls.target.set(
      (o.vehicle.position.x + o.target.position.x) / 2,
      o.vehicle.position.y / 2,
      o.vehicle.position.z / 2,
    );
  }, [state, range, recovery, targetRate]);
  return <div className="proximity-canvas" ref={host} />;
}
