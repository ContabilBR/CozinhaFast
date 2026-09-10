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
  Alert,
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
import { getInitials, getRoleLabel } from "@/utils/helpers";
import { X, Users, Search } from "lucide-react-native";

interface ApiGarcom {
  id: string;
  nome?: string;
  name?: string;
  email: string;
  role?: string;
}

function getDisplayName(u: ApiGarcom): string {
  return u.name || u.nome || "";
}

export default function GestaoGarconsScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [garcons, setGarcons] = useState<ApiGarcom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingGarcom, setEditingGarcom] = useState<ApiGarcom | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailDuplicate, setEmailDuplicate] = useState(false);

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

  const fetchGarcons = useCallback(async () => {
    console.log("[GestaoGarcons] GET /api/garcons");
    try {
      const res = await apiGet<any>("/api/garcons");
      const list: ApiGarcom[] = Array.isArray(res) ? res : (res.garcons || []);
      console.log("[GestaoGarcons] Carregados", list.length, "garçons");
      setGarcons(list);
      setError("");
    } catch (e: unknown) {
      console.error("[GestaoGarcons] Erro:", e);
      setError("Não foi possível carregar os garçons.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      console.log("[GestaoGarcons] Tela focada — recarregando garçons");
      setLoading(true);
      fetchGarcons();
    }, [fetchGarcons])
  );

  const openCreate = () => {
    console.log("[GestaoGarcons] Abrir modal de criação");
    setEditingGarcom(null);
    setNome("");
    setEmail("");
    setSenha("");
    setConfirmarSenha("");
    setModalError("");
    setEmailDuplicate(false);
    setEmailChecking(false);
    setShowModal(true);
  };

  const openEdit = (g: ApiGarcom) => {
    console.log("[GestaoGarcons] Abrir modal de edição:", g.id);
    setEditingGarcom(g);
    setNome(getDisplayName(g));
    setEmail(g.email ?? "");
    setSenha("");
    setConfirmarSenha("");
    setModalError("");
    setEmailDuplicate(false);
    setEmailChecking(false);
    setShowModal(true);
  };

  const handleEmailBlur = async () => {
    if (!email.trim() || !email.includes("@")) return;
    if (editingGarcom) return;
    console.log("[GestaoGarcons] Verificando duplicidade de e-mail:", email.trim());
    setEmailChecking(true);
    try {
      const result = await apiGet<{ exists: boolean; nome?: string }>(
        `/api/garcons/check-email?email=${encodeURIComponent(email.trim())}`
      );
      console.log("[GestaoGarcons] check-email resposta:", result);
      if (result.exists) {
        setEmailDuplicate(true);
        Alert.alert(
          "E-mail já cadastrado",
          `O e-mail "${email.trim()}" já está cadastrado para ${result.nome}. Utilize outro e-mail.`
        );
      } else {
        setEmailDuplicate(false);
      }
    } catch (e: unknown) {
      console.error("[GestaoGarcons] Erro ao verificar e-mail:", e);
    } finally {
      setEmailChecking(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    setModalError("");
    try {
      if (editingGarcom) {
        const payload: Record<string, unknown> = { name: nome.trim(), email: email.trim() };
        if (senha.trim()) payload.password = senha.trim();
        console.log("[GestaoGarcons] PUT /api/garcons/" + editingGarcom.id);
        await apiPut(`/api/garcons/${editingGarcom.id}`, payload);
        console.log("[GestaoGarcons] Garçom atualizado:", editingGarcom.id);
      } else {
        console.log("[GestaoGarcons] POST /api/garcons");
        await apiPost("/api/garcons", {
          name: nome.trim(),
          email: email.trim(),
          password: senha.trim(),
        });
        console.log("[GestaoGarcons] Garçom criado");
      }
      setShowModal(false);
      await fetchGarcons();
    } catch (e: unknown) {
      console.error("[GestaoGarcons] Erro ao salvar:", e);
      setModalError(e instanceof Error ? e.message : "Não foi possível salvar o garçom.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    if (!nome.trim()) { setModalError("Nome é obrigatório."); return; }
    if (!editingGarcom && !email.trim()) { setModalError("E-mail é obrigatório."); return; }
    if (!editingGarcom && !senha.trim()) { setModalError("Senha é obrigatória."); return; }
    if (!editingGarcom && !confirmarSenha.trim()) { setModalError("Confirme a senha."); return; }
    if (!editingGarcom && senha !== confirmarSenha) { setModalError("As senhas não coincidem."); return; }
    if (editingGarcom && senha.trim() && senha !== confirmarSenha) { setModalError("As senhas não coincidem."); return; }
    console.log("[GestaoGarcons] Confirmar salvar pressionado, editando:", editingGarcom?.id ?? "novo");
    setConfirmDialog({
      visible: true,
      title: "Confirmar",
      message: "Deseja salvar as alterações?",
      confirmLabel: "Confirmar",
      onConfirm: () => {
        closeConfirm();
        doSave();
      },
    });
  };

  const handleDelete = (id: string, nomeGarcom: string) => {
    const displayNome = nomeGarcom || "Garçom";
    console.log("[GestaoGarcons] Confirmar exclusão:", id, displayNome);
    setConfirmDialog({
      visible: true,
      title: "Excluir garçom?",
      message: `Deseja excluir "${displayNome}"?\n\nEsta ação não pode ser desfeita.`,
      confirmLabel: "Excluir",
      onConfirm: async () => {
        closeConfirm();
        console.log("[GestaoGarcons] DELETE /api/garcons/" + id);
        try {
          await apiDelete(`/api/garcons/${id}`);
          console.log("[GestaoGarcons] Garçom excluído:", id);
          setGarcons((prev) => prev.filter((g) => g.id !== id));
        } catch (e: unknown) {
          console.error("[GestaoGarcons] Erro ao excluir:", e);
        }
      },
    });
  };

  const toggleSelect = (id: string) => {
    console.log("[GestaoGarcons] Toggle seleção:", id);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log("[GestaoGarcons] Entrar modo seleção, item:", id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log("[GestaoGarcons] Sair modo seleção");
    setSelectMode(false);
    setSelected(new Set());
  };

  const doDelete = async (ids: string[]) => {
    console.log("[GestaoGarcons] Excluir em lote:", ids);
    setDeleting(true);
    for (const id of ids) {
      try {
        await apiDelete(`/api/garcons/${id}`);
        console.log("[GestaoGarcons] Garçom excluído:", id);
      } catch (e: unknown) {
        console.error("[GestaoGarcons] Erro ao excluir", id, ":", e);
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchGarcons();
  };

  const confirmBulkDelete = () => {
    if (selected.size === 0) return;
    console.log("[GestaoGarcons] Confirmar exclusão em lote:", selected.size, "itens");
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
  const filteredGarcons = search.trim()
    ? garcons.filter((g) => {
        const n = getDisplayName(g).toLowerCase();
        const e = (g.email ?? "").toLowerCase();
        return n.includes(searchLower) || e.includes(searchLower);
      })
    : garcons;

  const emptyText = search.trim() ? "Nenhum resultado encontrado" : "Nenhum garçom cadastrado";
  const emptySubText = search.trim() ? "Tente outro termo de busca" : "Toque em \"Incluir\" para adicionar garçons";

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
                console.log("[GestaoGarcons] Botão voltar pressionado");
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
          Garçons
        </Text>

        {/* RIGHT */}
        <View style={{ width: 80, alignItems: "flex-end" }}>
          {selectMode ? (
            <TouchableOpacity
              onPress={() => {
                console.log("[GestaoGarcons] Botão excluir lote pressionado");
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
                console.log("[GestaoGarcons] Botão incluir pressionado");
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
              console.log("[GestaoGarcons] Busca:", t);
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
            Erro ao carregar garçons
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
            onPress={fetchGarcons}
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
          {filteredGarcons.length === 0 ? (
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
                <Users size={32} color={COLORS.primary} />
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
            filteredGarcons.map((item) => {
              const displayName = getDisplayName(item);
              const initials = getInitials(displayName || item.email);
              const roleLabel = getRoleLabel(item.role);
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
                        console.log("[GestaoGarcons] Checkbox toggle (select mode):", item.id);
                        toggleSelect(item.id);
                      } else {
                        console.log("[GestaoGarcons] Checkbox — entrar select mode:", item.id);
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
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: COLORS.primaryMuted,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 12,
                    }}
                  >
                    <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 15, color: COLORS.primary }}>
                      {initials}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{ fontFamily: "Outfit_600SemiBold", fontSize: 15, color: COLORS.text }}
                      numberOfLines={1}
                    >
                      {displayName || "Sem nome"}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }}
                    >
                      {item.email}
                    </Text>
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 11, color: COLORS.primary, marginTop: 2 }}>
                      {roleLabel}
                    </Text>
                  </View>
                  {!selectMode && (
                    <View onStartShouldSetResponder={() => true} style={{ gap: 6 }}>
                      <TouchableOpacity
                        onPress={() => {
                          console.log("[GestaoGarcons] Editar pressionado:", item.id);
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
                          console.log("[GestaoGarcons] Excluir pressionado:", item.id);
                          handleDelete(item.id, displayName);
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
                {editingGarcom ? "Editar Garçom" : "Novo Garçom"}
              </Text>
              <AnimatedPressable
                onPress={() => {
                  console.log("[GestaoGarcons] Modal fechado");
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

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>Nome *</Text>
              <TextInput
                value={nome}
                onChangeText={setNome}
                placeholder="Nome completo"
                placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
                autoFocus
              />
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {editingGarcom ? "E-mail" : "E-mail *"}
              </Text>
              <View style={{ position: "relative" }}>
                <TextInput
                  value={email}
                  onChangeText={(t) => {
                    setEmail(t);
                    if (emailDuplicate) setEmailDuplicate(false);
                  }}
                  onBlur={handleEmailBlur}
                  placeholder="email@exemplo.com"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[
                    inputStyle,
                    emailDuplicate && { borderColor: COLORS.danger },
                    { paddingRight: emailChecking ? 40 : 12 },
                  ]}
                />
                {emailChecking && (
                  <View
                    style={{
                      position: "absolute",
                      right: 12,
                      top: 0,
                      bottom: 0,
                      justifyContent: "center",
                    }}
                  >
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                )}
              </View>
              {emailDuplicate && (
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.danger }}>
                  E-mail já cadastrado. Utilize outro e-mail.
                </Text>
              )}
            </View>

            <View style={{ gap: 6 }}>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {editingGarcom ? "Nova senha (opcional)" : "Senha *"}
              </Text>
              <TextInput
                value={senha}
                onChangeText={setSenha}
                placeholder={editingGarcom ? "Deixe em branco para manter" : "Senha"}
                placeholderTextColor={COLORS.textTertiary}
                secureTextEntry
                style={inputStyle}
              />
            </View>

            {(!editingGarcom || senha.length > 0) && (
              <View style={{ gap: 6 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  {editingGarcom ? "Confirmar nova senha" : "Confirmar Senha *"}
                </Text>
                <TextInput
                  value={confirmarSenha}
                  onChangeText={setConfirmarSenha}
                  placeholder="Repita a senha"
                  placeholderTextColor={COLORS.textTertiary}
                  secureTextEntry
                  style={inputStyle}
                />
                {confirmarSenha.length > 0 && senha.length > 0 ? (
                  senha === confirmarSenha ? (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.success }}>Senhas coincidem ✓</Text>
                  ) : (
                    <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.danger }}>As senhas não coincidem.</Text>
                  )
                ) : null}
              </View>
            )}

            {modalError ? (
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 13, color: COLORS.danger }}>
                {modalError}
              </Text>
            ) : null}

            <AnimatedPressable
              onPress={() => {
                console.log("[GestaoGarcons] Salvar garçom pressionado");
                handleSave();
              }}
              disabled={saving || emailDuplicate || emailChecking}
              style={{
                backgroundColor: emailDuplicate ? COLORS.border : COLORS.primary,
                borderRadius: 14,
                height: 52,
                alignItems: "center",
                justifyContent: "center",
                opacity: emailDuplicate || emailChecking ? 0.6 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
                  {editingGarcom ? "Salvar alterações" : "Adicionar garçom"}
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
        destructive={confirmDialog.confirmLabel !== "Confirmar"}
        onConfirm={confirmDialog.onConfirm}
        onCancel={closeConfirm}
      />
    </SafeAreaView>
  );
}
