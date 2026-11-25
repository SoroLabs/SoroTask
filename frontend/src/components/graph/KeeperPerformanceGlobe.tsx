import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three'; // Assuming Three.js for WebGL abstraction

class GlobeErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean, error: Error | null}> {
    constructor(props: {children: React.ReactNode}) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error: Error) {
        return { hasError: true, error };
    }
    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error("KeeperPerformanceGlobe WebGL Context Lost or Error:", error, errorInfo);
        // Dispatch to tracking service
    }
    render() {
        if (this.state.hasError) {
            return (
                <div className="p-6 border border-gray-200 rounded-lg bg-gray-50 flex items-center justify-center h-64">
                    <p className="text-gray-500 text-sm">3D Visualization unavailable. <br/> Hardware acceleration may be disabled.</p>
                </div>
            );
        }
        return this.props.children;
    }
}

const GlobeCore: React.FC = () => {
    const mountRef = useRef<HTMLDivElement>(null);
    const [status, setStatus] = useState<'initializing' | 'active' | 'degraded'>('initializing');

    useEffect(() => {
        let isMounted = true;
        if (!mountRef.current) return;

        let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;
        let sphere: THREE.Mesh;
        let animationFrameId: number;

        try {
            // Scene Setup
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000);
            
            renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
            renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
            renderer.setPixelRatio(window.devicePixelRatio);
            mountRef.current.appendChild(renderer.domElement);

            // Geometry & Material
            const geometry = new THREE.SphereGeometry(2, 32, 32);
            // In a real app, this would use a shader material representing real-time keeper activity
            const material = new THREE.MeshBasicMaterial({ 
                color: 0x3b82f6, 
                wireframe: true,
                transparent: true,
                opacity: 0.6
            });
            sphere = new THREE.Mesh(geometry, material);
            scene.add(sphere);

            camera.position.z = 5;

            // Fault-tolerant resize handler
            const handleResize = () => {
                if (!mountRef.current || !camera || !renderer) return;
                camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
            };
            window.addEventListener('resize', handleResize);

            // Animation Loop
            const animate = () => {
                animationFrameId = requestAnimationFrame(animate);
                if (sphere) {
                    sphere.rotation.x += 0.005;
                    sphere.rotation.y += 0.005;
                }
                renderer.render(scene, camera);
            };
            animate();
            
            if (isMounted) setStatus('active');

            return () => {
                window.removeEventListener('resize', handleResize);
                cancelAnimationFrame(animationFrameId);
                if (mountRef.current && renderer.domElement) {
                    mountRef.current.removeChild(renderer.domElement);
                }
                renderer.dispose();
                geometry.dispose();
                material.dispose();
            };
        } catch (err) {
            console.error("WebGL Initialization failed:", err);
            if (isMounted) setStatus('degraded');
        }
    }, []);

    return (
        <div className="relative w-full h-96 bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-800">
            <div className="absolute top-4 left-4 z-10">
                <h3 className="text-white font-medium text-lg tracking-tight">Real-time Keeper Network</h3>
                <div className="flex items-center mt-1 space-x-2">
                    <div className={`w-2 h-2 rounded-full ${status === 'active' ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                    <span className="text-slate-400 text-xs uppercase tracking-wider">{status}</span>
                </div>
            </div>
            <div ref={mountRef} className="w-full h-full" />
        </div>
    );
};

export const KeeperPerformanceGlobe: React.FC = () => (
    <GlobeErrorBoundary>
        <GlobeCore />
    </GlobeErrorBoundary>
);
