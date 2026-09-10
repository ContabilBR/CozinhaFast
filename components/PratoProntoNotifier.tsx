import React, { useCallback, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle } from "lucide-react-native";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime, type RealtimeEvent } from "@/hooks/useRealtime";
import { useColors } from "@/hooks/useColors";

// Roles that should be notified when the kitchen marks a dish ready.
// "cozinheiro" is deliberately excluded — they're the one who just marked it.
const NOTIFY_ROLES = new Set(["garcom", "gerente", "administrador", "admin"]);

const AUTO_DISMISS_MS = 5000;

// ============================================================================
// TEMP DEBUG — remove this whole block (and the <DebugPanel /> render below)
// once the "prato pronto" notification is confirmed working end to end.
// Collapsed by default: just a small dot in the bottom-right corner, out of
// the way of the tab bar. Tap it to expand and see the last event/payload.
// ============================================================================
const DEBUG_ENABLED = true;

function statusColor(status: string) {
  if (status === "connected") return "#22C55E";
  if (status === "connecting") return "#F59E0B";
  return "#EF4444";
}

function DebugPanel({
  status,
  lastEvent,
  lastEventAt,
}: {
  status: string;
  lastEvent: RealtimeEvent | null;
  lastEventAt: Date | null;
}) {
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <Pressable
        onPress={() => setExpanded(true)}
        style={[debugStyles.collapsedDot, { bottom: insets.bottom + 90, backgroundColor: statusColor(status) }]}
      />
    );
  }

  return (
    <Pressable
      onPress={() => setExpanded(false)}
      style={[debugStyles.container, { bottom: insets.bottom + 90 }]}
    >
      <View style={debugStyles.row}>
        <View style={[debugStyles.dot, { backgroundColor: statusColor(status) }]} />
        <Text style={debugStyles.text}>WS: {status} (toque pra fechar)</Text>
      </View>
      {lastEvent ? (
        <>
          <Text style={debugStyles.text} numberOfLines={1}>
            último evento: {lastEvent.type} ({lastEventAt?.toLocaleTimeString()})
          </Text>
          <Text style={debugStyles.text} numberOfLines={3}>
            payload: {lastEvent.payload ? JSON.stringify(lastEvent.payload) : "AUSENTE — backend ainda no formato antigo"}
          </Text>
        </>
      ) : (
        <Text style={debugStyles.text}>nenhum evento recebido ainda</Text>
      )}
    </Pressable>
  );
}

const debugStyles = StyleSheet.create({
  collapsedDot: {
    position: "absolute",
    right: 14,
    width: 16,
    height: 16,
    borderRadius: 8,
    zIndex: 998,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
  },
  container: {
    position: "absolute",
    right: 14,
    maxWidth: 260,
    backgroundColor: "rgba(0,0,0,0.9)",
    borderRadius: 10,
    padding: 10,
    zIndex: 998,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  text: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "monospace",
  },
});
// ============================================================================
// END TEMP DEBUG
// ============================================================================

/**
 * Global "prato pronto" banner. Mounted once at the root layout (not inside
 * any single tab/screen) so it's visible no matter where the garcom is in
 * the app when the kitchen marks a pedido as ready.
 */
export function PratoProntoNotifier() {
  const { user } = useAuth();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState<string | null>(null);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [lastEventAt, setLastEventAt] = useState<Date | null>(null);
  const translateY = useRef(new Animated.Value(-120)).current;
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    Animated.timing(translateY, {
      toValue: -120,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setMessage(null));
  }, [translateY]);

  const handleEvent = useCallback(
    (event: RealtimeEvent) => {
      // TEMP DEBUG: record every event that arrives, regardless of type/filter.
      setLastEvent(event);
      setLastEventAt(new Date());

      if (event.type !== "pedido.status_changed") return;
      if (event.payload?.status !== "pronto") return;

      const mesa = event.payload?.mesa_numero;
      const prato = event.payload?.prato_nome;

      let text: string;
      if (prato && mesa) {
        text = `Mesa ${mesa} — ${prato} está pronto`;
      } else if (prato) {
        text = `${prato} está pronto`;
      } else if (mesa) {
        text = `Mesa ${mesa} — um pedido está pronto`;
      } else {
        text = "Um pedido está pronto";
      }

      setMessage(text);
      translateY.setValue(-120);
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        speed: 14,
        bounciness: 6,
      }).start();

      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);
    },
    [dismiss, translateY]
  );

  const role = (user?.role || "").toLowerCase();
  const shouldConnect = !!user && NOTIFY_ROLES.has(role);

  const wsStatus = useRealtime({ onEvent: handleEvent, enabled: shouldConnect });

  return (
    <>
      {DEBUG_ENABLED && shouldConnect && (
        <DebugPanel status={wsStatus} lastEvent={lastEvent} lastEventAt={lastEventAt} />
      )}

      {message && (
        <Animated.View
          pointerEvents="box-none"
          style={[styles.container, { top: insets.top + 8, transform: [{ translateY }] }]}
        >
          <Pressable
            onPress={dismiss}
            style={[
              styles.banner,
              { backgroundColor: colors.surface, borderColor: colors.statusPronto },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.statusPronto }]}>
              <CheckCircle size={18} color="#fff" />
            </View>
            <Text style={[styles.text, { color: colors.text }]} numberOfLines={2}>
              {message}
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 999,
    alignItems: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    maxWidth: 480,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  text: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
});
