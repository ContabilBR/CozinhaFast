import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { SkeletonLine } from "@/components/SkeletonLoader";
import { apiGet } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";

interface ReportSummary {
  total_revenue?: number;
  total_orders?: number;
  open_orders?: number;
  avg_ticket?: number;
  top_dishes?: { dish_name: string; quantity_sold: number }[];
  orders_by_status?: { aberta?: number; fechada?: number; cancelada?: number };
}

export default function RelatoriosScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [summary, setSummary] = useState<ReportSummary>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    console.log("[Relatorios] Fetching reports summary from /api/relatorios/resumo");
    try {
      const res = await apiGet<any>("/api/relatorios/resumo");
      const data: ReportSummary = res || {};
      console.log("[Relatorios] Loaded summary:", JSON.stringify(data).slice(0, 200));
      setSummary(data);
      setError("");
    } catch (e: any) {
      console.error("[Relatorios] Error:", e instanceof Error ? e.message : String(e));
      setError("Não foi possível carregar os relatórios.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRefresh = () => {
    console.log("[Relatorios] Manual refresh");
    setRefreshing(true);
    fetchData();
  };

  const totalRevenue = formatCurrency(summary.total_revenue ?? 0);
  const avgTicket = formatCurrency(summary.avg_ticket ?? 0);
  const topDishes = summary.top_dishes || [];
  const maxDish = Math.max(...topDishes.map((d) => d.quantity_sold), 1);
  const ordersByStatus = summary.orders_by_status || {};

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: COLORS.surface }}>
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          height: 56,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}>
          <View style={{ width: 80 }}>
            <TouchableOpacity
              onPress={() => {
                console.log("[Relatorios] Voltar pressed");
                router.replace('/(tabs)/(home)' as any);
              }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
              activeOpacity={0.7}
            >
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
              <Text style={{ fontSize: 16, color: '#007AFF', fontWeight: '500' }}>Voltar</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Outfit_700Bold', fontSize: 17, color: COLORS.text }}>Relatórios</Text>
          </View>
          <View style={{ width: 80 }} />
        </View>
      </SafeAreaView>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 20 }}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />
        }
      >
        {error ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
              Erro ao carregar relatórios
            </Text>
            <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
              {error}
            </Text>
            <AnimatedPressable
              onPress={fetchData}
              style={{ backgroundColor: COLORS.primary, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
            >
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
                Tentar novamente
              </Text>
            </AnimatedPressable>
          </View>
        ) : (
          <>
            {/* Summary stats */}
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Faturamento Total", value: totalRevenue, color: COLORS.success },
                { label: "Total de Pedidos", value: String(summary.total_orders ?? 0), color: COLORS.primary },
                { label: "Pedidos Abertos", value: String(summary.open_orders ?? 0), color: COLORS.warning },
                { label: "Ticket Médio", value: avgTicket, color: "#3B82F6" },
              ].map((stat) => (
                <View
                  key={stat.label}
                  style={{
                    flex: 1,
                    minWidth: "45%",
                    backgroundColor: COLORS.surface,
                    borderRadius: 14,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    gap: 6,
                  }}
                >
                  {loading ? (
                    <>
                      <SkeletonLine width="80%" height={18} />
                      <SkeletonLine width="60%" height={12} />
                    </>
                  ) : (
                    <>
                      <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: stat.color }}>
                        {stat.value}
                      </Text>
                      <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                        {stat.label}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </View>

            {/* Orders by status */}
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                Pedidos por Status
              </Text>
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  gap: 12,
                }}
              >
                {loading ? (
                  [0, 1, 2].map((i) => <SkeletonLine key={i} width="100%" height={20} />)
                ) : (
                  [
                    { key: "aberta", label: "Abertas", color: "#22C55E" },
                    { key: "fechada", label: "Fechadas", color: "#94A3B8" },
                    { key: "cancelada", label: "Canceladas", color: "#EF4444" },
                  ].map((s) => {
                    const count = (ordersByStatus as any)[s.key] ?? 0;
                    return (
                      <View key={s.key} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: s.color }} />
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                            {s.label}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: s.color }}>
                          {count}
                        </Text>
                      </View>
                    );
                  })
                )}
              </View>
            </View>

            {/* Top dishes */}
            <View>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 18, color: COLORS.text, marginBottom: 12 }}>
                Pratos Mais Pedidos
              </Text>
              <View
                style={{
                  backgroundColor: COLORS.surface,
                  borderRadius: 16,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: COLORS.border,
                  gap: 14,
                }}
              >
                {loading ? (
                  [0, 1, 2, 3].map((i) => (
                    <View key={i} style={{ gap: 6 }}>
                      <SkeletonLine width="50%" height={13} />
                      <SkeletonLine width="100%" height={10} borderRadius={5} />
                    </View>
                  ))
                ) : topDishes.length === 0 ? (
                  <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 14, color: COLORS.textSecondary, textAlign: "center" }}>
                    Sem dados disponíveis
                  </Text>
                ) : (
                  topDishes.map((dish, i) => {
                    const barW = Math.max(2, Math.round((dish.quantity_sold / maxDish) * 100));
                    return (
                      <View key={dish.dish_name + i} style={{ gap: 6 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.text, flex: 1 }}>
                            {dish.dish_name}
                          </Text>
                          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: COLORS.primary, marginLeft: 8 }}>
                            {dish.quantity_sold}x
                          </Text>
                        </View>
                        <View style={{ height: 8, backgroundColor: COLORS.surfaceSecondary, borderRadius: 4 }}>
                          <View
                            style={{
                              height: 8,
                              width: `${barW}%` as `${number}%`,
                              backgroundColor: COLORS.primary,
                              borderRadius: 4,
                            }}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
