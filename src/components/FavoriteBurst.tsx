import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// A small, fixed fan keeps the burst inside the feed's right edge.
const particles = [
  { x: -68, y: -36, size: 4, kind: 'dot' },
  { x: -54, y: -66, size: 9, kind: 'heart' },
  { x: -35, y: -48, size: 5, kind: 'spark' },
  { x: -24, y: -83, size: 4, kind: 'dot' },
  { x: -6, y: -61, size: 8, kind: 'heart' },
  { x: 12, y: -78, size: 3, kind: 'dot' },
  { x: 28, y: -52, size: 6, kind: 'spark' },
  { x: 35, y: -24, size: 4, kind: 'dot' },
  { x: -44, y: 10, size: 3, kind: 'dot' },
  { x: 18, y: 15, size: 3, kind: 'dot' },
] as const;

export function FavoriteBurst({
  filled, active, reducedMotion, color, children,
}: {
  filled: boolean;
  active: boolean;
  reducedMotion: boolean;
  color: string;
  children: ReactNode;
}) {
  const previous = useRef(filled);
  const progress = useRef(new Animated.Value(0)).current;
  const [bursting, setBursting] = useState(false);

  useEffect(() => {
    const justFavorited = filled && !previous.current;
    previous.current = filled;
    if (!active || reducedMotion || !filled) {
      setBursting(false);
    } else if (justFavorited) {
      setBursting(true);
    }
  }, [filled, active, reducedMotion]);

  useEffect(() => {
    if (!bursting) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 620,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start(({ finished }) => { if (finished) setBursting(false); });
    return () => animation.stop();
  }, [bursting, progress]);

  return (
    <View style={styles.anchor}>
      {children}
      {bursting && active && !reducedMotion && (
        <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.overlay}>
          <View style={styles.origin}>
            <Animated.View style={[
              styles.ring,
              {
                borderColor: color,
                opacity: progress.interpolate({ inputRange: [0, 0.1, 0.5, 1], outputRange: [0, 0.45, 0, 0] }),
                transform: [{ scale: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.5, 1.8, 1.8] }) }],
              },
            ]} />
            {particles.map((particle, index) => (
              <Animated.View key={index} style={[
                styles.particle,
                {
                  width: particle.size,
                  height: particle.size,
                  left: -particle.size / 2,
                  top: -particle.size / 2,
                  opacity: progress.interpolate({ inputRange: [0, 0.08, 0.45, 1], outputRange: [0, 1, 0.85, 0] }),
                  transform: [
                    { translateX: progress.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0, particle.x * 0.48, particle.x * 0.88, particle.x] }) },
                    { translateY: progress.interpolate({ inputRange: [0, 0.2, 0.6, 1], outputRange: [0, particle.y * 0.5, particle.y, particle.y + 12] }) },
                    { scale: progress.interpolate({ inputRange: [0, 0.12, 0.55, 1], outputRange: [0.3, 1.15, 0.9, 0.3] }) },
                    { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${index % 2 === 0 ? 35 : -30}deg`] }) },
                  ],
                },
              ]}>
                {particle.kind === 'heart' ? (
                  <Svg width={particle.size} height={particle.size} viewBox="0 0 24 24" accessible={false}>
                    <Path d="M12 20.25C9.8 18.4 3 13.6 3 8.6A4.6 4.6 0 0 1 12 7.25 4.6 4.6 0 0 1 21 8.6c0 5-6.8 9.8-9 11.65Z" fill={color} />
                  </Svg>
                ) : particle.kind === 'spark' ? (
                  <Svg width={particle.size} height={particle.size} viewBox="0 0 12 12" accessible={false}>
                    <Path d="M6 0 7.5 4.5 12 6 7.5 7.5 6 12 4.5 7.5 0 6 4.5 4.5Z" fill={color} />
                  </Svg>
                ) : (
                  <View style={{ width: particle.size, height: particle.size, borderRadius: particle.size / 2, backgroundColor: color }} />
                )}
              </Animated.View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { position: 'relative', overflow: 'visible' },
  overlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'visible' },
  origin: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, overflow: 'visible' },
  particle: { position: 'absolute' },
  ring: { position: 'absolute', left: -17, top: -17, width: 34, height: 34, borderRadius: 17, borderWidth: 1 },
});
