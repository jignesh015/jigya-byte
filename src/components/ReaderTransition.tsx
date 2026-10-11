import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Dimensions, Easing } from 'react-native';

export function ReaderTransition({ children, reducedMotion, onSwipeBack }: { children: ReactNode; reducedMotion: boolean; onSwipeBack?: () => void }) {
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const gestureStart = useRef({ x: 0, y: 0, startedAt: 0 });
  const onSwipeBackRef = useRef(onSwipeBack);
  onSwipeBackRef.current = onSwipeBack;
  const screenWidth = Dimensions.get('window').width;
  const systemBackEdge = 32;

  useEffect(() => {
    if (reducedMotion) { progress.stopAnimation(); progress.setValue(1); return; }
    const animation = Animated.timing(progress, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);

  return (
    <Animated.View
      style={{ flex: 1, backgroundColor: '#090a0a', transform: [{ translateX: dragX }] }}
      onTouchStart={(event) => {
        gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, startedAt: Date.now() };
      }}
      onMoveShouldSetResponderCapture={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const startedAwayFromBackEdges = gestureStart.current.x > systemBackEdge
          && gestureStart.current.x < screenWidth - systemBackEdge;
        return Boolean(onSwipeBackRef.current) && startedAwayFromBackEdges
          && deltaX > 6 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
      }}
      onResponderMove={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        dragX.setValue(Math.max(0, Math.min(screenWidth, deltaX)));
      }}
      onResponderRelease={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const elapsed = Math.max(1, Date.now() - gestureStart.current.startedAt);
        const quickFlick = deltaX >= 18 && deltaX / elapsed >= 0.55;
        const shouldGoBack = deltaX >= Math.max(34, screenWidth * 0.12) || quickFlick;
        if (shouldGoBack && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
          Animated.timing(dragX, { toValue: screenWidth, duration: 110, useNativeDriver: false }).start(({ finished }) => {
            if (finished) onSwipeBackRef.current?.();
            else dragX.setValue(0);
          });
        } else {
          Animated.spring(dragX, { toValue: 0, tension: 160, friction: 20, useNativeDriver: false }).start();
        }
      }}
      onResponderTerminate={() => Animated.spring(dragX, { toValue: 0, tension: 160, friction: 20, useNativeDriver: false }).start()}
      onResponderTerminationRequest={() => false}
    >
      <Animated.View
        style={{
          flex: 1,
          opacity: progress,
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }) }],
        }}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
