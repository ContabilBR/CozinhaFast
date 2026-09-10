import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CheckCircle, Pencil, Trash2 } from 'lucide-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { apiGet, apiPut, apiDelete } from '@/utils/api';
import { ConfirmDialog } from '@/components/ConfirmDialog';

type Mode = 'empty' | 'view' | 'edit';

interface RestauranteData {
  id?: string;
  nome: string;
  filial: string;
  endereco: string;
  cnpj: string;
}

const EMPTY_FORM: RestauranteData = { nome: '', filial: '', endereco: '', cnpj: '' };

export default function RestauranteScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('empty');
  const [saved, setSaved] = useState<RestauranteData>(EMPTY_FORM);
  const [form, setForm] = useState<RestauranteData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [nomeError, setNomeError] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const handleBack = useCallback(() => {
    console.log('[Restaurante] Botão Voltar pressionado');
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/(gestao)');
    }
  }, [router]);

  const loadData = useCallback(async () => {
    console.log('[Restaurante] Carregando dados GET /api/restaurante');
    setLoading(true);
    try {
      const data = await apiGet<Partial<RestauranteData>>('/api/restaurante');
      console.log('[Restaurante] Dados recebidos:', data);
      if (data && data.nome) {
        const loaded: RestauranteData = {
          id: (data as any).id,
          nome: data.nome ?? '',
          filial: data.filial ?? '',
          endereco: data.endereco ?? '',
          cnpj: data.cnpj ?? '',
        };
        setSaved(loaded);
        setForm(loaded);
        setMode('view');
      } else {
        setSaved(EMPTY_FORM);
        setForm(EMPTY_FORM);
        setMode('empty');
      }
    } catch (err) {
      console.error('[Restaurante] Erro ao carregar dados:', err);
      setMode('empty');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = useCallback(async () => {
    console.log('[Restaurante] Botão Salvar pressionado', form);
    if (!form.nome.trim()) {
      setNomeError('Nome é obrigatório');
      return;
    }
    setNomeError('');
    setSaving(true);
    try {
      const body = {
        nome: form.nome.trim(),
        filial: form.filial.trim() || undefined,
        endereco: form.endereco.trim() || undefined,
        cnpj: form.cnpj.trim() || undefined,
      };
      console.log('[Restaurante] PUT /api/restaurante', body);
      const result = await apiPut<RestauranteData>('/api/restaurante', body);
      console.log('[Restaurante] Salvo com sucesso:', result);
      const updated: RestauranteData = {
        id: (result as any)?.id,
        nome: result?.nome ?? form.nome,
        filial: result?.filial ?? form.filial,
        endereco: result?.endereco ?? form.endereco,
        cnpj: result?.cnpj ?? form.cnpj,
      };
      setSaved(updated);
      setForm(updated);
      setShowSuccess(true);
      setTimeout(() => {
        setShowSuccess(false);
        setMode('view');
      }, 1500);
    } catch (err) {
      console.error('[Restaurante] Erro ao salvar:', err);
    } finally {
      setSaving(false);
    }
  }, [form]);

  const handleEdit = useCallback(() => {
    console.log('[Restaurante] Botão Editar pressionado');
    setForm({ ...saved });
    setNomeError('');
    setMode('edit');
  }, [saved]);

  const handleCancelEdit = useCallback(() => {
    console.log('[Restaurante] Botão Cancelar pressionado');
    setForm({ ...saved });
    setNomeError('');
    setMode('view');
  }, [saved]);

  const handleDeletePress = useCallback(() => {
    console.log('[Restaurante] Botão Excluir pressionado');
    setShowConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    console.log('[Restaurante] Exclusão confirmada, DELETE /api/restaurante');
    setShowConfirmDelete(false);
    setDeleting(true);
    try {
      await apiDelete('/api/restaurante');
      console.log('[Restaurante] Excluído com sucesso');
      setSaved(EMPTY_FORM);
      setForm(EMPTY_FORM);
      setMode('empty');
    } catch (err) {
      console.error('[Restaurante] Erro ao excluir:', err);
    } finally {
      setDeleting(false);
    }
  }, []);

  const handleDeleteCancel = useCallback(() => {
    console.log('[Restaurante] Exclusão cancelada');
    setShowConfirmDelete(false);
  }, []);

  // ── Derived display values ──────────────────────────────────────────────────
  const displayNome = saved.nome || '—';
  const displayFilial = saved.filial || '—';
  const displayEndereco = saved.endereco || '—';
  const displayCnpj = saved.cnpj || '—';

  const isFormMode = mode === 'empty' || mode === 'edit';

  // ── Styles ──────────────────────────────────────────────────────────────────
  const s = {
    container: { flex: 1, backgroundColor: COLORS.background },
    navBar: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      height: 56,
      paddingHorizontal: 16,
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
      backgroundColor: COLORS.surface,
    },
    navLeft: { width: 80 },
    navCenter: { flex: 1, alignItems: 'center' as const },
    navRight: { width: 80 },
    navTitle: {
      fontSize: 17,
      fontWeight: '700' as const,
      color: COLORS.text,
    },
    backBtn: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: 4,
    },
    backLabel: {
      fontSize: 16,
      color: '#007AFF',
      fontWeight: '500' as const,
    },
    scroll: { flex: 1 },
    scrollContent: { padding: 20, gap: 16 },
    label: {
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 13,
      color: COLORS.textSecondary,
      marginBottom: 6,
    },
    input: {
      backgroundColor: COLORS.surface,
      borderWidth: 1,
      borderColor: COLORS.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontFamily: 'Outfit_400Regular',
      fontSize: 15,
      color: COLORS.text,
    },
    inputError: {
      borderColor: COLORS.danger,
    },
    errorText: {
      fontFamily: 'Outfit_400Regular',
      fontSize: 12,
      color: COLORS.danger,
      marginTop: 4,
    },
    fieldGroup: { gap: 4 },
    btnPrimary: {
      backgroundColor: COLORS.primary,
      borderRadius: 14,
      height: 52,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    btnPrimaryText: {
      fontFamily: 'Outfit_700Bold',
      fontSize: 16,
      color: '#fff',
    },
    btnOutline: {
      borderWidth: 1.5,
      borderColor: COLORS.border,
      borderRadius: 14,
      height: 52,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    btnOutlineText: {
      fontFamily: 'Outfit_600SemiBold',
      fontSize: 16,
      color: COLORS.textSecondary,
    },
    btnDanger: {
      backgroundColor: COLORS.danger,
      borderRadius: 14,
      height: 52,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexDirection: 'row' as const,
      gap: 8,
    },
    btnDangerText: {
      fontFamily: 'Outfit_700Bold',
      fontSize: 16,
      color: '#fff',
    },
    btnBlue: {
      backgroundColor: '#3B82F6',
      borderRadius: 14,
      height: 52,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      flexDirection: 'row' as const,
      gap: 8,
    },
    btnBlueText: {
      fontFamily: 'Outfit_700Bold',
      fontSize: 16,
      color: '#fff',
    },
    card: {
      backgroundColor: COLORS.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: COLORS.border,
      overflow: 'hidden' as const,
    },
    cardRow: { paddingHorizontal: 16, paddingVertical: 14 },
    cardLabel: {
      fontFamily: 'Outfit_500Medium',
      fontSize: 12,
      color: COLORS.textSecondary,
      marginBottom: 4,
    },
    cardValue: {
      fontFamily: 'Outfit_400Regular',
      fontSize: 15,
      color: COLORS.text,
    },
    divider: { height: 1, backgroundColor: COLORS.divider, marginHorizontal: 16 },
    rowBtns: { flexDirection: 'row' as const, gap: 12 },
    flex1: { flex: 1 },
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={s.container}>
        <View style={[s.navBar]}>
          <View style={s.navLeft}>
            <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color="#007AFF" />
              <Text style={s.backLabel}>Voltar</Text>
            </TouchableOpacity>
          </View>
          <View style={s.navCenter}>
            <Text style={s.navTitle}>Restaurante</Text>
          </View>
          <View style={s.navRight} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={s.container}>
      {/* Nav Bar */}
      <View style={s.navBar}>
        <View style={s.navLeft}>
          <TouchableOpacity style={s.backBtn} onPress={handleBack} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color="#007AFF" />
            <Text style={s.backLabel}>Voltar</Text>
          </TouchableOpacity>
        </View>
        <View style={s.navCenter}>
          <Text style={s.navTitle}>Restaurante</Text>
        </View>
        <View style={s.navRight} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── VIEW MODE ─────────────────────────────────────────────────── */}
          {mode === 'view' && (
            <>
              <View style={s.card}>
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Nome</Text>
                  <Text style={s.cardValue}>{displayNome}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Filial</Text>
                  <Text style={s.cardValue}>{displayFilial}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>Endereço</Text>
                  <Text style={s.cardValue}>{displayEndereco}</Text>
                </View>
                <View style={s.divider} />
                <View style={s.cardRow}>
                  <Text style={s.cardLabel}>CNPJ</Text>
                  <Text style={s.cardValue}>{displayCnpj}</Text>
                </View>
              </View>

              <View style={s.rowBtns}>
                <TouchableOpacity
                  style={[s.btnBlue, s.flex1]}
                  onPress={handleEdit}
                  disabled={deleting}
                >
                  <Pencil size={18} color="#fff" />
                  <Text style={s.btnBlueText}>Editar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.btnDanger, s.flex1]}
                  onPress={handleDeletePress}
                  disabled={deleting}
                >
                  {deleting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Trash2 size={18} color="#fff" />
                      <Text style={s.btnDangerText}>Excluir</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* ── FORM MODE (empty or edit) ──────────────────────────────────── */}
          {isFormMode && (
            <>
              <View style={s.fieldGroup}>
                <Text style={s.label}>Nome *</Text>
                <TextInput
                  style={[s.input, nomeError ? s.inputError : undefined]}
                  value={form.nome}
                  onChangeText={(v) => {
                    setForm((f) => ({ ...f, nome: v }));
                    if (nomeError) setNomeError('');
                  }}
                  placeholder="Nome do restaurante"
                  placeholderTextColor={COLORS.textTertiary}
                />
                {!!nomeError && <Text style={s.errorText}>{nomeError}</Text>}
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.label}>Filial</Text>
                <TextInput
                  style={s.input}
                  value={form.filial}
                  onChangeText={(v) => setForm((f) => ({ ...f, filial: v }))}
                  placeholder="Nome da filial (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                />
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.label}>Endereço</Text>
                <TextInput
                  style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                  value={form.endereco}
                  onChangeText={(v) => setForm((f) => ({ ...f, endereco: v }))}
                  placeholder="Endereço completo (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  multiline
                />
              </View>

              <View style={s.fieldGroup}>
                <Text style={s.label}>CNPJ</Text>
                <TextInput
                  style={s.input}
                  value={form.cnpj}
                  onChangeText={(v) => setForm((f) => ({ ...f, cnpj: v }))}
                  placeholder="00.000.000/0000-00 (opcional)"
                  placeholderTextColor={COLORS.textTertiary}
                  keyboardType="numeric"
                />
              </View>

              {mode === 'edit' ? (
                <View style={s.rowBtns}>
                  <TouchableOpacity
                    style={[s.btnOutline, s.flex1]}
                    onPress={handleCancelEdit}
                    disabled={saving}
                  >
                    <Text style={s.btnOutlineText}>Cancelar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.btnPrimary, s.flex1]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={s.btnPrimaryText}>Salvar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={s.btnPrimary}
                  onPress={handleSave}
                  disabled={saving}
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={s.btnPrimaryText}>Salvar</Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Success Modal ──────────────────────────────────────────────────── */}
      <Modal visible={showSuccess} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.45)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
          }}
        >
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 20,
              padding: 32,
              alignItems: 'center',
              gap: 12,
              width: '100%',
              maxWidth: 300,
            }}
          >
            <CheckCircle size={48} color={COLORS.success} />
            <Text
              style={{
                fontFamily: 'Outfit_700Bold',
                fontSize: 16,
                color: COLORS.text,
                textAlign: 'center',
              }}
            >
              Dados salvos com sucesso!
            </Text>
          </View>
        </View>
      </Modal>

      {/* ── Confirm Delete Dialog ──────────────────────────────────────────── */}
      <ConfirmDialog
        visible={showConfirmDelete}
        title="Excluir restaurante"
        message="Deseja excluir os dados do restaurante? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        cancelLabel="Cancelar"
        destructive
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </SafeAreaView>
  );
}
