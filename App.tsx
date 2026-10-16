import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Animated,
  BackHandler,
  Dimensions,
  Easing,
  Linking,
  PanResponder,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { HeartIcon } from './src/components/HeartIcon';
import { FavoriteBurst } from './src/components/FavoriteBurst';
import { ReaderTransition } from './src/components/ReaderTransition';
import { useReducedMotion } from './src/hooks/useReducedMotion';
import { feedSwipeTarget } from './src/components/feedGesture';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  getAnalytics,
  getCards,
  getInterests,
  getRecentlyShownCardIds,
  initializeDatabase,
  recordCardImpression,
  recordInteraction,
  saveInterests,
  scheduleReview,
  setFavorite,
  type AnalyticsMetric,
  type AnalyticsSnapshot,
  type Card,
  type FeedLane,
  cleanupReadBodies,
  getPersistentFeed,
  getInventory,
  protectCardBodies,
} from './src/data/database';
import { type FeedAssignment } from './src/data/feed';
import { defaultBackendSettings, getBackendSettings, saveBackendSettings, type BackendSettings } from './src/data/backendConnection';
import { BackendSync, type BackendStatus } from './src/data/backendSync';
import { topicColor, topics } from './src/data/cardContent';

const colors = {
  background: '#090a0a',
  surface: '#111313',
  surfaceRaised: '#171a19',
  border: '#2c302f',
  text: '#f3f3ee',
  muted: '#a1a7a3',
  accent: '#c8f45a',
  accentDim: '#1b2612',
  danger: '#3c211d',
};

type Tab = 'feed' | 'favorites' | 'analytics' | 'settings';
type AppView = 'main' | 'detail' | 'interests';
type DiscoveryNotice = { kind: 'success' | 'info' | 'offline' | 'error'; message: string; state?: string; added?: number } | null;

const metricLabels: Record<AnalyticsMetric, string> = {
  seen: 'Seen',
  expanded: 'Expanded',
  favorites: 'Favorites',
};

function topicName(topicId: string): string {
  return topics.find((topic) => topic.id === topicId)?.name ?? topicId;
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children.toUpperCase()}</Text>;
}

function FloatingDiscoveryToast({ notice, reducedMotion, onDismiss }: {
  notice: NonNullable<DiscoveryNotice>;
  reducedMotion: boolean;
  onDismiss: () => void;
}) {
  const slide = useRef(new Animated.Value(1)).current;
  const horizontal = useRef(new Animated.Value(0)).current;
  const dismissing = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const width = Dimensions.get('window').width;
  const dismiss = useCallback((direction: number) => {
    if (dismissing.current) return;
    dismissing.current = true;
    Animated.timing(horizontal, { toValue: direction * width, duration: reducedMotion ? 0 : 180,
      easing: Easing.out(Easing.quad), useNativeDriver: true }).start(({ finished }) => { if (finished) onDismissRef.current(); });
  }, [horizontal, reducedMotion, width]);
  const responder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderMove: (_, gesture) => { if (!dismissing.current) horizontal.setValue(gesture.dx); },
    onPanResponderRelease: (_, gesture) => {
      if (Math.abs(gesture.dx) > 60 || Math.abs(gesture.vx) > 0.5 && Math.abs(gesture.dx) > 15) dismiss(gesture.dx < 0 ? -1 : 1);
      else Animated.spring(horizontal, { toValue: 0, useNativeDriver: true }).start();
    },
    onPanResponderTerminate: () => Animated.spring(horizontal, { toValue: 0, useNativeDriver: true }).start(),
  }), [dismiss, horizontal]);

  useEffect(() => {
    dismissing.current = false;
    horizontal.stopAnimation(); horizontal.setValue(0);
    slide.setValue(1);
    Animated.timing(slide, {
      toValue: 0, duration: reducedMotion ? 0 : 220,
      easing: Easing.out(Easing.cubic), useNativeDriver: true,
    }).start();
    return () => { slide.stopAnimation(); horizontal.stopAnimation(); };
  }, [notice, reducedMotion, slide, horizontal]);

  useEffect(() => {
    const timeout = setTimeout(() => dismiss(1), 5000);
    return () => clearTimeout(timeout);
  }, [dismiss, notice]);

  return (
    <Animated.View
      style={[styles.discoveryToast, {
        transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [0, -140] }) }],
        opacity: slide.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
      }]}
    >
      <Animated.View
        {...responder.panHandlers}
        accessible
        accessibilityLabel={`${notice.message} Swipe left or right to dismiss`}
        accessibilityLiveRegion="polite"
        accessibilityActions={[{ name: 'dismiss', label: 'Dismiss notification' }]}
        onAccessibilityAction={event => { if (event.nativeEvent.actionName === 'dismiss') dismiss(1); }}
        style={[styles.providerNotice, (notice.kind === 'error' || notice.kind === 'offline') && styles.providerNoticeOffline,
          { transform: [{ translateX: horizontal }], opacity: horizontal.interpolate({ inputRange: [-width, 0, width], outputRange: [0, 1, 0] }) }]}
      >
        <Text style={styles.providerNoticeText}>{notice.message}</Text>
        <Text style={styles.providerNoticeHint}>Swipe to dismiss</Text>
      </Animated.View>
    </Animated.View>
  );
}

const CardDescription = memo(function CardDescription({ text }: { text: string }) {
  const [space, setSpace] = useState({ width: 0, height: 0 });
  const fontSize = useMemo(() => {
    if (space.width <= 0 || space.height <= 0) return 18;

    const characterCount = Math.max(1, text.trim().length);
    let bestFit = 18;
    for (let candidate = 18; candidate <= 52; candidate += 1) {
      const estimatedCharactersPerLine = space.width / (candidate * 0.52);
      const estimatedLines = Math.ceil(characterCount / estimatedCharactersPerLine);
      const estimatedHeight = estimatedLines * candidate * 1.42;
      if (estimatedHeight > space.height * 0.9) break;
      bestFit = candidate;
    }
    return bestFit;
  }, [space.height, space.width, text]);
  const lineHeight = fontSize * 1.42;
  const maxLines = space.height > 0 ? Math.max(1, Math.floor((space.height * 0.98) / lineHeight)) : undefined;

  return (
    <View
      style={styles.cardSummarySpace}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSpace((current) => current.width === width && current.height === height ? current : { width, height });
      }}
    >
      <Text
        numberOfLines={maxLines}
        style={[styles.cardSummary, { fontSize, lineHeight }]}
      >
        {text}
      </Text>
    </View>
  );
});

