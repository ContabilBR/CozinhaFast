import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ScrollView, Pressable, Alert, ActivityIndicator, TextInput } from "react-native";
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
  const [showDespacharForm, setShowDespacharForm] = useState(false);
  const [entregadorNome, setEntregadorNome] = useState("");
  const [entregadorTelefone, setEntregadorTelefone] = useState("");

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

  const despachar = async () => {
    if (!entregadorNome.trim()) return;
    console.log("[DeliveryDetalhes] Despachar pressed for order:", id, "entregador:", entregadorNome.trim());
    setUpdating(true);
    try {
      await apiPut("/api/delivery/pedidos/" + id + "/status", {
        status: "saiu_entrega",
        entregador_nome: entregadorNome.trim(),
        entregador_telefone: entregadorTelefone.trim() || undefined,
      });
      console.log("[DeliveryDetalhes] Despacho confirmed for order:", id);
      setShowDespacharForm(false);
      setEntregadorNome("");
      setEntregadorTelefone("");
      await fetch();
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error dispatching order:", err);
      const msg = err?.body?.error || err?.message || "Erro ao despachar";
      Alert.alert("Erro", msg);
    } finally {
      setUpdating(false);
    }
  };

  const confirmarEntrega = async () => {
    console.log("[DeliveryDetalhes] Confirmar entrega pressed for order:", id);
    setUpdating(true);
    try {
      await apiPut("/api/delivery/pedidos/" + id + "/status", { status: "entregue" });
      console.log("[DeliveryDetalhes] Entrega confirmed for order:", id);
      await fetch();
    } catch (err: any) {
      console.error("[DeliveryDetalhes] Error confirming delivery:", err);
      const msg = err?.body?.error || err?.message || "Erro ao confirmar entrega";
      Alert.alert("Erro", msg);
    } finally {
      setUpdating(false);
    }
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
          const msg = err?.body?.error || err?.message || "Erro ao cancelar";
          Alert.alert("Erro", msg);
        }
        finally { setUpdating(false); }
      }},
    ]);
  };

  if (loading) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  if (!data) return <View style={{ flex: 1, backgroundColor: COLORS.background, justifyContent: "center", alignItems: "center" }}><Text style={{ color: COLORS.textSecondary }}>Pedido não encontrado</Text></View>;

  const e = data.entrega;
  const currentIdx = STATUS_FLOW.indexOf(e.status);
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
          {(data.itens || []).map((item: any, i: number) => {
            const itemStatus = item.status || "pendente";
            const statusColor: Record<string, string> = {
              pendente: "#94A3B8",
              em_preparo: "#F59E0B",
              pronto: "#22C55E",
              cancelado: "#EF4444",
              entregue: "#0D9488",
            };
            const statusLabel: Record<string, string> = {
              pendente: "Pendente",
              em_preparo: "Em preparo",
              pronto: "Pronto",
              cancelado: "Cancelado",
              entregue: "Entregue",
            };
            const isCancelado = itemStatus === "cancelado";
            const itemColor = statusColor[itemStatus] || "#94A3B8";
            const itemLabel = statusLabel[itemStatus] || itemStatus;
            const itemsLength = (data.itens || []).length;
            const precoUnitario = parseFloat(item.preco_unitario || item.precoUnitario || "0");
            const itemTotal = precoUnitario * (item.quantidade || 1);
            return (
              <View key={item.id || i} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: i < itemsLength - 1 ? 0.5 : 0, borderBottomColor: COLORS.surfaceSecondary }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, color: isCancelado ? COLORS.textTertiary : COLORS.text, textDecorationLine: isCancelado ? "line-through" : "none" }}>
                    {item.quantidade}x {item.prato_nome || "Item"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: itemColor, marginRight: 4 }} />
                    <Text style={{ fontSize: 11, color: itemColor }}>{itemLabel}</Text>
                  </View>
                </View>
                <Text style={{ fontSize: 14, fontWeight: "500", color: isCancelado ? COLORS.textTertiary : COLORS.text }}>
                  {formatCurrency(itemTotal)}
                </Text>
              </View>
            );
          })}
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
            {/* Botão principal contextual */}
            {(() => {
              const itensAtivos = (data.itens || []).filter((i: any) => i.status !== "cancelado");
              const itensProntos = itensAtivos.filter((i: any) => i.status === "pronto");
              const prontoParaDespachar = itensAtivos.length > 0 && itensProntos.length === itensAtivos.length;
              const aguardandoCozinha = !prontoParaDespachar && e.status !== "saiu_entrega";

              if (e.status === "saiu_entrega") {
                return (
                  <Pressable
                    onPress={() => { console.log("[DeliveryDetalhes] Confirmar entrega pressed"); confirmarEntrega(); }}
                    disabled={updating}
                    style={{ backgroundColor: updating ? COLORS.textTertiary : "#22C55E", borderRadius: 12, padding: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    {updating ? <ActivityIndicator color="white" /> : (
                      <><Ionicons name="checkmark-circle-outline" size={20} color="white" /><Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Confirmar entrega</Text></>
                    )}
                  </Pressable>
                );
              }

              if (prontoParaDespachar) {
                return (
                  <Pressable
                    onPress={() => { console.log("[DeliveryDetalhes] Despachar button pressed"); setShowDespacharForm(true); }}
                    disabled={updating}
                    style={{ backgroundColor: "#3B82F6", borderRadius: 12, padding: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
                  >
                    <Ionicons name="bicycle-outline" size={20} color="white" />
                    <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Despachar</Text>
                  </Pressable>
                );
              }

              if (aguardandoCozinha) {
                return (
                  <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 16, alignItems: "center", borderWidth: 1, borderColor: COLORS.border }}>
                    <Text style={{ color: COLORS.textSecondary, fontSize: 14 }}>
                      Aguardando cozinha ({itensProntos.length} de {itensAtivos.length} itens prontos)
                    </Text>
                  </View>
                );
              }

              return null;
            })()}

            {/* Formulário de despacho */}
            {showDespacharForm && (
              <View style={{ backgroundColor: COLORS.surface, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, gap: 10 }}>
                <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text }}>Quem vai entregar?</Text>
                <TextInput
                  value={entregadorNome}
                  onChangeText={setEntregadorNome}
                  placeholder="Nome do entregador *"
                  placeholderTextColor={COLORS.textTertiary}
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                />
                <TextInput
                  value={entregadorTelefone}
                  onChangeText={setEntregadorTelefone}
                  placeholder="Telefone (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="phone-pad"
                  style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Pressable onPress={() => { console.log("[DeliveryDetalhes] Despachar form cancelled"); setShowDespacharForm(false); }} style={{ flex: 1, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, alignItems: "center" }}>
                    <Text style={{ color: COLORS.text }}>Cancelar</Text>
                  </Pressable>
                  <Pressable
                    onPress={despachar}
                    disabled={updating || !entregadorNome.trim()}
                    style={{ flex: 2, backgroundColor: updating || !entregadorNome.trim() ? COLORS.textTertiary : "#3B82F6", borderRadius: 8, padding: 12, alignItems: "center" }}
                  >
                    {updating ? <ActivityIndicator color="white" size="small" /> : <Text style={{ color: "white", fontWeight: "600" }}>Confirmar despacho</Text>}
                  </Pressable>
                </View>
              </View>
            )}

            {/* Cancelar */}
            <Pressable onPress={cancelar} style={{ borderWidth: 1, borderColor: "#EF4444", borderRadius: 12, padding: 14, alignItems: "center" }}>
              <Text style={{ color: "#EF4444", fontSize: 14, fontWeight: "500" }}>Cancelar pedido</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
