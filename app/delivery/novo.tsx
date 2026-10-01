import React, { useState, useEffect } from "react";
import { View, Text, TextInput, ScrollView, Pressable, Alert, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { apiGet, apiPost } from "@/utils/api";
import { formatCurrency } from "@/utils/helpers";

interface Prato { id: string; nome: string; preco: string; categoria_nome?: string }
interface ItemPedido { prato_id: string; nome: string; preco: number; quantidade: number; observacao?: string }

export default function NovoDelivery() {
  const COLORS = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [clienteNome, setClienteNome] = useState("");
  const [clienteTelefone, setClienteTelefone] = useState("");
  const [endereco, setEndereco] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cep, setCep] = useState("");
  const [referencia, setReferencia] = useState("");
  const [taxaEntrega, setTaxaEntrega] = useState("0");
  const [observacao, setObservacao] = useState("");
  const [itens, setItens] = useState<ItemPedido[]>([]);
  const [pratos, setPratos] = useState<Prato[]>([]);
  const [showCardapio, setShowCardapio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pagMomento, setPagMomento] = useState<"ja_pago" | "na_entrega">("na_entrega");
  const [pagForma, setPagForma] = useState<"pix" | "credito" | "debito" | "dinheiro">("dinheiro");
  const [trocoPara, setTrocoPara] = useState("");

  useEffect(() => {
    console.log("[NovoDelivery] Fetching pratos");
    apiGet<{ pratos?: Prato[] }>("/api/pratos").then((d) => setPratos(d.pratos || (Array.isArray(d) ? d : []))).catch(() => {});
  }, []);

  const addItem = (prato: Prato) => {
    console.log("[NovoDelivery] addItem pressed:", prato.id, prato.nome);
    const existing = itens.find((i) => i.prato_id === prato.id);
    if (existing) {
      setItens(itens.map((i) => i.prato_id === prato.id ? { ...i, quantidade: i.quantidade + 1 } : i));
    } else {
      setItens([...itens, { prato_id: prato.id, nome: prato.nome, preco: parseFloat(prato.preco), quantidade: 1 }]);
    }
    setShowCardapio(false);
  };

  const removeItem = (pratoId: string) => {
    console.log("[NovoDelivery] removeItem pressed:", pratoId);
    setItens(itens.filter((i) => i.prato_id !== pratoId));
  };

  const subtotal = itens.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const taxa = parseFloat(taxaEntrega) || 0;
  const total = subtotal + taxa;

  const submit = async () => {
    console.log("[NovoDelivery] submit pressed", { clienteNome, clienteTelefone, endereco, itens: itens.length, pagMomento, pagForma });
    if (!clienteNome.trim()) return Alert.alert("Erro", "Informe o nome do cliente");
    if (!clienteTelefone.trim()) return Alert.alert("Erro", "Informe o telefone");
    if (!endereco.trim()) return Alert.alert("Erro", "Informe o endereço");
    if (itens.length === 0) return Alert.alert("Erro", "Adicione pelo menos um item");
    setSaving(true);
    try {
      console.log("[NovoDelivery] POST /api/delivery/pedidos", { cliente_nome: clienteNome, itens, pagMomento, pagForma });
      await apiPost("/api/delivery/pedidos", {
        cliente_nome: clienteNome.trim(), cliente_telefone: clienteTelefone.trim(), endereco: endereco.trim(),
        complemento: complemento.trim() || undefined, bairro: bairro.trim() || undefined, cep: cep.trim() || undefined,
        referencia: referencia.trim() || undefined, taxa_entrega: taxa, observacao: observacao.trim() || undefined,
        itens: itens.map((i) => ({ prato_id: i.prato_id, quantidade: i.quantidade, observacao: i.observacao })),
        pagamento: {
          momento: pagMomento,
          forma: pagForma,
          ...(pagMomento === "na_entrega" && pagForma === "dinheiro" && trocoPara ? { troco_para: parseFloat(trocoPara) } : {}),
        },
      });
      console.log("[NovoDelivery] Pedido criado com sucesso");
      router.back();
    } catch (err: any) {
      console.log("[NovoDelivery] Erro ao criar pedido:", err?.message);
      Alert.alert("Erro", err?.message || "Erro ao criar pedido");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = { backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, fontSize: 15, color: COLORS.text, marginBottom: 10 };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Pressable onPress={() => { console.log("[NovoDelivery] back pressed"); router.back(); }}><Ionicons name="arrow-back" size={24} color={COLORS.text} /></Pressable>
        <Text style={{ fontSize: 20, fontWeight: "700", color: COLORS.text }}>Novo delivery</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Dados do cliente</Text>
        <TextInput placeholder="Nome do cliente" placeholderTextColor={COLORS.textTertiary} value={clienteNome} onChangeText={setClienteNome} style={inputStyle} />
        <TextInput placeholder="Telefone" placeholderTextColor={COLORS.textTertiary} value={clienteTelefone} onChangeText={setClienteTelefone} keyboardType="phone-pad" style={inputStyle} />

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Endereço</Text>
        <TextInput placeholder="Endereço completo" placeholderTextColor={COLORS.textTertiary} value={endereco} onChangeText={setEndereco} style={inputStyle} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TextInput placeholder="Bairro" placeholderTextColor={COLORS.textTertiary} value={bairro} onChangeText={setBairro} style={{ ...inputStyle, flex: 1 }} />
          <TextInput placeholder="CEP" placeholderTextColor={COLORS.textTertiary} value={cep} onChangeText={setCep} keyboardType="numeric" style={{ ...inputStyle, width: 110 }} />
        </View>
        <TextInput placeholder="Complemento" placeholderTextColor={COLORS.textTertiary} value={complemento} onChangeText={setComplemento} style={inputStyle} />
        <TextInput placeholder="Referência" placeholderTextColor={COLORS.textTertiary} value={referencia} onChangeText={setReferencia} style={inputStyle} />

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Itens do pedido</Text>
        {itens.map((item) => (
          <View key={item.prato_id} style={{ backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 12, marginBottom: 8, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, color: COLORS.text }}>{item.quantidade}x {item.nome}</Text>
              <Text style={{ fontSize: 13, color: COLORS.primary, fontWeight: "500" }}>{formatCurrency(item.preco * item.quantidade)}</Text>
            </View>
            <Pressable onPress={() => removeItem(item.prato_id)}><Ionicons name="trash-outline" size={20} color="#EF4444" /></Pressable>
          </View>
        ))}
        <Pressable onPress={() => { console.log("[NovoDelivery] toggle cardapio:", !showCardapio); setShowCardapio(!showCardapio); }} style={{ borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.primary, borderRadius: 10, padding: 12, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 6, marginBottom: 10 }}>
          <Ionicons name="add" size={18} color={COLORS.primary} />
          <Text style={{ fontSize: 14, fontWeight: "500", color: COLORS.primary }}>Adicionar item</Text>
        </Pressable>
        {showCardapio && (
          <View style={{ backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, marginBottom: 10, maxHeight: 250 }}>
            <ScrollView nestedScrollEnabled>
              {pratos.map((p) => (
                <Pressable key={p.id} onPress={() => addItem(p)} style={{ padding: 12, borderBottomWidth: 0.5, borderBottomColor: COLORS.surfaceSecondary, flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 14, color: COLORS.text, flex: 1 }}>{p.nome}</Text>
                  <Text style={{ fontSize: 14, color: COLORS.primary, fontWeight: "500" }}>{formatCurrency(parseFloat(p.preco))}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <Text style={{ fontSize: 12, fontWeight: "600", color: COLORS.primary, marginBottom: 8, marginTop: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Entrega</Text>
        <TextInput placeholder="Taxa de entrega (R$)" placeholderTextColor={COLORS.textTertiary} value={taxaEntrega} onChangeText={setTaxaEntrega} keyboardType="decimal-pad" style={inputStyle} />
        <TextInput placeholder="Observações" placeholderTextColor={COLORS.textTertiary} value={observacao} onChangeText={setObservacao} multiline style={{ ...inputStyle, minHeight: 60 }} />

        <View style={{ backgroundColor: COLORS.surface, borderRadius: 10, borderWidth: 0.5, borderColor: COLORS.surfaceSecondary, padding: 14, marginTop: 6, marginBottom: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Subtotal</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(subtotal)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}><Text style={{ fontSize: 13, color: COLORS.textSecondary }}>Taxa de entrega</Text><Text style={{ fontSize: 13, color: COLORS.text }}>{formatCurrency(taxa)}</Text></View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 8, borderTopWidth: 0.5, borderTopColor: COLORS.surfaceSecondary }}><Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.text }}>Total</Text><Text style={{ fontSize: 16, fontWeight: "600", color: COLORS.primary }}>{formatCurrency(total)}</Text></View>
        </View>

        {/* Pagamento */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{ fontSize: 14, fontWeight: "600", color: COLORS.text, marginBottom: 8 }}>Pagamento *</Text>

          {/* Toggle Já pago / Paga na entrega */}
          <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
            {(["na_entrega", "ja_pago"] as const).map(op => (
              <Pressable
                key={op}
                onPress={() => { console.log("[NovoDelivery] pagMomento selected:", op); setPagMomento(op); }}
                style={{
                  flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center",
                  backgroundColor: pagMomento === op ? COLORS.primary : COLORS.surface,
                  borderWidth: 1, borderColor: pagMomento === op ? COLORS.primary : COLORS.border,
                }}
              >
                <Text style={{ color: pagMomento === op ? "#fff" : COLORS.text, fontWeight: "600", fontSize: 13 }}>
                  {op === "na_entrega" ? "Paga na entrega" : "Já pago"}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Forma de pagamento */}
          <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 6 }}>
            {pagMomento === "ja_pago" ? "Forma de pagamento" : "Forma prevista"}
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {([
              { key: "dinheiro", label: "Dinheiro" },
              { key: "pix", label: "Pix" },
              { key: "credito", label: "Cartão crédito" },
              { key: "debito", label: "Cartão débito" },
            ] as const).map(({ key, label }) => (
              <Pressable
                key={key}
                onPress={() => { console.log("[NovoDelivery] pagForma selected:", key); setPagForma(key); }}
                style={{
                  paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
                  backgroundColor: pagForma === key ? COLORS.primary : COLORS.surface,
                  borderWidth: 1, borderColor: pagForma === key ? COLORS.primary : COLORS.border,
                }}
              >
                <Text style={{ color: pagForma === key ? "#fff" : COLORS.text, fontSize: 13 }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {/* Troco para quanto (só dinheiro + na entrega) */}
          {pagMomento === "na_entrega" && pagForma === "dinheiro" && (
            <View style={{ marginTop: 10 }}>
              <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginBottom: 4 }}>Troco para quanto? (opcional)</Text>
              <TextInput
                value={trocoPara}
                onChangeText={setTrocoPara}
                placeholder="Ex: 50.00"
                placeholderTextColor={COLORS.textTertiary}
                keyboardType="decimal-pad"
                style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 10, color: COLORS.text, fontSize: 14 }}
              />
            </View>
          )}
        </View>

        <Pressable onPress={submit} disabled={saving} style={{ backgroundColor: saving ? COLORS.textTertiary : COLORS.primary, borderRadius: 12, padding: 16, alignItems: "center" }}>
          {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontSize: 16, fontWeight: "600" }}>Confirmar pedido</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}