function ActionButton({
  label,
  onPress,
  selected = false,
  compact = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  selected?: boolean;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        compact && styles.actionButtonCompact,
        selected && styles.actionButtonSelected,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, selected && styles.actionTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function FeedScreen({
  cards,
  assignments,
  active,
  discoveryBusy,
  geminiEnabled,
  onFavorite,
  onOpenDetails,
  onSeen,
  onOpenSettings,
  onDiscover,
  refreshing,
  onRefresh,
}: {
  cards: Card[];
  assignments: FeedAssignment[];
  active: boolean;
  discoveryBusy: boolean;
  geminiEnabled: boolean;
  onFavorite: (card: Card) => void;
  onOpenDetails: (card: Card) => void;
  onSeen: (cardId: string, lane: FeedLane) => Promise<void>;
  onOpenSettings: () => void;
  onDiscover: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const scrollMetrics = useRef({ offset: 0, viewportHeight: 0 });
  const reportedSeen = useRef(new Set<string>());
  const scrollRef = useRef<ScrollView | null>(null);
  const currentIndex = useRef(0);
  const gestureStart = useRef({ x: 0, y: 0, startedAt: 0 });
  const gestureAxis = useRef<'horizontal' | 'vertical' | null>(null);
  const gesturePage = useRef(0);
  const lastCardTap = useRef({ cardId: '', at: 0 });
  const swipeX = useRef(new Animated.Value(0)).current;
  const pullY = useRef(new Animated.Value(0)).current;
  const reducedMotion = useReducedMotion();
  const wasActive = useRef(false);
  const screenWidth = Dimensions.get('window').width;
  const backGestureEdge = 32;
  const [pageHeight, setPageHeight] = useState(0);

  const registerCardTap = useCallback((card: Card) => {
    const now = Date.now();
    if (lastCardTap.current.cardId === card.id && now - lastCardTap.current.at <= 360) {
      lastCardTap.current = { cardId: '', at: 0 };
      void onFavorite(card);
      return;
    }
    lastCardTap.current = { cardId: card.id, at: now };
  }, [onFavorite]);

  const reportSeen = useCallback((index: number) => {
    if (!active || scrollMetrics.current.viewportHeight <= 0) return;
    const assignment = assignments[index];
    if (!assignment || !cardsById.has(assignment.cardId) || reportedSeen.current.has(assignment.cardId)) return;
    reportedSeen.current.add(assignment.cardId);
    void onSeen(assignment.cardId, assignment.lane).catch(() => reportedSeen.current.delete(assignment.cardId));
  }, [active, assignments, cardsById, onSeen]);

  useEffect(() => { if (active && pageHeight > 0) reportSeen(currentIndex.current); }, [active, pageHeight, reportSeen]);

  useEffect(() => {
    if (active && !wasActive.current) {
      requestAnimationFrame(() => {
        swipeX.setValue(0);
        const maxOffset = Math.max(0, assignments.length * scrollMetrics.current.viewportHeight);
        const offset = Math.min(currentIndex.current * scrollMetrics.current.viewportHeight, maxOffset);
        scrollMetrics.current.offset = offset;
        currentIndex.current = scrollMetrics.current.viewportHeight > 0
          ? Math.round(offset / scrollMetrics.current.viewportHeight)
          : 0;
        scrollRef.current?.scrollTo({ y: offset, animated: false });
        reportSeen(currentIndex.current);
      });
    } else if (!active && wasActive.current) {
      // The detail overlay is already mounted by the time this effect runs, so reset behind it.
      swipeX.setValue(0);
    }
    wasActive.current = active;
  }, [active, assignments.length, reportSeen, swipeX]);

  return (
    <Animated.View
      style={styles.feedRoot}
      onTouchStart={(event) => {
        gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, startedAt: Date.now() };
        gesturePage.current = currentIndex.current;
        gestureAxis.current = null;
      }}
      onMoveShouldSetResponderCapture={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const startedAwayFromBackEdges = gestureStart.current.x > backGestureEdge
          && gestureStart.current.x < screenWidth - backGestureEdge;
        if (!active || assignments.length === 0) return false;
        if (scrollMetrics.current.viewportHeight > 0 && Math.abs(deltaY) >= 3 && Math.abs(deltaY) > Math.abs(deltaX) * 1.15) {
          gestureAxis.current = 'vertical';
          return true;
        }
        if (startedAwayFromBackEdges && deltaX < -6 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
          gestureAxis.current = 'horizontal';
          return true;
        }
        return false;
      }}
      onResponderGrant={() => {
        // Stop an unfinished settle before following the next finger movement.
        scrollRef.current?.scrollTo({ y: gesturePage.current * scrollMetrics.current.viewportHeight, animated: false });
      }}
      onResponderMove={(event) => {
        if (gestureAxis.current === 'vertical') {
          const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
          const height = scrollMetrics.current.viewportHeight;
          // Native touch scrolling is disabled: this handler owns both drag and settle.
          const offset = Math.max(0, Math.min(assignments.length * height, gesturePage.current * height - deltaY));
          scrollRef.current?.scrollTo({ y: offset, animated: false });
          if (gesturePage.current === 0) pullY.setValue(Math.min(80, Math.max(0, deltaY * 0.4)));
          return;
        }
        if (gestureAxis.current !== 'horizontal') return;
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        swipeX.setValue(Math.max(-screenWidth, Math.min(0, deltaX)));
      }}
      onResponderRelease={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const axis = gestureAxis.current;
        gestureAxis.current = null;
        const elapsed = Math.max(1, Date.now() - gestureStart.current.startedAt);
        if (axis === 'vertical') {
          const viewportHeight = scrollMetrics.current.viewportHeight;
          const nextIndex = feedSwipeTarget(gesturePage.current, assignments.length, deltaY);
          if (gesturePage.current === 0 && deltaY >= 64 && !refreshing) onRefresh();
          Animated.timing(pullY, { toValue: 0, duration: reducedMotion ? 0 : 180, useNativeDriver: true }).start();
          if (nextIndex !== currentIndex.current) {
            currentIndex.current = nextIndex;
            reportSeen(nextIndex);
          }
          scrollMetrics.current.offset = nextIndex * viewportHeight;
          scrollRef.current?.scrollTo({ y: scrollMetrics.current.offset, animated: !reducedMotion });
          return;
        }
        const card = cardsById.get(assignments[currentIndex.current]?.cardId ?? '');
        const quickFlick = deltaX <= -14 && deltaX / elapsed <= -0.45;
        if (card && (deltaX <= -28 || quickFlick) && Math.abs(deltaX) > Math.abs(deltaY) * 1.15) {
          Animated.timing(swipeX, { toValue: -screenWidth, duration: 110, useNativeDriver: true }).start(({ finished }) => {
            if (finished) onOpenDetails(card);
            else swipeX.setValue(0);
          });
        } else {
          Animated.spring(swipeX, { toValue: 0, tension: 160, friction: 20, useNativeDriver: true }).start();
        }
      }}
      onResponderTerminate={() => {
        const axis = gestureAxis.current;
        gestureAxis.current = null;
        if (axis === 'vertical') {
          scrollMetrics.current.offset = currentIndex.current * scrollMetrics.current.viewportHeight;
          scrollRef.current?.scrollTo({ y: scrollMetrics.current.offset, animated: !reducedMotion });
        }
        pullY.setValue(0);
        Animated.spring(swipeX, { toValue: 0, tension: 160, friction: 20, useNativeDriver: true }).start();
      }}
      onResponderTerminationRequest={() => false}
    >
      <Animated.View style={[styles.feedRoot, { transform: [{ translateX: swipeX }, { translateY: pullY }] }]}>
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.feedPages}
        scrollEnabled={false}
        bounces={false}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={100}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (height <= 0) return;
          if (scrollMetrics.current.viewportHeight > 0 && height !== scrollMetrics.current.viewportHeight) {
            scrollMetrics.current.offset = currentIndex.current * height;
            scrollRef.current?.scrollTo({ y: scrollMetrics.current.offset, animated: false });
          }
          scrollMetrics.current.viewportHeight = height;
          setPageHeight((current) => current === height ? current : height);
        }}
        onScroll={(event) => {
          if (!active) return;
          scrollMetrics.current.offset = Math.max(0, event.nativeEvent.contentOffset.y);
        }}
      >
        {assignments.map((assignment, index) => {
          const card = cardsById.get(assignment.cardId);
          if (!card) return <View key={assignment.cardId} style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}><View style={styles.card}><Text style={styles.emptyTitle}>This earlier card has left your recent history.</Text><Text style={styles.emptyText}>Swipe up to continue. Favorites stay available offline.</Text></View></View>;
          const laneLabel = assignment.lane === 'interest' ? 'YOUR INTERESTS'
            : assignment.lane === 'review' ? 'READY TO REVIEW' : null;

          return (
            <View key={assignment.rank ?? card.id} style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}>
              <View style={styles.card}>
                <Pressable accessible={false} onPress={() => registerCardTap(card)} style={styles.cardCopy}>
                  <View style={[styles.cardMetaRow, styles.cardMetaSpaced]}>
                    {laneLabel ? <SectionLabel>{laneLabel}</SectionLabel> : <View />}
                    <Text style={[styles.cardTopic, { color: topicColor(card.primaryTopicId) }]}>{topicName(card.primaryTopicId).toUpperCase()}</Text>
                  </View>
                  <Text numberOfLines={3} style={styles.cardTitle}>{card.title}</Text>
                  <CardDescription text={card.summary} />
                </Pressable>
                <View>
                  <View style={styles.cardFooter}>
                    <FavoriteBurst filled={card.isFavorite} active={active && index === currentIndex.current} reducedMotion={reducedMotion} color={colors.accent}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={card.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                        accessibilityState={{ selected: card.isFavorite }}
                        onPress={() => onFavorite(card)}
                        style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}
                      >
                        <HeartIcon filled={card.isFavorite} color={card.isFavorite ? colors.accent : colors.muted} />
                      </Pressable>
                    </FavoriteBurst>
                  </View>
                  <View style={styles.feedPageFooter}>
                    <Text style={styles.nextCardHint}>{index < assignments.length - 1 ? 'SWIPE UP FOR NEXT' : 'SWIPE UP FOR MORE'}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
        <View key="feed-end-cta" style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}>
          <View style={styles.card}>
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{assignments.length ? 'You’ve reached the end of your deck.' : 'Your deck is ready to grow.'}</Text>
              <Text style={styles.emptyText}>{assignments.length
                ? 'There are no more cards queued right now. Ask your backend to prepare more, or come back later.'
                : 'Request more cards from your Gemini backend. Anything already saved here stays on this device.'}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={discoveryBusy ? 'Checking for more cards' : geminiEnabled ? 'Load more cards' : 'Connect Gemini in Settings'} disabled={discoveryBusy} onPress={geminiEnabled ? onDiscover : onOpenSettings} style={({ pressed }) => [styles.discoverButton, discoveryBusy && styles.disabled, pressed && styles.pressed]}>
              {discoveryBusy ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.discoverGlyph}>＋</Text>}
              <View style={styles.discoverCopy}>
                <Text style={styles.discoverTitle}>{discoveryBusy ? 'Checking for more cards…'
                  : geminiEnabled ? 'Load more cards' : 'Connect Gemini in Settings'}</Text>
                <Text style={styles.discoverSubtitle}>{geminiEnabled
                  ? 'Ask your backend for another batch'
                  : 'Open Settings → Topics to connect your backend'}</Text>
              </View>
              <Text style={styles.discoverArrow}>›</Text>
            </Pressable>
            <View style={styles.feedPageFooter}>
              <Text style={styles.nextCardHint}>END OF YOUR DECK</Text>
            </View>
          </View>
        </View>
      </ScrollView>
      {refreshing && <ActivityIndicator accessibilityLabel="Refreshing feed" color={colors.accent} style={{ position: 'absolute', top: 64, alignSelf: 'center' }} />}
      <View pointerEvents="box-none" style={[styles.feedHeader, styles.feedHeaderFixed]}>
        <View style={styles.feedBrand}>
          <Text style={[styles.eyebrow, styles.feedEyebrow]}>JIGYABYTE</Text>
        </View>
      </View>
      </Animated.View>
    </Animated.View>
  );
}

