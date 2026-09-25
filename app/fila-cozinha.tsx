import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { apiGet } from "@/utils/api";
import { formatElapsed } from "@/utils/helpers";
import { useRealtime, type RealtimeStatus } from "@/hooks/useRealtime";
import { Ionicons } from "@expo/vector-icons";
import { Flame, Clock, RefreshCw, ChefHat, User } from "lucide-react-native";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";

const DEFAULT_TEMPO_PREPARO_MIN = 15;

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

const ACTIVE_STATUSES = ["pendente", "em_preparo", "pronto"];

const STATUS_COLORS: Record<string, string> = {
  pendente: "#94A3B8",
  em_preparo: "#F59E0B",
  pronto: "#22C55E",
};

const STATUS_LABELS: Record<string, string> = {
  pendente: "Pendente",
  em_preparo: "Em preparo",
  pronto: "Pronto",
};

function isAtrasado(pedido: ComandaPedido): boolean {
  const target = pedido.tempo_preparo_min ?? DEFAULT_TEMPO_PREPARO_MIN;
  const diffMin = Math.floor((Date.now() - new Date(pedido.created_at).getTime()) / 60000);
  return (pedido.status === "pendente" || pedido.status === "em_preparo") && diffMin > target;
}

type FilterKey = "todos" | "pendente" | "em_preparo" | "atrasados";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "pendente", label: "Aguardando" },
  { key: "em_preparo", label: "Em preparo" },
  { key: "atrasados", label: "Atrasados" },
];

