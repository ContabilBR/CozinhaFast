import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Animated,
  ActivityIndicator,
  ScrollView,
  LayoutAnimation,
  Platform,
  UIManager,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet, apiPut } from "@/utils/api";
import { formatElapsed } from "@/utils/helpers";
import {
  Flame,
  Clock,
  RefreshCw,
  ChefHat,
  Package,
  UtensilsCrossed,
  User,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react-native";
import { useRealtime, type RealtimeStatus } from "@/hooks/useRealtime";

if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ComandaPedido {
  id: string;
  prato_nome: string;
  tempo_preparo_min: number | null;
  quantidade: number;
  status: string;
  observacao: string | null;
  created_at: string;
}

interface Comanda {
  id: string;
  numero_comanda: string;
  mesa_numero: number;
  created_at: string;
  garcom_nome: string;
  total_itens: number;
  status: string;
  pedidos: ComandaPedido[];
}

const STATUS_COLORS: Record<string, string> = {
  pendente: "#94A3B8",
  em_preparo: "#F59E0B",
  pronto: "#22C55E",
  entregue: "#0D9488",
  cancelado: "#EF4444",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_preparo: "Em Preparo",
  pronto: "Pronto",
  entregue: "Entregue",
  cancelado: "Cancelado",
};

const COMANDA_STATUS_COLORS: Record<string, string> = {
  aberta: "#6366F1",
  fechada: "#22C55E",
  cancelada: "#EF4444",
};

const COMANDA_STATUS_LABELS: Record<string, string> = {
  aberta: "Aberta",
  fechada: "Fechada",
  cancelada: "Cancelada",
};

type ComandaFilter = "todas" | "abertas" | "fechadas" | "canceladas";

const COMANDA_FILTERS: { key: ComandaFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "abertas", label: "Abertas" },
  { key: "fechadas", label: "Fechadas" },
  { key: "canceladas", label: "Canceladas" },
];

const COMANDA_FILTER_STATUS: Record<ComandaFilter, string | null> = {
  todas: null,
  abertas: "aberta",
  fechadas: "fechada",
  canceladas: "cancelada",
};

const ACTIVE_STATUSES = ["pendente", "em_preparo", "pronto"];

const DEFAULT_TEMPO_PREPARO_MIN = 15;

function getPedidoUrgencia(pedido: { created_at: string; tempo_preparo_min: number | null }) {
  const targetMin = pedido.tempo_preparo_min ?? DEFAULT_TEMPO_PREPARO_MIN;
  const diffMin = Math.floor((Date.now() - new Date(pedido.created_at).getTime()) / 60000);
  const isUrgent = diffMin >= targetMin;
  const isWarning = !isUrgent && diffMin >= targetMin * 0.7;
  return { diffMin, targetMin, isUrgent, isWarning };
}

