import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';

export function ReaderTransition({ children, reducedMotion }: { children: ReactNode; reducedMotion: boolean }) {
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reducedMotion) { progress.stopAnimation(); progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return <Animated.View style={{ flex: 1, opacity: progress, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }] }}>{children}</Animated.View>;
}
