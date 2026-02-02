'use client';

import { useEffect, useState } from 'react';

interface CrabSpriteProps {
  animation?: 'idle' | 'walk1' | 'walk2' | 'attack' | 'claws' | 'damage' | 'death';
  scale?: number;
  flipX?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

// Sprite sheet configurations
const SPRITE_CONFIG = {
  idle: { frames: 4, width: 128, src: '/sprites/crab/crab_idle.png' },
  walk1: { frames: 4, width: 128, src: '/sprites/crab/crab_walk1.png' },
  walk2: { frames: 8, width: 256, src: '/sprites/crab/crab_walk2.png' },
  attack: { frames: 6, width: 192, src: '/sprites/crab/crab_attack.png' },
  claws: { frames: 4, width: 128, src: '/sprites/crab/crab_claws.png' },
  damage: { frames: 3, width: 96, src: '/sprites/crab/crab_damage.png' },
  death: { frames: 4, width: 128, src: '/sprites/crab/crab_death.png' },
};

const FRAME_SIZE = 32;

export function CrabSprite({ 
  animation = 'idle', 
  scale = 1,
  flipX = false,
  className = '',
  style = {}
}: CrabSpriteProps) {
  const config = SPRITE_CONFIG[animation];
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const fps = animation === 'idle' ? 4 : 8; // Slower idle, faster walk
    const interval = setInterval(() => {
      setFrame(f => (f + 1) % config.frames);
    }, 1000 / fps);

    return () => clearInterval(interval);
  }, [animation, config.frames]);

  const spriteStyle: React.CSSProperties = {
    width: FRAME_SIZE * scale,
    height: FRAME_SIZE * scale,
    backgroundImage: `url(${config.src})`,
    backgroundPosition: `-${frame * FRAME_SIZE * scale}px 0`,
    backgroundSize: `${config.width * scale}px ${FRAME_SIZE * scale}px`,
    imageRendering: 'pixelated',
    transform: flipX ? 'scaleX(-1)' : undefined,
    ...style,
  };

  return (
    <div 
      className={`crab-sprite ${className}`}
      style={spriteStyle}
      aria-hidden="true"
    />
  );
}

// Agent crab with wandering animation
interface AgentCrabProps {
  agentName: string;
  agentId?: string;
  agentX?: number;
  agentY?: number;
  initialX: number;
  initialY: number;
  scale?: number;
  wanderRadius?: number;
  onClick?: (agentId: string, agentX: number, agentY: number) => void;
}

export function AgentCrab({
  agentName,
  agentId,
  agentX,
  agentY,
  initialX,
  initialY,
  scale = 1.5,
  wanderRadius = 15,
  onClick
}: AgentCrabProps) {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [isWalking, setIsWalking] = useState(false);
  const [flipX, setFlipX] = useState(Math.random() > 0.5);

  useEffect(() => {
    // Random delay before starting to move
    const initialDelay = Math.random() * 3000 + 1000;
    
    const startWandering = () => {
      const wanderInterval = setInterval(() => {
        // 30% chance to move
        if (Math.random() < 0.3) {
          setIsWalking(true);
          
          // Calculate new position within bounds
          const angle = Math.random() * Math.PI * 2;
          const distance = Math.random() * wanderRadius;
          const newX = initialX + Math.cos(angle) * distance;
          const newY = initialY + Math.sin(angle) * distance;
          
          // Determine direction for flip
          if (newX > position.x) {
            setFlipX(false);
          } else if (newX < position.x) {
            setFlipX(true);
          }
          
          setPosition({ x: newX, y: newY });
          
          // Stop walking after a short duration
          setTimeout(() => setIsWalking(false), 800);
        }
      }, 2000 + Math.random() * 2000);

      return wanderInterval;
    };

    const timeoutId = setTimeout(() => {
      const intervalId = startWandering();
      return () => clearInterval(intervalId);
    }, initialDelay);

    return () => clearTimeout(timeoutId);
  }, [initialX, initialY, wanderRadius, position.x]);

  const handleClick = () => {
    if (onClick && agentId && agentX !== undefined && agentY !== undefined) {
      onClick(agentId, agentX, agentY);
    }
  };

  return (
    <div
      className="agent-crab absolute transition-all duration-700 ease-in-out cursor-pointer group"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
        zIndex: 10,
      }}
      title={agentName}
      onClick={handleClick}
    >
      <CrabSprite 
        animation={isWalking ? 'walk1' : 'idle'} 
        scale={scale}
        flipX={flipX}
      />
      {/* Tooltip on hover */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 bg-[var(--foreground)] text-[var(--background)] text-[10px] font-bold rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
        {agentName}
      </div>
    </div>
  );
}
