'use client';

import { useEffect, useRef } from 'react';

export function FalconSpinner() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<() => void>();

  useEffect(() => {
    if (!containerRef.current) return;

    // Load Three.js and GSAP dynamically
    const loadScripts = async () => {
      // Check if scripts are already loaded
      if (!(window as any).THREE) {
        const threeScript = document.createElement('script');
        threeScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
        document.head.appendChild(threeScript);
        await new Promise(resolve => { threeScript.onload = resolve; });
      }

      if (!(window as any).gsap) {
        const gsapScript = document.createElement('script');
        gsapScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.9.1/gsap.min.js';
        document.head.appendChild(gsapScript);
        await new Promise(resolve => { gsapScript.onload = resolve; });
      }

      // Initialize the spinner
      initSpinner();
    };

    const initSpinner = () => {
      const THREE = (window as any).THREE;
      const gsap = (window as any).gsap;

      if (!THREE || !gsap || !containerRef.current) return;

      // Clear any existing content
      containerRef.current.innerHTML = '';

      // Configuration
      const CUBE_SIZE = 0.4;
      const GAP = 0.05;
      const ANIMATION_SPEED = 1.5;
      const STAGGER = 0.01;

      // Pixel map - Falcon shield + crown
      const PIXEL_MAP = [
        "00000000000000000000",
        "00100010001000100000",
        "00111111111111100000",
        "00111111111111100000",
        "00100000000000100000",
        "00100011100000100000",
        "00100110000000100000",
        "00100111100000100000",
        "00100001110000100000",
        "00100000111000100000",
        "00100000111100100000",
        "00100000101110100000",
        "00100000100111100000",
        "00100000100011100000",
        "00100000100001100000",
        "00100001110000100000",
        "00100011111000100000",
        "00011111111111000000",
        "00001111111110000000",
        "00000111111100000000",
        "00000001110000000000",
        "00000000000000000000"
      ];

      // Scene setup
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
      camera.position.set(0, 0, 25);

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setSize(400, 400);
      renderer.setPixelRatio(window.devicePixelRatio);
      containerRef.current!.appendChild(renderer.domElement);

      const shieldGroup = new THREE.Group();
      scene.add(shieldGroup);

      // Materials
      const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
      const materialBody = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const materialEdges = new THREE.LineBasicMaterial({ color: 0xaaaaaa });

      const voxels: any[] = [];
      const rows = PIXEL_MAP.length;
      const cols = PIXEL_MAP[0].length;

      const offsetX = (cols * (CUBE_SIZE + GAP)) / 2;
      const offsetY = (rows * (CUBE_SIZE + GAP)) / 2;

      // Build voxels
      PIXEL_MAP.forEach((rowString, rowIndex) => {
        for (let colIndex = 0; colIndex < rowString.length; colIndex++) {
          if (rowString[colIndex] === '1') {
            const cube = new THREE.Mesh(geometry, materialBody);
            const edges = new THREE.EdgesGeometry(geometry);
            const line = new THREE.LineSegments(edges, materialEdges);
            cube.add(line);

            const targetX = (colIndex * (CUBE_SIZE + GAP)) - offsetX;
            const targetY = ((rows - rowIndex) * (CUBE_SIZE + GAP)) - offsetY;
            const targetZ = 0;

            cube.position.set(
              (Math.random() - 0.5) * 20,
              -10,
              (Math.random() - 0.5) * 10
            );

            cube.rotation.set(
              Math.random() * Math.PI,
              Math.random() * Math.PI,
              Math.random() * Math.PI
            );

            cube.userData = { targetX, targetY, targetZ };

            shieldGroup.add(cube);
            voxels.push(cube);
          }
        }
      });

      // Animation loop
      let animationFrameId: number;
      let timeoutIds: number[] = [];

      function startAnimationLoop() {
        // Assemble phase
        voxels.forEach((cube, index) => {
          gsap.to(cube.position, {
            x: cube.userData.targetX,
            y: cube.userData.targetY,
            z: cube.userData.targetZ,
            duration: ANIMATION_SPEED,
            ease: "back.out(1.2)",
            delay: index * STAGGER
          });

          gsap.to(cube.rotation, {
            x: 0,
            y: 0,
            z: 0,
            duration: ANIMATION_SPEED,
            delay: index * STAGGER
          });
        });

        // Disassemble phase
        const totalTime = ANIMATION_SPEED + (voxels.length * STAGGER) + 1.5;

        const disassembleTimeout = window.setTimeout(() => {
          voxels.forEach((cube, index) => {
            gsap.to(cube.position, {
              x: (Math.random() - 0.5) * 20,
              y: -15 - Math.random() * 5,
              z: (Math.random() - 0.5) * 10,
              duration: 1,
              ease: "power2.in",
              delay: index * 0.005
            });

            gsap.to(cube.rotation, {
              x: Math.random() * Math.PI,
              y: Math.random() * Math.PI,
              duration: 1,
              delay: index * 0.005
            });
          });
        }, totalTime * 1000);

        timeoutIds.push(disassembleTimeout);

        // Restart loop
        const restartTimeout = window.setTimeout(startAnimationLoop, (totalTime + 1.5) * 1000);
        timeoutIds.push(restartTimeout);
      }

      startAnimationLoop();

      // Render loop
      function animate() {
        animationFrameId = requestAnimationFrame(animate);
        shieldGroup.rotation.y = Math.sin(Date.now() * 0.001) * 0.1;
        renderer.render(scene, camera);
      }
      animate();

      // Cleanup function
      cleanupRef.current = () => {
        cancelAnimationFrame(animationFrameId);
        timeoutIds.forEach(id => clearTimeout(id));
        gsap.killTweensOf(voxels);
        if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
          containerRef.current.removeChild(renderer.domElement);
        }
        renderer.dispose();
      };
    };

    loadScripts();

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <div ref={containerRef} className="w-[400px] h-[400px]" />
        <p className="text-white text-lg font-medium animate-pulse">
          Genererar presentation...
        </p>
      </div>
    </div>
  );
}