export default function FilaCozinhaScreen() {
  const COLORS = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todos");

  const fetchComandas = useCallback(async () => {
    console.log("[FilaCozinha] Fetching comandas from /api/cozinha/comandas");
    try {
      const res = await apiGet<{ comandas: Comanda[] }>("/api/cozinha/comandas");
      const list: Comanda[] = Array.isArray(res) ? res : (res.comandas || []);
      console.log("[FilaCozinha] Comandas loaded:", list.length);
      setComandas(list);
      setError("");
    } catch (e: any) {
      console.error("[FilaCozinha] Error fetching comandas:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar a fila.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleRealtimeEvent = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchComandas(), 300);
  }, [fetchComandas]);

  const realtimeStatus = useRealtime({ onEvent: handleRealtimeEvent });

  useEffect(() => { fetchComandas(); }, [fetchComandas]);

  // Fallback polling when realtime disconnected
  useEffect(() => {
    if (realtimeStatus === "connected") return;
    const interval = setInterval(() => fetchComandas(), 30000);
    return () => clearInterval(interval);
  }, [realtimeStatus, fetchComandas]);

  // Refetch on reconnect
  const prevStatusRef = useRef<RealtimeStatus>(realtimeStatus);
  useEffect(() => {
    if (prevStatusRef.current !== "connected" && realtimeStatus === "connected") {
      fetchComandas();
    }
    prevStatusRef.current = realtimeStatus;
  }, [realtimeStatus, fetchComandas]);

  // Flatten all active pedidos for counters
  const allPedidos = comandas.flatMap((c) =>
    (Array.isArray(c.pedidos) ? c.pedidos : []).filter((p) => ACTIVE_STATUSES.includes(p.status))
  );
  const aguardandoCount = allPedidos.filter((p) => p.status === "pendente").length;
  const emPreparoCount = allPedidos.filter((p) => p.status === "em_preparo").length;
  const prontoCount = allPedidos.filter((p) => p.status === "pronto").length;
  const atrasadosCount = allPedidos.filter(isAtrasado).length;

  // Build display list: filter + sort (atrasados first, then oldest first)
  const displayComandas = comandas
    .map((c) => {
      const pedidos = (Array.isArray(c.pedidos) ? c.pedidos : []).filter((p) => {
        if (!ACTIVE_STATUSES.includes(p.status)) return false;
        if (filter === "pendente") return p.status === "pendente";
        if (filter === "em_preparo") return p.status === "em_preparo";
        if (filter === "atrasados") return isAtrasado(p);
        return true;
      });
      return { ...c, pedidos };
    })
    .filter((c) => c.pedidos.length > 0)
    .sort((a, b) => {
      // Comandas with delayed items first
      const aHasAtrasado = a.pedidos.some(isAtrasado);
      const bHasAtrasado = b.pedidos.some(isAtrasado);
      if (aHasAtrasado && !bHasAtrasado) return -1;
      if (!aHasAtrasado && bHasAtrasado) return 1;
      // Then oldest first
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

  const handleRefresh = () => {
    console.log("[FilaCozinha] Manual refresh triggered");
    setRefreshing(true);
    fetchComandas();
  };

  const handleFilterChange = (key: FilterKey) => {
    console.log("[FilaCozinha] Filter changed to:", key);
    setFilter(key);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      {/* Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 14,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        {/* Top row: back + title + refresh */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14 }}>
          <Pressable
            onPress={() => {
              console.log("[FilaCozinha] Back button pressed");
              router.back();
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, marginRight: 8 })}
          >
            <Ionicons name="chevron-back" size={24} color={COLORS.primary} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Flame size={20} color={COLORS.primary} />
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text, letterSpacing: -0.3 }}>
                Fila da Cozinha
              </Text>
            </View>
            {/* Realtime indicator */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor:
                    realtimeStatus === "connected" ? "#22C55E" :
                    realtimeStatus === "connecting" ? "#F59E0B" : COLORS.textSecondary,
                }}
              />
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                {realtimeStatus === "connected" ? "Tempo real" :
                 realtimeStatus === "connecting" ? "Reconectando…" : "Desconectado"}
              </Text>
            </View>
          </View>
          <AnimatedPressable
            onPress={() => {
              console.log("[FilaCozinha] Refresh button pressed");
              handleRefresh();
            }}
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              backgroundColor: COLORS.surfaceSecondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <RefreshCw size={16} color={COLORS.textSecondary} />
          </AnimatedPressable>
        </View>

        {/* Counters */}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
          {[
            { label: "Aguardando", count: aguardandoCount, color: "#94A3B8" },
            { label: "Em preparo", count: emPreparoCount, color: "#F59E0B" },
            { label: "Prontos",    count: prontoCount,    color: "#22C55E" },
            { label: "Atrasados",  count: atrasadosCount, color: "#EF4444" },
          ].map((item) => (
            <View
              key={item.label}
              style={{
                flex: 1,
                backgroundColor: item.color + "15",
                borderRadius: 10,
                padding: 8,
                alignItems: "center",
                gap: 2,
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: item.color }}>
                {item.count}
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 9, color: item.color, textAlign: "center" }}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>

        {/* Filter pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {FILTERS.map((f) => {
            const isActive = filter === f.key;
            return (
              <AnimatedPressable
                key={f.key}
                onPress={() => handleFilterChange(f.key)}
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
      </View>

      {/* Content */}
      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2].map((i) => <CardSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar fila
          </Text>
          <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
            {error}
          </Text>
          <AnimatedPressable
            onPress={() => {
              console.log("[FilaCozinha] Retry button pressed");
              fetchComandas();
            }}
            style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
              Tentar novamente
            </Text>
          </AnimatedPressable>
        </View>
      ) : (
        <FlatList
          data={displayComandas}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
          }
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
                Nenhum pedido na cozinha agora
              </Text>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                {filter !== "todos" ? "Tente o filtro 'Todos'" : "A fila está vazia"}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const comandaCode = item.id.slice(-6).toUpperCase();
            const hasAtrasado = item.pedidos.some(isAtrasado);
            return (
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  marginHorizontal: 16,
                  marginBottom: 10,
                  borderWidth: 1.5,
                  borderColor: hasAtrasado ? "#EF444460" : COLORS.border,
                  overflow: "hidden",
                }}
              >
                {/* Urgency banner */}
                {hasAtrasado && (
                  <View style={{ backgroundColor: "#EF444415", paddingHorizontal: 16, paddingVertical: 6 }}>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: "#EF4444" }}>
                      Itens atrasados nesta mesa
                    </Text>
                  </View>
                )}

                {/* Card header */}
                <View style={{ padding: 14, flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.primary }}>
                      {item.mesa_numero}
                    </Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.text }}>
                      Mesa {item.mesa_numero}
                    </Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                      #{comandaCode}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                      <User size={11} color={COLORS.textSecondary} />
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                        {item.garcom_nome}
                      </Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                    <Clock size={11} color={COLORS.textSecondary} />
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary }}>
                      {formatElapsed(item.created_at)}
                    </Text>
                  </View>
                </View>

                {/* Pedidos list */}
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: COLORS.divider,
                    paddingHorizontal: 14,
                    paddingTop: 8,
                    paddingBottom: 4,
                    gap: 4,
                  }}
                >
                  {item.pedidos.map((pedido) => {
                    const atrasado = isAtrasado(pedido);
                    const diffMin = Math.floor((Date.now() - new Date(pedido.created_at).getTime()) / 60000);
                    const target = pedido.tempo_preparo_min ?? DEFAULT_TEMPO_PREPARO_MIN;
                    const badgeColor = atrasado ? "#EF4444" : (STATUS_COLORS[pedido.status] ?? "#94A3B8");
                    const badgeLabel = atrasado
                      ? `Atrasado · ${diffMin}/${target} min`
                      : pedido.status === "em_preparo"
                      ? `Em preparo · ${diffMin}/${target} min`
                      : (STATUS_LABELS[pedido.status] ?? pedido.status);

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
                          opacity: pedido.status === "pronto" ? 0.5 : 1,
                        }}
                      >
                        {/* Qty */}
                        <View
                          style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            backgroundColor: COLORS.primaryMuted,
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 10, color: COLORS.primary }}>
                            {pedido.quantidade}
                          </Text>
                        </View>

                        {/* Name + obs */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: atrasado ? "#EF4444" : COLORS.text }}>
                            {pedido.prato_nome}
                          </Text>
                          {pedido.observacao ? (
                            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.textSecondary, fontStyle: "italic" }}>
                              {pedido.observacao}
                            </Text>
                          ) : null}
                        </View>

                        {/* Status badge */}
                        <View
                          style={{
                            backgroundColor: badgeColor + "20",
                            borderRadius: 6,
                            paddingHorizontal: 7,
                            paddingVertical: 3,
                            maxWidth: 150,
                            flexShrink: 1,
                          }}
                        >
                          <Text
                            style={{ fontFamily: "Outfit_600SemiBold", fontSize: 10, color: badgeColor }}
                            numberOfLines={1}
                          >
                            {badgeLabel}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
