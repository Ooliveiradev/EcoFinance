import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, {
  Defs,
  RadialGradient,
  LinearGradient,
  Stop,
  Rect,
  G,
  Path,
  Circle,
} from 'react-native-svg';

interface LogoProps {
  size?: number;
  animate?: boolean;
}

export function Logo({ size = 120, animate = false }: LogoProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animate) return;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.06,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [animate, scaleAnim]);

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], width: size, height: size }}>
      <Svg viewBox="0 0 512 512" width={size} height={size}>
        <Defs>
          <RadialGradient id="bgGlow" cx="50%" cy="45%" r="65%">
            <Stop offset="0%" stopColor="#141E30" />
            <Stop offset="100%" stopColor="#060913" />
          </RadialGradient>
          <LinearGradient id="neonGreen" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#047857" />
            <Stop offset="50%" stopColor="#10B981" />
            <Stop offset="100%" stopColor="#34D399" />
          </LinearGradient>
          <LinearGradient id="glowingLine" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop offset="0%" stopColor="#10B981" stopOpacity="0" />
            <Stop offset="70%" stopColor="#34D399" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#FFFFFF" />
          </LinearGradient>
        </Defs>

        {/* Background squircle */}
        <Rect width="512" height="512" rx="128" fill="url(#bgGlow)" />
        {/* Inner border */}
        <Rect
          x="2" y="2" width="508" height="508" rx="126"
          fill="none" stroke="#10B981" strokeOpacity="0.15" strokeWidth="4"
        />

        <G>
          {/* Leaf glow shadow */}
          <Path
            d="M160,340 C140,210 210,140 330,170 C310,300 240,370 160,340 Z"
            fill="#10B981"
            opacity="0.18"
          />
          {/* Leaf */}
          <Path
            d="M160,340 C140,210 210,140 330,170 C280,260 220,320 160,340 Z"
            fill="url(#neonGreen)"
          />
          {/* Leaf highlight */}
          <Path
            d="M160,340 C190,260 240,200 330,170 C280,260 220,320 160,340 Z"
            fill="#FFFFFF"
            opacity="0.12"
          />

          {/* Trend line */}
          <Path
            d="M120,380 L360,140"
            fill="none"
            stroke="url(#glowingLine)"
            strokeWidth="24"
            strokeLinecap="round"
          />
          {/* Arrow tip */}
          <Path
            d="M280,140 L360,140 L360,220"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="24"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* GPS node glow */}
          <Circle cx="240" cy="260" r="22" fill="#10B981" opacity="0.45" />
          {/* GPS node white ring */}
          <Circle cx="240" cy="260" r="18" fill="#FFFFFF" />
          {/* GPS node inner */}
          <Circle cx="240" cy="260" r="10" fill="#34D399" />
        </G>
      </Svg>
    </Animated.View>
  );
}