function DetailScreen({
  card,
  onBack,
  onFavorite,
  onReview,
  reviewBusy,
  backLabel,
}: {
  card: Card | undefined;
  onBack: () => void;
  onFavorite: (card: Card) => void;
  onReview: (cardId: string, action: 'again' | 'got_it' | 'easy') => void;
  reviewBusy: boolean;
  backLabel: string;
}) {
  if (!card) return null;
  return (
    <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
      <View style={styles.detailTopBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={styles.backGlyph}>‹</Text>
          <Text style={styles.backLabel}>{backLabel}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={card.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onPress={() => onFavorite(card)}
          style={({ pressed }) => [styles.detailFavorite, pressed && styles.pressed]}
        >
          <HeartIcon filled={card.isFavorite} color={card.isFavorite ? colors.accent : colors.muted} />
        </Pressable>
      </View>

      <Text style={[styles.detailTopic, { color: topicColor(card.primaryTopicId) }]}>{topicName(card.primaryTopicId).toUpperCase()}</Text>
      <Text style={styles.detailTitle}>{card.title}</Text>
      <View style={styles.shortAnswer}>
        <SectionLabel>The short answer</SectionLabel>
        <Text style={styles.shortAnswerText}>{card.summary}</Text>
      </View>
      <Text style={styles.explanationText}>{card.explanation}</Text>

      <View style={styles.sourcePanel}>
        <Text style={styles.sourceHeading}>ABOUT THIS CARD</Text>
        <Text style={styles.sourceAttribution}>Generated by Gemini · unverified</Text>
        <Text style={styles.sourceLicense}>{card.references.length
          ? 'Based on the linked source material. This AI summary is not independently verified.'
          : 'The card uses Gemini’s knowledge without live reference material. Check important claims independently.'}</Text>
        {card.references.map(source => (
          <Pressable key={source.id} accessibilityRole="link" accessibilityLabel={`Open source: ${source.title}`}
            onPress={() => { void Linking.openURL(source.url).catch(() => {}); }} style={({ pressed }) => [styles.shortAnswer, pressed && styles.pressed]}>
            <Text style={styles.sourceAttribution}>{source.name} ↗</Text>
            <Text style={styles.sourceLicense}>{source.title}</Text>
            <Text style={styles.sourceLicense}>{source.dateKind === 'observed' ? 'Indexed' : 'Published'} {new Date(source.publishedAt).toLocaleDateString()} · Retrieved {new Date(source.retrievedAt).toLocaleDateString()}</Text>
          </Pressable>
        ))}
        {card.provenance ? <Text style={styles.sourceLicense}>Model: {card.provenance.modelId}</Text> : null}
      </View>

      <View style={styles.reviewPanel}>
        <Text style={styles.reviewTitle}>Review this idea</Text>
        <Text style={styles.reviewHint}>Choose when you would like it to come back.</Text>
        <View style={styles.detailReviewActions}>
          <ActionButton disabled={reviewBusy} label="Again" onPress={() => onReview(card.id, 'again')} />
          <ActionButton disabled={reviewBusy} label="Got it" onPress={() => onReview(card.id, 'got_it')} />
          <ActionButton disabled={reviewBusy} label="Easy" onPress={() => onReview(card.id, 'easy')} />
        </View>
        {card.nextReviewAt ? (
          <Text style={styles.reviewScheduled}>Next review {new Date(card.nextReviewAt).toLocaleString()}</Text>
        ) : null}
      </View>
    </ScrollView>
  );
}

function InterestsScreen({
  initialIds,
  firstLaunch,
  saving,
  onSave,
  onCancel,
  onSkip,
  backendSettings,
}: {
  initialIds: string[];
  firstLaunch: boolean;
  saving: boolean;
  onSave: (ids: string[], backend: BackendSettings) => void;
  onCancel: () => void;
  onSkip: () => void;
  backendSettings: BackendSettings;
}) {
  const [draft, setDraft] = useState(initialIds);
  const [backend, setBackend] = useState(backendSettings);
  const initialKey = initialIds.join(',');
  const allSelected = topics.every(topic => draft.includes(topic.id));
  const noneSelected = !topics.some(topic => draft.includes(topic.id));

  useEffect(() => setDraft(initialIds), [initialKey]);

  const toggle = (topicId: string) => {
    setDraft((current) => current.includes(topicId)
      ? current.filter((id) => id !== topicId)
      : [...current, topicId]);
  };

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.interestsContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.eyebrow}>MAKE IT YOURS</Text>
      <Text style={styles.interestsTitle}>What are you curious about?</Text>
      <Text style={styles.interestsDescription}>Choose a few topics. Two out of every ten feed slots will look here when matching cards are available.</Text>
      <View style={styles.topicSelectionActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Select all topics"
          disabled={saving || allSelected}
          onPress={() => setDraft(topics.map(topic => topic.id))}
          style={({ pressed }) => [styles.actionButton, styles.actionButtonCompact, (saving || allSelected) && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Select all</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deselect all topics"
          disabled={saving || noneSelected}
          onPress={() => setDraft([])}
          style={({ pressed }) => [styles.actionButton, styles.actionButtonCompact, (saving || noneSelected) && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Deselect all</Text>
        </Pressable>
      </View>
      <View style={styles.topicGrid}>
        {topics.map((topic) => {
          const selected = draft.includes(topic.id);
          return (
            <Pressable
              key={topic.id}
              accessibilityRole="checkbox"
              accessibilityLabel={topic.name}
              accessibilityState={{ checked: selected }}
              onPress={() => toggle(topic.id)}
              style={({ pressed }) => [styles.topicChip, selected && styles.topicChipSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.topicChipGlyph, selected && styles.topicChipGlyphSelected]}>{selected ? '✓' : '+'}</Text>
              <Text style={[styles.topicChipText, selected && styles.topicChipTextSelected]}>{topic.name}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.generatorPanel}>
        <Text style={styles.reviewTitle}>Backend connection</Text>
        <Text style={styles.interestsDescription}>Your backend uses Gemini to make short, curiosity-first cards, then saves them here for offline reading. The Gemini key stays on the server.</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: backend.enabled }} onPress={() => setBackend(current => ({ ...current, enabled: !current.enabled }))} style={styles.topicChip}>
          <Text style={styles.topicChipText}>{backend.enabled ? '✓ Automatic refill enabled' : '+ Enable automatic refill'}</Text>
        </Pressable>
        <TextInput accessibilityLabel="Backend server address" value={backend.serviceUrl} onChangeText={serviceUrl => setBackend(current => ({ ...current, serviceUrl }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.serviceInput} />
        <TextInput accessibilityLabel="Backend pairing token" value={backend.pairingToken} onChangeText={pairingToken => setBackend(current => ({ ...current, pairingToken }))} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.serviceInput} placeholder="Backend pairing token" placeholderTextColor={colors.muted} />
        <Text style={styles.reviewHint}>Use your backend pairing token. Your Gemini key stays on the server.</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => onSave(draft, backend)}
        style={({ pressed }) => [styles.primaryButton, saving && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save interests'}</Text>
      </Pressable>
      {firstLaunch ? (
        <Pressable accessibilityRole="button" disabled={saving} onPress={onSkip} style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
          <Text style={styles.skipButtonText}>Save topics and connect Gemini later</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" disabled={saving} onPress={onCancel} style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
          <Text style={styles.skipButtonText}>Back to settings</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function RefreshIcon({ busy, reducedMotion }: { busy: boolean; reducedMotion: boolean }) {
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    rotation.setValue(0);
    if (!busy || reducedMotion) return;
    const animation = Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => { animation.stop(); rotation.setValue(0); };
  }, [busy, reducedMotion, rotation]);
  if (busy && reducedMotion) return <ActivityIndicator color={colors.accent} size="small" />;
  return <Animated.View style={{ transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}>
    <Svg width={20} height={20} viewBox="0 0 24 24" accessible={false}>
      <Path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5" fill="none" stroke={colors.accent} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  </Animated.View>;
}

function SettingsScreen({ onOpenInterests, backendStatus, unread, onRefresh, reducedMotion }: {
  onOpenInterests: () => void;
  backendStatus: BackendStatus;
  unread: number;
  onRefresh: () => void;
  reducedMotion: boolean;
}) {
  const connected = backendStatus.connection === 'connected';
  const lastConnected = backendStatus.lastHandshakeAt
    ? new Date(backendStatus.lastHandshakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : null;

  return (
    <View style={styles.settingsRoot}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.settingsContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.pageTitle}>Settings</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Topics, choose interests and configure backend connection" onPress={onOpenInterests} style={({ pressed }) => [styles.settingsOption, pressed && styles.pressed]}>
          <View style={styles.settingsOptionCopy}>
            <Text style={styles.settingsOptionTitle}>Topics</Text>
            <Text style={styles.settingsOptionHint}>Your interests and backend connection</Text>
          </View>
          <Text style={styles.settingsOptionArrow}>›</Text>
        </Pressable>
      </ScrollView>
      <View style={styles.connectionPanel}>
        <View accessible accessibilityLabel={connected ? 'Backend connected' : backendStatus.connection === 'disabled' ? 'Backend not configured' : 'Backend disconnected'} style={[styles.connectionGlow, connected ? styles.connectionGlowConnected : styles.connectionGlowOffline]}>
          <View style={[styles.connectionDot, connected ? styles.connectionDotConnected : styles.connectionDotOffline]} />
        </View>
        <View style={styles.connectionStats}>
          <View style={styles.connectionStatRow}>
            <View style={styles.connectionPill} accessible accessibilityLabel={backendStatus.lastHandshakeAt ? `Last successful connection ${new Date(backendStatus.lastHandshakeAt).toLocaleString()}` : 'No successful connection yet'}>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} maxFontSizeMultiplier={1.2} style={styles.connectionPillText}>{lastConnected ? `Last ${lastConnected}` : 'Never connected'}</Text>
            </View>
            <View style={styles.connectionPill} accessible accessibilityLabel={`${unread} unread cards saved locally`}>
              <Text numberOfLines={1} style={styles.connectionPillText}>{unread} unread</Text>
            </View>
          </View>
          <View style={[styles.connectionPill, styles.dailyUsagePill]} accessible accessibilityLabel={backendStatus.dailyRequests ? `${backendStatus.dailyRequests.used} of ${backendStatus.dailyRequests.total} daily generation requests used. Resets at midnight UTC.` : 'Daily request usage unavailable'}>
            <Text style={styles.connectionPillText}>{backendStatus.dailyRequests ? `${backendStatus.dailyRequests.used}/${backendStatus.dailyRequests.total} daily requests` : 'Daily requests —'}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh backend connection and cards" accessibilityState={{ disabled: !!backendStatus.refreshing, busy: !!backendStatus.refreshing }} disabled={!!backendStatus.refreshing} onPress={onRefresh} style={({ pressed }) => [styles.connectionRefresh, pressed && styles.pressed]}>
          <RefreshIcon busy={!!backendStatus.refreshing} reducedMotion={reducedMotion} />
        </Pressable>
      </View>
    </View>
  );
}

function AnalyticsScreen({ snapshot, selected, onSelect }: {
  snapshot: AnalyticsSnapshot | null;
  selected: AnalyticsMetric;
  onSelect: (metric: AnalyticsMetric) => void;
}) {
  const maxValue = useMemo(() => Math.max(1, ...topics.map((topic) => snapshot?.byTopic[selected][topic.id] ?? 0)), [selected, snapshot]);
  const metricSwipeStart = useRef({ x: 0, y: 0, at: 0 });
  const metricSwipeCaptured = useRef(false);
  const swipeMetrics: AnalyticsMetric[] = ['seen', 'expanded', 'favorites'];

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.analyticsContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Your learning</Text>
      <Text style={styles.analyticsSubtitle}>A snapshot of the ideas you’ve explored across all time.</Text>

      <View style={styles.statRow}>
        {(['seen', 'expanded', 'favorites'] as AnalyticsMetric[]).map((metric) => (
          <View key={metric} style={styles.statCard}>
            <Text style={styles.statLabel}>{metricLabels[metric]}</Text>
            <Text style={styles.statValue}>{snapshot?.totals[metric] ?? 0}</Text>
          </View>
        ))}
      </View>

      <View style={styles.metricPicker} accessibilityRole="tablist">
        {(['seen', 'expanded', 'favorites'] as AnalyticsMetric[]).map((metric) => {
          const active = metric === selected;
          return (
            <Pressable
              key={metric}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onSelect(metric)}
              style={({ pressed }) => [styles.metricButton, active && styles.metricButtonActive, pressed && styles.pressed]}
            >
              <Text style={[styles.metricButtonText, active && styles.metricButtonTextActive]}>{metricLabels[metric]}</Text>
            </Pressable>
          );
        })}
      </View>

      <View
        onTouchStart={(event) => {
          metricSwipeStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY, at: Date.now() };
          metricSwipeCaptured.current = false;
        }}
        onMoveShouldSetResponderCapture={(event) => {
          const deltaX = event.nativeEvent.pageX - metricSwipeStart.current.x;
          const deltaY = event.nativeEvent.pageY - metricSwipeStart.current.y;
          const horizontal = Math.abs(deltaX) > 16 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15;
          if (horizontal) metricSwipeCaptured.current = true;
          return horizontal;
        }}
        onResponderRelease={(event) => {
          const deltaX = event.nativeEvent.pageX - metricSwipeStart.current.x;
          const deltaY = event.nativeEvent.pageY - metricSwipeStart.current.y;
          const elapsed = Math.max(1, Date.now() - metricSwipeStart.current.at);
          const quickSwipe = Math.abs(deltaX) >= 16 && Math.abs(deltaX) / elapsed >= 0.45;
          if (metricSwipeCaptured.current && Math.abs(deltaY) < Math.abs(deltaX) / 1.15 && (Math.abs(deltaX) >= 36 || quickSwipe)) {
            const index = swipeMetrics.indexOf(selected);
            const nextIndex = Math.max(0, Math.min(swipeMetrics.length - 1, index + (deltaX < 0 ? 1 : -1)));
            if (nextIndex !== index) onSelect(swipeMetrics[nextIndex]);
          }
          metricSwipeCaptured.current = false;
        }}
        onResponderTerminate={() => { metricSwipeCaptured.current = false; }}
        onResponderTerminationRequest={() => false}
      >
        <View style={styles.chartHeader}>
          <Text style={styles.chartTitle}>{metricLabels[selected]} by topic</Text>
          <Text style={styles.chartCaption}>UNIQUE CARDS · PRIMARY TOPIC · ALL TIME</Text>
        </View>
        {snapshot?.totals[selected] === 0 ? (
          <Text style={styles.chartFootnote} accessibilityLiveRegion="polite">
            {selected === 'seen' ? 'Read a card in the Feed to start your chart.'
              : selected === 'expanded' ? 'Swipe left on a card to explore an idea.'
                : 'Save a card with the heart to see your favorites here.'}
          </Text>
        ) : null}
        <View style={styles.chart}>
          {topics.map((topic) => {
            const value = snapshot?.byTopic[selected][topic.id] ?? 0;
            const fill = value === 0 ? 0 : Math.max(4, (value / maxValue) * 100);
            return (
              <View key={topic.id} style={styles.chartRow} accessible accessibilityLabel={`${topic.name}: ${value} ${metricLabels[selected].toLowerCase()} cards`}>
                <Text style={[styles.chartTopic, { color: topicColor(topic.id) }]}>{topic.name}</Text>
                <View style={styles.barTrack}>
                  <View style={[styles.bar, { width: `${fill}%`, backgroundColor: topicColor(topic.id) }]} />
                </View>
                <Text style={styles.chartValue}>{value}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.chartFootnote}>Seen and Expanded count each card once, under its primary topic. Favorites shows cards currently saved.</Text>
      </View>
    </ScrollView>
  );
}

function FavoritesScreen({ cards, onOpen, onFavorite }: { cards: Card[]; onOpen: (card: Card) => void; onFavorite: (card: Card) => Promise<boolean> }) {
  const favorites = cards.filter(c => c.isFavorite).sort((a,b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '') || a.id.localeCompare(b.id));
  const isEmpty = favorites.length === 0;
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={[styles.analyticsContent, isEmpty && styles.favoritesEmptyContent]}>
      <Text style={styles.pageTitle}>Favorites</Text>
      <Text style={styles.analyticsSubtitle}>Saved ideas, available offline.</Text>
      {isEmpty ? (
        <View style={styles.favoritesEmptyState}>
          <View style={styles.favoritesEmptyIcon}>
            <HeartIcon size={42} filled={false} color={colors.accent} />
          </View>
          <Text style={styles.emptyTitle}>No favorites yet</Text>
          <Text style={[styles.emptyText, styles.favoritesEmptyHint]}>Tap a card’s heart to keep it here.</Text>
        </View>
      ) : favorites.map(card => (
        <FavoriteCardItem key={card.id} card={card} onOpen={onOpen} onRemove={onFavorite} />
      ))}
    </ScrollView>
  );
}

function FavoriteCardItem({ card, onOpen, onRemove }: { card: Card; onOpen: (card: Card) => void; onRemove: (card: Card) => Promise<boolean> }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const removing = useRef(false);
  const [isFavorite, setIsFavorite] = useState(true);

  const restore = () => {
    removing.current = false;
    translateX.setValue(0);
    opacity.setValue(1);
    setIsFavorite(true);
  };

  const removeFavorite = () => {
    if (removing.current) return;
    removing.current = true;
    setIsFavorite(false);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: Dimensions.get('window').width + 40,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) { restore(); return; }
      void onRemove(card).then((removed) => { if (!removed) restore(); }).catch(restore);
    });
  };

  return (
    <Animated.View style={[styles.favoritesCard, { opacity, transform: [{ translateX }] }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Read ${card.title}`} onPress={() => {
        if (!removing.current) onOpen(card);
      }}>
        <Text style={[styles.cardTopic, { color: topicColor(card.primaryTopicId) }]}>{topicName(card.primaryTopicId)}</Text>
        <Text style={styles.reviewTitle}>{card.title}</Text>
        <Text numberOfLines={3} style={styles.emptyText}>{card.summary}</Text>
      </Pressable>
      <View style={styles.favoritesCardFooter}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${card.title} from favorites`}
          accessibilityState={{ selected: isFavorite }}
          onPress={removeFavorite}
          style={({ pressed }) => [styles.favoritesHeartButton, pressed && styles.pressed]}
        >
          <HeartIcon size={24} filled={isFavorite} color={isFavorite ? colors.accent : colors.muted} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
function BottomNavigation({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: 'feed', label: 'Feed' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'settings', label: 'Settings' },
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const selected = active === item.id;
        const iconColor = selected ? colors.accent : colors.muted;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            {item.id === 'favorites' ? <HeartIcon size={22} filled={selected} color={iconColor} /> : item.id === 'settings' ? (
              <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
                <Path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.7-2-.9L13 3Z" fill="none" stroke={selected ? colors.accent : colors.muted} strokeWidth={1.6} strokeLinejoin="round" />
                <Circle cx={11} cy={12} r={3} fill="none" stroke={selected ? colors.accent : colors.muted} strokeWidth={1.6} />
              </Svg>
            ) : item.id === 'feed' ? (
              <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
                <Rect x={3} y={6} width={18} height={15} rx={2.5} fill="none" stroke={iconColor} strokeWidth={1.8} />
                <Path d="M6 3h12M7 11h10M7 15h6" fill="none" stroke={iconColor} strokeWidth={1.8} strokeLinecap="round" />
              </Svg>
            ) : (
              <Svg width={22} height={22} viewBox="0 0 24 24" accessible={false}>
                <Rect x={3} y={11} width={4.5} height={10} rx={1} fill="none" stroke={iconColor} strokeWidth={1.8} />
                <Rect x={9.75} y={7} width={4.5} height={14} rx={1} fill="none" stroke={iconColor} strokeWidth={1.8} />
                <Rect x={16.5} y={3} width={4.5} height={18} rx={1} fill="none" stroke={iconColor} strokeWidth={1.8} />
              </Svg>
            )}
            <Text style={[styles.navLabel, selected && styles.navSelected]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function App() {
  const reducedMotion = useReducedMotion();
  const [tab, setTab] = useState<Tab>('feed');
  const [view, setView] = useState<AppView>('main');
  const [detailCardId, setDetailCardId] = useState<string | null>(null);
  const [metric, setMetric] = useState<AnalyticsMetric>('seen');
  const [cards, setCards] = useState<Card[]>([]);
  const [assignments, setAssignments] = useState<FeedAssignment[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [interestDraft, setInterestDraft] = useState<string[]>([]);
  const [firstLaunch, setFirstLaunch] = useState(false);
  const [ready, setReady] = useState(false);
  const [savingInterests, setSavingInterests] = useState(false);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<DiscoveryNotice>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendSettings, setBackendSettings] = useState(defaultBackendSettings);
  const [refreshingFeed, setRefreshingFeed] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'disabled', message: 'Backend connection is optional.', unread: 0, connection: 'disabled' });
  const syncRef = useRef<BackendSync | null>(null);
  const activeFeedId = useRef<string | null>(null);
  const readerId = useRef<string | null>(null);
  const readerOrigin = useRef<Tab>('feed');
  const sessionId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const recentIds = useRef<string[]>([]);

  const refreshLocalData = useCallback(async () => {
    protectCardBodies([activeFeedId.current, readerId.current]);
    await cleanupReadBodies();
    const [nextCards, nextAnalytics] = await Promise.all([getCards(), getAnalytics()]);
    setCards(nextCards);
    setAnalytics(nextAnalytics);
    const nextAssignments = await getPersistentFeed();
    setAssignments(current => {
      const firstRank = nextAssignments[0]?.rank ?? Infinity;
      return [...current.filter(item => (item.rank ?? Infinity) < firstRank), ...nextAssignments];
    });
    const inventory = await getInventory();
    setBackendStatus(current => ({ ...current, unread: inventory.counts.unread }));
    return nextCards;
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await initializeDatabase();
        const [nextCards, nextAnalytics, savedInterests, recentlyShown] = await Promise.all([
          getCards(), getAnalytics(), getInterests(), getRecentlyShownCardIds(),
        ]);
        if (!active) return;
        recentIds.current = recentlyShown;
        setCards(nextCards);
        setAnalytics(nextAnalytics);
        setInterests(savedInterests ?? []);
        setInterestDraft(savedInterests ?? []);
        const queue = savedInterests === null ? [] : await getPersistentFeed();
        activeFeedId.current = queue[0]?.cardId ?? null;
        protectCardBodies([activeFeedId.current]);
        setAssignments(queue);
        if (savedInterests === null) {
          setFirstLaunch(true);
          setView('interests');
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not open the local JigyaByte database.');
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!ready || firstLaunch) return;
    let lastNotice = 0;
    const sync = new BackendSync(status => {
      setBackendStatus(status);
      if (status.notification && status.notification.id !== lastNotice) {
        lastNotice = status.notification.id;
        setDiscoveryNotice({ kind: status.notification.kind, message: status.notification.message });
      }
    }, async () => { await refreshLocalData(); });
    sync.foreground(AppState.currentState === 'active');
    syncRef.current = sync;
    void getBackendSettings().then(settings => { setBackendSettings(settings); sync.configure(settings); }).catch(() => setError('Could not load the secure backend connection. Offline reading is available.'));
    const listener = AppState.addEventListener('change', state => sync.foreground(state === 'active'));
    return () => { listener.remove(); sync.dispose(); syncRef.current = null; };
  }, [ready, firstLaunch, refreshLocalData]);

  const closeReader = useCallback(() => {
    readerId.current = null;
    protectCardBodies([activeFeedId.current]);
    setTab(readerOrigin.current);
    setView('main');
    void refreshLocalData().then(() => syncRef.current?.request());
  }, [refreshLocalData]);

  useEffect(() => {
    if (view === 'main' || firstLaunch) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view === 'detail') closeReader(); else setView('main');
      return true;
    });
    return () => subscription.remove();
  }, [view, firstLaunch, closeReader]);

  const refreshAfterAction = useCallback(async () => {
    try {
      await refreshLocalData();
      syncRef.current?.request();
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action could not be saved.');
    }
  }, [refreshLocalData]);

  const handleSeen = useCallback(async (cardId: string, lane: FeedLane) => {
    activeFeedId.current = cardId;
    protectCardBodies([cardId, readerId.current]);
    recentIds.current = [cardId, ...recentIds.current.filter((id) => id !== cardId)].slice(0, 20);
    await recordCardImpression(cardId, lane, sessionId.current);
    await refreshLocalData();
    syncRef.current?.request();
  }, [refreshLocalData]);

  const handleFavorite = useCallback(async (card: Card): Promise<boolean> => {
    try {
      await setFavorite(card.id, !card.isFavorite);
      await refreshAfterAction();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That favorite could not be saved.');
      return false;
    }
  }, [refreshAfterAction]);

  const openDetails = useCallback((card: Card) => {
    readerOrigin.current = tab;
    readerId.current = card.id;
    protectCardBodies([activeFeedId.current, card.id]);
    setDetailCardId(card.id);
    setView('detail');
    void (async () => {
      try {
        await recordInteraction(card.id, 'seen');
        await recordInteraction(card.id, 'expanded');
        await refreshLocalData();
        syncRef.current?.request();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That card could not be marked as explored.');
      }
    })();
  }, [tab, refreshLocalData]);

  const handleReview = useCallback((cardId: string, action: 'again' | 'got_it' | 'easy') => {
    setReviewBusy(true);
    void (async () => {
      try {
        await scheduleReview(cardId, action);
        await refreshAfterAction();
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That review could not be scheduled.');
      } finally {
        setReviewBusy(false);
      }
    })();
  }, [refreshAfterAction]);

  const openInterests = useCallback(() => {
    setInterestDraft(interests);
    setFirstLaunch(false);
    setTab('settings');
    setView('interests');
  }, [interests]);

  const saveInterestSelection = useCallback(async (selectedIds: string[], backend = backendSettings) => {
    setSavingInterests(true);
    try {
      await saveInterests(selectedIds);
      const configured = await saveBackendSettings(backend);
      setBackendSettings(configured);
      syncRef.current?.configure(configured);
      const normalized = [...new Set(selectedIds)];
      setInterests(normalized);
      setInterestDraft(normalized);
      await refreshLocalData();
      setDiscoveryNotice(null);
      setFirstLaunch(false);
      setView('main');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those topics could not be saved.');
    } finally {
      setSavingInterests(false);
    }
  }, [backendSettings, refreshLocalData]);

  const discoverCard = useCallback(async () => {
    if (discoveryBusy) return;
    if (!backendSettings.enabled || !syncRef.current) {
      setDiscoveryNotice({ kind: 'offline', state: 'disabled', message: 'Connect your Gemini backend in Settings → Topics to request more cards. Saved cards remain available offline.' });
      return;
    }
    setDiscoveryBusy(true);
    setDiscoveryNotice(null);
    try {
      await syncRef.current.refresh(true, true);
      await refreshLocalData();
    } catch {
      setDiscoveryNotice({ kind: 'error', state: 'offline', message: 'Could not reach the backend right now. Your saved cards remain available offline.' });
    } finally {
      setDiscoveryBusy(false);
    }
  }, [backendSettings.enabled, cards, discoveryBusy, refreshLocalData]);

  const refreshFeed = useCallback(async () => {
    if (refreshingFeed || discoveryBusy) return;
    setRefreshingFeed(true);
    try {
      await refreshLocalData();
      if (backendSettings.enabled && syncRef.current) await syncRef.current.refresh(true, true);
      else setDiscoveryNotice({ kind: 'offline', message: 'Connect your Gemini backend in Settings → Topics to create new cards. Saved cards remain available offline.' });
    } catch {
      setDiscoveryNotice({ kind: 'offline', message: 'Could not refresh right now. Saved cards remain available.' });
    } finally { setRefreshingFeed(false); }
  }, [refreshingFeed, discoveryBusy, backendSettings.enabled, refreshLocalData]);

  const selectedCard = cards.find((card) => card.id === detailCardId);

  return (
    <SafeAreaProvider>
      <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
        <View style={styles.screen}>
          <StatusBar barStyle="light-content" backgroundColor={colors.background} />
          {!ready ? (
            <View style={styles.loadingScreen}>
              <ActivityIndicator color={colors.accent} size="large" />
              <Text style={styles.loadingText}>Opening your learning deck…</Text>
            </View>
          ) : (
            <>
              {error ? (
                <Pressable accessibilityRole="button" accessibilityLabel={`${error} Dismiss message`} onPress={() => setError(null)} style={styles.errorBanner}>
                  <Text style={styles.errorText}>{error}  Tap to dismiss.</Text>
                </Pressable>
              ) : null}

              <View style={[styles.mainContent, view === 'interests' && styles.hiddenPane]}>
                <View style={[styles.mainPane, tab !== 'feed' && styles.hiddenPane]}>
                  <FeedScreen
                    cards={cards}
                    assignments={assignments}
                    active={view === 'main' && tab === 'feed'}
                    discoveryBusy={discoveryBusy}
                    geminiEnabled={backendSettings.enabled}
                    onFavorite={handleFavorite}
                    onOpenDetails={openDetails}
                    onSeen={handleSeen}
                    onOpenSettings={() => setTab('settings')}
                    onDiscover={discoverCard}
                    refreshing={refreshingFeed}
                    onRefresh={() => void refreshFeed()}
                  />
                </View>
                <View style={[styles.mainPane, tab !== 'favorites' && styles.hiddenPane]}>
                  <FavoritesScreen cards={cards} onOpen={openDetails} onFavorite={handleFavorite} />
                </View>
                <View style={[styles.mainPane, tab !== 'analytics' && styles.hiddenPane]}>
                  <AnalyticsScreen snapshot={analytics} selected={metric} onSelect={setMetric} />
                </View>
                <View style={[styles.mainPane, tab !== 'settings' && styles.hiddenPane]}>
                  <SettingsScreen onOpenInterests={openInterests} backendStatus={backendStatus}
                    unread={cards.filter(card => !card.isRead).length}
                    reducedMotion={reducedMotion}
                    onRefresh={() => { void syncRef.current?.refresh(true); }} />
                </View>
              </View>

              {view === 'interests' ? (
                <InterestsScreen
                  initialIds={interestDraft}
                  firstLaunch={firstLaunch}
                  saving={savingInterests}
                  onSave={(ids, backend) => void saveInterestSelection(ids, backend)}
                  onCancel={() => setView('main')}
                  onSkip={() => void saveInterestSelection([])}
                  backendSettings={backendSettings}
                />
              ) : null}

              {view === 'detail' ? (
                <View style={styles.readerOverlay}>
                  <ReaderTransition reducedMotion={reducedMotion} onSwipeBack={closeReader}>
                    <DetailScreen
                      card={selectedCard}
                      onBack={closeReader}
                      backLabel={readerOrigin.current === 'favorites' ? 'Back to favorites' : 'Back to feed'}
                      onFavorite={handleFavorite}
                      onReview={handleReview}
                      reviewBusy={reviewBusy}
                    />
                  </ReaderTransition>
                </View>
              ) : null}

              {/* Stays mounted behind the reader overlay so the feed keeps its height when the reader closes. */}
              {view !== 'interests' ? (
                <View
                  pointerEvents={view === 'main' ? 'auto' : 'none'}
                  importantForAccessibility={view === 'main' ? 'auto' : 'no-hide-descendants'}
                >
                  <BottomNavigation active={tab} onChange={setTab} />
                </View>
              ) : null}
              <NavigationBar style="dark" />
            </>
          )}
          {discoveryNotice ? (
            <FloatingDiscoveryToast notice={discoveryNotice} reducedMotion={reducedMotion}
              onDismiss={() => setDiscoveryNotice(current => current === discoveryNotice ? null : current)} />
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  settingsRoot: { flex: 1 },
  settingsContent: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 24 },
  settingsOption: { marginTop: 28, padding: 18, minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  settingsOptionCopy: { flex: 1 },
  settingsOptionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  settingsOptionHint: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 5 },
  settingsOptionArrow: { color: colors.accent, fontSize: 28 },
  connectionPanel: { height: 88, flexShrink: 0, marginHorizontal: 20, marginBottom: 16, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
  connectionStats: { flex: 1, minWidth: 0, gap: 6 },
  dailyUsagePill: { flexGrow: 0, flexBasis: 'auto', height: 27 },
  connectionStatRow: { flexDirection: 'row', gap: 6 },
  connectionGlow: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  connectionGlowConnected: { backgroundColor: '#74d6a025' },
  connectionGlowOffline: { backgroundColor: '#ef827825' },
  connectionDot: { width: 10, height: 10, borderRadius: 5 },
  connectionDotConnected: { backgroundColor: '#74d6a0', boxShadow: '0 0 9px 2px #74d6a080' },
  connectionDotOffline: { backgroundColor: '#ef8278', boxShadow: '0 0 9px 2px #ef827880' },
  connectionPill: { flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 27, borderRadius: 17, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  connectionPillText: { color: colors.text, fontSize: 11, fontVariant: ['tabular-nums'] },
  connectionRefresh: { width: 44, height: 44, flexShrink: 0, borderRadius: 22, borderWidth: 1, borderColor: '#c8f45a30', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentDim },
  safeArea: { flex: 1, backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  loadingScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 16 },
  loadingText: { color: colors.muted, fontSize: 14 },
  mainPane: { flex: 1 },
  mainContent: { flex: 1 },
  hiddenPane: { display: 'none' },
  scrollView: { flex: 1 },
  feedRoot: { flex: 1 },
  feedPages: { flexGrow: 1 },
  feedPage: { padding: 0 },
  detailContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34 },
  readerOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 5, elevation: 5 },
  analyticsContent: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 28 },
  favoritesEmptyContent: { flexGrow: 1 },
  favoritesEmptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  favoritesEmptyIcon: { width: 84, height: 84, alignItems: 'center', justifyContent: 'center', borderRadius: 42, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 20 },
  favoritesEmptyHint: { textAlign: 'center' },
  interestsContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 50, paddingBottom: 34, justifyContent: 'center' },
  feedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  feedHeaderFixed: { position: 'absolute', top: 8, left: 24, right: 24, zIndex: 3, elevation: 3 },
  feedBrand: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 4, marginBottom: 9 },
  feedEyebrow: { marginBottom: 0 },
  pageTitle: { color: colors.text, fontSize: 29, fontWeight: '700', letterSpacing: -1.1 },
  discoverButton: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, marginBottom: 18 },
  discoverGlyph: { color: colors.background, fontSize: 28, fontWeight: '400' },
  discoverCopy: { flex: 1 },
  discoverTitle: { color: colors.background, fontSize: 14, fontWeight: '800' },
  discoverSubtitle: { color: '#263514', fontSize: 11, marginTop: 3 },
  discoverArrow: { color: colors.background, fontSize: 26, fontWeight: '400' },
  discoveryToast: { position: 'absolute', left: 16, right: 16, top: 12, zIndex: 50, elevation: 50 },
  providerNotice: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderLeftColor: colors.accent, borderLeftWidth: 4, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  providerNoticeOffline: { borderColor: '#62413a', borderLeftColor: '#ef8278', backgroundColor: colors.danger },
  providerNoticeText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  providerNoticeHint: { color: colors.muted, fontSize: 10, marginTop: 5 },
  card: { flex: 1, backgroundColor: colors.surface, paddingHorizontal: 24, paddingTop: 30, paddingBottom: 14, justifyContent: 'space-between' },
  cardCopy: { flex: 1 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardMetaSpaced: { marginTop: 27 },
  sectionLabel: { color: colors.accent, fontSize: 10, letterSpacing: 3, fontWeight: '800' },
  cardTopic: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  cardTitle: { color: colors.text, fontSize: 25, fontWeight: '700', lineHeight: 31, letterSpacing: -0.5, marginTop: 18 },
  cardSummarySpace: { flex: 1, marginTop: 12 },
  cardSummary: { flex: 1, color: '#d6dad5', textAlignVertical: 'top' },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 17 },
  favoriteButton: { paddingHorizontal: 4, paddingVertical: 1, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  detailFavorite: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  feedPageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 7 },
  nextCardHint: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 1.1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  emptyCard: { flex: 1, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 24, padding: 22, marginTop: 4 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 9 },
  detailTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 25 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingRight: 12 },
  backGlyph: { color: colors.text, fontSize: 36, lineHeight: 39, marginTop: -4 },
  backLabel: { color: colors.text, fontSize: 14, fontWeight: '500' },
  detailTopic: { color: colors.accent, fontSize: 11, letterSpacing: 4, fontWeight: '800', marginBottom: 10 },
  detailTitle: { color: colors.text, fontSize: 31, lineHeight: 38, fontWeight: '700', letterSpacing: -0.8, marginBottom: 21 },
  shortAnswer: { backgroundColor: colors.accentDim, borderLeftWidth: 5, borderLeftColor: colors.accent, borderRadius: 17, paddingHorizontal: 18, paddingVertical: 18, marginBottom: 21 },
  shortAnswerText: { color: colors.text, fontSize: 16, lineHeight: 25, marginTop: 10 },
  explanationText: { color: '#e1e4e0', fontSize: 16, lineHeight: 26, marginBottom: 24 },
  sourcePanel: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 18, padding: 17, marginBottom: 22 },
  sourceHeading: { color: colors.accent, fontSize: 10, letterSpacing: 2.2, fontWeight: '800' },
  sourceAttribution: { color: colors.text, fontSize: 13, lineHeight: 19, marginTop: 9 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, minHeight: 36 },
  sourceLinkText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  sourceArrow: { color: colors.accent, fontSize: 17 },
  sourceLicense: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 11 },
  licenseLink: { alignSelf: 'flex-start', marginTop: 9, minHeight: 34, justifyContent: 'center' },
  licenseLinkText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  reviewPanel: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 19, paddingBottom: 8 },
  reviewTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  reviewHint: { color: colors.muted, fontSize: 12, marginTop: 5 },
  detailReviewActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  actionButton: { minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 15, paddingVertical: 10, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  actionButtonCompact: { paddingHorizontal: 12, paddingVertical: 8 },
  actionButtonSelected: { borderColor: colors.accent, backgroundColor: colors.accent },
  actionText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  actionTextSelected: { color: colors.background },
  reviewScheduled: { color: colors.muted, fontSize: 11, marginTop: 12 },
  interestsTitle: { color: colors.text, fontSize: 32, lineHeight: 38, letterSpacing: -0.8, fontWeight: '700', marginTop: 10 },
  interestsDescription: { color: colors.muted, fontSize: 15, lineHeight: 23, marginTop: 11, marginBottom: 25 },
  topicSelectionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  topicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 1 },
  topicChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  topicChipGlyph: { width: 18, textAlign: 'center', color: colors.muted, fontSize: 16, fontWeight: '500' },
  topicChipGlyphSelected: { color: colors.accent },
  topicChipText: { color: colors.text, fontSize: 12, fontWeight: '500' },
  topicChipTextSelected: { color: colors.accent },
  primaryButton: { minHeight: 52, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 27 },
  primaryButtonText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  skipButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  skipButtonText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  generatorPanel: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, gap: 10 },
  favoritesCard: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20 },
  favoritesCardFooter: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 5 },
  favoritesHeartButton: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  serviceInput: { color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, minHeight: 48 },
  analyticsSubtitle: { color: '#c6cbc7', fontSize: 16, lineHeight: 24, marginTop: 8, maxWidth: 330 },
  statRow: { flexDirection: 'row', gap: 9, marginTop: 23 },
  statCard: { flex: 1, minWidth: 0, minHeight: 86, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 17, paddingHorizontal: 12, paddingVertical: 12, justifyContent: 'space-between' },
  statLabel: { color: '#d2d5d1', fontSize: 10 },
  statValue: { color: colors.accent, fontSize: 27, fontWeight: '700' },
  metricPicker: { flexDirection: 'row', padding: 4, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginTop: 17 },
  metricButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  metricButtonActive: { backgroundColor: colors.accent },
  metricButtonText: { color: '#d1d5d2', fontSize: 12, fontWeight: '600' },
  metricButtonTextActive: { color: colors.background, fontWeight: '800' },
  chartHeader: { marginTop: 27, marginBottom: 18 },
  chartTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  chartCaption: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, marginTop: 6 },
  chart: { gap: 17 },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chartTopic: { width: '30%', color: colors.text, fontSize: 12 },
  barTrack: { height: 13, flex: 1, borderRadius: 99, overflow: 'hidden', backgroundColor: '#202423' },
  bar: { height: '100%', borderRadius: 99, backgroundColor: colors.accent },
  chartValue: { width: 24, textAlign: 'right', color: colors.text, fontSize: 12 },
  chartFootnote: { color: colors.muted, fontSize: 11, lineHeight: 17, marginTop: 23 },
  bottomNav: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: '#0c0e0e', paddingTop: 8, paddingBottom: 7 },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 48 },
  navLabel: { color: colors.muted, fontSize: 11, fontWeight: '500' },
  navSelected: { color: colors.accent, fontWeight: '800' },
  errorBanner: { backgroundColor: colors.danger, paddingHorizontal: 16, paddingVertical: 10 },
  errorText: { color: '#ffe2d7', fontSize: 12 },
});
