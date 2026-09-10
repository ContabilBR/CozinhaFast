import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPut } from "@/utils/api";
import { formatCurrency, formatRelativeTime } from "@/utils/helpers";

const STATUS_FLOW = ["pendente", "preparando", "saiu_entrega", "entregue"];
const STATUS_LABELS: Record<string, string> = { pendente: "Pendente", preparando: "Preparando", saiu_entrega: "Saiu para entrega", entregue: "Entregue", cancelada: "Cancelada" };
const STATUS_ICONS: Record<string, string> = { pendente: "time-outline", preparando: "flame-outline", saiu_entrega: "bicycle-outline", entregue: "checkmark-circle-outline", cancelada: "close-circle-outline" };
const STATUS_COLORS: Record<string, string> = { pendente: "#EF4444", preparando: "#F59E0B", saiu_entrega: "#3B82F6", entregue: "#22C55E", cancelada: "#6B7280" };

export default function DeliveryDetalhes() {
  const COLORS = useColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetch = useCallback(async () => {
    console.log("[DeliveryDetalhes] Fetching delivery order:", id);
    try {
      const res = await apiGet("/api/delivery/pedidos/" + id);
      console.log("[DeliveryDetalhes] Fetched delivery order:", res);
      setData(res);
    } catch (err) { console.error("[DeliveryDetalhes] Error fetching delivery order:", err); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetch(); }, [fetch]);

  const avancarStatus = async () => {
    if (!data) return;
    const current = data.entrega.status;
    const idx = STATUS_FLOW.indexOf(current);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    console.log("[DeliveryDetalhes] Advancing status from", current, "to", next, "for order:", id);
    setUpdating(true);
    try {
      await apiPut("/api/delivery/pedidos/" + id + "/status", { status: next });
      console.log("[DeliveryDetalhes] Status updated to:", next);
      await fetch();
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error updating status:", err);
      Alert.alert("Erro", err?.message || "Erro ao atualizar");
    }
    finally { setUpdating(false); }
  };

  const cancelar = () => {
    console.log("[DeliveryDetalhes] Cancel button pressed for order:", id);
    Alert.alert("Cancelar pedido", "Tem certeza?", [
      { text: "Não", style: "cancel" },
      { text: "Sim, cancelar", style: "destructive", onPress: async () => {
        console.log("[DeliveryDetalhes] Confirming cancellation for order:", id);
        setUpdating(true);
        try {
          await apiPut("/api/delivery/pedidos/" + id + "/status", { status: "cancelada" });
          console.log("[DeliveryDetalhes] Order cancelled successfully:", id);
          await fetch();
        }
        catch (err: any) {
          console.error("[DeliveryDetalhes] Error cancelling order:", err);
          Alert.alert("Erro", err?.message || "Erro");
        }
        finally { setUpdating(false); }
      }},
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><Text style={{ color: COLORS.textSecondary }}>Pedido não encontrado</Text></View>;

  const e = data.entrega;
  const currentIdx = STATUS_FLOW.indexOf(e.status);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null;
  const total = parseFloat(data.comanda?.total || "0");

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => { console.log("[DeliveryDetalhes] Back button pressed"); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Pedido #{(e.id || "").slice(0, 6)}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {/* Timeline */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Status da entrega</Text>
          {STATUS_FLOW.map((s, i) => {
            const done = i <= currentIdx;
            const active = i === currentIdx;
            const color = done ? STATUS_COLORS[s] : "#D1D5DB";
            return (
              <View key={s} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, marginBottom: i < STATUS_FLOW.length - 1 ? 4 : 0 }}>
                <View style={{ alignItems: "center" }}>
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color, justifyContent: "center", alignItems: "center" }}>
                    <Ionicons name={done ? "checkmark" : (STATUS_ICONS[s] as any)} size={14} color="white" />
                  </View>
                  {i < STATUS_FLOW.length - 1 && <View style={{ width: 2, height: 22, backgroundColor: i < currentIdx ? STATUS_COLORS[STATUS_FLOW[i + 1]] : "#D1D5DB" }} />}
                </View>
                <View style={{ paddingTop: 3 }}>
                  <Text style={{ fontSize: 14, fontWeight: active ? "600" : "400", color: active ? STATUS_COLORS[s] : done ? COLORS.text : COLORS.textTertiary }}>{STATUS_LABELS[s]}</Text>
                  {s === "saiu_entrega" && e.entregador_nome && <Text style={{ fontSize: 12, color: COLORS.textSecondary }}>{e.entregador_nome} {e.entregador_telefone || ""}</Text>}
                </View>
              </View>
            );
          })}
        </View>

        {/* Cliente */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Cliente</Text>
          <Text style={{ fontSize: 15, fontWeight: "500", color: COLORS.text }}>{e.cliente_nome}</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4 }}><Ionicons name="call-outline" size={13} /> {e.cliente_telefone}</Text>
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4 }}><Ionicons name="location-outline" size={13} /> {e.endereco}{e.bairro ? " - " + e.bairro : ""}</Text>
          {e.complemento && <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>{e.complemento}</Text>}
          {e.referencia && <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>Ref: {e.referencia}</Text>}
        </View>

        {/* Itens */}
        <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Itens</Text>
          {(data.itens || []).map((item: any, i: number) => (
            <View key={item.id || i} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: i < (data.itens || []).length - 1 ? 0.5 : 0, borderBottomColor: COLORS.surfaceSecondary }}>
              <Text style={{ fontSize: 14, color: COLORS.text }}>{item.quantidade}x item</Text>
              <Text style={{ fontSize: 14, fontWeight: "500", color: COLORS.text }}>{formatCurrency(parseFloat(item.precoUnitario || item.preco_unitario || "0") * (item.quantidade || 1))}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}>
            <Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Taxa entrega</Text>
            <Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(parseFloat(e.taxa_entrega || e.taxaEntrega || "0"))}</Text>
          </View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 6 }}>
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>Total</Text>
            <Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text>
          </View>
        </View>

        {/* Ações */}
        {e.status !== "entregue" && e.status !== "cancelada" && (
          <View style={{ gap: 10 }}>
            {nextStatus && (
              <Pressable onPress={avancarStatus} disabled={updating} style={{ backgroundColor: updating ? COLORS.textTertiary : STATUS_COLORS[nextStatus], borderRadius: 12, padding: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}>
                {updating ? <ActivityIndicator color="white" /> : <><Ionicons name={STATUS_ICONS[nextStatus] as any} size={20} color="white" /><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>{STATUS_LABELS[nextStatus]}</Text></>}
              </Pressable>
            )}
            <Pressable onPress={cancelar} style={{ borderWidth: 1, borderColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" }}>
              <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>Cancelar pedido</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
