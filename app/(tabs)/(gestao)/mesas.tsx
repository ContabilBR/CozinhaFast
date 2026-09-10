import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Modal,
  TextInput,
  TouchableOpacity,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { CardSkeleton } from "@/components/SkeletonLoader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { apiGet, apiPost, apiPut, apiDelete } from "@/utils/api";
import { getMesaStatusLabel, getMesaStatusColor } from "@/utils/helpers";
import { X, LayoutGrid, Users, Search } from "lucide-react-native";

interface ApiMesa {
  id: string;
  numero: number;
  capacidade: number;
  status: string;
}

const STATUS_OPTIONS = [
  { value: "disponivel", label: "Disponível" },
  { value: "ocupada", label: "Ocupada" },
  { value: "reservada", label: "Reservada" },
];

export default function GestaoMesasScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [mesas, setMesas] = useState<ApiMesa[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingMesa, setEditingMesa] = useState<ApiMesa | null>(null);
  const [numero, setNumero] = useState("");
  const [capacidade, setCapacidade] = useState("4");
  const [status, setStatus] = useState("livre");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const [confirmDialog, setConfirmDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
  }>({ visible: false, title: "", message: "", confirmLabel: "Excluir", onConfirm: () => {} });

  const closeConfirm = () => setConfirmDialog((prev) => ({ ...prev, visible: false }));

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/(gestao)" as any);
    }
  };

  const fetchMesas = useCallback(async () => {
    console.log("[GestaoMesas] GET /api/mesas");
    try {
      const res = await apiGet<any>("/api/mesas");
      const list: ApiMesa[] = Array.isArray(res) ? res : (res.mesas || []);
      console.log("[GestaoMesas] Carregadas", list.length, "mesas");
      setMesas(list);
      setError("");
    } catch (e: unknown) {
      console.error("[GestaoMesas] Erro:", e);
      setError("Não foi possível carregar as mesas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("[GestaoMesas] Tela focada — recarregando mesas");
      setLoading(true);
      fetchMesas();
    }, [fetchMesas])
  );

  const openCreate = () => {
    console.log("[GestaoMesas] Abrir modal de criação");
    setEditingMesa(null);
    setNumero("");
    setCapacidade("4");
    setStatus("disponivel");
    setModalError("");
    setShowModal(true);
  };

  const openEdit = (m: ApiMesa) => {
    console.log("[GestaoMesas] Abrir modal de edição:", m.id);
    setEditingMesa(m);
    setNumero(String(m.numero));
    setCapacidade(String(m.capacidade));
    setStatus(m.status || "livre");
    setModalError("");
    setShowModal(true);
  };

  const handleSave = async () => {
    const numVal = parseInt(numero, 10);
    const capVal = parseInt(capacidade, 10);
    if (!numero || isNaN(numVal) || numVal <= 0) { setModalError("Número da mesa inválido."); return; }
    if (!capacidade || isNaN(capVal) || capVal <= 0) { setModalError("Capacidade inválida."); return; }
    console.log("[GestaoMesas] Salvar pressionado, editando:", editingMesa?.id ?? "novo");
    setSaving(true);
    setModalError("");
    try {
      if (editingMesa) {
        console.log("[GestaoMesas] PUT /api/mesas/" + editingMesa.id);
        await apiPut(`/api/mesas/${editingMesa.id}`, { numero: numVal, capacidade: capVal, status });
        console.log("[GestaoMesas] Mesa atualizada:", editingMesa.id);
      } else {
        console.log("[GestaoMesas] POST /api/mesas", { numero: numVal, capacidade: capVal, status });
        await apiPost("/api/mesas", { numero: numVal, capacidade: capVal, status });
        console.log("[GestaoMesas] Mesa criada");
      }
      setShowModal(false);
      await fetchMesas();
    } catch (e: unknown) {
      console.error("[GestaoMesas] Erro ao salvar:", e);
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar a mesa.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (id: string, numeroMesa: number) => {
    const nomeMesa = `Mesa ${numeroMesa}`;
    console.log("[GestaoMesas] Confirmar exclusão:", id, nomeMesa);
    setConfirmDialog({
      visible: true,
      title: "Excluir mesa?",
      message: `Deseja realmente excluir "${nomeMesa}"?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        closeConfirm();
        console.log("[GestaoMesas] DELETE /api/mesas/" + id);
        try {
          await apiDelete(`/api/mesas/${id}`);
          console.log("[GestaoMesas] Mesa excluída:", id);
          setMesas((prev) => prev.filter((m) => m.id !== id));
        } catch (e: unknown) {
          console.error("[GestaoMesas] Erro ao excluir:", e);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    console.log("[GestaoMesas] Toggle seleção:", id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log("[GestaoMesas] Entrar modo seleção, item:", id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log("[GestaoMesas] Sair modo seleção");
    setSelectMode(false);
    setSelected(new Set());
  };

  const doDelete = async (ids: string[]) => {
    console.log("[GestaoMesas] Excluir em lote:", ids);
    setDeleting(true);
    for (const id of ids) {
      try {
        await apiDelete(`/api/mesas/${id}`);
        console.log("[GestaoMesas] Mesa excluída:", id);
      } catch (e: unknown) {
        console.error("[GestaoMesas] Erro ao excluir", id, ":", e);
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchMesas();
  };

  const confirmBulkDelete = () => {
    if (selected.size === 0) return;
    console.log("[GestaoMesas] Confirmar exclusão em lote:", selected.size, "itens");
    setConfirmDialog({
      visible: true,
      title: `Excluir ${selected.size} item(s)?`,
      message: `Deseja excluir ${selected.size} item(s) selecionado(s)?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: `Excluir ${selected.size}`,
      onConfirm: () => {
        closeConfirm();
        doDelete(Array.from(selected));
      },
    });
  };

  const inputStyle = {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 12,
    padding: 12,
    fontFamily: "Outfit_400Regular" as const,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  };

  const searchLower = search.toLowerCase();
  const filteredMesas = search.trim()
    ? mesas.filter(
        (m) =>
          String(m.numero).includes(searchLower) ||
          getMesaStatusLabel(m.status).toLowerCase().includes(searchLower)
      )
    : mesas;

  const emptyText = search.trim() ? "Nenhum resultado encontrado" : "Nenhuma mesa cadastrada";
  const emptySubText = search.trim() ? "Tente outro termo de busca" : "Toque em \"Incluir\" para adicionar mesas";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={["top", "left", "right"]}>
      {/* Nav bar */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          height: 56,
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
          backgroundColor: COLORS.surface,
        }}
      >
        {/* LEFT */}
        <View style={{ width: 80 }}>
          {selectMode ? (
            <TouchableOpacity onPress={exitSelectMode} style={{ paddingVertical: 8 }}>
              <Text style={{ color: "#007AFF", fontSize: 16, fontWeight: "500" }}>Cancelar</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoMesas] Botão voltar pressionado");
                handleBack();
              }}
              style={{ flexDirection: "row", alignItems: "center" }}
            >
              <Ionicons name="chevron-back" size={26} color="#007AFF" />
              <Text style={{ color: "#007AFF", fontSize: 17, fontWeight: "500" }}>Voltar</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* CENTER */}
        <Text
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: 17,
            fontWeight: "700",
            color: COLORS.text,
          }}
        >
          Mesas
        </Text>

        {/* RIGHT */}
        <View style={{ width: 80, alignItems: "flex-end" }}>
          {selectMode ? (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoMesas] Botão excluir lote pressionado");
                confirmBulkDelete();
              }}
              disabled={selected.size === 0 || deleting}
              style={{
                backgroundColor: selected.size > 0 ? "#FF3B30" : COLORS.border,
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 6,
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              {deleting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="trash" size={14} color="#fff" />
              )}
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Excluir ({selected.size})</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoMesas] Botão incluir pressionado");
                openCreate();
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: COLORS.success,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 8,
                gap: 4,
              }}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>Incluir</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Search bar */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.divider,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: COLORS.surfaceSecondary,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            gap: 8,
          }}
        >
          <Search size={16} color={COLORS.textSecondary} />
          <TextInput
            value={search}
            onChangeText={(t) => {
              console.log("[GestaoMesas] Busca:", t);
              setSearch(t);
            }}
            placeholder="Buscar..."
            placeholderTextColor={COLORS.textTertiary}
            style={{ flex: 1, fontFamily: "Outfit_400Regular", fontSize: 15, color: COLORS.text, padding: 0 }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={16} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ paddingTop: 16 }}>
          {[0, 1, 2].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, gap: 12 }}>
          <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
            Erro ao carregar mesas
          </Text>
          <Text
            style={{
              fontFamily: "Outfit_400Regular",
              fontSize: 14,
              color: COLORS.textSecondary,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
          <TouchableOpacity
            onPress={fetchMesas}
            style={{
              backgroundColor: COLORS.primary,
              borderRadius: 12,
              paddingHorizontal: 24,
              paddingVertical: 12,
            }}
          >
            <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: "#fff" }}>
              Tentar novamente
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
        >
          {filteredMesas.length === 0 ? (
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
                <LayoutGrid size={32} color={COLORS.primary} />
              </View>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 17, color: COLORS.text }}>
                {emptyText}
              </Text>
              <Text
                style={{
                  fontFamily: "Outfit_400Regular",
                  fontSize: 14,
                  color: COLORS.textSecondary,
                  textAlign: "center",
                }}
              >
                {emptySubText}
              </Text>
            </View>
          ) : (
            filteredMesas.map((item) => {
              const statusColor = getMesaStatusColor(item.status);
              const statusLabel = getMesaStatusLabel(item.status);
              const numeroStr = String(item.numero);
              const isSelected = selected.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  style={{
                    backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    shadowColor: "#000",
                    shadowOpacity: 0.06,
                    shadowRadius: 4,
                    elevation: 2,
                    borderWidth: 1,
                    borderColor: isSelected ? COLORS.primary : COLORS.border,
                  }}
                >
                  <TouchableOpacity
                    onPress={() => {
                      if (selectMode) {
                        console.log("[GestaoMesas] Checkbox toggle (select mode):", item.id);
                        toggleSelect(item.id);
                      } else {
                        console.log("[GestaoMesas] Checkbox — entrar select mode:", item.id);
                        enterSelectMode(item.id);
                      }
                    }}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      borderWidth: 2,
                      borderColor: isSelected ? COLORS.primary : COLORS.border,
                      backgroundColor: isSelected ? COLORS.primary : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 10,
                    }}
                  >
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      backgroundColor: statusColor + "18",
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: statusColor }}>
                      {numeroStr}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 16, color: COLORS.text }}>
                      Mesa {item.numero}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Users size={12} color={COLORS.textSecondary} />
                        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                          {item.capacidade} lugares
                        </Text>
                      </View>
                      <View
                        style={{
                          backgroundColor: statusColor + "20",
                          borderRadius: 6,
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                        }}
                      >
                        <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 11, color: statusColor }}>
                          {statusLabel}
                        </Text>
                      </View>
                    </View>
                  </View>
                  {!selectMode && (
                    <View onStartShouldSetResponder={() => true} style={{ gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoMesas] Editar pressionado:", item.id);
                          openEdit(item);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#007AFF",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 7,
                          gap: 4,
                        }}
                      >
                        <Ionicons name="pencil" size={14} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Editar</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoMesas] Excluir pressionado:", item.id);
                          handleDelete(item.id, item.numero);
                        }}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: "#FF3B30",
                          paddingHorizontal: 12,
                          paddingVertical: 7,
                          borderRadius: 7,
                          gap: 4,
                        }}
                      >
                        <Ionicons name="trash" size={14} color="#fff" />
                        <Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>Excluir</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}

      <Modal visible={showModal} transparent animationType="fade" onRequestClose={() => setShowModal(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 20,
              padding: 24,
              width: "100%",
              maxWidth: 380,
              gap: 16,
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 20, color: COLORS.text }}>
                {editingMesa ? "Editar Mesa" : "Nova Mesa"}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[GestaoMesas] Modal fechado");
                  setShowModal(false);
                }}
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: COLORS.surfaceSecondary,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={16} color={COLORS.textSecondary} />
              </AnimatedPressable>
            </View>

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  Número *
                </Text>
                <TextInput
                  value={numero}
                  onChangeText={(t) => { setNumero(t); setModalError(""); }}
                  placeholder="Ex: 1"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="number-pad"
                  style={inputStyle}
                  autoFocus
                />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  Capacidade *
                </Text>
                <TextInput
                  value={capacidade}
                  onChangeText={(t) => { setCapacidade(t); setModalError(""); }}
                  placeholder="4"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="number-pad"
                  style={inputStyle}
                />
              </View>
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Status</Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {STATUS_OPTIONS.map((opt) => (
                  <AnimatedPressable
                    key={opt.value}
                    onPress={() => {
                      console.log("[GestaoMesas] Status selecionado:", opt.value);
                      setStatus(opt.value);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      borderRadius: 10,
                      alignItems: "center",
                      backgroundColor: status === opt.value ? COLORS.primary : COLORS.surfaceSecondary,
                      borderWidth: 1,
                      borderColor: status === opt.value ? COLORS.primary : COLORS.border,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Outfit_600SemiBold",
                        fontSize: 12,
                        color: status === opt.value ? "#fff" : COLORS.textSecondary,
                      }}
                    >
                      {opt.label}
                    </Text>
                  </AnimatedPressable>
                ))}
              </View>
            </View>

            {modalError ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>
                {modalError}
              </Text>
            ) : null}

            <AnimatedPressable
              onPress={() => {
                console.log("[GestaoMesas] Salvar mesa pressionado");
                handleSave();
              }}
              disabled={saving}
              style={{
                backgroundColor: COLORS.primary,
                borderRadius: 14,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                  {editingMesa ? "Salvar alterações" : "Adicionar mesa"}
                </Text>
              )}
            </AnimatedPressable>
          </View>
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmDialog.visible}
        title={confirmDialog.title}
        message={confirmDialog.message}
        confirmLabel={confirmDialog.confirmLabel}
        destructive
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirm}
      />
    </SafeAreaView>
  );
}
