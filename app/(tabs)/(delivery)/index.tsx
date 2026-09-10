import React, { useState, useCallback, useRef, useEffect } from "react";
import { View, Text, FlatList, RefreshControl, Animated, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";

interface Entrega {
  entrega: { id: string; cliente_nome: string; cliente_telefone: string; endereco: string; bairro?: string; status: string; taxa_entrega: string; created_at: string };
  comanda: { id: string; total: string; subtotal: string };
  itens: any[];
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pendente: { label: "Pendente", bg: "#FEE2E2", text: "#991B1B" },
  preparando: { label: "Preparando", bg: "#FEF3C7", text: "#92400E" },
  saiu_entrega: { label: "Saiu entrega", bg: "#DBEAFE", text: "#1E40AF" },
  entregue: { label: "Entregue", bg: "#D1FAE5", text: "#065F46" },
  cancelada: { label: "Cancelada", bg: "#F3F4F6", text: "#6B7280" },
};

function DeliveryCard({ item, onPress, index }: { item: Entrega; onPress: () => void; index: number }) {
  const COLORS = useColors();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 350, delay: index * 60, useNativeDriver: true }),
    ]).start();
  }, [index, opacity, translateY]);

  const e = item.entrega;
  const statusCfg = STATUS_CONFIG[e.status] || STATUS_CONFIG.pendente;
  const total = parseFloat(item.comanda?.total || "0");

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      <AnimatedPressable onPress={onPress} style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, marginRight: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.text }}>{e.cliente_nome}</Text>
            <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 3 }} numberOfLines={1}>
              <Ionicons name="location-outline" size={12} /> {e.endereco}{e.bairro ? " - " + e.bairro : ""}
            </Text>
          </View>
          <View style={{ backgroundColor: statusCfg.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: "600", color: statusCfg.text }}>{statusCfg.label}</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 10, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>{item.itens?.length || 0} {(item.itens?.length || 0) === 1 ? "item" : "itens"} • {formatRelativeTime(e.created_at)}</Text>
          <Text style={{ fontSize: 15, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function DeliveryScreen() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pedidos, setPedidos] = useState<Entrega[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtro, setFiltro] = useState<string | null>(null);

  const fetchPedidos = useCallback(async () => {
    try {
      const path = filtro ? "/api/delivery/pedidos?status=" + filtro : "/api/delivery/pedidos";
      console.log("[Delivery] Fetching pedidos:", path);
      const data = await apiGet<{ pedidos: Entrega[] }>(path);
      console.log("[Delivery] Pedidos received:", data.pedidos?.length ?? 0);
      setPedidos(data.pedidos || []);
    } catch (err) {
      console.error("Erro ao buscar delivery:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filtro]);

  useFocusEffect(useCallback(() => { setLoading(true); fetchPedidos(); }, [fetchPedidos]));

  const filtros = [
    { key: null, label: "Todos" },
    { key: "pendente", label: "Pendente" },
    { key: "preparando", label: "Preparando" },
    { key: "saiu_entrega", label: "Saiu" },
    { key: "entregue", label: "Entregue" },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View>
            <Text style={{ fontSize: 22, fontWeight: "700", color: COLORS.text }}>Delivery</Text>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{pedidos.length} pedido{pedidos.length !== 1 ? "s" : ""}</Text>
          </View>
          <Pressable onPress={() => { console.log("[Delivery] Novo pedido button pressed"); router.push("/delivery/novo"); }} style={{ backgroundColor: COLORS.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="add" size={18} color="white" />
            <Text style={{ color: "white", fontSize: 14, fontWeight: "600" }}>Novo</Text>
          </Pressable>
        </View>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={filtros}
          keyExtractor={(item) => item.key || "todos"}
          style={{ marginTop: 12 }}
          renderItem={({ item: f }) => (
            <Pressable onPress={() => { console.log("[Delivery] Filter selected:", f.key ?? "todos"); setFiltro(f.key); }} style={{ backgroundColor: filtro === f.key ? COLORS.primary : COLORS.primaryMuted, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginRight: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: "500", color: filtro === f.key ? "white" : COLORS.primary }}>{f.label}</Text>
            </Pressable>
          )}
        />
      </View>
      {loading ? (
        <View style={{ padding: 16 }}><CardSkeleton /><CardSkeleton /><CardSkeleton /></View>
      ) : (
        <FlatList
          data={pedidos}
          keyExtractor={(item) => item.entrega.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { console.log("[Delivery] Pull-to-refresh triggered"); setRefreshing(true); fetchPedidos(); }} tintColor={COLORS.primary} />}
          renderItem={({ item, index }) => (<DeliveryCard item={item} index={index} onPress={() => { console.log("[Delivery] Card pressed, id:", item.entrega.id); router.push("/delivery/" + item.entrega.id); }} />)}
          ListEmptyComponent={<View style={{ alignItems: "center", paddingTop: 60 }}><Ionicons name="bicycle-outline" size={48} color={COLORS.textTertiary} /><Text style={{ fontSize: 16, color: COLORS.textSecondary, marginTop: 12 }}>Nenhum pedido delivery</Text><Text style={{ fontSize: 13, color: COLORS.textTertiary, marginTop: 4 }}>Toque em "Novo" para criar</Text></View>}
        />
      )}
    </View>
  );
}
