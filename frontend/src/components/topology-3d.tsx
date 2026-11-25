import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

interface NodeData {
  id: string;
  type: 'task' | 'keeper' | 'cluster';
  position: THREE.Vector3;
  color: number;
  size: number;
  label: string;
  status: 'active' | 'idle' | 'failed';
}

interface EdgeData {
  from: string;
  to: string;
  type: 'dependency' | 'execution' | 'data';
  active: boolean;
}

interface TopologyConfig {
  maxNodes: number;
  particleDensity: number;
  animationSpeed: number;
  cameraDistance: number;
}

const DEFAULT_CONFIG: TopologyConfig = {
  maxNodes: 1000,
  particleDensity: 0.5,
  animationSpeed: 1.0,
  cameraDistance: 50,
};

export class TaskTopologyVisualizer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private nodes: Map<string, THREE.Mesh> = new Map();
  private edges: THREE.LineSegments | null = null;
  private particles: THREE.Points | null = null;
  private nodeData: Map<string, NodeData> = new Map();
  private edgeData: EdgeData[] = [];
  private animationId: number = 0;
  private config: TopologyConfig;
  private raycaster: THREE.Raycaster;
  private mouse: THREE.Vector2;
  private selectedNode: string | null = null;

  constructor(container: HTMLElement, config?: Partial<TopologyConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a1a);
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    this.camera = new THREE.PerspectiveCamera(
      75,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, this.config.cameraDistance);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.setupLights();
    this.setupParticles();

    this.animate();

    window.addEventListener('resize', () => this.onResize());
    this.renderer.domElement.addEventListener('click', (e) => this.onClick(e));
  }

  private setupLights(): void {
    const ambientLight = new THREE.AmbientLight(0x404040, 0.5);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 10, 10);
    this.scene.add(directionalLight);

    const pointLight = new THREE.PointLight(0x00ffff, 0.5);
    pointLight.position.set(-10, 0, 0);
    this.scene.add(pointLight);
  }

  private setupParticles(): void {
    const particleCount = Math.floor(5000 * this.config.particleDensity);
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 100;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 100;
    }

    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3)
    );

    const material = new THREE.PointsMaterial({
      size: 0.1,
      color: 0x444466,
      transparent: true,
      opacity: 0.5,
    });

    this.particles = new THREE.Points(geometry, material);
    this.scene.add(this.particles);
  }

  addNode(data: NodeData): void {
    const geometry = new THREE.SphereGeometry(data.size, 32, 32);
    const material = new THREE.MeshPhongMaterial({
      color: data.color,
      transparent: true,
      opacity: 0.8,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(data.position);
    mesh.userData = { id: data.id, type: data.type };

    this.scene.add(mesh);
    this.nodes.set(data.id, mesh);
    this.nodeData.set(data.id, data);

    if (data.status === 'active') {
      this.addPulseEffect(mesh, data.color);
    }
  }

  private addPulseEffect(mesh: THREE.Mesh, color: number): void {
    const pulseGeometry = new THREE.RingGeometry(0.1, 0.15, 32);
    const pulseMaterial = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const pulse = new THREE.Mesh(pulseGeometry, pulseMaterial);
    pulse.position.copy(mesh.position);
    pulse.lookAt(this.camera.position);

    this.scene.add(pulse);

    const scaleAnim = () => {
      const scale = 1 + Math.sin(Date.now() * 0.005) * 0.2;
      pulse.scale.set(scale, scale, scale);
      if (this.nodes.has(mesh.userData.id)) {
        requestAnimationFrame(scaleAnim);
      } else {
        this.scene.remove(pulse);
      }
    };
    requestAnimationFrame(scaleAnim);
  }

  addEdge(fromId: string, toId: string, type: EdgeData['type']): void {
    const fromNode = this.nodes.get(fromId);
    const toNode = this.nodes.get(toId);
    if (!fromNode || !toNode) return;

    this.edgeData.push({ from: fromId, to: toId, type, active: true });

    const points = [fromNode.position.clone(), toNode.position.clone()];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color:
        type === 'execution' ? 0x00ff00 : type === 'dependency' ? 0xffaa00 : 0x6666ff,
      transparent: true,
      opacity: 0.5,
    });

    const line = new THREE.Line(geometry, material);
    this.scene.add(line);
  }

  removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      this.scene.remove(node);
      this.nodes.delete(id);
      this.nodeData.delete(id);
    }
  }

  highlightNode(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.material.opacity = 1.0;
      node.scale.set(1.5, 1.5, 1.5);
      this.selectedNode = id;
    }
  }

  resetHighlight(id: string): void {
    const node = this.nodes.get(id);
    if (node) {
      node.material.opacity = 0.8;
      node.scale.set(1, 1, 1);
      this.selectedNode = null;
    }
  }

  private animate(): void {
    this.animationId = requestAnimationFrame(() => this.animate());
    this.controls.update();

    if (this.particles) {
      this.particles.rotation.y += 0.001 * this.config.animationSpeed;
    }

    this.nodes.forEach((node, id) => {
      const data = this.nodeData.get(id);
      if (data?.status === 'active') {
        node.material.emissiveIntensity = 0.3 + Math.sin(Date.now() * 0.005) * 0.2;
      }
    });

    this.renderer.render(this.scene, this.camera);
  }

  private onClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(Array.from(this.nodes.values()));

    if (intersects.length > 0) {
      const nodeId = intersects[0].object.userData.id;
      this.highlightNode(nodeId);
    }
  }

  private onResize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;

    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    this.renderer.dispose();
    this.controls.dispose();
  }

  getNodeCount(): number {
    return this.nodes.size;
  }

  getSelectedNode(): string | null {
    return this.selectedNode;
  }

  setAnimationSpeed(speed: number): void {
    this.config.animationSpeed = speed;
  }

  setCameraDistance(distance: number): void {
    this.config.cameraDistance = distance;
    this.camera.position.set(0, 0, distance);
  }
}

export function createTopologyVisualizer(
  containerId: string,
  config?: Partial<TopologyConfig>
): TaskTopologyVisualizer {
  const container = document.getElementById(containerId);
  if (!container) {
    throw new Error(`Container ${containerId} not found`);
  }
  return new TaskTopologyVisualizer(container, config);
}
