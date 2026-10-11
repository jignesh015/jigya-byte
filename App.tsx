import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Dimensions,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NavigationBar } from 'expo-navigation-bar';
import { HeartIcon } from './src/components/HeartIcon';
import { ReaderTransition } from './src/components/ReaderTransition';
import { useReducedMotion } from './src/hooks/useReducedMotion';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  getAnalytics,
  getCards,
  getInterests,
  getGeneratorSettings,
  getRecentlyShownCardIds,
  importCards,
  initializeDatabase,
  recordCardImpression,
  recordInteraction,
  saveInterests,
  saveGeneratorSettings,
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
import { DiscoveryFailure } from './src/data/discoveryProvider';
import { topics } from './src/data/cardContent';
import { wikimediaProvider } from './src/data/wikimediaProvider';
import { defaultGeneratorSettings, LocalCardGenerator, type GeneratorSettings } from './src/data/cardGenerator';

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

const fallbackLicenseUrl = 'https://creativecommons.org/licenses/by-sa/4.0/';
type Tab = 'feed' | 'favorites' | 'analytics';
type AppView = 'main' | 'detail' | 'interests';
type DiscoveryNotice = { kind: 'success' | 'empty' | 'offline' | 'error'; message: string } | null;

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
  discoveryNotice,
  onFavorite,
  onOpenDetails,
  onSeen,
  onOpenInterests,
  onDiscover,
  refreshing,
  onRefresh,
}: {
  cards: Card[];
  assignments: FeedAssignment[];
  active: boolean;
  discoveryBusy: boolean;
  discoveryNotice: DiscoveryNotice;
  onFavorite: (card: Card) => void;
  onOpenDetails: (card: Card) => void;
  onSeen: (cardId: string, lane: FeedLane) => Promise<void>;
  onOpenInterests: () => void;
  onDiscover: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const cardsById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const scrollMetrics = useRef({ offset: 0, viewportHeight: 0 });
  const reportedSeen = useRef(new Set<string>());
  const scrollRef = useRef<ScrollView | null>(null);
  const currentIndex = useRef(0);
  const gestureStart = useRef({ x: 0, y: 0 });
  const wasActive = useRef(false);
  const screenWidth = Dimensions.get('window').width;
  const backGestureEdge = 32;
  const [pageHeight, setPageHeight] = useState(0);

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
        const maxOffset = Math.max(0, (assignments.length - 1) * scrollMetrics.current.viewportHeight);
        const offset = Math.min(scrollMetrics.current.offset, maxOffset);
        currentIndex.current = scrollMetrics.current.viewportHeight > 0
          ? Math.round(offset / scrollMetrics.current.viewportHeight)
          : 0;
        scrollRef.current?.scrollTo({ y: offset, animated: false });
        reportSeen(currentIndex.current);
      });
    }
    wasActive.current = active;
  }, [active, assignments.length, reportSeen]);

  return (
    <View
      style={styles.feedRoot}
      onTouchStart={(event) => {
        gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
      }}
      onMoveShouldSetResponderCapture={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const startedAwayFromBackEdges = gestureStart.current.x > backGestureEdge
          && gestureStart.current.x < screenWidth - backGestureEdge;
        return active && assignments.length > 0 && startedAwayFromBackEdges
          && deltaX < -24 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
      }}
      onResponderRelease={(event) => {
        const deltaX = event.nativeEvent.pageX - gestureStart.current.x;
        const deltaY = event.nativeEvent.pageY - gestureStart.current.y;
        const card = cardsById.get(assignments[currentIndex.current]?.cardId ?? '');
        if (card && deltaX < -60 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) onOpenDetails(card);
      }}
      onResponderTerminationRequest={() => false}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.scrollView}
        contentContainerStyle={styles.feedPages}
        pagingEnabled
        decelerationRate="fast"
        bounces
        alwaysBounceVertical
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} enabled={active} colors={[colors.accent]} progressBackgroundColor={colors.surfaceRaised} tintColor={colors.accent} />}
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
        onMomentumScrollEnd={(event) => {
          if (!active) return;
          const height = scrollMetrics.current.viewportHeight;
          if (height <= 0) return;
          const nextIndex = Math.max(0, Math.min(assignments.length - 1, Math.round(event.nativeEvent.contentOffset.y / height)));
          currentIndex.current = nextIndex;
          scrollMetrics.current.offset = nextIndex * height;
          reportSeen(nextIndex);
        }}
      >
        {assignments.length === 0 ? (
          <View style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}>
            <View style={styles.card}>
              <View style={styles.feedHeader}>
                <View style={styles.feedBrand}>
                  <Text style={styles.eyebrow}>JIGYABYTE</Text>
                  <Text style={styles.introText}>A little more curious.</Text>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Choose interest topics" onPress={onOpenInterests} style={({ pressed }) => [styles.topicsButton, pressed && styles.pressed]}>
                  <Text style={styles.topicsButtonText}>Topics</Text>
                </Pressable>
              </View>
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Your deck is ready to grow.</Text>
                <Text style={styles.emptyText}>Find a card when you have a connection. Anything you save here stays on this device.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Find a new learning card from Wikipedia" disabled={discoveryBusy} onPress={onDiscover} style={({ pressed }) => [styles.discoverButton, discoveryBusy && styles.disabled, pressed && styles.pressed]}>
                {discoveryBusy ? <ActivityIndicator color={colors.background} size="small" /> : <Text style={styles.discoverGlyph}>＋</Text>}
                <View style={styles.discoverCopy}>
                  <Text style={styles.discoverTitle}>{discoveryBusy ? 'Finding a new idea…' : 'Find a new card'}</Text>
                  <Text style={styles.discoverSubtitle}>Free public source · saved for offline reading</Text>
                </View>
                <Text style={styles.discoverArrow}>›</Text>
              </Pressable>
            </View>
          </View>
        ) : assignments.map((assignment, index) => {
          const card = cardsById.get(assignment.cardId);
          if (!card) return <View key={assignment.cardId} style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}><View style={styles.card}><Text style={styles.emptyTitle}>This earlier card has left your recent history.</Text><Text style={styles.emptyText}>Swipe up to continue. Favorites stay available offline.</Text></View></View>;
          const laneLabel = assignment.lane === 'interest' ? 'YOUR INTERESTS'
            : assignment.lane === 'review' ? 'READY TO REVIEW' : 'DISCOVERY';

          return (
            <View key={assignment.rank ?? card.id} style={[styles.feedPage, pageHeight > 0 && { height: pageHeight }]}>
              <View style={styles.card}>
                <View>
                  <View style={styles.feedHeader}>
                    <View style={styles.feedBrand}>
                      <Text style={styles.eyebrow}>JIGYABYTE</Text>
                      <Text style={styles.introText}>A little more curious.</Text>
                    </View>
                    <Pressable accessibilityRole="button" accessibilityLabel="Choose interest topics" onPress={onOpenInterests} style={({ pressed }) => [styles.topicsButton, pressed && styles.pressed]}>
                      <Text style={styles.topicsButtonText}>Topics</Text>
                    </Pressable>
                  </View>
                  {discoveryNotice ? (
                    <View style={[styles.providerNotice, discoveryNotice.kind === 'offline' && styles.providerNoticeOffline]} accessibilityLiveRegion="polite">
                      <Text numberOfLines={2} style={styles.providerNoticeText}>{discoveryNotice.message}</Text>
                    </View>
                  ) : null}
                  <View style={[styles.cardMetaRow, styles.cardMetaSpaced]}>
                    <SectionLabel>{laneLabel}</SectionLabel>
                    <Text style={styles.cardTopic}>{topicName(card.primaryTopicId).toUpperCase()}</Text>
                  </View>
                  <Text numberOfLines={3} style={styles.cardTitle}>{card.title}</Text>
                  <Text numberOfLines={4} style={styles.cardSummary}>{card.summary}</Text>
                </View>
                <View>
                  <View style={styles.cardFooter}>
                    <Text numberOfLines={1} style={styles.attribution}>{card.sourceName.toUpperCase()}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={card.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      accessibilityState={{ selected: card.isFavorite }}
                      onPress={() => onFavorite(card)}
                      style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}
                    >
                      <HeartIcon filled={card.isFavorite} color={card.isFavorite ? colors.accent : colors.muted} />
                    </Pressable>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`More about ${card.title}`}
                    onPress={() => onOpenDetails(card)}
                    style={({ pressed }) => [styles.moreRow, pressed && styles.pressed]}
                  >
                    <Text style={styles.moreArrow}>←</Text>
                    <Text style={styles.moreText}>Swipe left for the full idea</Text>
                    <Text style={styles.moreButton}>More</Text>
                  </Pressable>
                  <View style={styles.feedPageFooter}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Find a new learning card from Wikipedia" disabled={discoveryBusy} onPress={onDiscover} style={({ pressed }) => [styles.discoverCompact, discoveryBusy && styles.disabled, pressed && styles.pressed]}>
                      {discoveryBusy ? <ActivityIndicator color={colors.accent} size="small" /> : <Text style={styles.discoverCompactGlyph}>＋</Text>}
                      <Text style={styles.discoverCompactText}>{discoveryBusy ? 'Finding a card…' : 'Find a new card'}</Text>
                    </Pressable>
                    <Text style={styles.nextCardHint}>{index < assignments.length - 1 ? 'SWIPE UP FOR NEXT' : 'END OF YOUR DECK'}</Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
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
  const fromWikipedia = card.providerId === 'wikimedia-en';

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

      <Text style={styles.detailTopic}>{topicName(card.primaryTopicId).toUpperCase()}</Text>
      <Text style={styles.detailTitle}>{card.title}</Text>
      <View style={styles.shortAnswer}>
        <SectionLabel>The short answer</SectionLabel>
        <Text style={styles.shortAnswerText}>{card.summary}</Text>
      </View>
      <Text style={styles.explanationText}>{card.explanation}</Text>

      <View style={styles.sourcePanel}>
        {card.provenance ? <Text style={styles.sourceAttribution}>{card.provenance.contentMode === 'ai-only' ? 'AI generated · unverified' : 'AI prepared from fetched sources'} · {card.provenance.providerId} / {card.provenance.modelId}</Text> : null}
        <Text style={styles.sourceHeading}>SOURCE & ATTRIBUTION</Text>
        <Text style={styles.sourceAttribution}>{card.attribution}</Text>
        {card.sourceUrl ? (
          <Pressable onPress={() => void Linking.openURL(card.sourceUrl!)} style={({ pressed }) => [styles.sourceLink, pressed && styles.pressed]}>
            <Text style={styles.sourceLinkText}>Open {fromWikipedia ? 'Wikipedia' : card.sourceName}</Text>
            <Text style={styles.sourceArrow}>↗</Text>
          </Pressable>
        ) : null}
        <Text style={styles.sourceLicense}>License: {card.license}</Text>
        {fromWikipedia ? (
          <Pressable onPress={() => void Linking.openURL(card.licenseUrl ?? fallbackLicenseUrl)} style={({ pressed }) => [styles.licenseLink, pressed && styles.pressed]}>
            <Text style={styles.licenseLinkText}>Open license terms ↗</Text>
          </Pressable>
        ) : null}
        {card.references.map(source => <View key={source.id}>
          <Text style={styles.sourceAttribution}>{source.attribution}</Text>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(source.url)} style={styles.sourceLink}><Text style={styles.sourceLinkText}>{source.title} ↗</Text></Pressable>
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(source.licenseUrl)} style={styles.licenseLink}><Text style={styles.licenseLinkText}>{source.license} ↗</Text></Pressable>
        </View>)}
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
  generatorSettings,
  onGenerate,
  generationBusy,
  backendSettings,
}: {
  initialIds: string[];
  firstLaunch: boolean;
  saving: boolean;
  onSave: (ids: string[], generator: GeneratorSettings, backend: BackendSettings) => void;
  onCancel: () => void;
  onSkip: () => void;
  generatorSettings: GeneratorSettings;
  onGenerate: (settings: GeneratorSettings) => void;
  generationBusy: boolean;
  backendSettings: BackendSettings;
}) {
  const [draft, setDraft] = useState(initialIds);
  const [generator, setGenerator] = useState(generatorSettings);
  const [backend, setBackend] = useState(backendSettings);
  const initialKey = initialIds.join(',');

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
      <View style={styles.topicGrid}>
        {topics.map((topic) => {
          const selected = draft.includes(topic.id);
          return (
            <Pressable
              key={topic.id}
              accessibilityRole="checkbox"
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
        <Text style={styles.interestsDescription}>Refill your offline library from your PC. Provider and model choices come from the backend.</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: backend.enabled }} onPress={() => setBackend(current => ({ ...current, enabled: !current.enabled }))} style={styles.topicChip}>
          <Text style={styles.topicChipText}>{backend.enabled ? '✓ Automatic refill enabled' : '+ Enable automatic refill'}</Text>
        </Pressable>
        <TextInput accessibilityLabel="Backend server address" value={backend.serviceUrl} onChangeText={serviceUrl => setBackend(current => ({ ...current, serviceUrl }))} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.serviceInput} />
        <TextInput accessibilityLabel="Backend pairing token" value={backend.pairingToken} onChangeText={pairingToken => setBackend(current => ({ ...current, pairingToken }))} secureTextEntry autoCapitalize="none" autoCorrect={false} style={styles.serviceInput} placeholder="Backend pairing token" placeholderTextColor={colors.muted} />
        <Text style={styles.reviewHint}>Use BACKEND_DEVICE_TOKEN from the PC configuration. Your Gemini key stays on the PC.</Text>
      </View>
      <View style={styles.generatorPanel}>
        <Text style={styles.reviewTitle}>Optional local AI</Text>
        <Text style={styles.interestsDescription}>Generate an unverified explanation using a model on your PC. Public discovery and saved cards work without it.</Text>
        <Pressable accessibilityRole="switch" accessibilityState={{ checked: generator.enabled }}
          onPress={() => setGenerator(current => ({ ...current, enabled: !current.enabled }))} style={styles.topicChip}>
          <Text style={styles.topicChipText}>{generator.enabled ? '✓ Local AI enabled' : '+ Enable local AI'}</Text>
        </Pressable>
        {generator.enabled ? <>
          <Text style={styles.reviewHint}>PC service address</Text>
          <TextInput accessibilityLabel="Local PC service address" value={generator.serviceUrl}
            onChangeText={serviceUrl => setGenerator(current => ({ ...current, serviceUrl }))}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.serviceInput} />
          <ActionButton label={generationBusy ? 'Generating…' : 'Generate one AI card'} disabled={generationBusy || saving || firstLaunch}
            onPress={() => onGenerate(generator)} />
          <Text style={styles.reviewHint}>{firstLaunch ? 'Save your settings first, then reopen Topics to generate.' : 'Requires a running local service and installed model. No paid APIs.'}</Text>
        </> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        onPress={() => onSave(draft, generator, backend)}
        style={({ pressed }) => [styles.primaryButton, saving && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.primaryButtonText}>{saving ? 'Saving…' : 'Save interests'}</Text>
      </Pressable>
      {firstLaunch ? (
        <Pressable accessibilityRole="button" disabled={saving} onPress={onSkip} style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
          <Text style={styles.skipButtonText}>Explore with discoveries for now</Text>
        </Pressable>
      ) : (
        <Pressable accessibilityRole="button" disabled={saving} onPress={onCancel} style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}>
          <Text style={styles.skipButtonText}>Back to feed</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

function AnalyticsScreen({ snapshot, selected, onSelect, backendStatus, onRetry }: {
  snapshot: AnalyticsSnapshot | null;
  selected: AnalyticsMetric;
  onSelect: (metric: AnalyticsMetric) => void;
  backendStatus: BackendStatus | null;
  onRetry: () => void;
}) {
  const maxValue = useMemo(() => Math.max(1, ...topics.map((topic) => snapshot?.byTopic[selected][topic.id] ?? 0)), [selected, snapshot]);

  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.analyticsContent} showsVerticalScrollIndicator={false}>
      <Text style={styles.pageTitle}>Your learning</Text>
      <Text style={styles.analyticsSubtitle}>A snapshot of the ideas you’ve explored across all time.</Text>

      {backendStatus ? <View style={styles.backendBanner} accessibilityLiveRegion="polite">
        <View style={{ flex: 1 }}><Text style={styles.providerNoticeText}>{backendStatus.unread} unread · {backendStatus.provider ?? 'Backend'}{backendStatus.model ? ` / ${backendStatus.model}` : ''}</Text>
          <Text style={styles.reviewHint}>{backendStatus.message}{backendStatus.unread < 50 ? ' Your offline supply is below 50.' : ''}</Text></View>
        <ActionButton compact label="Retry" onPress={onRetry} />
      </View> : null}

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

      <View style={styles.chartHeader}>
        <Text style={styles.chartTitle}>{metricLabels[selected]} by topic</Text>
        <Text style={styles.chartCaption}>UNIQUE CARDS · PRIMARY TOPIC · ALL TIME</Text>
      </View>
      {snapshot?.totals[selected] === 0 ? (
        <Text style={styles.chartFootnote} accessibilityLiveRegion="polite">
          {selected === 'seen' ? 'Read a card in the Feed to start your chart.'
            : selected === 'expanded' ? 'Open More on a card to explore an idea.'
              : 'Save a card with the heart to see your favorites here.'}
        </Text>
      ) : null}
      <View style={styles.chart}>
        {topics.map((topic) => {
          const value = snapshot?.byTopic[selected][topic.id] ?? 0;
          const fill = value === 0 ? 0 : Math.max(4, (value / maxValue) * 100);
          return (
            <View key={topic.id} style={styles.chartRow} accessible accessibilityLabel={`${topic.name}: ${value} ${metricLabels[selected].toLowerCase()} cards`}>
              <Text style={styles.chartTopic}>{topic.name}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.bar, { width: `${fill}%` }]} />
              </View>
              <Text style={styles.chartValue}>{value}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.chartFootnote}>Seen and Expanded count each card once, under its primary topic. Favorites shows cards currently saved.</Text>
    </ScrollView>
  );
}

function FavoritesScreen({ cards, onOpen, onFavorite, onFeed }: { cards: Card[]; onOpen: (card: Card) => void; onFavorite: (card: Card) => void; onFeed: () => void }) {
  const favorites = cards.filter(c => c.isFavorite).sort((a,b) => (b.savedAt ?? '').localeCompare(a.savedAt ?? '') || a.id.localeCompare(b.id));
  return <ScrollView style={styles.scrollView} contentContainerStyle={styles.analyticsContent}>
    <Text style={styles.pageTitle}>Favorites</Text><Text style={styles.analyticsSubtitle}>Saved ideas, available offline.</Text>
    {!favorites.length ? <><Text style={styles.emptyText}>Tap a card’s heart to keep it here.</Text><ActionButton label="Back to feed" onPress={onFeed} /></> : favorites.map(card => <View key={card.id} style={styles.generatorPanel}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Read ${card.title}`} onPress={() => onOpen(card)}>
        <Text style={styles.cardTopic}>{topicName(card.primaryTopicId)}</Text><Text style={styles.reviewTitle}>{card.title}</Text><Text numberOfLines={3} style={styles.emptyText}>{card.summary}</Text>
      </Pressable><ActionButton compact label="Remove favorite" onPress={() => onFavorite(card)} />
    </View>)}
  </ScrollView>;
}
function BottomNavigation({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const items: { id: Tab; label: string; glyph: string }[] = [
    { id: 'feed', label: 'Feed', glyph: '▤' },
    { id: 'favorites', label: 'Favorites', glyph: '' },
    { id: 'analytics', label: 'Analytics', glyph: '▥' },
  ];
  return (
    <View style={styles.bottomNav}>
      {items.map((item) => {
        const selected = active === item.id;
        return (
          <Pressable
            key={item.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(item.id)}
            style={({ pressed }) => [styles.navItem, pressed && styles.pressed]}
          >
            {item.id === 'favorites' ? <HeartIcon size={22} filled={selected} color={selected ? colors.accent : colors.muted} /> : <Text style={[styles.navGlyph, selected && styles.navSelected]}>{item.glyph}</Text>}
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
  const [generationBusy, setGenerationBusy] = useState(false);
  const [generatorSettings, setGeneratorSettings] = useState(defaultGeneratorSettings);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<DiscoveryNotice>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendSettings, setBackendSettings] = useState(defaultBackendSettings);
  const [refreshingFeed, setRefreshingFeed] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>({ state: 'disabled', message: 'Backend connection is optional.', unread: 0 });
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
        const [nextCards, nextAnalytics, savedInterests, recentlyShown, savedGenerator] = await Promise.all([
          getCards(), getAnalytics(), getInterests(), getRecentlyShownCardIds(), getGeneratorSettings(),
        ]);
        if (!active) return;
        recentIds.current = recentlyShown;
        setCards(nextCards);
        setGeneratorSettings(savedGenerator);
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
    const sync = new BackendSync(setBackendStatus, async () => { await refreshLocalData(); });
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

  const handleFavorite = useCallback((card: Card) => {
    void (async () => {
      try {
        await setFavorite(card.id, !card.isFavorite);
        await refreshAfterAction();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'That favorite could not be saved.');
      }
    })();
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
    setView('interests');
  }, [interests]);

  const saveInterestSelection = useCallback(async (selectedIds: string[], generator = generatorSettings, backend = backendSettings) => {
    setSavingInterests(true);
    try {
      await saveGeneratorSettings(generator);
      setGeneratorSettings(generator);
      await saveInterests(selectedIds);
      const configured = await saveBackendSettings(backend);
      setBackendSettings(configured);
      syncRef.current?.configure(configured);
      const normalized = [...new Set(selectedIds)];
      setInterests(normalized);
      setInterestDraft(normalized);
      await refreshLocalData();
      setFirstLaunch(false);
      setView('main');
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Those topics could not be saved.');
    } finally {
      setSavingInterests(false);
    }
  }, [backendSettings, generatorSettings, refreshLocalData]);

  const generateCard = useCallback((settings: GeneratorSettings) => {
    if (generationBusy || !settings.enabled) return;
    setGenerationBusy(true);
    void (async () => {
      try {
        await saveGeneratorSettings(settings);
        setGeneratorSettings(settings);
        const pool = topics.filter(topic => interests.includes(topic.id));
        const candidates = pool.length ? pool : topics;
        const topic = candidates[Math.floor(Math.random() * candidates.length)];
        const card = await new LocalCardGenerator(settings.serviceUrl).generate(topic);
        const count = await importCards([card]);
        await refreshLocalData();
        syncRef.current?.request();
        setDiscoveryNotice({ kind: count ? 'success' : 'empty', message: count ? `Added AI explanation: ${card.title}. Unverified; saved offline.` : 'That AI idea is already saved.' });
        setError(null);
        setView('main');
        setTab('feed');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Local generation unavailable. Saved cards remain readable.');
      } finally { setGenerationBusy(false); }
    })();
  }, [generationBusy, interests, refreshLocalData]);

  const discoverCard = useCallback(async () => {
    if (discoveryBusy) return;
    setDiscoveryBusy(true);
    setDiscoveryNotice(null);
      try {
        const counts = topics.map((topic) => ({
          topic,
          count: cards.filter((card) => card.topicIds.includes(topic.id)).length,
          preferred: interests.includes(topic.id),
        }));
        const preferred = counts.some((item) => item.preferred) ? counts.filter((item) => item.preferred) : counts;
        const minimum = Math.min(...preferred.map((item) => item.count));
        const leastCovered = preferred.filter((item) => item.count === minimum);
        const selectedTopic = leastCovered[Math.floor(Math.random() * leastCovered.length)].topic;
        const existingIds = new Set(cards.map((card) => card.id));
        const discovered = await wikimediaProvider.discover(selectedTopic, existingIds);
        if (!discovered) {
          setDiscoveryNotice({ kind: 'empty', message: `No new ${selectedTopic.name} card was available. Try again to explore another topic.` });
          return;
        }
        const importedCount = await importCards([discovered]);
        if (importedCount === 0) {
          setDiscoveryNotice({ kind: 'empty', message: 'That idea is already in your deck. Try again for another one.' });
          return;
        }
        await refreshLocalData();
        syncRef.current?.request();
        setDiscoveryNotice({ kind: 'success', message: `Added “${discovered.title}” from Wikipedia. It is saved on this device.` });
      } catch (cause) {
        if (cause instanceof DiscoveryFailure) {
          setDiscoveryNotice({
            kind: cause.kind === 'offline' ? 'offline' : 'error',
            message: cause.message,
          });
        } else {
          setDiscoveryNotice({ kind: 'error', message: 'Could not add a card right now. Your saved cards are still available.' });
        }
      } finally {
        setDiscoveryBusy(false);
      }
  }, [cards, discoveryBusy, interests, refreshLocalData]);

  const refreshFeed = useCallback(async () => {
    if (refreshingFeed || discoveryBusy) return;
    setRefreshingFeed(true);
    try {
      await refreshLocalData();
      if (backendSettings.enabled && syncRef.current) await syncRef.current.refresh();
      else await discoverCard();
    } catch {
      setDiscoveryNotice({ kind: 'offline', message: 'Could not refresh right now. Saved cards remain available.' });
    } finally { setRefreshingFeed(false); }
  }, [refreshingFeed, discoveryBusy, backendSettings.enabled, refreshLocalData, discoverCard]);

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

              <View style={[styles.mainContent, view !== 'main' && styles.hiddenPane]}>
                <View style={[styles.mainPane, tab !== 'feed' && styles.hiddenPane]}>
                  <FeedScreen
                    cards={cards}
                    assignments={assignments}
                    active={view === 'main' && tab === 'feed'}
                    discoveryBusy={discoveryBusy}
                    discoveryNotice={discoveryNotice}
                    onFavorite={handleFavorite}
                    onOpenDetails={openDetails}
                    onSeen={handleSeen}
                    onOpenInterests={openInterests}
                    onDiscover={discoverCard}
                    refreshing={refreshingFeed}
                    onRefresh={() => void refreshFeed()}
                  />
                </View>
                <View style={[styles.mainPane, tab !== 'favorites' && styles.hiddenPane]}>
                  <FavoritesScreen cards={cards} onOpen={openDetails} onFavorite={handleFavorite} onFeed={() => setTab('feed')} />
                </View>
                <View style={[styles.mainPane, tab !== 'analytics' && styles.hiddenPane]}>
                  <AnalyticsScreen snapshot={analytics} selected={metric} onSelect={setMetric} backendStatus={backendSettings.enabled ? backendStatus : null} onRetry={() => syncRef.current?.retry()} />
                </View>
              </View>

              {view === 'interests' ? (
                <InterestsScreen
                  initialIds={interestDraft}
                  firstLaunch={firstLaunch}
                  saving={savingInterests}
                  onSave={(ids, generator, backend) => void saveInterestSelection(ids, generator, backend)}
                  onCancel={() => setView('main')}
                  onSkip={() => void saveInterestSelection([])}
                  generatorSettings={generatorSettings}
                  generationBusy={generationBusy}
                  onGenerate={generateCard}
                  backendSettings={backendSettings}
                />
              ) : null}

              {view === 'detail' ? (
                <ReaderTransition reducedMotion={reducedMotion}>
                <DetailScreen
                  card={selectedCard}
                  onBack={closeReader}
                  backLabel={readerOrigin.current === 'favorites' ? 'Back to favorites' : 'Back to feed'}
                  onFavorite={handleFavorite}
                  onReview={handleReview}
                  reviewBusy={reviewBusy}
                />
                </ReaderTransition>
              ) : null}

              {view === 'main' ? <BottomNavigation active={tab} onChange={setTab} /> : null}
              <NavigationBar style="dark" />
            </>
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  backendBanner: { padding: 16, marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface },
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
  feedPage: { paddingHorizontal: 12, paddingVertical: 10 },
  detailContent: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 34 },
  analyticsContent: { paddingHorizontal: 20, paddingTop: 32, paddingBottom: 28 },
  interestsContent: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 50, paddingBottom: 34, justifyContent: 'center' },
  feedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  feedBrand: { flex: 1 },
  eyebrow: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 4, marginBottom: 9 },
  pageTitle: { color: colors.text, fontSize: 29, fontWeight: '700', letterSpacing: -1.1 },
  topicsButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, minHeight: 42, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center' },
  topicsButtonText: { color: colors.text, fontSize: 12, fontWeight: '600' },
  introText: { color: colors.muted, fontSize: 14, lineHeight: 20, marginTop: 3 },
  discoverButton: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 16, marginBottom: 18 },
  discoverGlyph: { color: colors.background, fontSize: 28, fontWeight: '400' },
  discoverCopy: { flex: 1 },
  discoverTitle: { color: colors.background, fontSize: 14, fontWeight: '800' },
  discoverSubtitle: { color: '#263514', fontSize: 11, marginTop: 3 },
  discoverArrow: { color: colors.background, fontSize: 26, fontWeight: '400' },
  providerNotice: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 14 },
  providerNoticeOffline: { borderColor: '#62413a', backgroundColor: colors.danger },
  providerNoticeText: { color: colors.text, fontSize: 12, lineHeight: 18 },
  card: { flex: 1, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 24, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 14, justifyContent: 'space-between' },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  cardMetaSpaced: { marginTop: 27 },
  sectionLabel: { color: colors.accent, fontSize: 10, letterSpacing: 3, fontWeight: '800' },
  cardTopic: { color: colors.muted, fontSize: 9, letterSpacing: 1.2, fontWeight: '700' },
  cardTitle: { color: colors.text, fontSize: 25, fontWeight: '700', lineHeight: 31, letterSpacing: -0.5, marginTop: 18 },
  cardSummary: { color: '#d6dad5', fontSize: 16, lineHeight: 25, marginTop: 12 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 17 },
  attribution: { flex: 1, color: colors.muted, fontSize: 9, letterSpacing: 1.3, fontWeight: '700', marginRight: 12 },
  favoriteButton: { paddingHorizontal: 4, paddingVertical: 1, minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  detailFavorite: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderTopWidth: 1, borderTopColor: colors.border, minHeight: 48, marginTop: 8 },
  moreArrow: { color: colors.muted, fontSize: 20 },
  moreText: { color: colors.muted, fontSize: 11 },
  moreButton: { color: colors.accent, fontSize: 12, fontWeight: '800', marginLeft: 3 },
  feedPageFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 6, paddingTop: 7 },
  discoverCompact: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 48, paddingHorizontal: 4 },
  discoverCompactGlyph: { color: colors.accent, fontSize: 18, fontWeight: '600' },
  discoverCompactText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  nextCardHint: { color: colors.muted, fontSize: 8, fontWeight: '700', letterSpacing: 1.1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
  emptyCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 24, padding: 22, marginTop: 4 },
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
  topicGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: 1 },
  topicChipSelected: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  topicChipGlyph: { color: colors.muted, fontSize: 16, fontWeight: '500' },
  topicChipGlyphSelected: { color: colors.accent, fontWeight: '800' },
  topicChipText: { color: colors.text, fontSize: 12, fontWeight: '500' },
  topicChipTextSelected: { color: colors.accent, fontWeight: '700' },
  primaryButton: { minHeight: 52, borderRadius: 16, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 27 },
  primaryButtonText: { color: colors.background, fontSize: 14, fontWeight: '800' },
  skipButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', marginTop: 9 },
  skipButtonText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  generatorPanel: { marginTop: 26, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 20, gap: 10 },
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
  navGlyph: { color: colors.muted, fontSize: 20, lineHeight: 23 },
  navLabel: { color: colors.muted, fontSize: 11, fontWeight: '500' },
  navSelected: { color: colors.accent, fontWeight: '800' },
  errorBanner: { backgroundColor: colors.danger, paddingHorizontal: 16, paddingVertical: 10 },
  errorText: { color: '#ffe2d7', fontSize: 12 },
});
