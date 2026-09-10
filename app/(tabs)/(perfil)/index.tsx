import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Animated,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import { AnimatedPressable } from "@/components/AnimatedPressable";
import { LogOut, User, Mail, Shield, Tag, ChevronRight } from "lucide-react-native";
import { getRoleLabel, getInitials, isAdmin } from "@/utils/helpers";
import { UserRole } from "@/types";
import Constants from "expo-constants";

const ROLE_COLORS: Record<UserRole, string> = {
  garcom: "#3B82F6",
  administrador: "#EF4444",
  admin: "#EF4444",
  gerente: "#8B5CF6",
  cozinheiro: "#F59E0B",
};

export default function PerfilScreen() {
  const COLORS = useColors();
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const role = ((user as any)?.role as UserRole) || "garcom";
  const name = user?.nome || (user as any)?.name || user?.email || "Usuário";
  const email = user?.email || "";
  const initials = getInitials(name);
  const roleLabel = getRoleLabel(role);
  const roleColor = ROLE_COLORS[role] || COLORS.primary;
  const appVersion = Constants.expoConfig?.version || "1.0.0";
  const canAdmin = isAdmin(role);

  const handleSignOut = async () => {
    console.log("[Perfil] Sign out button pressed");
    try {
      await signOut();
      console.log("[Perfil] Sign out successful");
      router.replace("/auth-screen");
    } catch (e) {
      console.error("[Perfil] Sign out error:", e);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View
        style={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 20,
          paddingBottom: 16,
          backgroundColor: COLORS.surface,
          borderBottomWidth: 1,
          borderBottomColor: COLORS.border,
        }}
      >
        <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 26, color: COLORS.text, letterSpacing: -0.3 }}>
          Perfil
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 120, gap: 20 }}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View
            style={{
              backgroundColor: COLORS.surface,
              borderRadius: 20,
              padding: 24,
              borderWidth: 1,
              borderColor: COLORS.border,
              boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: COLORS.primary,
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 16px rgba(232, 82, 26, 0.35)",
              }}
            >
              <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 30, color: "#fff" }}>
                {initials}
              </Text>
            </View>

            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 22, color: COLORS.text, letterSpacing: -0.2, textAlign: "center" }}>
              {name}
            </Text>

            <View
              style={{
                backgroundColor: roleColor + "18",
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 5,
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Shield size={13} color={roleColor} />
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 13, color: roleColor }}>
                {roleLabel}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: slideAnim }],
            backgroundColor: COLORS.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.border,
            overflow: "hidden",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: COLORS.divider }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.surfaceSecondary, alignItems: "center", justifyContent: "center" }}>
              <Mail size={18} color={COLORS.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                E-mail
              </Text>
              <Text numberOfLines={1} style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {email}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}>
            <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: roleColor + "18", alignItems: "center", justifyContent: "center" }}>
              <User size={18} color={roleColor} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                Função
              </Text>
              <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                {roleLabel}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Admin links */}
        {canAdmin && (
          <Animated.View
            style={{
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
              backgroundColor: COLORS.surface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
              overflow: "hidden",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04)",
            }}
          >
            <AnimatedPressable
              onPress={() => {
                console.log("[Perfil] Categorias link pressed");
                router.push("/categoria");
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: COLORS.primaryMuted, alignItems: "center", justifyContent: "center" }}>
                <Tag size={18} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Outfit_600SemiBold", fontSize: 14, color: COLORS.text }}>
                  Gerenciar Categorias
                </Text>
                <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textSecondary }}>
                  Adicionar, editar e remover categorias
                </Text>
              </View>
              <ChevronRight size={18} color={COLORS.textSecondary} />
            </AnimatedPressable>
          </Animated.View>
        )}

        <View style={{ height: 1, backgroundColor: COLORS.divider }} />

        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <AnimatedPressable
            onPress={handleSignOut}
            style={{
              backgroundColor: "#EF4444",
              borderRadius: 14,
              height: 52,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              boxShadow: "0 4px 16px rgba(239, 68, 68, 0.3)",
            }}
          >
            <LogOut size={20} color="#fff" />
            <Text style={{ fontFamily: "Outfit_700Bold", fontSize: 16, color: "#fff" }}>
              Sair do aplicativo
            </Text>
          </AnimatedPressable>
        </Animated.View>

        <Text style={{ fontFamily: "Outfit_400Regular", fontSize: 12, color: COLORS.textTertiary, textAlign: "center" }}>
          CozinhaFast Pro v{appVersion}
        </Text>
      </ScrollView>
    </View>
  );
}
