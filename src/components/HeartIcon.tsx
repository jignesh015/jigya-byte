import Svg, { Path } from 'react-native-svg';
import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { useReducedMotion } from '../hooks/useReducedMotion';

export function HeartIcon({ filled = false, color, size = 26 }: { filled?: boolean; color: string; size?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const previous = useRef(filled);
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    const changed = previous.current !== filled;
    previous.current = filled;
    scale.stopAnimation();
    scale.setValue(1);
    if (!changed || reducedMotion) return;
    const animation = Animated.sequence([
      Animated.timing(scale, { toValue: 0.84, duration: 65, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 24, bounciness: 16, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [filled, reducedMotion, scale]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path
        d="M12 20.25C9.8 18.4 3 13.6 3 8.6A4.6 4.6 0 0 1 12 7.25 4.6 4.6 0 0 1 21 8.6c0 5-6.8 9.8-9 11.65Z"
        fill={filled ? color : 'none'}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
    </Animated.View>
  );
}