function KitchenTicketCard({
  item,
  index,
  onAction,
}: {
  item: Comanda;
  index: number;
  onAction: (id: string, status: string) => Promise<void>;
}) {
  const COLORS = useColors();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const activePedidos = (Array.isArray(item.pedidos) ? item.pedidos : []).filter(
    (p) => ACTIVE_STATUSES.includes(p.status)
  );

  const itemUrgencias = activePedidos.map((p) => getPedidoUrgencia(p));
  const isUrgent = itemUrgencias.some((u) => u.isUrgent);
  const isWarning = !isUrgent && itemUrgencias.some((u) => u.isWarning);
  const borderColor = isUrgent ? "#EF444460" : isWarning ? "#F59E0B60" : COLORS.border;

  const oldestCreatedAt = activePedidos.reduce<string | null>((oldest, p) => {
    if (!oldest) return p.created_at;
    return new Date(p.created_at).getTime() < new Date(oldest).getTime() ? p.created_at : oldest;
  }, null);

  const diffMin = oldestCreatedAt
    ? Math.floor((Date.now() - new Date(oldestCreatedAt).getTime()) / 60000)
    : 0;
  const elapsed = formatElapsed(oldestCreatedAt ?? undefined);

  const mesaNum = String(item.mesa_numero);
  const comandaCode = item.id.slice(-6).toUpperCase();
  const comandaLabel = "#" + comandaCode;
  const garcomNome = item.garcom_nome;

  const pendentesCount = activePedidos.filter((p) => p.status === "pendente").length;
  const emPreparoCount = activePedidos.filter((p) => p.status === "em_preparo").length;
  const prontoCount = activePedidos.filter((p) => p.status === "pronto").length;

  const urgentBannerText = "Aguardando há " + diffMin + " min — URGENTE";

  const handlePedidoAction = async (pedidoId: string, newStatus: string) => {
    console.log("[Cozinha] KitchenTicketCard action:", pedidoId, "->", newStatus);
    setUpdatingId(pedidoId);
    try {
      await onAction(pedidoId, newStatus);
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1.5,
          borderColor,
          overflow: "hidden",
        }}
      >
        {/* Urgency banner */}
        {isUrgent && (
          <View style={{ backgroundColor: "#EF444415", paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#EF4444" }}>
              {urgentBannerText}
            </Text>
          </View>
        )}

        {/* Header */}
        <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
          {/* Mesa circle */}
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: COLORS.primaryMuted,
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.primary }}>
              {mesaNum}
            </Text>
          </View>

          {/* Center info */}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>
              Mesa {mesaNum}
            </Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
              {comandaLabel}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <User size={12} color={COLORS.textSecondary} />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                {garcomNome}
              </Text>
            </View>
          </View>

          {/* Right: elapsed + urgency dot */}
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Clock size={12} color={isUrgent ? "#EF4444" : isWarning ? "#F59E0B" : COLORS.textSecondary} />
              <Text
                style={{
                  fontFamily: "Outfit_600SemiBold",
                  fontSize: 12,
                  color: isUrgent ? "#EF4444" : isWarning ? "#F59E0B" : COLORS.textSecondary,
                }}
              >
                {elapsed}
              </Text>
            </View>
            {(isUrgent || isWarning) && (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: isUrgent ? "#EF4444" : "#F59E0B",
                }}
              />
            )}
          </View>
        </View>

        {/* Pedidos list */}
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: COLORS.divider,
            paddingHorizontal: 14,
            paddingTop: 10,
            paddingBottom: 4,
            gap: 6,
          }}
        >
          {activePedidos.map((pedido) => {
            const pedidoStatusColor = STATUS_COLORS[pedido.status] || "#94A3B8";
            const pedidoStatusLabel = STATUS_LABELS[pedido.status] || pedido.status;
            const isPendente = pedido.status === "pendente";
            const isEmPreparo = pedido.status === "em_preparo";
            const isPronto = pedido.status === "pronto";
            const isUpdating = updatingId === pedido.id;
            const pedidoUrgencia = getPedidoUrgencia(pedido);

            const nextStatus = isPendente ? "em_preparo" : isEmPreparo ? "pronto" : null;
            const actionLabel = isPendente ? "Iniciar" : isEmPreparo ? "Pronto" : null;
            const actionBg = isPendente ? "#F59E0B" : "#22C55E";

            return (
              <View
                key={pedido.id}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  paddingVertical: 7,
                  borderBottomWidth: 1,
                  borderBottomColor: COLORS.divider,
                }}
              >
                {/* Qty badge */}
                <View
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    backgroundColor: COLORS.primaryMuted,
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: COLORS.primary }}>
                    {pedido.quantidade}
                  </Text>
                </View>

                {/* Name + obs */}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text }}>
                    {pedido.prato_nome}
                  </Text>
                  {(isPendente || isEmPreparo) && (
                    <Text
                      style={{
                        fontFamily: "Outfit_600SemiBold",
                        fontSize: 10,
                        color: pedidoUrgencia.isUrgent ? "#EF4444" : pedidoUrgencia.isWarning ? "#F59E0B" : COLORS.textTertiary,
                      }}
                    >
                      {pedidoUrgencia.diffMin}/{pedidoUrgencia.targetMin} min
                    </Text>
                  )}
                  {pedido.observacao ? (
                    <Text
                      style={{
                        fontFamily: "Outfit_400Regular",
                        fontSize: 11,
                        color: COLORS.textSecondary,
                        fontStyle: "italic",
                      }}
                    >
                      {pedido.observacao}
                    </Text>
                  ) : null}
                </View>

                {/* Status badge */}
                <View
                  style={{
                    backgroundColor: pedidoStatusColor + "20",
                    borderRadius: 6,
                    paddingHorizontal: 7,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: pedidoStatusColor }}>
                    {pedidoStatusLabel}
                  </Text>
                </View>

                {/* Action */}
                {isPronto ? (
                  <View
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: "#22C55E20",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Check size={14} color="#22C55E" />
                  </View>
                ) : nextStatus && actionLabel ? (
                  <AnimatedPressable
                    onPress={() => {
                      console.log("[Cozinha] Ticket action button pressed:", pedido.id, "->", nextStatus);
                      handlePedidoAction(pedido.id, nextStatus);
                    }}
                    disabled={isUpdating}
                    style={{
                      backgroundColor: actionBg,
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      minWidth: 56,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isUpdating ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#fff" }}>
                        {actionLabel}
                      </Text>
                    )}
                  </AnimatedPressable>
                ) : null}
              </View>
            );
          })}
        </View>

        {/* Footer summary */}
        <View style={{ paddingHorizontal: 14, paddingVertical: 10 }}>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
            {pendentesCount} pendentes · {emPreparoCount} em preparo · {prontoCount} prontos
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function ComandaCard({ item, index }: { item: Comanda; index: number }) {
  const COLORS = useColors();
  const [expanded, setExpanded] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const handleToggle = () => {
    console.log("[Cozinha] ComandaCard toggled:", item.id, "expanded:", !expanded);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((prev) => !prev);
  };

  const comandaCode = item.id.slice(-6).toUpperCase();
  const comandaLabel = "#" + comandaCode;

  const createdDate = new Date(item.created_at);
  const hours = String(createdDate.getHours()).padStart(2, "0");
  const minutes = String(createdDate.getMinutes()).padStart(2, "0");
  const timeLabel = hours + ":" + minutes;

  const mesaNum = String(item.mesa_numero);
  const garcomNome = item.garcom_nome;
  const totalItens = String(item.total_itens);

  const comandaStatusColor = COMANDA_STATUS_COLORS[item.status] || "#94A3B8";
  const comandaStatusLabel = COMANDA_STATUS_LABELS[item.status] || item.status;

  const pedidos: ComandaPedido[] = Array.isArray(item.pedidos) ? item.pedidos : [];

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <View
        style={{
          backgroundColor: COLORS.surface,
          borderRadius: 16,
          marginHorizontal: 16,
          marginBottom: 10,
          borderWidth: 1,
          borderColor: COLORS.border,
          overflow: "hidden",
        }}
      >
        <TouchableOpacity activeOpacity={0.7} onPress={handleToggle}>
          <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 26,
                backgroundColor: COLORS.primaryMuted,
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.primary }}>
                {mesaNum}
              </Text>
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: COLORS.text }}>
                  {comandaLabel}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View
                    style={{
                      backgroundColor: comandaStatusColor + "20",
                      borderRadius: 8,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: comandaStatusColor }}>
                      {comandaStatusLabel}
                    </Text>
                  </View>
                  {expanded ? (
                    <ChevronUp size={16} color={COLORS.textSecondary} />
                  ) : (
                    <ChevronDown size={16} color={COLORS.textSecondary} />
                  )}
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <User size={12} color={COLORS.textSecondary} />
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  {garcomNome}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 14,
                  marginTop: 6,
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: COLORS.divider,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Clock size={12} color={COLORS.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    {timeLabel}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Package size={12} color={COLORS.textSecondary} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    {totalItens}
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                    itens
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </TouchableOpacity>

        {expanded && (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: COLORS.divider,
              paddingHorizontal: 14,
              paddingVertical: 10,
              gap: 8,
            }}
          >
            {pedidos.length === 0 ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary, textAlign: "center", paddingVertical: 8 }}>
                Sem pedidos
              </Text>
            ) : (
              pedidos.map((pedido) => {
                const pedidoStatusColor = STATUS_COLORS[pedido.status] || "#94A3B8";
                const pedidoStatusLabel = STATUS_LABELS[pedido.status] || pedido.status;
                return (
                  <View
                    key={pedido.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 6,
                      borderBottomWidth: 1,
                      borderBottomColor: COLORS.divider,
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 6,
                        backgroundColor: COLORS.primaryMuted,
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 11, color: COLORS.primary }}>
                        {pedido.quantidade}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: "Outfit_500Medium", fontSize: 13, color: COLORS.text, flex: 1 }}>
                      {pedido.prato_nome}
                    </Text>
                    <View
                      style={{
                        backgroundColor: pedidoStatusColor + "20",
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                      }}
                    >
                      <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: pedidoStatusColor }}>
                        {pedidoStatusLabel}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

export default function CozinhaScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<"fila" | "comandas">("fila");

  // Shared comandas state (used by both Fila and Comandas tabs)
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [comandasLoading, setComandasLoading] = useState(true);
  const [comandasRefreshing, setComandasRefreshing] = useState(false);
  const [comandasError, setComandasError] = useState("");
  const [comandaFilter, setComandaFilter] = useState<ComandaFilter>("todas");

  const fetchComandas = useCallback(async () => {
    console.log("[Cozinha] Fetching comandas from /api/cozinha/comandas");
    try {
      const res = await apiGet<{ comandas: Comanda[] }>("/api/cozinha/comandas");
      const list: Comanda[] = Array.isArray(res) ? res : (res.comandas || []);
      console.log("[Cozinha] Loaded", list.length, "comandas");
      setComandas(list);
      setComandasError("");
    } catch (e: any) {
      console.error("[Cozinha] Comandas error:", e instanceof Error ? e.message : String(e));
      setComandasError("Não foi possível carregar as comandas.");
    } finally {
      setComandasLoading(false);
      setComandasRefreshing(false);
    }
  }, []);

  // Debounce ref for grouping rapid realtime events
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRealtimeEvent = useCallback(() => {
    if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current);
    realtimeDebounceRef.current = setTimeout(() => {
      console.log("[Cozinha] Realtime event — refreshing comandas");
      fetchComandas();
    }, 300);
  }, [fetchComandas]);

  const realtimeStatus = useRealtime({
    onEvent: handleRealtimeEvent,
  });

  // Initial fetch
  useEffect(() => {
    fetchComandas();
  }, [fetchComandas]);

  // Fallback polling — only when realtime is disconnected
  useEffect(() => {
    if (realtimeStatus === "connected") return;
    const interval = setInterval(() => {
      console.log("[Cozinha] Fallback poll (30s) — realtime disconnected");
      fetchComandas();
    }, 30000);
    return () => clearInterval(interval);
  }, [realtimeStatus, fetchComandas]);

  // Refetch when reconnecting (events may have been missed)
  const prevStatusRef = useRef<RealtimeStatus>(realtimeStatus);
  useEffect(() => {
    if (prevStatusRef.current !== "connected" && realtimeStatus === "connected") {
      console.log("[Cozinha] Realtime reconnected — refetching");
      fetchComandas();
    }
    prevStatusRef.current = realtimeStatus;
  }, [realtimeStatus, fetchComandas]);

  const handleRefresh = () => {
    console.log("[Cozinha] Manual refresh - tab:", activeTab);
    setComandasRefreshing(true);
    fetchComandas();
  };

  const handleAction = async (id: string, status: string) => {
    console.log("[Cozinha] PUT /api/pedidos/" + id + "/status ->", status);
    try {
      await apiPut(`/api/pedidos/${id}/status`, { status });
      console.log("[Cozinha] Status updated, refreshing comandas");
      await fetchComandas();
    } catch (e) {
      console.error("[Cozinha] Status update error:", e);
    }
  };

  const handleTabPress = (tab: "fila" | "comandas") => {
    console.log("[Cozinha] Tab switched to:", tab);
    setActiveTab(tab);
  };

  const handleFilterPress = (filter: ComandaFilter) => {
    console.log("[Cozinha] Comanda filter changed to:", filter);
    setComandaFilter(filter);
  };

  // Fila: comandas with at least one pendente or em_preparo pedido
  const filaComandas = comandas.filter((c) =>
    (Array.isArray(c.pedidos) ? c.pedidos : []).some(
      (p) => p.status === "pendente" || p.status === "em_preparo"
    )
  );

  const filteredComandas = comandas.filter((c) => {
    const targetStatus = COMANDA_FILTER_STATUS[comandaFilter];
    if (targetStatus === null) return true;
    return c.status === targetStatus;
  });

  // Header subtitle counts across all active comandas
  const allActivePedidos = comandas.flatMap((c) =>
    (Array.isArray(c.pedidos) ? c.pedidos : []).filter((p) =>
      p.status === "pendente" || p.status === "em_preparo"
    )
  );
  const pendingCount = allActivePedidos.filter((p) => p.status === "pendente").length;
  const inProgressCount = allActivePedidos.filter((p) => p.status === "em_preparo").length;

  const pendingCountStr = String(pendingCount);
  const inProgressCountStr = String(inProgressCount);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 14,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Flame size={22} color={COLORS.primary} />
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
                Cozinha
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.textSecondary }}>
                {pendingCountStr} pendentes · {inProgressCountStr} em preparo
              </Text>
              {realtimeStatus === "connected" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#22C55E" }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: "#22C55E" }}>Tempo real</Text>
                </View>
              ) : realtimeStatus === "connecting" ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#F59E0B" }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: "#F59E0B" }}>Reconectando…</Text>
                </View>
              ) : (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.textSecondary }} />
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>Reconectando…</Text>
                </View>
              )}
            </View>
          </View>
          <AnimatedPressable
            onPress={handleRefresh}
            accessibilityLabel="Atualizar"
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              backgroundColor: COLORS.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RefreshCw size={18} color={COLORS.textSecondary} />
          </AnimatedPressable>
        </View>

        {/* Toggle */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            padding: 3,
          }}
        >
          <AnimatedPressable
            onPress={() => handleTabPress("fila")}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: activeTab === "fila" ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 14,
                color: activeTab === "fila" ? "#fff" : COLORS.textSecondary,
              }}
            >
              Fila
            </Text>
          </AnimatedPressable>
          <AnimatedPressable
            onPress={() => handleTabPress("comandas")}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: activeTab === "comandas" ? COLORS.primary : "transparent",
            }}
          >
            <Text
              style={{
                fontFamily: "Outfit_600SemiBold",
                fontSize: 14,
                color: activeTab === "comandas" ? "#fff" : COLORS.textSecondary,
              }}
            >
              Comandas
            </Text>
          </AnimatedPressable>
        </View>

        {/* Comanda status filter pills */}
        {activeTab === "comandas" && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 0 }}
          >
            {COMANDA_FILTERS.map((f) => {
              const isActive = comandaFilter === f.key;
              return (
                <AnimatedPressable
                  key={f.key}
                  onPress={() => handleFilterPress(f.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 6,
                    borderRadius: 20,
                    backgroundColor: isActive ? COLORS.primary : COLORS.surfaceSecondary,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Outfit_600SemiBold",
                      fontSize: 13,
                      color: isActive ? "#fff" : COLORS.textSecondary,
                    }}
                  >
                    {f.label}
                  </Text>
                </AnimatedPressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* Fila view */}
      {activeTab === "fila" && (
        <>
          {comandasLoading ? (
            <View style={{ paddingTop: 16 }}>
              {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
            </View>
          ) : comandasError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Erro ao carregar fila
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                {comandasError}
              </Text>
              <AnimatedPressable
                onPress={fetchComandas}
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                  Tentar novamente
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <FlatList
              data={filaComandas}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
              contentInsetAdjustmentBehavior="automatic"
              refreshControl={
                <RefreshControl refreshing={comandasRefreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
              }
              renderItem={({ item, index }) => (
                <KitchenTicketCard item={item} index={index} onAction={handleAction} />
              )}
              ListEmptyComponent={
                <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChefHat size={32} color={COLORS.primary} />
                  </View>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                    Fila vazia
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Nenhum item aguardando preparo
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}

      {/* Comandas view */}
      {activeTab === "comandas" && (
        <>
          {comandasLoading ? (
            <View style={{ paddingTop: 16 }}>
              {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
            </View>
          ) : comandasError ? (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                Erro ao carregar comandas
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                {comandasError}
              </Text>
              <AnimatedPressable
                onPress={fetchComandas}
                style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
              >
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                  Tentar novamente
                </Text>
              </AnimatedPressable>
            </View>
          ) : (
            <FlatList
              data={filteredComandas}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
              contentInsetAdjustmentBehavior="automatic"
              refreshControl={
                <RefreshControl refreshing={comandasRefreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
              }
              renderItem={({ item, index }) => (
                <ComandaCard item={item} index={index} />
              )}
              ListEmptyComponent={
                <View style={{ alignItems: "center", justifyContent: "center", padding: 48, gap: 12 }}>
                  <View
                    style={{
                      width: 72,
                      height: 72,
                      borderRadius: 20,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <UtensilsCrossed size={32} color={COLORS.primary} />
                  </View>
                  <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                    Nenhuma comanda
                  </Text>
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Não há comandas no momento
                  </Text>
                </View>
              }
            />
          )}
        </>
      )}
    </View>
  );
}
